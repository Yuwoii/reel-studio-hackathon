// Environment → typed config for the reel-studio bot. Secrets are read once here and never logged;
// loadConfig() fails fast with the NAMES (never values) of everything missing or invalid.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RenderBackend = "lambda" | "local";
/** Which ReelPipeline the bot runs: v1 (frozen), v2 (ROOT CAUSE storyboards, W6) or v3 (creator scripts + real-object
 *  shots, v3 W6 cut-over: full live pipeline). */
export type PipelineVersion = "v1" | "v2" | "v3";

export interface Config {
  discordToken: string;
  reelsChannelId: string;
  ownerId: string;

  maxJobsPerDay: number;
  maxTurnsPerJob: number;
  render: RenderBackend;
  /** REEL_PIPELINE (default v1; v2 = director v2 + Lambda Explainer; v3 = director v3 + Lambda ExplainerV3 + S2 mix). */
  pipeline: PipelineVersion;

  dataDir: string; // state.json, usage.json, claude/ (SDK transcripts)
  jobsDir: string; // jobs/<jobId>/…
  outDir: string; // out/<slug>.mp4, out/<slug>_script.md

  /** REEL_DATA_JOBS (default off): the honeypot-weekly inbox watcher turns host data packs into draft jobs. */
  dataJobs: boolean;
  /** REEL_INBOX_DIR (default <dataDir>/inbox = /app/data/inbox): producer requests hp-<YYYY-Www>/{request.json,READY}. */
  inboxDir: string;
  /** REEL_HP_PACK_DIR (default /app/honeypot, mounted :ro): sha-pinned packs <YYYY-Www>/{pack.json,facts.txt,…}. */
  hpPackDir: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`missing/invalid env:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** Package root (…/reel-studio), from src/config.ts or dist/src/config.js. */
export const REPO_ROOT = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
})();

type Env = Record<string, string | undefined>;

const SNOWFLAKE = /^\d{15,22}$/;

/**
 * Default runtime dir: /app/<name> inside the container (where /app/<name> exists), else <repo>/<name> for local dev.
 * `appRoot` is injectable for tests.
 */
export function defaultDir(name: string, appRoot = "/app"): string {
  const inContainer = path.join(appRoot, name);
  return existsSync(inContainer) ? inContainer : path.join(REPO_ROOT, name);
}

export function loadConfig(env: Env = process.env, appRoot = "/app"): Config {
  const problems: string[] = [];
  const str = (name: string, fallback = ""): string => {
    const v = env[name];
    return v === undefined || v.trim() === "" ? fallback : v.trim();
  };
  const posInt = (name: string, fallback: number): number => {
    const raw = str(name);
    if (!raw) return fallback;
    const v = Number(raw);
    if (!Number.isInteger(v) || v <= 0) {
      problems.push(`${name} (positive integer, or leave empty for ${fallback})`);
      return fallback;
    }
    return v;
  };

  const discordToken = str("DISCORD_BOT_TOKEN");
  if (!discordToken) problems.push("DISCORD_BOT_TOKEN");
  const reelsChannelId = str("DISCORD_REELS_CHANNEL_ID");
  if (!SNOWFLAKE.test(reelsChannelId)) problems.push("DISCORD_REELS_CHANNEL_ID (numeric snowflake)");
  const ownerId = str("DISCORD_OWNER_ID");
  if (!SNOWFLAKE.test(ownerId)) problems.push("DISCORD_OWNER_ID (numeric snowflake)");

  const renderRaw = str("REEL_RENDER", "lambda").toLowerCase();
  if (renderRaw !== "lambda" && renderRaw !== "local") problems.push("REEL_RENDER (lambda|local)");
  const pipelineRaw = str("REEL_PIPELINE", "v1").toLowerCase();
  if (pipelineRaw !== "v1" && pipelineRaw !== "v2" && pipelineRaw !== "v3") problems.push("REEL_PIPELINE (v1|v2|v3, or leave empty for v1)");

  const dataJobsRaw = str("REEL_DATA_JOBS", "off").toLowerCase();
  const DATA_JOBS_ON = ["on", "true", "1", "yes"];
  const DATA_JOBS_OFF = ["off", "false", "0", "no"];
  if (!DATA_JOBS_ON.includes(dataJobsRaw) && !DATA_JOBS_OFF.includes(dataJobsRaw)) problems.push("REEL_DATA_JOBS (on|off, or leave empty for off)");
  const dataDir = path.resolve(str("DATA_DIR") || defaultDir("data", appRoot));

  const cfg: Config = {
    discordToken,
    reelsChannelId,
    ownerId,
    maxJobsPerDay: posInt("REEL_MAX_JOBS_PER_DAY", 5),
    maxTurnsPerJob: posInt("REEL_MAX_TURNS_PER_JOB", 40),
    render: renderRaw === "local" ? "local" : "lambda",
    pipeline: pipelineRaw === "v2" ? "v2" : pipelineRaw === "v3" ? "v3" : "v1",
    dataDir,
    jobsDir: path.resolve(str("JOBS_DIR") || defaultDir("jobs", appRoot)),
    outDir: path.resolve(str("OUT_DIR") || defaultDir("out", appRoot)),
    dataJobs: DATA_JOBS_ON.includes(dataJobsRaw),
    inboxDir: path.resolve(str("REEL_INBOX_DIR") || path.join(dataDir, "inbox")),
    hpPackDir: path.resolve(str("REEL_HP_PACK_DIR") || defaultDir("honeypot", appRoot)),
  };
  if (problems.length) throw new ConfigError(problems);
  return cfg;
}

/** Env vars whose values must never reach Discord or the logs (whether or not this module uses them). */
export const SECRET_ENV_NAMES = [
  "DISCORD_BOT_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "REMOTION_AWS_ACCESS_KEY_ID",
  "REMOTION_AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "ELEVENLABS_API_KEY",
] as const;

/** Literal secret values present in the environment (≥ 4 chars, so tiny values can't shred normal text). */
export function secretValues(env: Env = process.env): string[] {
  return SECRET_ENV_NAMES.map((n) => (env[n] ?? "").trim()).filter((v) => v.length >= 4);
}
