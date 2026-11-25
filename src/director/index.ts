// DirectorModule (src/contracts.ts) on the Claude Agent SDK with the owner's subscription (CLAUDE_CODE_OAUTH_TOKEN).
// Isolation mirrors homelab-agent's IG-DM profile: no built-in tools except server-side WebSearch while writing,
// one in-process MCP server ("reel") with job-bound tools, strictMcpConfig, no settings/skills/CLAUDE.md,
// canUseTool default-deny, a minimal env for the Claude Code subprocess, fixed cwd + CLAUDE_CONFIG_DIR so sessions
// resume. One session per job (director.json); draft/revise/selfCheck share REEL_MAX_TURNS_PER_JOB.

import { authEnv, defaultToken } from "../auth.js";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_TOOL_NAMES, query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DirectorDraft, DirectorModule, SelfCheckResult } from "../contracts.js";
import { makeCanUseTool, PHASE_TOOLS, REEL_MCP_SERVER_NAME, WEB_SEARCH_TOOL, type Decision } from "./permissions.js";
import { buildSystemPrompt, draftPrompt, NUDGE_PROMPT, revisePrompt, selfCheckPrompt } from "./prompt.js";
import { emptyState, jobDirFor, loadState, recordRun, remainingTurns, saveState, type DirectorPhase, type DirectorState } from "./state.js";
import { loadLedger, saveLedger, type ResearchLedger } from "./research.js";
import { buildMcpServer, buildToolSpecs, type RunRecord, type ToolSpec } from "./tools.js";
import type { SafeFetchOptions } from "./webfetch.js";

export const DEFAULT_MODEL = "claude-sonnet-5-5"; // what homelab-agent runs (AGENT_MODEL in its .env)
export const DEFAULT_MAX_TURNS = 40;
/** Transcripts are evidence for the injection/abuse audit; keep them a while (Claude Code's default is 30 d). */
export const SESSION_RETENTION_DAYS = 90;
/** A run is not started with fewer turns left than this (a save needs ≥ 2: tool call + final text). */
export const MIN_TURNS_TO_START = 2;

export class DirectorError extends Error {
  constructor(
    message: string,
    readonly code: "budget" | "invalid" | "no_save" | "sdk" | "aborted" | "auth" | "no_session",
  ) {
    super(message);
    this.name = "DirectorError";
  }
}

/** Injectable SDK entry point (tests drive the tools through `tools` without any model call). */
export type QueryImpl = (args: { prompt: string; options: Options }, tools: ToolSpec[]) => AsyncIterable<SDKMessage>;

export interface DirectorOptions {
  jobsDir: string;
  dataDir: string;
  model?: string;
  maxTurnsPerJob?: number;
  oauthToken?: string;
  queryImpl?: QueryImpl;
  fetch?: SafeFetchOptions;
  log?: (line: string) => void;
}

interface RunOutcome {
  record: RunRecord;
  text: string;
  turns: number;
  costUsd: number;
  subtype: string;
  sessionId?: string;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** ≤ 5 short notes: substitutions first, then plain lines of the agent's final text. */
export function buildNotes(substitutions: string[], finalText: string): string[] {
  const lines = finalText
    .split("\n")
    .map((l) => l.replace(/^[\s>*#-]+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 3 && !l.startsWith("{") && !/^(i(['’]ve| have)? )?saved\b/i.test(l));
  return [...substitutions, ...lines].map((l) => (l.length > 180 ? `${l.slice(0, 177)}…` : l)).slice(0, 5);
}

export function createDirector(opts: DirectorOptions): DirectorModule & {
  /** For tests/scripts: the SDK options a run would use (no model call). */
  buildOptions(phase: DirectorPhase, jobDir: string, maxTurns: number, resume?: string): Options;
} {
  const model = opts.model ?? (process.env.REEL_MODEL?.trim() || DEFAULT_MODEL);
  const budget = opts.maxTurnsPerJob ?? envInt("REEL_MAX_TURNS_PER_JOB", DEFAULT_MAX_TURNS);
  const token = opts.oauthToken ?? defaultToken();
  const claudeDir = path.join(path.resolve(opts.dataDir), "claude");
  const workDir = path.join(path.resolve(opts.dataDir), "work");
  const log = opts.log ?? ((l: string) => console.log(`[director] ${l}`));
  const queryImpl: QueryImpl = opts.queryImpl ?? ((args) => query(args));

  function buildOptions(phase: DirectorPhase, jobDir: string, maxTurns: number, resume?: string, extra: Partial<Options> = {}, research?: ResearchLedger): Options {
    const webSearch = PHASE_TOOLS[phase].webSearch;
    const allowedBuiltins = webSearch ? [WEB_SEARCH_TOOL] : [];
    const decisionLog = path.join(jobDir, "director-tools.log");
    const onDecision = (d: Decision) => {
      log(`canUseTool ${d.decision} ${d.tool} (${d.why.slice(0, 80)})`);
      // Server-side WebSearch never reaches our MCP tools; its allow decision is the only place to count it.
      if (research && d.decision === "allow" && d.tool === WEB_SEARCH_TOOL) {
        research.searches++;
        void saveLedger(jobDir, research).catch(() => {});
      }
      void appendFile(decisionLog, JSON.stringify({ at: new Date().toISOString(), phase, ...d }) + "\n").catch(() => {});
    };
    return {
      model,
      maxTurns,
      cwd: workDir, // constant cwd so resumed sessions are found under the same project dir
      systemPrompt: buildSystemPrompt(),
      // Base tool set = only WebSearch (server-side) while writing, nothing during self-check; every other built-in
      // is additionally disallowed (belt and braces).
      tools: allowedBuiltins,
      disallowedTools: BUILTIN_TOOL_NAMES.filter((t) => !allowedBuiltins.includes(t)),
      strictMcpConfig: true,
      // No allowedTools on purpose: allow rules would short-circuit canUseTool; every call goes through it.
      canUseTool: makeCanUseTool(phase, onDecision),
      permissionMode: "default", // never auto/bypass: calls must reach canUseTool
      settingSources: [], // ignore ~/.claude settings, hooks, CLAUDE.md, plugins
      skills: [],
      persistSession: true,
      settings: { cleanupPeriodDays: SESSION_RETENTION_DAYS },
      ...(resume ? { resume } : {}),
      // Minimal env: no Discord/AWS/MinIO secrets reach the Claude Code subprocess.
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...authEnv(token, claudeDir),
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        CLAUDE_AGENT_SDK_CLIENT_APP: "reel-studio-director/1.0.0",
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

  /** One SDK query; books turns/cost into director.json whatever happens. */
  async function runPhase(phase: DirectorPhase, jobId: string, prompt: string, resume: string | undefined, signal: AbortSignal | undefined, stills?: string[]): Promise<RunOutcome> {
    if (!token) throw new DirectorError("CLAUDE_CODE_OAUTH_TOKEN is not set (the director uses the owner's subscription)", "auth");
    const jobDir = jobDirFor(opts.jobsDir, jobId);
    await mkdir(jobDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    let state: DirectorState = await loadState(jobDir);
    const left = remainingTurns(state, budget);
    if (left < MIN_TURNS_TO_START) throw new DirectorError(`turn budget exhausted for job ${jobId} (${state.turnsUsed}/${budget} turns used)`, "budget");
    if (signal?.aborted) throw new DirectorError("aborted", "aborted");

    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const record: RunRecord = { failedSaves: 0, lastErrors: [] };
    const research = await loadLedger(jobDir);
    const specs = buildToolSpecs({ jobDir, phase, stills, fetch: opts.fetch, record, onFatal: () => abort.abort(), log, research });
    const options = buildOptions(
      phase,
      jobDir,
      left,
      resume,
      { abortController: abort, mcpServers: { [REEL_MCP_SERVER_NAME]: buildMcpServer(specs) } },
      research,
    );

    const out: RunOutcome = { record, text: "", turns: 0, costUsd: 0, subtype: "no_result", sessionId: resume };
    let sawResult = false;
    let thrown: unknown;
    try {
      for await (const msg of queryImpl({ prompt, options }, specs)) {
        const sid = (msg as { session_id?: string }).session_id;
        if (sid) out.sessionId = sid;
        if (msg.type === "system" && msg.subtype === "init") {
          log(`init model=${msg.model} tools=[${msg.tools.join(",")}] mcp=${msg.mcp_servers.map((s) => `${s.name}:${s.status}`).join(",")}`);
        } else if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
          const blocks = (msg.message?.content ?? []) as Array<{ type: string; text?: string; name?: string }>;
          const texts = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text as string);
          if (texts.length) out.text = texts.join("\n");
          for (const b of blocks) if (b.type === "tool_use" && b.name) log(`tool_use ${b.name}`);
        } else if (msg.type === "result") {
          sawResult = true;
          out.turns = msg.num_turns ?? 0;
          out.costUsd = msg.total_cost_usd ?? 0;
          out.subtype = msg.subtype;
          if (msg.subtype === "success" && msg.result) out.text = msg.result;
        }
      }
    } catch (e) {
      thrown = e; // the SDK often throws AFTER delivering the result (with its cost) — book what we saw
    } finally {
      signal?.removeEventListener("abort", onAbort);
      // An aborted run without a result message still consumed at least one turn; never under-count the budget.
      if (!sawResult && thrown) out.turns = Math.max(out.turns, 1);
      state = recordRun(
        { ...(await loadState(jobDir)), model },
        { phase, at: new Date().toISOString(), turns: out.turns, costUsd: out.costUsd, subtype: thrown && !sawResult ? "error" : out.subtype, saved: !!record.saved, failedSaves: record.failedSaves },
        out.sessionId,
      );
      await saveState(jobDir, state);
    }
    if (record.fatal) throw new DirectorError(`director could not produce a valid script: ${record.fatal}`, "invalid");
    if (signal?.aborted) throw new DirectorError("aborted", "aborted");
    if (thrown && !sawResult) {
      const m = String((thrown as Error)?.message ?? thrown).replace(/sk-ant-[\w-]+/g, "[REDACTED]");
      if (/no conversation found|session[^\n]{0,40}not found|could not find session/i.test(m)) throw new DirectorError(`director session for ${jobId} is gone: ${m.slice(0, 200)}`, "no_session");
      throw new DirectorError(`director SDK error: ${m.slice(0, 300)}`, "sdk");
    }
    log(`${phase} ${jobId}: ${out.subtype}, ${out.turns} turns, $${out.costUsd.toFixed(4)}, saved=${!!record.saved}, failedSaves=${record.failedSaves}, budget ${state.turnsUsed}/${budget}`);
    return out;
  }

  /** draft/revise share this: run, and if nothing valid was saved, one nudge turn on the same session. */
  async function writeScript(phase: "draft" | "revise", jobId: string, prompt: string, resume: string | undefined, signal?: AbortSignal): Promise<DirectorDraft> {
    let r = await runPhase(phase, jobId, prompt, resume, signal);
    let turns = r.turns;
    let cost = r.costUsd;
    if (!r.record.saved) {
      if (!r.sessionId) throw new DirectorError("director ended without saving and without a session to nudge", "no_save");
      const nudge = await runPhase(phase, jobId, NUDGE_PROMPT, r.sessionId, signal);
      turns += nudge.turns;
      cost += nudge.costUsd;
      if (!nudge.record.saved) {
        const why = nudge.record.lastErrors.length ? `; last validation errors: ${nudge.record.lastErrors.slice(0, 6).join(" | ")}` : "";
        throw new DirectorError(`director ended without a valid save_script (${phase})${why}`, "no_save");
      }
      r = { ...nudge, text: nudge.text || r.text };
    }
    const saved = r.record.saved!;
    return {
      script: saved.script,
      config: saved.config,
      notes: [...(r.record.researchWarning ? [`⚠️ ${r.record.researchWarning}`] : []), ...buildNotes(saved.script.substitutions, r.text)].slice(0, 5),
      turnsUsed: turns,
      costUsd: Math.round(cost * 1e6) / 1e6,
      sessionId: r.sessionId,
    };
  }

  async function sessionOf(jobId: string): Promise<string> {
    const s = await loadState(jobDirFor(opts.jobsDir, jobId));
    if (!s.sessionId) throw new DirectorError(`no director session for job ${jobId} (draft first)`, "no_session");
    return s.sessionId;
  }

  return {
    buildOptions: (phase, jobDir, maxTurns, resume) => buildOptions(phase, jobDir, maxTurns, resume),

    async draft(jobId, prompt, signal) {
      return writeScript("draft", jobId, draftPrompt(prompt), undefined, signal);
    },

    async revise(jobId, feedback, signal) {
      return writeScript("revise", jobId, revisePrompt(feedback), await sessionOf(jobId), signal);
    },

    async selfCheck(jobId, stills, signal): Promise<SelfCheckResult> {
      const r = await runPhase("selfcheck", jobId, selfCheckPrompt(Math.min(stills.length || 3, 4)), await sessionOf(jobId), signal, stills);
      const rep = r.record.report;
      // Any successful save in this run rewrote script.json/config.json: hand that revision on, whatever `fixed` says.
      if (r.record.saved) return { ok: false, issues: rep?.issues.length ? rep.issues : ["revised during self-check"], revised: r.record.saved };
      // No verdict = we cannot claim the render is fine, but a missing report is not a defect either: report it
      // as ok with an explanatory issue so the pipeline ships rather than looping.
      if (!rep) return { ok: true, issues: ["self-check ended without a verdict (treated as ok)"] };
      return { ok: rep.ok, issues: rep.issues };
    },
  };
}

export { emptyState };
