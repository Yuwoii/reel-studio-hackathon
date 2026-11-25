// Per-job v2 director state (<jobDir>/director-v2.json): the SDK session id (revise resumes it), the turn budgets
// (W3.2 r1: director turns under REEL_V2_MAX_TURNS_PER_JOB, gate turns under REEL_V2_MAX_GATE_TURNS_PER_JOB; turnsUsed
// is their sum), notional $ and tokens, judge runs, the stage machine,
// gate/rubric/board counters, stills spend and the hash of the script phrases that words.json was made for.
// Written atomically (v1 atomicWrite: tmp + rename) after every tool that changes it and after every SDK run.
//
// Stage machine (each stage requires the previous one; a new submit_script invalidates everything after it):
//   research → scripted → scored → voiced → boarded → reviewed → saved
// W3.1 r1: once save_job succeeds in a run every mutating tool refuses for the rest of that run, and the saved files
// are sealed by savedHash (index.ts loadDraft refuses a draft whose files changed after the save).

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../state.js";
import type { ScriptTrack } from "../../schema/script.v2.js";

export { atomicWrite, jobDirFor, JOB_ID_RE } from "../state.js";

export const STATE_FILE = "director-v2.json";

export const STAGES = ["research", "scripted", "scored", "voiced", "boarded", "reviewed", "saved"] as const;
export type Stage = (typeof STAGES)[number];

export type V2Phase = "draft" | "revise";

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface V2Run {
  phase: V2Phase | "nudge";
  at: string;
  turns: number;
  costUsd: number;
  tokens: Tokens;
  subtype: string;
  saved: boolean;
  wallSec: number;
  /** Raw SDK total_cost_usd of the run's result (cumulative over the session on a resume; costUsd is the delta). */
  sdkCostUsd?: number;
}

/** The SDK's last cumulative totals for this job's session (a resumed session reports totals that include the
 *  earlier runs — sdk.d.ts total_cost_usd / modelUsage — so only the difference is booked). */
export interface SessionTotals {
  sessionId: string;
  costUsd: number;
  tokens: Tokens;
}

export interface JudgeRun {
  at: string;
  turns: number;
  costUsd: number;
  total?: number;
  pass?: boolean;
  error?: string;
  /** "judge" (rubric, default), "factcheck" (claim grounding pass) or "mechanism" (W3.3 whole-reel causal-chain
   *  check). All count toward the job caps. */
  kind?: "judge" | "factcheck" | "mechanism" | "critic" | "clarity" | "physics";
}

export interface DirectorV2State {
  v: 2;
  /** When the job's first director run started (the rubric's freshness "job date"). */
  createdAt?: string;
  sessionId?: string;
  model?: string;
  /** Director turns + judge turns, all runs of this job. W3.2 r1: the director cap (110) applies to turnsUsed −
   *  judgeTurns; the gate turns (judgeTurns) have their own cap (index.ts DEFAULT_MAX_GATE_TURNS_V2). */
  turnsUsed: number;
  /** Notional $ (director + judge). */
  costUsd: number;
  tokens: Tokens;
  wallSec: number;
  judgeRuns: JudgeRun[];
  judgeTurns: number;
  stage: Stage;
  /** Rubric judge rejections in this phase (≤3, then unlock + red badge). Reset on a pass and when a revise starts. */
  rubricRejections: number;
  /** Research-floor refusals of submit_script in this phase (≤3, then accept + red badge). Reset on a pass / revise. */
  gateRejections: number;
  /** Grounding / fact-check refusals of submit_script in this phase (≤3, then accept + red badge). */
  groundingRejections: number;
  /** W3.2 r2: DETERMINISTIC grounding refusals of submit_script in this phase — grounding format (zod) errors,
   *  quotes not found on the page, quote coverage, unmapped lines. Their own budget (tools.ts MAX_QUOTE_REJECTIONS),
   *  so they never use up the semantic fact-check refusals (`groundingRejections`): evergreen-oom w32 r2 spent all three
   *  on a misquote, a zod "Too small" and a coverage gap, and its first fact-check finding was fatal. */
  quoteRejections?: number;
  /** Hash of (phrases, facts, grounding) that last passed the fact check (an unchanged resubmit is not re-checked). */
  factCheckedHash?: string;
  /** W3.2 r2: the same hash for the script AS SUBMITTED, before unused facts / sources were pruned from it (an
   *  unchanged resubmit of the director's own version is not re-checked either). */
  factCheckedPreHash?: string;
  /** W3.2 r2: sources cited at submit that no line rested on, pruned from the stored script (tools.ts pruneUnused).
   *  The research floor the script was accepted on still counts them (index.ts); freshness and the card never do. */
  prunedSources?: Array<{ id: string; url: string; published?: string }>;
  /** W3.2 r2: facts pruned with them (ids). */
  prunedFacts?: string[];
  /** W3.3: whole-reel mechanism-check refusals of submit_script in this phase (tools.ts MAX_MECHANISM_REJECTIONS,
   *  then the job FAILS). Their own budget: never counted as fact-check / quote refusals. */
  mechanismRejections?: number;
  /** W5 integration: mechanism checks that did not RUN (status "error": SDK error, cap, a reply still incomplete after
   *  its repairs) in this phase. Their own budget (2 × tools.ts MAX_MECHANISM_ERRORS, then the job fails closed): never refusals. */
  mechanismErrors?: number;
  /** W3.3: groundingHash of the STORED script + grounding whose mechanism check passed (save_job needs it current). */
  mechanismPassedHash?: string;
  /** W3.3: save_job refusals that sent the mechanical R8 advice (pace / phrase length) back instead of saving NOT
   *  READY (tools.ts MAX_PACE_REFUSALS per phase). */
  paceRefusals?: number;
  /** W3.1 r1: hash of the on-screen text fact-check input (props + their facts' quotes) that last passed. */
  propCheckedHash?: string;
  /** W3.1 r1: automatic fact-check rewrites applied to the stored script (refusals had run out); listed in script.md. */
  autoFixes?: AutoFixRec[];
  /** W3.2: EVERY automatic-rewrite decision of the last auto-fix submit — applied, shortened, or skipped with why
   *  (an over-long rewrite used to be dropped without notice). Also in submit-check.json / failure.json. */
  autoFixDecisions?: AutoFixDecision[];
  /** W3.2: score_script refusals by the deterministic hook pre-check in this phase (≤ MAX_HOOK_PRECHECKS, then the
   *  judge scores it anyway). Never counted as rubric rejections. */
  hookPrechecks?: number;
  /** W7: submit_script refusals by the deterministic story-first gate (story.ts) in this phase (≤ MAX_STORY_REJECTIONS,
   *  then accepted with a red badge). Never counted as failed submits. */
  storyRejections?: number;
  /** W7: score_script refusals by the fresh plain-language judge (clarity.ts) in this phase (≤ MAX_CLARITY_REJECTIONS,
   *  then a red badge). Never counted as rubric rejections. */
  clarityRejections?: number;
  /** W7: scriptContentHash of the script whose plain-language check passed (or gave up with a badge). */
  clarityPassedHash?: string;
  /** W7.1: the job's track decided by code from the owner prompt at draft time (topics.ts jobTrackOf): a script with
   *  no track gets it, an explicit contrary track is refused; also the failure card's series. Absent = the script's. */
  track?: ScriptTrack;
  /** W7.1: why `track` was decided (refusal text). */
  trackWhy?: string;
  /** W7.1: the curated topic slug the prompt resolved to (vague pick or named match). */
  curatedTopic?: string;
  /** W7.1: save_job calls that rendered the review's missing stills itself instead of refusing (tools.ts
   *  MAX_AUTO_COVERAGE_RENDERS per job; never a save refusal). */
  autoCoverageRenders?: number;
  /** W7.1: physics-judge refusals in this phase (physics.ts MAX_PHYSICS_REJECTIONS, then a red "physics:" badge). */
  physicsRejections?: number;
  /** W7.1: key (narration + drawn digest) whose physics check passed or gave up with a badge. */
  physicsPassedKey?: string;
  /** W7.1: the last physics verdict in short (physics.json has the findings). */
  physicsLast?: { key: string; ok: boolean; findings: number };
  /** W3.1 r1: hash of the sealed files written by the last save_job (tools.ts savedContentHash); a draft is only
   *  built when the files on disk still match. Cleared whenever the stage drops below "saved". */
  savedHash?: string;
  /** Storyboards refused since the last accepted board (info; the fatal count is per run, RunRecordV2.failedBoards). */
  failedBoards: number;
  /** TTS runs in this phase (MAX_TTS_RUNS per phase; reset when a revise starts). */
  ttsRuns: number;
  /** save_job refusals for must-fix review findings in this phase (≤2, then saved with a red badge). */
  saveRefusals: number;
  /** save_job refusals for HARD problems in this phase (unresolved fact check, block lint, caption overlap, no
   *  stills review / no review ack): ≤ MAX_SAVE_GATE_REFUSALS, then the job FAILS (never saved with a red badge). */
  saveGateRefusals: number;
  /** Hash of the full script the fresh judge last scored, and whether it passed (a failed script cannot be
   *  re-rolled: score_script refuses until it changes). */
  judgedHash?: string;
  judgedPass?: boolean;
  /** W3.2 r1: the judged total of `judgedHash`. */
  judgedTotal?: number;
  /** W3.2 r1: judge calls by score_script in this phase (≤ tools.ts MAX_SCORE_CALLS, then the script loop stops:
   *  the best-so-far script is restored and locked, so the job always reaches the board and its stills review). */
  scoreCalls?: number;
  /** W3.2 r1: the best-judged script of this phase (its files are copied to best/; tools.ts restoreBestScript). */
  bestScript?: BestScriptRec;
  /** W3.2 r1: beats whose signature changed from one stored board to the next and that have not been shown as a
   *  still of a later board since (carried across re-boards) — core review beats whether or not they were ever
   *  reviewed (a never-shown changed beat used to need no still). */
  changedBeats?: string[];
  /** W3.2 r1: the board signature each beat had when its LAST still was rendered (a still of an older signature is
   *  stale: pruned from stills/index.json and the sheet, and the beat must be stilled again). */
  stillSigs?: Record<string, string>;
  /** Beats of the latest stills round the director has actually been shown as images (render_stills/view_stills). */
  stillsShown?: { round: number; beats: string[] };
  /** W3.2 review coverage: beats shown as a still rendered AFTER the current board (atBoard = stillsRoundAtBoard). */
  shownAfterBoard?: { atBoard: number; beats: string[] };
  /** W3.2: per-beat signature of the current stored board (tools.ts beatSignatures). */
  boardSigs?: Record<string, string>;
  /** W5 fr1: state.ts boardContentHash of the current stored board (part of criticKey). */
  boardHash?: string;
  /** W3.2: per-beat signature each beat had when it was last reviewed (shown after its board) — a beat whose current
   *  signature differs was CHANGED since its review and must be reviewed again before save_job. */
  reviewedSigs?: Record<string, string>;
  /** The director's acknowledgement of the latest stills review (save_job `review`), also in review.json. */
  reviewAck?: ReviewAck;
  /** W5: §13 vision-critic rounds run in this JOB (critic.ts MAX_CRITIC_ROUNDS; not reset by a revise). */
  criticRounds?: number;
  /** W5: criticKey of the board whose critic verdict PASSED (save_job needs it equal to the current board's key). */
  criticPassKey?: string;
  /** W5: the last critic verdict in short (critic.json has the items). */
  criticLast?: { key: string; round: number; pass: boolean; passed: number; total: number; pending: number; failing: string[] };
  /** W5: stills the critic rendered (their own reserved pool, tools.ts stillsLimits().criticPerJob). Also counted in
   *  stillsRendered / lambdaUsd. */
  criticStillsRendered?: number;
  /** W5 fr1: critic runs that did not happen (SDK error / abort / no still shown) retried on an UNCHANGED board in this
   *  job (≤ CRITIC_INFRA_RETRIES; such a run uses no critic round). */
  criticInfraRetries?: number;
  stillsRendered: number;
  stillsRounds: number;
  lambdaUsd: number;
  /** Hash of the phrase list that words.json was synthesised for (stale words.json = refuse the board). */
  wordsForHash?: string;
  /** Hash of the stored script's phrases. */
  scriptHash?: string;
  /** Stills round counter value right after the last storyboard save (save_job needs a newer round or a skip). */
  stillsRoundAtBoard: number;
  /** Set when stills were skipped (cap reached / renderer unavailable) after the last board → badge. */
  stillsSkipped?: string;
  /** Red badges accumulated by the gates (research below floor, rubric unlocked below floor, …). */
  badges: string[];
  saves: number;
  lastSavedAt?: string;
  runs: V2Run[];
  sessionTotals?: SessionTotals;
  /** A storyboard was accepted in the current phase (draft, or the running revise incl. its nudge). Reset when a
   *  revise starts; the research window of a revise closes once it is set. */
  boardedInPhase?: boolean;
  /** Checkpoint of the SDK run in progress, rewritten on every director assistant turn (W3 r2: a run that dies
   *  mid-draft used to leave turnsUsed/runs untouched). Cleared when the run is booked; if the next run finds it,
   *  the previous process died and it is booked as a "killed" run (bookStaleLiveRun). */
  liveRun?: LiveRun;
}

/** W3.2 r1: the best-judged script of a phase and the state that belongs to it. */
export interface BestScriptRec {
  /** scriptContentHash of the script (the judged content). */
  hash: string;
  total: number;
  pass: boolean;
  scriptHash?: string;
  factCheckedHash?: string;
  /** W3.3: its mechanism-check pass hash (restored with it). */
  mechanismPassedHash?: string;
  /** Its research / grounding badges (research: / facts: prefixes) at submit time. */
  badges: string[];
  autoFixes?: AutoFixRec[];
  autoFixDecisions?: AutoFixDecision[];
}

/** One automatic rewrite (tools.ts applyAutoFixes): a narration line's text, or a fact's claim. */
export interface AutoFixRec {
  kind: "phrase" | "claim";
  /** Beat id (phrase) or fact id (claim). */
  id: string;
  from: string;
  to: string;
}

/** One automatic-rewrite decision (W3.2: nothing is dropped silently). W3.2 r2: kind "quote" = the checker said the
 *  page states an unsupported line; its verbatim excerpt (code-verified on the stored page) was added to the fact's
 *  quotes (`id` = fact id, `beat` = the line) and the line kept. */
export interface AutoFixDecision {
  kind: "phrase" | "claim" | "quote";
  /** The line an added quote is for (kind "quote"). */
  beat?: string;
  /** Beat id (phrase) or fact id (claim / quote). */
  id: string;
  /** applied = written as proposed; shortened = the over-long rewrite was shortened (one checker call) and written;
   *  skipped = not written, `reason` says why. */
  status: "applied" | "shortened" | "skipped";
  /** The text that was proposed (checker rewrite, cleaned; or the quotes' own words for a claim). */
  proposed: string;
  /** What was written (applied / shortened). */
  to?: string;
  reason?: string;
  /** Auto-fix round (1-based). */
  round: number;
}

export interface ReviewIssue {
  beat: string;
  issue: string;
  /** fixed = changed in the board and re-rendered; minor = seen and accepted (listed on the card); open = not fixed. */
  status: "fixed" | "minor" | "open";
  fix?: string;
}

export interface ReviewAck {
  round: number;
  at: string;
  checked: string[];
  issues: ReviewIssue[];
}

export interface LiveRun {
  phase: V2Phase | "nudge";
  startedAt: string;
  at: string;
  /** Director assistant turns seen so far in this run (judge turns are booked separately as they happen). */
  turns: number;
  /** Per-message usage summed so far (the result message, if it arrives, replaces it). */
  tokens: Tokens;
  /** Tool calls the director made so far in this run. */
  toolCalls: number;
  pid?: number;
}

/** Book a run the previous process never finished (its liveRun checkpoint is still on file): its turns and tokens
 *  count, cost is unknown (no result message) and booked as 0. No checkpoint = unchanged. */
export function bookStaleLiveRun(s: DirectorV2State): DirectorV2State {
  const l = s.liveRun;
  if (!l) return s;
  const { liveRun: _drop, ...rest } = s;
  const startedMs = Date.parse(l.startedAt);
  const atMs = Date.parse(l.at);
  const wallSec = Number.isFinite(startedMs) && Number.isFinite(atMs) ? Math.max(0, (atMs - startedMs) / 1000) : 0;
  return recordRunV2(rest as DirectorV2State, { phase: l.phase, at: l.at, turns: Math.max(1, l.turns), costUsd: 0, tokens: l.tokens, subtype: "killed", saved: false, wallSec });
}

export function emptyTokens(): Tokens {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
}

export function emptyStateV2(): DirectorV2State {
  return {
    v: 2,
    turnsUsed: 0,
    costUsd: 0,
    tokens: emptyTokens(),
    wallSec: 0,
    judgeRuns: [],
    judgeTurns: 0,
    stage: "research",
    rubricRejections: 0,
    gateRejections: 0,
    groundingRejections: 0,
    failedBoards: 0,
    ttsRuns: 0,
    saveRefusals: 0,
    saveGateRefusals: 0,
    stillsRendered: 0,
    stillsRounds: 0,
    lambdaUsd: 0,
    stillsRoundAtBoard: 0,
    badges: [],
    saves: 0,
    runs: [],
  };
}

export const stageIndex = (s: Stage): number => STAGES.indexOf(s);
export const atLeast = (s: DirectorV2State, want: Stage): boolean => stageIndex(s.stage) >= stageIndex(want);

/** Hash of the phrase list (text + part + keyword) — what TTS and the board are keyed on. */
export function phrasesHash(phrases: readonly { text: string; part?: string; keyword?: string }[]): string {
  const h = createHash("sha256");
  for (const p of phrases) h.update(`${p.part ?? ""}\u0000${p.keyword ?? ""}\u0000${p.text}\u0001`);
  return h.digest("hex").slice(0, 32);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function addTokens(a: Tokens, b: Partial<Tokens> | undefined): Tokens {
  const n = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
  return { input: a.input + n(b?.input), output: a.output + n(b?.output), cacheRead: a.cacheRead + n(b?.cacheRead), cacheCreate: a.cacheCreate + n(b?.cacheCreate) };
}

export async function loadStateV2(jobDir: string): Promise<DirectorV2State> {
  try {
    const s = JSON.parse(await readFile(path.join(jobDir, STATE_FILE), "utf8")) as Partial<DirectorV2State>;
    if (s.v !== 2) return emptyStateV2();
    const e = emptyStateV2();
    return {
      ...e,
      ...s,
      tokens: { ...e.tokens, ...(s.tokens ?? {}) },
      stage: STAGES.includes(s.stage as Stage) ? (s.stage as Stage) : "research",
      runs: Array.isArray(s.runs) ? s.runs : [],
      judgeRuns: Array.isArray(s.judgeRuns) ? s.judgeRuns : [],
      badges: Array.isArray(s.badges) ? s.badges.filter((b) => typeof b === "string") : [],
    };
  } catch {
    return emptyStateV2();
  }
}

let writeSeq = 0;
/** Atomic (tmp + rename) like v1 atomicWrite, but with a per-write unique tmp name: the live checkpoint and a tool's
 *  commit can write director-v2.json in the same millisecond, and v1's `${pid}-${Date.now()}` tmp names collide. */
export async function saveStateV2(jobDir: string, s: DirectorV2State): Promise<void> {
  const file = path.join(jobDir, STATE_FILE);
  await mkdir(jobDir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${++writeSeq}-${randomBytes(3).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o644 });
  await rename(tmp, file);
}

/** The director's OWN turns (all runs): turnsUsed minus the gate (judge + fact-check) turns. */
export function directorTurnsV2(s: Pick<DirectorV2State, "turnsUsed" | "judgeTurns">): number {
  return Math.max(0, s.turnsUsed - s.judgeTurns);
}

/** W3.2 r1: turns the DIRECTOR has left under REEL_V2_MAX_TURNS_PER_JOB. Gate turns (judge, fact check, shortener,
 *  on-screen check) have their own budget (remainingGateTurnsV2) — evergreen-tls w32 r1 spent 31 of its 110 turns
 *  in the gates and hit the cap before it ever rendered a still. */
export function remainingTurnsV2(s: Pick<DirectorV2State, "turnsUsed" | "judgeTurns">, budget: number): number {
  return Math.max(0, budget - directorTurnsV2(s));
}

/** Gate turns left under REEL_V2_MAX_GATE_TURNS_PER_JOB. */
export function remainingGateTurnsV2(s: Pick<DirectorV2State, "judgeTurns">, budget: number): number {
  return Math.max(0, budget - s.judgeTurns);
}

/** Book one finished (or failed) director SDK run. `run.costUsd` / `run.tokens` must already be the run's own
 *  spend (see sdkDelta). Saves are counted by save_job itself, not here. */
export function recordRunV2(s: DirectorV2State, run: V2Run, sessionId?: string, totals?: SessionTotals): DirectorV2State {
  return {
    ...s,
    sessionId: sessionId ?? s.sessionId,
    turnsUsed: s.turnsUsed + Math.max(0, run.turns),
    costUsd: round6(s.costUsd + Math.max(0, run.costUsd)),
    tokens: addTokens(s.tokens, run.tokens),
    wallSec: Math.round((s.wallSec + Math.max(0, run.wallSec)) * 10) / 10,
    runs: [...s.runs, run].slice(-20),
    ...(totals ? { sessionTotals: totals } : {}),
  };
}

const subTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: Math.max(0, a.input - b.input),
  output: Math.max(0, a.output - b.output),
  cacheRead: Math.max(0, a.cacheRead - b.cacheRead),
  cacheCreate: Math.max(0, a.cacheCreate - b.cacheCreate),
});

/**
 * The run's own spend from the SDK result. A resumed session "continues from the total its transcript saved"
 * (sdk.d.ts), so on a resume of the same session the result carries the earlier runs too: book new − last. When the
 * resumed result is BELOW the last total the transcript had no totals (the SDK started from 0): book it as is and
 * keep a running sum so a later cumulative report still subtracts correctly.
 */
export function sdkDelta(
  prev: SessionTotals | undefined,
  resumed: string | undefined,
  sessionId: string | undefined,
  raw: { costUsd: number; tokens: Tokens } | null,
): { costUsd: number; tokens: Tokens; totals?: SessionTotals } {
  if (!raw) return { costUsd: 0, tokens: emptyTokens(), totals: undefined };
  const sid = sessionId ?? resumed;
  if (resumed && prev && prev.sessionId === resumed) {
    if (raw.costUsd + 1e-9 >= prev.costUsd) {
      return { costUsd: round6(raw.costUsd - prev.costUsd), tokens: subTokens(raw.tokens, prev.tokens), totals: sid ? { sessionId: sid, costUsd: raw.costUsd, tokens: raw.tokens } : undefined };
    }
    return { costUsd: raw.costUsd, tokens: raw.tokens, totals: sid ? { sessionId: sid, costUsd: round6(prev.costUsd + raw.costUsd), tokens: addTokens(prev.tokens, raw.tokens) } : undefined };
  }
  return { costUsd: raw.costUsd, tokens: raw.tokens, totals: sid ? { sessionId: sid, costUsd: raw.costUsd, tokens: raw.tokens } : undefined };
}

/** A revise is a new phase: per-phase gate counters start again so the draft's refusals cannot make a revise fatal
 *  or unlock a gate on its first failure. (A nudge continues its phase and keeps them.) */
export function startPhaseV2(s: DirectorV2State, phase: V2Phase | "nudge"): DirectorV2State {
  if (phase !== "revise") return s;
  return { ...s, gateRejections: 0, rubricRejections: 0, groundingRejections: 0, quoteRejections: 0, mechanismRejections: 0, mechanismErrors: 0, paceRefusals: 0, failedBoards: 0, ttsRuns: 0, saveRefusals: 0, saveGateRefusals: 0, hookPrechecks: 0, storyRejections: 0, clarityRejections: 0, physicsRejections: 0, scoreCalls: 0, bestScript: undefined, boardedInPhase: false };
}

/** Book one fresh-judge run (its turns count toward the job turn cap, its $ toward the notional $). */
export function recordJudgeRun(s: DirectorV2State, run: JudgeRun & { tokens?: Partial<Tokens> }): DirectorV2State {
  // (kind "factcheck" runs are booked the same way: their turns and $ count toward the job caps)
  const { tokens, ...rest } = run;
  return {
    ...s,
    turnsUsed: s.turnsUsed + Math.max(0, run.turns),
    judgeTurns: s.judgeTurns + Math.max(0, run.turns),
    costUsd: round6(s.costUsd + Math.max(0, run.costUsd)),
    tokens: addTokens(s.tokens, tokens),
    judgeRuns: [...s.judgeRuns, rest].slice(-20),
  };
}

/** Add a badge once. */
export function withBadge(s: DirectorV2State, badge: string): DirectorV2State {
  return s.badges.includes(badge) ? s : { ...s, badges: [...s.badges, badge.slice(0, 300)] };
}

/** W5: §13 critic rounds per JOB (critic.ts): a fail returns the fixes; the last failing round saves NOT READY. */
export const MAX_CRITIC_ROUNDS = 2;
/** W5 fr1: infrastructure retries of the critic per JOB (the model did not run: SDK error, abort, no still shown) —
 *  an unchanged save_job re-runs it this many times without using a round; after that the job saves NOT READY. */
export const CRITIC_INFRA_RETRIES = 1;

/** W5: what a §13 critic pass is bound to — the board's per-beat signatures + the WHOLE board (W5 fr1: boardHash, the
 *  render-relevant top-level fields too: stations, camera0, captions.layout, datafield, header*, cover, blur, music —
 *  a re-board that only moved a station or flipped the caption layout kept the old PASS) + the script + the words it
 *  was voiced with (critic.ts; here so the pipeline can tell a stale verdict without loading the SDK). */
export function criticKey(s: Pick<DirectorV2State, "boardSigs" | "scriptHash" | "wordsForHash" | "boardHash">): string {
  const sigs = Object.entries(s.boardSigs ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify({ sigs, script: s.scriptHash ?? "", words: s.wordsForHash ?? "", ...(s.boardHash ? { board: s.boardHash } : {}) })).digest("hex").slice(0, 24);
}

/** W5 fr1: canonical hash of every render-relevant field of a validated board — the whole storyboard with each beat's
 *  `phrase` left out (the phrases are bound by scriptHash) and object keys sorted, so key order never matters. */
export function boardContentHash(sb: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]));
    return v;
  };
  const o = sb && typeof sb === "object" ? (sb as Record<string, unknown>) : {};
  const beats = Array.isArray(o.beats) ? o.beats.map((b) => (b && typeof b === "object" ? { ...(b as Record<string, unknown>), phrase: undefined } : b)) : o.beats;
  return createHash("sha256").update(JSON.stringify(canon({ ...o, beats }))).digest("hex").slice(0, 24);
}
