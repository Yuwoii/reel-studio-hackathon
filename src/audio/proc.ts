// Child-process runner for ffmpeg/ffprobe/python. Every heavy child runs under `nice -n 19` (NUC 1 hosts live
// services), stderr is captured (bounded) for error messages and for parsing ffmpeg's filter reports, and both a
// timeout and an AbortSignal kill the whole process group (python → edge-tts websockets, ffmpeg → nothing, but
// detached+group kill is the only reliable way to not leave orphans behind).

import { spawn } from "node:child_process";

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Prefix argv with `nice -n 19` (default true). */
  nice?: boolean;
  /** Written to stdin, then stdin is closed. */
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Max bytes kept per stream (tail). ebur128 reports can be long; default 4 MB. */
  maxBuffer?: number;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class ProcError extends Error {
  constructor(
    message: string,
    readonly result?: RunResult,
  ) {
    super(message);
    this.name = "ProcError";
  }
}

export function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

/** Run argv[0] with argv[1..]; resolves on exit code 0, rejects with ProcError (stderr tail) otherwise. */
export async function run(argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  const r = await runRaw(argv, opts);
  if (r.code !== 0) {
    const tail = r.stderr.trim().split("\n").slice(-12).join("\n");
    throw new ProcError(`${argv[0]} exited ${r.code}: ${tail}`, r);
  }
  return r;
}

/** Like run() but resolves with any exit code (callers that interpret failures themselves). */
export function runRaw(argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs = 10 * 60_000, signal, nice = true, input, env, maxBuffer = 4 * 1024 * 1024 } = opts;
  if (signal?.aborted) return Promise.reject(abortError());
  const full = nice ? ["nice", "-n", "19", ...argv] : argv;
  return new Promise((resolve, reject) => {
    const child = spawn(full[0], full.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // own process group → kill(-pid) reaches grandchildren
      env: env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    const keep = (buf: string, chunk: Buffer) => {
      const s = buf + chunk.toString("utf8");
      return s.length > maxBuffer ? s.slice(-maxBuffer) : s;
    };
    child.stdout.on("data", (c: Buffer) => (stdout = keep(stdout, c)));
    child.stderr.on("data", (c: Buffer) => (stderr = keep(stderr, c)));

    let killedBy: "timeout" | "abort" | null = null;
    const kill = (why: "timeout" | "abort") => {
      killedBy ??= why;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => kill("timeout"), timeoutMs);
    const onAbort = () => kill("abort");
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    child.on("error", (e) => {
      done();
      reject(new ProcError(`${full[0]}: ${e.message}`));
    });
    child.on("close", (code, sig) => {
      done();
      if (killedBy === "abort") return reject(abortError());
      if (killedBy === "timeout") return reject(new ProcError(`${argv[0]} timed out after ${Math.round(timeoutMs / 1000)} s`, { code: -1, stdout, stderr }));
      resolve({ code: code ?? (sig ? 128 : -1), stdout, stderr });
    });
    child.stdin.on("error", () => {}); // EPIPE if the child exits before reading stdin
    child.stdin.end(input ?? "");
  });
}
