// Director v2 (W3 P3), beside v1 (src/director/, frozen until W6). DirectorV2Module on the Claude Agent SDK with the
// owner's subscription (CLAUDE_CODE_OAUTH_TOKEN). Isolation is a copy of v1 buildOptions (not an import-and-mutate):
// only server-side WebSearch as a builtin, every other builtin disallowed, one in-process MCP server "reel" with
// job-bound tools (tools.ts), strictMcpConfig, no settings/skills/CLAUDE.md, canUseTool default-deny
// (permissions.ts), minimal env, fixed cwd + CLAUDE_CONFIG_DIR so sessions resume.
//
// One session per job (director-v2.json). draft and revise share REEL_V2_MAX_TURNS_PER_JOB (default 160; W7: was 110) for the
// director's own turns, REEL_V2_MAX_GATE_TURNS_PER_JOB (default 60, W3.2 r1) for the gate turns (fresh judge, fact
// check, shortener, on-screen check — they used to eat ~28% of the director's 110), and REEL_V2_MAX_USD_PER_JOB
// (default $20 notional, director + gates). Turns,
// $ and tokens are booked whatever happens (the SDK often throws after delivering its result). One nudge on the
// same session when a run ends without save_job.
//
// W3 fix round 1: a resumed session's result carries the session's cumulative $ and tokens, so only the difference
// to the last seen totals is booked (state.sdkDelta); maxBudgetUsd enforces the $ cap inside a run; a revise starts
// its own per-phase gate counters (state.startPhaseV2); one research window rule for WebSearch AND web_fetch.
//
// W3.1 r1: loadDraft builds a draft only from a job at stage "saved" whose sealed files match state.savedHash.
//
// W3.1: a fail-closed gate (fact check, save gate) ends the job: DirectorV2Error "invalid" whose message is the
// card-ready reason and whose `failure` carries the items (also failure.json); such a run is not nudged. WebSearch
// queries are booked with the search (freshness rule); searches without a result are un-booked when the run ends.
// The in-run $ check adds the director's estimated live spend (estimateUsd of its per-message tokens).

import { authEnv, defaultToken } from "../../auth.js";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_TOOL_NAMES, query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { formatLintReport, type LintReport } from "../../v2/lints.js";
import type { WordsFileT, Storyboard } from "../../schema/storyboard.v2.js";
import type { ScriptV2 } from "../../schema/script.v2.js";
import type { DirectorV2Deps, DirectorV2Draft, DirectorV2Module, RubricResult, UsageV2 } from "./contracts.js";
import { makeCanUseToolV2, REEL_MCP_SERVER_NAME, WEB_SEARCH_TOOL, type Decision } from "./permissions.js";
import { buildSystemPromptV2, draftPromptV2, draftTopic, NUDGE_PROMPT_V2, revisePromptV2 } from "./prompt.js";
import { isHowItWorks, jobTrackOf, loadUsedTopics, recordUsedTopic } from "./topics.js";
import { loadLedger, recordSearch, researchGapsV2, researchSummary, saveLedger, unbookSearches } from "./research.js";
import { addTokens, bookStaleLiveRun, directorTurnsV2, emptyTokens, jobDirFor, loadStateV2, recordRunV2, remainingGateTurnsV2, remainingTurnsV2, saveStateV2, sdkDelta, startPhaseV2, type DirectorV2State, type Tokens, type V2Phase } from "./state.js";
import { buildMcpServerV2, buildToolSpecsV2, criticGateTurnReserve, FILES, researchWindowOpen, savedContentHash, type CriticFn, type JobFailure, type RunRecordV2, type ToolContextV2, type ToolSpecV2 } from "./tools.js";
import { escapeXml } from "../webfetch.js";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_MAX_TURNS_V2 = 160;
/** W3.2 r1: the gates' own turn budget (judge + fact-check + shortener + on-screen check runs, all phases). */
export const DEFAULT_MAX_GATE_TURNS_V2 = 60;
export const DEFAULT_MAX_USD_V2 = 20;
export const SESSION_RETENTION_DAYS = 90;
/** A run is not started with fewer turns left than this. */
export const MIN_TURNS_TO_START = 2;

export class DirectorV2Error extends Error {
  constructor(
    message: string,
    readonly code: "budget" | "invalid" | "no_save" | "sdk" | "aborted" | "auth" | "no_session",
    /** W3.1: why a job FAILED a fail-closed gate (fact check / save gate) — also in <jobDir>/failure.json. */
    readonly failure?: JobFailure,
  ) {
    super(message);
    this.name = "DirectorV2Error";
  }
}

/** Notional $ per million tokens for the director's in-run estimate (Sonnet-class list prices; subscription, not
 *  billed). Used only to combine the director's live spend with the judge's inside one run (W3 minor). */
export const NOTIONAL_USD_PER_MTOK = { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } as const;

export function estimateUsd(t: Tokens): number {
  const p = NOTIONAL_USD_PER_MTOK;
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheCreate * p.cacheCreate) / 1e6;
}

/** Injectable SDK entry point (tests drive the tools through `tools` without any model call). */
export type QueryImplV2 = (args: { prompt: string; options: Options }, tools: ToolSpecV2[]) => AsyncIterable<SDKMessage>;

export interface DirectorV2Options extends DirectorV2Deps {
  jobsDir: string;
  dataDir: string;
  model?: string;
  maxTurnsPerJob?: number;
  /** W3.2 r1: gate (judge / fact-check) turn cap per job (default DEFAULT_MAX_GATE_TURNS_V2). */
  maxGateTurnsPerJob?: number;
  maxUsdPerJob?: number;
  oauthToken?: string;
  /** L15 pin for submit_storyboard (defaults.ts: pinnedSiteHash(DEV_SITE)). */
  pinnedLibraryHash?: () => string | undefined;
  /** list_components payload (defaults.ts: P4 catalogue). */
  catalogue?: () => unknown;
  /** Judge model (default: judge.ts DEFAULT_JUDGE_MODEL / REEL_V2_JUDGE_MODEL). */
  judgeModel?: string;
  /** W5: the independent §13 vision critic (critic.ts runCritic); absent = save_job does not run it. Production wires
   *  it (pipeline v2 loadDefaultDirector; defaults.ts once it lists it). */
  critic?: CriticFn;
  /** W5: reference contact sheet for the critic (default: tools.ts defaultCriticReference). */
  criticReference?: () => string | undefined;
  ffmpeg?: string;
  env?: NodeJS.ProcessEnv;
}

function envNum(env: NodeJS.ProcessEnv, name: string, fallback: number, int = true): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 && (!int || Number.isInteger(n)) ? n : fallback;
}

/** SDK result → our token counters: the per-model sum (modelUsage covers every model call of the query — sdk.d.ts
 *  "the correct field for token/cost accounting"), else `usage` (main loop only). */
export function tokensFromResult(msg: { usage?: Record<string, unknown>; modelUsage?: Record<string, Record<string, unknown>> }): Tokens {
  const n = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
  const t = emptyTokens();
  for (const m of Object.values(msg.modelUsage ?? {})) {
    t.input += n(m.inputTokens);
    t.output += n(m.outputTokens);
    t.cacheRead += n(m.cacheReadInputTokens);
    t.cacheCreate += n(m.cacheCreationInputTokens);
  }
  if (t.input || t.output || t.cacheRead || t.cacheCreate) return t;
  const u = msg.usage ?? {};
  return { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheCreate: n(u.cache_creation_input_tokens) };
}

/** ≤ 5 short notes: the agent's save_job notes first, then plain lines of its final text. */
export function buildNotesV2(saved: string[], finalText: string): string[] {
  const lines = finalText
    .split("\n")
    .map((l) => l.replace(/^[\s>*#-]+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 3 && !l.startsWith("{") && !/^(i(['’]ve| have)? )?saved\b/i.test(l));
  const seen = new Set<string>();
  return [...saved, ...lines]
    .map((l) => (l.length > 180 ? `${l.slice(0, 177)}…` : l))
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .slice(0, 5);
}

interface RunOutcome {
  record: RunRecordV2;
  text: string;
  turns: number;
  costUsd: number;
  subtype: string;
  sessionId?: string;
  capHit?: string;
}

export function createDirectorV2(opts: DirectorV2Options): DirectorV2Module & {
  /** For tests/scripts: the SDK options a run would use (no model call). `researchOpen` gates WebSearch + web_fetch. */
  buildOptions(jobDir: string, maxTurns: number, resume?: string, researchOpen?: () => boolean): Options;
} {
  const env = opts.env ?? process.env;
  const model = opts.model ?? (env.REEL_V2_MODEL?.trim() || env.REEL_MODEL?.trim() || DEFAULT_MODEL);
  const turnCap = opts.maxTurnsPerJob ?? envNum(env, "REEL_V2_MAX_TURNS_PER_JOB", DEFAULT_MAX_TURNS_V2);
  const gateCap = opts.maxGateTurnsPerJob ?? envNum(env, "REEL_V2_MAX_GATE_TURNS_PER_JOB", DEFAULT_MAX_GATE_TURNS_V2);
  const usdCap = opts.maxUsdPerJob ?? envNum(env, "REEL_V2_MAX_USD_PER_JOB", DEFAULT_MAX_USD_V2, false);
  const token = opts.oauthToken ?? defaultToken(env);
  const claudeDir = path.join(path.resolve(opts.dataDir), "claude");
  const workDir = path.join(path.resolve(opts.dataDir), "work");
  const log = opts.log ?? ((l: string) => console.log(`[director-v2] ${l}`));
  const queryImpl: QueryImplV2 = opts.queryImpl ?? ((args) => query(args));

  function buildOptions(
    jobDir: string,
    maxTurns: number,
    resume?: string,
    researchOpen?: () => boolean,
    extra: Partial<Options> = {},
    onSearch?: (toolUseID?: string, query?: string) => void,
    budget?: () => string | null,
    onToolCall?: (d: Decision) => void,
  ): Options {
    const allowedBuiltins = [WEB_SEARCH_TOOL];
    const decisionLog = path.join(jobDir, "director-v2-tools.log");
    const onDecision = (d: Decision) => {
      log(`canUseTool ${d.decision} ${d.tool} (${d.why.slice(0, 80)})`);
      // Server-side WebSearch never reaches our MCP tools; its allow decision is the only place to count it.
      // A search is booked on allow and un-booked when its tool_result is an error or empty (see the message loop).
      if (d.decision === "allow" && d.tool === WEB_SEARCH_TOOL) onSearch?.(d.toolUseID, d.query);
      onToolCall?.(d);
      void appendFile(decisionLog, JSON.stringify({ at: new Date().toISOString(), ...d }) + "\n").catch(() => {});
    };
    return {
      model,
      maxTurns,
      cwd: workDir,
      systemPrompt: buildSystemPromptV2(),
      tools: allowedBuiltins,
      disallowedTools: BUILTIN_TOOL_NAMES.filter((t) => !allowedBuiltins.includes(t)),
      strictMcpConfig: true,
      // No allowedTools on purpose: allow rules would short-circuit canUseTool; every call goes through it.
      // The job caps are enforced per tool call too (turns incl. judge turns, notional $), not only after a turn.
      canUseTool: makeCanUseToolV2({ researchOpen, budget, onDecision }),
      permissionMode: "default",
      settingSources: [],
      skills: [],
      persistSession: true,
      settings: { cleanupPeriodDays: SESSION_RETENTION_DAYS },
      ...(resume ? { resume } : {}),
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        ...authEnv(token, claudeDir),
        TMPDIR: env.TMPDIR ?? "/tmp",
        CLAUDE_AGENT_SDK_CLIENT_APP: "reel-studio-director-v2/1.0.0",
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

  /** One SDK query; books turns/$/tokens into director-v2.json whatever happens. */
  async function runPhase(phase: V2Phase, nudge: boolean, jobId: string, prompt: string, resume: string | undefined, signal: AbortSignal | undefined): Promise<RunOutcome> {
    if (!token) throw new DirectorV2Error("CLAUDE_CODE_OAUTH_TOKEN is not set (the director uses the owner's subscription)", "auth");
    const jobDir = jobDirFor(opts.jobsDir, jobId);
    await mkdir(jobDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    const onDisk = await loadStateV2(jobDir);
    // A liveRun checkpoint left on file = the previous process died mid-run: book its turns/tokens first.
    const loaded = bookStaleLiveRun(onDisk);
    if (loaded !== onDisk) log(`booked a killed ${onDisk.liveRun?.phase} run for ${jobId}: ${onDisk.liveRun?.turns} turn(s), ${onDisk.liveRun?.toolCalls} tool call(s)`);
    const phased = startPhaseV2(loaded, nudge ? "nudge" : phase);
    const start = phased.createdAt ? phased : { ...phased, createdAt: new Date().toISOString() };
    if (start !== onDisk) await saveStateV2(jobDir, start);
    const left = remainingTurnsV2(start, turnCap);
    if (left < MIN_TURNS_TO_START) throw new DirectorV2Error(`turn budget exhausted for job ${jobId} (${directorTurnsV2(start)}/${turnCap} director turns used)`, "budget");
    const gateLeft = remainingGateTurnsV2(start, gateCap);
    if (start.costUsd >= usdCap) throw new DirectorV2Error(`notional $ cap reached for job ${jobId} ($${start.costUsd.toFixed(2)} of $${usdCap.toFixed(2)})`, "budget");
    if (signal?.aborted) throw new DirectorV2Error("aborted", "aborted");

    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const record: RunRecordV2 = { failedSubmits: 0, failedBoards: 0, phase, lastErrors: [], notes: [], judgeTurns: 0, judgeUsd: 0 };
    const research = await loadLedger(jobDir);
    let liveTurns = 0;
    const ctx: ToolContextV2 = {
      jobId,
      jobDir,
      state: start,
      research,
      record,
      judge: opts.judge,
      judgeArgs: { claudeDir: path.join(path.resolve(opts.dataDir), "judge"), oauthToken: token, model: opts.judgeModel },
      tts: opts.tts,
      stills: opts.stills,
      factCheck: opts.factCheck,
      propFactCheck: opts.propFactCheck,
      shortenFix: opts.shortenFix,
      mechanismCheck: opts.mechanismCheck,
      critic: opts.critic,
      clarity: opts.clarity,
      physics: opts.physics,
      ...(opts.criticReference ? { criticReference: opts.criticReference } : {}),
      fetch: opts.fetch,
      pinnedLibraryHash: opts.pinnedLibraryHash,
      catalogue: opts.catalogue,
      ffmpeg: opts.ffmpeg,
      env,
      log,
      signal: abort.signal,
      onFatal: () => abort.abort(),
      // Judge turns are booked as they happen; the director's own turns are counted live below. The $ check adds the
      // director's in-run spend, estimated from its live per-message tokens (its real cost arrives only with the
      // result), so director + judge inside ONE run cannot reach ~2× the cap (W3 minor).
      budget: () => {
        if (liveTurns >= left) return `turn cap reached (${directorTurnsV2(start) + liveTurns}/${turnCap} director turns)`;
        const spent = start.costUsd + record.judgeUsd + estimateUsd(liveTokens);
        if (spent >= usdCap) return `notional $ cap reached ($${spent.toFixed(2)} of $${usdCap.toFixed(2)})`;
        return null;
      },
      // W3.2 r1: the gates' own turn budget — reached = the judge / fact checks cannot run (they fail closed); the
      // director can still board, review and save a script that already passed.
      // W5 fr1: every gate but the critic keeps criticGateTurnReserve turns for the critic rounds still left.
      gateBudget: (o?: { critic?: boolean }) => {
        if (record.judgeTurns >= gateLeft) return `gate turn cap reached (${start.judgeTurns + record.judgeTurns}/${gateCap} judge + fact-check turns)`;
        const keep = opts.critic && !o?.critic ? criticGateTurnReserve(ctx.state) : 0;
        if (keep && record.judgeTurns + keep >= gateLeft) return `gate turn cap reached (${start.judgeTurns + record.judgeTurns}/${gateCap} judge + fact-check turns; ${keep} kept for the §13 critic)`;
        return null;
      },
      turnsLeft: () => Math.max(0, left - liveTurns),
      // Research window: before the board; in a revise also until the revise PHASE's first accepted board
      // (state.boardedInPhase is persisted, so the revise's nudge run cannot reopen it). Same rule as canUseTool.
      researchOpen: () => researchWindowOpen(ctx.state, phase),
    };
    const specs = buildToolSpecsV2(ctx);
    const bookedSearches = new Set<string>(); // WebSearch toolUseIDs counted on allow, awaiting their tool_result
    // Live checkpoint (state.liveRun): rewritten on every director turn and allowed tool call, so a run that dies
    // mid-draft still shows (and next time books) its turns. Writes are chained so they land in order.
    const startedAt = new Date().toISOString();
    let liveTokens = emptyTokens();
    let toolCalls = 0;
    let persist: Promise<void> = Promise.resolve();
    const checkpoint = () => {
      ctx.state = { ...ctx.state, liveRun: { phase: nudge ? "nudge" : phase, startedAt, at: new Date().toISOString(), turns: liveTurns, tokens: liveTokens, toolCalls, pid: process.pid } };
      persist = persist.then(() => saveStateV2(jobDir, ctx.state)).catch(() => {});
    };
    checkpoint();
    const options = buildOptions(
      jobDir,
      left,
      resume,
      () => researchWindowOpen(ctx.state, phase),
      {
        abortController: abort,
        mcpServers: { [REEL_MCP_SERVER_NAME]: buildMcpServerV2(specs) },
        // The SDK counts this from the start of this query() call: the job's $ left (judge spend is checked by the tools).
        maxBudgetUsd: Math.max(0.01, Math.round((usdCap - start.costUsd) * 1e4) / 1e4),
      },
      (id, q) => {
        recordSearch(research, q ?? "", id);
        if (id) bookedSearches.add(id);
        void saveLedger(jobDir, research).catch(() => {});
      },
      () => ctx.budget?.() ?? null,
      (d) => {
        if (d.decision !== "allow") return;
        toolCalls++;
        checkpoint();
      },
    );

    const out: RunOutcome = { record, text: "", turns: 0, costUsd: 0, subtype: "no_result", sessionId: resume };
    let tokens = emptyTokens();
    let sawResult = false;
    let thrown: unknown;
    const t0 = Date.now();
    try {
      for await (const msg of queryImpl({ prompt, options }, specs)) {
        const sid = (msg as { session_id?: string }).session_id;
        if (sid) out.sessionId = sid;
        if (msg.type === "system" && msg.subtype === "init") {
          log(`init model=${msg.model} tools=[${(msg.tools ?? []).join(",")}] mcp=${(msg.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`).join(",")}`);
        } else if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
          liveTurns++;
          liveTokens = addTokens(liveTokens, tokensFromMessageUsage((msg.message as unknown as { usage?: Record<string, unknown> } | undefined)?.usage));
          checkpoint();
          const blocks = (msg.message?.content ?? []) as Array<{ type: string; text?: string; name?: string }>;
          const texts = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text as string);
          if (texts.length) out.text = texts.join("\n");
          for (const b of blocks) if (b.type === "tool_use" && b.name) log(`tool_use ${b.name}`);
          const cap = ctx.budget?.() ?? null;
          if (cap && !out.capHit) {
            out.capHit = cap;
            abort.abort();
          }
        } else if (msg.type === "user" && bookedSearches.size) {
          const failedIds: string[] = [];
          if (unbookFailedSearches(msg.message?.content, bookedSearches, failedIds)) {
            unbookSearches(research, failedIds);
            void saveLedger(jobDir, research).catch(() => {});
          }
        } else if (msg.type === "result") {
          sawResult = true;
          out.turns = msg.num_turns ?? 0;
          out.costUsd = msg.total_cost_usd ?? 0;
          out.subtype = msg.subtype;
          tokens = tokensFromResult(msg as never);
          if (msg.subtype === "error_max_budget_usd" && !out.capHit) out.capHit = `notional $ cap reached (SDK budget for this run; job cap $${usdCap.toFixed(2)})`;
          if (msg.subtype === "success" && msg.result) out.text = msg.result;
        }
        if (out.capHit && abort.signal.aborted) break;
      }
    } catch (e) {
      thrown = e; // the SDK often throws AFTER delivering the result (with its cost) — book what we saw
    } finally {
      signal?.removeEventListener("abort", onAbort);
      // Never under-count: a run without a result consumed at least the assistant turns we saw (≥ 1 if it threw).
      out.turns = Math.max(out.turns, liveTurns, !sawResult && (thrown || out.capHit) ? 1 : 0);
      await persist; // the last live checkpoint has landed; the final write below replaces it
      // A search whose result never arrived (run aborted / capped / died first) returned nothing: un-book it so it
      // cannot help the research floor across a nudge or revise (W3 minor).
      if (bookedSearches.size) {
        const n = unbookSearches(research, [...bookedSearches]);
        bookedSearches.clear();
        log(`un-booked ${n} WebSearch call(s) without a result`);
        await saveLedger(jobDir, research).catch(() => {});
      }
      // ctx.state is authoritative: every tool commit replaced it in memory (stage/judge/stills/badges).
      const { liveRun: _live, ...latest } = ctx.state;
      // Resumed sessions report cumulative totals: book only this run's share. Without a result, the per-message
      // usage seen so far is booked (cost unknown → 0) rather than nothing.
      const own = sawResult ? sdkDelta(latest.sessionTotals, resume, out.sessionId, { costUsd: out.costUsd, tokens }) : { costUsd: 0, tokens: liveTokens, totals: latest.sessionTotals };
      const state = recordRunV2(
        { ...(latest as DirectorV2State), model },
        {
          phase: nudge ? "nudge" : phase,
          at: new Date().toISOString(),
          turns: out.turns,
          costUsd: own.costUsd,
          tokens: own.tokens,
          subtype: out.capHit ? "cap" : signal?.aborted ? "aborted" : thrown && !sawResult ? "error" : out.subtype,
          saved: !!record.saved,
          wallSec: (Date.now() - t0) / 1000,
          ...(sawResult ? { sdkCostUsd: out.costUsd } : {}),
        },
        out.sessionId,
        own.totals,
      );
      out.costUsd = own.costUsd;
      await saveStateV2(jobDir, state);
      ctx.state = state;
    }
    if (record.fatal) throw new DirectorV2Error(record.failure ? record.fatal : `director could not produce a valid job: ${record.fatal}`, "invalid", record.failure);
    if (signal?.aborted) throw new DirectorV2Error("aborted", "aborted");
    if (out.capHit && !record.saved) throw new DirectorV2Error(`director stopped: ${out.capHit}`, "budget");
    if (thrown && !sawResult && !out.capHit) {
      const m = String((thrown as Error)?.message ?? thrown).replace(/sk-ant-[\w-]+/g, "[REDACTED]");
      if (/no conversation found|session[^\n]{0,40}not found|could not find session/i.test(m)) throw new DirectorV2Error(`director session for ${jobId} is gone: ${m.slice(0, 200)}`, "no_session");
      throw new DirectorV2Error(`director SDK error: ${m.slice(0, 300)}`, "sdk");
    }
    log(`${phase}${nudge ? "/nudge" : ""} ${jobId}: ${out.subtype}, ${out.turns} turns (+${record.judgeTurns} judge), $${out.costUsd.toFixed(4)}, saved=${!!record.saved}`);
    return out;
  }

  async function write(phase: V2Phase, jobId: string, prompt: string, resume: string | undefined, signal?: AbortSignal): Promise<DirectorV2Draft> {
    let r = await runPhase(phase, false, jobId, prompt, resume, signal);
    if (!r.record.saved) {
      if (!r.sessionId) throw new DirectorV2Error("director ended without save_job and without a session to nudge", "no_save");
      const nudge = await runPhase(phase, true, jobId, nudgePromptV2(r.record.lastErrors), r.sessionId, signal);
      if (!nudge.record.saved) {
        const last = nudge.record.lastErrors.length ? nudge.record.lastErrors : r.record.lastErrors;
        const why = last.length ? `; last errors: ${last.slice(0, 6).join(" | ")}` : "";
        throw new DirectorV2Error(`director ended without a valid save_job (${phase})${why}`, "no_save");
      }
      r = { ...nudge, text: nudge.text || r.text };
    }
    return loadDraft(jobId, r.record.notes, r.text, r.sessionId);
  }

  async function loadDraft(jobId: string, savedNotes: string[], finalText: string, sessionId?: string): Promise<DirectorV2Draft> {
    const jobDir = jobDirFor(opts.jobsDir, jobId);
    const read = async <T>(f: string): Promise<T> => JSON.parse(await readFile(path.join(jobDir, f), "utf8")) as T;
    const state = await loadStateV2(jobDir);
    // W3.1 r1: only a job whose files are exactly what save_job sealed becomes a draft (a tool call after the save,
    // or any other change, would otherwise deliver an unreviewed board / a script-board mismatch).
    if (state.stage !== "saved") throw new DirectorV2Error(`job ${jobId} is not saved (stage "${state.stage}") — nothing delivered`, "no_save");
    if (!state.savedHash || state.savedHash !== (await savedContentHash(jobDir))) throw new DirectorV2Error(`job ${jobId}: the saved files changed after save_job — nothing delivered`, "no_save");
    const script = await read<ScriptV2>(FILES.script);
    const storyboard = await read<Storyboard>(FILES.storyboard);
    const words = await read<WordsFileT>(FILES.words);
    const rubric = await read<RubricResult>(FILES.rubric);
    const lint = await read<Pick<LintReport, "ok" | "blocked" | "counts" | "stats" | "results">>(FILES.lint);
    const ledger = await loadLedger(jobDir);
    const stills = await listStillRecords(jobDir);
    const order = { block: 0, error: 1, warn: 2 } as const;
    const findings = [...lint.results].sort((a, b) => order[a.severity] - order[b.severity]).map((x) => ({ id: x.id, severity: x.severity, message: x.message, ...(x.beatId ? { beatId: x.beatId } : {}) }));
    const top = formatLintReport({ ...lint, results: findings } as LintReport).split("\n").slice(1, 9);
    const badges = [...state.badges.map((b) => b.replace(/^\w+:/, ""))];
    if (lint.counts.block || lint.counts.error) badges.push(`residual lints: ${lint.counts.block} block, ${lint.counts.error} error`);
    if (state.stillsSkipped) badges.push(`stills skipped: ${state.stillsSkipped}`);
    const grounding = await readJsonOr<{ quotes?: Array<{ fact: string }> } | null>(path.join(jobDir, FILES.grounding), null);
    const factcheck = await readJsonOr<{ verdicts?: Array<{ beat: string; verdict: string; why: string }> } | null>(path.join(jobDir, FILES.factcheck), null);
    const quoted = new Set((grounding?.quotes ?? []).map((q) => q.fact));
    // W3.3: the whole-reel mechanism record of the SAVED script only (its hash = the stored pass)
    type MechRec = { hash?: string; ok?: boolean; chain?: string; findings?: Array<{ beats?: string[]; problem?: string; materiality?: string }> };
    const rec = await readJsonOr<(MechRec & { lastPass?: MechRec }) | null>(path.join(jobDir, FILES.mechanism), null);
    const mech = rec?.ok ? rec : rec?.lastPass;
    const mechanism =
      mech?.ok && mech.hash && mech.hash === state.mechanismPassedHash
        ? { chain: String(mech.chain ?? "").slice(0, 400), nits: (mech.findings ?? []).filter((f) => f.materiality === "nit").slice(0, 4).map((f) => `${(f.beats ?? []).join(", ") || "reel"}: ${String(f.problem ?? "")}`.slice(0, 200)) }
        : undefined;
    const usage: UsageV2 = {
      turns: state.turnsUsed,
      judgeTurns: state.judgeTurns,
      judgeRuns: state.judgeRuns.length,
      factCheckRuns: state.judgeRuns.filter((r) => r.kind === "factcheck").length,
      costUsd: state.costUsd,
      tokens: state.tokens,
      wallSec: state.wallSec,
      lambdaUsd: state.lambdaUsd,
      stillsRendered: state.stillsRendered,
      runs: state.runs.map((x) => ({ phase: x.phase, turns: x.turns, costUsd: x.costUsd, subtype: x.subtype, saved: x.saved })),
    };
    return {
      jobId,
      jobDir,
      slug: script.slug,
      title: script.title,
      codename: script.codename,
      script,
      storyboard,
      words,
      rubric,
      lint: { ok: lint.ok, blocked: lint.blocked, counts: lint.counts, stats: lint.stats, top, findings },
      stills,
      research: {
        ...researchSummary(ledger, script),
        // W3.2 r2: sources pruned at submit (no line rested on them) still count for the floor it was accepted on.
        gaps: researchGapsV2(script, ledger, new Date(state.createdAt ?? Date.now()), { extraSources: state.prunedSources, readPages: isHowItWorks(script) }),
        grounding: {
          quotedFacts: script.facts.filter((f) => quoted.has(f.id)).length,
          facts: script.facts.length,
          flagged: (factcheck?.verdicts ?? []).filter((v) => v.verdict !== "supported").slice(0, 8).map((v) => `${v.beat} ${v.verdict}: ${v.why}`.slice(0, 200)),
        },
      },
      badges: [...new Set(badges)],
      ...(state.reviewAck ? { review: state.reviewAck } : {}),
      ...(state.autoFixes?.length ? { autoFixes: state.autoFixes } : {}),
      ...(state.autoFixDecisions?.length ? { autoFixDecisions: state.autoFixDecisions } : {}),
      ...(mechanism ? { mechanism } : {}),
      notes: buildNotesV2(savedNotes, finalText),
      usage,
      sessionId: sessionId ?? state.sessionId,
    };
  }

  async function sessionOf(jobId: string): Promise<string> {
    const s: DirectorV2State = await loadStateV2(jobDirFor(opts.jobsDir, jobId));
    if (!s.sessionId) throw new DirectorV2Error(`no director session for job ${jobId} (draft first)`, "no_session");
    return s.sessionId;
  }

  return {
    buildOptions: (jobDir, maxTurns, resume, researchOpen) => buildOptions(jobDir, maxTurns, resume, researchOpen),
    async draft(jobId, prompt, signal) {
      // W7: a vague / empty prompt gets a curated how-it-works topic (topics.ts), never the same one twice in a row
      // W7.1: a prompt that NAMES a curated topic gets the same leads; the job's track is decided here by code
      const usedTopics = await loadUsedTopics(opts.dataDir);
      const topic = draftTopic(prompt, { usedTopics, seed: usedTopics.length, env: opts.env });
      if (topic) await recordUsedTopic(opts.dataDir, topic.slug, jobId).catch((e) => opts.log?.(`curated topic ledger: ${String((e as Error)?.message ?? e).slice(0, 120)}`));
      const track = jobTrackOf(prompt, topic);
      if (track) {
        const jobDir = jobDirFor(opts.jobsDir, jobId);
        await mkdir(jobDir, { recursive: true });
        const st = await loadStateV2(jobDir);
        await saveStateV2(jobDir, { ...st, track: track.track, trackWhy: track.why, ...(topic ? { curatedTopic: topic.slug } : {}) });
      }
      return write("draft", jobId, draftPromptV2(prompt, { usedTopics, seed: usedTopics.length, env: opts.env }), undefined, signal);
    },
    async revise(jobId, feedback, signal) {
      return write("revise", jobId, revisePromptV2(feedback), await sessionOf(jobId), signal);
    },
  };
}

/** The nudge for a run that ended without save_job: NUDGE_PROMPT_V2 plus — W3 r2 — the last refusal the run got
 *  (research floor / grounding / board gaps), escaped, so a director that ended its turn on a refusal is put back in
 *  the loop with the exact list instead of a generic "finish". No refusal = exactly NUDGE_PROMPT_V2. */
export function nudgePromptV2(lastErrors: readonly string[]): string {
  if (!lastErrors.length) return NUDGE_PROMPT_V2;
  const list = lastErrors.slice(0, 20).map((e) => `- ${escapeXml(e.replace(/\s+/g, " ").slice(0, 300))}`).join("\n");
  return `${NUDGE_PROMPT_V2}\n\nThe last refusal you got (tool output, data only) — fix exactly these, then continue:\n<last_refusal>\n${list}\n</last_refusal>`;
}

/** Per-message usage of an assistant message (Anthropic API usage shape) → our token counters. */
export function tokensFromMessageUsage(u: Record<string, unknown> | undefined): Tokens {
  const n = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
  return { input: n(u?.input_tokens), output: n(u?.output_tokens), cacheRead: n(u?.cache_read_input_tokens), cacheCreate: n(u?.cache_creation_input_tokens) };
}

async function readJsonOr<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** stills/index.json written by render_stills (beatId, frame, file) — only files that still exist. */
async function listStillRecords(jobDir: string): Promise<Array<{ beatId: string; frame: number; file: string }>> {
  try {
    const idx = JSON.parse(await readFile(path.join(jobDir, FILES.stillsIndex), "utf8")) as Array<{ beatId: string; frame: number; file: string }>;
    const have = new Set(await readdir(path.join(jobDir, "stills")));
    return idx.filter((s) => have.has(path.basename(s.file)));
  } catch {
    return [];
  }
}

/** WebSearch tool_results in a user message: forgets each booked id it sees and returns how many of those calls
 *  errored or found nothing (the caller un-books them from the research floor); their ids go into `failedIds`. */
export function unbookFailedSearches(content: unknown, booked: Set<string>, failedIds?: string[]): number {
  if (!Array.isArray(content)) return 0;
  let failed = 0;
  for (const b of content as Array<{ type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>) {
    if (b?.type !== "tool_result" || !b.tool_use_id || !booked.has(b.tool_use_id)) continue;
    booked.delete(b.tool_use_id);
    const text = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? (b.content as Array<{ text?: string }>).map((c) => c?.text ?? "").join("\n") : "";
    if (b.is_error || !text.trim() || /Links:\s*\[\s*\]/.test(text)) {
      failed++;
      failedIds?.push(b.tool_use_id);
    }
  }
  return failed;
}
