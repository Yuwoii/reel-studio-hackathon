// How v2 audio code reaches ffmpeg/ffprobe. In production the code runs INSIDE the reel-studio container and calls the
// container's ffmpeg 5.1 directly. On the host (dev CLI, research) the host ffmpeg is 6.1, which accepts graphs that 5.1
// rejects, so dev runs go through a THROWAWAY container from the same image instead:
//
//   docker run --rm --user 1000:1000 --entrypoint nice -v <root>:/w -w /w reel-studio:local -n 19 ffmpeg …
//
// (never `docker exec` into, or restart, the live `reel-studio` container). Host paths under <root> are rewritten to
// /w/…; anything else is refused, because the throwaway container cannot see it. Filter graphs never carry paths (inputs
// are `-i` args and graphs go through -filter_complex_script), so argv rewriting is enough.
//
// Selection: ffExecFromEnv() → REEL_V2_FF=docker|direct (default direct, i.e. production behaviour).

import path from "node:path";
import { run, type RunOptions, type RunResult } from "../proc.js";

export type Runner = (argv: string[], opts?: RunOptions) => Promise<RunResult>;

export interface FfExec {
  readonly kind: "direct" | "docker";
  /** argv prefix that runs ffmpeg (args follow). */
  readonly ffmpeg: readonly string[];
  readonly ffprobe: readonly string[];
  /** Pass to run(): nice the process on the host (direct) — docker niceness is applied inside the container. */
  readonly nice: boolean;
  /** Host path → the path ffmpeg sees. Identity for direct. Throws when the path is not visible to ffmpeg. */
  mapPath(p: string): string;
  /** Rewrites every absolute path argument with mapPath. */
  mapArgs(args: readonly string[]): string[];
  run: Runner;
}

export const DEV_IMAGE = "reel-studio:local";
export const CONTAINER_ROOT = "/w";

export function directExec(opts: { ffmpeg?: string; ffprobe?: string; run?: Runner } = {}): FfExec {
  return {
    kind: "direct",
    ffmpeg: [opts.ffmpeg ?? "ffmpeg"],
    ffprobe: [opts.ffprobe ?? "ffprobe"],
    nice: true,
    mapPath: (p) => p,
    mapArgs: (a) => [...a],
    run: opts.run ?? run,
  };
}

export interface DockerExecOptions {
  /** Host directory mounted at /w (read-write: outputs are written there). */
  root: string;
  image?: string;
  /** CPU / memory cap of the throwaway container (NUC 1 runs live services). */
  cpus?: string;
  memory?: string;
  run?: Runner;
}

/** argv prefix for a throwaway container running `tool` (ffmpeg | ffprobe) at nice 19, no network, read-only rootfs. */
export function dockerArgv(o: DockerExecOptions, tool: "ffmpeg" | "ffprobe"): string[] {
  const root = path.resolve(o.root);
  return [
    "docker", "run", "--rm",
    "--user", "1000:1000",
    "--network", "none",
    "--read-only",
    "--cpus", o.cpus ?? "2",
    "--memory", o.memory ?? "1g",
    "--entrypoint", "nice",
    "-v", `${root}:${CONTAINER_ROOT}`,
    "-w", CONTAINER_ROOT,
    o.image ?? DEV_IMAGE,
    "-n", "19", tool,
  ];
}

export function dockerExec(o: DockerExecOptions): FfExec {
  const root = path.resolve(o.root);
  const mapPath = (p: string) => {
    const abs = path.resolve(p);
    if (abs === root) return CONTAINER_ROOT;
    if (abs.startsWith(root + path.sep)) return CONTAINER_ROOT + "/" + abs.slice(root.length + 1).split(path.sep).join("/");
    throw new Error(`ffexec: ${p} is outside ${root} (the throwaway container cannot see it)`);
  };
  return {
    kind: "docker",
    ffmpeg: dockerArgv(o, "ffmpeg"),
    ffprobe: dockerArgv(o, "ffprobe"),
    nice: false,
    mapPath,
    mapArgs: (args) => args.map((a) => (a.startsWith("/") ? mapPath(a) : a)),
    run: o.run ?? run,
  };
}

/** REEL_V2_FF=docker → throwaway container rooted at REEL_V2_FF_ROOT (default: cwd); otherwise direct. */
export function ffExecFromEnv(env: NodeJS.ProcessEnv = process.env, fallbackRoot = process.cwd()): FfExec {
  if ((env.REEL_V2_FF ?? "").trim() === "docker") return dockerExec({ root: env.REEL_V2_FF_ROOT?.trim() || fallbackRoot, image: env.REEL_V2_FF_IMAGE?.trim() || undefined });
  return directExec({ ffmpeg: env.REEL_FFMPEG?.trim() || undefined, ffprobe: env.REEL_FFPROBE?.trim() || undefined });
}

/** Run ffmpeg with `args` (host paths are mapped). Rejects on a non-zero exit (stderr tail in the message). */
export function ffmpeg(x: FfExec, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  return x.run([...x.ffmpeg, "-hide_banner", "-nostdin", "-nostats", ...x.mapArgs(args)], { maxBuffer: 32 * 1024 * 1024, timeoutMs: 10 * 60_000, ...opts, nice: x.nice });
}

export function ffprobe(x: FfExec, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  return x.run([...x.ffprobe, ...x.mapArgs(args)], { timeoutMs: 60_000, ...opts, nice: false });
}
