// Director v2 seams (W3 P3). P5 (bot/pipeline v2) imports these types; the director implements DirectorV2Module.
// The heavy collaborators (fresh rubric judge P1, edge-tts P2, Lambda review stills P2) are injected as functions
// so tests drive the whole tool chain with fakes; src/director/v2/defaults.ts wires the real modules.
//
// Job dir layout written by the v2 director (all inside jobs/<jobId>/, filenames are constants):
//   director-v2.json   state (session, turns, $, tokens, stage machine, counters)      state.ts
//   research.json      research ledger (shared with v1's format; only 2xx pages ≥200 chars) ../research.ts
//   pages/             text of every counted page (claims are checked against it)       research.ts
//   grounding.json     fact quotes + phrase → fact map of the accepted script           submit_script
//   factcheck.json     last fact-check verdicts (fresh no-tools pass)                    submit_script
//   mechanism.json     last whole-reel mechanism check (chain, findings, refusal n)       submit_script (W3.3)
//   clarity.json       last plain-language check (restatement, comparison, gaps)         score_script (W7)
//   prop-grounding.json on-screen text grounding of the last submitted board (gaps, lines, verdicts) submit_storyboard
//   submit-check.json  last submit_script gate outcome: gate, refusal n, gaps, warnings  submit_script
//   script.v2.json     the accepted ScriptV2                                            submit_script
//   score.json         last rubric result (judge + proxies)                             score_script
//   audio/ words.json  per-beat edge-tts mp3 cache + v2 words.json                      synthesize_tts
//   storyboard.json    last saved storyboard (no block lints)                           submit_storyboard
//   stills/            review stills (keyword frames)                                   render_stills
//   script.md rubric.json lint.json lint.txt review.json   the saved job (review = stills ack)  save_job
//   failure.json       why a fail-closed gate ENDED the job (JobFailure, = DirectorV2Error.failure) submit_script/save_job
//   director-v2-tools.log   canUseTool decisions (audit)

import type { WordsFileT, Storyboard } from "../../schema/storyboard.v2.js";
import type { ScriptV2 } from "../../schema/script.v2.js";
import type { LintReport } from "../../v2/lints.js";
import type { SafeFetchOptions } from "../webfetch.js";
import type { ReviewStillsOptions, StillBatchResult } from "../../v2/ops/stills.js";
import type { TtsWordsOptions } from "../../v2/ops/tts.js";
import type { RubricResult } from "./rubric.js";
import type { JudgeResult, RunJudgeArgs } from "./judge.js";
import type { FactCheckArgs, FactCheckResult, MechanismCheckArgs, MechanismCheckResult, MechanismFinding, ShortenFixArgs, ShortenFixResult } from "./research.js";
import type { AutoFixDecision, AutoFixRec, ReviewAck, Tokens } from "./state.js";
import type { FactCheckV3Args, FactCheckV3Result } from "./factcheck.js";
import type { ClarityArgs, ClarityResult } from "./clarity.js";
import type { PhysicsArgs, PhysicsResult } from "./physics.js";

export type { RubricResult };

export type { Tokens };

export interface UsageV2 {
  /** Director + judge turns. W3.2 r1: the director cap counts turns − judgeTurns; judgeTurns has its own cap. */
  turns: number;
  judgeTurns: number;
  /** Judge + fact-check runs. */
  judgeRuns: number;
  /** Fact-check runs among judgeRuns (optional for older producers). */
  factCheckRuns?: number;
  /** Notional $ (director + judge; subscription, not billed). */
  costUsd: number;
  tokens: Tokens;
  wallSec: number;
  lambdaUsd: number;
  stillsRendered: number;
  runs: Array<{ phase: string; turns: number; costUsd: number; subtype: string; saved: boolean }>;
}

export interface DirectorV2Draft {
  jobId: string;
  jobDir: string;
  slug: string;
  title: string;
  codename: string;
  script: ScriptV2;
  storyboard: Storyboard;
  words: WordsFileT;
  rubric: RubricResult;
  lint: {
    ok: boolean;
    blocked: boolean;
    counts: LintReport["counts"];
    stats?: LintReport["stats"];
    /** The most severe findings, one line each (≤ 8). */
    top: string[];
    /** All findings (for the card's own sorting). */
    findings: Array<{ id: string; severity: "block" | "error" | "warn"; message: string; beatId?: string }>;
  };
  stills: Array<{ beatId: string; frame: number; file: string }>;
  research: {
    searches: number;
    /** CITED pages that were read (W3.1: uncited reading no longer counts), and their sites. */
    pages: number;
    sites: number;
    /** Every counted page read, cited or not. */
    pagesRead?: number;
    gaps: string[];
    /** Claim grounding: facts with a verified quote / all facts, and the fact-check lines still flagged (≤ 8). */
    grounding?: { quotedFacts: number; facts: number; flagged: string[] };
  };
  /** Red badges: rubric below floor, research below floor, residual block/error lints, stills skipped. (W3.1: an
   *  unresolved fact check or a failed save gate never reaches a draft — the job fails with DirectorV2Error.failure.) */
  badges: string[];
  /** The director's acknowledgement of the latest stills review (review.json): beats checked, issues seen + status. */
  review?: ReviewAck;
  /** W3.1 r1 automatic fact-check rewrites in the stored script, and (W3.2) every auto-fix decision incl. the ones
   *  NOT applied with why (state.autoFixes / autoFixDecisions). */
  autoFixes?: AutoFixRec[];
  autoFixDecisions?: AutoFixDecision[];
  /** W3.3: the whole-reel mechanism check of the saved script (mechanism.json): the causal chain as the fresh judge
   *  heard it and its non-material remarks. Absent = no mechanism checker configured (tests / older jobs). */
  mechanism?: { chain: string; nits: string[] };
  /** ≤ 5 short notes for the thread. */
  notes: string[];
  usage: UsageV2;
  sessionId?: string;
}

export interface DirectorV2Module {
  /** First draft from the owner's prompt (untrusted → wrapped by the prompt module). */
  draft(jobId: string, prompt: string, signal?: AbortSignal): Promise<DirectorV2Draft>;
  /** Revise after owner feedback (untrusted). Resumes the same session; shares the job's turn and $ caps. */
  revise(jobId: string, feedback: string, signal?: AbortSignal): Promise<DirectorV2Draft>;
}

// ── injected collaborators ──────────────────────────────────────────────────────────────────────────────────────

/** Fresh-context rubric judge — P1 runJudge (src/director/v2/judge.ts): sees ONLY the script (phrases, timings,
 *  fact sheet), no director context, no tools. A JudgeError carries the turns/$ spent before it failed. */
export type JudgeFn = (args: RunJudgeArgs) => Promise<JudgeResult>;

/** Real edge-tts — P2 ttsWords(beats, jobDir, {log, signal}) (src/v2/ops/tts.ts). */
export type TtsFn = (beats: readonly { id: string; phrase: string }[], jobDir: string, opts?: TtsWordsOptions) => Promise<WordsFileT>;

/** Lambda review stills on the dev site, ledger-guarded — P2 renderReviewStills (src/v2/ops/stills.ts). */
export type StillsFn = (o: ReviewStillsOptions) => Promise<StillBatchResult>;

/** Fresh no-tools fact-check pass (research.ts runFactCheck): each phrase vs its facts' quotes + page excerpts. */
export type FactCheckFn = (args: FactCheckArgs) => Promise<FactCheckResult>;

/** W3.2: one fresh no-tools call that shortens the checker's over-long rewrites (research.ts runShortenFix) before
 *  they are auto-applied; its output is re-checked like any rewrite (never a pass by itself). Absent = an over-long
 *  rewrite is reported (submit-check.json autoFixDecisions / failure.json), never silently dropped. */
export type ShortenFixFn = (args: ShortenFixArgs) => Promise<ShortenFixResult>;

/** W3.1 r1: the on-screen text fact check — P1 runFactCheckV3 (src/director/v2/factcheck.ts) called with props only
 *  (narration: false). submit_storyboard refuses a board whose sourced screen text is not "supported"; save_job
 *  requires the stored board's check to have passed (state.propCheckedHash). */
export type PropFactCheckFn = (args: FactCheckV3Args) => Promise<FactCheckV3Result>;

/** W3.3: the whole-reel MECHANISM check (research.ts runMechanismCheck): a fresh no-tools judge reads the whole
 *  script + fact sheet + cited pages and says whether the causal chain is correct, complete and consistent. Runs in
 *  submit_script after the line fact check passed (and again whenever the lines change); a material finding refuses
 *  the submit (own budget, then the job FAILS); save_job needs a current pass (state.mechanismPassedHash). */
export type MechanismCheckFn = (args: MechanismCheckArgs) => Promise<MechanismCheckResult>;
export type { MechanismFinding };

/** W7: the fresh plain-language judge (clarity.ts runClarityCheck): a reader with ONLY the narration restates the
 *  answer; a second reader compares it with the committed story and the source. Absent = not run. */
export type ClarityFn = (args: ClarityArgs) => Promise<ClarityResult>;

/** W7.1: the fresh physics judge (physics.ts runPhysicsCheck) for how-it-works reels: narration + on-screen strings +
 *  drawn digest against established physics / engineering. Absent = not run. */
export type PhysicsFn = (args: PhysicsArgs) => Promise<PhysicsResult>;

export interface DirectorV2Deps {
  /** Injectable SDK entry point (see index.ts QueryImplV2). */
  queryImpl?: import("./index.js").QueryImplV2;
  judge?: JudgeFn;
  tts?: TtsFn;
  stills?: StillsFn;
  /** Claim fact check; absent = quotes and the phrase→fact map are still checked deterministically. */
  factCheck?: FactCheckFn;
  /** On-screen text fact check; absent = the deterministic prop grounding check only. */
  propFactCheck?: PropFactCheckFn;
  /** Shortener for over-long automatic rewrites; absent = such a rewrite is reported, not applied. */
  shortenFix?: ShortenFixFn;
  /** Whole-reel mechanism check; absent = not run (and not required by save_job). Production always wires it. */
  mechanismCheck?: MechanismCheckFn;
  /** W5: the independent §13 vision critic (critic.ts runCritic); absent = save_job does not run it. */
  critic?: import("./tools.js").CriticFn;
  /** W7: the plain-language gate in score_script (scripts with a story); production wires it (defaults.ts). */
  clarity?: ClarityFn;
  /** W7.1: the physics judge in submit_storyboard + save_job (how-it-works reels); production wires it (defaults.ts). */
  physics?: PhysicsFn;
  fetch?: SafeFetchOptions;
  log?: (line: string) => void;
}
