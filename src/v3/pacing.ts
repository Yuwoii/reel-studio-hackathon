// PA1 — the v3 pacing check on the VOICE (W2, ADR-002 §7 step 8; R5 GATE-AUDIT §5.7; decision 3c; S2 voice rule
// 2026-11-02, which supersedes decision 3a's rates and the 5g pace bands). Pure and synchronous: it reads measured
// word boundaries (W1 NarrativeTiming, as src/v3/tts.ts returns it), the narrative's act per line, and nothing else —
// no audio analysis, no timeline.
//
// S2 (D1-DECISIONS-V3 "S2 voice"): Ava, one request per sentence/thought at one rate (≈ +5 %), and deliberate gaps —
// ~0.85–0.9 s where something must sink in (after the opening question, after a new name lands, after the turn),
// 0.6–0.7 s after a big question / closing line, 0.25–0.35 s between ordinary sentences. Owner: "learn when to make
// brief gaps to let things sink in" — never "just shorten the gaps". So the pace is no longer gated in w/s (5g's
// bands measured edge Andrew's articulation at −8…−14 %, which S2 retired); the gaps are what is checked.
//
// Checks (each a PacingGap, severity "error" with a hint for the WRITER, "warn" = reported only):
//   PA1.hook      the pause after the hook question ≥ 800 ms, or (as W1 gate A3) a ≤ 4-word punch line right after
//                 it with ≥ 800 ms after the punch; with no question line, the pause after the hook's last line.
//   PA1.hookLast  the hook's last spoken word ends ≤ 8.5 s (decision 3c).
//   PA1.sink      (warn) a line that introduces a new term/name has a sink-in gap after it ≥ 800 ms (S2 ~0.85–0.9 s).
//                 Term lines come from `termLines` (narrative.terms[].termLine) or, without it, the naming pattern
//                 "… (is|it's|are) called X".
//   PA1.gap       (warn) an ordinary gap < 200 ms (no breath between two thoughts) or > 1000 ms (a stall).
//   PA1.actPause  every act except the CTA has ≥ 1 pause ≥ 500 ms (inside it or at its end).
//   PA1.sd        pause standard deviation ≥ 180 ms (CTA's trailing pause excluded, as W1 pauseStats): deliberate,
//                 not uniform gaps.
//   PA1.duration  60–75 s for a full reel (scope "reel"), measured at the last spoken word (S2: ≤ 75 s).
//
// Pace per act (voiced / span / act w/s, see ActPace) is still computed and reported for information; `metric` picks
// which one `gatedWps` shows. It gates nothing.
// Pauses: when `audiblePausesMs` is given (src/v3/tts.ts lines[].audiblePauseMs — what silencedetect measures and
// what the listener hears) the default `pauseSource` is "audible"; otherwise the gap between word boundaries (next
// line's first word start − this line's last word end). edge-tts word ends overhang the audible end by ~0–40 ms
// (W2 measure: the TLS hook pause reads 787 ms on word boundaries and 800 ms in silencedetect), so the word-gap
// reading gets WORD_GAP_TOLERANCE_MS on every minimum.

import { HOOK_PUNCH_MIN_PAUSE_MS, lineWords, type Act, type NarrativeTiming } from "../schema/script.v3.js";

export const PA1_HOOK_PAUSE_MIN_MS = 800;
export const PA1_HOOK_LAST_WORD_MAX_SEC = 8.5;
export const PA1_ACT_PAUSE_MIN_MS = 500;
export const PA1_PAUSE_SD_MIN_MS = 180;
/** S2: ≤ 75 s at the last spoken word (the rate is raised from +5 % only to land it). */
export const PA1_DURATION_SEC = { min: 60, max: 75 } as const;
/** S2 sink-in gap after a new name (~0.85–0.9 s; 50 ms slack for "≈"). */
export const PA1_SINK_MIN_MS = 800;
/** S2 ordinary gap 0.25–0.35 s: below 200 ms two thoughts run together, above 1 s the read stalls. */
export const PA1_GAP_MS = { min: 200, max: 1000 } as const;
/** "… is called TLS", "that's why it's called TLS termination": the line that lands a name. */
export const NAMING_RE = /\b(?:is|are|it's|it’s|that's|that’s|was|were|gets|get)\s+called\b/i;
/** Word-gap pauses read short of the audible gap by edge's word-end overhang (W2 TLS: 13 ms; up to ~40 ms). */
export const WORD_GAP_TOLERANCE_MS = 25;
export const PA1_PUNCH_MAX_WORDS = 4;

export type PaceMetric = "voiced" | "span" | "act";

export interface PacingLine {
  id: string;
  act: Act;
  text: string;
}

export interface ActPace {
  act: Act;
  lines: string[];
  words: number;
  firstWordSec: number;
  lastWordSec: number;
  /** Σ per-line (last word end − first word start). */
  voicedSec: number;
  spanSec: number;
  /** First line start → next act's first line start (or the act's last word end for the final act). */
  actSec: number;
  voicedWps: number;
  spanWps: number;
  actWps: number;
  /** Longest pause inside or at the end of the act (ms, word boundaries). */
  maxPauseMs: number;
  /** The `metric` pick of the three (information only; S2 retired the 5g bands). */
  gatedWps: number;
}

export interface PacingGap {
  gate: "pacing";
  code: "PA1.hook" | "PA1.hookLast" | "PA1.sink" | "PA1.gap" | "PA1.actPause" | "PA1.sd" | "PA1.duration" | "PA1.timing";
  severity: "error" | "warn";
  lines?: string[];
  message: string;
  hint?: string;
}

export interface PacingReport {
  metric: PaceMetric;
  acts: ActPace[];
  /** Word-boundary pause after each line (ms) except the last: next first-word start − this last-word end. */
  pauses: Array<{ after: string; act: Act; ms: number; wordGapMs: number; audibleMs?: number }>;
  pauseSource: "words" | "audible";
  hookQuestionLine: string | null;
  hookPauseMs: number | null;
  hookLastWordSec: number | null;
  /** Lines treated as introducing a new term (from `termLines` or NAMING_RE). */
  termLines: string[];
  pauseMeanMs: number;
  pauseSdMs: number;
  speechEndSec: number;
  words: number;
  wpsOverall: number;
  gaps: PacingGap[];
  pass: boolean;
}

export interface PacingOptions {
  metric?: PaceMetric;
  /** "reel" checks duration 60–75 s; "opening" checks only what an opening contains. */
  scope?: "reel" | "opening";
  /** Which pause the hook / act / SD checks read (default "audible" when audiblePausesMs is given, else "words"). */
  pauseSource?: "words" | "audible";
  /** Ids of the lines that first speak a declared term (narrative.terms[].termLine). Default: NAMING_RE on the text. */
  termLines?: readonly string[];
  /** Per line except the last: the audible pause (src/v3/tts.ts lines[i].audiblePauseMs). */
  audiblePausesMs?: readonly number[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Run PA1 over measured timing. Lines and timing must cover the same ids in the same order. */
export function checkPacing(lines: readonly PacingLine[], timing: NarrativeTiming, opts: PacingOptions = {}): PacingReport {
  const metric = opts.metric ?? "voiced";
  const scope = opts.scope ?? "reel";
  const gaps: PacingGap[] = [];
  const pauseSource = opts.pauseSource ?? (opts.audiblePausesMs?.length === lines.length - 1 ? "audible" : "words");
  const tol = pauseSource === "words" ? WORD_GAP_TOLERANCE_MS : 0;
  const termLines = opts.termLines ? lines.filter((l) => opts.termLines!.includes(l.id)).map((l) => l.id) : lines.filter((l) => NAMING_RE.test(l.text)).map((l) => l.id);
  const empty: PacingReport = { metric, pauseSource, acts: [], pauses: [], hookQuestionLine: null, hookPauseMs: null, hookLastWordSec: null, termLines, pauseMeanMs: 0, pauseSdMs: 0, speechEndSec: 0, words: 0, wpsOverall: 0, gaps, pass: false };
  if (timing.lines.length !== lines.length || lines.some((l, i) => timing.lines[i]?.id !== l.id)) {
    gaps.push({ gate: "pacing", code: "PA1.timing", severity: "error", message: `timing covers ${timing.lines.map((l) => l.id).join(",")} but the narrative has ${lines.map((l) => l.id).join(",")}` });
    return empty;
  }
  const spoken = timing.lines.map((t) => t.wordTimes);
  const silentLine = lines.find((_, i) => spoken[i].length === 0);
  if (silentLine) {
    gaps.push({ gate: "pacing", code: "PA1.timing", severity: "error", lines: [silentLine.id], message: `${silentLine.id} has no measured words` });
    return empty;
  }
  const first = (i: number) => spoken[i][0].startSec;
  const last = (i: number) => spoken[i][spoken[i].length - 1].endSec;

  if (pauseSource === "audible" && opts.audiblePausesMs?.length !== lines.length - 1) {
    gaps.push({ gate: "pacing", code: "PA1.timing", severity: "error", message: `pauseSource "audible" needs ${lines.length - 1} audible pauses, got ${opts.audiblePausesMs?.length ?? 0}` });
    return empty;
  }
  const pauses = lines.slice(0, -1).map((l, i) => {
    const wordGapMs = Math.round((first(i + 1) - last(i)) * 1000);
    const audibleMs = opts.audiblePausesMs?.[i] !== undefined ? Math.round(opts.audiblePausesMs[i]) : undefined;
    return { after: l.id, act: l.act, ms: pauseSource === "audible" ? (audibleMs as number) : wordGapMs, wordGapMs, audibleMs };
  });

  // acts in narrative order
  const order: Act[] = [];
  lines.forEach((l) => (order.includes(l.act) ? undefined : order.push(l.act)));
  const acts: ActPace[] = order.map((act, k) => {
    const idx = lines.map((l, i) => (l.act === act ? i : -1)).filter((i) => i >= 0);
    const words = idx.reduce((s, i) => s + spoken[i].length, 0);
    const voicedSec = idx.reduce((s, i) => s + (last(i) - first(i)), 0);
    const f = first(idx[0]);
    const lw = last(idx[idx.length - 1]);
    const nextAct = order[k + 1];
    const nextStart = nextAct ? timing.lines[lines.findIndex((l) => l.act === nextAct)].startSec : null;
    const actSec = (nextStart ?? lw) - timing.lines[idx[0]].startSec;
    const own = pauses.filter((p) => p.act === act);
    const a: ActPace = {
      act,
      lines: idx.map((i) => lines[i].id),
      words,
      firstWordSec: +f.toFixed(3),
      lastWordSec: +lw.toFixed(3),
      voicedSec: +voicedSec.toFixed(3),
      spanSec: +(lw - f).toFixed(3),
      actSec: +actSec.toFixed(3),
      voicedWps: r2(words / Math.max(1e-6, voicedSec)),
      spanWps: r2(words / Math.max(1e-6, lw - f)),
      actWps: r2(words / Math.max(1e-6, actSec)),
      maxPauseMs: own.length ? Math.max(...own.map((p) => p.ms)) : 0,
      gatedWps: 0,
    };
    a.gatedWps = metric === "voiced" ? a.voicedWps : metric === "span" ? a.spanWps : a.actWps;
    return a;
  });

  // hook question pause + last hook word
  const hookIdx = lines.map((l, i) => (l.act === "hook" ? i : -1)).filter((i) => i >= 0);
  let hookQuestionLine: string | null = null;
  let hookPauseMs: number | null = null;
  let hookLastWordSec: number | null = null;
  if (hookIdx.length) {
    const qi = hookIdx.find((i) => /\?\s*$/.test(lines[i].text));
    const q = qi ?? hookIdx[hookIdx.length - 1];
    hookQuestionLine = lines[q].id;
    hookPauseMs = q < pauses.length ? pauses[q].ms : null;
    hookLastWordSec = +last(hookIdx[hookIdx.length - 1]).toFixed(3);
    const min = PA1_HOOK_PAUSE_MIN_MS - tol;
    // W1 A3's alternative: a ≤ 4-word punch line in the hook right after the question, with the long pause after it
    const pi = q + 1;
    const punchOk = qi !== undefined && lines[pi]?.act === "hook" && lineWords(lines[pi].text).length <= PA1_PUNCH_MAX_WORDS && pi < pauses.length && pauses[pi].ms >= HOOK_PUNCH_MIN_PAUSE_MS - tol;
    const what = qi !== undefined ? `the hook question ${lines[q].id}` : `the hook's last line ${lines[q].id} (no question line)`;
    if ((hookPauseMs === null || hookPauseMs < min) && !punchOk)
      gaps.push({
        gate: "pacing",
        code: "PA1.hook",
        severity: "error",
        lines: [lines[q].id],
        message: `pause after ${what} is ${hookPauseMs ?? "none"} ms (< ${PA1_HOOK_PAUSE_MIN_MS}${tol ? `, ${tol} ms word-overhang tolerance` : ""}; ${pauseSource} pauses)`,
        hint: pauseSource === "words" ? `give ${lines[q].id} pauseAfterMs ≥ ${PA1_HOOK_PAUSE_MIN_MS + 50} (word boundaries read ~10–40 ms short of the audible gap), or check against the audible pauses.` : `give ${lines[q].id} pauseAfterMs ≥ ${PA1_HOOK_PAUSE_MIN_MS}.`,
      });
    if (hookLastWordSec > PA1_HOOK_LAST_WORD_MAX_SEC)
      gaps.push({ gate: "pacing", code: "PA1.hookLast", severity: "error", lines: hookIdx.map((i) => lines[i].id), message: `the hook's last word ends at ${hookLastWordSec} s (> ${PA1_HOOK_LAST_WORD_MAX_SEC} s, decision 3c)`, hint: "shorten the hook or its lead silence." });
  } else gaps.push({ gate: "pacing", code: "PA1.hook", severity: "error", message: "no hook act" });

  // S2 sink-in after a new name (warn: the writer may have a reason, e.g. the name lands on the CTA)
  for (const id of termLines) {
    const i = lines.findIndex((l) => l.id === id);
    const ms = i < pauses.length ? pauses[i].ms : null;
    if (ms === null || ms < PA1_SINK_MIN_MS - tol)
      gaps.push({
        gate: "pacing",
        code: "PA1.sink",
        severity: "warn",
        lines: [id],
        message: `${id} introduces a new term but the gap after it is ${ms ?? "none"} ms (< ${PA1_SINK_MIN_MS}; S2 ~850–900 ms to let a name sink in)`,
        hint: `give ${id} pauseAfterMs ≈ 850–900.`,
      });
  }

  // S2 ordinary gaps: neither run together nor stalled (sink-in gaps are ≤ 900, so the max never hits them)
  for (const p of pauses) {
    if (p.ms < PA1_GAP_MS.min - tol)
      gaps.push({ gate: "pacing", code: "PA1.gap", severity: "warn", lines: [p.after], message: `gap after ${p.after} is ${p.ms} ms (< ${PA1_GAP_MS.min}): two thoughts run together`, hint: `give ${p.after} pauseAfterMs 250–350, or join it with the next line into one sentence.` });
    else if (p.ms > PA1_GAP_MS.max)
      gaps.push({ gate: "pacing", code: "PA1.gap", severity: "warn", lines: [p.after], message: `gap after ${p.after} is ${p.ms} ms (> ${PA1_GAP_MS.max}): the read stalls`, hint: `sink-in gaps are 850–900 ms; shorten ${p.after}'s pause.` });
  }

  // ≥ 1 pause ≥ 500 ms per act (the CTA is one line and is exempt)
  for (const a of acts) {
    if (a.act === "cta") continue;
    const own = pauses.filter((p) => p.act === a.act);
    if (!own.length) continue; // the narrative's last act has no pause after it (an opening)
    if (a.maxPauseMs < PA1_ACT_PAUSE_MIN_MS - tol)
      gaps.push({ gate: "pacing", code: "PA1.actPause", severity: "error", lines: a.lines, message: `${a.act} has no pause ≥ ${PA1_ACT_PAUSE_MIN_MS} ms (longest ${a.maxPauseMs} ms)`, hint: `put a pause ≥ ${PA1_ACT_PAUSE_MIN_MS} ms after one ${a.act} line, where the picture changes.` });
  }

  // pause SD (CTA trailing excluded; pauses only exist between lines)
  const heard = pauses.filter((p) => p.act !== "cta").map((p) => p.ms);
  const mean = heard.reduce((s, x) => s + x, 0) / Math.max(1, heard.length);
  const sd = Math.sqrt(heard.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, heard.length));
  if (heard.length >= 2 && sd < PA1_PAUSE_SD_MIN_MS)
    gaps.push({ gate: "pacing", code: "PA1.sd", severity: "error", message: `pause SD ${sd.toFixed(0)} ms (< ${PA1_PAUSE_SD_MIN_MS}): the rhythm is uniform`, hint: "vary the pauses: short (300) inside a thought, long (800–1000) after a question or a reveal." });

  const speechEnd = last(lines.length - 1);
  const words = spoken.reduce((s, w) => s + w.length, 0);
  if (scope === "reel" && (speechEnd < PA1_DURATION_SEC.min || speechEnd > PA1_DURATION_SEC.max))
    gaps.push({ gate: "pacing", code: "PA1.duration", severity: "error", message: `the narration ends at ${speechEnd.toFixed(2)} s (outside ${PA1_DURATION_SEC.min}–${PA1_DURATION_SEC.max} s)`, hint: speechEnd > PA1_DURATION_SEC.max ? "cut a line." : "the reel is too short for the playbook acts." });

  return {
    metric,
    pauseSource,
    acts,
    pauses,
    hookQuestionLine,
    hookPauseMs,
    hookLastWordSec,
    termLines,
    pauseMeanMs: Math.round(mean),
    pauseSdMs: Math.round(sd),
    speechEndSec: +speechEnd.toFixed(3),
    words,
    wpsOverall: r2(words / Math.max(1e-6, speechEnd - first(0))),
    gaps,
    pass: !gaps.some((g) => g.severity === "error"),
  };
}

/**
 * Words inside silences (R2 boundary check A): a word whose core (start + 30 ms … end − 30 ms) overlaps a detected
 * silence by more than 60 ms. `silences` in ms, e.g. from ffmpeg silencedetect (src/audio/media.ts parseSilences).
 */
export function wordsInsideSilences(words: ReadonlyArray<{ text: string; startMs: number; endMs: number }>, silences: ReadonlyArray<{ startMs: number; endMs: number }>): Array<{ word: string; startMs: number; silence: [number, number]; overlapMs: number }> {
  const bad: Array<{ word: string; startMs: number; silence: [number, number]; overlapMs: number }> = [];
  for (const w of words) {
    const cs = w.startMs + 30;
    const ce = w.endMs - 30;
    for (const s of silences) {
      const ov = Math.min(ce, s.endMs) - Math.max(cs, s.startMs);
      if (ov > 60) bad.push({ word: w.text, startMs: Math.round(w.startMs), silence: [Math.round(s.startMs), Math.round(s.endMs)], overlapMs: Math.round(ov) });
    }
  }
  return bad;
}
