// v3 TERM GATE (code, $0; ADR-002 §7 step 5, R1 PLAYBOOK §3, SCORECARD C1–C5/B8, R5 TA1). Replaces v2's ST8–ST10 / R7
// (the story gate "defined in its own beat or the next" + the rubric jargon budget), which let the anti-example speak
// 10 unglossed terms from 0.0 s. A term is any word a non-technical viewer would not use in conversation.
//   TB1  budget: ≤ 3 declared terms per reel.
//   TA1  picture first: the term's pictureLine comes no later than its termLine, the term is not spoken before its
//        termLine, and the picture has been on screen ≥ 1.5 s when the term's first word is spoken (measured word
//        times when given, else the pre-TTS estimate — reported as such).
//   TG1  description → name: the term line is not a dictionary line ("X is …") and does not open with the term.
//   B8   the topic term is not spoken before the mechanism act.
//   TU1  no undeclared term: a jargon word or acronym the viewer would not know, spoken without being declared.
//   NM1  one name per thing: a word the names table bans as a second name is never spoken (synonym drift, H10).
//   TC4  (warn) a name that lands ("… is called X", the topic term) has a sink-in gap ≥ 800 ms after it (S2).
//   C7   on-screen text = spoken words: text in 'single quotes' in a shot's overlay is a word the voice says by that
//        line (warn; numbers and the real object's own text, e.g. a URL, are allowed).
// On-screen text is written in 'single quotes' in shot notes/overlays (the convention the prompt teaches): TU1 scans it
// too, since a viewer reads it like a spoken word. The root-cause vendor (narrative.vendor) is not a term.
// Hints are for the writer; nothing here edits the narration.

import { ACT_INDEX, lineWords, TERM_BUDGET, TERM_PICTURE_MIN_SEC, timingFor, type NarrativeT, type NarrativeTiming, type ScriptGap } from "../../schema/script.v3.js";

/** S2 sink-in after a name lands (src/v3/pacing.ts PA1_SINK_MIN_MS; TERM_PAUSE_MIN_MS 600 was the S1 rule). */
export const TERM_SINK_MIN_MS = 800;
/** The line that lands a name (same pattern as src/v3/pacing.ts NAMING_RE). */
export const NAMING_LINE_RE = /\b(?:is|are|it's|it’s|that's|that’s|was|were|gets|get)\s+called\b/i;

/** Words a non-technical viewer already uses or sees on their own screen (R1 §3: https, Wi-Fi, BPM are not terms). */
export const VIEWER_WORDS: ReadonlySet<string> = new Set(["https", "http", "wi-fi", "wifi", "bpm", "ok", "tv", "usb", "gps", "pin", "id", "atm", "led", "leds", "sms", "pdf", "faq", "s", "i", "a"]);

/** Jargon a non-technical 16-year-old would not use (R1 §3 examples + the anti-example's words). Each entry is a
 *  regex source matched case-insensitively on word boundaries; `root` decides whether a declared term covers it. */
export const JARGON: ReadonlyArray<{ re: string; root: string }> = [
  { re: "decrypt\\w*", root: "decrypt" },
  { re: "encrypt\\w*", root: "encrypt" },
  { re: "unencrypted", root: "encrypt" },
  { re: "encryption", root: "encrypt" },
  { re: "servers?", root: "server" },
  { re: "back-?ends?", root: "backend" },
  { re: "front-?ends?", root: "frontend" },
  { re: "upstream", root: "upstream" },
  { re: "downstream", root: "downstream" },
  { re: "handshakes?", root: "handshake" },
  { re: "prox(?:y|ies)", root: "proxy" },
  { re: "load balanc\\w*", root: "load balanc" },
  { re: "certificates?", root: "certificate" },
  { re: "session caches?", root: "session cache" },
  { re: "caches?|caching", root: "cache" },
  { re: "protocols?", root: "protocol" },
  { re: "packets?", root: "packet" },
  { re: "latency", root: "latency" },
  { re: "bandwidth", root: "bandwidth" },
  { re: "endpoints?", root: "endpoint" },
  { re: "terminat\\w*", root: "terminat" },
  { re: "ciphers?", root: "cipher" },
  { re: "processors?", root: "processor" },
  { re: "photodiodes?", root: "photodiode" },
  { re: "photoplethysmo\\w*", root: "photoplethysmo" },
  { re: "ha?emoglobin", root: "hemoglobin" },
  { re: "capacitan\\w*|capacitive", root: "capacit" },
  { re: "electrodes?", root: "electrode" },
  { re: "frequenc(?:y|ies)", root: "frequenc" },
  { re: "amplitudes?", root: "amplitude" },
  { re: "polarity", root: "polarity" },
  { re: "antiphase|out-of-phase", root: "phase" },
  { re: "interference", root: "interference" },
  { re: "feedforward", root: "feedforward" },
  { re: "algorithms?", root: "algorithm" },
  { re: "systolic|diastolic", root: "systolic" },
  { re: "wavelengths?", root: "wavelength" },
  { re: "oxygenat\\w*", root: "oxygenat" },
  { re: "transistors?", root: "transistor" },
  { re: "semiconductors?", root: "semiconductor" },
  { re: "voltages?", root: "voltage" },
  { re: "kernels?", root: "kernel" },
  { re: "firmware", root: "firmware" },
  { re: "compression|rarefaction", root: "compression" },
];

export interface TermReport {
  term: string;
  pictureLine: string;
  termLine: string;
  /** First line that speaks the term (null = never spoken). */
  firstSpoken: string | null;
  /** Seconds between the picture line's start and the term's first word. */
  pictureLeadSec: number | null;
}

export interface TermGateResult {
  ok: boolean;
  gaps: ScriptGap[];
  terms: TermReport[];
  /** Undeclared jargon/acronyms: word → lines. */
  undeclared: Array<{ word: string; lines: string[] }>;
  measured: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive, optional plural; tolerates quotes around the term ('active'). */
export function termRegex(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc(term).replace(/\s+/g, "\\s+")}(?:s|es)?(?![\\p{L}\\p{N}])`, "iu");
}
/** Index (in lineWords) of the term's first word inside `text`, or -1. */
export function termWordIndex(text: string, term: string): number {
  const m = termRegex(term).exec(text);
  if (!m) return -1;
  return lineWords(text.slice(0, m.index)).length;
}

const ACRONYM = /^[A-Z]{2,6}s?$/;
/** Everyday words a writer may set in CAPS for emphasis ("It was NOT your Wi-Fi."): not acronyms. */
export const CAPS_EMPHASIS: ReadonlySet<string> = new Set(["not", "no", "yes", "all", "any", "every", "never", "ever", "now", "one", "two", "you", "your", "me", "my", "we", "us", "our", "it", "is", "was", "are", "do", "did", "does", "can", "cant", "won't", "dont", "so", "too", "and", "or", "but", "if", "the", "an", "on", "off", "in", "out", "up", "down", "at", "to", "of", "by", "for", "how", "why", "what", "who", "where", "when", "stop", "go", "open", "shut", "sent", "send", "down", "dead", "still", "only", "just", "real", "fake", "safe", "lost", "late", "fast", "slow", "wow", "huge", "big"]);

/** Text set in 'single quotes' (on-screen words) in a line's shot note / overlay / keyframe. */
export function quotedScreenText(l: Pick<NarrativeT["lines"][number], "shot">, fields: ReadonlyArray<"note" | "overlay" | "keyframe"> = ["note", "overlay", "keyframe"]): string[] {
  return fields.flatMap((f) => [...String(l.shot?.[f] ?? "").matchAll(/(?<![\p{L}\p{N}])'([^']{1,60})'(?![\p{L}\p{N}])/gu)].map((m) => m[1]));
}
/** A real object's own text (a URL / domain) or a number: allowed on screen without being spoken. */
const OBJECT_TEXT = /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$|^[\d.,:%+-]+$/;
const ARTICLE = /^(?:the|a|an|that|this|your|so|and|but)$/i;

/** A line that defines a term dictionary-style: "<det>? <term> is/are/means …" (scorecard H2). */
export function isDictionaryLine(text: string, term: string): boolean {
  const re = new RegExp(`^\\s*(?:(?:that|the|a|an|this)\\s+)?${esc(term).replace(/\s+/g, "\\s+")}(?:s)?\\s*(?:is|are|means|=|:)\\b`, "i");
  return re.test(text);
}

/** Undeclared jargon and acronyms per line, in the spoken text AND the quoted on-screen text. A declared term covers
 *  a jargon hit when the term contains its root; the root-cause vendor is never a hit. */
export function undeclaredTerms(n: Pick<NarrativeT, "lines" | "terms"> & Partial<Pick<NarrativeT, "track" | "vendor">>): Array<{ word: string; lines: string[] }> {
  const declared = n.terms.map((t) => t.term.toLowerCase());
  const covers = (root: string, word: string) => declared.some((d) => d.includes(root) || d === word.toLowerCase());
  const out = new Map<string, string[]>();
  const add = (w: string, id: string) => {
    const k = w.toLowerCase();
    const a = out.get(k) ?? [];
    if (!a.includes(id)) a.push(id);
    out.set(k, a);
  };
  const vre = n.track === "root-cause" && n.vendor ? new RegExp(`(?<![\\p{L}\\p{N}])${esc(n.vendor).replace(/\s+/g, "\\s+")}(?:'s)?(?![\\p{L}\\p{N}])`, "giu") : null;
  for (const l of n.lines) {
    const raw = [l.text, ...quotedScreenText(l)].join(" \u2016 ");
    const text = vre ? raw.replace(vre, " ") : raw;
    for (const j of JARGON) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${j.re})(?![\\p{L}\\p{N}-])`, "giu");
      for (const m of text.matchAll(re)) if (!covers(j.root, m[0])) add(m[0], l.id);
    }
    for (const w of lineWords(text)) {
      if (!ACRONYM.test(w) || VIEWER_WORDS.has(w.toLowerCase()) || CAPS_EMPHASIS.has(w.toLowerCase())) continue;
      if (declared.some((d) => termRegex(w).test(d))) continue;
      add(w, l.id);
    }
  }
  return [...out.entries()].map(([word, lines]) => ({ word, lines }));
}

export function termGates(n: NarrativeT, measuredTiming?: NarrativeTiming | null): TermGateResult {
  const gaps: ScriptGap[] = [];
  const g = (code: string, severity: ScriptGap["severity"], message: string, lines?: string[], hint?: string) => gaps.push({ gate: "terms", code, severity, message, ...(lines ? { lines } : {}), ...(hint ? { hint } : {}) });
  const { timing, measured } = timingFor(n, measuredTiming);
  const idx = new Map(n.lines.map((l, i) => [l.id, i]));
  const tl = new Map(timing.lines.map((l) => [l.id, l]));
  const reports: TermReport[] = [];

  if (n.terms.length > TERM_BUDGET)
    g("TB1", "block", `${n.terms.length} declared terms (${n.terms.map((t) => t.term).join(", ")}); the budget is ${TERM_BUDGET}`, undefined, "Cut the terms that add nothing to the viewer's picture; put them in the post caption.");

  for (const t of n.terms) {
    const pi = idx.get(t.pictureLine) ?? -1;
    const ti = idx.get(t.termLine) ?? -1;
    const firstI = n.lines.findIndex((l) => termRegex(t.term).test(l.text));
    const first = firstI >= 0 ? n.lines[firstI] : null;
    let lead: number | null = null;
    if (pi > ti) g("TA1", "block", `"${t.term}": its picture (${t.pictureLine}) comes after the line that names it (${t.termLine})`, [t.pictureLine, t.termLine], "Show the thing first, describe it in plain words, then name it.");
    if (!first) g("TA1", "error", `"${t.term}" is declared but never spoken`, [t.termLine], "Speak the term in its term line or drop it from terms.");
    else {
      if (firstI < ti) g("TA1", "block", `"${t.term}" is spoken in ${first.id}, before its term line ${t.termLine}`, [first.id, t.termLine], "Do not use the term before the line that introduces it.");
      if (firstI > ti) g("TA1", "error", `"${t.term}" is not spoken in its term line ${t.termLine} (first in ${first.id})`, [t.termLine]);
      const wi = termWordIndex(first.text, t.term);
      const word = tl.get(first.id)?.wordTimes[Math.max(0, wi)];
      const pstart = tl.get(t.pictureLine)?.startSec;
      if (word && pstart !== undefined) {
        lead = +(word.startSec - pstart).toFixed(2);
        if (pi <= firstI && lead < TERM_PICTURE_MIN_SEC)
          g("TA1", measured ? "block" : "error", `"${t.term}" is spoken ${lead.toFixed(2)} s after its picture line ${t.pictureLine} starts (${measured ? "measured" : "est."}); the picture needs ≥ ${TERM_PICTURE_MIN_SEC} s on screen first`, [t.pictureLine, first.id], "Give the picture its own line before the term, or move the term later in the line.");
      }
      if (isDictionaryLine(first.text, t.term)) g("TG1", "block", `${first.id} defines "${t.term}" dictionary-style ("${first.text}")`, [first.id], `Describe it first, then name it: "<description> is called ${t.term}."`);
      else {
        const lw = lineWords(first.text).filter((w) => !ARTICLE.test(w));
        if (lw.length && termWordIndex(lw.join(" "), t.term) === 0) g("TG1", "error", `${first.id} opens with "${t.term}" before describing it`, [first.id], "Put the plain-words description before the name.");
      }
      // S2: a name that LANDS ("That lock is called TLS.", the topic term) gets a sink-in gap; a term met in passing in
      // plain words ("hits a front server first") flows on at an ordinary gap
      const pause = n.lines[firstI].pauseAfterMs;
      const lands = t.topic || NAMING_LINE_RE.test(first.text);
      if (lands && pause < TERM_SINK_MIN_MS && t.hangLine === undefined) g("TC4", "warn", `${first.id} names "${t.term}" with only ${pause} ms after it (S2: ${TERM_SINK_MIN_MS}–900 ms lets a new name sink in)`, [first.id], `give ${first.id} pauseAfterMs ≈ 850–900.`);
    }
    if (t.hangLine !== undefined && (idx.get(t.hangLine) ?? -1) <= ti) g("TA1", "error", `"${t.term}": hang line ${t.hangLine} must come after the term line ${t.termLine}`, [t.hangLine]);
    if (t.topic && ti >= 0 && ACT_INDEX[n.lines[ti].act] < ACT_INDEX.mechanism)
      g("B8", "block", `topic term "${t.term}" is named in ${t.termLine} (${n.lines[ti].act}), before the mechanism`, [t.termLine], "Name the topic term at the end of the mechanism, after the steps it names.");
    if (t.topic && first && ACT_INDEX[first.act] < ACT_INDEX.mechanism) g("B8", "block", `topic term "${t.term}" is spoken in ${first.id} (${first.act}), before the mechanism`, [first.id]);
    reports.push({ term: t.term, pictureLine: t.pictureLine, termLine: t.termLine, firstSpoken: first?.id ?? null, pictureLeadSec: lead });
  }

  const und = undeclaredTerms(n);
  for (const u of und) g("TU1", "block", `"${u.word}" is a term the viewer would not know, spoken in ${u.lines.join(", ")} without being declared, pictured and glossed`, u.lines, `Say it in plain words instead (or declare it: picture, gloss, then the name; ≤ ${TERM_BUDGET} terms).`);

  // C7: quoted overlay text is a word the voice has said by the end of that line
  const spokenSoFar: string[] = [];
  for (const l of n.lines) {
    spokenSoFar.push(...lineWords(l.text).map((w) => w.toLowerCase()));
    const said = ` ${spokenSoFar.join(" ")} `;
    for (const q of quotedScreenText(l, ["overlay"])) {
      if (OBJECT_TEXT.test(q.trim())) continue;
      const ws = lineWords(q).map((w) => w.toLowerCase());
      if (ws.length && !said.includes(` ${ws.join(" ")} `)) g("C7", "warn", `${l.id} puts '${q}' on screen, which the voice has not said by then`, [l.id], "On-screen text uses only words the voice says (or the real object's own text).");
    }
  }

  for (const row of n.names)
    for (const bad of row.never) {
      const hit = n.lines.filter((l) => termRegex(bad).test(l.text)).map((l) => l.id);
      if (hit.length) g("NM1", "error", `"${bad}" is spoken (${hit.join(", ")}) but the names table gives ${row.thing} one name: "${row.name}"`, hit, `Use "${row.name}" for ${row.thing}.`);
    }

  return { ok: !gaps.some((x) => x.severity !== "warn"), gaps, terms: reports, undeclared: und, measured };
}
