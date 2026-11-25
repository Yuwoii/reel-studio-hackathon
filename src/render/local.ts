// Local render fallback on NUC 1 (REEL_RENDER=local, or Lambda unavailable before start). One render at a time
// (module-level mutex), concurrency 2, everything in a `nice -n 19` child (localWorker.ts) so the live services
// on this box keep priority. Audio for local renders lives in the job's own Remotion public dir:
//   <jobsDir>/<jobId>/render/public/{fonts/, audio/beat_XX.mp3}  → BeatAudio.url = "audio/beat_XX.mp3" (staticFile).

import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Progress, RenderResult, TtsResult } from "../contracts.js";
import type { BeatAudio, ReelProps } from "../schema/index.js";
import { AbortError } from "./lambda.js";
import { assertJobId, beatFileName, localAudioUrl, progressDetail, shortError } from "./plan.js";

export interface LocalBackendOptions {
  repoRoot: string;
  jobsDir: string;
  concurrency?: number;
  /** Prefix the worker with `nice -n 19` (default true). */
  nice?: boolean;
  log?: (s: string) => void;
}

// One local render per process, ever — the box is shared with live services (CPU limit 4 in the container).
let chain: Promise<unknown> = Promise.resolve();
export function serializeLocal<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(fn);
  chain = run.catch(() => undefined);
  return run;
}

function workerPath(): { file: string; execArgv: string[] } {
  const here = fileURLToPath(import.meta.url);
  const ext = path.extname(here); // .ts under tsx, .js from dist/
  // Under tsx the parent's execArgv carries the loader (--import tsx / --require …); from dist it's empty.
  return { file: path.join(path.dirname(here), `localWorker${ext}`), execArgv: ext === ".ts" ? process.execArgv : [] };
}

export function createLocalBackend(opts: LocalBackendOptions) {
  const concurrency = opts.concurrency ?? 2;
  const log = opts.log ?? (() => {});
  const workDir = (jobId: string) => {
    assertJobId(jobId);
    return path.join(opts.jobsDir, jobId, "render");
  };
  const publicDir = (jobId: string) => path.join(workDir(jobId), "public");

  async function preparePublic(jobId: string): Promise<string> {
    const dir = publicDir(jobId);
    await mkdir(path.join(dir, "audio"), { recursive: true });
    await cp(path.join(opts.repoRoot, "public", "fonts"), path.join(dir, "fonts"), { recursive: true });
    return dir;
  }

  async function stageAudio(jobId: string, tts: TtsResult): Promise<BeatAudio[]> {
    const dir = await preparePublic(jobId);
    const out: BeatAudio[] = [];
    for (const b of tts.beats) {
      await copyFile(b.file, path.join(dir, "audio", beatFileName(b.beatId)));
      out.push({ beatId: b.beatId, url: localAudioUrl(b.beatId), durationSec: b.durationSec, words: b.words });
    }
    return out;
  }

  function render(jobId: string, props: ReelProps, outFile: string, onProgress?: Progress, signal?: AbortSignal): Promise<RenderResult> {
    return serializeLocal(async () => {
      if (signal?.aborted) throw new AbortError();
      const dir = workDir(jobId);
      const pub = await preparePublic(jobId); // fonts even when audio is https (Lambda-staged, fallback case)
      const propsFile = path.join(dir, "props.json");
      const jobFile = path.join(dir, "local-job.json");
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeFile(propsFile, JSON.stringify(props));
      await writeFile(
        jobFile,
        JSON.stringify({ entry: path.join(opts.repoRoot, "remotion", "index.ts"), publicDir: pub, propsFile, outFile, concurrency }),
      );
      const tmpDir = path.join(dir, "tmp");
      await rm(tmpDir, { recursive: true, force: true });
      await mkdir(tmpDir, { recursive: true });
      const w = workerPath();
      const argv = [...w.execArgv, w.file, jobFile];
      const [cmd, args] = opts.nice === false ? [process.execPath, argv] : ["nice", ["-n", "19", process.execPath, ...argv]];
      const t0 = Date.now();
      onProgress?.("render", "local bundle", 0);
      await new Promise<void>((resolve, reject) => {
        // Own process group (detached) so an abort can reach Chrome + ffmpeg too: SIGTERM the worker first (it
        // cancels renderMedia and closes Chrome), then SIGKILL the whole group if it is still alive after 15 s.
        // TMPDIR → the job's render dir (jobs volume): Remotion's webpack bundle, frame/audio scratch and Chrome's
        // profile otherwise land in the container's /tmp tmpfs, which is small and counts against the memory limit.
        const child = spawn(cmd, args, { cwd: opts.repoRoot, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, TMPDIR: tmpDir } });
        let stderr = "";
        let buf = "";
        let exited = false;
        const killGroup = (sig: NodeJS.Signals) => {
          try {
            if (child.pid) process.kill(-child.pid, sig);
          } catch {
            /* already gone */
          }
        };
        const onAbort = () => {
          child.kill("SIGTERM");
          setTimeout(() => !exited && killGroup("SIGKILL"), 15_000).unref();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (d: Buffer) => {
          buf += d.toString();
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            try {
              const m = JSON.parse(line) as { type: string; fraction?: number };
              if (m.type === "progress") {
                const p = progressDetail(m.fraction ?? 0);
                onProgress?.("render", `local ${p.detail}`, p.fraction);
              }
            } catch {
              /* non-JSON noise from libraries */
            }
          }
        });
        child.stderr.on("data", (d: Buffer) => {
          stderr = (stderr + d.toString()).slice(-4000);
        });
        child.on("error", reject);
        child.on("close", (code) => {
          exited = true;
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) {
            killGroup("SIGKILL"); // stragglers (Chrome helpers) that outlived the worker
            return reject(new AbortError("local render cancelled"));
          }
          if (code === 0) return resolve();
          const lastLine = stderr.trim().split("\n").find((l) => /error/i.test(l)) ?? stderr.trim().split("\n")[0] ?? "";
          reject(new Error(`local render failed (exit ${code}): ${shortError(lastLine)}`));
        });
      });
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      const renderSec = Math.round((Date.now() - t0) / 100) / 10;
      log(`local render ${jobId} done in ${renderSec}s`);
      return { file: outFile, backend: "local" as const, renderSec };
    });
  }

  async function cleanup(jobId: string): Promise<void> {
    await rm(publicDir(jobId), { recursive: true, force: true });
  }

  return { stageAudio, render, cleanup, publicDir };
}

export type LocalBackend = ReturnType<typeof createLocalBackend>;
