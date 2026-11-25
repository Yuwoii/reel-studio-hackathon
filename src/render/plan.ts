// Pure render-planning helpers (no network, no fs): Lambda fan-out cap, backend choice + fallback rules,
// progress/cost/error mapping and S3 key naming. Everything here is unit-tested in test/render.test.ts.

import { totalFrames, type BeatAudio } from "../schema/index.js";

export type Backend = "lambda" | "local";

/**
 * Hard rule (handoff): the account's Lambda concurrency quota is 10 → at most 8 concurrent RENDERER lambdas
 * (+1 orchestrator lambda = 9). Remotion 4.0.534 takes either `framesPerLambda` or `concurrency` (never both);
 * we pass framesPerLambda ourselves so the cap is explicit and testable.
 */
export const MAX_RENDER_LAMBDAS = 8;
/** Remotion's own floor (serverless-client MINIMUM_FRAMES_PER_FUNCTION = 5) is far below ours; we keep ≥ 20 frames
 * per lambda (Remotion's historic default) so short renders don't spin up pointless lambdas. */
export const MIN_FRAMES_PER_LAMBDA = 20;
/** Remotion rejects framesPerLambda below min(5, durationInFrames). */
const REMOTION_MIN_FRAMES = 5;

/** framesPerLambda = max(ceil(total / 8), 20), but never more than the whole render (one lambda then). */
export function framesPerLambda(total: number, maxLambdas = MAX_RENDER_LAMBDAS): number {
  if (!Number.isInteger(total) || total <= 0) throw new Error(`totalFrames must be a positive integer, got ${total}`);
  if (!Number.isInteger(maxLambdas) || maxLambdas < 1 || maxLambdas > MAX_RENDER_LAMBDAS) {
    throw new Error(`maxLambdas must be 1..${MAX_RENDER_LAMBDAS}, got ${maxLambdas}`);
  }
  const fpl = Math.max(Math.ceil(total / maxLambdas), MIN_FRAMES_PER_LAMBDA, Math.min(REMOTION_MIN_FRAMES, total));
  return Math.min(fpl, total);
}

/** How many renderer lambdas Remotion will launch for a given framesPerLambda (it chunks [0, total)). */
export function lambdaChunks(total: number, fpl: number): number {
  return Math.ceil(total / fpl);
}

/**
 * Per-lambda frame budget against the 600 s function timeout. Measured: snow sample 1594 frames → 8 × 200 frames,
 * 304 s wall incl. ~30 s start. 300 frames/lambda ≈ 1.5× that (~450 s) keeps a safe margin → 8 × 300 = 2400 frames
 * (80 s at 30 fps; the script schema targets 45–75 s). Longer renders are refused BEFORE start (no fallback).
 */
export const MAX_FRAMES_PER_LAMBDA = 300;
export const MAX_LAMBDA_TOTAL_FRAMES = MAX_RENDER_LAMBDAS * MAX_FRAMES_PER_LAMBDA;

export function assertLambdaFrameBudget(total: number): void {
  if (total > MAX_LAMBDA_TOTAL_FRAMES) {
    throw new Error(
      `reel is ${total} frames (${Math.round(total / 30)} s) — over the Lambda budget of ${MAX_LAMBDA_TOTAL_FRAMES} frames (8 × ${MAX_FRAMES_PER_LAMBDA}, 600 s timeout); shorten the script`,
    );
  }
}

export function planLambdaFanout(audio: BeatAudio[]): { totalFrames: number; framesPerLambda: number; chunks: number } {
  const total = totalFrames(audio);
  assertLambdaFrameBudget(total);
  const fpl = framesPerLambda(total);
  return { totalFrames: total, framesPerLambda: fpl, chunks: lambdaChunks(total, fpl) };
}

// ── Backend selection ─────────────────────────────────────────────────────────────────────────────────────────

export function backendFromEnv(raw: string | undefined): Backend {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "lambda") return "lambda";
  if (v === "local") return "local";
  throw new Error(`REEL_RENDER must be lambda|local, got "${raw}"`);
}

const isRemoteUrl = (u: string) => /^(https?:|data:|blob:)/i.test(u);

/**
 * Backend for one render: the configured one, except that audio staged locally (public-dir paths, because the
 * S3 upload was unavailable) can only be rendered locally — Lambda cannot reach NUC 1.
 */
export function chooseBackend(configured: Backend, audio: BeatAudio[]): Backend {
  if (configured === "local") return "local";
  const local = audio.some((a) => a.url !== "" && !isRemoteUrl(a.url));
  return local ? "local" : "lambda";
}

/**
 * "Lambda unavailable" — the ONLY errors that may fall back to a local render. Deliberately narrow: the function
 * is missing, credentials are absent/invalid, the invoke was throttled before anything started, or Lambda is
 * simply not configured (no site). Anything else (bad props, composition error, a failure after the render
 * started) is thrown as-is: falling back then would double the work and hide a real bug.
 */
export type UnavailableReason = "not-configured" | "function-not-found" | "credentials" | "throttled";

export class LambdaUnavailableError extends Error {
  constructor(
    readonly reason: UnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "LambdaUnavailableError";
  }
}

export function classifyStartError(e: unknown): UnavailableReason | null {
  if (e instanceof LambdaUnavailableError) return e.reason;
  const err = e as { name?: string; Code?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = String(err?.name ?? err?.Code ?? err?.code ?? "");
  const msg = String(err?.message ?? e ?? "");
  if (name === "ResourceNotFoundException" || /Function not found|function .* does not exist|ResourceNotFoundException/i.test(msg)) {
    return "function-not-found";
  }
  if (
    /^(UnrecognizedClientException|InvalidSignatureException|InvalidClientTokenId|ExpiredToken(Exception)?|CredentialsProviderError|SignatureDoesNotMatch|InvalidAccessKeyId)$/.test(
      name,
    ) ||
    /security token included in the request is invalid|could not load credentials|no aws credentials|credentials? (are|is) (missing|not set)|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(
      msg,
    )
  ) {
    return "credentials";
  }
  if (/^(TooManyRequestsException|ThrottlingException|Throttling|RequestLimitExceeded|SlowDown)$/.test(name) || /Rate Exceeded|TooManyRequests|throttl/i.test(msg)) {
    return "throttled";
  }
  return null;
}

/**
 * Audio staging (S3 PutObject) may fall back to local staging — which forces a full ~30 min LOCAL render — only
 * for durable unavailability (no site / bad credentials). An S3 throttle (SlowDown) is transient: throw instead,
 * the job can simply be retried.
 */
export function shouldFallbackStaging(e: unknown, fallbackEnabled: boolean): boolean {
  const r = classifyStartError(e);
  return fallbackEnabled && (r === "not-configured" || r === "credentials");
}

/** Fallback allowed only if the error is an unavailability AND Lambda had not started a render yet. */
export function shouldFallback(e: unknown, started: boolean, fallbackEnabled: boolean): boolean {
  return fallbackEnabled && !started && classifyStartError(e) !== null;
}

// ── Progress, cost, errors ────────────────────────────────────────────────────────────────────────────────────

export function progressDetail(fraction: number): { detail: string; fraction: number } {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return { detail: `${Math.floor(f * 100)}%`, fraction: Math.round(f * 1000) / 1000 };
}

export interface LambdaCost {
  costUsd?: number;
  gbSeconds?: number;
  lambdasInvoked?: number;
}

/** costs.accruedSoFar (USD) + estimatedBillingDurationInMilliseconds × memory (GB) → GB-s. */
export function lambdaCost(
  p: { costs?: { accruedSoFar?: number; currency?: string } | null; estimatedBillingDurationInMilliseconds?: number | null; lambdasInvoked?: number },
  memoryMb: number,
): LambdaCost {
  const out: LambdaCost = {};
  if (typeof p.costs?.accruedSoFar === "number" && Number.isFinite(p.costs.accruedSoFar)) out.costUsd = Math.round(p.costs.accruedSoFar * 1e6) / 1e6;
  if (typeof p.estimatedBillingDurationInMilliseconds === "number") {
    out.gbSeconds = Math.round((p.estimatedBillingDurationInMilliseconds / 1000) * (memoryMb / 1024) * 100) / 100;
  }
  if (typeof p.lambdasInvoked === "number") out.lambdasInvoked = p.lambdasInvoked;
  return out;
}

/**
 * Remove anything secret-looking from a string: presigned query strings (X-Amz-Signature/Credential), AWS key ids,
 * `<name>=<value>` / `"name": "value"` pairs whose name looks like a secret/token/password/signature, Authorization
 * headers and bare 40-char AWS secret-shaped tokens. Used for every error that leaves the render module.
 */
export function redactSecrets(text: string): string {
  return String(text ?? "")
    .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/g, "$1?…")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(
      /\b([A-Za-z0-9_.-]*(?:secret|token|password|passwd|signature|credential|session|api[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\b(Authorization|X-Amz-Security-Token)(\s*[:=]\s*)(?:(?:Bearer|AWS4-HMAC-SHA256)\s+)?[^\n"']+/gi, "$1$2[REDACTED]")
    .replace(/(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g, "[REDACTED]");
}

/** First non-empty line, secrets redacted, capped — for Discord threads and logs. */
export function shortError(message: string, max = 300): string {
  const first =
    String(message ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "unknown error";
  const clean = redactSecrets(first);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Re-throwable copy of any error with a redacted one-line message. Keeps `name` (AbortError, AWS error names —
 * classifyStartError still works on the copy) and `reason` of LambdaUnavailableError, drops stack/cause/$metadata
 * (AWS SDK errors can carry request params).
 */
export function sanitizeError(e: unknown): Error {
  if (e instanceof LambdaUnavailableError) return new LambdaUnavailableError(e.reason, shortError(e.message));
  const src = e as { name?: string; message?: string } | null;
  const out = new Error(shortError(String(src?.message ?? e)));
  if (src && typeof src.name === "string" && src.name) out.name = src.name;
  return out;
}

export interface ProgressErrorLike {
  message: string;
  name?: string;
  isFatal?: boolean;
  chunk?: number | null;
  frame?: number | null;
  willRetry?: boolean;
}

/** A thrown-ready message for a fatal render (Remotion progress.errors[] / fatalErrorEncountered). */
export function fatalRenderMessage(errors: ProgressErrorLike[]): string {
  const fatal = errors.find((e) => e.isFatal) ?? errors.find((e) => !e.willRetry) ?? errors[errors.length - 1];
  if (!fatal) return "Lambda render failed (no error details)";
  const where = [fatal.chunk != null ? `chunk ${fatal.chunk}` : "", fatal.frame != null ? `frame ${fatal.frame}` : ""].filter(Boolean).join(", ");
  return `Lambda render failed${where ? ` (${where})` : ""}: ${shortError(fatal.message)}`;
}

// ── Naming ────────────────────────────────────────────────────────────────────────────────────────────────────

/** jobIds become S3 keys and local dir names → strict charset, no traversal. */
export const JOB_ID_SAFE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function assertJobId(jobId: string): void {
  if (!JOB_ID_SAFE_RE.test(jobId)) throw new Error(`unsafe jobId "${jobId}" (allowed: ${JOB_ID_SAFE_RE})`);
}

export const AUDIO_PREFIX = "reel-audio/";

export function beatFileName(beatId: number): string {
  if (!Number.isInteger(beatId) || beatId < 1 || beatId > 99) throw new Error(`beatId must be 1..99, got ${beatId}`);
  return `beat_${String(beatId).padStart(2, "0")}.mp3`;
}

/** Random per-staging segment: 128 bit hex. Makes staged audio keys unguessable (defence in depth — the bucket
 * policy, not the key, is what keeps reel-audio/ private; see bucketPolicy()). */
export const AUDIO_NONCE_RE = /^[0-9a-f]{32}$/;

/** reel-audio/<jobId>/<nonce>/beat_XX.mp3 in the Remotion bucket. */
export function audioKey(jobId: string, beatId: number, nonce: string): string {
  assertJobId(jobId);
  if (!AUDIO_NONCE_RE.test(nonce)) throw new Error("audio nonce must be 32 lowercase hex chars");
  return `${AUDIO_PREFIX}${jobId}/${nonce}/${beatFileName(beatId)}`;
}

export function audioJobPrefix(jobId: string): string {
  assertJobId(jobId);
  return `${AUDIO_PREFIX}${jobId}/`;
}

/** Local backend: path relative to the job's Remotion public dir (ReelComposition → staticFile()). */
export function localAudioUrl(beatId: number): string {
  return `audio/${beatFileName(beatId)}`;
}

/**
 * Render function size. The Remotion default (2048 MB / 240 s) was too small: the first live render of the snow
 * sample (1594 frames, 8 × 200) hit the 240 s timeout at ~1.2–1.5 s/frame on Lambda. New accounts are capped at
 * 3008 MB (≈1.7 vCPU), so we use the max + 600 s + 2 tabs per lambda. Same cost per CPU-second at any size.
 * Override per env (REEL_LAMBDA_MEMORY_MB / _DISK_MB / _TIMEOUT_SEC) — the function must exist with that name.
 */
export const LAMBDA_MEMORY_MB = 3008;
export const LAMBDA_DISK_MB = 2048;
export const LAMBDA_TIMEOUT_SEC = 600;
/** Chrome tabs per renderer lambda (Lambda runs Chrome --single-process; 2 tabs use both vCPUs at 3008 MB). */
export const LAMBDA_CONCURRENCY_PER_LAMBDA = 2;

export interface LambdaSizing {
  memoryMb: number;
  diskMb: number;
  timeoutSec: number;
  concurrencyPerLambda: number;
}

export function lambdaSizing(env: NodeJS.ProcessEnv = process.env): LambdaSizing {
  const num = (name: string, def: number, min: number, max: number): number => {
    const raw = env[name]?.trim();
    if (!raw) return def;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${name} must be an integer ${min}..${max}`);
    return v;
  };
  return {
    memoryMb: num("REEL_LAMBDA_MEMORY_MB", LAMBDA_MEMORY_MB, 512, 10240),
    diskMb: num("REEL_LAMBDA_DISK_MB", LAMBDA_DISK_MB, 512, 10240),
    timeoutSec: num("REEL_LAMBDA_TIMEOUT_SEC", LAMBDA_TIMEOUT_SEC, 15, 900),
    concurrencyPerLambda: num("REEL_LAMBDA_CONCURRENCY_PER_LAMBDA", LAMBDA_CONCURRENCY_PER_LAMBDA, 1, 8),
  };
}
/**
 * Bucket policy for the Remotion bucket. Remotion 4.0.534 creates its bucket with `PublicReadGetObject` on
 * `<bucket>/*`, which makes privacy:"private" meaningless (renders, progress.json with inputProps, staged audio
 * all anonymously readable). Only the site bundle must be public — the renderer Chrome loads the serveUrl without
 * credentials; renders, progress and audio are written/read with IAM creds or presigned URLs.
 */
export function bucketPolicy(bucketName: string, partition = "aws"): string {
  if (!/^remotionlambda-[a-z0-9-]+$/.test(bucketName)) throw new Error(`not a Remotion bucket: ${bucketName}`);
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadSitesOnly",
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: `arn:${partition}:s3:::${bucketName}/sites/*`,
      },
    ],
  });
}

export const REMOTION_VERSION = "4.0.534";
export const LAMBDA_REGION = "eu-central-2" as const;
