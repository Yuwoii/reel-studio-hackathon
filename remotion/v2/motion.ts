// Shared motion maths for v2 layers and components (amendments §7, bible §7). Pure functions of the frame; randomness
// only via remotion random(seed); discrete values (scrambles, digits, typed characters, glitch frames) step on
// Math.floor(frame) so every motion-blur sub-sample of one output frame agrees (no ghosted digits).
//
// Vocabulary (W2 contract; every library component uses these, never its own variant):
//   enterProgress / exitProgress / exitOpacity / enterExitStyle   spring d200 s180 m0.6 · 8 f (1−x)² opacity + blur exit
//   stagger / staggerEnter                          3–4 f list stagger
//   scramble                                        6–8 f left-to-right settle, class-preserving, optional change-only / holdDigits
//   glitchAt (+ <Glitch> in components/primitives)  4 f, fixed red/white tinted copies ±8 px, slices, flicker
//   countUp / formatCount                           20 f ease-out cubic, tabular, en-US grouping (locale-free)
//   drawOn / evolve (+ <DrawPath>)                  bible-bezier evolvePath progress (dashed strokes via a mask)
//   pulse (= dangerPulse)                           0.7↔1 over 20 f, never faster
//   squash                                          impact 1 → 0.96 → 1 over 6 f
//   typing                                          2 chars/f + caret (solid while typing, blinks 16 f after)
//   stateMix                                        6 f cross-fade for state colour changes
//   flash, latest                                   decaying kick after an event, latest event ≤ f
import type React from "react";
import { evolvePath } from "@remotion/paths";
import { Easing, interpolate, random, spring } from "remotion";
import { FPS, motion } from "./theme";

export const clampX = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Entrance spring d200 s180 m0.6 (99 % at ≈ f12): opacity, y 24→0, scale 0.97→1. `enterF` null = always in. */
export function enterProgress(frame: number, enterF: number | null): number {
  if (enterF === null) return 1;
  if (frame < enterF) return 0;
  return spring({ frame: frame - enterF, fps: FPS, config: motion.enter });
}

/** Exit over 8 f: opacity 1→0 and blur 0→8 px. 0 before the exit, 1 when gone. */
export function exitProgress(frame: number, exitF: number | null): number {
  if (exitF === null || frame < exitF) return 0;
  return interpolate(frame, [exitF, exitF + motion.exitF], [0, 1], clampX);
}

/**
 * Exit opacity for an exit progress x: (1 − x)², so a plate is under 0.3 opacity 4 f into the 8 f exit (W2 fix: with a
 * linear fade the half-transparent card read as sinking BEHIND the data field, and its danger fills smeared red under
 * the field rows). The blur still runs over the full 8 f.
 */
export function exitOpacity(x: number): number {
  const k = 1 - Math.min(1, Math.max(0, x));
  return k * k;
}

export function enterExitStyle(frame: number, enterF: number | null, exitF: number | null): React.CSSProperties & { visible: boolean } {
  const e = enterProgress(frame, enterF);
  const x = exitProgress(frame, exitF);
  const opacity = e * exitOpacity(x);
  const style: React.CSSProperties & { visible: boolean } = {
    visible: opacity > 0.001,
    opacity,
    transform: `translateY(${(1 - e) * motion.enterY}px) scale(${motion.enterScale + (1 - motion.enterScale) * e})`,
  };
  if (x > 0) style.filter = `blur(${x * motion.exitBlurPx}px)`;
  return style;
}

/** Bible §4 / §7 ease bezier(0.65, 0, 0.35, 1) on t ∈ [0, 1]. */
export const easeBible = Easing.bezier(0.65, 0, 0.35, 1);

/** Danger pulse 0.7↔1 over 20 f (starts at 1). */
export function dangerPulse(frame: number, fromF: number): number {
  const [lo, hi] = motion.dangerPulse;
  const t = (frame - fromF) / motion.dangerPulseF;
  return lo + (hi - lo) * (0.5 + 0.5 * Math.cos(t * 2 * Math.PI));
}

/** Decaying 0..1 flash after `at` (for pulses / keyword kicks): 1 at `at`, ≈0 after ~12 f. */
export function flash(frame: number, at: number | undefined, tauF = 4): number {
  if (at === undefined || frame < at) return 0;
  const v = Math.exp(-(frame - at) / tauF);
  return v < 0.01 ? 0 : v;
}

// One scramble for the whole library (W2.1: motion.ts `scramble` and components/textScramble.ts `diffScramble` merged;
// textScramble.ts is now a thin compat shim over this). Class-preserving: an unsettled glyph rolls through its TARGET's
// class only (A–Z, a–z, 0–9 — "memory.max" never flashes "meQ0F0"); everything else (spaces, ".", "/", "·", "→" …)
// holds. Discrete on Math.floor(frame) with seeded random(), so motion-blur sub-samples agree.
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/** The glyph pool a scrambling character rolls through (its own class), or null = never scrambles. */
export function glyphPool(c: string): string | null {
  return /[A-Z]/.test(c) ? UPPER : /[a-z]/.test(c) ? LOWER : /[0-9]/.test(c) ? DIGITS : null;
}

/** Lengths of the common prefix and (non-overlapping) common suffix of a and b. */
export function commonEnds(a: string, b: string): { pre: number; suf: number } {
  const n = Math.min(a.length, b.length);
  let pre = 0;
  while (pre < n && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { pre, suf };
}

export interface ScrambleOpts {
  /** "right" for a right-aligned label: pad on the LEFT so the tails line up (separators and "STEP n/4" stay put). */
  align?: "left" | "right";
  /** Characters equal in `from` and `to` (after alignment) never scramble — only the changed positions roll. Ignored
   *  when from === to (an in-place re-scramble rolls everything, by design). */
  keepSame?: boolean;
  /** Change-only (the library default for value overrides): the common prefix and suffix of `from` and `to` hold, and
   *  inside the changed span a glyph equal to the old one at the same offset holds too; the span settles left to right.
   *  A pure deletion shrinks the old span from the right. Ignored when from === to (re-scramble rolls everything). */
  changedOnly?: boolean;
  /** Digits never roll (data such as "STEP n/4": a random numerator read as "STEP 7/4"). An unsettled digit shows the
   *  OLD digit at that position (after alignment) until it settles, then steps once to the new one; a digit over a
   *  non-digit shows the new digit at once. Applies to the aligned path (not `changedOnly`). */
  holdDigits?: boolean;
}

/** Roll `span` (settling left → right over durF); `hold(i)` = glyph i never rolls. With `digitsFrom`, an unsettled
 *  digit never rolls and shows digitsFrom[i] when that is a digit (else its own value). */
function rollSpan(span: string, f: number, start: number, durF: number, seed: string, hold: (i: number) => boolean, digitsFrom?: string): string {
  let out = "";
  for (let i = 0; i < span.length; i++) {
    const c = span[i];
    const pool = glyphPool(c);
    const settled = f >= start + ((i + 1) * durF) / span.length;
    if (settled || !pool || hold(i)) out += c;
    else if (digitsFrom !== undefined && pool === DIGITS) out += /[0-9]/.test(digitsFrom[i] ?? "") ? digitsFrom[i] : c;
    else out += pool[Math.floor(random(`${seed}:${f}:${i}`) * pool.length)];
  }
  return out;
}

/**
 * Left-to-right settle from `from` to `to` over `durF` frames starting at `start` (R2 scramble; header label changes,
 * value scrambles). Class-preserving (see above). Without `changedOnly`, strings are padded to equal length
 * (end-padded, or start-padded with `align: "right"`). Discrete per frame.
 */
export function scramble(from: string, to: string, frame: number, start: number, durF: number = motion.scrambleF[1], seed = "scr", opts: ScrambleOpts = {}): string {
  const f = Math.floor(frame);
  if (f < start) return from;
  if (f >= start + durF) return to;
  if (opts.changedOnly && from !== to) {
    const { pre, suf } = commonEnds(from, to);
    const mid = to.slice(pre, to.length - suf);
    const old = from.slice(pre, from.length - suf);
    if (mid.length === 0) {
      const keep = Math.max(0, Math.ceil(old.length * (1 - (f - start + 1) / durF)));
      return to.slice(0, pre) + old.slice(0, keep) + to.slice(to.length - suf);
    }
    return to.slice(0, pre) + rollSpan(mid, f, start, durF, seed, (i) => old[i] === mid[i]) + to.slice(to.length - suf);
  }
  const right = opts.align === "right";
  const len = Math.max(from.length, to.length);
  const a = right ? to.padStart(len, " ") : to.padEnd(len, " ");
  const b = right ? from.padStart(len, " ") : from.padEnd(len, " ");
  const keep = opts.keepSame === true && from !== to;
  const out = rollSpan(a, f, start, durF, seed, (i) => keep && b[i] === a[i], opts.holdDigits ? b : undefined);
  return right ? out.replace(/^\s+/, "") : out.replace(/\s+$/, "");
}

/** Latest entry with frame ≤ f (entries sorted by frame), or undefined. */
export function latest<T extends { f: number }>(list: readonly T[], f: number): T | undefined {
  let hit: T | undefined;
  for (const x of list) {
    if (x.f <= f) hit = x;
    else break;
  }
  return hit;
}

// ── W2 vocabulary ──────────────────────────────────────────────────────────────────────────────────────────────

/** Danger-state pulse (bible §7: 0.7↔1 every 20 f, never faster). Alias of dangerPulse. */
export const pulse = dangerPulse;

/** Start frame of list item i (stagger 3–4 f; amendments §7). */
export function stagger(i: number, startF: number, stepF: number = motion.staggerF[0]): number {
  return startF + i * stepF;
}

/** Entrance spring of list item i (0..1). */
export function staggerEnter(frame: number, startF: number | null, i: number, stepF: number = motion.staggerF[0]): number {
  return enterProgress(frame, startF === null ? null : stagger(i, startF, stepF));
}

/** 0..1 cross-fade over `durF` (default 6 f = motion.markF) after a state change at `atF` (null = settled). */
export function stateMix(frame: number, atF: number | null, durF: number = motion.markF): number {
  if (atF === null) return 1;
  return interpolate(frame, [atF, atF + durF], [0, 1], clampX);
}

/** Impact squash 1 → 0.96 → 1 over 6 f (bible §6.6). 1 outside the window. */
export function squash(frame: number, atF: number | undefined): number {
  if (atF === undefined) return 1;
  const [a, b, c] = motion.impact.scale;
  return interpolate(frame, [atF, atF + motion.impact.f / 2, atF + motion.impact.f], [a, b, c], clampX);
}

/**
 * Count-up value (R2: 20 f, ease-out cubic). Discrete: evaluated on Math.floor(frame), rounded to `decimals`, so every
 * blur sub-sample shows the same digits. Before `startF` → `from`; after → `to`.
 */
export function countUp(to: number, frame: number, startF: number, durF = 20, from = 0, decimals = 0): number {
  const f = Math.floor(frame);
  const t = Math.min(1, Math.max(0, (f - startF) / durF));
  const v = from + (to - from) * (1 - Math.pow(1 - t, 3));
  const k = Math.pow(10, decimals);
  return t >= 1 ? to : Math.round(v * k) / k;
}

/** Locale-free en-US formatting ("1,284,301", "0.62"): identical on every Lambda. Render with tabular-nums. */
export function formatCount(n: number, decimals = 0, grouping = true): string {
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const g = grouping ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  return `${neg ? "-" : ""}${g}${frac ? `.${frac}` : ""}`;
}

/** Draw-on progress 0..1 over `durF` (12–18 f, R7) with the bible bezier. Continuous (a stroke may blur). */
export function drawOn(frame: number, startF: number | undefined, durF = 16): number {
  if (startF === undefined) return 1;
  return easeBible(Math.min(1, Math.max(0, (frame - startF) / durF)));
}

/** evolvePath for a draw-on progress (stroke-dasharray/offset). Use through a mask for dashed strokes (R2 §7). */
export function evolve(progress: number, d: string): { strokeDasharray: string; strokeDashoffset: number } {
  return evolvePath(Math.min(1, Math.max(0, progress)), d);
}

export interface TypingFrame {
  shown: string;
  done: boolean;
  /** Caret visible this frame: solid while typing, then blinks 16 f on / 16 f off. */
  caretOn: boolean;
}

/** Terminal typing (bible §6.8): `cps` chars per frame (default 2) from `startF`, discrete per frame. */
export function typing(text: string, frame: number, startF: number, cps = 2): TypingFrame {
  const f = Math.floor(frame);
  const n = Math.max(0, Math.floor((f - startF) * cps));
  const shown = f < startF ? "" : text.slice(0, n);
  const done = f >= startF && n >= text.length;
  const doneAt = startF + Math.ceil(text.length / cps);
  const caretOn = !done || Math.floor((f - doneAt) / 16) % 2 === 0;
  return { shown, done, caretOn };
}

export interface GlitchCopy {
  dx: number;
  /** Fixed tint token (R2: never real channel extraction — it turns lime text green). */
  tint: "danger" | "text";
  opacity: number;
}
export interface GlitchSlice {
  /** Slice band in % of the element height. */
  top: number;
  bottom: number;
  dx: number;
}
export interface GlitchFrame {
  /** 0..3 within the 4-frame glitch. */
  i: number;
  copies: GlitchCopy[];
  slices: GlitchSlice[];
  /** Opacity flicker of the base layer. */
  opacity: number;
}

const GLITCH_OFFSETS = [8, -8, 6, -4];
const GLITCH_FLICKER = [1, 0.85, 1, 0.9];
const GLITCH_SLICES = 6;

/**
 * The glitch frame for a glitch starting at `atF` (amendments §7: 4 f, fixed red/white tinted copies offset ±8 px,
 * horizontal slice displacement ±24 px, opacity flicker), or null outside its window. Discrete per frame.
 */
export function glitchAt(frame: number, atF: number | undefined, seed: string): GlitchFrame | null {
  if (atF === undefined) return null;
  const f = Math.floor(frame);
  const i = f - atF;
  if (i < 0 || i >= motion.glitch.f) return null;
  const o = (GLITCH_OFFSETS[i] * motion.glitch.offsetPx) / 8;
  const slices: GlitchSlice[] = [];
  for (let k = 0; k < GLITCH_SLICES; k++) {
    if (random(`${seed}:g${i}:on${k}`) < 0.5) continue;
    const top = (k * 100) / GLITCH_SLICES;
    slices.push({ top, bottom: 100 - top - 100 / GLITCH_SLICES, dx: Math.round((random(`${seed}:g${i}:dx${k}`) * 2 - 1) * 24) });
  }
  return {
    i,
    copies: [
      { dx: o, tint: "danger", opacity: 0.6 },
      { dx: -o, tint: "text", opacity: 0.6 },
    ],
    slices,
    opacity: GLITCH_FLICKER[i],
  };
}

/** The latest glitch start ≤ f whose 4-frame window covers f (for a sorted list of glitch frames). */
export function activeGlitch(glitches: readonly number[], frame: number): number | undefined {
  const f = Math.floor(frame);
  let hit: number | undefined;
  for (const g of glitches) {
    if (g <= f) hit = g;
    else break;
  }
  return hit !== undefined && f - hit < motion.glitch.f ? hit : undefined;
}
