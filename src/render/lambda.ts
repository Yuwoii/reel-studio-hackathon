// Remotion Lambda backend (eu-central-2): stage beat audio in the Remotion bucket, start renderMediaOnLambda with
// the ≤ 8-lambda fan-out, poll getRenderProgress, download the output, delete the render folder, report cost.
// Privacy: Remotion makes its bucket world-readable (bucket policy on /*). We replace that policy with a
// sites/*-only one (plan.bucketPolicy) whenever we create the bucket and in scripts/deploy-site.sh, AND we delete
// each render's folder (out.mp4 + progress.json, which embeds inputProps) right after downloading, so even a
// misconfigured bucket only exposes a render while it runs.
// Credentials: REMOTION_AWS_ACCESS_KEY_ID/SECRET from env (Remotion reads them natively); never logged.

import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { deleteRender, getOrCreateBucket } from "@remotion/lambda";
import {
  cancelRenderOnLambda,
  getAwsClient,
  getRenderProgress,
  presignUrl,
  renderMediaOnLambda,
  speculateFunctionName,
  type RenderProgress,
} from "@remotion/lambda/client";
import type { Progress, RenderResult, TtsResult } from "../contracts.js";
import { COMPOSITION_ID, type BeatAudio, type ReelProps } from "../schema/index.js";
import {
  AUDIO_PREFIX,
  LAMBDA_REGION,
  LambdaUnavailableError,
  audioJobPrefix,
  audioKey,
  bucketPolicy,
  fatalRenderMessage,
  lambdaCost,
  lambdaSizing,
  planLambdaFanout,
  progressDetail,
  sanitizeError,
  shortError,
} from "./plan.js";

export interface LambdaBackendOptions {
  /** null → Lambda is "not configured" (no REEL_SITE_URL, no data/site.json). */
  serveUrl: string | null;
  functionName?: string;
  /** Presigned audio GET validity (default 2 h). */
  audioUrlTtlSec?: number;
  pollMs?: number;
  /** Give up polling after this long (default 15 min). The render itself is bounded by the function timeout. */
  maxWaitMs?: number;
  log?: (s: string) => void;
  env?: NodeJS.ProcessEnv;
}

export class AbortError extends Error {
  constructor(message = "render aborted") {
    super(message);
    this.name = "AbortError";
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export function createLambdaBackend(opts: LambdaBackendOptions) {
  const env = opts.env ?? process.env;
  const region = LAMBDA_REGION;
  const size = lambdaSizing(env);
  const memoryMb = size.memoryMb;
  const functionName =
    opts.functionName ??
    (env.REEL_LAMBDA_FUNCTION?.trim() || speculateFunctionName({ memorySizeInMb: size.memoryMb, diskSizeInMb: size.diskMb, timeoutInSeconds: size.timeoutSec }));
  const ttl = opts.audioUrlTtlSec ?? 2 * 3600;
  const pollMs = opts.pollMs ?? 2500;
  const maxWaitMs = opts.maxWaitMs ?? 15 * 60_000;
  const log = opts.log ?? (() => {});

  function assertConfigured(): string {
    if (!env.REMOTION_AWS_ACCESS_KEY_ID || !env.REMOTION_AWS_SECRET_ACCESS_KEY) {
      throw new LambdaUnavailableError("credentials", "REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY not set");
    }
    if (!opts.serveUrl) throw new LambdaUnavailableError("not-configured", "no Remotion site (set REEL_SITE_URL or run scripts/deploy-site.sh)");
    return opts.serveUrl;
  }

  const s3 = () => getAwsClient({ region, service: "s3" });

  /** Replace Remotion's public-read-everything policy with the sites/*-only one. */
  async function restrictBucketPolicy(Bucket: string): Promise<void> {
    const { client, sdk } = s3();
    await client.send(new sdk.PutBucketPolicyCommand({ Bucket, Policy: bucketPolicy(Bucket) }));
  }

  // One getOrCreateBucket per process: it also (re)applies the folder-expiry lifecycle rules (renders/<n>-days…).
  // A bucket Remotion has JUST created carries the public policy → restrict it before anything private lands there;
  // if that fails we refuse to use the bucket. Existing buckets are fixed by scripts/deploy-site.sh (+ verified).
  let bucketP: Promise<string> | null = null;
  function bucket(): Promise<string> {
    bucketP ??= getOrCreateBucket({ region, enableFolderExpiry: true }).then(async (b) => {
      if (!b.alreadyExisted) {
        await restrictBucketPolicy(b.bucketName);
        log(`created ${b.bucketName}; restricted public read to sites/*`);
      }
      return b.bucketName;
    });
    bucketP.catch(() => (bucketP = null));
    return bucketP;
  }

  async function deleteAudio(jobId: string): Promise<number> {
    const Bucket = await bucket();
    const { client, sdk } = s3();
    const listed = await client.send(new sdk.ListObjectsV2Command({ Bucket, Prefix: audioJobPrefix(jobId) }));
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) await client.send(new sdk.DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
    return keys.length;
  }

  /**
   * Remotion's folder expiry only covers renders/<n>-day(s)… prefixes, so reel-audio/ is cleaned by us: after each
   * render (render() deletes the job's audio) and here, sweeping anything older than 24 h a crash left behind.
   */
  async function sweepOldAudio(maxAgeMs = 24 * 3600_000): Promise<number> {
    const Bucket = await bucket();
    const { client, sdk } = s3();
    const listed = await client.send(new sdk.ListObjectsV2Command({ Bucket, Prefix: AUDIO_PREFIX, MaxKeys: 1000 }));
    const old = (listed.Contents ?? []).filter((o) => o.LastModified && Date.now() - o.LastModified.getTime() > maxAgeMs).map((o) => ({ Key: o.Key! }));
    if (old.length) await client.send(new sdk.DeleteObjectsCommand({ Bucket, Delete: { Objects: old, Quiet: true } }));
    return old.length;
  }

  async function stageAudio(jobId: string, tts: TtsResult): Promise<BeatAudio[]> {
    assertConfigured();
    const Bucket = await bucket();
    const { client, sdk } = s3();
    await sweepOldAudio().catch((e) => log(`audio sweep failed: ${shortError((e as Error).message)}`));
    const out: BeatAudio[] = [];
    const nonce = randomBytes(16).toString("hex");
    for (const b of tts.beats) {
      const Key = audioKey(jobId, b.beatId, nonce);
      // No ACL + bucket policy covering only sites/* → private; the renderer fetches it through a presigned GET.
      await client.send(new sdk.PutObjectCommand({ Bucket, Key, Body: await readFile(b.file), ContentType: "audio/mpeg" }));
      const url = await presignUrl({ region, bucketName: Bucket, objectKey: Key, expiresInSeconds: ttl });
      out.push({ beatId: b.beatId, url, durationSec: b.durationSec, words: b.words });
    }
    log(`staged ${out.length} beat(s) under s3://${Bucket}/${audioJobPrefix(jobId)} (urls valid ${ttl / 60} min)`);
    return out;
  }

  async function download(p: RenderProgress, outFile: string, signal?: AbortSignal): Promise<void> {
    if (!p.outKey || !p.outBucket) throw new Error("Lambda render finished without an output key");
    const url = await presignUrl({ region, bucketName: p.outBucket, objectKey: p.outKey, expiresInSeconds: 900 });
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`downloading the render failed: HTTP ${res.status}`);
    await mkdir(path.dirname(outFile), { recursive: true });
    const tmp = `${outFile}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(tmp));
      await rename(tmp, outFile);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  /**
   * Throws LambdaUnavailableError / raw AWS errors BEFORE the render started (caller may fall back — see
   * plan.shouldFallback); after start every failure is final. `started` is reported through the callback.
   */
  async function render(
    jobId: string,
    props: ReelProps,
    outFile: string,
    onProgress?: Progress,
    signal?: AbortSignal,
    onStarted?: () => void,
  ): Promise<RenderResult> {
    const serveUrl = assertConfigured();
    if (signal?.aborted) throw new AbortError();
    const fan = planLambdaFanout(props.audio); // throws over the frame budget, before anything starts
    const t0 = Date.now();
    onProgress?.("render", "starting Lambda", 0);
    const { renderId, bucketName } = await renderMediaOnLambda({
      region,
      functionName,
      serveUrl,
      composition: COMPOSITION_ID,
      inputProps: props as unknown as Record<string, unknown>,
      codec: "h264",
      audioCodec: "aac",
      imageFormat: "jpeg",
      jpegQuality: 85,
      privacy: "private",
      downloadBehavior: { type: "play-in-browser" },
      maxRetries: 1,
      framesPerLambda: fan.framesPerLambda,
      concurrencyPerLambda: size.concurrencyPerLambda,
      // Generous: the start lambda waits for the browser + composition; frames are cheap SVG.
      timeoutInMilliseconds: 120_000,
      deleteAfter: "7-days",
      enableCancellation: true,
      logLevel: "warn",
    });
    onStarted?.();
    log(`lambda render ${renderId} started on ${functionName}: ${fan.totalFrames} frames, framesPerLambda=${fan.framesPerLambda} → ${fan.chunks} renderer lambdas × ${size.concurrencyPerLambda} tabs`);

    // Folder renders/<renderId>/ holds out.mp4 AND progress.json (with the full inputProps incl. presigned audio
    // URLs) → delete it as soon as we no longer need it, on success and on failure. deleteAfter:"7-days" is the
    // backstop if this process dies mid-render.
    const dropRender = () =>
      deleteRender({ region, bucketName, renderId }).catch((e) => log(`deleting render ${renderId} failed: ${shortError((e as Error).message)}`));

    let last: RenderProgress | null = null;
    let pollErrors = 0;
    try {
      for (;;) {
        if (Date.now() - t0 > maxWaitMs) throw new Error(`Lambda render ${renderId} did not finish within ${Math.round(maxWaitMs / 60000)} min`);
        await sleep(pollMs, signal);
        let p: RenderProgress;
        try {
          p = await getRenderProgress({ renderId, bucketName, functionName, region });
          pollErrors = 0;
        } catch (e) {
          // Transient (throttle/network) — the render keeps going on AWS; never fall back from here.
          if (++pollErrors >= 5) throw new Error(`getRenderProgress failed 5× in a row: ${shortError((e as Error).message)}`);
          continue;
        }
        last = p;
        if (p.fatalErrorEncountered) throw new Error(fatalRenderMessage(p.errors));
        if (p.done) break;
        const d = progressDetail(p.overallProgress);
        onProgress?.("render", d.detail, d.fraction);
      }
      onProgress?.("render", "downloading", 1);
      await download(last, outFile, signal);
    } catch (e) {
      // Still running on AWS (abort, poll timeout, 5 poll failures, download error after done is harmless) →
      // cancel so it stops billing instead of running until the function timeout. Remotion 4.0.534 cancels renders
      // started with enableCancellation (renderers stop at their next check).
      if (!last?.done && !last?.fatalErrorEncountered) {
        await cancelRenderOnLambda({ region, bucketName, renderId }).catch((c) => log(`cancel ${renderId} failed: ${shortError((c as Error).message)}`));
      }
      await deleteAudio(jobId).catch(() => {});
      await dropRender();
      if (signal?.aborted || e instanceof AbortError) throw new AbortError(`render ${renderId} cancelled`);
      throw sanitizeError(e);
    }
    // Audio was only needed by this render; the presigned URLs expire in 2 h anyway → re-stage before re-renders.
    await deleteAudio(jobId).catch((e) => log(`audio cleanup failed: ${shortError((e as Error).message)}`));
    await dropRender();
    const cost = lambdaCost(last, memoryMb);
    const renderSec = Math.round((Date.now() - t0) / 100) / 10;
    log(`lambda render ${renderId} done in ${renderSec}s: $${cost.costUsd} ${cost.gbSeconds} GB-s, ${cost.lambdasInvoked} lambdas`);
    return { file: outFile, backend: "lambda", renderSec, ...cost };
  }

  return { functionName, region, size, stageAudio, render, deleteAudio, sweepOldAudio, bucket, restrictBucketPolicy };
}

export type LambdaBackend = ReturnType<typeof createLambdaBackend>;
