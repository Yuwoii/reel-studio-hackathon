// v3 DIRECTOR (W4), beside v2 (src/director/v2/, live, untouched). Same isolation as v2's buildOptions (copied, not
// imported-and-mutated): the owner's subscription (CLAUDE_CODE_OAUTH_TOKEN), only server-side WebSearch as a builtin,
// every other builtin disallowed, one in-process MCP server "reel" with the job-bound v3 tools (tools.ts),
// strictMcpConfig, no settings / skills / CLAUDE.md, canUseTool default-deny (makeCanUseToolV3), minimal env, fixed
// cwd + CLAUDE_CONFIG_DIR.
//
// This wave is DRY: no render. A run ends at save_job (tools.ts saveJobDry). W4.5: the board's FRAME SELF-CHECK
// (frames.ts) renders Lambda stills on a reel-studio-v3-* dev site — only when the caller injects a renderer
// (opts.frames.render, e.g. scripts/v3/dry-director.ts after checking the site hash); without one every accepted board
// carries a red "frames: NOT RUN" badge. The vision judge defaults to the real one (owner's subscription) unless the
// SDK is stubbed. Lambda $ counts against REEL_V3_MAX_USD_PER_JOB together with the notional $. One nudge on the same session
// when a run ends without save_job (never more: the subscription is shared with the live bots). Turns, notional $ and
// judge spend are booked into director-v3.json so W4 can measure turns and $ per job (ADR-002 §10 W4 exit).

import { authEnv, defaultToken } from "../../auth.js";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { BUILTIN_TOOL_NAMES, query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildSystemPromptV3, dataPackAppendix, draftPromptV3, revisePromptV3 } from "./prompt.js";
import { DataPackError, loadJobDataPack, seedDataPackPage, type LoadedDataPack } from "./dataPack.js";
import { assetIndexV3, buildMcpServerV3, buildToolSpecsV3, emptyStateV3, FILES, loadStateV3, makeCanUseToolV3, PROMPT_TOOL_RENAMES, REEL_MCP_SERVER_NAME, saveStateV3, WEB_SEARCH_TOOL, atLeast, type BoardJudge, type DecisionV3, type DirectorV3State, type RunRecordV3, type ToolContextV3, type ToolSpecV3, type TtsFn } from "./tools.js";
import type { ScriptGateArgs, ScriptGateReport } from "./writer.js";
import { runBoardJudges, type BoardJudgeName } from "./critic.js";
import type { JudgeRunArgs } from "./claims.js";
import { viewerCardWarnings } from "./nontech.js";
import { visionFrameJudge, type FrameCheckDeps, type FrameJudge, type FrameStillRenderer } from "./frames.js";
import type { SafeFetchOptions } from "../webfetch.js";
import { loadLedger } from "../v2/research.js";
import type { AssetManifestT, AssetPolicyT } from "../../v3/assets/manifest.js";
import type { V3LintOptions } from "../../v3/lints.js";
import type { V3TtsOptions } from "../../v3/tts.js";

export const DEFAULT_MODEL_V3 = "claude-sonnet-5-5";
/** W4 caps, reset from the 2026-11-03 dry runs (tls 52 / watch-hr 42 / anc 37 turns; $4.27 / $2.02 / $2.51 notional incl. judges): ≈ 1.5× the worst run. */
export const DEFAULT_MAX_TURNS_V3 = 80;
export const DEFAULT_MAX_USD_V3 = 6;
export const MIN_TURNS_TO_START_V3 = 2;
export const SESSION_RETENTION_DAYS_V3 = 90;

export class DirectorV3Error extends Error {
  constructor(
    message: string,
    readonly code: "budget" | "invalid" | "no_save" | "sdk" | "aborted" | "auth",
  ) {
    super(message);
    this.name = "DirectorV3Error";
  }
}

/** Injectable SDK entry point (tests drive the tools without a model call). */
export type QueryImplV3 = (args: { prompt: string; options: Options }, tools: ToolSpecV3[]) => AsyncIterable<SDKMessage>;

export interface DirectorV3Options {
  jobsDir: string;
  dataDir: string;
  model?: string;
  maxTurnsPerJob?: number;
  maxUsdPerJob?: number;
  oauthToken?: string;
  env?: NodeJS.ProcessEnv;
  log?: (l: string) => void;
  queryImpl?: QueryImplV3;
  /** tool dependencies (defaults: the real W1 engine, edge-tts, the generated registry) */
  scriptGates?: (a: ScriptGateArgs) => Promise<ScriptGateReport>;
  judgeModel?: string;
  tts?: TtsFn;
  ttsOptions?: Partial<V3TtsOptions>;
  boardJudges?: readonly BoardJudge[];
  fetch?: SafeFetchOptions;
  assets?: readonly AssetManifestT[];
  policy?: AssetPolicyT;
  assetRoot?: string;
  lintOptions?: Partial<V3LintOptions>;
  requireReadSources?: boolean;
  today?: Date;
  /** W4.5 frame self-check: the still renderer (null/absent = NOT RUN badge, with `unavailable` as the reason), the
   *  vision judge (default: the real one, unless queryImpl is stubbed), and the still cap */
  frames?: { render: FrameStillRenderer | null; judge?: FrameJudge | null; unavailable?: string; maxStills?: number };
}

/** Per-run options of draft / revise. */
export interface RunOptionsV3 {
  /** DATA JOBS: the job's dataPack.sha256 (store.ts Job.dataPack): datapack.json must exist and hash to it */
  dataPackSha?: string;
}

export interface DirectorV3Result {
  jobId: string;
  jobDir: string;
  saved: boolean;
  stage: DirectorV3State["stage"];
  badges: string[];
  turns: number;
  costUsd: number;
  judgeTurns: number;
  judgeUsd: number;
  wallSec: number;
  runs: number;
  lastErrors: string[];
  notes: string[];
  text: string;
  sessionId?: string;
}

function envNum(env: NodeJS.ProcessEnv, name: string, fallback: number, int = true): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 && (!int || Number.isInteger(n)) ? n : fallback;
}

/**
 * The W4 board judges as ONE injected BoardJudge (tools.ts submit_storyboard_v3 calls it after the lints pass):
 * physics on the board (code BP1–BP5, then Opus ×3) → edit critic (code CR1/CR2 + lints, then Sonnet ×3) →
 * non-technical viewer on the board (×3). Each judge's LLM votes are skipped when its own code checks block, and the
 * later judges are skipped once one blocks (critic.ts runBoardJudges), so a broken board costs $0. tools.ts allows
 * ≤ MAX_BOARD_JUDGE_REFUSALS (2) refused rounds per job, then the board goes on with a red "board:" badge.
 */
export function boardJudgesV3(a: Pick<JudgeRunArgs, "claudeDir" | "oauthToken" | "env" | "log" | "queryImpl"> & { only?: readonly BoardJudgeName[]; votes?: number }): BoardJudge[] {
  return [
    async (i) => {
      const r = await runBoardJudges({ ...a, signal: i.signal, sb: i.storyboard, words: i.words, point: i.narrative.point, ...(a.only ? { only: a.only } : {}), ...(a.votes ? { votes: a.votes } : {}) });
      const findings = r.gaps
        .filter((g) => g.severity !== "warn")
        .map((g) => ({ ...(g.beats?.length ? { beat: g.beats.join(",") } : {}), problem: `[${g.gate} ${g.code}] ${g.message}`.slice(0, 600), ...(g.hint ? { hint: g.hint.slice(0, 300) } : {}) }));
      const verdict = (x: { ok: boolean } | null) => (x ? (x.ok ? "pass" : "FAIL") : "not run");
      a.log?.(`board judges: physics ${verdict(r.physics)}, critic ${verdict(r.critic)}, nontech ${verdict(r.nontech)}; $${r.costUsd.toFixed(4)}`);
      return {
        gate: "board",
        ok: r.ok,
        findings,
        // the viewer's "might scroll" + non-unanimous "lost" points warn (owner rulings 2026-11-03) and go on the card
        warnings: viewerCardWarnings(r.gaps),
        turns: r.spend.reduce((t, s) => t + s.turns, 0),
        costUsd: r.costUsd,
        detail: {
          physics: r.physics && { ok: r.physics.ok, gaps: r.physics.gaps },
          critic: r.critic && { ok: r.critic.ok, gaps: r.critic.gaps, metrics: r.critic.metrics, skippedLlm: r.critic.skippedLlm },
          nontech: r.nontech && { ok: r.nontech.ok, gaps: r.nontech.gaps, restatements: (r.nontech.result?.viewers ?? []).map((v) => (v as { restatement?: string } | null)?.restatement ?? null) },
          warnings: r.gaps.filter((g) => g.severity === "warn"),
          spend: r.spend,
        },
      };
    },
  ];
}

/** Frame-check deps for a job: the injected renderer; the injected judge, else the real vision judge — but never behind
 *  a stubbed SDK. The still cap from REEL_V3_FRAME_STILLS_MAX (4–24) unless given. */
export function resolveFrameDepsV3(opts: Pick<DirectorV3Options, "frames" | "queryImpl" | "dataDir">, a: { token: string; env: NodeJS.ProcessEnv; log?: (l: string) => void }): FrameCheckDeps {
  const f = opts.frames;
  const envMax = Number(a.env.REEL_V3_FRAME_STILLS_MAX);
  const maxStills = f?.maxStills ?? (Number.isInteger(envMax) && envMax >= 4 && envMax <= 24 ? envMax : undefined);
  const judge = f?.judge !== undefined ? f.judge : opts.queryImpl ? null : visionFrameJudge({ claudeDir: path.join(path.resolve(opts.dataDir), "judge-v3-frames"), oauthToken: a.token, env: a.env, log: a.log });
  return { render: f?.render ?? null, judge, unavailable: f?.render ? undefined : (f?.unavailable ?? "no still renderer configured"), ...(maxStills ? { maxStills } : {}) };
}

/** The W1 prompt with the W4 tool names and this wave's dry-run rule; a DATA job appends DATA_PACK_APPENDIX (a job
 *  without a pack gets exactly the prompt it always got). */
export function systemPromptV3(o: { today?: Date; track?: "how-it-works" | "root-cause"; assets?: readonly AssetManifestT[]; policy?: AssetPolicyT; dataPack?: LoadedDataPack | null } = {}): string {
  const base = systemPromptBaseV3(o);
  return o.dataPack ? `${base}\n\n${dataPackAppendix(o.dataPack.pack)}` : base;
}

function systemPromptBaseV3(o: { today?: Date; track?: "how-it-works" | "root-cause"; assets?: readonly AssetManifestT[]; policy?: AssetPolicyT }): string {
  let p = buildSystemPromptV3({ today: o.today, track: o.track, assetIndex: assetIndexV3(o.assets, o.policy) });
  for (const [from, to] of Object.entries(PROMPT_TOOL_RENAMES)) p = p.replace(new RegExp(`\\b${from}\\b(?!_v3)`, "g"), to);
  return `${p}\n\nTHIS RUN IS DRY (no render): render_stills and view_stills do not exist — submit_storyboard_v3 does the stills for you. After the lints and the board judges pass, it renders REAL stills of your board (the first frame, each beat's settled frame, late frames in long holds) and a fresh vision judge checks that each beat's picture SHOWS what its line says (missing or leftover objects, a picture that contradicts the line, cut-off or unreadable text the line is about, empty panels, nothing changing across a mechanism stretch). A background object cut by the frame edge on a wide shot is fine. Findings come back as a refusal naming the beats and their still paths: open a still with view_asset({ref: "frames/…jpg"}), fix those pictures and submit again — you get ONE fix round; beats that still fail are saved with a red "frames:" badge. When the board is accepted, read its digest as the viewer, fix what it shows wrong, then save_job. save_job takes notes only (no review object). Board format: call example_board once for the owner-accepted S2 board (a complete v3.0 board) and describe_component for the parts you use; build your own pictures for your own narrative. After the lints, fresh board judges check the board (physics: does every picture tell the voice's truth, at that moment, with consistent lock/box states; critic: size, dead stretches, cuts; a non-technical viewer — where they get lost blocks, where they only "might scroll" is a warning on the card); a refusal names beats — fix those pictures and submit again. Research and register sources BEFORE submit_script; the script you finally keep always gets a fact check whose verdict is on the card. Tools: search_assets, view_asset, list_components, describe_component, example_board, web_fetch, submit_script, synthesize_tts, submit_storyboard_v3, request_asset, save_job (and WebSearch).`;
}

/** Board judges for a job: injected ones, else the real W4 judges — but never behind a stubbed SDK (tests drive the tools without a model). */
export function resolveBoardJudgesV3(opts: Pick<DirectorV3Options, "boardJudges" | "queryImpl" | "dataDir">, a: { token: string; env: NodeJS.ProcessEnv; log?: (l: string) => void }): readonly BoardJudge[] {
  if (opts.boardJudges) return opts.boardJudges;
  if (opts.queryImpl) return [];
  return boardJudgesV3({ claudeDir: path.join(path.resolve(opts.dataDir), "judge-v3-board"), oauthToken: a.token, env: a.env, log: a.log });
}

/**
 * The SDK's own maxBudgetUsd for one run. A fresh session counts only its own spend → the cap minus everything booked
 * (earlier runs + judges). A RESUMED session reports (and limits on) the cumulative session cost, which already holds
 * the earlier director runs → subtract only the non-director spend (judges), or the earlier director $ counts twice.
 * Note: judge $ is booked live (ctx.budget), director $ only arrives on the result message, so within one run the
 * two caps are independent and director + judges can reach up to ≈ 2× the per-job cap (notional $; the turn cap binds
 * first in every W4 run).
 */
export function sdkBudgetUsd(usdCap: number, start: Pick<DirectorV3State, "costUsd" | "runs">, resumed: boolean): number {
  const directorUsd = start.runs.reduce((t, r) => t + r.costUsd, 0);
  const limit = resumed ? usdCap - Math.max(0, start.costUsd - directorUsd) : usdCap - start.costUsd;
  return Math.max(0.01, Math.round(limit * 1e4) / 1e4);
}

export function createDirectorV3(opts: DirectorV3Options) {
  const env = opts.env ?? process.env;
  const model = opts.model ?? (env.REEL_V3_MODEL?.trim() || env.REEL_MODEL?.trim() || DEFAULT_MODEL_V3);
  const turnCap = opts.maxTurnsPerJob ?? envNum(env, "REEL_V3_MAX_TURNS_PER_JOB", DEFAULT_MAX_TURNS_V3);
  const usdCap = opts.maxUsdPerJob ?? envNum(env, "REEL_V3_MAX_USD_PER_JOB", DEFAULT_MAX_USD_V3, false);
  const token = opts.oauthToken ?? defaultToken(env);
  const claudeDir = path.join(path.resolve(opts.dataDir), "claude-v3");
  const workDir = path.join(path.resolve(opts.dataDir), "work");
  const log = opts.log ?? ((l: string) => console.log(`[director-v3] ${l}`));
  const queryImpl: QueryImplV3 = opts.queryImpl ?? ((args) => query(args));
  const jobDirFor = (jobId: string) => path.join(path.resolve(opts.jobsDir), jobId.replace(/[^\w.-]/g, "_"));

  function buildOptions(jobDir: string, maxTurns: number, extra: Partial<Options> = {}, researchOpen?: () => boolean, budget?: () => string | null, onDecision?: (d: DecisionV3) => void, dataPack?: LoadedDataPack | null): Options {
    const allowedBuiltins = [WEB_SEARCH_TOOL];
    return {
      model,
      maxTurns,
      cwd: workDir,
      systemPrompt: systemPromptV3({ today: opts.today, assets: opts.assets, policy: opts.policy, ...(dataPack ? { dataPack } : {}) }),
      tools: allowedBuiltins,
      disallowedTools: BUILTIN_TOOL_NAMES.filter((t) => !allowedBuiltins.includes(t)),
      strictMcpConfig: true,
      // No allowedTools on purpose: allow rules would short-circuit canUseTool; every call goes through it.
      canUseTool: makeCanUseToolV3({ researchOpen, budget, onDecision: (d) => (log(`canUseTool ${d.decision} ${d.tool} (${d.why.slice(0, 80)})`), onDecision?.(d)), ...(dataPack ? { dataTools: true } : {}) }),
      permissionMode: "default",
      settingSources: [],
      skills: [],
      persistSession: true,
      settings: { cleanupPeriodDays: SESSION_RETENTION_DAYS_V3 },
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        ...authEnv(token, claudeDir),
        TMPDIR: env.TMPDIR ?? "/tmp",
        CLAUDE_AGENT_SDK_CLIENT_APP: "reel-studio-director-v3/0.4.0",
        DISABLE_AUTOUPDATER: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1",
      },
      stderr: (d) => {
        const line = String(d).replace(/sk-ant-[\w-]+/g, "[REDACTED]").trim();
        if (line) log(`[claude] ${line.slice(0, 300)}`);
      },
      ...extra,
    };
  }

  async function runOnce(jobId: string, prompt: string, resume: string | undefined, signal: AbortSignal | undefined, run: RunOptionsV3 = {}) {
    if (!token) throw new DirectorV3Error("CLAUDE_CODE_OAUTH_TOKEN is not set (the director uses the owner's subscription)", "auth");
    const jobDir = jobDirFor(jobId);
    await mkdir(jobDir, { recursive: true });
    // DATA JOBS: datapack.json (the verified pack.json bytes) is re-verified on every run and its facts page re-seeded;
    // a wrong pack fails the run closed. No file (and no expected sha) = a normal job, unchanged.
    let dataPack: LoadedDataPack | null = null;
    try {
      dataPack = await loadJobDataPack(jobDir, run.dataPackSha);
    } catch (e) {
      throw new DirectorV3Error(`data pack refused (${e instanceof DataPackError ? e.code : "HP_SCHEMA"}): ${String((e as Error)?.message ?? e).slice(0, 200)}`, "invalid");
    }
    if (dataPack) {
      await seedDataPackPage(jobDir, dataPack);
      log(`${jobId}: data pack ${dataPack.pack.weekKey} sha ${dataPack.sha256.slice(0, 8)} (${dataPack.pack.facts.length} facts)`);
    }
    await mkdir(claudeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    const loaded = await loadStateV3(jobDir);
    const start: DirectorV3State = loaded.createdAt ? loaded : { ...emptyStateV3(), ...loaded, createdAt: new Date().toISOString() };
    const left = turnCap - start.turnsUsed;
    if (left < MIN_TURNS_TO_START_V3) throw new DirectorV3Error(`turn budget exhausted for ${jobId} (${start.turnsUsed}/${turnCap})`, "budget");
    if (start.costUsd >= usdCap) throw new DirectorV3Error(`notional $ cap reached for ${jobId} ($${start.costUsd.toFixed(2)} of $${usdCap.toFixed(2)})`, "budget");
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const record: RunRecordV3 = { lastErrors: [], notes: [], judgeTurns: 0, judgeUsd: 0 };
    let liveTurns = 0;
    const ctx: ToolContextV3 = {
      jobId,
      jobDir,
      state: start,
      record,
      assets: opts.assets,
      policy: opts.policy,
      assetRoot: opts.assetRoot,
      scriptGates: opts.scriptGates,
      judgeArgs: { claudeDir: path.join(path.resolve(opts.dataDir), "judge-v3"), oauthToken: token, model: opts.judgeModel, env },
      tts: opts.tts,
      ttsOptions: opts.ttsOptions,
      // default: the real W4 board judges — but never behind a stubbed SDK (tests drive the tools without a model)
      boardJudges: resolveBoardJudgesV3(opts, { token, env, log }),
      frames: resolveFrameDepsV3(opts, { token, env, log }),
      budgetLeftUsd: () => usdCap - (start.costUsd + record.judgeUsd + (record.lambdaUsd ?? 0)),
      fetch: opts.fetch,
      research: await loadLedger(jobDir),
      requireReadSources: opts.requireReadSources,
      lintOptions: opts.lintOptions,
      log,
      signal: abort.signal,
      budget: () => {
        if (liveTurns >= left) return `turn cap reached (${start.turnsUsed + liveTurns}/${turnCap})`;
        const spent = start.costUsd + record.judgeUsd + (record.lambdaUsd ?? 0);
        return spent >= usdCap ? `notional $ cap reached ($${spent.toFixed(2)} of $${usdCap.toFixed(2)})` : null;
      },
      researchOpen: () => !atLeast(ctx.state, "boarded"),
      ...(dataPack ? { dataPack } : {}),
    };
    const specs = buildToolSpecsV3(ctx);
    await saveStateV3(jobDir, start);
    const options = buildOptions(
      jobDir,
      left,
      { abortController: abort, mcpServers: { [REEL_MCP_SERVER_NAME]: buildMcpServerV3(specs) }, maxBudgetUsd: sdkBudgetUsd(usdCap, start, !!resume), ...(resume ? { resume } : {}) },
      () => ctx.researchOpen?.() ?? true,
      () => ctx.budget?.() ?? null,
      undefined,
      dataPack,
    );
    const out = { text: "", turns: 0, costUsd: 0, subtype: "no_result", sessionId: resume as string | undefined, capHit: undefined as string | undefined };
    let sawResult = false;
    let thrown: unknown;
    const t0 = Date.now();
    try {
      for await (const msg of queryImpl({ prompt, options }, specs)) {
        const sid = (msg as { session_id?: string }).session_id;
        if (sid) out.sessionId = sid;
        if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
          liveTurns++;
          const blocks = (msg.message?.content ?? []) as Array<{ type: string; text?: string; name?: string }>;
          const texts = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text as string);
          if (texts.length) out.text = texts.join("\n");
          for (const b of blocks) if (b.type === "tool_use" && b.name) log(`tool_use ${b.name}`);
          const cap = ctx.budget?.() ?? null;
          if (cap && !out.capHit) {
            out.capHit = cap;
            abort.abort();
          }
        } else if (msg.type === "result") {
          sawResult = true;
          out.turns = msg.num_turns ?? 0;
          out.costUsd = msg.total_cost_usd ?? 0;
          out.subtype = msg.subtype;
          if (msg.subtype === "success" && msg.result) out.text = msg.result;
        }
        if (out.capHit && abort.signal.aborted) break;
      }
    } catch (e) {
      thrown = e; // the SDK may throw after delivering its result — book what we saw
    } finally {
      signal?.removeEventListener("abort", onAbort);
      out.turns = Math.max(out.turns, liveTurns, !sawResult && (thrown || out.capHit) ? 1 : 0);
      // a resumed session reports cumulative $: book only this run's share
      const prevSession = resume ? start.runs.reduce((t, r) => t + r.costUsd, 0) : 0;
      const own = resume && out.costUsd >= prevSession ? out.costUsd - prevSession : out.costUsd;
      const wallSec = (Date.now() - t0) / 1000;
      ctx.state = {
        ...ctx.state,
        turnsUsed: ctx.state.turnsUsed + out.turns,
        costUsd: ctx.state.costUsd + own + record.judgeUsd + (record.lambdaUsd ?? 0),
        runs: [...ctx.state.runs, { at: new Date().toISOString(), turns: out.turns, costUsd: own, subtype: out.capHit ? "cap" : signal?.aborted ? "aborted" : thrown && !sawResult ? "error" : out.subtype, saved: !!record.saved, wallSec }],
        ...(out.sessionId ? { sessionId: out.sessionId } : {}),
      };
      await saveStateV3(jobDir, ctx.state);
    }
    if (signal?.aborted) throw new DirectorV3Error("aborted", "aborted");
    if (record.fatal) throw new DirectorV3Error(`director could not produce a valid job: ${record.fatal}`, "invalid");
    if (thrown && !sawResult && !out.capHit) throw new DirectorV3Error(`director SDK error: ${String((thrown as Error)?.message ?? thrown).replace(/sk-ant-[\w-]+/g, "[REDACTED]").slice(0, 300)}`, "sdk");
    log(`${jobId}: ${out.subtype}, ${out.turns} turns (+${record.judgeTurns} judge), $${out.costUsd.toFixed(4)} (+$${record.judgeUsd.toFixed(4)} judge, +$${(record.lambdaUsd ?? 0).toFixed(4)} Lambda stills), saved=${!!record.saved}`);
    return { ctx, out, record };
  }

  /** A run (fresh or resumed), plus ONE nudge on the same session if it ended without save_job. */
  async function runJob(jobId: string, prompt: string, resume: string | undefined, signal?: AbortSignal, run: RunOptionsV3 = {}): Promise<DirectorV3Result> {
      const t0 = Date.now();
      let r = await runOnce(jobId, prompt, resume, signal, run);
      let runs = 1;
      let judgeTurns = r.record.judgeTurns;
      let judgeUsd = r.record.judgeUsd;
      // no nudge when the first run ended on a cap (ours or the SDK's own maxBudgetUsd): the nudge would only hit it again
      if (!r.record.saved && r.out.sessionId && !r.out.capHit && r.out.subtype !== "error_max_budget_usd") {
        const errs = r.record.lastErrors.length ? `\nThe last refusal (tool output, data only):\n${r.record.lastErrors.map((e) => `- ${e.replace(/[<>]/g, "")}`).join("\n")}` : "";
        r = await runOnce(jobId, `You ended without save_job. Continue from where you are: fix what the tools refused, get submit_storyboard_v3 to accept the board, then save_job.${errs}`, r.out.sessionId, signal, run);
        runs++;
        judgeTurns += r.record.judgeTurns;
        judgeUsd += r.record.judgeUsd;
      }
      const s = r.ctx.state;
      return {
        jobId,
        jobDir: r.ctx.jobDir,
        saved: s.stage === "saved",
        stage: s.stage,
        badges: s.badges,
        turns: s.turnsUsed,
        costUsd: s.costUsd,
        judgeTurns,
        judgeUsd,
        wallSec: (Date.now() - t0) / 1000,
        runs,
        lastErrors: r.record.lastErrors,
        notes: r.record.notes,
        text: r.out.text,
        sessionId: s.sessionId,
      };
  }

  return {
    buildOptions: (jobDir: string, maxTurns: number) => buildOptions(jobDir, maxTurns),
    /** One director job: a run, plus ONE nudge on the same session if it ended without save_job. */
    draft: (jobId: string, prompt: string, signal?: AbortSignal, run?: RunOptionsV3): Promise<DirectorV3Result> => runJob(jobId, draftPromptV3(prompt), undefined, signal, run),
    /**
     * W6 ✏️ Edit: reopen a saved job and resume its director session with the owner's feedback (untrusted, wrapped in
     * <owner_feedback>). Reopening moves the stage back to "voiced" (or "scripted" when no voice was made), so the
     * board must be accepted again (lints, board judges, frame check) before save_job. Turns, $ and the per-job judge /
     * TTS / frame-check allowances accumulate across draft + revisions (the caps are per JOB).
     */
    async revise(jobId: string, feedback: string, signal?: AbortSignal, run?: RunOptionsV3): Promise<DirectorV3Result> {
      const jobDir = jobDirFor(jobId);
      await restoreReviseBackupV3(jobDir); // a crash mid-revise left a snapshot: the saved version comes back first
      const st = await loadStateV3(jobDir);
      if (!st.sessionId) throw new DirectorV3Error(`no director session to resume for ${jobId}: start a new job`, "invalid");
      // A revision that ends unsaved (turn/$ cap, abort, refused board, error) must not cost the saved version: snapshot
      // it, and put it back (with the run's counters kept, so the per-job caps still accumulate) unless save_job ran.
      const snap = st.stage === "saved" ? await snapshotForReviseV3(jobDir) : false;
      if (atLeast(st, "boarded")) await saveStateV3(jobDir, { ...st, stage: st.voicedHash ? "voiced" : "scripted" });
      let r: DirectorV3Result | undefined;
      try {
        r = await runJob(jobId, revisePromptV3(feedback), st.sessionId, signal, run);
        return r;
      } finally {
        if (snap) {
          if (r?.saved) await rm(path.join(jobDir, REVISE_BACKUP_DIR_V3), { recursive: true, force: true }).catch(() => undefined);
          else if (await restoreReviseBackupV3(jobDir).catch((e: unknown) => (log(`${jobId}: restoring the saved version after a failed revise failed: ${String((e as Error)?.message ?? e)}`), false))) {
            log(`${jobId}: revise ended unsaved — the previously saved version was restored`);
          }
        }
      }
    },
  };
}

// ── ✏️ revise snapshot ───────────────────────────────────────────────────────────────────────────────────────────

/** Snapshot of the saved job taken before a revise reopens it (job-dir relative). */
export const REVISE_BACKUP_DIR_V3 = ".revise-backup";
/** The job artifacts a revise may rewrite (all of FILES) + the voice the words point at. frames/ is append-only (new
 *  checks get new still names), so frames.v3.json alone brings the saved check back. */
const SNAPSHOT_FILES_V3: readonly string[] = Object.values(FILES);
const SNAPSHOT_DIRS_V3: readonly string[] = ["voice"];
/** State fields that describe the saved artifacts (restored); every other field — turns, $, judge / TTS / frame-check
 *  counters, runs, the session — is kept from the failed revision, so a failed ✏️ never refunds a per-job cap. */
const ARTIFACT_STATE_KEYS_V3 = ["stage", "badges", "warnings", "factCheck", "scriptHash", "voicedHash", "boardHash", "boardScriptHash", "framesBoardHash"] as const;

export async function snapshotForReviseV3(jobDir: string): Promise<boolean> {
  const dir = path.join(jobDir, REVISE_BACKUP_DIR_V3);
  const tmp = `${dir}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  for (const f of SNAPSHOT_FILES_V3) if (existsSync(path.join(jobDir, f))) await cp(path.join(jobDir, f), path.join(tmp, f));
  for (const d of SNAPSHOT_DIRS_V3) if (existsSync(path.join(jobDir, d))) await cp(path.join(jobDir, d), path.join(tmp, d), { recursive: true });
  await rm(dir, { recursive: true, force: true });
  await cp(tmp, dir, { recursive: true });
  await rm(tmp, { recursive: true, force: true });
  return true;
}

/** Put a revise snapshot back (if one exists and the job is not saved now): artifacts as they were when saved,
 *  counters as they are now. */
export async function restoreReviseBackupV3(jobDir: string): Promise<boolean> {
  const dir = path.join(jobDir, REVISE_BACKUP_DIR_V3);
  if (!existsSync(path.join(dir, FILES.state))) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return false;
  }
  const now = await loadStateV3(jobDir);
  if (now.stage === "saved") {
    // the revision reached save_job (e.g. it threw afterwards, or a crash before the snapshot was dropped): keep it
    await rm(dir, { recursive: true, force: true });
    return false;
  }
  const saved = await loadStateV3(dir);
  for (const f of SNAPSHOT_FILES_V3) {
    if (f === FILES.state) continue;
    const src = path.join(dir, f);
    if (existsSync(src)) await cp(src, path.join(jobDir, f));
    else await rm(path.join(jobDir, f), { force: true });
  }
  for (const d of SNAPSHOT_DIRS_V3) {
    await rm(path.join(jobDir, d), { recursive: true, force: true });
    if (existsSync(path.join(dir, d))) await cp(path.join(dir, d), path.join(jobDir, d), { recursive: true });
  }
  const merged: DirectorV3State = { ...now };
  for (const k of ARTIFACT_STATE_KEYS_V3) {
    if (saved[k] === undefined) delete (merged as unknown as Record<string, unknown>)[k];
    else (merged as unknown as Record<string, unknown>)[k] = saved[k];
  }
  await saveStateV3(jobDir, merged); // state last: until here the job reads as "not saved" (fail closed)
  await rm(dir, { recursive: true, force: true });
  return true;
}
