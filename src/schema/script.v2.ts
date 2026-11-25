// script.v2.json — what the v2 director saves BEFORE the storyboard (W3): narration phrases + part tags + keywords,
// sources, a fact sheet and the director's R5 self-score. Pure data contract (zod 4), no side effects.
//
// Binding: research/notes/R5-script-rubric.md §4 (parts, rubric R1..R12, CTA rules), D1-DECISIONS (#1 series
// ROOT CAUSE, header modes EVENT/SPEC/CLOCK, #12 no mid-roll `ask`), ADR-001 §4 (storyboard ids/parts).
//
// Phrase i becomes storyboard beat `phraseBeatId(i)` ("b01"...) one to one: same part, same text (beat.phrase), same
// keyword. The keyword rule is the storyboard's L5 rule (findSeq over whitespace tokens, outer punctuation ignored,
// case-insensitive), so a script that parses here can never fail L5 on its keyword later.

import { z } from "zod";
import { findSeq, TAIL_MS, tokenize } from "../v2/timeline.js";
import { Id, PARTS } from "./storyboard.v2.js";

export const SCRIPT_VERSION = "v2" as const;
export const SCRIPT_FAMILIES = ["security", "outage", "network", "systems", "science", "data"] as const;
export const HEADER_MODES = ["EVENT", "SPEC", "CLOCK"] as const;
export const RUBRIC_IDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12"] as const;
export type RubricId = (typeof RUBRIC_IDS)[number];
/** D1 #12 / bible: the CTA is the last phrase and at most this many words. Mirrors CTA_MAX_WORDS in src/v2/lints.ts. */
export const SCRIPT_CTA_MAX_WORDS = 7;
export const SCRIPT_PHRASES_MIN = 15;
export const SCRIPT_PHRASES_MAX = 40;
/** Narration phrase text limit (ScriptPhrase.text). */
export const PHRASE_TEXT_MAX_CHARS = 120;
/** W3.2: a fact-checker rewrite is one plain sentence of at most this many characters (the prompt says so and
 *  src/director/v2/factcheck.ts sanitizeCheckerFix enforces it), so an applied rewrite always fits a phrase. */
export const CHECKER_FIX_MAX_CHARS = 110;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The R5 proxy's `words()` regex (python parity): "07:35" is 2 tokens, a bare "—" is none, "1.0.2" is "1.0" + "2".
 *  W3.1: one tokenizer for rubric stats, card, script.md and tool replies (two paths used to disagree, 174 vs 176);
 *  W3.2: they all count with narrationWords() = spokenWords() below, which only differs on dotted numbers. */
export const NARRATION_WORD = /[A-Za-z0-9'%-]+(?:\.[0-9]+)?/g;
/** W3.2: a dotted number ("1.0.2", "2.5") is SPOKEN as its digit groups joined by "point" — edge-tts says "one point
 *  zero point two" (5 words) where NARRATION_WORD sees "1.0" + "2" (2 words). Spoken tokens drive the rhythm items
 *  (phrase length, sentence length, words/s) and the pre-TTS timing estimate, so a version-heavy script is no longer
 *  under-counted (evergreen-tls r1: "OpenSSL 1.0.2" ×4 read as 2.47-2.55 w/s). */
const SPOKEN_WORD = /(?<![A-Za-z0-9.])\d+(?:\.\d+)+%?(?![A-Za-z0-9])|[A-Za-z0-9'%-]+(?:\.[0-9]+)?/g;
/** "1.0.2" → ["1", "point", "0", "point", "2"]; any other token as NARRATION_WORD. */
export function spokenWords(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(SPOKEN_WORD)) {
    const t = m[0];
    if (/^\d+(?:\.\d+)+%?$/.test(t)) t.split(".").forEach((g, i) => (i ? out.push("point", g) : out.push(g)));
    else out.push(t);
  }
  return out;
}
/** The narration word list as the voice speaks it (spokenWords): the card, script.md, the tool replies and the R8
 *  rhythm stats all count with this. The R1 hook length and the python-parity port keep NARRATION_WORD. */
export function narrationWords(text: string): string[] {
  return spokenWords(text);
}
export function narrationWordCount(phrases: readonly { text: string }[] | string): number {
  return typeof phrases === "string" ? narrationWords(phrases).length : phrases.reduce((n, p) => n + narrationWords(p.text).length, 0);
}

// ── pace (W3.3): ONE metric for rubric R8, the Script card, script.md and lint L11 ──────────────────────────────────
// Before W3.3 the rubric counted spoken tokens over (last phrase end + tail) while L11 counted TTS word entries over
// (first word onset → last word end), so the card and the lint printed different words/s for the same reel.

/** The pace definition every surface prints (rubric.ts paceOf, card, script.md, lints L11). */
export const PACE_METRIC = "spoken words (spokenWords over every phrase, CTA included) / narration duration (reel start to the end of the last phrase + the 0.6 s tail = the timeline's durationMs)";
/** Seconds after the last phrase that count as narration time (timeline TAIL_MS). */
export const PACE_TAIL_SEC = TAIL_MS / 1000;
/** R8 level-3 band (words/s). */
export const PACE_TARGET = Object.freeze({ min: 2.6, max: 3.2 });
/** R8 cap band and lint L11 band (words/s). Mirrors WPS_BAND in src/v2/lints.ts. */
export const PACE_BAND = Object.freeze({ min: 2.5, max: 3.4 });

/**
 * PACE_METRIC: spoken words over every phrase / `durationSec`, where `durationSec` is the reel's narration duration —
 * the timeline's durationMs / 1000 (last phrase end + PACE_TAIL_SEC), or for timings: last endSec + PACE_TAIL_SEC.
 * `wps` is rounded to 2 decimals; null when the duration is 0.
 */
export function paceWps(phrases: readonly { text: string }[], durationSec: number): { words: number; durationSec: number; wps: number | null; metric: string } {
  const words = narrationWordCount(phrases);
  const d = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  return { words, durationSec: Math.round(d * 10) / 10, wps: d ? Math.round((words / d) * 100) / 100 : null, metric: PACE_METRIC };
}

/** Source date as shown on the page (published or "last updated"): YYYY, YYYY-MM or YYYY-MM-DD. */
export const SourceDate = z
  .string()
  .regex(/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/, "date: YYYY, YYYY-MM or YYYY-MM-DD");

export const ScriptPhrase = z
  .object({
    part: z.enum(PARTS),
    /** TTS unit = storyboard beat.phrase. */
    text: z.string().min(3).max(PHRASE_TEXT_MAX_CHARS),
    /** Exactly once in `text` (L5 rule). May be several words. */
    keyword: z.string().min(1).max(40),
  })
  .strict();

export const ScriptSource = z
  .object({
    id: Id,
    title: z.string().min(1).max(120),
    url: z
      .string()
      .max(300)
      .url()
      .refine((u) => /^https:\/\//i.test(u), "source url must be https"),
    /** W3.1 freshness: the page's published / last-updated date. Concept reels need ≥1 source dated within
     *  FRESHNESS_MAX_AGE_MONTHS of the job date (src/director/v2/rubric.ts freshnessGate). Omit when the page shows none. */
    published: SourceDate.optional(),
  })
  .strict();

/** W3.1 freshness: the recency check a concept reel built on older pages needs — a search for what changed since, and
 *  the current (dated) source that confirms the mechanism still holds as of the job date, or says what changed. */
export const ScriptRecency = z
  .object({
    /** The search query that was run for the recency check. */
    query: z.string().min(3).max(160),
    /** A source (in sources[]) with a `published` date within the freshness window. */
    sourceId: Id,
    /** One line: what the current source says (still true / changed on DATE). */
    finding: z.string().min(3).max(240),
  })
  .strict();

export const ScriptFact = z
  .object({
    id: Id,
    /** One concrete claim the narration makes (numbers spelled as the narration says them, or as digits). */
    claim: z.string().min(1).max(200),
    sourceId: Id,
    /** The claim is an example value (e.g. "give it 512 megabytes"), not a sourced figure. */
    illustrative: z.boolean().optional(),
  })
  .strict();

/** W7: the reel's track. "root-cause" (default: incidents and failure mechanisms, series ROOT CAUSE) or
 *  "how-it-works" (fundamentals: how an everyday thing actually works, series HOW IT WORKS by default). */
export const SCRIPT_TRACKS = ["root-cause", "how-it-works"] as const;
export type ScriptTrack = (typeof SCRIPT_TRACKS)[number];
const BEAT_ID = z.string().regex(/^b\d{2}$/, "beat id b01, b02, …");

/** W7 story-first: the ONE question the reel asks and the ONE answer it gives, committed before the storyboard,
 *  plus the beat outline (every phrase but the CTA serves that answer) and the jargon terms it defines.
 *  Checked by src/director/v2/story.ts (deterministic) and the fresh plain-language judge (clarity.ts). */
export const ScriptStory = z
  .object({
    /** The viewer's question in plain words (the hook asks it). */
    question: z.string().min(8).max(160),
    /** The answer in one plain sentence (the climax says it). */
    answer: z.string().min(8).max(220),
    /** The fact whose source states that answer (the climax must match the source's own answer). */
    answerFact: Id,
    /** Beat outline: consecutive groups of phrase beats in order, each with the point it makes toward the answer.
     *  W7.3: ONE step carries `key` = the KEY STEP beat (one of its beats): the change the answer rests on ("the finger
     *  takes some field away"); the storyboard draws that change in the focal subject on its keyword (lint L62). */
    outline: z
      .array(z.object({ beats: z.array(BEAT_ID).min(1).max(8), point: z.string().min(3).max(160), key: BEAT_ID.optional() }).strict())
      .min(3)
      .max(14),
    /** Jargon terms the narration uses, each defined in plain words where it is first spoken. */
    terms: z
      .array(z.object({ term: z.string().min(1).max(40), beat: BEAT_ID, definition: z.string().min(3).max(160) }).strict())
      .max(10)
      .default([]),
  })
  .strict();
export type ScriptStoryT = z.output<typeof ScriptStory>;

export const RubricSelfScore = z
  .object({
    id: z.enum(RUBRIC_IDS),
    score: z.number().int().min(0).max(3),
    why: z
      .string()
      .min(1)
      .max(240)
      .refine((w) => wordCount(w) <= 25, "why: at most 25 words"),
  })
  .strict();

const ScriptObject = z
  .object({
    version: z.literal(SCRIPT_VERSION),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug: kebab-case a-z 0-9").min(3).max(60),
    title: z.string().min(1).max(80),
    codename: z.string().regex(/^[A-Z0-9-]{4,12}$/, "codename: 4–12 chars A-Z 0-9 -"),
    mode: z.enum(["concept", "event"]),
    family: z.enum(SCRIPT_FAMILIES),
    headerMode: z.enum(HEADER_MODES),
    /** Acronyms that ARE the topic (PHP, TLS) and so do not count against the R7 jargon budget. */
    topicTerms: z.array(z.string().min(1).max(24)).max(6).default([]),
    phrases: z.array(ScriptPhrase).min(SCRIPT_PHRASES_MIN).max(SCRIPT_PHRASES_MAX),
    sources: z.array(ScriptSource).min(2).max(8),
    facts: z.array(ScriptFact).min(4).max(40),
    /** Director self-score, exactly R1..R12 once each. */
    rubric: z.array(RubricSelfScore).length(12),
    /** Director (and judge) mark the closure as a flip of the hook (R11 proxy exemption). */
    closureFlip: z.boolean().optional(),
    /** W3.1: the recency check (see ScriptRecency). */
    recency: ScriptRecency.optional(),
    /** W7: absent = "root-cause". */
    track: z.enum(SCRIPT_TRACKS).optional(),
    /** W7: the header series label (absent = the track's configured label; topics.ts seriesLabels). */
    series: z.string().regex(/^[A-Z][A-Z0-9 ]{1,14}[A-Z0-9]$/, "series: 3–16 chars A-Z 0-9 space").optional(),
    /** W7 story-first (required on the how-it-works track; see ScriptStory). */
    story: ScriptStory.optional(),
  })
  .strict();

type ScriptOut = z.output<typeof ScriptObject>;

function crossRefs(s: ScriptOut, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  const dupes = (ids: string[], what: string, key: string) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) issue(`duplicate ${what} id "${id}"`, [key, i, "id"]);
      seen.add(id);
    });
  };
  dupes(s.sources.map((x) => x.id), "source", "sources");
  dupes(s.facts.map((x) => x.id), "fact", "facts");
  dupes(s.rubric.map((x) => x.id), "rubric", "rubric");
  const sources = new Set(s.sources.map((x) => x.id));
  s.facts.forEach((f, i) => sources.has(f.sourceId) || issue(`fact "${f.id}": unknown source "${f.sourceId}"`, ["facts", i, "sourceId"]));
  if (s.recency) {
    const src = s.sources.find((x) => x.id === s.recency!.sourceId);
    if (!src) issue(`recency: unknown source "${s.recency.sourceId}"`, ["recency", "sourceId"]);
    else if (!src.published) issue(`recency: source "${src.id}" needs a published date (the recency check must cite a dated, current page)`, ["recency", "sourceId"]);
  }

  if (s.story) {
    const st = s.story;
    if (!s.facts.some((f) => f.id === st.answerFact)) issue(`story.answerFact: unknown fact "${st.answerFact}"`, ["story", "answerFact"]);
    const n = s.phrases.length;
    const known = (b: string) => Number(b.slice(1)) >= 1 && Number(b.slice(1)) <= n;
    st.outline.forEach((o, i) => o.beats.forEach((b, j) => known(b) || issue(`story.outline: beat ${b} does not exist (${n} phrases)`, ["story", "outline", i, "beats", j])));
    st.outline.forEach((o, i) => o.key && !o.beats.includes(o.key) && issue(`story.outline: key ${o.key} is not one of this step's beats (${o.beats.join(", ")})`, ["story", "outline", i, "key"]));
    const keys = st.outline.filter((o) => o.key);
    if (keys.length > 1) issue(`story.outline marks ${keys.length} key steps (${keys.map((o) => o.key).join(", ")}): exactly ONE beat is the key step`, ["story", "outline"]);
    st.terms.forEach((t, i) => known(t.beat) || issue(`story.terms: beat ${t.beat} does not exist (${n} phrases)`, ["story", "terms", i, "beat"]));
  }

  s.phrases.forEach((p, i) => {
    const hits = findSeq(tokenize(p.text), tokenize(p.keyword)).length;
    if (hits === 0) issue(`keyword "${p.keyword}" not in phrase text`, ["phrases", i, "keyword"]);
    else if (hits > 1) issue(`keyword "${p.keyword}" appears ${hits}× in phrase text (exactly once)`, ["phrases", i, "keyword"]);
    if (p.part === "ask") issue("part \"ask\" (mid-roll follow ask) is not allowed (D1 #12)", ["phrases", i, "part"]);
    if (p.part === "cta" && i !== s.phrases.length - 1) issue("a cta phrase must be the last phrase", ["phrases", i, "part"]);
  });
  const last = s.phrases.length - 1;
  if (last >= 0) {
    const lp = s.phrases[last];
    if (lp.part !== "cta") issue(`the last phrase must be part "cta" (got "${lp.part}")`, ["phrases", last, "part"]);
    else if (wordCount(lp.text) > SCRIPT_CTA_MAX_WORDS) issue(`cta has ${wordCount(lp.text)} words (max ${SCRIPT_CTA_MAX_WORDS})`, ["phrases", last, "text"]);
  }
}

export const ScriptV2 = ScriptObject.superRefine(crossRefs);
export type ScriptV2Input = z.input<typeof ScriptV2>;
export type ScriptV2 = z.output<typeof ScriptV2>;
export type ScriptPhraseT = ScriptV2["phrases"][number];
export type ScriptFactT = ScriptV2["facts"][number];
export type ScriptSourceT = ScriptV2["sources"][number];

export interface ScriptV2Parse {
  ok: boolean;
  value?: ScriptV2;
  /** "path: message" strings (path "(root)" for top-level issues). */
  errors: string[];
}

export function parseScriptV2(input: unknown): ScriptV2Parse {
  const r = ScriptV2.safeParse(input);
  if (r.success) return { ok: true, value: r.data, errors: [] };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`) };
}

/** Phrase index (0-based) → storyboard beat id: 0 → "b01". */
export function phraseBeatId(i: number): string {
  return `b${String(i + 1).padStart(2, "0")}`;
}

/** Input shape of research/r5/rubric_proxy.py (and of scoreRubricInput in src/director/v2/rubric.ts). */
export interface RubricInput {
  mode?: "concept" | "event";
  topicTerms?: string[];
  /** true = only a 20 s preview exists (R1, R2, R4, R5 only). Never set for v2 scripts. */
  preview?: boolean;
  /** Owner option for a mid-roll ask. D1 #12 bans it; kept for parity with the python proxy. */
  midrollAsk?: boolean;
  /** Seconds; overrides the estimate. */
  duration?: number;
  /** W3.2 (v2 only, never set by toRubricInput — the python port stays line for line): count the rhythm items
   *  (phrase / sentence length, words/s, estimated timings) in spoken tokens (spokenWords: "1.0.2" = 5). */
  spokenTokens?: boolean;
  closureFlip?: boolean;
  phrases: { text: string; part: string; keyword?: string; t?: number }[];
  facts?: { claim: string; source?: string }[];
  /** Per-criterion scores (self or judge); a missing id counts as 3. */
  judge?: Partial<Record<RubricId, number>> & Record<string, unknown>;
}

/** ScriptV2 → rubric_proxy.py input. `judge` carries the director's self-scores, so
 *  `python3 -I research/r5/rubric_proxy.py <out>` scores exactly what scoreRubric does without a fresh judge. */
export function toRubricInput(script: ScriptV2): RubricInput {
  const src = new Map(script.sources.map((s) => [s.id, s]));
  const judge: Partial<Record<RubricId, number>> = {};
  for (const r of script.rubric) judge[r.id] = r.score;
  return {
    mode: script.mode,
    topicTerms: [...script.topicTerms],
    ...(script.closureFlip ? { closureFlip: true } : {}),
    phrases: script.phrases.map((p) => ({ part: p.part, text: p.text, keyword: p.keyword })),
    facts: script.facts.map((f) => {
      const s = src.get(f.sourceId);
      return { claim: f.claim, source: f.illustrative ? "illustrative example" : s ? `${s.title} (${s.url})` : f.sourceId };
    }),
    judge,
  };
}
