// R5 script rubric v2 — a faithful TypeScript port of research/r5/rubric_proxy.py (spec: research/notes/R5-script-rubric.md
// §4). Pure: no I/O, no clock, no randomness.
//
//   effective[R] = min(self, judge ?? 3, proxy cap[R]);  R1 and R6 count double;  max 42.
//   pass = every HARD format gate ok AND total >= RUBRIC_MIN_TOTAL AND every floor met.
//
// Two layers:
//  - scoreRubricInput(input, {wps, useFormat}) is the line-for-line port of python score(): same proxies, same caps,
//    same messages, same totals. test/v2-rubric.test.ts checks parity against `python3 -I rubric_proxy.py --json`.
//  - scoreRubric({script, judge, timings, storyboard}) is the v2 entry point: ScriptV2 self-scores + fresh-judge scores
//    + timings (pre-TTS estimate or real words.json) + optional post-storyboard R6/R12 checks, with id-tagged gates.
//
// Regex note: python's `re` is Unicode-aware (\b, \w, \d); JS's are ASCII. rx() rewrites \b, \w and \d into Unicode
// equivalents (u flag) so e.g. "café" and non-ASCII digits behave as in python.

import { NARRATION_WORD, PACE_METRIC, phraseBeatId, spokenWords, RUBRIC_IDS, toRubricInput, type RubricId, type RubricInput, type ScriptV2 } from "../../schema/script.v2.js";
import type { WordsFileT } from "../../schema/storyboard.v2.js";
import { GAP_MS, TAIL_MS } from "../../v2/timeline.js";
import { LIBRARY_IDS } from "../../v2/registry.gen.js";

export const RUBRIC_MIN_TOTAL = 32;
export const RUBRIC_MAX_TOTAL = 42;
export const RUBRIC_FLOORS: Readonly<Partial<Record<RubricId, number>>> = Object.freeze({ R1: 2, R6: 2, R8: 2, R9: 3, R11: 2 });
export const RUBRIC_WEIGHTS: Readonly<Partial<Record<RubricId, number>>> = Object.freeze({ R1: 2, R6: 2 });
export const RUBRIC_EST_WPS = 2.9;
export const MAX_RUBRIC_REJECTIONS = 3;
export { RUBRIC_IDS };
export type { RubricId };

export interface Criterion {
  id: RubricId;
  name: string;
  weight: 1 | 2;
  /** Descriptors for score 3, 2, 1, 0 (index = score). "—" where R5 defines no level. */
  levels: [string, string, string, string];
}

/** R5 §4 table (judge prompt + Script card). levels[n] describes score n. */
export const CRITERIA: readonly Criterion[] = Object.freeze([
  { id: "R1", name: "Hook", weight: 2, levels: ["banned opener (did you know, have you ever wondered, today we...) or abstract", "concrete but flat (\"TLS secures the web\")", "first sentence <=24 words; concrete; tension present", "first sentence <=12 words; names something concrete the viewer owns or knows; real tension (paradox, misconception flip, concrete consequence)"] },
  { id: "R2", name: "Viewer in it", weight: 1, levels: ["event: no \"you\" at all", "concept: no \"you\" in sentences 1-2 (never valid for an event reel)", "concept: generic \"you\" in sentences 1-2; event: \"you\" only later", "concept: \"your <object>\" in sentences 1-2 (event: \"you\" early)"] },
  { id: "R3", name: "Stakes number", weight: 1, levels: ["—", "vague or unsourced number, or no number in the stakes", "a sourced number, but untranslated, or a crowded stakes section", "one sourced hero number with a comparison next to it"] },
  { id: "R4", name: "Answer seed", weight: 1, levels: ["the whole mechanism dumped up front", "the answer comes later than 30 s, or never", "a one-line answer by 30 s", "a one-line answer (not a label) by 20 s, with the \"how\" still open"] },
  { id: "R5", name: "Second question / re-hook", weight: 1, levels: ["no twist / second question", "a statement-only pivot", "a real question outside 12-30 s", "a real question (\"?\") at 12-30 s that is better than the hook"] },
  { id: "R6", name: "Mechanism: one change per phrase", weight: 2, levels: ["definitions and jargon lists", "compound, listy or repetitive phrases", "mostly one change per phrase, or 6-7 / 17-18 mechanism phrases", "8-16 mechanism phrases, each one storyboard change, a causal chain, one contrast image"] },
  { id: "R7", name: "Jargon budget", weight: 1, levels: [">=6 distinct acronyms", "4-5 acronyms", "3 acronyms", "<=2 distinct acronyms beyond the topic terms, each defined or drawn"] },
  { id: "R8", name: "Ear rhythm", weight: 1, levels: ["three items off", "two items off", "one item off", "phrases 2-14 words, no sentence >20 words, 2.6-3.2 words/s"] },
  { id: "R9", name: "Facts sourced", weight: 1, levels: ["any sourceable number missing from the fact sheet", "—", "—", "every sourceable number (digits, million/percent..., \"N in M\", \"N times\") appears in a fact-sheet claim"] },
  { id: "R10", name: "Climax line", weight: 1, levels: ["—", "climax line missing or >9 words", "climax line 7-9 words", "a climax phrase of <=6 words"] },
  { id: "R11", name: "Closure", weight: 1, levels: ["—", "no closure", "closure present but shares nothing with the hook and is not a flip", "the closing lines answer, flip or (event) give the implication of the hook"] },
  { id: "R12", name: "Visualisability", weight: 1, levels: ["talking head", "several abstract phrases", "1-2 weak phrases", "every phrase has a drawable keyword that occurs in its text"] },
] as Criterion[]);

// ── python-compatible regex helpers ──────────────────────────────────────────────────────────────────────────────

const W = "[\\p{L}\\p{N}_]";
/** Python-`re`-like regex: Unicode \b, \w, \d. */
function rx(src: string, flags = ""): RegExp {
  const s = src
    .replace(/\\b/g, `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`)
    .replace(/\\w/g, W)
    .replace(/\\d/g, "\\p{Nd}");
  return new RegExp(s, flags.includes("u") ? flags : flags + "u");
}
const all = (re: RegExp, s: string): string[] => [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].map((m) => m[0]);
const fullmatch = (re: RegExp, s: string) => new RegExp(`^(?:${re.source})$`, re.flags.replace("g", "")).test(s);

const NUMWORD =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|" +
  "sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|" +
  "hundred|hundreds|thousand|thousands|million|millions|billion|billions|trillion|half|percent|dozen|dozens";
export const NUM = rx(`(?<![A-Za-z0-9.])\\d+(?:[.,]\\d+)*%?|\\b(?:${NUMWORD})\\b`, "i");
export const SOURCEABLE = rx(
  `(?<![A-Za-z0-9.])\\d+(?:[.,]\\d+)*%?|\\b(?:hundred|hundreds|thousand|thousands|million|millions|billion|billions|trillion|percent|dozens)\\b` +
    `|\\b(?:${NUMWORD})\\s+in\\s+(?:${NUMWORD}|\\d+)\\b|\\b(?:${NUMWORD})\\s+times\\b`,
  "i",
);
export const COMPARE = rx(
  `\\b(?:\\w+er than|than (?:a|an|the|you|your|it|they)\\b|times (?:more|less|bigger|smaller|faster|slower|longer|as)` +
    `|as \\w+ as|the size of|enough to|equivalent to|the same as|roughly the|longer than|that's (?:about|roughly|like|more|less|almost|over|enough)` +
    `|picture |imagine ` +
    `|\\b(?:${NUMWORD}|\\d[\\d.,]*) \\w+ (?:long|tall|wide|high|deep|heavy|across|away|end to end)\\b)`,
  "i",
);
export const QTY_THAN = rx(`\\b(?:more|less|fewer|over|under|greater) than\\s+(?=(?:\\d|${NUMWORD}))`, "i");
const YOU = rx("\\b(you|your|you're|you'd|you've|yours)\\b", "i");
const YOUR_NOUN = rx("\\byour\\s+([a-z][a-z'-]+)", "i");
const ACRONYM = rx("\\b[A-Z]{2,}[0-9.]*\\b");
const ACRONYM_OK = new Set(["AI", "US", "UK", "EU", "TV", "PC", "OK", "ID", "USB", "GPS", "CEO", "LED", "LEDS", "PS5", "PS3", "GTA", "AM", "PM"]);
const CTA = rx("\\b(follow|subscribe)\\b", "i");
const BANNED_OPENERS = rx("^(have you ever (wondered|thought)|did you know|in this video|let's talk about|today we|so,? |hey|welcome|ever wondered)", "i");
const VAGUE = new Set(
  ("thing things something anything everything stuff lot lots way ways it this that happens happen happened here there really very cool " +
    "interesting important strange weird is are was be then now so just like much many some people world").split(" "),
);
const STOP = new Set(
  ("the a an and or but of to in on at for with from by your you its it's that this these those they their them have has had will would can " +
    "what when where which who how why into than then there here just even about every all also only ever never more most some same does doesn't " +
    "isn't it is are was were be been so too very really actually").split(" "),
);
const CLAUSE_JOINT = rx(",| and | then | while | which ", "i");
const W2N: Record<string, string> = Object.fromEntries("zero one two three four five six seven eight nine ten eleven twelve".split(" ").map((w, i) => [w, String(i)]));
Object.assign(W2N, { twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100", thousand: "1000", million: "1000000", billion: "1000000000", percent: "%" });

/** python str.strip() whitespace. */
const pyStrip = (s: string) => s.replace(/^\s+|\s+$/gu, "");
/** = narrationWords() in src/schema/script.v2.ts (one tokenizer for rubric, card and script.md; W3.1). */
export const words = (t: string): string[] => all(NARRATION_WORD, t);
/** Rhythm-item tokenizer: python `words()` for the parity port, spoken tokens for v2 (RubricInput.spokenTokens). */
const rhythmWords = (s: Pick<RubricInput, "spokenTokens">) => (s.spokenTokens ? spokenWords : words);
export const sentences = (t: string): string[] => pyStrip(t).split(/(?<=[.?!])\s+/u).filter(Boolean);
function stem(w: string): string {
  const x = w.toLowerCase().replace(/^'+|'+$/g, "");
  return x.length > 3 && x.endsWith("s") && !x.endsWith("ss") ? x.slice(0, -1) : x;
}
function content(t: string): Set<string> {
  return new Set(words(t).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()) && !VAGUE.has(w.toLowerCase())).map(stem));
}
export const normNum = (t: string): string => all(rx("[A-Za-z]+|\\d+(?:[.,]\\d+)*%?"), t).map((w) => W2N[w.toLowerCase()] ?? w.toLowerCase()).join(" ");

/** python round(x, nd): exact decimal value of the double, ties to even. */
export function pyRound(x: number, nd = 0): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const s = Math.abs(x).toFixed(80);
  const [ip, fp] = s.split(".");
  const keep = ip + fp.slice(0, nd);
  const rest = fp.slice(nd);
  let n = BigInt(keep);
  const half = "5" + "0".repeat(rest.length - 1);
  if (rest > half || (rest === half && n % 2n === 1n)) n += 1n;
  const v = Number(n) / 10 ** nd;
  return neg ? -v : v;
}

export function isConcrete(sentence: string): [boolean, string] {
  if (NUM.test(sentence)) return [true, "number"];
  const toks = all(/[A-Za-z][A-Za-z0-9'.-]*/, sentence);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (fullmatch(ACRONYM, w) || /[a-z][A-Z]/.test(w)) return [true, `name:${w}`];
    if (i > 0 && /^[A-Z]/.test(w) && !["I", "I'm", "I'd"].includes(w)) return [true, `name:${w}`];
  }
  for (const m of sentence.matchAll(new RegExp(YOUR_NOUN.source, YOUR_NOUN.flags + "g"))) {
    const n = m[1].toLowerCase();
    if (!VAGUE.has(n) && !STOP.has(n)) return [true, `your ${m[1]}`];
  }
  return [false, "none"];
}

// ── proxies (python proxies()) ────────────────────────────────────────────────────────────────────────────────────

export interface Proxies {
  hook_first_sentence_words: number;
  banned_opener: boolean;
  hook_concrete: string | null;
  hook_first_sentence_concrete: boolean;
  you_in_first2: boolean;
  your_noun_in_first2: boolean;
  you_anywhere: boolean;
  stakes_numbers: string[];
  stakes_number_translated: boolean;
  unsourced_numbers: string[];
  stakes_hero_sourced: boolean;
  reveal_at_s: number | null;
  twist_question_at_s: number | null;
  twist_statement_only: boolean;
  mech_phrases: number;
  mech_multi_clause: number;
  mech_empty: number;
  mech_near_duplicate_pairs: number;
  acronyms: string[];
  words_total: number;
  phrases: number;
  phrase_len_outside_2_14: number;
  max_sentence_words: number;
  duration_s: number;
  wps: number | null;
  climax_words: number | null;
  closure_echo: string[] | null;
  closure_judged_flip: boolean;
  phrases_without_keyword_in_text: number;
  has_keywords: boolean;
  cta_indices: number[];
  cta_words: number | null;
  part_order_ok: boolean;
  ask_indices: number[];
  ask_at_s: number[];
}

function phraseTimes(P: RubricInput["phrases"], wps: number, wf: (t: string) => string[] = words): { T: number[]; estEnd: number } {
  let t = 0;
  const T: number[] = [];
  for (const p of P) {
    T.push(p.t !== undefined ? p.t : t);
    t += wf(p.text).length / wps;
  }
  return { T, estEnd: t };
}

const RANK: Record<string, number> = { hook: 0, stakes: 1, reveal: 1, mechanism: 2, context: 3, climax: 3, closure: 3, cta: 4 };

export function proxies(s: RubricInput, wps = RUBRIC_EST_WPS): Proxies {
  const P = s.phrases;
  const topic = new Set((s.topicTerms ?? []).map((x) => x.toUpperCase()));
  const rw = rhythmWords(s);
  const Wc = P.map((p) => rw(p.text).length);
  const { T, estEnd } = phraseTimes(P, wps, rw);
  const dur = s.duration !== undefined ? s.duration : !P.every((p) => p.t !== undefined) ? estEnd : (P[P.length - 1].t as number) + Wc[Wc.length - 1] / wps;
  const parts = P.map((p) => p.part);
  const hookP = P.filter((p) => p.part === "hook");
  const hook = hookP.length ? hookP : P.slice(0, 1);
  const hookText = hook.map((h) => h.text).join(" ");
  const narration = P.map((p) => p.text).join(" ");
  const narrSent = sentences(narration);
  const firstSentence = narrSent[0] ?? "";
  const hc = sentences(hookText).map(isConcrete);
  const first2 = narrSent.slice(0, 2).join(" ");
  const yourNouns = [...first2.matchAll(new RegExp(YOUR_NOUN.source, YOUR_NOUN.flags + "g"))].map((m) => m[1].toLowerCase());

  const stIdx = P.map((p, i) => (p.part === "stakes" ? i : -1)).filter((i) => i >= 0);
  const stNums = stIdx.flatMap((i) => all(NUM, P[i].text).map((n) => [i, n] as const));
  const compares = (i: number) => (i >= 0 && i < P.length ? COMPARE.test(P[i].text.replace(new RegExp(QTY_THAN.source, QTY_THAN.flags + "g"), "")) : false);
  const facts = (s.facts ?? []).map((f) => normNum(f.claim ?? "")).join(" ");
  const sourceable = P.flatMap((p, i) => all(SOURCEABLE, p.text).map((n) => [i, n] as const));
  const stSet = new Set(stIdx);
  const stakesHeroSourced = sourceable.some(([i]) => stSet.has(i)) ? stNums.length > 0 && sourceable.some(([i, n]) => stSet.has(i) && facts.includes(normNum(n))) : stNums.length > 0;

  const rv = P.map((p, i) => (p.part === "reveal" ? T[i] : null)).filter((x): x is number => x !== null);
  const tw = P.map((p, i) => (p.part === "twist" ? ([T[i], p.text] as const) : null)).filter((x) => x !== null);
  const twq = tw.filter(([, txt]) => txt.includes("?")).map(([t]) => t);

  const mech = P.filter((p) => p.part === "mechanism").map((p) => p.text);
  let dups = 0;
  for (let a = 0; a < mech.length; a++)
    for (let b = a + 1; b < mech.length; b++) {
      const A = new Set(words(mech[a]).map((w) => w.toLowerCase()));
      const B = new Set(words(mech[b]).map((w) => w.toLowerCase()));
      if (A.size && B.size) {
        const inter = [...A].filter((w) => B.has(w)).length;
        const uni = new Set([...A, ...B]).size;
        if (inter / uni >= 0.6) dups++;
      }
    }

  const acr = [...new Set(all(ACRONYM, narration).filter((a) => { const k = a.replace(/\.+$/, ""); return !ACRONYM_OK.has(k) && !topic.has(k); }))].sort();
  const wordsTotal = Wc.reduce((a, b) => a + b, 0);
  const cl = P.filter((p) => p.part === "climax").map((p) => p.text);
  const clo = P.filter((p) => p.part === "closure").map((p) => p.text).join(" ");
  const hookContent = content(hookText);
  const ctas = P.map((p, i) => (CTA.test(p.text) ? i : -1)).filter((i) => i >= 0);

  const mechI = parts.map((p, i) => (p === "mechanism" ? i : -1)).filter((i) => i >= 0);
  const ranks: number[] = [];
  parts.forEach((p, i) => {
    if (p === "ask") return;
    if (p === "twist") ranks.push(!mechI.length || i < mechI[0] ? 1 : i < mechI[mechI.length - 1] ? 2 : 3);
    else ranks.push(RANK[p] ?? 9);
  });
  const askIdx = parts.map((p, i) => (p === "ask" ? i : -1)).filter((i) => i >= 0);

  return {
    hook_first_sentence_words: words(firstSentence).length,
    banned_opener: BANNED_OPENERS.test(pyStrip(P[0]?.text ?? "")),
    hook_concrete: hc.find(([ok]) => ok)?.[1] ?? null,
    hook_first_sentence_concrete: hc[0]?.[0] ?? false,
    you_in_first2: YOU.test(first2),
    your_noun_in_first2: yourNouns.some((n) => !VAGUE.has(n) && !STOP.has(n)),
    you_anywhere: P.some((p) => YOU.test(p.text)),
    stakes_numbers: stNums.map(([, n]) => n),
    stakes_number_translated: stNums.some(([i]) => compares(i) || compares(i + 1)),
    unsourced_numbers: sourceable.filter(([, n]) => !facts.includes(normNum(n))).map(([, n]) => n),
    stakes_hero_sourced: stakesHeroSourced,
    reveal_at_s: rv.length ? pyRound(rv[0], 1) : null,
    twist_question_at_s: twq.length ? pyRound(twq[0], 1) : null,
    twist_statement_only: tw.length > 0 && twq.length === 0,
    mech_phrases: mech.length,
    mech_multi_clause: mech.filter((m) => all(CLAUSE_JOINT, m).length >= 2).length,
    mech_empty: mech.filter((m) => content(m).size === 0).length,
    mech_near_duplicate_pairs: dups,
    acronyms: acr,
    words_total: wordsTotal,
    phrases: P.length,
    phrase_len_outside_2_14: Wc.filter((w) => !(w >= 2 && w <= 14)).length,
    max_sentence_words: Math.max(...narrSent.map((z) => rw(z).length)),
    duration_s: pyRound(dur, 1),
    wps: dur ? pyRound(wordsTotal / dur, 2) : null,
    climax_words: cl.length ? words(cl[0]).length : null,
    closure_echo: clo ? [...content(clo)].filter((w) => hookContent.has(w)).sort() : null,
    closure_judged_flip: !!s.closureFlip,
    phrases_without_keyword_in_text: P.filter((p) => !(p.keyword && p.text.toLowerCase().includes(p.keyword.toLowerCase()))).length,
    has_keywords: P.some((p) => !!p.keyword),
    cta_indices: ctas,
    cta_words: ctas.length ? Wc[ctas[ctas.length - 1]] : null,
    part_order_ok: ranks.every((r, i) => i === 0 || ranks[i - 1] <= r) && ranks.every((r) => r !== 9),
    ask_indices: askIdx,
    ask_at_s: askIdx.map((i) => pyRound(T[i], 1)),
  };
}

// ── caps (python caps()) ─────────────────────────────────────────────────────────────────────────────────────────

export type Caps = Record<RubricId, number>;
export type CapReasons = Record<RubricId, string[]>;

export function caps(s: RubricInput, x: Proxies): { caps: Caps; why: CapReasons } {
  const mode = s.mode ?? "concept";
  const c = Object.fromEntries(RUBRIC_IDS.map((r) => [r, 3])) as Caps;
  const why = Object.fromEntries(RUBRIC_IDS.map((r) => [r, [] as string[]])) as CapReasons;
  const cap = (r: RubricId, v: number, msg: string) => {
    if (v < c[r]) c[r] = v;
    why[r].push(`${msg} (cap ${v})`);
  };
  // R1
  if (x.banned_opener) cap("R1", 0, "banned opener");
  const hw = x.hook_first_sentence_words;
  if (hw > 24) cap("R1", 1, `first sentence ${hw} words >24`);
  else if (hw > 12) cap("R1", 2, `first sentence ${hw} words >12`);
  if (!x.hook_concrete) cap("R1", 1, "hook has no number, proper noun or 'your <noun>'");
  // R2
  if (mode === "concept") {
    if (!x.you_in_first2) cap("R2", 1, "no you/your in sentences 1-2 (concept)");
    else if (!x.your_noun_in_first2) cap("R2", 2, "only generic 'you' in sentences 1-2");
  } else {
    if (!x.you_anywhere) cap("R2", 1, "no you/your anywhere (event)");
    else if (!x.you_in_first2) cap("R2", 2, "you/your only later (event: soft)");
  }
  // R3
  if (!x.stakes_numbers.length) cap("R3", 1, "no number in stakes");
  else {
    if (!x.stakes_hero_sourced) cap("R3", 1, "stakes number not in facts[]");
    if (!x.stakes_number_translated) cap("R3", 2, "stakes number has no comparison in same/next phrase");
    if (x.stakes_numbers.length > 2) cap("R3", 2, `${x.stakes_numbers.length} numbers in stakes (>2)`);
  }
  // R4
  const r = x.reveal_at_s;
  if (r === null) cap("R4", 1, "no reveal phrase");
  else if (r > 30) cap("R4", 1, `reveal at ${pyNum(r)}s >30`);
  else if (r > 20) cap("R4", 2, `reveal at ${pyNum(r)}s >20`);
  // R5
  const q = x.twist_question_at_s;
  if (q === null) cap("R5", x.twist_statement_only ? 1 : 0, x.twist_statement_only ? "twist has no '?'" : "no twist");
  else if (!(q >= 12 && q <= 30)) cap("R5", 2, `twist question at ${pyNum(q)}s outside 12-30`);
  // R6
  const n = x.mech_phrases;
  if (n < 6 || n > 18) cap("R6", 1, `${n} mechanism phrases (outside 6-18)`);
  else if (n < 8 || n > 16) cap("R6", 2, `${n} mechanism phrases (outside 8-16)`);
  if (x.mech_multi_clause > 2) cap("R6", 1, `${x.mech_multi_clause} multi-clause mechanism phrases`);
  if (x.mech_near_duplicate_pairs > 1) cap("R6", 1, `${x.mech_near_duplicate_pairs} near-duplicate mechanism pairs`);
  if (x.mech_empty > 2) cap("R6", 1, `${x.mech_empty} mechanism phrases with no concrete word`);
  // R7
  const a = x.acronyms.length;
  if (a >= 6) cap("R7", 0, `${a} acronyms`);
  else if (a >= 4) cap("R7", 1, `${a} acronyms`);
  else if (a === 3) cap("R7", 2, "3 acronyms");
  // R8
  const wps = x.wps ?? 0;
  const off = Number(x.phrase_len_outside_2_14 > 0) + Number(x.max_sentence_words > 20) + Number(!(wps >= 2.6 && wps <= 3.2));
  if (x.wps && !(x.wps >= 2.5 && x.wps <= 3.4)) cap("R8", 1, `${pyNum(x.wps)} words/s outside 2.5-3.4`);
  if (off >= 3) cap("R8", 0, "three rhythm items off");
  else if (off === 2) cap("R8", 1, "two rhythm items off");
  else if (off === 1) cap("R8", 2, "one rhythm item off");
  // R9
  if (x.unsourced_numbers.length) cap("R9", 0, `unsourced numbers [${x.unsourced_numbers.map((u) => `'${u}'`).join(", ")}]`);
  // R10
  const cw = x.climax_words;
  if (cw === null) cap("R10", 1, "no climax line");
  else if (cw > 9) cap("R10", 1, `climax ${cw} words`);
  else if (cw > 6) cap("R10", 2, `climax ${cw} words`);
  // R11
  if (x.closure_echo === null) cap("R11", 1, "no closure phrase");
  else if (!x.closure_echo.length && !x.closure_judged_flip) cap("R11", 2, "closure shares no content word with hook");
  // R12
  if (x.has_keywords && x.phrases_without_keyword_in_text) cap("R12", 1, `${x.phrases_without_keyword_in_text} phrases lack keyword in text`);
  return { caps: c, why };
}

/** python str(float): 11.0 → "11.0", 11.7 → "11.7". */
function pyNum(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

// ── format gates (python format_gates()) ─────────────────────────────────────────────────────────────────────────

export type GateId = "duration" | "cta" | "partOrder" | "freshness";
export interface GateFailure {
  id: GateId;
  msg: string;
}

export function formatGates(x: Proxies, allowMidroll = false): GateFailure[] {
  const g: GateFailure[] = [];
  if (!(x.duration_s >= 60 && x.duration_s <= 80)) g.push({ id: "duration", msg: `duration ${pyNum(x.duration_s)}s outside 60-80 (bible)` });
  let ctas = x.cta_indices;
  if (allowMidroll && x.ask_indices.length) {
    const ai = x.ask_indices;
    const contiguous = ai.every((v, k) => v === ai[0] + k);
    const okAsk = contiguous && ai.length <= 3 && x.ask_at_s[0] >= 22 && x.ask_at_s[0] <= 35;
    if (!okAsk) g.push({ id: "cta", msg: `mid-roll ask must be one block of <=3 phrases starting at 22-35 s (found at [${x.ask_at_s.map(pyNum).join(", ")}])` });
    ctas = ctas.filter((i) => !ai.includes(i));
  }
  if (!ctas.length || ctas.length !== 1 || ctas[0] !== x.phrases - 1) g.push({ id: "cta", msg: `CTA must be the only CTA and the last phrase (found at [${ctas.join(", ")}])` });
  else if ((x.cta_words ?? 0) > 7) g.push({ id: "cta", msg: `CTA ${x.cta_words} words >7` });
  if (!x.part_order_ok) g.push({ id: "partOrder", msg: "part order invalid" });
  return g;
}

// ── python score() ───────────────────────────────────────────────────────────────────────────────────────────────

export interface RawScore {
  proxies: Proxies;
  caps: Caps;
  why: Partial<CapReasons>;
  effective: Partial<Record<RubricId, number>>;
  total: number;
  max: number;
  need: number;
  floorFail: RubricId[];
  formatFail: string[];
  gates: GateFailure[];
  pass: boolean;
}

/** Port of python score(s, wps, use_format). `input.judge` (self or judge scores; missing = 3) is honoured as in python. */
export function scoreRubricInput(s: RubricInput, opts: { wps?: number; useFormat?: boolean } = {}): RawScore {
  const wps = opts.wps ?? RUBRIC_EST_WPS;
  const useFormat = opts.useFormat ?? true;
  const x = proxies(s, wps);
  const { caps: c, why } = caps(s, x);
  const judge = s.judge ?? {};
  const only: RubricId[] = s.preview ? ["R1", "R2", "R4", "R5"] : [...RUBRIC_IDS];
  const eff: Partial<Record<RubricId, number>> = {};
  for (const r of only) {
    const j = judge[r];
    eff[r] = Math.min(typeof j === "number" ? j : 3, c[r]);
  }
  const weight = (r: RubricId) => RUBRIC_WEIGHTS[r] ?? 1;
  const total = only.reduce((t, r) => t + (eff[r] as number) * weight(r), 0);
  const maxt = only.reduce((t, r) => t + 3 * weight(r), 0);
  const floorFail = only.filter((r) => (eff[r] as number) < (RUBRIC_FLOORS[r] ?? 0));
  const gates = useFormat && !s.preview ? formatGates(x, !!s.midrollAsk) : [];
  const need = !s.preview ? RUBRIC_MIN_TOTAL : pyRound((RUBRIC_MIN_TOTAL * maxt) / RUBRIC_MAX_TOTAL);
  const whyOut: Partial<CapReasons> = {};
  for (const r of only) if (why[r].length) whyOut[r] = why[r];
  return { proxies: x, caps: c, why: whyOut, effective: eff, total, max: maxt, need, floorFail, formatFail: gates.map((g) => g.msg), gates, pass: !floorFail.length && !gates.length && total >= need };
}

// ── v2 entry point ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PhraseTiming {
  beatId: string;
  /** Speech onset of the phrase, seconds from the start of the reel. */
  startSec: number;
  /** End of the phrase's audio, seconds. */
  endSec: number;
  /** true when the timing is a pre-TTS estimate (estimateTimings). */
  estimated?: boolean;
}

/** Pre-TTS: cumulative words at RUBRIC_EST_WPS (python's estimate; no gaps). */
export function estimateTimings(script: Pick<ScriptV2, "phrases">, wps = RUBRIC_EST_WPS): PhraseTiming[] {
  let t = 0;
  return script.phrases.map((p, i) => {
    const start = t;
    t += spokenWords(p.text).length / wps;
    return { beatId: phraseBeatId(i), startSec: start, endSec: t, estimated: true };
  });
}

const beatKey = (id: number | string) => (typeof id === "number" ? phraseBeatId(id - 1) : id);

/** Post-TTS: beats back to back (durationSec + GAP_MS, as resolveTimeline places them); startSec = first word onset. */
export function timingsFromWords(words: WordsFileT): PhraseTiming[] {
  const beats = [...words.beats].sort((a, b) => beatKey(a.beatId).localeCompare(beatKey(b.beatId)));
  let cursor = 0;
  return beats.map((b) => {
    const start = cursor;
    const onset = b.words.length ? Math.max(0, b.words[0].startMs) / 1000 : 0;
    cursor = start + b.durationSec + GAP_MS / 1000;
    return { beatId: beatKey(b.beatId), startSec: start + onset, endSec: start + b.durationSec };
  });
}

/** Loose storyboard shape (parsed or raw storyboard.json) for the post-storyboard checks. */
export interface RubricStoryboard {
  beats: { id: string; part: string; phrase: string; keyword: string; actions?: { target: string; do: string }[] }[];
  world: { id: string; component: string }[];
}

/** Verbs that change what is on screen (one per mechanism beat is the R6 ideal); focus/pulse/mark only emphasise. */
export const PRIMARY_VERBS: ReadonlySet<string> = new Set(["enter", "exit", "state", "drawOn", "countUp", "scramble", "glitch"]);

/** Post-storyboard R6 / R12 caps (R5 §4.2 second checkpoint). */
export function storyboardCaps(script: Pick<ScriptV2, "phrases">, sb: RubricStoryboard): { R6: { cap: number; reasons: string[] }; R12: { cap: number; reasons: string[] } } {
  const out = { R6: { cap: 3, reasons: [] as string[] }, R12: { cap: 3, reasons: [] as string[] } };
  const cap = (r: "R6" | "R12", v: number, msg: string) => {
    out[r].cap = Math.min(out[r].cap, v);
    out[r].reasons.push(`${msg} (cap ${v})`);
  };
  const mech = sb.beats.filter((b) => b.part === "mechanism");
  const empty = mech.filter((b) => !(b.actions ?? []).length);
  if (empty.length) cap("R6", 1, `mechanism beat(s) with no action: ${empty.map((b) => b.id).join(", ")}`);
  // "Primary action" = a scene change on one object: several verbs on the SAME instance (countUp + state) are one
  // change; primary verbs on two or more different instances in one beat are two changes.
  const changed = (b: RubricStoryboard["beats"][number]) => new Set((b.actions ?? []).filter((a) => PRIMARY_VERBS.has(a.do) && a.target !== "header" && a.target !== "datafield").map((a) => a.target)).size;
  const crowded = mech.filter((b) => changed(b) > 1);
  if (crowded.length > 2) cap("R6", 2, `${crowded.length} mechanism beats with >1 primary action (${crowded.map((b) => b.id).join(", ")})`);
  const lib = new Set<string>(LIBRARY_IDS);
  for (const inst of sb.world) if (!lib.has(inst.component)) cap("R12", 0, `instance "${inst.id}": component "${inst.component}" is not in the catalogue`);
  const mismatched = script.phrases
    .map((p, i) => ({ p, b: sb.beats[i], id: phraseBeatId(i) }))
    .filter(({ p, b }) => !b || b.phrase !== p.text || b.keyword !== p.keyword || b.part !== p.part)
    .map(({ id }) => id);
  if (mismatched.length || sb.beats.length !== script.phrases.length) cap("R12", 1, `storyboard beats differ from the script phrases (${mismatched.join(", ") || `${sb.beats.length} beats vs ${script.phrases.length} phrases`})`);
  return out;
}

export type Checkpoint = "pre-tts" | "post-tts" | "post-storyboard";
export type JudgeScores = Partial<Record<RubricId, { score: number; why: string }>>;

export interface CriterionResult {
  id: RubricId;
  name: string;
  weight: number;
  self: number;
  judge: number | null;
  cap: number;
  effective: number;
  why: string;
  capReasons: string[];
  /** Model scores on a mechanical criterion that were ignored because they named no checkable evidence. */
  ignored?: string[];
  /** W3.1: code-measured evidence at this checkpoint (R4 reveal time, R5 twist time, R6 mechanism count, R8 pace). */
  measured?: string;
  /** W3.1: the judge's note cited its own timing / count figures; `why` shows the measured evidence instead. */
  judgeWhy?: string;
}

export interface Gate {
  id: GateId;
  ok: boolean;
  msg: string;
  /** false = warning only (duration before TTS). */
  hard: boolean;
}

export interface RubricResult {
  total: number;
  max: 42;
  need: number;
  pass: boolean;
  checkpoint: Checkpoint;
  criteria: CriterionResult[];
  floorsFailed: RubricId[];
  gates: Gate[];
  /** Measured numbers for the Script card. */
  stats: { phrases: number; words: number; durationSec: number; wps: number | null; revealAtSec: number | null; twistAtSec: number | null; estimated: boolean };
  /** Note when supplied timings did not match the phrases and the estimate was used instead. */
  notes: string[];
}

export interface ScoreRubricArgs {
  script: ScriptV2;
  /** Fresh-judge scores; null = not judged yet (counts as 3, i.e. self and caps only). */
  judge: JudgeScores | null;
  /** Omitted/null/estimated = pre-TTS estimate at RUBRIC_EST_WPS. */
  timings?: PhraseTiming[] | null;
  storyboard?: RubricStoryboard | null;
  /** W3.1: the job date (job createdAt). When set, the hard `freshness` gate runs (freshnessGate). */
  asOf?: string | Date | null;
  /** W3.1: the fresh judge's freshness verdict (JudgeResult.freshness). */
  judgeFreshness?: FreshnessJudge | null;
  /** W3.1: source id → page date from the research ledger (sourceDatesFromPageDates); sources[].published wins. */
  sourceDates?: Readonly<Record<string, string>>;
  /** W3.2 r2: source id → page text (sourceTextsFor): a current page that says the case ended fails the freshness
   *  gate unless the narration says so. Absent = dates only. */
  sourceTexts?: Readonly<Record<string, string>>;
}

export function rubricProxies(script: ScriptV2, timings?: PhraseTiming[] | null, storyboard?: RubricStoryboard | null) {
  const { input, estimated, notes } = rubricInputWithTimings(script, timings);
  const x = proxies(input, RUBRIC_EST_WPS);
  const { caps: c, why } = caps(input, x);
  const per = Object.fromEntries(RUBRIC_IDS.map((r) => [r, { cap: c[r], reasons: [...why[r]] }])) as Record<RubricId, { cap: number; reasons: string[] }>;
  if (storyboard) {
    const sc = storyboardCaps(script, storyboard);
    for (const r of ["R6", "R12"] as const) {
      per[r].cap = Math.min(per[r].cap, sc[r].cap);
      per[r].reasons.push(...sc[r].reasons);
    }
  }
  for (const d of v2Caps(script, x)) {
    per[d.id].cap = Math.min(per[d.id].cap, d.cap);
    per[d.id].reasons.push(`${d.msg} (cap ${d.cap})`);
  }
  return { proxies: x, criteria: per, input, estimated, notes };
}

/** v2-only caps on top of the python port (the port itself stays line-for-line; test/v2-rubric.test.ts parity).
 *  W3.1: R2 for an event reel with no "you" anywhere is 0, as the R5 §4 table says — the python proxy capped it at 1
 *  ("never → 1"), which contradicted the table, the judge prompt and the judge's own "0 by rule" notes. */
export function v2Caps(script: Pick<ScriptV2, "mode"> & Partial<Pick<ScriptV2, "phrases">>, x: Pick<Proxies, "you_anywhere">): { id: RubricId; cap: number; msg: string }[] {
  const out: { id: RubricId; cap: number; msg: string }[] = [];
  if (script.mode === "event" && !x.you_anywhere) out.push({ id: "R2", cap: 0, msg: "event: no you/your anywhere (R5 table level 0)" });
  // W6: each phrase changes one thing (R6) — two adjacent lines that restate one claim change nothing
  const reps = adjacentRepeats(script.phrases ?? []);
  if (reps.length) out.push({ id: "R6", cap: reps.length > 1 ? 1 : 2, msg: `adjacent lines restate the same claim: ${reps.map((r) => `${r.a}/${r.b} ("${r.shared.join(" ")}")`).join(", ")} — cut one or make the second add something new` });
  return out;
}

// ── adjacent repeated claims (W6) ────────────────────────────────────────────────────────────────────────────────
// W5.1 r2 evergreen-oom: b01 "Your pod was OOMKilled, though the app swears its heap is small." and b02 "Exit code 137,
// though the app team swears the heap is small." passed the rubric (36/42), the mechanism judge and the critic — 4 s
// of the hook window said twice. The climax and closure may echo earlier lines on purpose; the CTA is exempt.

const REPEAT_STOP = new Set(
  "a an the and or but so of to in on at for with from by as is are was were be been it its it's this that these those your you our their they he she we i though although while because if then than not no just only even still also very one two both".split(" "),
);
/** Content words of a line (lower case, stop words dropped, a plural / tense ending dropped). Names and numbers are
 *  not claims of their own ("ISRG Root X1", "OpenSSL 1.0.2", "137": two lines about one root share them by design):
 *  a word with a digit, an inner capital, or a capital not at a sentence start is skipped. */
function repeatTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:[-'.][\p{L}\p{N}]+)*/gu)) {
    const w = m[0];
    const start = !text.slice(0, m.index ?? 0).trim() || /[.!?:]\s*$/.test(text.slice(0, m.index ?? 0));
    if (/\p{N}/u.test(w) || /.\p{Lu}/u.test(w) || (/^\p{Lu}/u.test(w) && !start)) continue;
    for (const t of w.toLowerCase().split(/[-'.]/)) if (t && !REPEAT_STOP.has(t)) out.push(t.length > 4 ? t.replace(/(?:ing|ed|es|s)$/, "") : t);
  }
  return out;
}
/** Shared content words for a restatement: at least this many, and this share of the shorter line's. */
export const REPEAT_MIN_SHARED = 4;
export const REPEAT_MIN_SHARE = 0.6;
const ECHO_PARTS = new Set(["climax", "closure", "cta"]);

/** Adjacent phrase pairs that restate one claim (≥ REPEAT_MIN_SHARED shared content words that are ≥ REPEAT_MIN_SHARE of
 *  the shorter line's), skipping pairs with a climax / closure / CTA line. */
export function adjacentRepeats(phrases: ReadonlyArray<{ text: string; part: string }>): Array<{ a: string; b: string; shared: string[] }> {
  const out: Array<{ a: string; b: string; shared: string[] }> = [];
  for (let i = 1; i < phrases.length; i++) {
    const [p, q] = [phrases[i - 1], phrases[i]];
    if (ECHO_PARTS.has(p.part) || ECHO_PARTS.has(q.part)) continue;
    const a = new Set(repeatTokens(p.text));
    const b = new Set(repeatTokens(q.text));
    const shared = [...a].filter((w) => b.has(w));
    if (shared.length >= REPEAT_MIN_SHARED && shared.length >= REPEAT_MIN_SHARE * Math.min(a.size, b.size)) out.push({ a: phraseBeatId(i - 1), b: phraseBeatId(i), shared });
  }
  return out;
}

/** The lowest R2 level the proxy proves (the judge is clamped up to it): an event reel with any "you"/"your" is at
 *  least 2 ("event: you only later"; 1 is a concept-only level). null = nothing proven. */
export function judgeR2Floor(script: Pick<ScriptV2, "mode" | "phrases">, x: Pick<Proxies, "you_anywhere">): { level: number; why: string } | null {
  if (script.mode !== "event" || !x.you_anywhere) return null;
  // W3.2 r2: over the NARRATION only — a CTA-only "you" ("Follow if you ship on Railway") proves nothing about R2
  const i = script.phrases.findIndex((p) => p.part !== "cta" && YOU.test(p.text));
  if (i < 0) return null;
  return { level: 2, why: `event reel says you/your at phrase ${i + 1}` };
}

// ── R1 is judge-only (R5 §4 row R1; W3.3) ───────────────────────────────────────────────────────────────────────
// W3.2 r2 had a code-side "tension the hook does not contain" demotion (vetR1Tension). It cut a correct judge 3 on
// "Your pod died. The team swears the heap stayed under 400 MB." (a two-sentence contrast with no contrast word) to 2.
// Tension is the judge's call: judge.ts asks ONE recheck when the judge's reason names a tension type the hook's
// wording may not contain, and the judge's second R1 is the score. No code here overrides it.

// ── R8 is mechanical: what to change before save (W3.2 r2) ──────────────────────────────────────────────────────

/** The pace metric every surface uses (rubric R8, card, script.md, lint L11): defined once in the schema (W3.3). */
export { PACE_METRIC };

/** One pace + rhythm summary of a script at this checkpoint (PACE_METRIC), for every surface that prints a pace. */
export function paceOf(script: ScriptV2, timings?: PhraseTiming[] | null): { words: number; durationSec: number; wps: number | null; estimated: boolean; metric: string } {
  const { proxies: x, estimated } = rubricProxies(script, timings);
  return { words: x.words_total, durationSec: x.duration_s, wps: x.wps, estimated, metric: PACE_METRIC };
}

/**
 * The mechanical R8 items that are off, each with the concrete change that fixes it — so the director fixes pace and
 * phrase length BEFORE save_job instead of saving NOT READY (event-recent r2: 2.47 w/s and a 15-word b15). Empty =
 * nothing mechanical to fix. `rate` = a suggested TTS rate change in percent when the pace is outside 2.6-3.2.
 */
export function r8Advice(script: ScriptV2, timings?: PhraseTiming[] | null): Array<{ item: "phrase" | "sentence" | "pace"; beat?: string; msg: string; rate?: number }> {
  const { input, estimated } = rubricInputWithTimings(script, timings);
  const x = proxies(input, RUBRIC_EST_WPS);
  const out: Array<{ item: "phrase" | "sentence" | "pace"; beat?: string; msg: string; rate?: number }> = [];
  script.phrases.forEach((p, i) => {
    const n = spokenWords(p.text).length;
    if (n < 2 || n > 14) out.push({ item: "phrase", beat: phraseBeatId(i), msg: `${phraseBeatId(i)} is ${n} spoken words (2-14): ${n > 14 ? "split it into two phrases" : "merge it with a neighbour"}` });
  });
  if (x.max_sentence_words > 20) out.push({ item: "sentence", msg: `a sentence has ${x.max_sentence_words} spoken words (> 20): split it` });
  if (x.wps !== null && !(x.wps >= 2.6 && x.wps <= 3.2)) {
    const target = x.wps < 2.6 ? 2.8 : 3.0;
    const rate = Math.round((target / x.wps - 1) * 100);
    out.push({ item: "pace", msg: `pace ${x.wps} w/s${estimated ? " (estimate)" : ""} is outside 2.6-3.2: ${x.wps < 2.6 ? "speed the voice up" : "slow the voice down"} by about ${Math.abs(rate)}% (TTS rate ${rate > 0 ? "+" : ""}${rate}%) or ${x.wps < 2.6 ? "cut pauses / trim silent beats" : "add a few words"}`, rate });
  }
  return out;
}

/** Code-measured evidence for the criteria whose model "why" used to cite stale pre-TTS figures (W3.1: "15 mechanism
 *  phrases" for 9, "reveal at 10 s" for 13.8 s). Shown next to (or instead of) the model note; timings and counts are
 *  code's job, not the judge's. */
export function measuredEvidence(script: Pick<ScriptV2, "phrases">, x: Proxies, estimated: boolean): Partial<Record<RubricId, string>> {
  const est = estimated ? ` (estimate at ${RUBRIC_EST_WPS} w/s)` : "";
  const ids = (part: string) => script.phrases.map((p, i) => (p.part === part ? phraseBeatId(i) : null)).filter((v): v is string => v !== null);
  const span = (a: string[]) => (a.length ? (a.length === 1 ? a[0] : `${a[0]}–${a[a.length - 1]}`) : "none");
  const mech = ids("mechanism");
  return {
    R4: x.reveal_at_s === null ? "no reveal phrase" : `reveal ${span(ids("reveal"))} at ${x.reveal_at_s} s${est}`,
    R5: x.twist_question_at_s === null ? (x.twist_statement_only ? "twist has no question" : "no twist") : `twist question at ${x.twist_question_at_s} s${est}`,
    R6: `${mech.length} mechanism phrase${mech.length === 1 ? "" : "s"} (${span(mech)})`,
    R8: `${x.words_total} words, ${x.wps ?? "?"} w/s over ${x.duration_s} s${est}; max sentence ${x.max_sentence_words} words`,
  };
}

/** A model note that states its own timing / count / pace figures (which code measures instead). */
export const STAT_CLAIM = /\b\d+(?:\.\d+)?\s*(?:s\b|sec\b|secs\b|seconds?\b|w\/s|words?\s*(?:\/|per)\s*s)|\b\d+\s+(?:mechanism\s+)?(?:phrases?|lines?|words)\b|\bpace\b[^.]*\d/i;

// ── freshness (W3.1) ─────────────────────────────────────────────────────────────────────────────────────────────
// A concept explainer must be true as of the job date. W3 r3 shipped an "evergreen" TLS reel built only on 2020/2021
// pages, told in the present tense, about a chain Let's Encrypt retired in 2024. Code checks the dates it can see; the
// fresh judge checks the tense / still-true question (its `freshness` verdict).

export const FRESHNESS_MAX_AGE_MONTHS = 18;
const MONTH_MS = 30.4375 * 86_400_000;
export interface FreshnessJudge {
  ok: boolean;
  why: string;
}
export interface FreshnessResult {
  ok: boolean;
  msg: string;
  reasons: string[];
  /** Source ids dated within the window / older / with no date. */
  fresh: string[];
  stale: string[];
  undated: string[];
}

/** Latest (or earliest) instant a partial date can mean: "2021" → 2021-12-31 (latest) / 2021-01-01 (earliest). */
export function sourceDateBound(d: string, which: "latest" | "earliest"): number {
  const [y, m, day] = d.split("-").map(Number);
  if (which === "earliest") return Date.UTC(y, (m ?? 1) - 1, day ?? 1);
  if (day) return Date.UTC(y, m - 1, day, 23, 59, 59);
  if (m) return Date.UTC(y, m, 0, 23, 59, 59); // day 0 of the next month = last day of m
  return Date.UTC(y, 11, 31, 23, 59, 59);
}

const DATE_ANCHOR =
  /\b(?:19|20)\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b|\b(?:january|february|march|april|june|july|august|september|october|november|december)\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\byesterday\b|\blast\s+(?:week|month|year|night)\b|\bthis\s+(?:week|month|morning)\b/i;

/** Does the narration say WHEN (a year, a month/date, a weekday, "last week")? Event reels must be told as dated. */
export function hasDateAnchor(phrases: readonly { text: string }[]): boolean {
  return phrases.some((p) => DATE_ANCHOR.test(p.text));
}

// W3.2 r2 (evergreen-tls r2 saved READY "fresh as of 2026-10-25 (current: karani)"): a fresh DATE is not enough when
// the current page itself says the case the reel teaches has ENDED ("Let's Encrypt stopped serving that cross-signed
// chain by default in February 2024, removed it from their API on 6 June 2024, and the DST Root CA X3 root itself
// expired on 30 September 2024"). Then the reel must say so: past tense plus one line that it ended / was retired.

/** A page sentence saying something ended (retired, removed, stopped, no longer, deprecated, expired on …). */
const ENDED =
  /\b(?:retired|removed|withdrawn|decommissioned|discontinued|deprecated|sunset(?:ted)?|phased out|shut down|end(?:ed)? of life|stopped (?:serving|issuing|supporting|offering|signing|shipping)|no longer (?:\w+ ){0,2}?(?:works?|served|offered|supported|available|does anything|on offer|request|exists?|valid|issued)|(?:itself )?expired (?:on|in)|has expired|is gone|was dropped)\b/i;
const YEAR = /\b(?:19|20)\d{2}\b/g;

/** Up to `max` sentences of a page text that say the case ended, with the latest year each names (dated only). */
export function endedCaseStatements(text: string, max = 4): Array<{ sentence: string; year: number }> {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const out: Array<{ sentence: string; year: number }> = [];
  const seen = new Set<string>();
  for (const raw of t.split(/(?<=[.!?])\s+|\s+(?=(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2},?\s+)?(?:19|20)\d{2}\b)/i)) {
    const sent = raw.trim();
    if (sent.length < 15 || sent.length > 400 || !ENDED.test(sent)) continue;
    const years = [...sent.matchAll(YEAR)].map((m) => Number(m[0]));
    if (!years.length) continue;
    const key = sent.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // the year nearest the "ended" words ("There is an added wrinkle in 2026 …: that chain has been retired" → 2026 is
    // the page's own year; callers take the most frequent year over all statements)
    const at = ENDED.exec(sent)?.index ?? 0;
    const near = [...sent.matchAll(YEAR)].sort((a, b) => Math.abs((a.index ?? 0) - at) - Math.abs((b.index ?? 0) - at))[0];
    out.push({ sentence: sent.length > 220 ? `${sent.slice(0, 220)}…` : sent, year: Number(near[0]) });
    if (out.length >= max) break;
  }
  return out;
}

/** The most frequent year over the "ended" statements (ties → the earliest). */
export function endedYear(ended: readonly { year: number }[]): number {
  const n = new Map<number, number>();
  for (const e of ended) n.set(e.year, (n.get(e.year) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

/** Content words an "ended" page sentence must share with the narration to be about the reel's case. */
export const ENDED_MIN_OVERLAP = 3;

/** The narration says the case ended: a retirement word, or a year at or after the year it ended. */
const NARRATED_END = /\b(?:retired|removed|ended|ends|gone|no longer|stopped|deprecated|phased out|replaced|withdrawn|was dropped|is over|since (?:19|20)\d{2}|until (?:19|20)\d{2}|(?:19|20)\d{2} (?:on|onward|onwards))\b/i;
export function narrationStatesEnd(phrases: readonly { text: string; part?: string }[], endYear: number): boolean {
  const said = phrases.filter((p) => p.part !== "cta").map((p) => p.text);
  return said.some((t) => NARRATED_END.test(t) || [...t.matchAll(YEAR)].some((m) => Number(m[0]) >= endYear));
}

/** Source id → page text for the freshness checks (sourceTexts), from the page store (url → text). */
export function sourceTextsFor(script: Pick<ScriptV2, "sources">, pages: ReadonlyMap<string, string | null | undefined>, normUrl: (u: string) => string = (u) => u): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s0 of script.sources) {
    const t = pages.get(normUrl(s0.url)) ?? pages.get(s0.url);
    if (t) out[s0.id] = t;
  }
  return out;
}

/** research.json pageDates (normUrl → date, P3's extractPageDate) → source id → date, for scoreRubric's sourceDates. */
export function sourceDatesFromPageDates(script: Pick<ScriptV2, "sources">, pageDates: Readonly<Record<string, string>> | undefined, normUrl: (u: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of script.sources) {
    const d = pageDates?.[normUrl(s.url)];
    if (d) out[s.id] = d;
  }
  return out;
}

/**
 * Hard `freshness` gate (code part). A date comes from sources[].published, else from `sourceDates` (the research
 * ledger's page dates). Concept: when the dated sources are ALL older than FRESHNESS_MAX_AGE_MONTHS the reel needs a
 * current (dated) source — the recency check (`recency` names it; P3's research floor separately demands the recency
 * search). Undated-only source sets are not judged by code (the judge's freshness verdict still is). Event: the
 * narration must say when (a dated situation told as dated). Any judge verdict ok:false fails the gate.
 */
export function freshnessGate(
  script: Pick<ScriptV2, "mode" | "sources" | "phrases" | "recency">,
  asOf: string | Date,
  judge?: FreshnessJudge | null,
  sourceDates?: Readonly<Record<string, string>>,
  opts: { requireJudge?: boolean; sourceTexts?: Readonly<Record<string, string>> } = {},
): FreshnessResult {
  const now = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  const day = Number.isFinite(now) ? new Date(now).toISOString().slice(0, 10) : String(asOf);
  const reasons: string[] = [];
  const fresh: string[] = [];
  const stale: string[] = [];
  const undated: string[] = [];
  if (!Number.isFinite(now)) return { ok: true, msg: `freshness not checked (bad job date ${JSON.stringify(String(asOf))})`, reasons, fresh, stale, undated };
  for (const src of script.sources) {
    const pub = (src as { published?: string }).published ?? sourceDates?.[src.id];
    if (!pub) {
      undated.push(src.id);
      continue;
    }
    if (sourceDateBound(pub, "earliest") > now + 2 * 86_400_000) reasons.push(`source "${src.id}" is dated ${pub}, after the job date ${day}`);
    const age = (now - sourceDateBound(pub, "latest")) / MONTH_MS;
    (age <= FRESHNESS_MAX_AGE_MONTHS ? fresh : stale).push(src.id);
  }
  const dateOf = (id: string) => (script.sources.find((x) => x.id === id) as { published?: string } | undefined)?.published ?? sourceDates?.[id];
  const dated = (ids: string[]) => ids.map((id) => `${id} ${dateOf(id)}`).join(", ");
  if (script.mode === "concept") {
    if (script.recency && !fresh.includes(script.recency.sourceId)) {
      reasons.push(`recency: source "${script.recency.sourceId}" is not dated within ${FRESHNESS_MAX_AGE_MONTHS} months of ${day} — the recency check must cite a current page`);
    }
    if (stale.length && !fresh.length) {
      reasons.push(
        `concept reel: no source is dated within ${FRESHNESS_MAX_AGE_MONTHS} months of the job date ${day}` +
          ` (older: ${dated(stale)})${undated.length ? ` (undated: ${undated.join(", ")})` : ""}` +
          ` — run a recency check search (what changed since?), cite the current dated page (sources[].published) and fill \`recency\`; if the story is a dated situation, make it an event reel told in the past tense`,
      );
    }
    // W3.2 r2: a CURRENT page that says the case ended → the narration must say so (past tense + one "ended" line)
    const told = content(script.phrases.filter((p) => p.part !== "cta").map((p) => p.text).join(" "));
    for (const id of fresh) {
      // only statements about what the reel tells (>= ENDED_MIN_OVERLAP of its content words), not any retirement
      const ended = endedCaseStatements(opts.sourceTexts?.[id] ?? "", 8).filter((e) => [...content(e.sentence)].filter((w) => told.has(w)).length >= ENDED_MIN_OVERLAP);
      if (!ended.length) continue;
      const endYear = endedYear(ended);
      if (!narrationStatesEnd(script.phrases, endYear))
        reasons.push(
          `current source "${id}" (${dateOf(id)}) says the case ended: ${[...ended].sort((a, b) => Number(b.year === endYear) - Number(a.year === endYear)).slice(0, 2).map((e) => JSON.stringify(e.sentence)).join(" ")} — tell it in the past tense and add one line that says it ended (e.g. "… retired in ${endYear}"), or make it an event reel; a fresh page date alone does not make a retired case current`,
        );
      break;
    }
  } else if (!hasDateAnchor(script.phrases)) {
    reasons.push("event reel: the narration never says when it happened (a year, a date, a weekday or \"last week\") — tell a dated situation as dated");
  }
  if (judge && !judge.ok) reasons.push(`judge: ${judge.why || "the script is not true as of the job date"}`);
  // W3.2: a judged script needs the judge's freshness verdict — never a code-only pass (undated sources + a reply
  // without the verdict used to read "fresh … (no judge freshness verdict)", ok).
  if (!judge && opts.requireJudge) reasons.push("no judge freshness verdict — the fresh judge must rule on freshness (call score_script again)");
  const ok = !reasons.length;
  const basis = fresh.length ? ` (current: ${fresh.join(", ")})` : stale.length ? "" : " (no dated source; judge only)";
  return { ok, msg: ok ? `fresh as of ${day}${basis}${judge ? "" : " (judge freshness verdict pending)"}` : reasons.join("; "), reasons, fresh, stale, undated };
}

function rubricInputWithTimings(script: ScriptV2, timings?: PhraseTiming[] | null): { input: RubricInput; estimated: boolean; notes: string[] } {
  const base: RubricInput = { ...toRubricInput(script), spokenTokens: true };
  delete base.judge;
  const notes: string[] = [];
  if (!timings || !timings.length || timings.every((t) => t.estimated)) return { input: base, estimated: true, notes };
  const byId = new Map(timings.map((t) => [t.beatId, t]));
  const aligned = script.phrases.map((_, i) => byId.get(phraseBeatId(i)));
  if (aligned.some((t) => !t || t.estimated)) {
    notes.push(`timings cover ${timings.length} beat(s) but the script has ${script.phrases.length} phrases: used the ${RUBRIC_EST_WPS} w/s estimate`);
    return { input: base, estimated: true, notes };
  }
  const real = aligned as PhraseTiming[];
  base.phrases = base.phrases.map((p, i) => ({ ...p, t: real[i].startSec }));
  base.duration = real[real.length - 1].endSec + TAIL_MS / 1000;
  return { input: base, estimated: false, notes };
}

// ── R9 is mechanical (W3 r1 fix) ─────────────────────────────────────────────────────────────────────────────────
// The fresh judge scored R9 0/1 on both TLS runs while its own note said every number was sourced ("no missing number
// found", "scored low to be safe"). R9 is decided by code (the SOURCEABLE proxy → cap); a model score below 3 only
// counts when its "why" names a number token that occurs in the narration and in no fact-sheet claim. Otherwise it is
// ignored and the criterion falls back to the cap. Applies to the judge AND the director's self-score.

/** Criteria whose model score is only honoured when it names concrete evidence code can check. */
export const MECHANICAL_IDS: readonly RubricId[] = Object.freeze(["R9"]);

/** The first number token named in `why` that occurs in the narration but in no fact claim, else null. */
export function namedUnsourcedNumber(script: Pick<ScriptV2, "phrases" | "facts">, why: string): string | null {
  const pad = (t: string) => ` ${normNum(t)} `;
  const narration = pad(script.phrases.map((p) => p.text).join(" "));
  const facts = script.facts.map((f) => normNum(f.claim)).join(" ");
  const cands = [...all(SOURCEABLE, why), ...all(NUM, why)];
  for (const c of cands) {
    const n = normNum(c);
    if (!n) continue;
    if (narration.includes(` ${n} `) && !facts.includes(n)) return c;
  }
  return null;
}

/** Vet one model score on a mechanical criterion: returns the score to use (null = ignore) and a note when ignored. */
export function vetMechanicalScore(
  script: Pick<ScriptV2, "phrases" | "facts">,
  id: RubricId,
  who: "judge" | "self",
  s: { score: number; why: string } | undefined,
): { score: number | null; note: string | null } {
  if (!s) return { score: null, note: null };
  if (!MECHANICAL_IDS.includes(id) || s.score >= 3) return { score: s.score, note: null };
  const tok = namedUnsourcedNumber(script, s.why ?? "");
  if (tok) return { score: s.score, note: null };
  return { score: null, note: `${id}: ${who} ${s.score} ignored (named no number missing from facts[]; ${id} is mechanical)` };
}

export function scoreRubric(args: ScoreRubricArgs): RubricResult {
  const { script, judge, storyboard } = args;
  const { proxies: x, criteria: per, estimated, notes } = rubricProxies(script, args.timings, storyboard);
  const measured = measuredEvidence(script, x, estimated);
  const checkpoint: Checkpoint = storyboard ? "post-storyboard" : estimated ? "pre-tts" : "post-tts";
  const self = new Map(script.rubric.map((r) => [r.id, r]));
  const r2Floor = judgeR2Floor(script, x);
  const criteria: CriterionResult[] = CRITERIA.map((c) => {
    const s = self.get(c.id);
    let j = judge?.[c.id];
    // W3.2: R2 is partly mechanical — the judge cannot go below the level the proxy proves (event-recent r1: an event
    // reel addressing "you" at phrase 21 was judged 1 three times; the R5 table says "event: you only later" = 2).
    if (c.id === "R2" && j && r2Floor && j.score < r2Floor.level) {
      notes.push(`R2: judge ${j.score} raised to ${r2Floor.level} (${r2Floor.why}; R5 table level ${r2Floor.level})`);
      j = { score: r2Floor.level, why: `${r2Floor.why} (R5 level ${r2Floor.level}; judge said ${j.score}: ${j.why})`.slice(0, 400) };
    }
    const selfScore = s?.score ?? 0;
    const vj = vetMechanicalScore(script, c.id, "judge", j);
    const vs = vetMechanicalScore(script, c.id, "self", s);
    const ignored = [vj.note, vs.note].filter((n): n is string => !!n);
    notes.push(...ignored);
    const effective = Math.min(vs.score ?? 3, vj.score ?? 3, per[c.id].cap);
    const m = measured[c.id];
    const modelWhy = j?.why ?? s?.why ?? "";
    const statty = !!m && STAT_CLAIM.test(modelWhy);
    const why = vj.note ? (per[c.id].reasons[0] ?? "every sourceable number is in the fact sheet (checked by code)") : statty ? `measured: ${m}` : modelWhy;
    return {
      id: c.id,
      name: c.name,
      weight: c.weight,
      self: selfScore,
      judge: j ? j.score : null,
      cap: per[c.id].cap,
      effective,
      why,
      capReasons: per[c.id].reasons,
      ...(ignored.length ? { ignored } : {}),
      ...(m ? { measured: m } : {}),
      ...(statty ? { judgeWhy: modelWhy } : {}),
    };
  });
  const total = criteria.reduce((t, c) => t + c.effective * c.weight, 0);
  const floorsFailed = criteria.filter((c) => c.effective < (RUBRIC_FLOORS[c.id] ?? 0)).map((c) => c.id);
  const failures = formatGates(x, false);
  const gates: Gate[] = (["duration", "cta", "partOrder"] as const).map((id) => {
    const f = failures.filter((g) => g.id === id);
    const hard = id !== "duration" || !estimated;
    const okMsg = id === "duration" ? `duration ${pyNum(x.duration_s)}s${estimated ? ` (estimate at ${RUBRIC_EST_WPS} w/s)` : ""}` : id === "cta" ? "CTA is the only CTA and the last phrase" : "part order ok";
    return { id, ok: !f.length, msg: f.length ? f.map((g) => g.msg).join("; ") + (id === "duration" && estimated ? ` (estimate at ${RUBRIC_EST_WPS} w/s; warning until TTS)` : "") : okMsg, hard };
  });
  if (args.asOf) {
    // Judged (fresh-judge scores present) → the judge's freshness verdict is required; proxy-only scoring (pre-TTS,
    // or no judge configured, which the card flags) reports the code part with the verdict pending.
    const fr = freshnessGate(script, args.asOf, args.judgeFreshness ?? null, args.sourceDates, { requireJudge: judge !== null, sourceTexts: args.sourceTexts });
    gates.push({ id: "freshness", ok: fr.ok, msg: fr.msg, hard: true });
  } else notes.push("freshness not checked (no job date passed to scoreRubric)");
  const pass = total >= RUBRIC_MIN_TOTAL && !floorsFailed.length && gates.every((g) => g.ok || !g.hard);
  return {
    total,
    max: 42,
    need: RUBRIC_MIN_TOTAL,
    pass,
    checkpoint,
    criteria,
    floorsFailed,
    gates,
    stats: { phrases: x.phrases, words: x.words_total, durationSec: x.duration_s, wps: x.wps, revealAtSec: x.reveal_at_s, twistAtSec: x.twist_question_at_s, estimated },
    notes,
  };
}

/** Rejection feedback in researchGaps() style, most actionable first: hard gates, floors, total, then cap reasons. */
export function rubricGaps(result: RubricResult): string[] {
  const gaps: string[] = [];
  for (const g of result.gates) if (!g.ok && g.hard) gaps.push(`format: ${g.msg}`);
  for (const id of result.floorsFailed) {
    const c = result.criteria.find((k) => k.id === id) as CriterionResult;
    gaps.push(`${id} below floor: ${c.effective} < ${RUBRIC_FLOORS[id]}`);
  }
  if (result.total < RUBRIC_MIN_TOTAL) gaps.push(`total ${result.total}/${result.max} < ${RUBRIC_MIN_TOTAL}`);
  for (const c of result.criteria) {
    if (c.effective >= 3) continue;
    for (const r of c.capReasons) gaps.push(`${c.id}: ${r}`);
    if (c.judge !== null && c.judge < Math.min(c.self, c.cap) && !c.ignored?.some((n) => n.includes(" judge "))) gaps.push(`${c.id}: judge ${c.judge}: ${c.why}`);
  }
  return gaps;
}
