// SFX placement for the v2 mixer (ADR-001 §7, RESEARCH §5). Pure and deterministic: resolveTimeline() sfx events
// (+ camera / action / keyword events for the density fill) → the list of sounds the mixer places, the silence holes it
// gates, and a report of what was kept or dropped and why. No I/O: SFX levels (assets/sfx/levels.json) come in as data.
//
// Rules, in the order they apply:
//   1. Leads (R4/PROOF): whoosh −200 ms and glitch −150 ms (their energy builds, so they start early to land on the
//      frame); impacts thud/tick +1 frame (the motion-blur lag: the hit is seen one frame after the event frame);
//      chatter 0. placement = event + lead, clamped to ≥ 0.
//   2. silenceHole (ref2, R1): a 240 ms music+SFX gate around a station change, [event − 180, event + 60] ms (inside the
//      measured 170–290 ms). The voice is never gated; a hole that would overlap a spoken word is dropped instead (it
//      would be inaudible under speech anyway). SFX that would start inside a kept hole are dropped.
//   3. Keyword guard: no SFX body may overlap the first 80 ms of any beat's stressed keyword, except that beat's own
//      keyword impact (an authored or derived tick/thud/glitch/whoosh anchored within ±1 f of the keyword frame).
//      chatter is a texture, never an impact.
//   4. Spacing: never two SFX onsets within 250 ms. Density cap: no 10 s window holds more than 3 onsets.
//      Storyboard SFX are accepted first, highest priority first; losers are dropped with the reason.
//      A storyboard chatter that would cover a keyword is re-anchored once to its beat's phraseStart (the director rule
//      for chatter) before it is dropped.
//      Visual re-anchor (W4 fix round 2): SFX go on visual events (bible). A storyboard whoosh / tick / thud more than
//      SFX_ANCHOR_TOL_F frames from every anchor of its type in its beat (src/v2/sfx-anchors.ts: camera key starts and
//      whoosh-mapped actions for a whoosh; state / enter / focus and registry-mapped actions for tick and thud) is moved
//      once to the nearest such anchor in the same beat before any check — e.g. a whoosh left on the default "keyword"
//      anchor while its longPan starts at phraseStart. A beat with no anchor keeps the authored frame (lint L36 warns).
//   5. Gap fill (transitions and mechanism moments only — the brief's placement rule wins over coverage): empty 10 s
//      windows from 1 s are covered left to right from the rate-fill candidates below plus section changes → whoosh,
//      the one that reaches furthest first, then a type different from its neighbours, then priority. A window no legal
//      candidate can cover is skipped (reported), never a reason to stop covering later ones. Empty windows are
//      reported, not a density failure: the gate is the 1–3 per 10 s average and ≤ 3 in any 10 s window.
//   6. Rate fill: when the reel is still under FILL_PER_10S, derived candidates on transitions and mechanism moments
//      (hard cuts and long pans → whoosh, glitch actions → glitch, mechanism keywords → tick, climax keyword → thud)
//      are added, emptiest stretch first (gap to the nearest kept onset, in whole seconds, capped at 10), then
//      priority. Once the reel reaches MIN_PER_10S it stops when only one type of candidate is left.
//      Every fill SFX keeps 1.5 s from anything kept and FILL_TYPE_GAP_MS from any kept SFX of its type (the gap
//      fill relaxes this only when nothing else can cover a window), and a run of consecutive mechanism beats gets
//      at most MAX_TICKS_PER_MECH_RUN derived ticks — no "tick on every entrance" (RESEARCH #25). Repeated derived
//      sounds of a type get a deterministic ±2 dB gain jitter. Unused candidates are reported as "fill-not-needed".
//   7. If the reel still averages above 3 per 10 s (very short reels), the lowest-priority sounds are dropped.
//   Notes flag > 2 consecutive SFX of one type, any stretch over 20 s without an SFX, and every kept SFX that is neither
//   on a mechanism beat nor on a transition (report.offPlacementRule) — authored ones included, so the director sees them.

import type { Timeline, TimelineBeat } from "../../v2/timeline.js";
import type { SfxT } from "../../schema/storyboard.v2.js";
import { nearestAnchor, SFX_ANCHOR_TOL_F, sfxAnchors, type ActionSfxLookup } from "../../v2/sfx-anchors.js";

export type SfxType = SfxT["type"];
export type SoundSfx = Exclude<SfxType, "silenceHole">;
export const SOUND_SFX: readonly SoundSfx[] = ["tick", "whoosh", "glitch", "thud", "chatter"];

export interface SfxLevel {
  file: string;
  /** Max momentary loudness of the file's event (LUFS), from make-sfx.sh calibration. */
  event_lufs_mmax: number;
  peak_dbfs?: number;
}
export type SfxLevels = Record<SoundSfx, SfxLevel>;

/** Voice bus reference loudness (LUFS) the mixer gains the voice to; SFX sit at REF + SFX_REL_DB + event gainDb. */
export const VOICE_REF_LUFS = -16;
export const SFX_REL_DB = -8;
export const MIN_SPACING_MS = 250;
export const WINDOW_MS = 10_000;
export const MAX_PER_WINDOW = 3;
export const MIN_PER_10S = 1;
export const MAX_PER_10S = 3;
/** Fill target (reference median ≈ 1.2 per 10 s, R1). */
export const FILL_PER_10S = 1.2;
export const KEYWORD_GUARD_MS = 80;
/** Derived (fill) SFX keep this clearance from every kept SFX onset. */
export const FILL_MIN_GAP_MS = 1500;
export const HOLE_LEAD_MS = 180;
export const HOLE_TAIL_MS = 60;
/** Fill SFX keep this distance from any kept SFX of the same type. */
export const FILL_TYPE_GAP_MS = 8000;
/** Derived ticks per run of consecutive mechanism beats. */
export const MAX_TICKS_PER_MECH_RUN = 2;
/** Every 10 s window starting at or after this point must hold ≥ MIN_IN_WINDOW onsets. */
export const MIN_WINDOW_FROM_MS = 1000;
export const MIN_IN_WINDOW = 1;
/** Gap fill: candidates within this much of the furthest-reaching one compete on type variety and priority. */
export const GAP_REACH_SLACK_MS = 6000;
/** Notes: longest allowed stretch without an SFX, and the longest same-type run. */
export const MAX_EMPTY_STRETCH_MS = 20_000;
export const MAX_SAME_TYPE_RUN = 2;
/** Gain offsets (dB) for the 2nd, 3rd, … derived sound of one type (cycled), so repeats are not identical. */
export const REPEAT_JITTER_DB: readonly number[] = [-2, 1.5, -1, 2];
/** Derived long-pan whoosh: only for pans at least this long on screen (px at the starting zoom). */
export const LONG_PAN_PX = 540;

/** Fixed leads in ms; "frame" = +1 frame at the timeline fps. */
export const SFX_LEAD: Record<SoundSfx, number | "frame"> = { whoosh: -200, glitch: -150, thud: "frame", tick: "frame", chatter: 0 };

/**
 * Audible body of each file relative to its start (ms) — what can mask a word. Measured on the synthesised files
 * (10–20 ms RMS): tick 60 ms; thud decays from −6 to −16 dBFS over ~800 ms, the loud part is the first ~250 ms; glitch
 * is flat for 280 ms; whoosh ramps from −48 to −18 dBFS by ~180 ms and holds to 600 ms; chatter is 1.2 s of texture.
 */
export const SFX_BODY_MS: Record<SoundSfx, readonly [number, number]> = {
  tick: [0, 60],
  thud: [0, 250],
  glitch: [0, 280],
  whoosh: [120, 600],
  chatter: [0, 1200],
};

const TYPE_RANK: Record<SoundSfx, number> = { thud: 5, glitch: 4, whoosh: 4, tick: 3, chatter: 2 };
const FOCUS_PARTS = new Set(["reveal", "twist", "mechanism", "climax"]);

export function leadMs(type: SoundSfx, fps: number): number {
  const l = SFX_LEAD[type];
  return l === "frame" ? 1000 / fps : l;
}

/** volume (dB) the mixer applies to the raw file: event loudness → REF + rel + event gain. */
export function sfxVolumeDb(type: SoundSfx, gainDb: number, levels: SfxLevels, refLufs = VOICE_REF_LUFS, relDb = SFX_REL_DB): number {
  const lv = levels[type];
  if (!lv || !Number.isFinite(lv.event_lufs_mmax)) throw new Error(`sfx: no level for "${type}" in levels.json`);
  return round2(refLufs + relDb + gainDb - lv.event_lufs_mmax);
}

export type SfxSource = "storyboard" | "derived";
export type SfxDropReason =
  | "past-end"
  | "keyword-mask"
  | "in-silence-hole"
  | "too-close"
  | "fill-crowded"
  | "window-cap"
  | "density-cap"
  | "fill-not-needed"
  | "type-spacing"
  | "tick-run"
  | "type-run"
  | "hole-over-speech"
  | "hole-overlap";

export interface SfxCandidate {
  id: string;
  source: SfxSource;
  /** Why a derived candidate exists ("hardCut", "longPan", "glitchAction", "mechanismKeyword", "climaxKeyword"; gap-only
   *  "sectionChange"), "reanchored:phraseStart" for a moved storyboard chatter, or "reanchored:<anchor>" (e.g.
   *  "reanchored:camera longPan") for a storyboard whoosh / tick / thud moved onto its visual event. */
  origin?: string;
  type: SoundSfx;
  beatId: string;
  beatIndex: number;
  eventF: number;
  eventMs: number;
  gainDb: number;
  priority: number;
  keywordImpact: boolean;
}

export interface SfxPlacement extends SfxCandidate {
  leadMs: number;
  /** Where the file starts in the reel (ms, ≥ 0). */
  startMs: number;
  /** true when event + lead was < 0 and the start was clamped to 0 (onset no longer lead-exact). */
  clamped: boolean;
  volumeDb: number;
  file: string;
  /** Repeat jitter added to gainDb (derived repeats only). */
  jitterDb?: number;
}

export interface SilenceHole {
  id: string;
  beatId: string;
  beatIndex: number;
  eventF: number;
  eventMs: number;
  startMs: number;
  endMs: number;
}

export interface SfxDrop {
  id: string;
  source: SfxSource;
  type: SfxType;
  beatId: string;
  eventMs: number;
  reason: SfxDropReason;
  detail: string;
}

export interface SfxPlanReport {
  durationMs: number;
  storyboardSounds: number;
  storyboardHoles: number;
  derivedCandidates: number;
  kept: number;
  keptDerived: number;
  holes: number;
  dropped: number;
  /** kept / (duration / 10 s). */
  per10s: number;
  /** Max onsets in any 10 s window. */
  maxInWindow: number;
  /** Start of the fullest 10 s window (ms). */
  maxWindowStartMs: number;
  /** Starts (ms) of 10 s windows (from MIN_WINDOW_FROM_MS, 1 s steps) holding no onset. */
  emptyWindows: number[];
  /** Longest stretch without an onset (reel start/end included), ms. */
  longestEmptyMs: number;
  /** Longest run of consecutive SFX of one type. */
  maxSameTypeRun: number;
  /** Storyboard SFX moved onto their visual event (rule 4). */
  reanchored: { id: string; type: SoundSfx; beatId: string; fromMs: number; toMs: number; anchor: string }[];
  /** Kept SFX whose beat is not "mechanism" and that are not on a transition (hard cut / long pan / section change
   *  origin, or within SFX_ANCHOR_TOL_F of a camera key start). The brief puts SFX only on transitions and mechanism
   *  moments; derived fill never lands here except climax thuds and glitch actions, authored SFX may. */
  offPlacementRule: { id: string; source: SfxSource; type: SoundSfx; beatId: string; part: string; origin: string | null }[];
  /** 1–3 per 10 s on average and ≤ 3 in any 10 s window (empty windows are reported, not a failure). */
  densityOk: boolean;
  notes: string[];
}

export interface SfxPlan {
  placements: SfxPlacement[];
  holes: SilenceHole[];
  dropped: SfxDrop[];
  report: SfxPlanReport;
}

export interface PlanSfxOptions {
  levels: SfxLevels;
  /** Add derived candidates when the storyboard is under the fill target (default true). */
  fill?: boolean;
  fillPer10s?: number;
  refLufs?: number;
  relDb?: number;
  /** Registry SFX per (target, verb) for the visual re-anchor (registrySfxLookup(sb.world)); without it only the
   *  verb rules and camera keys anchor. */
  actionSfx?: ActionSfxLookup;
}

export type SfxTimeline = Pick<Timeline, "fps" | "durationMs" | "beats" | "words" | "events" | "cameraSegments">;

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const byPriority = (a: SfxCandidate, b: SfxCandidate) => b.priority - a.priority || a.eventMs - b.eventMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function isKeywordImpact(type: SoundSfx, eventF: number, beat: TimelineBeat | undefined): boolean {
  return !!beat && type !== "chatter" && beat.keywordCount > 0 && Math.abs(eventF - beat.keywordF) <= 1;
}

/** Storyboard sounds + holes from the timeline's sfx events. */
function storyboardCandidates(tl: SfxTimeline): { sounds: SfxCandidate[]; holeEvents: { id: string; beatId: string; beatIndex: number; eventF: number; eventMs: number }[] } {
  const sounds: SfxCandidate[] = [];
  const holeEvents: { id: string; beatId: string; beatIndex: number; eventF: number; eventMs: number }[] = [];
  for (const e of tl.events) {
    if (e.kind !== "sfx") continue;
    const id = `sb:${e.beatId}.${e.index}`;
    if (e.type === "silenceHole") {
      holeEvents.push({ id, beatId: e.beatId, beatIndex: e.beatIndex, eventF: e.frame, eventMs: e.ms });
      continue;
    }
    const beat = tl.beats[e.beatIndex];
    const kw = isKeywordImpact(e.type, e.frame, beat);
    const priority = 100 + TYPE_RANK[e.type] + (beat && FOCUS_PARTS.has(beat.part) ? 1 : 0) + (kw ? 1 : 0);
    sounds.push({ id, source: "storyboard", type: e.type, beatId: e.beatId, beatIndex: e.beatIndex, eventF: e.frame, eventMs: e.ms, gainDb: e.gainDb, priority, keywordImpact: kw });
  }
  return { sounds, holeEvents };
}

/** Derived candidates on transitions and mechanism moments (used only to reach the fill target). */
export function derivedCandidates(tl: SfxTimeline): SfxCandidate[] {
  const out: SfxCandidate[] = [];
  const ms = (f: number) => (f * 1000) / tl.fps;
  const push = (origin: string, type: SoundSfx, beatIndex: number, eventF: number, gainDb: number, priority: number, n: number) => {
    const beat = tl.beats[beatIndex];
    if (!beat) return;
    out.push({ id: `dv:${origin}:${beat.id}.${n}`, source: "derived", origin, type, beatId: beat.id, beatIndex, eventF, eventMs: ms(eventF), gainDb, priority, keywordImpact: isKeywordImpact(type, eventF, beat) });
  };
  for (const s of tl.cameraSegments) {
    if (s.transition === "hardCut") push("hardCut", "whoosh", s.beatIndex, s.startF, -6, 30, s.keyIndex);
    else if (s.panPx >= LONG_PAN_PX) push("longPan", "whoosh", s.beatIndex, s.startF, -8, 18, s.keyIndex);
  }
  for (const e of tl.events) if (e.kind === "action" && e.do === "glitch") push("glitchAction", "glitch", e.beatIndex, e.frame, -6, 26, e.index);
  for (const b of tl.beats) {
    if (b.keywordCount === 0) continue;
    if (b.part === "climax") push("climaxKeyword", "thud", b.index, b.keywordF, -6, 28, 0);
    else if (b.part === "mechanism") push("mechanismKeyword", "tick", b.index, b.keywordF, -6, 20, 0);
  }
  return out.sort(byPriority);
}

/** Gap-only candidates (used only to cover an otherwise empty 10 s window): section changes → whoosh. W4 fix round 2
 *  removed phrase texture → chatter and state change → tick outside the mechanism: they sat on context / closure beats
 *  (neither transition nor mechanism moment) and often on no visual event at all. */
export function gapCandidates(tl: SfxTimeline): SfxCandidate[] {
  const out: SfxCandidate[] = [];
  const ms = (f: number) => (f * 1000) / tl.fps;
  const push = (origin: string, type: SoundSfx, beatIndex: number, eventF: number, gainDb: number, priority: number, n: number) => {
    const beat = tl.beats[beatIndex];
    if (!beat) return;
    out.push({ id: `dv:${origin}:${beat.id}.${n}`, source: "derived", origin, type, beatId: beat.id, beatIndex, eventF, eventMs: ms(eventF), gainDb, priority, keywordImpact: isKeywordImpact(type, eventF, beat) });
  };
  tl.beats.forEach((b, i) => {
    if (i > 0 && b.part !== tl.beats[i - 1].part && Number.isFinite(b.startF)) push("sectionChange", "whoosh", i, b.startF, -8, 16, 0);
  });
  return out.sort(byPriority);
}

/** Starts of 10 s windows [s, s + 10 s) for s = from, from + 1 s, … (s + 10 s ≤ duration) holding fewer than `min` points. */
export function sparseWindows(starts: readonly number[], durationMs: number, fromMs = MIN_WINDOW_FROM_MS, min = MIN_IN_WINDOW, windowMs = WINDOW_MS, stepMs = 1000): number[] {
  const out: number[] = [];
  for (let s = fromMs; s + windowMs <= durationMs + 1e-6; s += stepMs) if (starts.filter((x) => x >= s && x < s + windowMs).length < min) out.push(s);
  return out;
}

/** Longest stretch without a point, counting the reel start and end. */
export function longestEmpty(starts: readonly number[], durationMs: number): number {
  const s = [0, ...[...starts].sort((a, b) => a - b), durationMs];
  let best = 0;
  for (let i = 1; i < s.length; i++) best = Math.max(best, s[i] - s[i - 1]);
  return best;
}

/** Longest run of consecutive equal types (in onset order) and where it starts. */
export function sameTypeRun(placements: readonly Pick<SfxPlacement, "type" | "startMs">[]): { run: number; type: SoundSfx | null; startMs: number } {
  const p = [...placements].sort((a, b) => a.startMs - b.startMs);
  let best = { run: 0, type: null as SoundSfx | null, startMs: 0 };
  for (let i = 0; i < p.length; ) {
    let j = i;
    while (j < p.length && p[j].type === p[i].type) j++;
    if (j - i > best.run) best = { run: j - i, type: p[i].type, startMs: p[i].startMs };
    i = j;
  }
  return best;
}

/** Max number of points in any half-open window [s, s + windowMs) and where it starts. */
export function maxInWindow(starts: readonly number[], windowMs = WINDOW_MS): { count: number; startMs: number } {
  const s = [...starts].sort((a, b) => a - b);
  let best = { count: 0, startMs: 0 };
  for (let i = 0, j = 0; i < s.length; i++) {
    while (j < s.length && s[j] < s[i] + windowMs) j++;
    if (j - i > best.count) best = { count: j - i, startMs: s[i] };
  }
  return best;
}

export function planSfx(tl: SfxTimeline, opts: PlanSfxOptions): SfxPlan {
  const fill = opts.fill ?? true;
  const fillPer10s = opts.fillPer10s ?? FILL_PER_10S;
  const dur = tl.durationMs;
  const dropped: SfxDrop[] = [];
  const notes: string[] = [];
  const drop = (c: { id: string; source: SfxSource; type: SfxType; beatId: string; eventMs: number }, reason: SfxDropReason, detail: string) =>
    dropped.push({ id: c.id, source: c.source, type: c.type, beatId: c.beatId, eventMs: round3(c.eventMs), reason, detail });

  const { sounds: authored, holeEvents } = storyboardCandidates(tl);

  // ── visual re-anchor: a whoosh / tick / thud off every visual event of its beat moves once to the nearest one ─────
  const reanchored: SfxPlanReport["reanchored"] = [];
  const sounds = [...authored].sort((a, b) => a.eventMs - b.eventMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((c): SfxCandidate => {
    if (c.type !== "whoosh" && c.type !== "tick" && c.type !== "thud") return c;
    const anchors = sfxAnchors(tl, c.beatIndex, c.type, opts.actionSfx);
    if (anchors.some((a) => Math.abs(a.frame - c.eventF) <= SFX_ANCHOR_TOL_F)) return c;
    const a = nearestAnchor(anchors, c.eventF);
    const beat = tl.beats[c.beatIndex];
    if (!a) {
      notes.push(`${c.id} ${c.type} at ${Math.round(c.eventMs)} ms: no ${c.type} visual event in ${c.beatId}, kept on its authored frame`);
      return c;
    }
    const eventMs = (a.frame * 1000) / tl.fps;
    const kw = isKeywordImpact(c.type, a.frame, beat);
    reanchored.push({ id: c.id, type: c.type, beatId: c.beatId, fromMs: round3(c.eventMs), toMs: round3(eventMs), anchor: a.what });
    notes.push(`${c.id} ${c.type} re-anchored ${Math.round(c.eventMs)} → ${Math.round(eventMs)} ms onto ${a.what} (nothing ${c.type}-like within ±${SFX_ANCHOR_TOL_F} f of its anchor)`);
    return { ...c, origin: `reanchored:${a.what}`, eventF: a.frame, eventMs, keywordImpact: kw, priority: c.priority - (c.keywordImpact ? 1 : 0) + (kw ? 1 : 0) };
  });

  // ── silence holes ───────────────────────────────────────────────────────────────────────────────────────────
  const holes: SilenceHole[] = [];
  for (const h of [...holeEvents].sort((a, b) => a.eventMs - b.eventMs || (a.id < b.id ? -1 : 1))) {
    const startMs = Math.max(0, h.eventMs - HOLE_LEAD_MS);
    const endMs = Math.min(dur, h.eventMs + HOLE_TAIL_MS);
    const c = { id: h.id, source: "storyboard" as const, type: "silenceHole" as const, beatId: h.beatId, eventMs: h.eventMs };
    const w = tl.words.find((x) => x.startMs < endMs && x.endMs > startMs);
    if (w) {
      drop(c, "hole-over-speech", `word "${w.text}" (${Math.round(w.startMs)}–${Math.round(w.endMs)} ms) overlaps the hole ${Math.round(startMs)}–${Math.round(endMs)} ms; the voice is never gated`);
      continue;
    }
    const prev = holes[holes.length - 1];
    if (prev && startMs < prev.endMs + MIN_SPACING_MS) {
      drop(c, "hole-overlap", `within ${MIN_SPACING_MS} ms of hole ${prev.id}`);
      continue;
    }
    holes.push({ id: h.id, beatId: h.beatId, beatIndex: h.beatIndex, eventF: h.eventF, eventMs: round3(h.eventMs), startMs: round3(startMs), endMs: round3(endMs) });
  }

  // ── sounds ──────────────────────────────────────────────────────────────────────────────────────────────────
  const toPlacement = (c: SfxCandidate): SfxPlacement => {
    const lead = leadMs(c.type, tl.fps);
    const raw = c.eventMs + lead;
    return { ...c, eventMs: round3(c.eventMs), leadMs: round3(lead), startMs: round3(Math.max(0, raw)), clamped: raw < 0, volumeDb: sfxVolumeDb(c.type, c.gainDb, opts.levels, opts.refLufs, opts.relDb), file: opts.levels[c.type].file };
  };

  const guards = tl.beats
    .filter((b) => b.keywordCount > 0 && tl.words[b.keywordWord])
    .map((b) => ({ beat: b, startMs: tl.words[b.keywordWord].startMs, text: tl.words[b.keywordWord].text }));

  /** Static rejections (independent of what else is kept). */
  const staticReject = (p: SfxPlacement): [SfxDropReason, string] | null => {
    if (p.startMs >= dur - 100) return ["past-end", `starts at ${Math.round(p.startMs)} ms, reel ends at ${Math.round(dur)} ms`];
    const [b0, b1] = SFX_BODY_MS[p.type];
    const bodyStart = p.startMs + b0;
    const bodyEnd = p.startMs + b1;
    for (const g of guards) {
      if (bodyStart < g.startMs + KEYWORD_GUARD_MS && bodyEnd > g.startMs) {
        if (p.keywordImpact && p.beatIndex === g.beat.index) continue;
        return ["keyword-mask", `${p.type} body ${Math.round(bodyStart)}–${Math.round(bodyEnd)} ms covers the first ${KEYWORD_GUARD_MS} ms of ${g.beat.id}'s keyword "${g.text}" at ${Math.round(g.startMs)} ms`];
      }
    }
    const h = holes.find((x) => p.startMs >= x.startMs && p.startMs < x.endMs);
    if (h) return ["in-silence-hole", `starts inside silence hole ${h.id} (${Math.round(h.startMs)}–${Math.round(h.endMs)} ms)`];
    return null;
  };

  const kept: SfxPlacement[] = [];
  /** Dynamic rejections against what is already kept. */
  const conflict = (p: SfxPlacement): [SfxDropReason, string] | null => {
    const near = kept.find((k) => Math.abs(k.startMs - p.startMs) < MIN_SPACING_MS);
    if (near) return ["too-close", `onset ${Math.round(p.startMs)} ms is within ${MIN_SPACING_MS} ms of ${near.id} (${Math.round(near.startMs)} ms, priority ${near.priority} ≥ ${p.priority})`];
    const m = maxInWindow([...kept.map((k) => k.startMs), p.startMs]);
    if (m.count > MAX_PER_WINDOW) return ["window-cap", `would put ${m.count} SFX in the 10 s window from ${Math.round(m.startMs)} ms (max ${MAX_PER_WINDOW})`];
    return null;
  };

  // runs of consecutive mechanism beats (beat index → run number)
  const mechRun = new Map<number, number>();
  tl.beats.forEach((b, i) => {
    if (b.part !== "mechanism") return;
    mechRun.set(b.index, i > 0 && tl.beats[i - 1].part === "mechanism" ? mechRun.get(tl.beats[i - 1].index)! : b.index);
  });

  /** Fill-only rejections: clearance, same-type spacing, same-type runs, derived ticks per mechanism run. The gap fill
   *  relaxes `level` step by step (1: no same-type spacing, 2: no same-type run limit, 3: no mechanism-run tick limit)
   *  only when nothing else can cover an empty window. */
  const fillRules = (p: SfxPlacement, level: number): [SfxDropReason, string] | null => {
    const typeGap = level < 1;
    if (p.source !== "derived") return null;
    const near = kept.find((k) => Math.abs(k.startMs - p.startMs) < FILL_MIN_GAP_MS);
    if (near) return ["fill-crowded", `fill SFX needs ${FILL_MIN_GAP_MS} ms clearance; ${near.id} starts at ${Math.round(near.startMs)} ms`];
    const same = typeGap ? kept.find((k) => k.type === p.type && Math.abs(k.startMs - p.startMs) < FILL_TYPE_GAP_MS) : undefined;
    if (same) return ["type-spacing", `fill ${p.type} needs ${FILL_TYPE_GAP_MS} ms from any kept ${p.type}; ${same.id} starts at ${Math.round(same.startMs)} ms`];
    if (level < 2) {
      const seq = [...kept, p].sort((a, b) => a.startMs - b.startMs);
      const i = seq.indexOf(p);
      let a = i;
      let b = i;
      while (a > 0 && seq[a - 1].type === p.type) a--;
      while (b < seq.length - 1 && seq[b + 1].type === p.type) b++;
      if (b - a + 1 > MAX_SAME_TYPE_RUN) return ["type-run", `would make ${b - a + 1} consecutive ${p.type} SFX (max ${MAX_SAME_TYPE_RUN})`];
    }
    const run = mechRun.get(p.beatIndex);
    if (p.type === "tick" && run !== undefined && level < 3) {
      const n = kept.filter((k) => k.source === "derived" && k.type === "tick" && mechRun.get(k.beatIndex) === run).length;
      if (n >= MAX_TICKS_PER_MECH_RUN) return ["tick-run", `already ${n} derived ticks in the mechanism run from ${tl.beats[run]?.id ?? run} (max ${MAX_TICKS_PER_MECH_RUN})`];
    }
    return null;
  };

  const check = (c: SfxCandidate, level = 0): { p: SfxPlacement; why: [SfxDropReason, string] | null } => {
    const p = toPlacement(c);
    return { p, why: staticReject(p) ?? conflict(p) ?? fillRules(p, level) };
  };

  const tryAdd = (c: SfxCandidate): boolean => {
    const { p, why } = check(c);
    if (why) {
      drop(c, why[0], why[1]);
      return false;
    }
    kept.push(p);
    return true;
  };

  for (const c of [...sounds].sort(byPriority)) {
    const { p, why } = check(c);
    if (!why) {
      kept.push(p);
      continue;
    }
    // chatter is a phrase bed: anchored on (or masking) a keyword, move it to its beat's phraseStart once
    const beat = tl.beats[c.beatIndex];
    if (why[0] === "keyword-mask" && c.type === "chatter" && beat && Number.isFinite(beat.firstWordF) && beat.firstWordF !== c.eventF) {
      const moved: SfxCandidate = { ...c, origin: "reanchored:phraseStart", eventF: beat.firstWordF, eventMs: (beat.firstWordF * 1000) / tl.fps };
      const r = check(moved);
      if (!r.why) {
        kept.push(r.p);
        notes.push(`${c.id} chatter re-anchored to ${beat.id} phraseStart (${Math.round(moved.eventMs)} ms): on the keyword it ${why[1].replace(/^chatter body /, "body ")}`);
        continue;
      }
    }
    drop(c, why[0], c.type === "chatter" && why[0] === "keyword-mask" ? `${why[1]} (also at phraseStart)` : why[1]);
  }

  // ── gap fill: no empty 10 s window ─────────────────────────────────────────────────────────────────────────────
  const derived = fill ? derivedCandidates(tl) : [];
  const gapOnly = fill ? gapCandidates(tl) : [];
  const lastWhy = new Map<string, [SfxDropReason, string]>();
  const used = new Set<string>();
  if (fill) {
    const all = [...derived, ...gapOnly];
    /** Window starts no legal candidate can cover (kept SFX only add conflicts, so they stay uncoverable). */
    const uncoverable = new Set<number>();
    for (;;) {
      const empty = sparseWindows(kept.map((k) => k.startMs), dur).filter((w) => !uncoverable.has(w));
      if (!empty.length) break;
      // interval cover, left to right: among legal candidates that cover the EARLIEST empty window, take one within
      // GAP_REACH_SLACK_MS of the latest (longest reach → fewest SFX), preferring a type unlike its neighbours, then priority
      const s0 = empty[0];
      let best: { c: SfxCandidate; p: SfxPlacement } | null = null;
      for (const level of [0, 1, 2, 3]) {
        const ok: { c: SfxCandidate; p: SfxPlacement; diverse: number }[] = [];
        for (const c of all) {
          if (used.has(c.id)) continue;
          const r = check(c, level);
          if (r.why) {
            lastWhy.set(c.id, r.why);
            continue;
          }
          if (r.p.startMs < s0 || r.p.startMs >= s0 + WINDOW_MS) continue;
          const prev = kept.filter((k) => k.startMs < r.p.startMs).sort((a, b) => b.startMs - a.startMs)[0];
          const next = kept.filter((k) => k.startMs > r.p.startMs).sort((a, b) => a.startMs - b.startMs)[0];
          ok.push({ c, p: r.p, diverse: (prev?.type !== c.type ? 1 : 0) + (next?.type !== c.type ? 1 : 0) });
        }
        if (!ok.length) continue;
        const reach = Math.max(...ok.map((o) => o.p.startMs));
        const near = ok.filter((o) => o.p.startMs >= reach - GAP_REACH_SLACK_MS);
        near.sort((a, b) => b.diverse - a.diverse || b.c.priority - a.c.priority || b.p.startMs - a.p.startMs || (a.c.id < b.c.id ? -1 : 1));
        best = near[0];
        break;
      }
      if (!best) {
        uncoverable.add(s0);
        continue;
      }
      kept.push(best.p);
      used.add(best.c.id);
      lastWhy.delete(best.c.id);
    }
  }

  // ── rate fill ───────────────────────────────────────────────────────────────────────────────────────────────
  const target = Math.ceil((fillPer10s * dur) / WINDOW_MS);
  const minTarget = Math.ceil((MIN_PER_10S * dur) / WINDOW_MS);
  const pool = derived.filter((c) => !used.has(c.id));
  while (pool.length && kept.length < target) {
    if (kept.length >= minTarget && new Set(pool.map((c) => c.type)).size === 1) {
      notes.push(`fill stopped at ${kept.length} (≥ ${MIN_PER_10S} per 10 s): only ${pool[0].type} candidates left`);
      break;
    }
    // emptiest stretch first (gap to the nearest kept onset in whole seconds, capped at 10 s), then priority, then time
    const gapS = (c: SfxCandidate) => {
      const s = c.eventMs + leadMs(c.type, tl.fps);
      return kept.length ? Math.min(10, Math.floor(Math.min(...kept.map((k) => Math.abs(k.startMs - s))) / 1000)) : 10;
    };
    pool.sort((a, b) => gapS(b) - gapS(a) || b.priority - a.priority || a.eventMs - b.eventMs || (a.id < b.id ? -1 : 1));
    const c = pool.shift()!;
    used.add(c.id);
    lastWhy.delete(c.id);
    tryAdd(c);
  }
  for (const c of [...pool, ...gapOnly.filter((g) => !used.has(g.id))]) drop(c, "fill-not-needed", lastWhy.has(c.id) ? `unused (last check: ${lastWhy.get(c.id)![0]} — ${lastWhy.get(c.id)![1]})` : kept.length >= target ? `fill target ${target} reached` : `fill complete at ${kept.length}`);

  // ── average cap ─────────────────────────────────────────────────────────────────────────────────────────────
  const maxTotal = Math.floor((MAX_PER_10S * dur) / WINDOW_MS);
  if (kept.length > maxTotal) {
    kept.sort((a, b) => byPriority(a, b));
    for (const p of kept.splice(Math.max(0, maxTotal))) drop(p, "density-cap", `reel average would exceed ${MAX_PER_10S} per 10 s (${maxTotal} max for ${(dur / 1000).toFixed(1)} s)`);
  }

  kept.sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1));
  // repeat jitter: the 2nd, 3rd, … sound of a type gets a deterministic offset when it is derived
  const typeCount = new Map<SoundSfx, number>();
  for (const [i, p] of kept.entries()) {
    const n = typeCount.get(p.type) ?? 0;
    typeCount.set(p.type, n + 1);
    if (p.source !== "derived" || n === 0) continue;
    const j = REPEAT_JITTER_DB[(n - 1) % REPEAT_JITTER_DB.length];
    const gainDb = Math.max(-12, Math.min(0, p.gainDb + j));
    kept[i] = { ...p, gainDb, jitterDb: round2(gainDb - p.gainDb), volumeDb: sfxVolumeDb(p.type, gainDb, opts.levels, opts.refLufs, opts.relDb) };
  }
  dropped.sort((a, b) => a.eventMs - b.eventMs || (a.id < b.id ? -1 : 1));
  const per10s = dur > 0 ? round2((kept.length * WINDOW_MS) / dur) : 0;
  const win = maxInWindow(kept.map((k) => k.startMs));
  const starts = kept.map((k) => k.startMs);
  const emptyWindows = sparseWindows(starts, dur);
  const longestEmptyMs = longestEmpty(starts, dur);
  const run = sameTypeRun(kept);
  const densityOk = per10s >= MIN_PER_10S && per10s <= MAX_PER_10S && win.count <= MAX_PER_WINDOW;
  if (per10s < MIN_PER_10S) notes.push(`under-filled: ${per10s} per 10 s < ${MIN_PER_10S} (${fill ? "not enough legal transition/mechanism moments" : "fill disabled"})`);
  if (emptyWindows.length) notes.push(`empty 10 s windows (no transition / mechanism candidate) start at ${emptyWindows.map((w) => w / 1000).join(", ")} s`);
  const TRANSITION_ORIGINS = new Set(["hardCut", "longPan", "sectionChange"]);
  const onCamera = (p: SfxPlacement) => tl.cameraSegments.some((c) => c.beatIndex === p.beatIndex && Math.abs(c.startF - p.eventF) <= SFX_ANCHOR_TOL_F);
  const offPlacementRule = kept
    .filter((p) => tl.beats[p.beatIndex]?.part !== "mechanism" && !TRANSITION_ORIGINS.has(p.origin ?? "") && !onCamera(p))
    .map((p) => ({ id: p.id, source: p.source, type: p.type, beatId: p.beatId, part: tl.beats[p.beatIndex]?.part ?? "?", origin: p.origin ?? null }));
  if (offPlacementRule.length) notes.push(`not on a transition or mechanism moment: ${offPlacementRule.map((o) => `${o.id} ${o.type} (${o.part})`).join(", ")}`);
  if (longestEmptyMs > MAX_EMPTY_STRETCH_MS) notes.push(`warning: ${(longestEmptyMs / 1000).toFixed(1)} s without an SFX (> ${MAX_EMPTY_STRETCH_MS / 1000} s)`);
  if (run.run > MAX_SAME_TYPE_RUN) notes.push(`warning: ${run.run} consecutive ${run.type} from ${Math.round(run.startMs)} ms (> ${MAX_SAME_TYPE_RUN})`);
  if (kept.some((k) => k.clamped)) notes.push("some SFX start at 0 ms because their lead reached before the reel start");

  return {
    placements: kept,
    holes,
    dropped,
    report: {
      durationMs: round3(dur),
      storyboardSounds: sounds.length,
      storyboardHoles: holeEvents.length,
      derivedCandidates: derived.length + gapOnly.length,
      kept: kept.length,
      keptDerived: kept.filter((k) => k.source === "derived").length,
      holes: holes.length,
      dropped: dropped.length,
      per10s,
      maxInWindow: win.count,
      maxWindowStartMs: round3(win.startMs),
      emptyWindows,
      longestEmptyMs: round3(longestEmptyMs),
      maxSameTypeRun: run.run,
      reanchored,
      offPlacementRule,
      densityOk,
      notes,
    },
  };
}
