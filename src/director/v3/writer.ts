// v3 NARRATIVE WRITER contract (W1; ADR-002 §7 step 1, R1 PLAYBOOK §1–2, §6, §9; SCORECARD A, B, D2, E, H).
//
// The writer is a director turn: it writes narrative.json (src/schema/script.v3.ts) from the playbook and the research.
// This module is the contract around that turn:
//   - parseNarrative(): the zod schema, as readable gaps;
//   - writerGates(): the code-checkable rules (acts in order, the hook question and its pause, hook length at the last
//     word, pause variation, the share CTA, the series label, the analogy table, the "sounds like an AI answer"
//     detector);
//   - runScriptGates(): the whole script stage in order (schema → writer → terms → claims → fact check → physics +
//     analogy → non-technical viewer), stopping the paid judges early when a code gate already blocks;
//   - writerFeedback(): the refusal text handed back to the writer. Hints from the judges are listed there; they are
//     NEVER applied to the narration (R5 §5: FC2 auto-apply retired).
//
// Retired in v3 (R5 §5), so deliberately absent here: banned openers ("have you ever wondered" is the owner's own hook
// shape), the rubric floors/total and the R3/R5/R6/R10 caps, ST6/ST7 lexical story rules, GR4, the checker-rewrite rule,
// the self-score. Pacing on the voice (PA1) is W2: this stage only checks what the narrative itself says.
//
// S2 (owner, 2026-11-02/03; D1-DECISIONS-V3 "S1 owner feedback", "S2 voice", "S2 accepted"; the reference reel is
// test/fixtures/v3-w1/tls-termination.*): Ava, one sentence (or thought) per line, ONE rate for the reel, deliberate
// gaps as data. So decision 3a's −8…−14 % band (RATE3A) and decision 5g's pace bands are retired here; instead:
//   SENT1   every line ends a sentence (per-sentence synthesis; no sentence split across lines)
//   RATE    one rate, +0…+10 % (warn; the TTS step owns it)
//   PA1.*   pacing.ts's gap rules run on the script's own pauses (sink-in after a new name, ordinary 200–1000 ms,
//           ≥ 1 pause ≥ 500 ms per act) — the same code that checks the voice later
//   GAP.*   placement: sink-in (≥ 800 ms) gaps only after the hook question, a new name or the turn (an act's end);
//           ordinary gaps 250–350 (> 500 warns); a mid-reel question gets ≥ 400; ≤ 5 sink-ins
//   speak like a person: HOOKASK ("Ever wondered what … means?" → ask it the way people ask), TWIST1 (the unearned
//           "You'd think … / Not always." twist), PRON1 (a pronoun as the doer where the subject must be named:
//           "It has the key" → "That front server holds the website's key")
//   D2      an analogy is optional now ("map 1:1 or drop it"); AN1 a row without what carries over warns
//   DUR     60–75 s at the last spoken word

import { seriesLabels } from "../v2/topics.js";
import {
  ACT_INDEX,
  ACTS,
  gapsPass,
  HOOK_MAX_LAST_WORD_SEC,
  HOOK_PUNCH_MIN_PAUSE_MS,
  HOOK_QUESTION_MIN_PAUSE_MS,
  LEAD_SILENCE_MAX_MS,
  lineWords,
  Narrative,
  PAUSE_SD_MIN_MS,
  pauseStats,
  RATE_S2_PCT,
  rateFactor,
  REEL_DURATION_SEC,
  S2_GAPS_MS,
  speechEndSec,
  timingFor,
  type ClaimsT,
  type NarrativeT,
  type NarrativeTiming,
  type ScriptGap,
  type SourcesT,
} from "../../schema/script.v3.js";
import { runClaimsExtraction, type JudgeRunArgs, type JudgeSpend } from "./claims.js";
import { runClaimsFactCheck } from "./factcheckClaims.js";
import { hasOwnerData } from "./dataPack.js";
import { runNontech, type NontechResult } from "./nontech.js";
import { runPhysicsScript, type PhysicsScriptResult } from "./physicsScript.js";
import { JARGON, termGates, termRegex, type TermGateResult } from "./terms.js";
import { checkPacing, NAMING_RE, PA1_SINK_MIN_MS } from "../../v3/pacing.js";

/** The share-prompt CTA (decision 3d): "Send this to someone who …". */
export const CTA_SHARE_RE = /^\s*send this to\b/i;
export const CTA_MAX_WORDS = 12;
/** Words per spoken sentence (S2's longest: "That front server holds the website's key, so it unlocks your picture and
 *  hands it to the computers behind it." = 20). */
export const CONTENT_SENTENCE_MAX_WORDS = 20;
/** A line must end a sentence (src/v3/tts.ts SENTENCE_END_RE: per-sentence synthesis). */
export const SENTENCE_END_RE = /[.?!…]["'”’)\]]*\s*$/;
/** At most this many sink-in gaps (≥ PA1_SINK_MIN_MS) per reel (S2 has 4: the question, TLS, TLS termination, the turn). */
export const MAX_SINK_GAPS = 5;
/** S2 ordinary gap ceiling: 250–350 typical, up to ~450–500 for the problem / an act's reason line. */
export const ORDINARY_GAP_MAX_MS = 500;
/** A mid-reel question line needs at least this much to land (S2: 600 and 400). */
export const QUESTION_GAP_MIN_MS = 400;
/** S1's rejected hook shape: the owner wants it asked the way people actually ask, about the thing on screen. */
export const HOOK_ASK_RE = /^\s*(?:have you\s+)?ever wondered\b/i;
/** S1's rejected twist: a belief set up ("You'd think …") and knocked down by a tiny negation line. */
export const BELIEF_RE = /\b(?:you'd|you’d|you would|you might|you may|most people)\s+think\b/i;
export const NEGATION_PUNCH_RE = /^\s*(?:not always|not quite|not really|nope|wrong|actually,? no|not exactly)\b/i;
/** A pronoun as the doer of an action (S1 "It has the key"): the owner wants the subject named. */
export const PRONOUN_DOER_RE = /^\s*(?:(?:so|and|but|then|now|which),?\s+)?(it|they)\s+(has|have|holds|hold|opens|open|unlocks|unlock|locks|lock|reads|read|sends|send|hands|hand|passes|pass|keeps|keep|sees|see|owns|own|works|work|knows|know|does|do|checks|check|stores|store)\b/i;
/** A hedge word (SCORECARD: keep the source's hedges, but never two in a row). */
export const HEDGE_RE = /\b(?:often|usually|typically|generally|sometimes|mostly|normally)\b/i;
/** "the key to your lock" / "your key": the key that unlocks belongs to the website, not the viewer. */
export const KEY_TO_YOUR_RE = /\bkey to your\b|\byour (?:own )?key\b/i;
/** Rates edge-tts Andrew stays natural in (R2: below about −20 % he drags). */
export const RATE_MIN = -20;
export const RATE_MAX = 10;
/** AI-answer detector: ≥ this many flags fails the script (SCORECARD H). */
export const AI_FLAGS_BLOCK = 3;
/** Causal connectives (SCORECARD E5). */
export const CONNECTIVES = /\b(?:so|because|which|but|and|then|when|if|until|while|meaning|instead|now)\b/gi;

export interface ParsedNarrative {
  narrative: NarrativeT | null;
  gaps: ScriptGap[];
}

export function parseNarrative(raw: unknown): ParsedNarrative {
  const r = Narrative.safeParse(raw);
  if (r.success) return { narrative: r.data, gaps: [] };
  return {
    narrative: null,
    gaps: r.error.issues.slice(0, 20).map((i) => ({ gate: "schema", code: "SCHEMA", severity: "block", message: `${i.path.join(".") || "narrative"}: ${i.message}` })),
  };
}

export interface WriterStats {
  words: number;
  sentences: number;
  sentenceMean: number;
  sentenceSd: number;
  connectivesPer100: number;
  pause: { mean: number; sd: number; maxRun: number };
  /** Last spoken word of the hook act (s) and whether it is measured. */
  hookLastWordSec: number | null;
  hookMeasured: boolean;
  totalSec: number | null;
}

export interface AiFlag {
  id: string;
  lines: string[];
  why: string;
}

export interface WriterGateResult {
  ok: boolean;
  gaps: ScriptGap[];
  flags: AiFlag[];
  stats: WriterStats;
}

const sentencesOf = (text: string) =>
  String(text ?? "")
    .split(/(?<=[.!?])\s+|(?<=\.\.\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => lineWords(s).length > 0);
const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length));
};
const rateNum = (r: string) => Math.round((rateFactor(r) - 1) * 100);

/** "Sounds like an AI answer" detector, the mechanical items of SCORECARD H (H1–H3, H6, H8, H11, H12, list). */
export function aiAnswerFlags(n: NarrativeT, stats: Pick<WriterStats, "sentenceSd" | "sentenceMean" | "connectivesPer100" | "pause">): AiFlag[] {
  const flags: AiFlag[] = [];
  const hit = (id: string, lines: string[], why: string) => lines.length && flags.push({ id, lines, why });
  hit("H1", n.lines.filter((l) => /^\s*(?:the answer|in short|in summary|simply put|basically)\b/i.test(l.text) || /^\s*that(?:'s| is)\s+[A-Z][\w-]*(?:\s+[\w-]+){0,2}\s*:/.test(l.text)).map((l) => l.id), "announced answer (\"The answer: …\", \"That is X: …\")");
  const termRes = [...n.terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")), ...JARGON.map((j) => j.re)];
  hit(
    "H2",
    n.lines.filter((l) => termRes.some((t) => new RegExp(`^\\s*(?:(?:that|the|a|an|this)\\s+)?(?:${t})s?\\s+(?:is|are|means)\\b`, "i").test(l.text))).map((l) => l.id),
    "dictionary line (\"<term> is <definition>\")",
  );
  if (stats.pause.sd < 120 || stats.sentenceSd < 2.5) hit("H3", [n.lines[0].id], `metronome: pause SD ${Math.round(stats.pause.sd)} ms, sentence-length SD ${stats.sentenceSd.toFixed(1)}`);
  // the root-cause vendor (narrative.vendor) is the topic, not an aside: its own name is masked before the check
  const vendorRe = vendorRegex(n);
  hit("H6", n.lines.filter((l) => /^\s*(?:on|in|at|according to)\s+(?:aws|amazon|google|microsoft|azure|cloudflare|nginx|apple|meta|the docs)\b|\b(?:aws|amazon's|google's|microsoft's|nginx)\b/i.test(vendorRe ? l.text.replace(vendorRe, "VENDOR") : l.text)).map((l) => l.id), "vendor or source aside");
  const scenario = n.lines.some((l) => /\b(?:when you|ever|imagine|you'd|you've|your)\b/i.test(l.text));
  if (!scenario && !n.analogy) hit("H8", [n.lines[0].id], "no viewer, no situation: no scenario line and no analogy");
  if (stats.connectivesPer100 < 4 && stats.sentenceMean < 9) hit("H11", [n.lines[0].id], `disconnected facts: ${stats.connectivesPer100.toFixed(1)} connectives / 100 words, ${stats.sentenceMean.toFixed(1)} words per sentence`);
  const cta = n.lines.at(-1);
  if (cta?.act === "cta") {
    const before = n.lines.at(-2);
    if (!CTA_SHARE_RE.test(cta.text) && (before?.pauseAfterMs ?? 0) < 500) hit("H12", [cta.id], "generic tail: a CTA not tied to the topic, with no pause before it");
  }
  hit("HL", n.lines.filter((l) => /^\s*(?:first|firstly|secondly|then|next|finally)\b,?/i.test(l.text)).length >= 2 ? n.lines.filter((l) => /^\s*(?:first|firstly|secondly|then|next|finally)\b,?/i.test(l.text)).map((l) => l.id) : [], "\"First, … Then, … Finally\" list");
  return flags;
}

/** The root-cause vendor's name as a whole-word regex (possessive allowed), or null (how-it-works / none). */
export function vendorRegex(n: Pick<NarrativeT, "track" | "vendor">): RegExp | null {
  if (n.track !== "root-cause" || !n.vendor) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${n.vendor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?:'s)?(?![\\p{L}\\p{N}])`, "giu");
}

export interface WriterGateOptions {
  /** Measured TTS word times (W2 / R1 tts-timing); without them hook length is an estimate (warn only). */
  timing?: NarrativeTiming | null;
  /** The last two reels of the series: hook pattern + opening word (SCORECARD H14). */
  recent?: Array<{ hookPattern: string; openingWord: string }>;
  env?: NodeJS.ProcessEnv;
}

export function writerGates(n: NarrativeT, o: WriterGateOptions = {}): WriterGateResult {
  const gaps: ScriptGap[] = [];
  const g = (code: string, severity: ScriptGap["severity"], message: string, lines?: string[], hint?: string) => gaps.push({ gate: "writer", code, severity, message, ...(lines ? { lines } : {}), ...(hint ? { hint } : {}) });
  const L = n.lines;

  // acts in order (B2)
  for (let i = 1; i < L.length; i++)
    if (ACT_INDEX[L[i].act] < ACT_INDEX[L[i - 1].act]) g("B2", "block", `${L[i].id} is ${L[i].act} after ${L[i - 1].act}: acts run ${ACTS.join(" → ")}`, [L[i].id]);
  const has = (a: string) => L.some((l) => l.act === a);
  const need = n.scope === "reel" ? ["hook", "ground", "mechanism", "payoff", "cta"] : ["hook", "ground", "mechanism"];
  for (const a of need) if (!has(a)) g("B2", "block", `no ${a} act`, undefined, a === "ground" ? "Lay the one prerequisite picture before the mechanism (an everyday situation + the analogy)." : undefined);
  if (n.scope === "reel" && !has("why") && !has("tradeoff")) g("B2", "block", "no why / trade-off act between the mechanism and the payoff");
  const ctas = L.filter((l) => l.act === "cta");
  if (n.scope === "reel") {
    if (ctas.length !== 1 || L.at(-1)?.act !== "cta") g("B9", "block", `the reel must end on exactly one CTA line (found ${ctas.length})`);
    const cta = ctas.at(-1);
    if (cta && !CTA_SHARE_RE.test(cta.text)) g("CTA", "block", `CTA "${cta.text}" is not the topic share prompt`, [cta.id], 'Decision 3d: "Send this to someone who …", tied to the hook object.');
    if (cta && lineWords(cta.text).length > CTA_MAX_WORDS) g("CTA", "error", `CTA has ${lineWords(cta.text).length} words (≤ ${CTA_MAX_WORDS})`, [cta.id]);
    const before = L.at(-2);
    if (before && before.pauseAfterMs < 500) g("CTA", "warn", `only ${before.pauseAfterMs} ms before the CTA (700–900 recommended)`, [before.id]);
  } else if (ctas.length) g("B9", "warn", "an opening carries no CTA", ctas.map((c) => c.id));

  // series label stays (decision 4)
  const want = seriesLabels(o.env)[n.track];
  if (n.series !== want) g("SERIES", "block", `series "${n.series}" must be the ${n.track} label "${want}"`);

  // hook: a question or contradiction about the object, then silence (A3); length at the last word (decision 3c)
  const hook = L.filter((l) => l.act === "hook");
  const q = hook.findIndex((l) => /\?\s*$/.test(l.text));
  if (q >= 0) {
    const ql = hook[q];
    const next = hook[q + 1];
    const punchOk = next && lineWords(next.text).length <= 4 && next.pauseAfterMs >= HOOK_PUNCH_MIN_PAUSE_MS;
    if (ql.pauseAfterMs < HOOK_QUESTION_MIN_PAUSE_MS && !punchOk)
      g("A3", "block", `${ql.id} asks the hook question with ${ql.pauseAfterMs} ms after it (≥ ${HOOK_QUESTION_MIN_PAUSE_MS} ms, or a ≤ 4-word punch line with ≥ ${HOOK_PUNCH_MIN_PAUSE_MS} ms)`, [ql.id], "Let the question land: pause 800–1000 ms.");
  } else if (!["contradiction", "lived-moment", "myth-twist"].includes(n.hookPattern)) g("A3", "error", `a ${n.hookPattern} hook has no question line`, hook.map((h) => h.id));
  const lastHook = hook.at(-1);
  // with a question, its sink-in is the hook's silence (S2: "Say you post a cat picture." follows at 250 ms); without
  // one, the hook's last line carries it (PA1.hook reads the same way)
  if (q < 0 && lastHook && lastHook.pauseAfterMs < HOOK_QUESTION_MIN_PAUSE_MS) g("A3", "block", `the hook ends (${lastHook.id}) with ${lastHook.pauseAfterMs} ms of silence (≥ ${HOOK_QUESTION_MIN_PAUSE_MS} ms)`, [lastHook.id]);
  if (HOOK_ASK_RE.test(L[0].text)) g("HOOKASK", "warn", `${L[0].id} "${L[0].text}" asks it like a quiz, not the way people actually ask`, [L[0].id], "Ask about the thing on screen in the viewer's own words: \"What does this little 's' actually stand for?\" (S2), not \"Ever wondered what the S in https means?\" (S1, rejected).");
  if (n.leadSilenceMs > LEAD_SILENCE_MAX_MS) g("A4", "warn", `lead silence ${n.leadSilenceMs} ms (≤ ${LEAD_SILENCE_MAX_MS} ms, with motion)`);

  const { timing, measured, rejected } = timingFor(n, o.timing);
  // a supplied measurement that does not match the narrative word for word must not quietly turn A5 / TA1 / DUR
  // into estimate-only warnings (W1 fix round): refuse, so the writer or the TTS step fixes the mismatch
  if (rejected) g("TIM0", "block", `measured timing was supplied but does not match the narrative (${rejected}); the hook-length, term-picture and duration checks would fall back to estimates`, undefined, "Re-run synthesize_tts on this exact narrative, or write numbers and symbols the way the voice reads them.");
  const tl = new Map(timing.lines.map((l) => [l.id, l]));
  const hookLast = lastHook ? tl.get(lastHook.id)?.wordTimes.at(-1)?.endSec ?? null : null;
  if (hookLast !== null && hookLast > HOOK_MAX_LAST_WORD_SEC)
    g("A5", measured ? "block" : "warn", `the hook's last word ends at ${hookLast.toFixed(2)} s (${measured ? "measured" : "est."}; ≤ ${HOOK_MAX_LAST_WORD_SEC} s)`, lastHook ? [lastHook.id] : undefined, "Shorten the hook: one question, one beat of silence, at most one punch line.");

  // reel length (ADR-002 PA1: 60–80 s); an opening has no length rule
  // reel length at the last spoken word (S2: ≤ 75 s; PA1.duration); an opening has no length rule
  const speechEnd = speechEndSec(timing) ?? timing.totalSec ?? null;
  if (n.scope === "reel") {
    const total = speechEnd;
    if (total !== null && (total < REEL_DURATION_SEC.min || total > REEL_DURATION_SEC.max))
      g("DUR", measured ? "block" : "warn", `the last word ends at ${total.toFixed(2)} s (${measured ? "measured" : `est., ${n.voice}`}; ${REEL_DURATION_SEC.min}–${REEL_DURATION_SEC.max} s)`, undefined, total > REEL_DURATION_SEC.max ? "Cut a line that adds nothing to the viewer's picture (put it in the caption). Do not shorten the sink-in gaps to fit." : "The reel is short: give the mechanism one more visible step.");
  }

  // vendor named once (root-cause)
  const vre = vendorRegex(n);
  if (vre) {
    const said = L.filter((l) => (l.text.match(vre)?.length ?? 0) > 0);
    const times = L.reduce((a, l) => a + (l.text.match(vre)?.length ?? 0), 0);
    if (times > 1) g("VEN", "error", `the vendor "${n.vendor}" is spoken ${times} times (named once: it is the topic, not a refrain)`, said.map((l) => l.id), "Name the company once; after that say \"they\" or name the thing that broke.");
  } else if (n.vendor && n.track !== "root-cause") g("VEN", "warn", `vendor "${n.vendor}" is set on a ${n.track} reel; it only applies to root-cause`);

  // answer withheld in the hook: no topic term in it (A6, the mechanical half)
  for (const t of n.terms.filter((x) => x.topic)) for (const h of hook) if (new RegExp(`\\b${t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(h.text)) g("A6", "block", `the hook names the topic term "${t.term}"`, [h.id]);

  // pauses as data (E1/E2)
  const ps = pauseStats(L);
  if (ps.sd < PAUSE_SD_MIN_MS) g("E1", "block", `pause SD ${Math.round(ps.sd)} ms (≥ ${PAUSE_SD_MIN_MS} ms): the pauses sound like a metronome`, undefined, `Place the gaps deliberately (S2): ${S2_GAPS_MS.sink.join("–")} after the opening question, a new name and the turn; ${S2_GAPS_MS.big.join("–")} after a big question or the closing line; ${S2_GAPS_MS.ordinary.join("–")} between ordinary sentences.`);
  if (ps.maxRun > 2) g("E2", "warn", `${ps.maxRun} consecutive lines share one pause value`);

  // rates (S2: one rate for the reel, +0…+10 %; the writer normally leaves it to the default)
  for (const l of L) {
    const r = rateNum(l.rate);
    if (r < RATE_MIN || r > RATE_MAX) g("RATE", "error", `${l.id} rate ${l.rate} is outside ${RATE_MIN}…+${RATE_MAX} %`, [l.id]);

    // per-sentence lines (S2): each line is one whole sentence (or two short ones), never half of one
    if (!SENTENCE_END_RE.test(l.text)) g("SENT1", "error", `${l.id} "${l.text.trim().slice(-30)}" does not end a sentence: the voice reads one whole sentence per line`, [l.id], "Join it with the next line into one sentence; place the pause after the sentence, not inside it.");
    if (l.act !== "cta")
      for (const s of sentencesOf(l.text)) {
        const w = lineWords(s).length;
        if (w > CONTENT_SENTENCE_MAX_WORDS) g("B11", "warn", `${l.id} has a ${w}-word sentence; one idea per sentence, ≤ ${CONTENT_SENTENCE_MAX_WORDS} words`, [l.id]);
      }
  }
  const slowed = L.filter((l) => { const r = rateNum(l.rate); return r >= RATE_MIN && r <= RATE_MAX && (r < RATE_S2_PCT.min || r > RATE_S2_PCT.max); });
  if (slowed.length) g("RATE", "warn", `${slowed.length} line(s) outside the S2 voice range +${RATE_S2_PCT.min}…+${RATE_S2_PCT.max} %: ${slowed.map((l) => `${l.id} ${l.rate}`).join(", ")}`, slowed.map((l) => l.id), "Never slow the voice (S1's −8…−14 % read as slowed and robotic); leave rate at the default +5 %.");
  const rates = [...new Set(L.map((l) => l.rate))];
  if (rates.length > 1) g("RATE", "warn", `mixed rates ${rates.join(", ")}: S2 reads the reel at one rate`, undefined, "Use one rate for every line (default +5 %); pace comes from the gaps, not the rate.");

  // analogy: optional (owner: "map 1:1 or drop it"); when present every row says what carries over
  if (!n.analogy) g("D2", "warn", "no analogy table: fine when the real thing is shown directly; if the script leans on an image (the lock), map it 1:1 in a table");
  else for (const r of n.analogy.rows) if (!r.carriesOver) g("AN1", "warn", `analogy row "${r.source}" does not say what carries over: an analogy must map 1:1 to what really happens`, undefined, "Fill carriesOver, or drop the analogy (S1's mailroom did not map to a website and was rejected).");

  // speak like a person (S1 owner feedback)
  for (let i = 0; i + 1 < L.length; i++)
    if (BELIEF_RE.test(L[i].text) && (NEGATION_PUNCH_RE.test(L[i + 1].text) && lineWords(L[i + 1].text).length <= 4))
      g("TWIST1", "error", `${L[i].id}–${L[i + 1].id} "${L[i].text} ${L[i + 1].text}" is an unearned twist`, [L[i].id, L[i + 1].id], "Say the plain stake with a concrete example instead (S2: \"Say you post a cat picture. That 's' keeps it safe while it travels from your phone to the website.\").");
  const names = n.names.flatMap((r) => r.name.split(/[,;/()]|\bthen\b|\bor\b/).map((x) => x.replace(/^\s*(?:the|a|an|your|that)\s+/i, "").trim()).filter((x) => x.length >= 3 && !/^(?:it|named once)/i.test(x)));
  for (let i = 1; i < L.length; i++) {
    const m = PRONOUN_DOER_RE.exec(L[i].text);
    if (!m) continue;
    const prevLast = sentencesOf(L[i - 1].text).at(-1) ?? "";
    // fine when it continues the previous sentence's own pronoun subject ("It stands for secure." → "It locks …")
    if (new RegExp(`^\\s*${m[1]}\\b`, "i").test(prevLast)) continue;
    const named = names.filter((x) => termRegex(x).test(prevLast));
    g("PRON1", "warn", `${L[i].id} opens with "${m[1]} ${m[2]}": name who does it${named.length ? ` (the line before names ${named.join(", ")})` : ""}`, [L[i].id], "Name the subject explicitly: \"That front server holds the website's key\", not \"It has the key\".");
  }
  // W4 review (TLS "often runs on … / Often, what you send …"): two hedged lines in a row sound written
  for (let i = 0; i + 1 < L.length; i++)
    if (HEDGE_RE.test(L[i].text) && HEDGE_RE.test(L[i + 1].text))
      g("HEDGE2", "warn", `${L[i].id}–${L[i + 1].id} hedge twice in a row`, [L[i].id, L[i + 1].id], "Keep at most one hedge (S2: \"A big website isn't one computer. / Everything you send hits a front server first.\"); hedge only where the source does.");
  // W4 review (TLS L11 "the key to your lock"): the browser locks, the WEBSITE's key unlocks — "your" key does not map
  for (const l of L)
    if (KEY_TO_YOUR_RE.test(l.text))
      g("KEY1", "warn", `${l.id} "${KEY_TO_YOUR_RE.exec(l.text)?.[0]}": the viewer asks how the website got your key`, [l.id], "Say whose key it is: \"That front server holds the website's key\".");

  // S2 gaps on the script's own pauses: pacing.ts's rules (the same code that later checks the voice), then placement
  const isQ = (l: (typeof L)[number]) => /\?["'”’)\]]*\s*$/.test(l.text);
  const namedTermLines = new Set([...n.terms.filter((t) => t.topic || NAMING_RE.test(L.find((l) => l.id === t.termLine)?.text ?? "")).map((t) => t.termLine), ...L.filter((l) => NAMING_RE.test(l.text)).map((l) => l.id)]);
  const actEnd = (i: number) => i + 1 < L.length && L[i + 1].act !== L[i].act;
  const hookQ = q >= 0 ? hook[q].id : lastHook?.id;
  const pa = checkPacing(L.map((l) => ({ id: l.id, act: l.act, text: l.text })), timing, { scope: "opening", termLines: [...namedTermLines].filter((id) => id !== L.at(-1)?.id), audiblePausesMs: L.slice(0, -1).map((l) => l.pauseAfterMs), pauseSource: "audible" });
  for (const x of pa.gaps) if (["PA1.sink", "PA1.gap", "PA1.actPause"].includes(x.code)) g(x.code, x.severity, x.message, x.lines, x.hint);
  let sinks = 0;
  L.slice(0, -1).forEach((l, i) => {
    const p = l.pauseAfterMs;
    const justified = l.id === hookQ || l.act === "hook" || namedTermLines.has(l.id) || actEnd(i);
    if (p >= PA1_SINK_MIN_MS) {
      sinks++;
      if (!justified) g("GAP.long", "warn", `${l.id} has a ${p} ms sink-in gap but is not the hook question, a new name or the end of an act (the turn)`, [l.id], `Ordinary sentences get ${S2_GAPS_MS.ordinary.join("–")} ms; save ${S2_GAPS_MS.sink.join("–")} for what must sink in.`);
    } else if (!justified && !isQ(l) && L[i + 1]?.act !== "cta" && p > ORDINARY_GAP_MAX_MS)
      g("GAP.ordinary", "warn", `${l.id} is an ordinary sentence with ${p} ms after it (S2: ${S2_GAPS_MS.ordinary.join("–")}, ≤ ${ORDINARY_GAP_MAX_MS})`, [l.id], "Long gaps between ordinary sentences made S1 sound slowed; let them flow.");
    if (isQ(l) && l.act !== "hook" && p < QUESTION_GAP_MIN_MS) g("GAP.question", "warn", `${l.id} asks a question with only ${p} ms after it`, [l.id], `Let a big question land: ${S2_GAPS_MS.big.join("–")} ms.`);
  });
  if (sinks > MAX_SINK_GAPS) g("GAP.sinkCount", "warn", `${sinks} sink-in gaps (≥ ${PA1_SINK_MIN_MS} ms; S2 has 4, ≤ ${MAX_SINK_GAPS}): too many and the reel drags`, undefined, "Keep sink-ins for the opening question, each new name and the turn.");

  // shots: every mechanism line names what is on screen (F1 is enforced on the board in W4; here intent only)
  for (const l of L.filter((x) => x.act === "mechanism")) if (!l.shot?.anchor && !l.shot?.asset) g("F1", "warn", `${l.id} (mechanism) names no anchor/asset in its shot intent`, [l.id]);

  // stats + AI-answer detector
  const sents = L.filter((l) => l.act !== "cta").flatMap((l) => sentencesOf(l.text).map((s) => lineWords(s).length));
  const words = L.reduce((a, l) => a + lineWords(l.text).length, 0);
  const conn = L.reduce((a, l) => a + (l.text.match(CONNECTIVES)?.length ?? 0), 0);
  const stats: WriterStats = {
    words,
    sentences: sents.length,
    sentenceMean: sents.reduce((a, b) => a + b, 0) / Math.max(1, sents.length),
    sentenceSd: sd(sents),
    connectivesPer100: (conn / Math.max(1, words)) * 100,
    pause: { mean: ps.mean, sd: ps.sd, maxRun: ps.maxRun },
    hookLastWordSec: hookLast,
    hookMeasured: measured,
    totalSec: measured ? speechEnd : null,
  };
  const flags = aiAnswerFlags(n, stats);
  if (flags.length >= AI_FLAGS_BLOCK) g("H", "block", `sounds like an AI answer: ${flags.length} flags (${flags.map((f) => `${f.id} ${f.why}`).join("; ")})`, [...new Set(flags.flatMap((f) => f.lines))]);
  else for (const f of flags) g(f.id, "warn", f.why, f.lines);

  // series template (H14): hook pattern / opening word vs the last two reels
  const open = lineWords(L[0].text)[0]?.toLowerCase() ?? "";
  for (const r of o.recent?.slice(-2) ?? []) if (r.hookPattern === n.hookPattern || r.openingWord.toLowerCase() === open) g("H14", "warn", `hook repeats a recent reel (${r.hookPattern} / "${r.openingWord}")`);

  return { ok: gapsPass(gaps), gaps, flags, stats };
}

/** Everything the script stage produced, in order. */
export interface ScriptGateReport {
  ok: boolean;
  /** The first gate that failed (null = all passed). */
  failedAt: ScriptGap["gate"] | null;
  gaps: ScriptGap[];
  writer: WriterGateResult | null;
  terms: TermGateResult | null;
  claims: ClaimsT | null;
  physics: PhysicsScriptResult | null;
  nontech: NontechResult | null;
  /** turns / $ per judge call (subscription-notional $), in call order. */
  spend: JudgeSpend[];
  /** Hints for the writer (never applied). */
  hints: string[];
  /** Raw judge replies by gate (audit trail; W1 REPORT quotes them). */
  raw: Record<string, string>;
  /** Majority votes each judge ran (W1.1: default 3 for fact check, physics and viewer). */
  votes: { factcheck?: number; physics?: number; nontech?: number };
}

export interface ScriptGateArgs extends JudgeRunArgs {
  narrative: unknown;
  sources: SourcesT;
  timing?: NarrativeTiming | null;
  /** Plain asset facts for the physics judge (W4 fills them from the registry). */
  assetFacts?: string[];
  recent?: WriterGateOptions["recent"];
  /** Run every judge even after an earlier gate failed (measurement runs; the live loop stops early). */
  runAll?: boolean;
  /** Which judges to run (default all). */
  only?: ReadonlyArray<"claims" | "factcheck" | "physics" | "nontech">;
  /** Notional $ cap for ONE script-gate run (default REEL_V3_SCRIPT_GATE_MAX_USD, else SCRIPT_GATE_MAX_USD). */
  maxUsd?: number;
}

/** W1.1 fix round: voting triples judge load on the CLAUDE_CODE_OAUTH_TOKEN subscription the live bots share (W1.1 hit
 *  its session limit after 342 calls / $18 notional). Measured per TLS gate run with 3 votes: $0.60–0.84. A judge stage
 *  is not started once the run has spent this much; the skipped stage blocks (BUDGET), it never passes. */
export const SCRIPT_GATE_MAX_USD = 1.5;
export function scriptGateMaxUsd(a: Pick<ScriptGateArgs, "maxUsd" | "env">): number {
  if (typeof a.maxUsd === "number" && a.maxUsd > 0) return a.maxUsd;
  const v = Number((a.env ?? process.env).REEL_V3_SCRIPT_GATE_MAX_USD);
  return Number.isFinite(v) && v > 0 ? v : SCRIPT_GATE_MAX_USD;
}

export async function runScriptGates(a: ScriptGateArgs): Promise<ScriptGateReport> {
  const rep: ScriptGateReport = { ok: false, failedAt: null, gaps: [], writer: null, terms: null, claims: null, physics: null, nontech: null, spend: [], hints: [], raw: {}, votes: {} };
  const fail = (gate: ScriptGap["gate"], gaps: readonly ScriptGap[]) => {
    rep.gaps.push(...gaps);
    if (!gapsPass(gaps) && !rep.failedAt) rep.failedAt = gate;
  };
  const p = parseNarrative(a.narrative);
  fail("schema", p.gaps);
  if (!p.narrative) return finish(rep);
  const n = p.narrative;
  rep.writer = writerGates(n, { timing: a.timing, recent: a.recent, env: a.env });
  fail("writer", rep.writer.gaps);
  rep.terms = termGates(n, a.timing);
  fail("terms", rep.terms.gaps);
  const cap = scriptGateMaxUsd(a);
  const spent = () => rep.spend.reduce((t, x) => t + x.costUsd, 0);
  const want = (k: "claims" | "factcheck" | "physics" | "nontech") => (!a.only || a.only.includes(k)) && (a.runAll || !rep.failedAt);
  const go = (k: "claims" | "factcheck" | "physics" | "nontech", wanted = want(k)) => {
    if (!wanted) return false;
    if (spent() < cap) return true;
    fail(k, [{ gate: k, code: "BUDGET", severity: "block", message: `${k} NOT RUN: this script-gate run already spent $${spent().toFixed(2)} (cap $${cap.toFixed(2)}, REEL_V3_SCRIPT_GATE_MAX_USD)` }]);
    return false;
  };

  if (go("claims", want("claims") || want("factcheck") || want("physics"))) {
    const c = await runClaimsExtraction({ ...a, narrative: n, ownerData: hasOwnerData(a.sources) });
    rep.spend.push(c.spend);
    rep.claims = c.claims;
    rep.raw.claims = c.raw;
    fail("claims", c.gaps);
    if (go("factcheck") && c.claims.claims.length) {
      const f = await runClaimsFactCheck({ ...a, narrative: n, claims: c.claims, sources: a.sources });
      rep.spend.push(...f.spend);
      rep.votes.factcheck = f.votes;
      rep.claims = f.claims;
      rep.raw.factcheck = f.raw;
      fail("factcheck", f.gaps);
    }
  }
  if (go("physics")) {
    const ph = await runPhysicsScript({ ...a, narrative: n, claims: rep.claims, assetFacts: a.assetFacts });
    rep.spend.push(...ph.spend);
    rep.votes.physics = ph.votes;
    rep.physics = ph;
    rep.raw.physics = ph.raw;
    fail("physics", ph.gaps);
  }
  if (go("nontech")) {
    const nt = await runNontech({ ...a, narrative: n, timing: a.timing });
    rep.spend.push(...nt.spend);
    rep.votes.nontech = nt.viewers.length;
    rep.nontech = nt;
    rep.raw.nontech = nt.raw.viewer;
    rep.raw["nontech-compare"] = nt.raw.compare;
    fail("nontech", nt.gaps);
  }
  return finish(rep);
}

function finish(rep: ScriptGateReport): ScriptGateReport {
  rep.ok = !rep.failedAt && gapsPass(rep.gaps);
  rep.hints = rep.gaps.filter((g) => g.severity !== "warn" && g.hint).map((g) => `${g.lines?.join(", ") ?? g.gate}: ${g.hint}`);
  return rep;
}

/** The refusal text for the writer: every failing gap with its hint. The writer rewrites in its own words; nothing
 *  from a judge is pasted into the narration (FC2 retired). */
export function writerFeedback(rep: Pick<ScriptGateReport, "gaps">): string {
  const bad = rep.gaps.filter((g) => g.severity !== "warn");
  if (!bad.length) return "All script gates passed.";
  const lines = bad.map((g) => `- [${g.gate} ${g.code}${g.lines?.length ? ` ${g.lines.join(",")}` : ""}] ${g.message}${g.hint ? `\n  hint: ${g.hint}` : ""}`);
  return `The narrative was refused by ${new Set(bad.map((g) => g.gate)).size} gate(s). Rewrite the named lines in your own words from the viewer's side (the hints say what is wrong, not what to paste), then submit the whole narrative again.\n${lines.join("\n")}`;
}
