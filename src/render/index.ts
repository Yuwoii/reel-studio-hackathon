// RenderModule (src/contracts.ts): Remotion Lambda in eu-central-2 by default, local niced render as fallback.
//
// Env (all optional): REEL_RENDER=lambda|local (default lambda), REEL_RENDER_FALLBACK=off (never render locally
// when Lambda is unavailable), REEL_LAMBDA_FUNCTION (override the speculated function name), REEL_SITE_URL
// (override data/site.json from scripts/deploy-site.sh), REMOTION_AWS_ACCESS_KEY_ID/SECRET (from aws.env).
//
// Fallback rule (plan.shouldFallback): only when Lambda is unavailable BEFORE a render started — no site/creds,
// function not found, invalid credentials, invoke throttled. Never after renderMediaOnLambda returned a renderId.
// Pipeline contract: call stageAudio() right before EVERY render() — render() deletes the job's S3 audio when it
// finishes and the presigned URLs only live 2 h.
// Errors leaving this module are sanitized (plan.sanitizeError: one line, presigned URLs/keys/secrets redacted).
// Audio staging falls back to local only for no-site / bad credentials (plan.shouldFallbackStaging), never for an
// S3 throttle — a local render costs ~30 min of NUC 1 CPU.

import path from "node:path";
import { REPO_ROOT, defaultDir } from "../config.js";
import type { Progress, RenderModule, RenderResult, TtsResult } from "../contracts.js";
import type { BeatAudio, ReelProps } from "../schema/index.js";
import { createLambdaBackend, type LambdaBackend } from "./lambda.js";
import { createLocalBackend, type LocalBackend } from "./local.js";
import {
  assertJobId,
  backendFromEnv,
  chooseBackend,
  classifyStartError,
  sanitizeError,
  shouldFallback,
  shouldFallbackStaging,
  shortError,
  type Backend,
} from "./plan.js";
import { resolveServeUrl } from "./site.js";

export * from "./plan.js";
export { AbortError } from "./lambda.js";
export { resolveServeUrl, writeSiteInfo, type SiteInfo } from "./site.js";

export interface RenderModuleOptions {
  backend?: Backend;
  /** Allow the local fallback when Lambda is unavailable (default: REEL_RENDER_FALLBACK !== "off"). */
  fallback?: boolean;
  dataDir?: string;
  jobsDir?: string;
  repoRoot?: string;
  serveUrl?: string | null;
  functionName?: string;
  pollMs?: number;
  localConcurrency?: number;
  log?: (s: string) => void;
  env?: NodeJS.ProcessEnv;
  /** Tests: inject fakes. */
  lambda?: Pick<LambdaBackend, "stageAudio" | "render">;
  local?: Pick<LocalBackend, "stageAudio" | "render">;
}

export interface ExtendedRenderModule extends RenderModule {
  readonly backend: Backend;
  readonly functionName?: string;
}

export function createRenderModule(opts: RenderModuleOptions = {}): ExtendedRenderModule {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const configured = opts.backend ?? backendFromEnv(env.REEL_RENDER);
  const fallback = opts.fallback ?? env.REEL_RENDER_FALLBACK?.trim().toLowerCase() !== "off";
  const dataDir = opts.dataDir ?? defaultDir("data");
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const jobsDir = opts.jobsDir ?? defaultDir("jobs");

  let realLambda: LambdaBackend | undefined;
  const lambda =
    opts.lambda ??
    (realLambda = createLambdaBackend({
      serveUrl: opts.serveUrl !== undefined ? opts.serveUrl : resolveServeUrl(env, dataDir),
      functionName: opts.functionName,
      pollMs: opts.pollMs,
      log,
      env,
    }));
  const local = opts.local ?? createLocalBackend({ repoRoot, jobsDir: path.resolve(jobsDir), concurrency: opts.localConcurrency, log });

  async function stageAudio(jobId: string, tts: TtsResult): Promise<BeatAudio[]> {
    assertJobId(jobId);
    if (configured === "local") return local.stageAudio(jobId, tts).catch((e) => Promise.reject(sanitizeError(e)));
    try {
      return await lambda.stageAudio(jobId, tts);
    } catch (e) {
      // No site / bad credentials → stage locally; chooseBackend() then forces a local render.
      if (!shouldFallbackStaging(e, fallback)) throw sanitizeError(e);
      log(`lambda unavailable for audio staging (${classifyStartError(e)}: ${shortError(String((e as Error).message))}) → staging locally`);
      return local.stageAudio(jobId, tts).catch((e2) => Promise.reject(sanitizeError(e2)));
    }
  }

  async function render(jobId: string, props: ReelProps, outFile: string, onProgress?: Progress, signal?: AbortSignal): Promise<RenderResult> {
    assertJobId(jobId);
    const backend = chooseBackend(configured, props.audio);
    if (backend === "local") return local.render(jobId, props, outFile, onProgress, signal).catch((e) => Promise.reject(sanitizeError(e)));
    let started = false;
    try {
      return await lambda.render(jobId, props, outFile, onProgress, signal, () => (started = true));
    } catch (e) {
      if (signal?.aborted || !shouldFallback(e, started, fallback)) throw sanitizeError(e);
      log(`lambda unavailable (${classifyStartError(e)}: ${shortError(String((e as Error).message))}) → local render`);
      onProgress?.("render", "Lambda unavailable — rendering locally", 0);
      return local.render(jobId, props, outFile, onProgress, signal).catch((e2) => Promise.reject(sanitizeError(e2)));
    }
  }

  return { backend: configured, functionName: realLambda?.functionName, stageAudio, render };
}
