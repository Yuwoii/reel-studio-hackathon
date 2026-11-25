// W7 story-first gate (deterministic half). Owner feedback 2026-10-27: the visuals are liked, the TOPICS were
// confusing. A reel now commits ONE question and ONE answer (script.story) plus a beat outline before the storyboard,
// and the narration is held to it:
//   - the outline covers every phrase but the CTA once, in order (every beat serves the answer; the fresh judge in
//     clarity.ts flags beats that open a second thread);
//   - the hook asks the question in plain words; the climax states the answer plainly;
//   - ≤ 1 NEW jargon term per beat, each declared in story.terms and defined in plain words where it is first spoken
//     (undeclared acronyms are refused);
//   - reading level: Flesch–Kincaid grade of the narration, target 8–10 (> STORY_GRADE_MAX refused);
//   - how-it-works track: ≤ 2 cited primary sources, concept + SPEC (topics.ts trackGaps);
//   - W7.1 how-it-works: a concrete picture before any definition (none in the first 3 beats, ≤ 1 in the hook act).
//   - W7.2 how-it-works: the answer once (climax ≤ 2 beats), one recap (closure ≤ 1), a short limits act (context ≤ 2).
//   - W7.3 how-it-works: the limits act is counted by CONTENT (a beat after the mechanism that introduces a limitation
//     counts, whatever its tag); after the climax at most ONE closure line, and it must add something new (a beat
//     that restates the climax / answer is refused); one outline step marks the KEY STEP, whose line says the change
//     the storyboard must draw (lint L62).
// The semantic half (can a fresh reader restate the answer from the narration alone?) is clarity.ts.

import type { ScriptStoryT, ScriptV2 } from "../../schema/script.v2.js";
import { phraseBeatId } from "../../schema/script.v2.js";
import { changeClasses } from "../../v2/lintsW73.js";
import { HOW_IT_WORKS_MAX_SOURCES, isHowItWorks, trackGaps, trackOf, type JobTrack } from "./topics.js";

/** Refusals of submit_script by this gate per phase, then the script is accepted with a red "story:" badge. */
export const MAX_STORY_REJECTIONS = 3;
export const STORY_BADGE_PREFIX = "story:";
/** Flesch–Kincaid grade: target band (prompt) and the refusal line. */
export const STORY_GRADE_TARGET = { min: 8, max: 10 } as const;
export const STORY_GRADE_MAX = 11;
/** New jargon terms one beat may introduce. */
export const MAX_NEW_TERMS_PER_BEAT = 1;
/** Hook ↔ question and climax ↔ answer: shared content stems needed (capped by what the sentence has). */
export const HOOK_QUESTION_MIN_SHARED = 2;
export const CLIMAX_ANSWER_MIN_SHARED = 3;
/** A term's definition is "spoken" when this many of its content stems are in its beat or the next one. */
export const DEFINITION_MIN_SHARED = 2;
/** W7.2 how-it-works answer budget (the W7.1 pilots restated the answer 3–4 times and spent 10–12 s on side facts —
 *  gloves, a loose band, the cold — before the payoff): the answer is said ONCE at the climax (a punch line + one
 *  plain statement), recapped at most once (closure), and the limits act (context) is short. */
export const MAX_CLIMAX_BEATS = 2;
export const MAX_RECAP_BEATS = 1;
export const MAX_LIMIT_BEATS = 2;

/** Acronyms everyone knows (no definition needed). Mirrors rubric.ts ACRONYM_OK plus everyday device words. */
const ACRONYM_OK = new Set(["AI", "US", "UK", "EU", "TV", "PC", "OK", "ID", "USB", "GPS", "CEO", "LED", "LEDS", "PS5", "PS3", "GTA", "AM", "PM", "TV", "DIY", "FAQ", "PIN", "SIM", "SMS", "PDF", "WIFI", "QR", "CD", "CDS", "DVD", "TL", "DR"]);
const ACRONYM = /\b[A-Z]{2,}[0-9]*s?\b/g;
const STOP = new Set(
  "a an the and or but so of to in on at by for with from into onto over under than then that this these those it its it's is are was were be been being do does did doing has have had having you your you're we our they their them he she his her i me my not no yes can could will would should may might must just only very really also even still as if when where what which who whom whose why how there here up down out off about all any each every some more most less few much many one two own same other such too s t don't isn't can't won't doesn't".split(" "),
);

const words = (t: string): string[] => (String(t ?? "").toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []);
/** Crude stem: plural / -ing / -ed / -ly endings (enough for overlap between a sentence and its paraphrase). */
export function stemWord(w: string): string {
  let x = w.toLowerCase().replace(/'s$/, "");
  if (x.length > 5 && x.endsWith("ing")) x = x.slice(0, -3);
  else if (x.length > 4 && x.endsWith("ied")) x = x.slice(0, -3) + "y";
  else if (x.length > 4 && x.endsWith("ed")) x = x.slice(0, -2);
  else if (x.length > 4 && x.endsWith("ies")) x = x.slice(0, -3) + "y";
  else if (x.length > 3 && x.endsWith("es") && /(?:ss|sh|ch|x)es$/.test(x)) x = x.slice(0, -2);
  else if (x.length > 3 && x.endsWith("s") && !x.endsWith("ss")) x = x.slice(0, -1);
  if (x.length > 5 && x.endsWith("ly")) x = x.slice(0, -2);
  return x.replace(/e$/, "");
}
export function contentStems(t: string): Set<string> {
  return new Set(words(t).filter((w) => !STOP.has(w) && w.length > 1).map(stemWord));
}
export function sharedStems(a: string, b: string): string[] {
  const B = contentStems(b);
  return [...contentStems(a)].filter((x) => B.has(x));
}

// ── reading level ──────────────────────────────────────────────────────────────────────────────────────────────

/** Heuristic English syllable count (vowel groups, silent -e, -le), ≥ 1. Numbers count as 2. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w) return 0;
  if (/^\d/.test(w)) return 2;
  if (w.length <= 3) return 1;
  // silent final -e / -es / -ed (a final consonant + "le" keeps its syllable: "table")
  const x = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, (m) => m[0]).replace(/^y/, "");
  return Math.max(1, x.match(/[aeiouy]{1,2}/g)?.length ?? 0);
}

/** Flesch–Kincaid grade of a list of phrases (each phrase may hold 1–2 sentences). */
export function fleschKincaidGrade(texts: readonly string[]): { grade: number; words: number; sentences: number; syllablesPerWord: number } {
  const all = texts.join(" ");
  const ws = all.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) ?? [];
  const sentences = Math.max(1, texts.reduce((n, t) => n + Math.max(1, (t.match(/[.?!]+(?:\s|$)/g) ?? []).length), 0));
  if (!ws.length) return { grade: 0, words: 0, sentences, syllablesPerWord: 0 };
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  const spw = syl / ws.length;
  const grade = 0.39 * (ws.length / sentences) + 11.8 * spw - 15.59;
  return { grade: Math.round(grade * 10) / 10, words: ws.length, sentences, syllablesPerWord: Math.round(spw * 100) / 100 };
}

// ── jargon ─────────────────────────────────────────────────────────────────────────────────────────────────────

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escRe(term.trim())}(?:s|es)?(?![\\p{L}\\p{N}])`, "iu");
const termReAll = (term: string) => new RegExp(termRe(term).source, "giu");

export interface JargonUse {
  beat: string;
  /** Declared terms first spoken in this beat. */
  declared: string[];
  /** Acronyms first spoken in this beat that are neither declared, topic terms, nor common. */
  undeclared: string[];
}

/** First use of every jargon term, per beat (CTA excluded). */
export function jargonFirstUses(script: Pick<ScriptV2, "phrases" | "topicTerms">, story: Pick<ScriptStoryT, "terms">): JargonUse[] {
  const topic = new Set(script.topicTerms.map((t) => t.toUpperCase()));
  const declared = story.terms.map((t) => t.term);
  const declaredUpper = new Set(declared.map((t) => t.toUpperCase()));
  const seen = new Set<string>();
  const out: JargonUse[] = [];
  script.phrases.forEach((p, i) => {
    if (p.part === "cta") return;
    const use: JargonUse = { beat: phraseBeatId(i), declared: [], undeclared: [] };
    for (const t of declared) if (!seen.has(t.toUpperCase()) && termRe(t).test(p.text)) use.declared.push(t);
    for (const m of p.text.match(ACRONYM) ?? []) {
      const a = m.replace(/s$/, "");
      const key = a.toUpperCase();
      if (ACRONYM_OK.has(key) || topic.has(key) || declaredUpper.has(key) || [...declaredUpper].some((d) => d.includes(key)) || seen.has(key)) continue;
      if (!use.undeclared.includes(a)) use.undeclared.push(a);
    }
    for (const t of use.declared) seen.add(t.toUpperCase());
    for (const a of use.undeclared) seen.add(a.toUpperCase());
    if (use.declared.length || use.undeclared.length) out.push(use);
  });
  return out;
}

// ── the gate ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface StoryCheck {
  gaps: string[];
  warnings: string[];
  grade: number | null;
}

export interface StoryCheckOptions {
  env?: NodeJS.ProcessEnv;
  /** Source ids the lines rest on (tools.ts usedSourceIdsOf); undefined = every script source counts. */
  usedSourceIds?: ReadonlySet<string>;
  /** W7.1: the job's track decided from the owner prompt (state.track); a contrary explicit script.track is refused. */
  jobTrack?: JobTrack | null;
}

// ── W7.1 picture before definitions ────────────────────────────────────────────────────────────────────────────
// W7 touchscreen pilot: b02–b04 defined capacitance, the electrostatic field and ground before the viewer saw a
// single picture. The first PICTURE_FIRST_BEATS beats show something concrete (a finger, a grid, a satellite); a
// definition waits, and the hook act (hook / stakes / reveal) carries at most MAX_HOOK_ACT_DEFINITIONS of them.

export const PICTURE_FIRST_BEATS = 3;
export const MAX_HOOK_ACT_DEFINITIONS = 1;
const HOOK_ACT_PARTS = new Set(["hook", "stakes", "reveal"]);
/** "Capacitance is an object's ability to store charge", "… is called destructive interference", "X means Y". */
const DEFINITION_RE =
  /\b(?:is|are)\s+(?:an?\s+|the\s+)?(?:[\w'’-]+\s+){0,3}?(?:ability|measure|amount|unit|property|tendency|name|word|term)\s+(?:of|for|to)\b|\b(?:is|are)\s+called\b|\bstands for\b|\b(?:means|meaning)\s+(?:that\s+)?(?:an?\s+|the\s+)/i;

/** Beats that define something: a declared story.terms beat, or a definitional sentence. CTA excluded. */
export function definitionBeats(script: Pick<ScriptV2, "phrases">, story: Pick<ScriptStoryT, "terms"> | undefined): Array<{ beat: string; what: string }> {
  const out = new Map<string, string>();
  for (const t of story?.terms ?? []) out.set(t.beat, `"${t.term}"`);
  script.phrases.forEach((p, i) => {
    const id = phraseBeatId(i);
    if (p.part !== "cta" && !out.has(id) && DEFINITION_RE.test(p.text)) out.set(id, JSON.stringify(p.text.slice(0, 60)));
  });
  return [...out].map(([beat, what]) => ({ beat, what })).sort((a, b) => (a.beat < b.beat ? -1 : 1));
}

/** Picture-first gaps: no definition in the first PICTURE_FIRST_BEATS beats, ≤ MAX_HOOK_ACT_DEFINITIONS in the hook act. */
export function pictureFirstGaps(script: Pick<ScriptV2, "phrases">, story: Pick<ScriptStoryT, "terms"> | undefined): string[] {
  const defs = definitionBeats(script, story);
  const gaps: string[] = [];
  const first = defs.filter((d) => Number(d.beat.slice(1)) <= PICTURE_FIRST_BEATS);
  if (first.length)
    gaps.push(`${first.map((d) => `${d.beat} defines ${d.what}`).join(", ")} — the first ${PICTURE_FIRST_BEATS} beats show a CONCRETE picture (the finger on the glass, the satellite overhead, the noisy plane cabin), never a definition: open on the thing and the question, define a term only once the viewer has seen what it names`);
  const hookAct = new Set(script.phrases.map((p, i) => (HOOK_ACT_PARTS.has(p.part) ? phraseBeatId(i) : "")).filter(Boolean));
  const inAct = defs.filter((d) => hookAct.has(d.beat));
  if (inAct.length > MAX_HOOK_ACT_DEFINITIONS)
    gaps.push(`the hook act (hook / stakes / reveal) defines ${inAct.length} things (${inAct.map((d) => `${d.beat} ${d.what}`).join(", ")}): at most ${MAX_HOOK_ACT_DEFINITIONS} — move the rest into the mechanism, each right where its picture appears`);
  return gaps;
}

// ── W7.3 limits by content ─────────────────────────────────────────────────────────────────────────────────────
// W7.2 anc: b14–b17 (tagged twist / mechanism: "why can you still hear people talking", "works best", "cancel less
// well") plus b18–b19 (context) made a 6-beat limits act that the tag count read as 2.

/** A line that introduces a limitation of the mechanism (what it cannot do, where it works worse, what defeats it). */
export const LIMIT_CUE_RE =
  /\b(?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|(?:doesn|don)(?:'|’)?t work|fail(?:s|ed|ing)?|struggl\w*|limit(?:s|ed|ation)?|weak(?:er)?|loose|hides?|still (?:hear|see|feel|get|leak\w*)|works? best|only works|rel(?:y|ies) on|less well|not as well|worse|harder|gloves?|too (?:far|thick|weak|fast|high|wet)|side effect|drawbacks?|downside|except)\b/i;
/** Uncued beats between two limit beats that still belong to the limits act (an example inside it). */
const LIMIT_GAP = 1;

/** Beats of the limits act by content: `context` beats plus, after the mechanism has started (after the key step when
 *  one is marked), every beat before the climax that introduces a limitation (LIMIT_CUE_RE), and an uncued beat
 *  sandwiched between two of them. */
export function limitBeats(script: Pick<ScriptV2, "phrases">, keyBeat?: string | null): string[] {
  const ph = script.phrases;
  const firstMech = ph.findIndex((p) => p.part === "mechanism");
  const key = keyBeat ? Number(keyBeat.slice(1)) - 1 : -1;
  const start = Math.max(firstMech, key) + 1;
  const climax = ph.findIndex((p) => p.part === "climax");
  const end = climax >= 0 ? climax : ph.findIndex((p) => p.part === "closure" || p.part === "cta");
  const hit = new Set<number>();
  ph.forEach((p, i) => {
    if (p.part === "context") hit.add(i);
    else if (firstMech >= 0 && i >= start && (end < 0 || i < end) && !["climax", "closure", "cta"].includes(p.part) && LIMIT_CUE_RE.test(p.text)) hit.add(i);
  });
  const sorted = [...hit].sort((a, b) => a - b);
  for (let k = 1; k < sorted.length; k++)
    if (sorted[k] - sorted[k - 1] - 1 > 0 && sorted[k] - sorted[k - 1] - 1 <= LIMIT_GAP) for (let j = sorted[k - 1] + 1; j < sorted[k]; j++) if (!["climax", "closure", "cta"].includes(ph[j].part)) hit.add(j);
  return [...hit].sort((a, b) => a - b).map(phraseBeatId);
}

/** W7.2: the answer once (climax ≤ MAX_CLIMAX_BEATS), one recap (closure ≤ MAX_RECAP_BEATS), a short limits act
 *  (≤ MAX_LIMIT_BEATS; W7.3: counted by content, limitBeats). how-it-works only. */
export function answerBudgetGaps(script: Pick<ScriptV2, "phrases">, keyBeat?: string | null): string[] {
  const ids = (part: string) => script.phrases.map((p, i) => (p.part === part ? phraseBeatId(i) : "")).filter(Boolean);
  const gaps: string[] = [];
  const climax = ids("climax");
  const recap = ids("closure");
  const limits = limitBeats(script, keyBeat);
  if (climax.length > MAX_CLIMAX_BEATS)
    gaps.push(`the climax has ${climax.length} beats (${climax.join(", ")}): say the answer ONCE — a ≤ 6-word punch line, then one plain statement of story.answer (≤ ${MAX_CLIMAX_BEATS} beats); a climax that re-tells the mechanism step by step restates what the viewer just saw`);
  if (recap.length > MAX_RECAP_BEATS) gaps.push(`the closure has ${recap.length} beats (${recap.join(", ")}): one recap line at most, then the CTA`);
  if (limits.length > MAX_LIMIT_BEATS)
    gaps.push(`the limits act (context) has ${limits.length} beats (${limits.join(", ")}; counted by what they say — a beat after the mechanism that brings in a limitation is the limits act, whatever its tag): ≤ ${MAX_LIMIT_BEATS} — keep the one limit that teaches the mechanism (it follows from what was shown) and cut the side facts, so the payoff comes sooner`);
  return gaps;
}

// ── W7.3 the ending: the answer ONCE, then at most one closure line that adds something new ─────────────────────
// W7.2 pilots: touch b19 "So glass never feels you. It notices a missing bit of field." (the reveal + climax again),
// watch b22 "Every beat is a tiny shadow in the green." (the climax as a metaphor), anc b22 "On a plane, quiet is a
// speaker playing the engine's opposite, plus padding." (every word already said).

/** A closure is a restatement when ≥ RESTATE_MIN_SHARED of its content words come from the climax / answer / reveal
 *  and they are ≥ RESTATE_SHARE of its words, or when it brings < CLOSURE_MIN_NEW words the reel has not said yet. */
export const RESTATE_MIN_SHARED = 2;
export const RESTATE_SHARE = 0.4;
export const CLOSURE_MIN_NEW = 2;
const FILLER = new Set(["never", "ever", "always", "again", "actually", "thing", "things", "way", "that", "what", "next", "time", "bit"].map(stemWord));
const closeStems = (t: string) => [...contentStems(t)].filter((x) => x.length > 1 && !FILLER.has(x) && !STOP.has(x));
/** Same word, or a compound of it ("heartbeat" ~ "beat", "airplane" ~ "plane"). */
const stemMatch = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.endsWith(b) || b.endsWith(a)));
const inSet = (x: string, set: readonly string[]) => set.some((y) => stemMatch(x, y));

export interface Restatement {
  beat: string;
  shared: string[];
  fresh: string[];
}

/** Post-climax beats (CTA excluded) that restate the answer instead of adding something new. */
export function restatements(script: Pick<ScriptV2, "phrases">, story: Pick<ScriptStoryT, "answer">): Restatement[] {
  const ph = script.phrases;
  let lastClimax = -1;
  ph.forEach((p, i) => p.part === "climax" && (lastClimax = i));
  if (lastClimax < 0) return [];
  const ref = closeStems([story.answer, ...ph.filter((p) => p.part === "climax" || p.part === "reveal").map((p) => p.text)].join(" "));
  const out: Restatement[] = [];
  for (let i = lastClimax + 1; i < ph.length; i++) {
    if (ph[i].part === "cta") continue;
    const said = closeStems(ph.slice(0, i).filter((p) => p.part !== "cta").map((p) => p.text).join(" "));
    const own = closeStems(ph[i].text);
    const shared = own.filter((x) => inSet(x, ref));
    const fresh = own.filter((x) => !inSet(x, said));
    if ((shared.length >= RESTATE_MIN_SHARED && shared.length / Math.max(1, own.length) >= RESTATE_SHARE) || fresh.length < CLOSURE_MIN_NEW) out.push({ beat: phraseBeatId(i), shared, fresh });
  }
  return out;
}

/** The ending gaps: ≤ MAX_RECAP_BEATS beats after the climax (any tag), none of them a restatement. how-it-works. */
export function endingGaps(script: Pick<ScriptV2, "phrases">, story: Pick<ScriptStoryT, "answer">): string[] {
  const gaps: string[] = [];
  const ph = script.phrases;
  let lastClimax = -1;
  ph.forEach((p, i) => p.part === "climax" && (lastClimax = i));
  if (lastClimax < 0) return gaps;
  const after = ph.map((p, i) => (i > lastClimax && p.part !== "cta" ? phraseBeatId(i) : "")).filter(Boolean);
  // (a closure-only overrun is answerBudgetGaps' "the closure has N beats")
  if (after.length > MAX_RECAP_BEATS && after.some((b) => ph[Number(b.slice(1)) - 1].part !== "closure")) gaps.push(`the ending has ${after.length} beats after the climax (${after.join(", ")}): the answer is said ONCE at the climax, then at most ${MAX_RECAP_BEATS} closure line, then the CTA`);
  for (const r of restatements(script, story))
    gaps.push(`the ending: ${r.beat} restates the answer (${r.shared.length ? `shares ${r.shared.join(", ")} with the climax / answer` : "no new idea"}; new: ${r.fresh.join(", ") || "nothing"}) — the climax already said it ONCE: the closure line may add ONE new thing the viewer can use (a consequence or test: "That's why a glove stops it working."), or cut it and end on the CTA`);
  return gaps;
}

// ── W7.3 the key step ──────────────────────────────────────────────────────────────────────────────────────────
// The owner: draw the key step. One outline beat is THE change the answer rests on; its line says the change and the
// storyboard draws it in the focal subject on the keyword (L62, src/v2/lintsW73.ts).

const KEY_PARTS = new Set(["reveal", "mechanism", "twist"]);

/** The marked key-step beat, or null. */
export function keyStepOf(story: Pick<ScriptStoryT, "outline"> | undefined): string | null {
  return story?.outline.find((o) => o.key)?.key ?? null;
}

/** Key-step gaps (how-it-works): one key step, on a mechanism beat, whose line says a change. */
export function keyStepGaps(script: Pick<ScriptV2, "phrases">, story: Pick<ScriptStoryT, "outline">): string[] {
  const key = keyStepOf(story);
  if (!key)
    return [`story.outline marks no key step: set "key" on the outline step that holds THE change the answer rests on (e.g. {beats:["b10","b11"], point, key:"b11"} for "The finger takes some of the field away.") — the storyboard must draw that change in the focal subject on its keyword`];
  const i = Number(key.slice(1)) - 1;
  const p = script.phrases[i];
  if (!p) return [];
  const gaps: string[] = [];
  if (!KEY_PARTS.has(p.part)) gaps.push(`the key step ${key} is a "${p.part}" beat: the key step is a mechanism beat (reveal / mechanism / twist) — the step the viewer must SEE happen, before the climax says it`);
  if (!changeClasses(p.text).length)
    gaps.push(`the key step ${key} (${JSON.stringify(p.text.slice(0, 80))}) does not say a change: its line names what happens (takes away, drops, dims, flips, combines, rises) so the board can draw exactly that`);
  return gaps;
}

/** The lint options the script fixes: its track and its key step (lintStoryboard L58 / L62). */
export function storyLintOptions(script: Pick<ScriptV2, "track" | "story">): { track: ReturnType<typeof trackOf>; keyStep?: string } {
  const key = keyStepOf(script.story);
  return { track: trackOf(script), ...(key ? { keyStep: key } : {}) };
}

/** Deterministic story-first gaps (refusal lines) and warnings for a script. No story and no track rule → empty. */
export function storyCheck(script: ScriptV2, o: StoryCheckOptions = {}): StoryCheck {
  const gaps = [...trackGaps(script, o.env, o.jobTrack)];
  const warnings: string[] = [];
  const hiw = isHowItWorks(script);
  if (hiw) {
    const cited = o.usedSourceIds ? script.sources.filter((s) => o.usedSourceIds!.has(s.id)) : script.sources;
    if (cited.length > HOW_IT_WORKS_MAX_SOURCES)
      gaps.push(`track "how-it-works" cites ${cited.length} sources (${cited.map((s) => s.id).join(", ")}): at most ${HOW_IT_WORKS_MAX_SOURCES} PRIMARY sources (the spec, the maker's application note, the standard) — rest every line on those two and drop the others from sources[] and facts[] (reading more pages is fine: on this track the research floor counts the pages you READ, not the ones you cite)`);
  }
  const story = script.story;
  if (!story) return { gaps, warnings, grade: null };

  // outline: every phrase but the CTA, once, in order
  const body = script.phrases.map((p, i) => ({ p, id: phraseBeatId(i) })).filter((x) => x.p.part !== "cta");
  const flat = story.outline.flatMap((o) => o.beats);
  const dup = flat.filter((b, i) => flat.indexOf(b) !== i);
  const missing = body.map((x) => x.id).filter((b) => !flat.includes(b));
  const ctaIds = script.phrases.map((p, i) => (p.part === "cta" ? phraseBeatId(i) : "")).filter(Boolean);
  const onCta = flat.filter((b) => ctaIds.includes(b));
  const order = flat.some((b, i) => i > 0 && b < flat[i - 1]);
  if (missing.length) gaps.push(`story.outline leaves out ${missing.join(", ")}: every phrase but the CTA belongs to one outline step that serves the answer — add it to its step, or cut the phrase if it serves nothing`);
  if (dup.length) gaps.push(`story.outline lists ${[...new Set(dup)].join(", ")} twice: each beat belongs to exactly one step`);
  if (onCta.length) gaps.push(`story.outline lists the CTA ${onCta.join(", ")}: leave the CTA out`);
  if (order) gaps.push(`story.outline is out of order: steps and their beats follow the phrase order`);

  // hook asks the question; climax states the answer
  const hook = script.phrases.filter((p) => p.part === "hook").map((p) => p.text).join(" ");
  const qStems = contentStems(story.question);
  const hookShared = sharedStems(story.question, hook);
  if (!/\?/.test(hook) && hookShared.length < Math.min(HOOK_QUESTION_MIN_SHARED, qStems.size))
    gaps.push(`the hook (${JSON.stringify(hook.slice(0, 120))}) does not ask story.question (${JSON.stringify(story.question)}): ask it in plain words in the hook — a viewer must know in the first 3 seconds what they will find out`);
  const climaxPh = script.phrases.filter((p) => p.part === "climax");
  const climax = climaxPh.map((p) => p.text).join(" ");
  const aStems = contentStems(story.answer);
  const climaxShared = sharedStems(story.answer, climax);
  if (!climaxPh.length) gaps.push(`no climax phrase: the climax states story.answer plainly`);
  else if (climaxShared.length < Math.min(CLIMAX_ANSWER_MIN_SHARED, aStems.size))
    gaps.push(`the climax (${JSON.stringify(climax.slice(0, 140))}) does not state story.answer (${JSON.stringify(story.answer.slice(0, 160))}) — shares only ${climaxShared.length ? climaxShared.join(", ") : "no words"}: say the answer plainly at the climax, in the words of the answer (a slogan may follow it, never replace it)`);
  if (hiw) gaps.push(...pictureFirstGaps(script, story), ...answerBudgetGaps(script, keyStepOf(story)), ...endingGaps(script, story), ...keyStepGaps(script, story));
  const answerFact = script.facts.find((f) => f.id === story.answerFact);
  if (answerFact?.illustrative) gaps.push(`story.answerFact "${answerFact.id}" is illustrative: the answer must rest on a sourced fact (the source's own answer)`);

  // jargon: ≤ 1 new term per beat, every term declared and defined where it is first spoken
  const uses = jargonFirstUses(script, story);
  for (const u of uses) {
    const n = u.declared.length + u.undeclared.length;
    if (n > MAX_NEW_TERMS_PER_BEAT)
      gaps.push(`${u.beat} introduces ${n} jargon terms (${[...u.declared, ...u.undeclared].join(", ")}): at most ${MAX_NEW_TERMS_PER_BEAT} new term per beat — move one to its own beat or say it in plain words`);
    if (u.undeclared.length)
      gaps.push(`${u.beat} uses ${u.undeclared.map((a) => `"${a}"`).join(", ")} without defining it: add it to story.terms {term, beat: "${u.beat}", definition} and say what it means in plain words in that phrase or the next, or replace it with plain words`);
  }
  const firstBeat = new Map(uses.flatMap((u) => u.declared.map((t) => [t.toUpperCase(), u.beat] as const)));
  for (const t of story.terms) {
    const first = firstBeat.get(t.term.toUpperCase());
    if (!first) {
      warnings.push(`story.terms "${t.term}" is never spoken — drop it`);
      continue;
    }
    if (first !== t.beat) gaps.push(`story.terms "${t.term}" is first spoken at ${first}, not ${t.beat}: define it where it is first used (set beat "${first}" and define it there)`);
    const i = Number(first.slice(1)) - 1;
    const near = [script.phrases[i]?.text ?? "", script.phrases[i + 1]?.text ?? ""].join(" ");
    const def = t.definition.replace(termReAll(t.term), " ");
    const dStems = contentStems(def);
    const shared = sharedStems(def, near.replace(termReAll(t.term), " "));
    if (shared.length < Math.min(DEFINITION_MIN_SHARED, dStems.size))
      gaps.push(`"${t.term}" is not defined where it is first spoken (${first}: ${JSON.stringify(script.phrases[i]?.text ?? "")}): say its definition (${JSON.stringify(t.definition)}) in plain words in ${first} or the phrase after it`);
  }

  // reading level (CTA excluded)
  const fk = fleschKincaidGrade(script.phrases.filter((p) => p.part !== "cta").map((p) => p.text));
  if (fk.grade > STORY_GRADE_MAX)
    gaps.push(`reading level grade ${fk.grade} (target ${STORY_GRADE_TARGET.min}–${STORY_GRADE_TARGET.max}, refused above ${STORY_GRADE_MAX}): shorter sentences and everyday words — ${fk.syllablesPerWord} syllables/word`);
  else if (fk.grade > STORY_GRADE_TARGET.max) warnings.push(`reading level grade ${fk.grade} is above the ${STORY_GRADE_TARGET.min}–${STORY_GRADE_TARGET.max} target: shorter sentences and everyday words`);
  return { gaps, warnings, grade: fk.grade };
}
