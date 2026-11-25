// W7 plain-language gate (the semantic half of the story-first gate; story.ts is the deterministic half).
//
// Two fresh, no-tools calls, each with none of the director's context:
//   1. RESTATE — the reader sees ONLY the narration (no story, no sources, no part tags, no CTA) and must say, in one
//      sentence each, what question the video answers and what the answer is (plus words it would not understand).
//   2. COMPARE — a second reader gets the committed story (question / answer / outline), the source's own wording of
//      the answer (the quotes of story.answerFact), the numbered narration and the restatement, and decides:
//      does the restated answer say the same thing as the committed answer; does the climax match the source's own
//      answer; which beats open a second thread (serve something other than that answer).
// The script is refused (score_script, own budget) with the restatement as feedback when the reader could not
// restate it, restated it wrong, or a beat opens a second thread (W7.1: a beat defining a declared term is not one,
// a defined term is not "unclear", and a climax that may not match the source is a warning only — touchscreen was
// refused twice with a matching restatement for defining "capacitance").

import { authEnv, defaultToken } from "../../auth.js";
import { mkdir } from "node:fs/promises";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ScriptV2 } from "../../schema/script.v2.js";
import { phraseBeatId } from "../../schema/script.v2.js";
import { escapeXml } from "../webfetch.js";
import { DEFAULT_JUDGE_MODEL } from "./judge.js";
import { askJudge } from "./mechanism.js";

export const CLARITY_FILE = "clarity.json";
export const CLARITY_BADGE_PREFIX = "clarity:";
/** score_script refusals by this gate per phase, then the script goes on with a red badge. */
export const MAX_CLARITY_REJECTIONS = 2;
/** Re-asks after a malformed reply (per call). */
export const CLARITY_MAX_REPAIRS = 1;
const MAX_FIELD = 400;

export class ClarityError extends Error {
  turns = 0;
  costUsd = 0;
}

export interface ClarityInput {
  /** Narration lines in order (CTA excluded) — the ONLY thing the restating reader sees. */
  narration: string[];
  /** Numbered lines with part tags (compare call only). */
  beats: Array<{ beat: string; part: string; text: string }>;
  question: string;
  answer: string;
  outline: Array<{ beats: string[]; point: string }>;
  /** The source's own wording of the answer (verbatim quotes of story.answerFact). */
  sourceAnswer: string[];
  sourceTitle?: string;
  /** W7.1: declared story.terms with the beat that defines each — a defined term is not "unclear", and its defining
   *  beat is not a second thread. */
  terms?: Array<{ term: string; beat: string }>;
}

export function buildClarityInput(script: ScriptV2, grounding: { quotes: ReadonlyArray<{ fact: string; quote: string }> } | null): ClarityInput | null {
  const st = script.story;
  if (!st) return null;
  const body = script.phrases.map((p, i) => ({ beat: phraseBeatId(i), part: p.part, text: p.text })).filter((b) => b.part !== "cta");
  const fact = script.facts.find((f) => f.id === st.answerFact);
  const src = fact ? script.sources.find((s) => s.id === fact.sourceId) : undefined;
  const quotes = (grounding?.quotes ?? []).filter((q) => q.fact === st.answerFact).map((q) => q.quote);
  return {
    narration: body.map((b) => b.text),
    beats: body,
    question: st.question,
    answer: st.answer,
    outline: st.outline.map((o) => ({ beats: [...o.beats], point: o.point })),
    sourceAnswer: quotes.length ? quotes : fact ? [fact.claim] : [],
    ...(src ? { sourceTitle: src.title } : {}),
    terms: st.terms.map((t) => ({ term: t.term, beat: t.beat })),
  };
}

export const RESTATE_SYSTEM_PROMPT = `You are a curious, smart 14-year-old who just watched a 70-second explainer video once, with the sound on. You read ONLY its narration below. You have no other information and must not use outside knowledge to fill gaps: if the narration does not say it, you do not know it.
Reply with ONE JSON object and nothing else:
{"question":"the one question this video answers, in one plain sentence","answer":"the answer it gives, in one plain sentence, in YOUR OWN words, using only what the narration said","confident":true|false,"unclear":["up to 5 words or phrases from the narration you would not understand without help"]}
If you cannot tell what the answer is, set "answer" to "" and "confident" to false. Never copy a narration line as your answer.`;

export const COMPARE_SYSTEM_PROMPT = `You check whether a short explainer video tells ONE clear story. You get: the question and answer the writer committed to, the writer's outline, the SOURCE's own wording of the answer, the numbered narration, and a restatement written by a reader who saw only the narration.
Decide:
1. sameAnswer: does the reader's restated answer say the same thing as the committed answer (the same mechanism; extra detail is fine, a different or missing core mechanism is not)?
2. climaxMatchesSource: do the climax lines state the answer the SOURCE gives (same mechanism, no overstatement, not a different cause)?
3. offThread: beats (ids) that do not serve the committed answer — they open a second question or tell a different story. Setup, stakes, the definition of a word the answer uses, limits and surprises that make the answer clearer DO serve it. List only clear cases.
Reply with ONE JSON object and nothing else:
{"sameAnswer":true|false,"why":"one sentence","climaxMatchesSource":true|false,"climaxWhy":"one sentence","offThread":[{"beat":"b07","why":"one short sentence"}]}`;

const tag = (name: string, body: string) => `<${name}>\n${escapeXml(body)}\n</${name}>`;

export function restatePrompt(i: Pick<ClarityInput, "narration">): string {
  return `${tag("narration", i.narration.join("\n"))}\nReply with the JSON object only.`;
}

export function comparePrompt(i: ClarityInput, r: RestateReply): string {
  return [
    tag("committed_question", i.question),
    tag("committed_answer", i.answer),
    tag("outline", i.outline.map((o) => `${o.beats.join(",")}: ${o.point}`).join("\n")),
    tag("source_answer", `${i.sourceTitle ? `${i.sourceTitle}: ` : ""}${i.sourceAnswer.join(" … ") || "(no quote)"}`),
    tag("narration", i.beats.map((b) => `${b.beat} [${b.part}] ${b.text}`).join("\n")),
    tag("reader_restatement", `question: ${r.question}\nanswer: ${r.answer || "(could not tell)"}`),
    "Reply with the JSON object only.",
  ].join("\n");
}

export interface RestateReply {
  question: string;
  answer: string;
  confident: boolean;
  unclear: string[];
}
export interface CompareReply {
  sameAnswer: boolean;
  why: string;
  climaxMatchesSource: boolean;
  climaxWhy: string;
  offThread: Array<{ beat: string; why: string }>;
}

/** The first balanced {...} in a reply, parsed (null when there is none). */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  const s = String(text ?? "");
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          const v = JSON.parse(s.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          /* try the next brace */
        }
        break;
      }
    }
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : "");

export function parseRestate(text: string): RestateReply | null {
  const o = firstJsonObject(text);
  if (!o || typeof o.question !== "string" || typeof o.answer !== "string") return null;
  return { question: str(o.question), answer: str(o.answer), confident: o.confident !== false && !!str(o.answer), unclear: Array.isArray(o.unclear) ? o.unclear.map(str).filter(Boolean).slice(0, 5) : [] };
}

export function parseCompare(text: string, beatIds: ReadonlySet<string>): CompareReply | null {
  const o = firstJsonObject(text);
  if (!o || typeof o.sameAnswer !== "boolean" || typeof o.climaxMatchesSource !== "boolean") return null;
  const off = Array.isArray(o.offThread) ? o.offThread : [];
  return {
    sameAnswer: o.sameAnswer,
    why: str(o.why),
    climaxMatchesSource: o.climaxMatchesSource,
    climaxWhy: str(o.climaxWhy),
    offThread: off
      .map((x) => (x && typeof x === "object" ? { beat: str((x as { beat?: unknown }).beat), why: str((x as { why?: unknown }).why) } : null))
      .filter((x): x is { beat: string; why: string } => !!x && beatIds.has(x.beat))
      .slice(0, 8),
  };
}

export interface ClarityResult {
  ok: boolean;
  /** Refusal lines (empty when ok). */
  gaps: string[];
  /** W7.1: notes that never refuse (the climax vs the source's own answer — the fact check and the physics judge own that). */
  warnings?: string[];
  restated: RestateReply | null;
  compare: CompareReply | null;
  turns: number;
  costUsd: number;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

/** A word the reader flagged that the narration defines (a declared story.terms term) — not "unclear". */
const isDefined = (word: string, terms: ReadonlyArray<{ term: string }>) => {
  const w = word.toLowerCase().trim();
  return terms.some((t) => {
    const x = t.term.toLowerCase().trim();
    return w === x || w.includes(x) || x.includes(w);
  });
};

/** The refusal lines for a restatement + comparison (pure; tested). W7.1: refused only when the restated answer is
 *  missing or wrong, or a beat opens a second thread; a beat that defines a declared term is never a second thread,
 *  a defined term is never "unclear", and a climax-vs-source mismatch is a warning (clarityWarnings). */
export function clarityGaps(r: RestateReply | null, c: CompareReply | null, i: Pick<ClarityInput, "answer"> & Partial<Pick<ClarityInput, "terms">>): string[] {
  const terms = i.terms ?? [];
  const defining = new Set(terms.map((t) => t.beat));
  const gaps: string[] = [];
  if (!r || !r.answer || !r.confident)
    gaps.push(`a fresh reader who heard ONLY the narration could not say what the answer is${r?.answer ? ` (unsure: "${r.answer}")` : ""}${r?.question ? `; they thought the question was "${r.question}"` : ""} — state the answer plainly at the climax and build every beat toward it`);
  else if (c && !c.sameAnswer)
    gaps.push(`a fresh reader who heard ONLY the narration restated the answer as "${r.answer}" — not your answer "${i.answer}" (${c.why || "different mechanism"}): the narration must make YOUR answer the obvious takeaway`);
  for (const o of c?.offThread ?? []) if (!defining.has(o.beat)) gaps.push(`${o.beat} opens a second thread (${o.why}): make it serve the answer or cut it`);
  const unclear = (r?.unclear ?? []).filter((u) => !isDefined(u, terms));
  if (gaps.length && unclear.length) gaps.push(`words that reader did not understand: ${unclear.map((u) => `"${u}"`).join(", ")} — define or replace them`);
  return gaps;
}

/** Non-refusing clarity notes (W7.1): the climax vs the source's own answer. */
export function clarityWarnings(c: CompareReply | null): string[] {
  return c && !c.climaxMatchesSource ? [`the climax may not state the source's own answer (${c.climaxWhy || "different or overstated"}) — say what the source says the answer is`] : [];
}

export interface ClarityArgs {
  input: ClarityInput;
  claudeDir: string;
  oauthToken?: string;
  model?: string;
  signal?: AbortSignal;
  log?: (l: string) => void;
  queryImpl?: (a: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
}

export async function runClarityCheck(args: ClarityArgs): Promise<ClarityResult> {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  const model = args.model ?? (process.env.REEL_V2_CLARITY_MODEL?.trim() || process.env.REEL_V2_JUDGE_MODEL?.trim() || DEFAULT_JUDGE_MODEL);
  const token = args.oauthToken ?? defaultToken();
  if (!token) throw new ClarityError("CLAUDE_CODE_OAUTH_TOKEN is not set");
  await mkdir(args.claudeDir, { recursive: true });
  const queryImpl = args.queryImpl ?? ((a: { prompt: string; options: Options }) => query(a));
  let turns = 0;
  let costUsd = 0;
  const fail = (m: string) => Object.assign(new ClarityError(m), { turns: Math.max(turns, 1), costUsd });
  async function ask<T>(systemPrompt: string, prompt: string, parse: (t: string) => T | null): Promise<T | null> {
    let p = prompt;
    for (let n = 0; n <= CLARITY_MAX_REPAIRS; n++) {
      const r = await askJudge({ prompt: p, systemPrompt, model, oauthToken: token, claudeDir: args.claudeDir, maxTurns: 2, signal: args.signal, log: args.log, queryImpl }, usage);
      turns += r.turns;
      costUsd += r.costUsd;
      if (args.signal?.aborted) throw fail("clarity check aborted");
      if (r.thrown && !r.sawResult) throw fail(`clarity check SDK error: ${r.error}`);
      const v = parse(r.text);
      if (v) return v;
      p = `${prompt}\n\nYour previous reply was not the JSON object. Reply with the JSON object only.`;
    }
    return null;
  }
  const restated = await ask(RESTATE_SYSTEM_PROMPT, restatePrompt(args.input), parseRestate);
  if (!restated) throw fail("clarity check: the restating reader gave no usable reply");
  const ids = new Set(args.input.beats.map((b) => b.beat));
  const compare = restated.answer ? await ask(COMPARE_SYSTEM_PROMPT, comparePrompt(args.input, restated), (t) => parseCompare(t, ids)) : null;
  if (restated.answer && !compare) throw fail("clarity check: the comparing reader gave no usable reply");
  const gaps = clarityGaps(restated, compare, args.input);
  const warnings = clarityWarnings(compare);
  args.log?.(`clarity: restated "${restated.answer.slice(0, 120)}" → ${gaps.length ? `${gaps.length} gap(s)` : "ok"}${warnings.length ? ` (+${warnings.length} warning)` : ""}`);
  return { ok: !gaps.length, gaps, warnings, restated, compare, turns, costUsd, usage };
}
