// resolveTimeline(): storyboard v2.1 + words.json → absolute frames for every beat, word, display phrase, anchor,
// camera move, cue and SFX event (ADR-001 §2.5). It is THE timing module: the linter, the still selector, the SFX /
// audio mixer and the Explainer composition all import it, so "lint frame N = rendered frame N".
//
// Bundle-safe on purpose: NO runtime imports at all (only `import type`, erased by esbuild/webpack). The Remotion
// bundler cannot resolve this repo's NodeNext ".js" runtime specifiers (see remotion/timing.ts), so anything this
// module needs at runtime is either defined here or passed in (the component registry → `lib`). From remotion/,
// import it extensionless: `import { resolveTimeline } from "../../src/v2/timeline"`.
//
// Timing model (D1 #3): beats are placed back to back with GAP_MS = 250 ms between one beat's audio end and the next
// beat's audio start; the first beat starts at 0. Word times in words.json are relative to their beat's audio start
// (v1 src/audio/tts.ts format). frame(ms) = round(ms · fps / 1000). Duration = last beat's audio end + TAIL_MS.

import type { ComponentMeta } from "./registry.gen.js";
import type { DrawnShape } from "./components-meta/_types.js";
import type { ActionT, AtT, BeatT, CameraTargetT, FigNodeT, InstanceT, Storyboard, WordsFileT } from "../schema/storyboard.v2.js";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
/** The camera puts its target at this screen point (stage centre, bible §1). */
export const CAM_ANCHOR = { x: 540, y: 855 } as const;
export const GAP_MS = 250;
export const TAIL_MS = 600;
/** Subtitle swap lead: the new phrase starts swapping in 3 f before its first word (PROOF, ≤3 f swaps). */
export const SWAP_LEAD_F = 3;
export const MAX_DISPLAY_WORDS = 5;
/** Subtitle inner width: card max 82 % of 1080 (886 px) − 2 × 36 px padding = 814 px; 14 px kerning margin. */
export const DISPLAY_MAX_PX = 800;
/** Zoom drift over each camera hold (bible §4: +2 %). */
export const HOLD_DRIFT = 0.02;
/** Pre-TTS estimate (R5 checkpoint: 2.9 words/s overall). In-beat speech rate; with 250 ms gaps ≈ 2.9 overall. */
export const ESTIMATE_WPS = 3.2;
/** Seconds-per-frame model constants for L18 (ADR §6, fitted on PROOF §R8 with ≤ 24 samples at 2 px spacing).
 *  W2 (1 px spacing, cap 32) runs every real move at 32 samples: EXTRAPOLATED — refit on 32-sample clips (render-dev
 *  logs model vs measured per clip) or require a measured φ before the first production reel (ADR §6 L18 caveat).
 *
 *  W2.1 check against the r3 Lambda probes (jobs/_dev/w2/r3/probes.log, φ = 1, measured / predicted slowest chunk):
 *    pan   b05 f410-449  79.5 s / 85.0 s = 0.94   (32 samples on most frames, field-heavy world)
 *    push  b07 f669-708   8.5 s / 26.3 s = 0.32
 *    flight b13 f1183-1222 15.8 s / 83.7 s = 0.19
 *  NOT refitted: the pan probe — the most expensive, whole-world case — already sits at 0.94, so lowering T0 /
 *  T_SAMPLE to the push / flight ratios would UNDER-predict exactly the chunks that can breach L18. The spread is the
 *  per-sample world weight (DOM/paint cost of what is on screen while the blur runs), which is what φ measures; the
 *  constants stay the φ = 1 upper envelope until φ comes from probes (b13 is a RequestPill flight over a sparse
 *  stretch of the world: a light world per sample, i.e. a low φ, not a wrong sample count). Refit when ≥ 5 probes per
 *  kind exist; the r3 data only supports "the model is an upper bound within ~1.1× for whole-world pans". */
export const RENDER_T0 = 0.273;
export const RENDER_T_SAMPLE = 0.226;
export const BLUR_MIN_SPEED = 6; // px/f: no blur below
/**
 * Target sub-sample spacing (screen px) along the smear: samples = ceil(v · shutter/360 / spacing). W2: 1.0 px (was
 * 2 px). At 2 px a 1 px card border smeared by a push-in broke into dashes and glyph stems into stepped copies
 * (W1 gate, oom-f380-679.mp4 f639-652); ≤ 1 px keeps every copy overlapping its neighbour.
 */
export const BLUR_PX_PER_SAMPLE = 1;
/** Sample cap (schema blur.maxSamples ≤ this). Above v = 2·32 px/f (180°) the spacing grows past 1 px again. */
export const BLUR_MAX_SAMPLES = 32;
/** @deprecated W1 radius approximation; the blur speed now uses the exact stage corners (cameraDisplacementPx). */
export const ZOOM_SPEED_RADIUS = 1100;
/**
 * Visible stage corners relative to CAM_ANCHOR (screen x 0..1080, y 150..1560 — the world is covered by the header
 * band above and the footer below). A zoom scales about the anchor, so the fastest point of a zoom is a corner.
 */
export const STAGE_CORNERS: readonly (readonly [number, number])[] = [
  [-540, -705],
  [540, -705],
  [-540, 705],
  [540, 705],
];
/** Screen px a tilt change of 1 rad moves the far stage edge (CSS perspective 1600 px; conservative). */
export const TILT_LEVER_PX = 1000;
/** Entrance motion (amendments §7, theme motion.enter / enterY / enterScale): spring d200 s180 m0.6, y 24→0, scale 0.97→1. */
export const ENTER_SPRING = { damping: 200, stiffness: 180, mass: 0.6 } as const;
export const ENTER_Y_PX = 24;
export const ENTER_SCALE = 0.97;

export const EASE_BEZIER = {
  bible: [0.65, 0, 0.35, 1],
  longPan: [0.45, 0, 0.55, 1],
  pushOut: [0.33, 1, 0.68, 1],
  enter: [0.22, 1, 0.36, 1], // camera never uses it; tracks approximate the spring
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type EaseName = keyof typeof EASE_BEZIER;
export const DEFAULT_MOVE_F: Record<"bible" | "longPan" | "pushOut", number> = { bible: 16, longPan: 24, pushOut: 18 };

// Inter 600 @ 46 px advance widths for U+0020..U+007E (fontTools, opsz 32 instance of public/fonts/Inter-Variable.ttf).
const INTER600_46 = [
  10.4, 10.9, 20.7, 28.4, 29.4, 41.7, 29.2, 12.2, 14.8, 14.8, 23.6, 29.7, 10.9, 20.2, 10.9, 16.1, 29.3, 17.5, 27.0, 28.2, 29.6, 27.2, 27.9, 24.8, 27.8, 27.9, 10.9, 11.0, 29.7, 29.7,
  29.7, 25.4, 45.8, 31.9, 29.6, 33.3, 32.1, 27.5, 26.3, 33.8, 32.9, 11.5, 25.4, 30.7, 25.3, 40.6, 33.1, 34.4, 28.8, 34.4, 29.6, 29.4, 28.8, 32.4, 31.6, 45.1, 31.3, 31.0, 28.9, 14.8,
  16.1, 14.8, 20.9, 21.5, 12.7, 24.9, 27.0, 25.0, 27.0, 25.4, 16.1, 27.0, 26.3, 10.7, 10.7, 24.7, 10.7, 40.0, 26.3, 26.2, 27.0, 27.0, 16.4, 23.2, 16.1, 26.3, 24.8, 36.6, 24.2, 24.8,
  23.4, 19.4, 15.2, 19.4, 29.7,
];

/** Estimated subtitle width (px) of `text` in sans 600 46 px. Non-ASCII glyphs count as 30 px. */
export function subtitleWidthPx(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    w += c >= 0x20 && c <= 0x7e ? INTER600_46[c - 0x20] : 30;
  }
  return w;
}

// ── types ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Component registry view used for boxes: the generated static footprint (default props/width) plus, for shipped
 * components, `sizeFor` = the meta's props-aware footprint(props, w) (src/v2/components-meta/_lookup.ts
 * buildFootprintLookup). Without `sizeFor` the static footprint is scaled proportionally to `inst.w`.
 */
export type FootprintLookup = Readonly<Record<string, Pick<ComponentMeta, "footprint" | "focal"> & { sizeFor?: (props: Record<string, unknown>, w: number | undefined) => { w: number; h: number } | null; flightFor?: FlightForFn; contentFor?: (props: Record<string, unknown>, w: number | undefined) => Box | null; relayoutFor?: (props: Record<string, unknown>, w: number | undefined) => readonly { from: { x: number; y: number }; to: { x: number; y: number }; k: number; r: number }[] | null; anchorFor?: (props: Record<string, unknown>, w: number | undefined) => { x: number; y: number } | null; shapeFor?: (props: Record<string, unknown>, w: number | undefined) => DrawnShape | null; states?: readonly string[]; stateProps?: readonly string[] }>>;

/** One action as a component sees it (= components-meta/_lookup TrackEvent). */
export interface FlightAction {
  f: number;
  do: ActionT["do"];
  state?: string;
  props?: Record<string, unknown>;
}
/**
 * Props-aware flight of one action (_lookup flightForMeta: meta.flightFor over the props in force at the action's
 * frame): own speed in world px/f (unscaled) per frame after the anchor; [] = no flight; null = props invalid /
 * unknown (fall back to the static meta.flight).
 */
export type FlightForFn = (raw: Record<string, unknown>, w: number | undefined, events: readonly FlightAction[], at: FlightAction) => { speeds: readonly number[]; samplePx: number } | null;

export interface TimelineWord {
  /** Caption text = the phrase token (punctuation attached). */
  text: string;
  beatIndex: number;
  /** Index within the beat. */
  index: number;
  /** Index over the whole reel. */
  globalIndex: number;
  startMs: number;
  endMs: number;
  startF: number;
  endF: number;
  isKeyword: boolean;
}

export interface DisplayPhrase {
  /** "b03.1" — beat id + 0-based split index. */
  id: string;
  beatId: string;
  beatIndex: number;
  text: string;
  /** Global word indices [first, last]. */
  firstWord: number;
  lastWord: number;
  wordCount: number;
  /** First word's start frame (the onset). */
  startF: number;
  /** Last word's end frame. */
  endF: number;
  /** Frame the card swaps to this phrase (startF − SWAP_LEAD_F, never before 0 / the previous swap). */
  showF: number;
  /** Frame the next phrase takes over (or durationF). */
  hideF: number;
  /** Global index of the highlighted keyword's first word, or null (other splits of the beat). */
  keywordWord: number | null;
  keywordColor: "accent" | "danger";
  widthPx: number;
}

export interface TimelineBeat {
  id: string;
  index: number;
  part: BeatT["part"];
  audioStartMs: number;
  audioEndMs: number;
  durationMs: number;
  /** Beat span on the timeline: audio start → next beat's audio start (or durationF). */
  startF: number;
  endF: number;
  firstWordF: number;
  lastWordEndF: number;
  /** Keyword's first word start frame (fallback: the middle word when the keyword is missing). */
  keywordF: number;
  keywordWord: number;
  keywordColor: "accent" | "danger";
  keywordCount: number;
  words: TimelineWord[];
  displayPhraseIds: string[];
  /** true when this beat had no words.json entry and timings were estimated at ESTIMATE_WPS. */
  estimated: boolean;
}

export interface CamState {
  x: number;
  y: number;
  zoom: number;
  tiltX: number;
}

export interface CameraSegment {
  beatId: string;
  beatIndex: number;
  keyIndex: number;
  transition: "move" | "hardCut";
  ease: "bible" | "longPan" | "pushOut";
  startF: number;
  /** Exclusive; = startF for a hard cut. */
  endF: number;
  durF: number;
  from: CamState;
  to: CamState;
  shake: boolean;
  /** Straight-line screen distance of the pan at the starting zoom (L9 longPan rule). */
  panPx: number;
  /** Peak per-frame screen speed, px/f (L9, blur). 0 for a hard cut. */
  peakPxPerF: number;
}

export interface BlurWindow {
  startF: number;
  /** Exclusive. */
  endF: number;
  peakPxPerF: number;
  /** samples[f − startF] for every frame in the window (all > 0). */
  samples: number[];
}

export type TimelineEvent =
  | { kind: "action"; frame: number; beatId: string; beatIndex: number; index: number; target: string; do: ActionT["do"]; state?: string; props?: Record<string, unknown> }
  | { kind: "camera"; frame: number; beatId: string; beatIndex: number; index: number; transition: "move" | "hardCut"; endF: number; shake: boolean }
  | { kind: "sfx"; frame: number; ms: number; beatId: string; beatIndex: number; index: number; type: BeatT["sfx"][number]["type"]; gainDb: number }
  | { kind: "header"; frame: number; beatId: string; beatIndex: number; right?: string; dot?: "dim" | "danger" | "accent" }
  | { kind: "keyword"; frame: number; beatId: string; beatIndex: number; color: "accent" | "danger" };

export interface TimelineIssue {
  code: "words-missing" | "words-count" | "words-text" | "keyword-missing" | "keyword-repeated" | "display-mismatch" | "anchor-range" | "target-missing" | "words-order";
  beatId?: string;
  message: string;
}

export interface Timeline {
  fps: number;
  durationMs: number;
  durationF: number;
  timingSource: string;
  beats: TimelineBeat[];
  words: TimelineWord[];
  displayPhrases: DisplayPhrase[];
  events: TimelineEvent[];
  camera0: CamState;
  cameraSegments: CameraSegment[];
  hardCuts: number[];
  blurWindows: BlurWindow[];
  coverF: number;
  issues: TimelineIssue[];
}

// ── small pure helpers ─────────────────────────────────────────────────────────────────────────────────────────

export const msToFrame = (ms: number, fps = FPS) => Math.round((ms * fps) / 1000);
export const frameToMs = (f: number, fps = FPS) => (f * 1000) / fps;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Phrase → caption tokens (whitespace split; punctuation stays attached, like v1 reconcileWords). */
export function tokenize(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/** Comparison form of a token: lower case, outer punctuation stripped ("SIGKILL." → "sigkill", "137," → "137"). */
export function normToken(t: string): string {
  return t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Start indices of `needle` (normalised token sequence) in `hay`. */
export function findSeq(hay: string[], needle: string[]): number[] {
  const h = hay.map(normToken);
  const n = needle.map(normToken).filter(Boolean);
  const out: number[] = [];
  if (!n.length) return out;
  for (let i = 0; i + n.length <= h.length; i++) if (n.every((t, j) => h[i + j] === t)) out.push(i);
  return out;
}

// Cubic bezier easing (same curve family as remotion's Easing.bezier): x(t)=input → solve t, return y(t).
const bezierCache = new Map<string, (x: number) => number>();
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const key = `${x1},${y1},${x2},${y2}`;
  const hit = bezierCache.get(key);
  if (hit) return hit;
  const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
  const B = (a1: number, a2: number) => 3 * a2 - 6 * a1;
  const Cc = (a1: number) => 3 * a1;
  const calc = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + Cc(a1)) * t;
  const slope = (t: number, a1: number, a2: number) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + Cc(a1);
  const fn = (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (x1 === y1 && x2 === y2) return x;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (calc(t, x1, x2) - x) / s;
    }
    if (t < 0 || t > 1 || Math.abs(calc(t, x1, x2) - x) > 1e-7) {
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 60; i++) {
        const v = calc(t, x1, x2);
        if (Math.abs(v - x) < 1e-9) break;
        if (v < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return calc(t, y1, y2);
  };
  bezierCache.set(key, fn);
  return fn;
}
export const easeFn = (e: EaseName) => {
  const [a, b, c, d] = EASE_BEZIER[e];
  return bezier(a, b, c, d);
};

// ── display split ──────────────────────────────────────────────────────────────────────────────────────────────

const CLAUSE_END = /[,;:.?!—…]$/;
/** Words a display chunk must not end on (auxiliaries, relatives, articles, prepositions): the split moves one word on. */
const WEAK_END = /^(?:is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|should|may|might|must|that|which|who|the|a|an|of|to|in|on|at|for|with)$/i;

function fitsLine(tokens: string[]): boolean {
  return tokens.length <= MAX_DISPLAY_WORDS && subtitleWidthPx(tokens.join(" ")) <= DISPLAY_MAX_PX;
}

/**
 * Auto caption split (R1/PROOF: ≤5 words, one line). Clause punctuation first, then balanced chunks; never splits
 * inside the keyword span [kwStart, kwEnd); a lone word is merged into a neighbour when the result still fits.
 * Returns token-count sizes.
 */
export function splitDisplay(tokens: string[], kwStart = -1, kwLen = 0): number[] {
  const n = tokens.length;
  if (!n) return [];
  const noBreakAfter = (i: number) => kwStart >= 0 && i >= kwStart && i < kwStart + kwLen - 1;
  // 1. clauses
  const clauses: [number, number][] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if ((CLAUSE_END.test(tokens[i]) && !noBreakAfter(i)) || i === n - 1) {
      clauses.push([s, i + 1]);
      s = i + 1;
    }
  }
  // 2. chunk clauses that do not fit
  const chunks: [number, number][] = [];
  for (const [a, b] of clauses) {
    if (fitsLine(tokens.slice(a, b))) {
      chunks.push([a, b]);
      continue;
    }
    let k = Math.ceil((b - a) / MAX_DISPLAY_WORDS);
    for (; k <= b - a; k++) {
      const parts: [number, number][] = [];
      let p = a;
      for (let j = 0; j < k; j++) {
        let size = Math.ceil((b - p) / (k - j));
        while (size > 1 && noBreakAfter(p + size - 1)) size++;
        // never end a chunk on a function word ("Nothing that was / saved was lost." → "Nothing that was saved / was lost.")
        if (size < b - p && WEAK_END.test(tokens[p + size - 1].replace(/[^a-z']/gi, "")) && fitsLine(tokens.slice(p, p + size + 1))) size++;
        const q = Math.min(b, p + size);
        parts.push([p, q]);
        p = q;
        if (p >= b) break;
      }
      if (parts.every(([x, y]) => fitsLine(tokens.slice(x, y)) || y - x === 1)) {
        chunks.push(...parts);
        break;
      }
    }
  }
  // 3. merge lone words into a neighbour (prefer the previous chunk) when it still fits
  const merged: [number, number][] = [];
  for (const c of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && (c[1] - c[0] === 1 || prev[1] - prev[0] === 1) && fitsLine(tokens.slice(prev[0], c[1]))) prev[1] = c[1];
    else merged.push([c[0], c[1]]);
  }
  return merged.map(([a, b]) => b - a);
}

// ── geometry ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Node box relative to its parent origin. MUST stay rule-for-rule identical to components-meta/Figure.ts
 * figureNodeBox (what the Figure Render draws its viewBox from); the two cannot share code (meta files may only import
 * zod, and this file's runtime imports would break Remotion's webpack), so test/v2-components-c.test.ts asserts they
 * agree on every node kind, including rects with a corner radius and missing w/h.
 */
export function figNodeBox(n: FigNodeT): Box | null {
  const g = n.geom;
  const pts: [number, number][] = [];
  if (n.kind === "rect") {
    // a rect's r is its corner radius: always boxed by x,y,w,h (missing w/h = 0, like the Render)
    pts.push([g.x, g.y], [g.x + (g.w ?? 0), g.y + (g.h ?? 0)]);
  } else if (n.kind === "group") {
    // children are relative to the group origin
    for (const c of n.children ?? []) {
      const b = figNodeBox(c);
      if (b) pts.push([g.x + b.x, g.y + b.y], [g.x + b.x + b.w, g.y + b.y + b.h]);
    }
  } else if (g.points?.length) {
    for (const p of g.points) pts.push([p[0], p[1]]);
  } else if (g.d) {
    const nums = (g.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  } else if (g.r !== undefined) {
    // circle / arc
    pts.push([g.x - g.r, g.y - g.r], [g.x + g.r, g.y + g.r]);
  } else {
    // per-char advance = components-meta/Figure.ts FIGURE.charW (mono ceil 0.6 em, sans ceil 0.68 em; default mono)
    const adv = g.font === "sans" ? { label: 18, body: 22, title: 30 } : { label: 16, body: 20, title: 27 };
    const w = g.w ?? (g.text ? g.text.length * adv[g.size ?? "label"] : 0);
    const h = g.h ?? (g.text ? (g.size === "title" ? 52 : g.size === "body" ? 40 : 32) : 0);
    pts.push([g.x, g.y], [g.x + w, g.y + h]);
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Bounding box of a Figure's nodes, relative to the instance origin. */
export function figureBox(nodes: readonly FigNodeT[] | undefined): Box | null {
  const boxes = (nodes ?? []).map(figNodeBox).filter((b): b is Box => !!b);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** World-space box of an instance (scale applied), or null when its footprint is unknown. */
export function instanceBox(inst: Pick<InstanceT, "component" | "x" | "y" | "w" | "scale" | "figure"> & { props?: Record<string, unknown> }, lib: FootprintLookup): Box | null {
  const s = inst.scale ?? 1;
  if (inst.component === "Figure") {
    const b = figureBox(inst.figure);
    return b ? { x: inst.x + b.x * s, y: inst.y + b.y * s, w: b.w * s, h: b.h * s } : null;
  }
  const entry = lib[inst.component];
  const sized = entry?.sizeFor && inst.props ? entry.sizeFor(inst.props, inst.w) : null;
  if (sized) return { x: inst.x, y: inst.y, w: sized.w * s, h: sized.h * s };
  const fp = entry?.footprint;
  if (!fp) return null;
  const w = inst.w ?? fp.w;
  const h = inst.w !== undefined ? (fp.h * inst.w) / fp.w : fp.h;
  return { x: inst.x, y: inst.y, w: w * s, h: h * s };
}

/** World box → screen box under camera state c (transform-origin top-left, target at CAM_ANCHOR). */
export function toScreen(b: Box, c: CamState): Box {
  return { x: (b.x - c.x) * c.zoom + CAM_ANCHOR.x, y: (b.y - c.y) * c.zoom + CAM_ANCHOR.y, w: b.w * c.zoom, h: b.h * c.zoom };
}

// ── resolveTimeline ────────────────────────────────────────────────────────────────────────────────────────────

const beatKey = (id: number | string) => (typeof id === "number" ? `b${String(id).padStart(2, "0")}` : id);

/** Resolve an anchor inside a beat to an absolute frame (clamped ≥ 0). */
export function resolveAt(beat: TimelineBeat, at: AtT, issues?: TimelineIssue[]): number {
  const ref = (r: "keyword" | "phraseStart" | "phraseEnd") => (r === "keyword" ? beat.keywordF : r === "phraseStart" ? beat.firstWordF : beat.lastWordEndF);
  if (typeof at === "string") return ref(at);
  if ("word" in at) {
    const w = beat.words[at.word];
    if (!w) {
      issues?.push({ code: "anchor-range", beatId: beat.id, message: `${beat.id}: anchor {word:${at.word}} out of range (beat has ${beat.words.length} words)` });
      return beat.lastWordEndF;
    }
    return w.startF;
  }
  return Math.max(0, ref(at.ref) + at.offsetF);
}

function targetPoint(t: CameraTargetT, sb: Storyboard, lib: FootprintLookup, issues: TimelineIssue[], beatId?: string): { x: number; y: number } {
  if ("station" in t) {
    const s = sb.stations.find((x) => x.id === t.station);
    if (s) return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    issues.push({ code: "target-missing", beatId, message: `camera target station "${t.station}" not found` });
  } else if ("instance" in t) {
    const inst = sb.world.find((x) => x.id === t.instance);
    if (inst) {
      const b = instanceBox(inst, lib);
      return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: inst.x, y: inst.y };
    }
    issues.push({ code: "target-missing", beatId, message: `camera target instance "${t.instance}" not found` });
  } else return { x: t.x, y: t.y };
  return { x: CAM_ANCHOR.x, y: CAM_ANCHOR.y };
}

function estimateWords(tokens: string[]): { durationSec: number; words: { text: string; startMs: number; endMs: number }[] } {
  const chars = tokens.map((t) => Math.max(2, normToken(t).length));
  const total = chars.reduce((a, b) => a + b, 0);
  const speechMs = (tokens.length / ESTIMATE_WPS) * 1000;
  let t = 50;
  const words = tokens.map((text, i) => {
    const d = (speechMs * chars[i]) / total;
    const w = { text, startMs: Math.round(t), endMs: Math.round(t + d * 0.85) };
    t += d;
    return w;
  });
  return { durationSec: (t + 100) / 1000, words };
}

/** Stamp shake x offsets (screen px) per frame from the key's start frame. */
const SHAKE_X = [6, -6, 4, 0] as const;

/** Camera state at `frame` (moves eased, zoom log-interpolated, +2 % drift over holds, shake). Lint == render. */
export function cameraAt(tl: Pick<Timeline, "camera0" | "cameraSegments" | "durationF">, frame: number, opts: { shake?: boolean } = {}): CamState & { moving: boolean } {
  const segs = tl.cameraSegments;
  let i = -1;
  while (i + 1 < segs.length && segs[i + 1].startF <= frame) i++;
  const holdFrom = (state: CamState, holdStart: number, holdEnd: number): CamState => {
    const d = HOLD_DRIFT * clamp((frame - holdStart) / Math.max(1, holdEnd - holdStart), 0, 1);
    return { ...state, zoom: state.zoom * (1 + d) };
  };
  const nextStart = (j: number) => (j + 1 < segs.length ? segs[j + 1].startF : Math.max(tl.durationF, frame + 1));
  let st: CamState;
  let moving = false;
  if (i < 0) st = holdFrom(tl.camera0, 0, nextStart(-1));
  else {
    const s = segs[i];
    if (s.transition === "move" && frame < s.endF) {
      const t = easeFn(s.ease)((frame - s.startF) / s.durF);
      const zoom = Math.exp(Math.log(s.from.zoom) + (Math.log(s.to.zoom) - Math.log(s.from.zoom)) * t);
      st = { x: s.from.x + (s.to.x - s.from.x) * t, y: s.from.y + (s.to.y - s.from.y) * t, zoom, tiltX: s.from.tiltX + (s.to.tiltX - s.from.tiltX) * t };
      moving = true;
    } else st = holdFrom(s.to, s.endF, nextStart(i));
  }
  // Bible §6.11 Stamp shake: 3 frames, ±6 px, from the key's start frame. A discrete per-frame step (amendments:
  // discrete values use Math.floor(frame)), so motion-blur sub-samples at fractional frames see the same offset.
  if (opts.shake !== false) {
    for (const s of segs) {
      if (!s.shake) continue;
      const k = Math.floor(frame) - s.startF;
      if (k >= 0 && k < SHAKE_X.length) st = { ...st, x: st.x + SHAKE_X[k] / st.zoom };
    }
  }
  return { ...st, moving };
}

/**
 * Largest screen displacement (px) of any visible stage point between camera states a and b. A world point shown at
 * screen offset p from the anchor under a moves by p·(z_b/z_a − 1) − Δc·z_b; that is linear in p, so its maximum
 * over the stage rectangle sits at a corner. Plus a tilt term (far edge lever).
 */
export function cameraDisplacementPx(a: CamState, b: CamState): number {
  const r = b.zoom / a.zoom;
  const tx = (b.x - a.x) * b.zoom;
  const ty = (b.y - a.y) * b.zoom;
  let m = 0;
  for (const [px, py] of STAGE_CORNERS) m = Math.max(m, Math.hypot(px * (r - 1) - tx, py * (r - 1) - ty));
  return m + (Math.abs(b.tiltX - a.tiltX) * Math.PI * TILT_LEVER_PX) / 180;
}

/** Camera screen speed (px/f) between frame f and f+1: the fastest visible stage point (L9 peak, blur). */
export function screenSpeed(tl: Pick<Timeline, "camera0" | "cameraSegments" | "durationF" | "hardCuts">, f: number): number {
  if (tl.hardCuts.includes(f + 1)) return 0; // the jump into a hard cut is not motion
  // The Stamp shake is a deliberate discrete jolt, not camera motion: it never opens a blur window.
  return cameraDisplacementPx(cameraAt(tl, f, { shake: false }), cameraAt(tl, f + 1, { shake: false }));
}

export function blurSamplesForSpeed(v: number, blur: Pick<Storyboard["blur"], "minSamples" | "maxSamples" | "shutterAngle">): number {
  if (!(v >= BLUR_MIN_SPEED)) return 0;
  const cap = Math.min(blur.maxSamples, BLUR_MAX_SAMPLES);
  return clamp(Math.ceil((v * (blur.shutterAngle / 360)) / BLUR_PX_PER_SAMPLE), Math.min(blur.minSamples, cap), cap);
}

// Entrance spring, bit-identical to remotion spring() at integer frames for the (critically/over-damped) enter
// config: remotion advances frame by frame with the critically damped closed form whenever ζ ≥ 1.
const enterTable: number[] = [];
/** remotion spring({ frame: k, fps: FPS, config: ENTER_SPRING }) for integer k ≥ 0 (pure, no remotion import). */
export function enterSpring(k: number, fps = FPS): number {
  if (k <= 0) return 0;
  if (fps !== FPS) throw new Error("enterSpring: table is built for FPS");
  const n = Math.floor(k);
  if (!enterTable.length) {
    const { damping: c, stiffness: kk, mass: m } = ENTER_SPRING;
    const w0 = Math.sqrt(kk / m);
    let cur = 0;
    let vel = 0;
    let last = 0;
    for (let f = 0; f <= 90; f++) {
      const now = (f / fps) * 1000;
      const t = Math.min(now - last, 64) / 1000;
      const x0 = 1 - cur;
      const v0 = -vel;
      const env = Math.exp(-w0 * t);
      if (c / (2 * Math.sqrt(kk * m)) < 1) throw new Error("enterSpring: under-damped config not supported");
      cur = 1 - env * (x0 + (v0 + w0 * x0) * t);
      vel = env * (v0 * (t * w0 - 1) + t * x0 * w0 * w0);
      last = now;
      enterTable.push(cur);
    }
  }
  return n < enterTable.length ? enterTable[n] : 1;
}

/** World px an entering element's farthest point moves from entrance frame k to k+1 (y rise + scale about its centre). */
export function enterStepPx(k: number, box: { w: number; h: number } | null, scale = 1): number {
  if (k < 0) return 0;
  const de = enterSpring(k + 1) - enterSpring(k);
  const half = box ? Math.hypot(box.w, box.h) / 2 : 0; // box already includes the instance scale
  return de * (ENTER_Y_PX * scale + (1 - ENTER_SCALE) * half);
}

/** Blur samples for one frame (0 = no blur). */
export function samplesAt(tl: Pick<Timeline, "blurWindows">, frame: number): number {
  for (const w of tl.blurWindows) if (frame >= w.startF && frame < w.endF) return w.samples[frame - w.startF];
  return 0;
}

/** Flights up to this long are one eased hop (bible ease over durF, e.g. RequestPill); longer ones count as constant peak. */
export const FLIGHT_EASED_MAX_F = 30;

/**
 * World px/f of a STATIC declared flight (meta.flight) at frame k after its anchor — used when the component has no
 * props-aware meta.flightFor (or its props are invalid). A single hop (durF ≤ FLIGHT_EASED_MAX_F) follows the bible
 * ease, so its speed is peak × Δease(k)/max Δease (meta.peakPxPerF is the hop's peak); a longer flight is taken at its
 * peak on every frame (an upper bound).
 */
export function flightSpeed(fl: { durF: number; peakPxPerF: number }, k: number): number {
  if (k < 0 || k >= fl.durF) return 0;
  if (fl.durF > FLIGHT_EASED_MAX_F) return fl.peakPxPerF;
  const e = easeFn("bible");
  let max = 0;
  for (let j = 0; j < fl.durF; j++) max = Math.max(max, e((j + 1) / fl.durF) - e(j / fl.durF));
  return (fl.peakPxPerF * (e((k + 1) / fl.durF) - e(k / fl.durF))) / max;
}

/**
 * Own world speeds (px/f, instance scale applied, camera zoom NOT applied) of one flight-verb action, index k = the
 * action frame + k. Props-aware when the lookup entry has `flightFor` (W2.1: NodeGraph `mark` = the real packet route,
 * hopFrames per hop, eased per hop; no packet in force → [] = no flight); otherwise the static meta.flight profile.
 * Shared by the blur windows (elementSpeeds) and L21, so both see the same flight.
 */
export function actionFlight(inst: Pick<InstanceT, "component" | "w" | "scale"> & { props?: Record<string, unknown> }, lib: FootprintLookup, events: readonly FlightAction[], at: FlightAction): number[] {
  return actionFlightProfile(inst, lib, events, at).speeds;
}

/**
 * actionFlight + the sub-sample spacing the flight is blurred at. Always BLUR_PX_PER_SAMPLE (ADR-001 §7 W2 binding:
 * 1 px, cap 32, the fastest flying element included): the W2.1 round-1 per-flight `samplePx` (3 px for the NodeGraph
 * packet) was never approved and is gone (review W2.1 r1); a FlightForFn's samplePx is ignored.
 */
export function actionFlightProfile(inst: Pick<InstanceT, "component" | "w" | "scale"> & { props?: Record<string, unknown> }, lib: FootprintLookup, events: readonly FlightAction[], at: FlightAction): { speeds: number[]; samplePx: number } {
  const entry = lib[inst.component] as (FootprintLookup[string] & { flight?: { verbs: readonly string[]; durF: number; peakPxPerF: number } | null }) | undefined;
  const fl = entry?.flight;
  if (!fl || !fl.verbs.includes(at.do)) return { speeds: [], samplePx: BLUR_PX_PER_SAMPLE };
  const s = inst.scale ?? 1;
  const own = entry?.flightFor ? entry.flightFor(inst.props ?? {}, inst.w, events, at) : null;
  if (own) return { speeds: own.speeds.map((v) => v * s), samplePx: BLUR_PX_PER_SAMPLE };
  return { speeds: Array.from({ length: fl.durF }, (_, k) => flightSpeed(fl, k) * s), samplePx: BLUR_PX_PER_SAMPLE };
}

/** Every instance's actions in frame order (stable: same-frame actions keep storyboard order), as components see them. */
export function actionsByInstance(events: readonly TimelineEvent[]): Map<string, FlightAction[]> {
  const out = new Map<string, FlightAction[]>();
  for (const e of [...events].sort((a, b) => a.frame - b.frame)) {
    if (e.kind !== "action") continue;
    if (!out.has(e.target)) out.set(e.target, []);
    out.get(e.target)!.push({ f: e.frame, do: e.do, state: e.state, props: e.props });
  }
  return out;
}

/** Per-frame element speeds (screen px/f, f → f+1): flights and on-screen entrances, scaled by the camera zoom. */
function elementSpeeds(sb: Storyboard, lib: FootprintLookup, events: readonly TimelineEvent[], cam: Pick<Timeline, "camera0" | "cameraSegments" | "durationF">, durationF: number): { flight: number[]; enter: number[] } {
  const flight = new Array<number>(durationF).fill(0);
  const enter = new Array<number>(durationF).fill(0);
  const inst = new Map(sb.world.map((i) => [i.id, i]));
  const byInst = actionsByInstance(events);
  const entered = new Set<string>();
  for (const e of [...events].sort((a, b) => a.frame - b.frame)) {
    if (e.kind !== "action") continue;
    const i = inst.get(e.target);
    if (!i) continue;
    const fl = (lib[i.component] as { flight?: { verbs: readonly string[]; durF: number; peakPxPerF: number } | null } | undefined)?.flight;
    if (fl && fl.verbs.includes(e.do)) {
      const v = actionFlight(i, lib, byInst.get(i.id) ?? [], { f: e.frame, do: e.do, state: e.state, props: e.props });
      for (let k = 0; k < v.length; k++) {
        const f = e.frame + k;
        if (f >= 0 && f < durationF) flight[f] = Math.max(flight[f], v[k] * cameraAt(cam, f).zoom);
      }
      if (e.do === "enter") entered.add(i.id);
      continue;
    }
    if (e.do !== "enter" || entered.has(i.id)) continue;
    entered.add(i.id);
    const box = instanceBox(i, lib);
    for (let k = 0; k < 24; k++) {
      const f = e.frame + k;
      if (f < 0 || f >= durationF) continue;
      const c = cameraAt(cam, f);
      if (box) {
        const sbx = toScreen(box, c);
        if (sbx.x > WIDTH || sbx.x + sbx.w < 0 || sbx.y > HEIGHT || sbx.y + sbx.h < 0) continue; // off screen
      }
      enter[f] = Math.max(enter[f], enterStepPx(k, box, i.scale ?? 1) * c.zoom);
    }
  }
  return { flight, enter };
}

/**
 * The single timing resolver. `words` = words.json (v1 TTS format); beats without an entry are estimated at
 * ESTIMATE_WPS (pre-TTS lint). `lib` = the component registry (footprints for instance camera targets).
 * Never throws on content problems: they are returned in `issues` for the linter.
 */
export function resolveTimeline(sb: Storyboard, words: WordsFileT | null | undefined, lib: FootprintLookup, fps = FPS): Timeline {
  const issues: TimelineIssue[] = [];
  const byId = new Map<string, WordsFileT["beats"][number]>();
  (words?.beats ?? []).forEach((b) => byId.set(beatKey(b.beatId), b));

  const beats: TimelineBeat[] = [];
  const allWords: TimelineWord[] = [];
  const display: DisplayPhrase[] = [];
  // v3 (W2, ADR-002 §7): optional board `leadMs` and per-beat `pauseAfterMs` are AUDIBLE silences (the narrative's
  // numbers, copied 1:1): first audible sample at leadMs, last audible sample of a beat → first audible sample of the
  // next = pauseAfterMs. The words.json beat's optional `leadPadMs`/`tailPadMs` (below-threshold audio kept at the
  // clip edges, src/v3/tts.ts) are subtracted to get the file placement, exactly as tts.ts assembles narration.wav.
  // Absent on v2 boards → start 0, GAP_MS file gaps, no pad subtraction (v2 unchanged).
  const v3ms = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : dflt);
  const v3pad = (bi: number, k: "leadPadMs" | "tailPadMs"): number => { const w = sb.beats[bi] && byId.get(sb.beats[bi].id); return v3ms(w && (w as Record<string, unknown>)[k], 0); };
  const v3lead = v3ms((sb as { leadMs?: unknown }).leadMs, -1);
  let cursor = v3lead < 0 ? 0 : Math.max(0, v3lead - v3pad(0, "leadPadMs"));

  sb.beats.forEach((b, bi) => {
    const tokens = tokenize(b.phrase);
    let src = byId.get(b.id);
    let estimated = false;
    if (!src) {
      if (words) issues.push({ code: "words-missing", beatId: b.id, message: `${b.id}: no words.json entry — timings estimated at ${ESTIMATE_WPS} w/s` });
      const e = estimateWords(tokens);
      src = { beatId: b.id, durationSec: e.durationSec, words: e.words };
      estimated = true;
    }
    const tts = src.words;
    if (tts.length !== tokens.length) issues.push({ code: "words-count", beatId: b.id, message: `${b.id}: phrase has ${tokens.length} tokens, TTS has ${tts.length} words` });
    else {
      const bad = tokens.findIndex((t, i) => t !== tts[i].text);
      if (bad >= 0) issues.push({ code: "words-text", beatId: b.id, message: `${b.id}: token ${bad} "${tokens[bad]}" ≠ TTS "${tts[bad].text}"` });
    }
    const audioStartMs = cursor;
    const durationMs = src.durationSec * 1000;
    const kwToks = tokenize(b.keyword);
    const kwHits = findSeq(tokens, kwToks);
    if (!kwHits.length) issues.push({ code: "keyword-missing", beatId: b.id, message: `${b.id}: keyword "${b.keyword}" not in phrase` });
    else if (kwHits.length > 1) issues.push({ code: "keyword-repeated", beatId: b.id, message: `${b.id}: keyword "${b.keyword}" appears ${kwHits.length}×` });
    const kwStart = kwHits[0] ?? Math.floor(tokens.length / 2);
    const kwLen = kwHits.length ? kwToks.length : 0;

    const g0 = allWords.length;
    const bw: TimelineWord[] = tokens.map((text, i) => {
      // Missing TTS words (count mismatch) borrow the last known time so frames stay monotonic.
      const t = tts[Math.min(i, tts.length - 1)] ?? { startMs: 0, endMs: 0 };
      const startMs = audioStartMs + t.startMs;
      const endMs = audioStartMs + Math.max(t.startMs, t.endMs);
      return { text, beatIndex: bi, index: i, globalIndex: g0 + i, startMs, endMs, startF: msToFrame(startMs, fps), endF: msToFrame(endMs, fps), isKeyword: kwLen > 0 && i >= kwStart && i < kwStart + kwLen };
    });
    for (let i = 1; i < bw.length; i++) if (bw[i].startMs < bw[i - 1].startMs) issues.push({ code: "words-order", beatId: b.id, message: `${b.id}: word ${i} starts before word ${i - 1}` });
    allWords.push(...bw);

    // display phrases
    let sizes: number[];
    if (b.display) {
      const dt = b.display.flatMap(tokenize);
      if (dt.length === tokens.length && dt.every((t, i) => t === tokens[i])) sizes = b.display.map((d) => tokenize(d).length);
      else {
        issues.push({ code: "display-mismatch", beatId: b.id, message: `${b.id}: display splits do not join to the phrase` });
        sizes = splitDisplay(tokens, kwStart, kwLen);
      }
    } else sizes = splitDisplay(tokens, kwStart, kwLen);
    const ids: string[] = [];
    let p = 0;
    sizes.forEach((n, k) => {
      const ws = bw.slice(p, p + n);
      const text = ws.map((w) => w.text).join(" ");
      const kw = kwLen && kwStart >= p && kwStart < p + n ? g0 + kwStart : null;
      const id = `${b.id}.${k}`;
      ids.push(id);
      display.push({ id, beatId: b.id, beatIndex: bi, text, firstWord: g0 + p, lastWord: g0 + p + n - 1, wordCount: n, startF: ws[0].startF, endF: ws[n - 1].endF, showF: 0, hideF: 0, keywordWord: kw, keywordColor: b.keywordColor, widthPx: Math.round(subtitleWidthPx(text)) });
      p += n;
    });

    beats.push({
      id: b.id,
      index: bi,
      part: b.part,
      audioStartMs,
      audioEndMs: audioStartMs + durationMs,
      durationMs,
      startF: msToFrame(audioStartMs, fps),
      endF: 0,
      firstWordF: bw[0]?.startF ?? msToFrame(audioStartMs, fps),
      lastWordEndF: bw[bw.length - 1]?.endF ?? msToFrame(audioStartMs + durationMs, fps),
      keywordF: bw[kwStart]?.startF ?? msToFrame(audioStartMs, fps),
      keywordWord: g0 + kwStart,
      keywordColor: b.keywordColor,
      keywordCount: kwHits.length,
      words: bw,
      displayPhraseIds: ids,
      estimated,
    });
    const v3pause = v3ms((b as { pauseAfterMs?: unknown }).pauseAfterMs, -1);
    cursor = audioStartMs + durationMs + (v3pause < 0 ? GAP_MS : Math.max(0, v3pause - v3pad(bi, "tailPadMs") - v3pad(bi + 1, "leadPadMs")));
  });

  const lastEnd = beats.length ? beats[beats.length - 1].audioEndMs : 0;
  const durationMs = lastEnd + TAIL_MS;
  const durationF = Math.ceil((durationMs * fps) / 1000);
  beats.forEach((b, i) => (b.endF = i + 1 < beats.length ? beats[i + 1].startF : durationF));

  // subtitle show/hide: swap SWAP_LEAD_F before the onset, never before the previous swap; first phrase from frame 0.
  display.forEach((d, i) => {
    d.showF = i === 0 ? 0 : Math.max(display[i - 1].showF + 1, d.startF - SWAP_LEAD_F);
  });
  display.forEach((d, i) => (d.hideF = i + 1 < display.length ? display[i + 1].showF : durationF));

  // events
  const events: TimelineEvent[] = [];
  const keys: { beat: TimelineBeat; index: number; key: BeatT["camera"][number]; frame: number }[] = [];
  sb.beats.forEach((b, bi) => {
    const tb = beats[bi];
    events.push({ kind: "keyword", frame: tb.keywordF, beatId: b.id, beatIndex: bi, color: b.keywordColor });
    b.actions.forEach((a, index) => events.push({ kind: "action", frame: resolveAt(tb, a.at, issues), beatId: b.id, beatIndex: bi, index, target: a.target, do: a.do, state: a.state, props: a.props }));
    b.sfx.forEach((s, index) => {
      const frame = resolveAt(tb, s.at, issues);
      events.push({ kind: "sfx", frame, ms: frameToMs(frame, fps), beatId: b.id, beatIndex: bi, index, type: s.type, gainDb: s.gainDb });
    });
    if (b.header) events.push({ kind: "header", frame: resolveAt(tb, b.header.at, issues), beatId: b.id, beatIndex: bi, right: b.header.right, dot: b.header.dot });
    b.camera.forEach((key, index) => keys.push({ beat: tb, index, key, frame: resolveAt(tb, key.at, issues) }));
  });

  // camera
  const c0 = sb.camera0 ? { ...targetPoint(sb.camera0.target, sb, lib, issues), zoom: sb.camera0.zoom, tiltX: sb.camera0.tiltX ?? 0 } : { ...targetPoint({ station: sb.stations[0].id }, sb, lib, issues), zoom: 1, tiltX: 0 };
  keys.sort((a, b) => a.frame - b.frame || a.beat.index - b.beat.index || a.index - b.index);
  const segs: CameraSegment[] = [];
  let prevTo: CamState = c0;
  let prevEnd = 0;
  for (const k of keys) {
    const to: CamState = { ...targetPoint(k.key.target, sb, lib, issues, k.beat.id), zoom: k.key.zoom, tiltX: k.key.tiltX };
    const hard = k.key.transition === "hardCut";
    const durF = hard ? 0 : (k.key.durF ?? DEFAULT_MOVE_F[k.key.ease]);
    // the move starts from where the previous hold has drifted to
    const holdLen = Math.max(1, k.frame - prevEnd);
    const drift = HOLD_DRIFT * clamp((k.frame - prevEnd) / holdLen, 0, 1);
    const from: CamState = { ...prevTo, zoom: prevTo.zoom * (1 + drift) };
    segs.push({
      beatId: k.beat.id,
      beatIndex: k.beat.index,
      keyIndex: k.index,
      transition: hard ? "hardCut" : "move",
      ease: k.key.ease,
      startF: k.frame,
      endF: k.frame + durF,
      durF,
      from,
      to,
      shake: k.key.shake,
      panPx: Math.hypot(to.x - from.x, to.y - from.y) * from.zoom,
      peakPxPerF: 0,
    });
    events.push({ kind: "camera", frame: k.frame, beatId: k.beat.id, beatIndex: k.beat.index, index: k.index, transition: hard ? "hardCut" : "move", endF: k.frame + durF, shake: k.key.shake });
    prevTo = to;
    prevEnd = k.frame + durF;
  }
  const hardCuts = segs.filter((s) => s.transition === "hardCut").map((s) => s.startF);

  const partial = { camera0: c0, cameraSegments: segs, durationF, hardCuts };
  // per-frame camera speed → peak per move (L9)
  const speed: number[] = [];
  for (let f = 0; f < durationF; f++) speed.push(screenSpeed(partial, f));
  for (const s of segs) if (s.transition === "move") for (let f = s.startF; f < s.endF && f < durationF; f++) s.peakPxPerF = Math.max(s.peakPxPerF, speed[f] ?? 0);
  // element motion (screen px/f): flights (component meta `flight`) open blur windows on their own; entrances (spring
  // y 24 px + scale 0.97) only add to the sample count of a frame the camera already blurs.
  const { flight, enter } = elementSpeeds(sb, lib, events, partial, durationF);
  const blurWindows: BlurWindow[] = [];
  let cur: BlurWindow | null = null;
  for (let f = 0; f < durationF; f++) {
    const opens = speed[f] >= BLUR_MIN_SPEED || flight[f] >= BLUR_MIN_SPEED;
    const v = speed[f] + Math.max(flight[f], enter[f]);
    const n = opens ? blurSamplesForSpeed(v, sb.blur) : 0;
    if (n > 0) {
      if (!cur) {
        cur = { startF: f, endF: f + 1, peakPxPerF: v, samples: [n] };
        blurWindows.push(cur);
      } else {
        cur.endF = f + 1;
        cur.samples.push(n);
        cur.peakPxPerF = Math.max(cur.peakPxPerF, v);
      }
    } else cur = null;
  }

  // cover: explicit, else the climax keyword + 12 f, else the last beat's keyword
  let coverF: number;
  if (sb.cover) {
    const cb = beats.find((b) => b.id === sb.cover!.beat);
    coverF = cb ? resolveAt(cb, sb.cover.at, issues) : 0;
  } else {
    const climax = beats.find((b) => b.part === "climax") ?? beats[beats.length - 1];
    coverF = Math.min(durationF - 1, climax.keywordF + 12);
  }

  events.sort((a, b) => a.frame - b.frame);
  // W7.1 CTA hero affordance: `state: "final"` → the instance's last live state + props (expandFinalStates)
  for (const inst of sb.world) {
    const entry = lib[inst.component];
    const own = events.filter((e): e is Extract<TimelineEvent, { kind: "action" }> => e.kind === "action" && e.target === inst.id);
    if (!entry?.states?.includes(FINAL_STATE) || !own.some((e) => e.do === "state" && e.state === FINAL_STATE)) continue;
    const ex = expandFinalStates(own.map((e) => ({ f: e.frame, do: e.do, state: e.state, props: e.props })), entry.states[0] ?? FINAL_STATE, inst.props ?? {}, entry.stateProps ?? []);
    own.forEach((e, i) => {
      if (e.state !== FINAL_STATE) return;
      e.state = ex[i].state;
      e.props = ex[i].props;
    });
  }
  return {
    fps,
    durationMs,
    durationF,
    timingSource: words?.timingSource ?? (words ? "unknown" : "estimated"),
    beats,
    words: allWords,
    displayPhrases: display,
    events,
    camera0: c0,
    cameraSegments: segs,
    hardCuts,
    blurWindows,
    coverF,
    issues,
  };
}

// ── W7.1 CTA hero affordance: the "final" state ──────────────────────────────────────────────────────────────────
//
// A `state` action with state "final" (declared by the W7 subjects: SensorGrid, SignalTrace, LayerStack) puts the
// instance back into its LAST LIVE state — the latest state that was not a rest state (idle / dim / final) — with the
// state-override props in force then (+ the action's own props on top). So the CTA can land "Follow" on the climax
// picture (the touched grid, the cancelled wave) instead of an empty dimmed subject. resolveTimeline rewrites the
// event (renderer, lints and digest all see the concrete state); the V2Gallery applies the same function.

export const FINAL_STATE = "final";
export const REST_STATES: readonly string[] = ["idle", "dim", FINAL_STATE];

/** Rewrite every `state: "final"` event (events in frame order) to the last live state + its state props; events
 *  without a final are returned unchanged. No live state yet → the initial state, props unchanged. Pure. */
export function expandFinalStates<E extends { f: number; do: string; state?: string; props?: Record<string, unknown> }>(events: readonly E[], initial: string, base: Record<string, unknown>, stateProps: readonly string[]): E[] {
  let cum: Record<string, unknown> = { ...base };
  let cur = initial;
  let live: { state: string; props: Record<string, unknown> } | null = REST_STATES.includes(cur) ? null : { state: cur, props: cum };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return events.map((e0) => {
    let e = e0;
    if (e.do === "state" && e.state === FINAL_STATE) {
      const back: Record<string, unknown> = {};
      if (live) for (const k of stateProps) if (k in live.props && !same(live.props[k], cum[k])) back[k] = live.props[k];
      const props = { ...back, ...(e.props ?? {}) };
      e = { ...e, state: live ? live.state : initial, props: Object.keys(props).length ? props : undefined };
    }
    if (e.props) cum = { ...cum, ...e.props };
    if (e.do === "state" && e.state) cur = e.state;
    if (!REST_STATES.includes(cur)) live = { state: cur, props: cum };
    return e;
  });
}

// ── W5.1 stage fill (supervised library release) ───────────────────────────────────────────────────────────────
//
// Owner decision 2026-10-26: "ONE large centred subject that fills the focal area and evolves" (ref3) is a LIBRARY
// job, not a director rule. fitWorld() runs two steps over the director's storyboard and camera:
//   1. NodeGraph drawn layout: every graph gets the largest node scale k (≤ its node-count cap: fewer nodes → bigger
//      nodes and labels) and, when it helps, the nodes' x / y range stretched across its whole canvas (props.layout,
//      NodeGraph meta graphMetrics). Callouts pinned on a node follow that node (meta relayout / anchor).
//   2. Local zoom: every focal SUBJECT (NodeGraph, ContainerBox, UnitGrid, Meter, Terminal; W7 + SignalTrace, LayerStack,
//      SensorGrid) that is, on ≥ 1 review
//      frame, the only focal element on screen is enlarged together with its SATELLITES (instances of its station
//      within FIT.gapPx of it that share its screen time: pills, callouts, legends, a status card) about the subject's
//      own centre, so the subject stays where the camera looks. Pill rows above / below it are re-centred on it (one
//      large centred list). The scale is the largest s ≤ the fill target (drawn width ≥ FIT.fillW screen px at the
//      subject's median zoom) and ≤ the cap.
// Every change is accepted only if, on EVERY review frame of the reel (keyword, keyword + 6, settled), every changed
// instance on screen still keeps the safe zone (x 64–1016, y 150–1560, text ≤ 960; focal ones clear of the header band
// and the caption card) and clears everything it did not already touch. Rules a board already breaks are left as they
// were (never made worse). Camera keys that target a moved instance are pinned to its ORIGINAL centre (fitStoryboard),
// so the camera path — and the frames checked — is the director's. Pure; the Explainer renders the fitted storyboard.

export const FIT = {
  /** W7.2 + StatusCard: a station of status cards and pills (a W7.1 hook) has no other subject, and a lone 576 px
   *  card at the top of an empty stage was the pilots' weakest frame; it grows like a subject, ≤ subjectCap. */
  subjects: ["NodeGraph", "ContainerBox", "UnitGrid", "Meter", "Terminal", "SignalTrace", "LayerStack", "SensorGrid", "StatusCard"],
  subjectCap: { StatusCard: 1.35 } as Readonly<Record<string, number>>,
  /** Target drawn width on screen (W7.1: 762 → 840 = the widest box that, centred on x 540, keeps text ≤ 960). */
  fillW: 840,
  /** W7.1 vertical centring: the group's screen centre is pulled to the middle of the free stage (between focalTop and
   *  captionTop = 809) when it sits further off than this (screen px). */
  centreMinPx: 24,
  /** W7.1: a satellite must share at least this many frames of screen time with its subject (an instance that only
   *  overlaps during the subject's 8 f exit fade — the next station's hero — is not dragged along). */
  shareMinF: 12,
  /** Local-zoom caps: NodeGraph by node count, everything else one cap. */
  graphCap: [
    [3, 1.5],
    [5, 1.35],
    [8, 1.25],
  ] as readonly (readonly [number, number])[],
  cap: 1.5,
  /** Satellite own-scale caps (position always follows the local zoom): big type stays near its designed size. */
  satelliteCap: { KineticWord: 1, HeroStat: 1.15, StatusCard: 1.25, Timeline: 1.15, SourceTag: 1.25, VersionPills: 1.25 } as Readonly<Record<string, number>>,
  gapPx: 120,
  step: 0.02,
  /** Below this gain the local zoom is skipped. */
  minGain: 1.04,
  /** NodeGraph layout step: k candidates from the meta's node-count cap down in these steps. */
  kStep: 0.04,
  /** Max k the layout step asks for (= NodeGraphProps.layout.k max). */
  kMax: 1.6,
  /** Canvas-stretch amounts the layout step tries (1 = the nodes' range over the whole canvas). */
  spreads: [1, 0.75, 0.5, 0.25],
  /** A Callout dot within this many px of a node (beyond the node's spec half size) follows that node. */
  pinPx: 40,
  /** Vertical slides of a zoomed group the zoom step may use (world px, tried in this order at every scale). */
  shifts: [0, 40, -40, 80, -80, 120, -120, 160, -160],
  /** Pill rows: same y within this many px (and co-visible) = one row, re-centred as a unit. */
  rowTolPx: 8,
  pills: ["SourceTag", "VersionPills"],
  /** Min screen gap to anything a changed instance did not already touch. */
  clearPx: 8,
  /** captionTop = lints FOCAL_BOTTOM (1400, the caption-safe line L23 blocks below; W5.1 FR1: was the card top 1406, so a
   *  fit ending at 1400–1406 created an L23 block the director never wrote). test/v2-timeline-w51 pins the equality. */
  safe: { left: 64, right: 1016, top: 150, bottom: 1560, textRight: 960, focalTop: 218, captionTop: 1400 },
  /** Subtitle card (= lints CAPTION / captionCardBox, remotion SubtitleCard): left 64, bottom 1520, ≤ 886 wide, 114 tall;
   *  width = text + 2×36 padding + 2 px borders + 6 px slack. Checked for every instance (focal or not). */
  caption: { left: 64, bottom: 1520, maxW: 886, extraW: 2 * 36 + 2 + 6, h: 114 },
  /** L33 (= lints CALLOUT_NODE_TOL / CALLOUT_PLATE_CLEAR): a callout dot within this of a node box points at it; its plate
   *  keeps this clearance from node boxes, label plates and edges. */
  calloutTol: 24,
  calloutClear: 6,
  /** L18 (= lints L18_WARN_SEC): the fit may raise the predicted slowest render chunk up to this, never past it, and
   *  never raise a board that is already over it — so φ up to 262 / 220 (L18 block) still cannot turn into a block. */
  renderSecMax: 220,
  /** = render-plan MAX_RENDERERS / MIN_FRAMES_PER_LAMBDA (this module has no runtime imports; the test pins them). */
  renderers: 7,
  minFramesPerLambda: 20,
  /** Node reveal (props.reveal): only graphs with ≥ this many nodes; a node named within this many frames of the
   *  graph's enter just enters with it. */
  revealMinNodes: 3,
  revealGraceF: 20,
  /** A node an action needs (a state key, a packet route) shows this many frames before that action: its edges draw on
   *  (NodeGraph revealDelayF 6 + edgeDrawF 12) by the time the action changes them. */
  revealLeadF: 18,
  /** A focal NodeGraph's drawn centre may not newly sit further than this from x 540 (= lints OFFCENTRE_PX, L40). */
  offCentrePx: 60,
  /** W7.2 step 3: labels moved off a focal subject's drawing when their pill / box overlaps it by more than this share
   *  of its own area (= lints L60's 5 %), to this gap outside the subject. StatusCard: a card over a grid plate. */
  labels: ["Callout", "SourceTag", "RequestPill", "StatusCard"],
  labelOverlap: 0.05,
  labelGap: 16,
  /** W7.3 height fill (step 0b): a sole LayerStack / NodeGraph grows its OWN height (layer bands / canvas rows, via the
   *  library props fillH / canvasH) toward the free stage height (focalTop..captionTop less 2 × heightMargin, at its
   *  median sole zoom), in heightStep px candidates, never below minHeightGain × its spec height. */
  heightSubjects: { LayerStack: "fillH", NodeGraph: "canvasH" } as Readonly<Record<string, string>>,
  heightMargin: 28,
  heightStep: 40,
  minHeightGain: 1.08,
  heightMax: { LayerStack: 1600, NodeGraph: 1100 } as Readonly<Record<string, number>>,
  /** = lints DUP_STILL_SHARE / DUP_STILL_LOOKBACK (L28): growing a HELD subject may not push a beat's still past this
   *  share of unchanged content (the beat's change — a pill, a card — shrinks in share as the subject grows). */
  dupShare: 0.95,
  dupLookback: 2,
} as const;

export interface StageFit {
  /** Subject instance id. */
  id: string;
  /** layout / zoom: the subject was re-laid out / enlarged (members moved); reveal: NodeGraph props.reveal set (nothing
   *  moved: members / centred are empty; limit lists "node@frame"). */
  kind: "layout" | "zoom" | "reveal" | "label" | "height";
  /** layout: the node scale cap asked for; zoom: the local zoom. */
  scale: number;
  /** layout only: canvas stretch ("none" keeps the spec node range; "y" / "xy" spread it over the canvas) and how far. */
  stretch?: "none" | "y" | "xy";
  spread?: number;
  /** World centre of the local zoom (= the subject's box centre). */
  cx: number;
  cy: number;
  /** Every changed instance (subject first). */
  members: string[];
  /** Pill instances re-centred on the subject (zoom). */
  centred: string[];
  /** Why the scale stopped where it did ("target", "cap", "f<frame>: <instance> <rule>"). */
  limit: string;
}

/** Visibility window of every instance: first `enter` → first `exit` + 8 f (no enter = from frame 0). */
export function fitVisibility(sb: Pick<Storyboard, "world">, tl: Pick<Timeline, "events" | "durationF">): Map<string, { from: number; to: number }> {
  const m = new Map<string, { from: number; to: number }>(sb.world.map((i) => [i.id, { from: 0, to: tl.durationF }]));
  const entered = new Set<string>();
  for (const e of [...tl.events].sort((a, b) => a.frame - b.frame)) {
    if (e.kind !== "action") continue;
    const v = m.get(e.target);
    if (!v) continue;
    if (e.do === "enter" && !entered.has(e.target)) {
      entered.add(e.target);
      v.from = e.frame;
    } else if (e.do === "exit") v.to = Math.min(v.to, e.frame + 8);
  }
  return m;
}

/** Review frames the fit is checked on: per beat the keyword frame, keyword + 6 and the settled frame (+6 pushed past a
 *  camera move) — the frames L3/L4 and the review stills look at. */
/** A beat's settled review frame: keyword + 6, pushed past a camera move (= visualDigest settledFrame). */
export function settledOf(tl: Pick<Timeline, "durationF" | "cameraSegments">, b: Pick<TimelineBeat, "keywordF">): number {
  let f = Math.min(tl.durationF - 1, b.keywordF + 6);
  for (const s of tl.cameraSegments) if (s.transition === "move" && f >= s.startF && f < s.endF) f = Math.min(tl.durationF - 1, s.endF);
  return f;
}

export function fitFrames(tl: Pick<Timeline, "beats" | "durationF" | "cameraSegments">): number[] {
  const out = new Set<number>();
  const last = tl.durationF - 1;
  for (const b of tl.beats) {
    let settled = Math.min(last, b.keywordF + 6);
    for (const s of tl.cameraSegments) if (s.transition === "move" && settled >= s.startF && settled < s.endF) settled = Math.min(last, s.endF);
    for (const f of [Math.min(last, b.keywordF), Math.min(last, b.keywordF + 6), settled]) out.add(Math.max(0, f));
  }
  return [...out].sort((a, b) => a - b);
}

type Inst = Pick<InstanceT, "id" | "component" | "x" | "y" | "w" | "scale" | "figure"> & { props?: Record<string, unknown>; focal?: boolean };

/** Drawn box of an instance in world px: the meta's contentBox (NodeGraph: nodes + labels) or the whole box. */
export function drawnBox(inst: Omit<Inst, "id">, lib: FootprintLookup): Box | null {
  const b = instanceBox(inst, lib);
  if (!b) return null;
  const c = inst.props ? lib[inst.component]?.contentFor?.(inst.props, inst.w) : null;
  if (!c) return b;
  const s = inst.scale ?? 1;
  return { x: b.x + c.x * s, y: b.y + c.y * s, w: c.w * s, h: c.h * s };
}

const boxGap = (a: Box, b: Box) => Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w), a.y - (b.y + b.h), b.y - (a.y + a.h));
const boxesTouch = (a: Box, b: Box, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
const onViewport = (b: Box) => b.x < WIDTH && b.x + b.w > 0 && b.y < HEIGHT && b.y + b.h > 0;

/** Local-zoom cap of a subject (NodeGraph: by node count). */
export function fitCap(inst: Pick<InstanceT, "component"> & { props?: Record<string, unknown> }): number {
  if (inst.component !== "NodeGraph") return FIT.subjectCap[inst.component] ?? FIT.cap;
  const n = Array.isArray(inst.props?.nodes) ? (inst.props!.nodes as unknown[]).length : 8;
  for (const [max, cap] of FIT.graphCap) if (n <= max) return cap;
  return FIT.graphCap[FIT.graphCap.length - 1][1];
}

/** The instance moved by a local zoom s about (cx, cy): its box centre follows the zoom, its own scale ×min(s, own). */
export function zoomed<T extends Inst>(inst: T, s: number, cx: number, cy: number, lib: FootprintLookup, own: number): T {
  const b = instanceBox(inst, lib);
  const k = Math.min(s, own);
  const s0 = inst.scale ?? 1;
  if (!b) return { ...inst, x: cx + s * (inst.x - cx), y: cy + s * (inst.y - cy), scale: s0 * k };
  // box centre → zoomed centre; the origin offset (Figure boxes start off the origin) scales with the instance
  const ox = b.x - inst.x;
  const oy = b.y - inst.y;
  const ncx = cx + s * (b.x + b.w / 2 - cx);
  const ncy = cy + s * (b.y + b.h / 2 - cy);
  return { ...inst, x: ncx - (b.w * k) / 2 - ox * k, y: ncy - (b.h * k) / 2 - oy * k, scale: s0 * k };
}

// ── W5.1 FR1: lint-true acceptance ─────────────────────────────────────────────────────────────────────────────
//
// The W5.1 pass refused only a rule NAME the board did not already break, measured on the whole drawn box: a graph
// already in the caption band at one frame could be pushed further down (w3/r2 tls b04: three nodes below the
// hairline), a callout off its node by 1 px became an L33 error (w33 dns "call"), and a bigger packet route raised the
// predicted render chunk over the L18 block (w3/r1 event-recent 261.6 → 263.4 s). Now every candidate is measured the
// way the lints measure it — per drawn PART (meta.shape: one block per graph node), against the caption card of that
// frame, with every Callout's L33 geometry — and a part / callout may never get worse; the finished fit is checked
// against the L18 render-time prediction. test/v2-timeline-w51 runs the real lints over every saved board.

/** World boxes of what an instance draws, one per part (meta.shape); else its drawn box as the single part "". */
export function drawnParts(inst: Omit<Inst, "id">, lib: FootprintLookup): { part: string; box: Box }[] {
  const b = instanceBox(inst, lib);
  if (!b) return [];
  const sh = inst.props ? lib[inst.component]?.shapeFor?.(inst.props, inst.w) : null;
  const s = inst.scale ?? 1;
  if (sh?.parts.length) return sh.parts.map((p) => ({ part: p.part, box: { x: b.x + p.x * s, y: b.y + p.y * s, w: p.w * s, h: p.h * s } }));
  const d = drawnBox(inst, lib);
  return d ? [{ part: "", box: d }] : [];
}

/** Subtitle card on screen at frame f (= lints captionBoxAt), null before the first phrase. */
export function captionCardAt(tl: Pick<Timeline, "displayPhrases">, f: number): Box | null {
  const d = tl.displayPhrases.find((p) => f >= p.showF && f < p.hideF);
  if (!d) return null;
  const C = FIT.caption;
  return { x: C.left, y: C.bottom - C.h, w: Math.min(C.maxW, Math.ceil(d.widthPx) + C.extraW), h: C.h };
}

type Pt = { x: number; y: number };
const growBox = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const ptBoxDist = (p: Pt, b: Box) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)));
const openOverlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** Does segment a→c pass through the open box b (Liang–Barsky; = lints segHitsBox)? */
function segThroughBox(a: Pt, c: Pt, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [p0, d, lo, hi] of [[a.x, c.x - a.x, b.x, b.x + b.w], [a.y, c.y - a.y, b.y, b.y + b.h]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p0 <= lo || p0 >= hi) return false;
      continue;
    }
    const ta = (lo - p0) / d;
    const tb = (hi - p0) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t1 - t0 > 1e-6;
}

/** World geometry of a graph (drawn: its props.layout) for the L33 check; null without meta.shape. */
export interface FitGraphGeo {
  box: Box;
  nodes: { id: string; box: Box; plate: Box }[];
  edges: { key: string; a: Pt; b: Pt }[];
}
export function fitGraphGeo(g: Omit<Inst, "id">, lib: FootprintLookup, props: Record<string, unknown> | undefined = g.props): FitGraphGeo | null {
  const b = instanceBox(g, lib);
  const sh = props ? lib[g.component]?.shapeFor?.(props, g.w) : null;
  if (!b || !sh?.nodes || !sh.edges) return null;
  const s = g.scale ?? 1;
  const wb = (q: Box): Box => ({ x: b.x + q.x * s, y: b.y + q.y * s, w: q.w * s, h: q.h * s });
  const wp = (x: number, y: number): Pt => ({ x: b.x + x * s, y: b.y + y * s });
  return { box: b, nodes: sh.nodes.map((n) => ({ id: n.id, box: wb(n.box), plate: wb(n.plate) })), edges: sh.edges.map((e) => ({ key: e.key, a: wp(e.ax, e.ay), b: wp(e.bx, e.by) })) };
}

/** World dot / leader / plate of a Callout instance (props as given), null without meta.shape. */
export function fitCalloutGeo(c: Omit<Inst, "id">, lib: FootprintLookup, props: Record<string, unknown> | undefined = c.props): { dot: Pt; points: Pt[]; pill: Box } | null {
  const sh = props ? lib[c.component]?.shapeFor?.(props, c.w) : null;
  if (!sh?.dot || !sh.points || !sh.pill) return null;
  const s = c.scale ?? 1;
  const pt = (q: Pt): Pt => ({ x: c.x + q.x * s, y: c.y + q.y * s });
  return { dot: pt(sh.dot), points: sh.points.map(pt), pill: { x: c.x + sh.pill.x * s, y: c.y + sh.pill.y * s, w: sh.pill.w * s, h: sh.pill.h * s } };
}

/** L33 geometry of one callout against one graph (= lints calloutGraphCheck): on = it is on the graph at all; hits =
 *  what its plate (+ clearance) or leader covers; dist = dot → nearest node box. */
export function calloutVsGraph(c: { dot: Pt; points: Pt[]; pill: Box }, g: FitGraphGeo): { on: boolean; hits: Set<string>; dist: number } {
  const plate = growBox(c.pill, FIT.calloutClear);
  const on = openOverlap(plate, growBox(g.box, FIT.calloutTol)) || ptBoxDist(c.dot, g.box) <= FIT.calloutTol;
  const hits = new Set<string>();
  let nearest = -1;
  let dist = Infinity;
  g.nodes.forEach((n, i) => {
    if (openOverlap(plate, n.box)) hits.add(`plate × ${n.id} node`);
    if (openOverlap(plate, n.plate)) hits.add(`plate × ${n.id} label`);
    const d = ptBoxDist(c.dot, n.box);
    if (d < dist) {
      dist = d;
      nearest = i;
    }
  });
  for (const e of g.edges) if (segThroughBox(e.a, e.b, plate)) hits.add(`plate × ${e.key} edge`);
  g.nodes.forEach((n, i) => {
    const own = i === nearest && dist <= FIT.calloutTol;
    for (let k = 0; k + 1 < c.points.length; k++) {
      if (!own && segThroughBox(c.points[k], c.points[k + 1], n.box)) hits.add(`leader × ${n.id} node`);
      if (segThroughBox(c.points[k], c.points[k + 1], n.plate)) hits.add(`leader × ${n.id} label`);
    }
  });
  return { on, hits, dist };
}

/** A Callout pinned on a graph: on a node (its index in props.nodes) or on an edge (index, position t along the spec
 *  segment and the dot's offset from that point). */
export type CalloutPin = { id: string; node: number } | { id: string; edge: number; t: number; off: Pt };

/**
 * Callouts pinned on a graph: the dot (meta anchor) lies within FIT.pinPx of a node's spec square / dot, else within
 * FIT.pinPx of a spec edge segment (W5.1 FR1, w32 oom c1–c4: callouts pointing at an edge or beside a node stayed put
 * while the graph re-laid out under them). Spec = the graph's props WITHOUT a layout.
 */
export function pinnedCallouts(graph: Inst, world: readonly Inst[], lib: FootprintLookup): CalloutPin[] {
  if (!graph.props) return [];
  const spec = fitGraphGeo(graph, lib, { ...graph.props, layout: undefined });
  if (!spec) return [];
  const out: CalloutPin[] = [];
  for (const c of world) {
    if (c.component !== "Callout" || !c.props) continue;
    const cw = fitCalloutGeo(c, lib);
    if (!cw) continue;
    const dot = cw.dot;
    let best = -1;
    let bestD = Infinity;
    spec.nodes.forEach((n, i) => {
      const d = ptBoxDist(dot, n.box);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= FIT.pinPx) {
      out.push({ id: c.id, node: best });
      continue;
    }
    let eBest: { edge: number; t: number; off: Pt; d: number } | null = null;
    spec.edges.forEach((e, i) => {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((dot.x - e.a.x) * dx + (dot.y - e.a.y) * dy) / L2));
      const p = { x: e.a.x + t * dx, y: e.a.y + t * dy };
      const d = Math.hypot(dot.x - p.x, dot.y - p.y);
      if (d <= FIT.pinPx && (!eBest || d < eBest.d)) eBest = { edge: i, t, off: { x: dot.x - p.x, y: dot.y - p.y }, d };
    });
    const eb = eBest as { edge: number; t: number; off: Pt; d: number } | null;
    if (eb) out.push({ id: c.id, edge: eb.edge, t: eb.t, off: eb.off });
  }
  return out;
}

/** Where a pinned callout's dot goes when its graph is drawn with `drawn` (spec geometry `spec`, world px). A node pin
 *  keeps its place relative to the node box (inside: scaled with the box; outside: the same gap from its side); an
 *  edge pin keeps its position along the edge and its offset from it. */
export function pinnedDot(pin: CalloutPin, dot: Pt, spec: FitGraphGeo, drawn: FitGraphGeo): Pt | null {
  if ("node" in pin) {
    const a = spec.nodes[pin.node]?.box;
    const b = drawn.nodes[pin.node]?.box;
    if (!a || !b) return null;
    const axis = (o: number, ha: number, hb: number) => (Math.abs(o) <= ha ? (o * hb) / (ha || 1) : Math.sign(o) * (hb + Math.abs(o) - ha));
    return { x: b.x + b.w / 2 + axis(dot.x - (a.x + a.w / 2), a.w / 2, b.w / 2), y: b.y + b.h / 2 + axis(dot.y - (a.y + a.h / 2), a.h / 2, b.h / 2) };
  }
  const e = drawn.edges[pin.edge];
  if (!e) return null;
  return { x: e.a.x + pin.t * (e.b.x - e.a.x) + pin.off.x, y: e.a.y + pin.t * (e.b.y - e.a.y) + pin.off.y };
}

/** Predicted slowest render chunk (s) of `sb.world` on the timing / camera of `tl` (= lints predictRender at φ 1:
 *  render-plan chunking, RENDER_T0 + RENDER_T_SAMPLE × blur samples per frame). The world only changes the element
 *  flights (bigger packet routes) and entrances; the camera path is the director's. */
export function predictChunkMax(sb: Pick<Storyboard, "world" | "blur">, tl: Pick<Timeline, "events" | "camera0" | "cameraSegments" | "durationF" | "hardCuts">, lib: FootprintLookup): number {
  const { flight, enter } = elementSpeeds(sb as Storyboard, lib, tl.events, tl, tl.durationF);
  const fpl = Math.max(FIT.minFramesPerLambda, Math.ceil(tl.durationF / FIT.renderers));
  let worst = 0;
  for (let c = 0; c * fpl < tl.durationF; c++) {
    let t = 0;
    for (let f = c * fpl; f < Math.min((c + 1) * fpl, tl.durationF); f++) {
      const cam = screenSpeed(tl, f);
      const opens = cam >= BLUR_MIN_SPEED || flight[f] >= BLUR_MIN_SPEED;
      t += RENDER_T0 + RENDER_T_SAMPLE * (opens ? blurSamplesForSpeed(cam + Math.max(flight[f], enter[f]), sb.blur) : 0);
    }
    worst = Math.max(worst, t);
  }
  return worst;
}

// ── W5.1 FR1: node reveal (one persistent graph that grows as the narration names its parts) ─────────────────────

const REVEAL_STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "at", "for", "with", "and", "or", "is", "are", "was", "were", "it", "its", "this", "that", "old", "new", "your", "our"]);

/**
 * Default node reveal frames for a graph (props.reveal; W5.1 FR1, evergreen-tls: all 5 nodes entered at b05 and the
 * diagram then changed only by edge colours for 15 beats). Each node shows from the first word — on or after the
 * graph's enter — that names it (its whole label, a label word no other node shares, or an inner tag of ≥ 3 chars that
 * abbreviates the label), or earlier if
 * an action or a pinned Callout needs it (a nodeStates / edgeStates key, a packet route, a callout on it). Nodes that
 * are never named / needed, or named within FIT.revealGraceF of the enter, enter with the graph; at least one node
 * always does. null = leave the graph as it is: < FIT.revealMinNodes nodes, or the director already stages it (any
 * `hidden` state, drawEdges, a drawOn, or props.reveal).
 */
export function revealFrames(g: Inst, sb: Pick<Storyboard, "world">, tl: Pick<Timeline, "events" | "beats" | "durationF">, lib: FootprintLookup, vis: ReadonlyMap<string, { from: number; to: number }>): Record<string, number> | null {
  const p = g.props as { nodes?: { id: string; label: string; inner?: string; state?: string }[]; edges?: { from: string; to: string; state?: string }[]; nodeStates?: Record<string, string>; edgeStates?: Record<string, string>; packet?: string; drawEdges?: unknown; reveal?: unknown } | undefined;
  if (!p || !Array.isArray(p.nodes) || p.nodes.length < FIT.revealMinNodes || p.reveal !== undefined || p.drawEdges !== undefined) return null;
  const hasHidden = (m: unknown) => !!m && typeof m === "object" && Object.values(m as Record<string, unknown>).includes("hidden");
  const evs = tl.events.filter((e): e is Extract<TimelineEvent, { kind: "action" }> => e.kind === "action" && e.target === g.id).sort((a, b) => a.frame - b.frame);
  if (p.nodes.some((n) => n.state === "hidden") || (p.edges ?? []).some((e) => e.state === "hidden") || hasHidden(p.nodeStates) || hasHidden(p.edgeStates)) return null;
  if (evs.some((e) => e.do === "drawOn" || (e.props && (e.props.drawEdges !== undefined || hasHidden(e.props.nodeStates) || hasHidden(e.props.edgeStates))))) return null;
  const v = vis.get(g.id);
  if (!v) return null;
  const enter = v.from;
  const ids = p.nodes.map((n) => n.id);
  const need = new Map<string, number>();
  // a node an action needs enters early enough that its edges have drawn on by that action (NodeGraph: edges draw
  // revealDelayF 6 + edgeDrawF 12 frames after the reveal)
  const want = (id: string, f: number) => {
    if (ids.includes(id)) need.set(id, Math.min(need.get(id) ?? Infinity, Math.max(enter, f - FIT.revealLeadF)));
  };
  // what the board already needs drawn: its initial looks, every override key, every packet route, pinned callouts
  for (const n of p.nodes) if (n.state && n.state !== "ok") want(n.id, enter);
  for (const k of Object.keys(p.nodeStates ?? {})) want(k, enter);
  for (const k of Object.keys(p.edgeStates ?? {})) for (const id of k.split(">")) want(id, enter);
  let packet = p.packet;
  for (const e of evs) {
    const q = e.props ?? {};
    for (const k of Object.keys((q.nodeStates as Record<string, unknown> | undefined) ?? {})) want(k, e.frame);
    for (const k of Object.keys((q.edgeStates as Record<string, unknown> | undefined) ?? {})) for (const id of k.split(">")) want(id, e.frame);
    if (typeof q.packet === "string") packet = q.packet;
    if (e.do === "mark" && packet) for (const id of packet.split(">")) want(id, e.frame);
  }
  for (const pin of pinnedCallouts(g, sb.world, lib)) {
    const cv = vis.get(pin.id);
    if (!cv) continue;
    if ("node" in pin) want(ids[pin.node], cv.from);
    else {
      const e = p.edges?.[pin.edge];
      if (e) for (const id of [e.from, e.to]) want(id, cv.from);
    }
  }
  // the first word naming each node, from the graph's enter on
  const toks = p.nodes.map((n) => tokenize(n.label).map(normToken).filter(Boolean));
  const named = new Map<string, number>();
  for (const b of tl.beats) {
    if (b.endF <= enter || b.startF >= v.to) continue;
    const words = b.words.filter((w) => w.endF > enter);
    const hay = words.map((w) => normToken(w.text));
    p.nodes.forEach((n, i) => {
      if (named.has(n.id)) return;
      let at = Infinity;
      for (const k of findSeq(hay, toks[i])) at = Math.min(at, k);
      const singles = toks[i].filter((t) => t.length >= 3 && !REVEAL_STOP.has(t) && !toks.some((o, j) => j !== i && o.includes(t)));
      // an inner tag names the node only when it abbreviates the label ("SELF" / "CA" on a root CA name a second concept)
      const inner = n.inner ? normToken(n.inner) : "";
      const lab = n.label.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      let j = 0;
      for (const ch of lab) if (ch === inner[j]) j++;
      if (inner.length >= 3 && j === inner.length) singles.push(inner);
      hay.forEach((t, k) => {
        if (singles.includes(t)) at = Math.min(at, k);
      });
      if (at < Infinity) named.set(n.id, Math.max(enter, words[at].startF));
    });
  }
  const out: Record<string, number> = {};
  for (const id of ids) {
    const f = Math.min(named.get(id) ?? Infinity, need.get(id) ?? Infinity);
    if (f < Infinity && f > enter + FIT.revealGraceF) out[id] = f;
  }
  const later = Object.keys(out);
  if (!later.length) return null;
  if (later.length === ids.length) {
    const first = Math.min(...later.map((id) => out[id]));
    for (const id of later) if (out[id] === first) delete out[id];
  }
  return Object.keys(out).length ? out : null;
}

/** The fitted world + what changed. `skipped` = subjects / graphs left as they were, with the reason. */
export function fitWorld(sb: Storyboard, tl: Timeline, lib: FootprintLookup): { world: InstanceT[]; fits: StageFit[]; skipped: { id: string; why: string }[]; trace: string[] } {
  const all = fitWorldOnce(sb, tl, lib, new Set());
  const moved = [...new Set(all.fits.filter((f) => f.kind !== "reveal").map((f) => f.id))];
  if (!moved.length) return all;
  // L18: the fit may not push the predicted slowest render chunk past FIT.renderSecMax (nor raise one already past it)
  const t0 = predictChunkMax(sb, tl, lib);
  const allowed = t0 > FIT.renderSecMax ? t0 + 0.01 : FIT.renderSecMax;
  const tOf = (r: { world: InstanceT[] }) => predictChunkMax({ world: r.world, blur: sb.blur }, tl, lib);
  const t1 = tOf(all);
  if (t1 <= allowed) return all;
  const why = (t: number) => `render time: predicted slowest chunk ${t.toFixed(1)} s > ${allowed.toFixed(1)} s`;
  for (const id of [...moved].reverse()) {
    const r = fitWorldOnce(sb, tl, lib, new Set([id]));
    if (tOf(r) <= allowed) return { ...r, skipped: [...r.skipped, { id, why: why(t1) }] };
  }
  // exclude every mover; a subject that was another's satellite may then move on its own: exclude it too, until the
  // run moves nothing new or fits the cap
  const ex = new Set(moved);
  let r = fitWorldOnce(sb, tl, lib, ex);
  for (let more = r.fits.filter((f) => f.kind !== "reveal" && !ex.has(f.id)); tOf(r) > allowed && more.length; more = r.fits.filter((f) => f.kind !== "reveal" && !ex.has(f.id))) {
    for (const f of more) ex.add(f.id);
    r = fitWorldOnce(sb, tl, lib, ex);
  }
  return { ...r, skipped: [...r.skipped, ...[...ex].map((id) => ({ id, why: why(t1) }))] };
}

function fitWorldOnce(sb: Storyboard, tl: Timeline, lib: FootprintLookup, exclude: ReadonlySet<string>): { world: InstanceT[]; fits: StageFit[]; skipped: { id: string; why: string }[]; trace: string[] } {
  /** One line per rejected candidate (diagnostics: scripts / tests). */
  const trace: string[] = [];
  const S = FIT.safe;
  const vis = fitVisibility(sb, tl);
  const frames = fitFrames(tl);
  const cams = frames.map((f) => cameraAt(tl, f));
  const caps = frames.map((f) => captionCardAt(tl, f));
  const focalOf = (i: Inst) => i.focal ?? lib[i.component]?.focal ?? true;
  const world: InstanceT[] = sb.world.map((i) => ({ ...i }));
  const byId = new Map(world.map((i) => [i.id, i]));
  const visible = (id: string, f: number) => {
    const v = vis.get(id)!;
    return f >= v.from && f < v.to;
  };
  const shareTime = (a: string, b: string, minF = 0) => {
    const va = vis.get(a)!;
    const vb = vis.get(b)!;
    return Math.min(va.to, vb.to) - Math.max(va.from, vb.from) > minF;
  };
  const fits: StageFit[] = [];
  const skipped: { id: string; why: string }[] = [];

  // ── step 0: node reveal (props only; nothing moves) ──
  for (const g of world) {
    if (g.component !== "NodeGraph") continue;
    const r = revealFrames(g, sb, tl, lib, vis);
    if (!r) continue;
    g.props = { ...g.props, reveal: r };
    const b = instanceBox(g, lib);
    fits.push({ id: g.id, kind: "reveal", scale: 1, cx: b ? b.x + b.w / 2 : g.x, cy: b ? b.y + b.h / 2 : g.y, members: [], centred: [], limit: Object.entries(r).map(([k, f]) => `${k}@${f}`).join(" ") });
  }

  /** Overshoot (px; caption card: overlap px² / 100) per rule and drawn part of one instance on review frame k. */
  const rules = (inst: Inst, k: number): Map<string, number> => {
    const out = new Map<string, number>();
    const put = (key: string, v: number) => {
      if (v > 0) out.set(key, Math.max(out.get(key) ?? 0, v));
    };
    const focal = focalOf(inst);
    const cap = caps[k];
    for (const { part, box } of drawnParts(inst, lib)) {
      const sc = toScreen(box, cams[k]);
      if (!onViewport(sc)) continue;
      const tag = part ? `${part} ` : "";
      // frame-edge clearance while the camera moves is transit (L23: warn), the bands below are not (L23: block)
      if (!cams[k].moving) {
        put(`${tag}safe zone`, Math.max(S.left - sc.x, sc.x + sc.w - S.right, S.top - sc.y, sc.y + sc.h - S.bottom));
        put(`${tag}text ≤ 960`, sc.x + sc.w - S.textRight);
        // W7.1: nothing (focal or not) newly cut by the header band (lints L23 clip region y ≥ 218)
        put(`${tag}header band`, S.focalTop - sc.y);
      }
      if (focal) put(`${tag}header / caption band`, Math.max(S.focalTop - sc.y, sc.y + sc.h - S.captionTop));
      if (cap && openOverlap(sc, cap)) put(`${tag}caption card`, ((Math.min(sc.x + sc.w, cap.x + cap.w) - Math.max(sc.x, cap.x)) * (Math.min(sc.y + sc.h, cap.y + cap.h) - Math.max(sc.y, cap.y))) / 100);
    }
    // a layout clamped at the text edge must not push the drawn graph off-centre (W5.1 vswitch-mac: 79 px left, L40)
    if (inst.component === "NodeGraph" && focal) {
      const d = drawnBox(inst, lib);
      if (d) {
        const sc = toScreen(d, cams[k]);
        if (onViewport(sc)) put("off-centre", Math.abs(sc.x + sc.w / 2 - CAM_ANCHOR.x) - FIT.offCentrePx);
      }
    }
    return out;
  };
  /** Screen boxes on frame k that touch (within clearPx), for the instances `of` against everything visible. */
  const touches = (of: ReadonlyMap<string, Inst>, k: number): Set<string> => {
    const f = frames[k];
    const out = new Set<string>();
    const at = (id: string) => of.get(id) ?? byId.get(id)!;
    for (const id of of.keys()) {
      if (!visible(id, f)) continue;
      const mb = drawnBox(at(id), lib);
      if (!mb) continue;
      const ms = toScreen(mb, cams[k]);
      if (!onViewport(ms)) continue;
      for (const o of world) {
        if (o.id === id || !visible(o.id, f)) continue;
        const ob = drawnBox(at(o.id), lib);
        if (ob && boxesTouch(ms, toScreen(ob, cams[k]), FIT.clearPx)) out.add(`${id}|${o.id}`);
      }
    }
    return out;
  };
  // L33 inputs: every props variant a Callout shows (base, then each action override folded in)
  const graphs = world.filter((i) => i.component === "NodeGraph");
  const calloutProps = new Map<string, Record<string, unknown>[]>();
  for (const c of world) {
    if (c.component !== "Callout") continue;
    const list = [c.props ?? {}];
    for (const e of tl.events) if (e.kind === "action" && e.target === c.id && e.props) list.push({ ...list[list.length - 1], ...e.props });
    calloutProps.set(c.id, list);
  }
  /** First Callout a proposal makes worse under L33 (a new plate / leader hit, a dot further off its node, or a callout
   *  that pointed at a node and no longer touches the graph), null = none. */
  const calloutWorse = (proposed: ReadonlyMap<string, Inst>): string | null => {
    for (const g of graphs) {
      for (const [cid, variants] of calloutProps) {
        if (!proposed.has(cid) && !proposed.has(g.id)) continue;
        if (!shareTime(cid, g.id)) continue;
        const c0 = byId.get(cid)!;
        const c1 = proposed.get(cid) ?? c0;
        const g0 = fitGraphGeo(byId.get(g.id)!, lib);
        const g1 = fitGraphGeo(proposed.get(g.id) ?? byId.get(g.id)!, lib);
        if (!g0 || !g1) continue;
        for (const pr of variants) {
          const a = fitCalloutGeo(c0, lib, pr);
          // a library leader (step 3, props.layout) is part of the proposal, not of the authored variants
          const b = fitCalloutGeo(c1, lib, c1 === c0 ? pr : { ...pr, layout: c1.props?.layout });
          if (!a || !b) continue;
          const was = calloutVsGraph(a, g0);
          const now = calloutVsGraph(b, g1);
          if (!now.on) {
            if (was.on && was.dist <= FIT.calloutTol) return `${cid} leaves ${g.id}`;
            continue;
          }
          const hit = [...now.hits].find((h) => !(was.on && was.hits.has(h)));
          if (hit) return `${cid} ${hit}`;
          if (now.dist > FIT.calloutTol && now.dist > (was.on ? was.dist : 0) + 0.5) return `${cid} dot ${Math.round(now.dist)} px off ${g.id}`;
        }
      }
    }
    return null;
  };
  /** L41 input: the tallest empty band of the stage (y focalTop–captionTop) on frame k, with `over` in place. */
  const bandGap = (over: ReadonlyMap<string, Inst>, k: number): number => {
    const iv = world
      .filter((o) => visible(o.id, frames[k]))
      .map((o) => drawnBox(over.get(o.id) ?? byId.get(o.id)!, lib))
      .filter((b): b is Box => !!b)
      .map((b) => toScreen(b, cams[k]))
      .filter(onViewport)
      .map((b) => [Math.max(S.focalTop, b.y), Math.min(S.captionTop, b.y + b.h)] as const)
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let at: number = S.focalTop;
    let gap = 0;
    for (const [a, b] of iv) {
      gap = Math.max(gap, a - at);
      at = Math.max(at, b);
    }
    return Math.max(gap, S.captionTop - at);
  };
  /** W7.3-C: how far an instance's box sticks out of its station (world px; lints L3 "sticks out of its station"). */
  const stationOverflow = (inst: Inst, station: string | undefined): number => {
    const st = sb.stations.find((x) => x.id === station);
    const b = st ? instanceBox(inst, lib) : null;
    return st && b ? Math.max(0, st.x - b.x, st.y - b.y, b.x + b.w - (st.x + st.w), b.y + b.h - (st.y + st.h)) : 0;
  };
  /** First rule the proposal breaks or makes worse, per drawn part, on any review frame (null = accepted). */
  const check = (proposed: ReadonlyMap<string, Inst>): string | null => {
    const current = new Map([...proposed.keys()].map((id) => [id, byId.get(id)! as Inst]));
    // W7.3-C (W5 fr1 vswitch-mac: the height fill grew the graph, the centring then slid it out of station s2): no
    // proposal sticks an instance further out of its station than it already was
    for (const [id, inst] of proposed) {
      const st = byId.get(id)?.station;
      if (stationOverflow(inst, st) > stationOverflow(current.get(id)!, st) + 0.5) return `${id} sticks out of its station "${st}"`;
    }
    for (let k = 0; k < frames.length; k++) {
      const f = frames[k];
      for (const [id, inst] of proposed) {
        if (!visible(id, f)) continue;
        const was = rules(current.get(id)!, k);
        for (const [key, v] of rules(inst, k)) if (v > (was.get(key) ?? 0) + 0.5) return `f${f}: ${id} ${key}`;
      }
      const before = touches(current, k);
      for (const t of touches(proposed, k)) if (!before.has(t)) return `f${f}: ${t.replace("|", " meets ")}`;
      // W7.2: a move may not open a new large empty band of the stage (lints L41; a centring slide can)
      if (!cams[k].moving) {
        const g1 = bandGap(proposed, k);
        if (g1 >= FRAME.emptyBandShare * (S.captionTop - S.focalTop) && g1 > bandGap(current, k) + 0.5) return `f${f}: empty stage band`;
      }
    }
    return calloutWorse(proposed);
  };
  const commit = (proposed: ReadonlyMap<string, Inst>) => {
    for (const [id, inst] of proposed) Object.assign(byId.get(id)!, inst);
  };

  // ── step 0b (W7.3): height fill — a sole LayerStack / NodeGraph grows its own height ──
  // W7.2 pilots on Lambda stills: a 3–4 layer stack or a wide graph spanned the width but only ~35–45 % of the stage
  // height. The stack's bands / the graph's rows grow (fillH / canvasH) about the box centre (so camera keys aimed at it
  // still land on it), with Callouts on it following the part they point at; the first height check() accepts wins.
  for (const g of world) {
    const key = FIT.heightSubjects[g.component];
    if (!key || !g.props || g.props[key] !== undefined || exclude.has(g.id) || !focalOf(g)) continue;
    const box = instanceBox(g, lib);
    if (!box) continue;
    const sole: number[] = [];
    frames.forEach((f, k) => {
      if (!visible(g.id, f) || !onViewport(toScreen(box, cams[k]))) return;
      const others = world.some((o) => o.id !== g.id && o.component !== "Callout" && focalOf(o) && visible(o.id, f) && instanceBox(o, lib) && onViewport(toScreen(instanceBox(o, lib)!, cams[k])));
      if (!others) sole.push(k);
    });
    if (!sole.length) {
      skipped.push({ id: g.id, why: "height: never the only focal subject on a review frame" });
      continue;
    }
    const zs = sole.map((k) => cams[k].zoom).sort((a, b) => a - b);
    const z = zs[Math.floor(zs.length / 2)];
    const sc = g.scale ?? 1;
    const h0 = box.h / sc;
    const hT = Math.min(FIT.heightMax[g.component] ?? 1100, Math.floor((S.captionTop - S.focalTop - 2 * FIT.heightMargin) / (z * sc)));
    if (hT < h0 * FIT.minHeightGain) {
      skipped.push({ id: g.id, why: `height: already fills (${Math.round(h0 * sc * z)} of ${S.captionTop - S.focalTop} px)` });
      continue;
    }
    // callouts on the subject (dot inside its drawn box, sharing its time) follow the part their dot is on
    const oldParts = drawnParts(g, lib);
    const riders = world
      .filter((c) => c.component === "Callout" && c.props && shareTime(c.id, g.id))
      .map((c) => {
        const a = lib.Callout?.anchorFor?.(c.props ?? {}, c.w);
        if (!a) return null;
        const cs = c.scale ?? 1;
        const dot = { x: c.x + a.x * cs, y: c.y + a.y * cs };
        if (dot.x < box.x - FIT.pinPx || dot.x > box.x + box.w + FIT.pinPx || dot.y < box.y - FIT.pinPx || dot.y > box.y + box.h + FIT.pinPx) return null;
        // the smallest named part holding the dot (a layer, a node), else the whole box
        const inPart = oldParts.filter((q) => q.part && dot.x >= q.box.x - 2 && dot.x <= q.box.x + q.box.w + 2 && dot.y >= q.box.y - 2 && dot.y <= q.box.y + q.box.h + 2).sort((u, v) => u.box.w * u.box.h - v.box.w * v.box.h)[0];
        return { c, a, cs, dot, part: inPart?.part ?? "" };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    // L28 guard input: pairs of beats (lookback 2) whose settled stills share the camera and show the subject held (no
    // state / props action on it between them); the other items' area there is "the change"
    const settled = tl.beats.map((b) => settledOf(tl, b));
    const actF = tl.events.filter((e) => e.kind === "action" && e.target === g.id && e.do !== "pulse" && e.do !== "focus" && e.do !== "mark").map((e) => e.frame);
    const heldPairs: { a: number; b: number }[] = [];
    tl.beats.forEach((bt, i) => {
      if (bt.part === "cta") return;
      for (let j = Math.max(0, i - FIT.dupLookback); j < i; j++) {
        const fa = settled[j];
        const fb = settled[i];
        const ca = cameraAt(tl, fa);
        const cb = cameraAt(tl, fb);
        if (Math.abs(cb.zoom / ca.zoom - 1) > FRAME.dupZoom || Math.hypot(cb.x - ca.x, cb.y - ca.y) * cb.zoom > FRAME.dupPx) continue;
        if (!visible(g.id, fa) || !visible(g.id, fb) || actF.some((f) => f > fa && f <= fb)) continue;
        heldPairs.push({ a: fa, b: fb });
      }
    });
    const dupWorse = (pr: ReadonlyMap<string, Inst>): string | null => {
      const areaAt = (over: ReadonlyMap<string, Inst>, id: string, f: number) => {
        if (!visible(id, f)) return 0;
        const d = drawnBox(over.get(id) ?? byId.get(id)!, lib);
        if (!d) return 0;
        const sc = toScreen(d, cameraAt(tl, f));
        return onViewport(sc) ? sc.w * sc.h : 0;
      };
      for (const { a, b } of heldPairs) {
        const share = (over: ReadonlyMap<string, Inst>) => {
          const subj = Math.max(areaAt(over, g.id, a), areaAt(over, g.id, b));
          let rest = 0;
          for (const o of world) if (o.id !== g.id && !over.has(o.id)) rest += Math.max(areaAt(over, o.id, a), areaAt(over, o.id, b));
          return subj + rest > 0 ? subj / (subj + rest) : 0;
        };
        const s1 = share(pr);
        if (s1 >= FIT.dupShare && share(new Map()) < FIT.dupShare) return `f${b}: held subject ${Math.round(s1 * 100)} % of the still (L28)`;
      }
      return null;
    };
    let won: { h: number; dy: number } | null = null;
    let why = "";
    const propose = (h: number, dy: number): Map<string, Inst> | null => {
      const props = { ...g.props, [key]: h };
      const grown = { ...g, props };
      const b1 = instanceBox(grown, lib);
      if (!b1) return null;
      const moved = { ...grown, y: g.y - (b1.h - box.h) / 2 + dy };
      const out = new Map<string, Inst>([[g.id, moved]]);
      const newParts = drawnParts(moved, lib);
      const nb = instanceBox(moved, lib)!;
      for (const r of riders) {
        const op = r.part ? oldParts.find((q) => q.part === r.part)?.box : box;
        const np = r.part ? newParts.find((q) => q.part === r.part)?.box : nb;
        if (!op || !np) return null;
        const fx = op.w ? (r.dot.x - op.x) / op.w : 0.5;
        const fy = op.h ? (r.dot.y - op.y) / op.h : 0.5;
        const nd = { x: np.x + fx * np.w, y: np.y + fy * np.h };
        out.set(r.c.id, { ...r.c, x: r.c.x + (nd.x - r.dot.x), y: r.c.y + (nd.y - r.dot.y) });
      }
      return out;
    };
    for (let h = hT; h >= h0 * FIT.minHeightGain - 1e-9 && !won; h -= FIT.heightStep) {
      const hh = Math.round(h);
      // W7.3-C: then grown from its top / bottom edge (anc earcup: the station's top edge capped the centred growth while
      // 700 px below were free); check() still guards every review frame and the station
      const gb = instanceBox({ ...g, props: { ...g.props, [key]: hh } }, lib);
      const half = gb ? Math.round((gb.h - box.h) / 2) : 0;
      const dys = [...new Set([0, 40, -40, 80, -80, ...(Math.abs(half) > 80 ? [half, -half] : [])])];
      for (const dy of dys) {
        const pr = propose(hh, dy);
        if (!pr) break;
        const broke = check(pr) ?? dupWorse(pr);
        if (broke === null) {
          won = { h: hh, dy };
          commit(pr);
          fits.push({ id: g.id, kind: "height", scale: Math.round((instanceBox(pr.get(g.id)!, lib)!.h / box.h) * 1000) / 1000, cx: box.x + box.w / 2, cy: box.y + box.h / 2 + dy, members: [...pr.keys()], centred: [], limit: why || "target" });
          break;
        }
        if (dy === 0) {
          trace.push(`${g.id} height ${hh}: ${broke}`);
          if (!why) why = broke;
        }
      }
    }
    if (!won) skipped.push({ id: g.id, why: `height: ${why || "no taller layout fits"}` });
  }

  // ── step 1: NodeGraph drawn layout (node scale k + canvas stretch); pinned callouts follow their node / edge ──
  for (const g of world.filter((i) => i.component === "NodeGraph" && i.props && !i.props.layout && !exclude.has(i.id))) {
    const rl = lib[g.component]?.relayoutFor;
    const box = instanceBox(g, lib);
    if (!rl || !box) continue;
    const pins = pinnedCallouts(g, world, lib);
    const spec = fitGraphGeo(g, lib, { ...g.props, layout: undefined });
    // instances hugging the graph's drawn content from below / above (pill stacks, a terminal under it) move with that
    // edge as the content grows
    const spec0 = drawnBox(g, lib)!;
    const hugs = world
      .filter((o) => o.id !== g.id && o.station === g.station && o.component !== "Callout" && shareTime(o.id, g.id))
      .map((o) => ({ o, b: instanceBox(o, lib) }))
      .filter((x): x is { o: InstanceT; b: Box } => !!x.b && x.b.x < spec0.x + spec0.w && x.b.x + x.b.w > spec0.x)
      .map(({ o, b }) => ({ o, edge: b.y >= spec0.y + spec0.h - 10 && b.y - (spec0.y + spec0.h) <= FIT.gapPx ? ("bottom" as const) : b.y + b.h <= spec0.y + 10 && spec0.y - (b.y + b.h) <= FIT.gapPx ? ("top" as const) : null }))
      .filter((x) => x.edge !== null);
    const propose = (k: number, stretch: "none" | "y" | "xy", spread: number, hug: boolean): Map<string, Inst> => {
      const props = { ...g.props, layout: { k, stretch, spread } };
      const out = new Map<string, Inst>([[g.id, { ...g, props }]]);
      const drawn = fitGraphGeo(out.get(g.id)!, lib);
      if (!drawn || !spec) return out;
      const nb = drawnBox(out.get(g.id)!, lib)!;
      if (hug) for (const h of hugs) out.set(h.o.id, { ...h.o, y: h.o.y + (h.edge === "bottom" ? nb.y + nb.h - (spec0.y + spec0.h) : nb.y - spec0.y) });
      for (const pin of pins) {
        const c = byId.get(pin.id)!;
        const a = lib.Callout?.anchorFor?.(c.props ?? {}, c.w);
        if (!a) continue;
        const cs = c.scale ?? 1;
        const nd = pinnedDot(pin, { x: c.x + a.x * cs, y: c.y + a.y * cs }, spec, drawn);
        if (nd) out.set(c.id, { ...c, x: nd.x - a.x * cs, y: nd.y - a.y * cs });
      }
      return out;
    };
    const area = (p: Map<string, Inst>) => {
      const b = drawnBox(p.get(g.id)!, lib);
      return b ? b.w * b.h : 0;
    };
    type Best = { p: Map<string, Inst>; k: number; stretch: "none" | "y" | "xy"; spread: number; area: number };
    // a candidate must draw MORE than the spec layout (a stretch the meta falls back from is no fit at all)
    let best = { p: new Map<string, Inst>(), k: 1, stretch: "none", spread: 0, area: spec0.w * spec0.h } as Best | null;
    let why = "";
    const kTry = (stretch: "none" | "y" | "xy", spread: number, hug: boolean) => {
      for (let k = FIT.kMax; k >= 1 - 1e-9; k = Math.round((k - FIT.kStep) * 100) / 100) {
        if ((stretch === "none" || spread === 0) && k <= 1 + 1e-9) return;
        const p = propose(k, stretch, spread, hug);
        const a = area(p);
        if (best && a <= best.area + 1) return; // smaller k only shrinks the content: no better candidate below
        const broke = check(p);
        if (broke === null) {
          best = { p, k, stretch, spread, area: a };
          return;
        }
        trace.push(`${g.id} layout k${k} ${stretch} ${spread}${hug ? " hug" : ""}: ${broke}`);
        if (!why) why = broke;
      }
    };
    for (const stretch of ["xy", "y"] as const) for (const spread of FIT.spreads) for (const hug of [true, false]) kTry(stretch, spread, hug);
    kTry("none", 0, false);
    const won = best as Best | null;
    if (!won || !won.p.size) {
      skipped.push({ id: g.id, why: `layout: ${why || "no larger layout fits"}` });
      continue;
    }
    commit(won.p);
    fits.push({ id: g.id, kind: "layout", scale: won.k, stretch: won.stretch, spread: won.spread, cx: box.x + box.w / 2, cy: box.y + box.h / 2, members: [...won.p.keys()], centred: [], limit: why || "cap" });
  }

  // ── step 2: local zoom of sole focal subjects with their satellites ──
  // a Callout pinned on a graph belongs to that graph: never another subject's satellite (W5.1 FR1: a Meter zoom on the
  // same station carried the graph's callouts off their nodes), always its own graph's
  const pinOwner = new Map<string, string>();
  for (const g of graphs) for (const pin of pinnedCallouts(g, world, lib)) if (!pinOwner.has(pin.id)) pinOwner.set(pin.id, g.id);
  const claimed = new Set<string>();
  const subjects = world
    .filter((i) => (FIT.subjects as readonly string[]).includes(i.component) && focalOf(i) && instanceBox(i, lib) && !exclude.has(i.id))
    .sort((a, b) => {
      const A = instanceBox(a, lib)!;
      const B = instanceBox(b, lib)!;
      return B.w * B.h - A.w * A.h;
    });
  for (const subj of subjects) {
    if (claimed.has(subj.id)) continue;
    const sBox = instanceBox(subj, lib)!;
    // satellites: unclaimed instances of the station within gapPx of the group, sharing the subject's screen time
    const members: InstanceT[] = [subj];
    const mset = new Set([subj.id]);
    const foreignPin = (o: InstanceT) => pinOwner.has(o.id) && pinOwner.get(o.id) !== subj.id;
    for (const o of world) {
      if (pinOwner.get(o.id) !== subj.id || claimed.has(o.id) || !shareTime(o.id, subj.id)) continue;
      members.push(o);
      mset.add(o.id);
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const o of world) {
        if (mset.has(o.id) || claimed.has(o.id) || foreignPin(o) || o.station !== subj.station || !shareTime(o.id, subj.id, FIT.shareMinF)) continue;
        const ob = instanceBox(o, lib);
        if (!ob || !members.some((m) => boxGap(instanceBox(m, lib)!, ob) <= FIT.gapPx)) continue;
        members.push(o);
        mset.add(o.id);
        grew = true;
      }
    }
    // sole focal subject on ≥ 1 review frame (satellites do not count); the fill target uses the zoom there
    const sole: number[] = [];
    frames.forEach((f, k) => {
      if (!visible(subj.id, f) || !onViewport(toScreen(sBox, cams[k]))) return;
      const others = world.some((o) => !mset.has(o.id) && focalOf(o) && visible(o.id, f) && instanceBox(o, lib) && onViewport(toScreen(instanceBox(o, lib)!, cams[k])));
      if (!others) sole.push(k);
    });
    if (!sole.length) {
      skipped.push({ id: subj.id, why: "zoom: never the only focal element on a review frame" });
      continue;
    }
    const zs = sole.map((k) => cams[k].zoom).sort((a, b) => a - b);
    const z = zs[Math.floor(zs.length / 2)];
    const dBox = drawnBox(subj, lib)!;
    const cap = Math.min(fitCap(subj), ...members.map((m) => 2 / (m.scale ?? 1)));
    // W7.1: the width target is 840 px; the height needs no target — every candidate is checked against the header band
    // and the caption line on every review frame, so a tall group grows until it meets them
    const target = FIT.fillW / (dBox.w * z);
    const hi0 = Math.min(target, cap);
    const cx = sBox.x + sBox.w / 2;
    const cy = sBox.y + sBox.h / 2;
    // pill rows above / below the subject (horizontally inside its span) are re-centred on it
    const pillRows: string[][] = [];
    for (const m of members) {
      if (m === subj || !(FIT.pills as readonly string[]).includes(m.component)) continue;
      const b = instanceBox(m, lib)!;
      const beside = b.y < sBox.y + sBox.h && b.y + b.h > sBox.y;
      if (beside || b.x + b.w <= sBox.x || b.x >= sBox.x + sBox.w) continue;
      const row = pillRows.find((r) => r.some((id) => Math.abs(byId.get(id)!.y - m.y) <= FIT.rowTolPx && shareTime(id, m.id)));
      if (row) row.push(m.id);
      else pillRows.push([m.id]);
    }
    const place = (s: number, dy = 0): Map<string, Inst> => {
      const out = new Map<string, Inst>();
      for (const m of members) {
        const z = zoomed(m, s, cx, cy, lib, m === subj ? s : (FIT.satelliteCap[m.component] ?? s));
        out.set(m.id, { ...z, y: z.y + dy });
      }
      for (const row of pillRows) {
        const bs = row.map((id) => instanceBox(out.get(id)!, lib)!);
        const x0 = Math.min(...bs.map((b) => b.x));
        const x1 = Math.max(...bs.map((b) => b.x + b.w));
        const dx = cx - (x0 + x1) / 2;
        for (const id of row) out.set(id, { ...out.get(id)!, x: out.get(id)!.x + dx });
      }
      return out;
    };
    // W7.1 vertical centring: the world dy that brings the group's screen centre closest to the free stage's middle on
    // its worst sole frame (minimax), and that offset in screen px
    const midY = (FIT.safe.focalTop + FIT.safe.captionTop) / 2;
    const centre = (v: number): { dy: number; off: number } => {
      const placed = place(v, 0);
      const ds: number[] = [];
      const offs: number[] = [];
      for (const k of sole) {
        const bs = members.filter((m) => visible(m.id, frames[k])).map((m) => drawnBox(placed.get(m.id)!, lib)).filter((b): b is Box => !!b).map((b) => toScreen(b, cams[k]));
        if (!bs.length) continue;
        const cyS = (Math.min(...bs.map((b) => b.y)) + Math.max(...bs.map((b) => b.y + b.h))) / 2;
        offs.push(midY - cyS);
        ds.push((midY - cyS) / cams[k].zoom);
      }
      if (!ds.length) return { dy: 0, off: 0 };
      // minimax: the shift that minimises the WORST frame's distance from the middle (a median would sacrifice the
      // frames where the group sits on the other side: W7.1 evergreen-dns, a new L41 band)
      const mid = (a: number[]) => (Math.min(...a) + Math.max(...a)) / 2;
      return { dy: Math.round(mid(ds)), off: mid(offs) };
    };
    const shiftsAt = (v: number): number[] => {
      const c = centre(v);
      const base: readonly number[] = v === 1 ? [0] : FIT.shifts;
      if (Math.abs(c.off) < FIT.centreMinPx) return [...base];
      const toward = [1, 0.75, 0.5, 0.25].map((k) => Math.round(c.dy * k)).filter((d) => Math.abs(d * z) >= FIT.centreMinPx / 2);
      return [...new Set([...toward, ...base])];
    };
    // largest s first; at each s the group may slide vertically: first toward the free stage's centre (W7.1), then
    // FIT.shifts (world px). No zoom gain left but pill rows to re-centre or an off-centre group → s = 1.
    const hi = hi0 < FIT.minGain ? 1 : hi0;
    const offCentre = Math.abs(centre(1).off) >= FIT.centreMinPx;
    if (hi === 1 && !pillRows.length && !offCentre) {
      skipped.push({ id: subj.id, why: `zoom: already fills (target ×${target.toFixed(2)})` });
      continue;
    }
    let limit = hi === 1 ? `already fills (target ×${target.toFixed(2)}): ${pillRows.length ? "pill rows centred" : "centred"} only` : target <= cap ? "target" : "cap";
    let found: { s: number; dy: number } | null = null;
    const scales = [hi];
    for (let v = Math.floor(hi / FIT.step) * FIT.step; v >= FIT.minGain - 1e-9; v -= FIT.step) if (v < hi - 1e-9) scales.push(v);
    if ((pillRows.length || offCentre) && hi > 1) scales.push(1);
    for (const v of scales) {
      const dys = shiftsAt(v);
      for (const dy of dys) {
        const why = check(place(v, dy));
        if (why === null) {
          found = { s: v, dy };
          break;
        }
        if (dy === dys[0]) {
          trace.push(`${subj.id} zoom ×${v.toFixed(2)} dy ${dy}: ${why}`);
          if (v === hi) limit = why;
        }
      }
      if (found) break;
    }
    if (!found || (found.s === 1 && found.dy === 0 && !pillRows.length)) {
      skipped.push({ id: subj.id, why: found ? `zoom: already fills (target ×${target.toFixed(2)}), centring blocked (${limit})` : `zoom: no room (${limit})` });
      continue;
    }
    const s = Math.round(found.s * 1000) / 1000;
    commit(place(s, found.dy));
    for (const m of members) claimed.add(m.id);
    fits.push({ id: subj.id, kind: "zoom", scale: s, cx, cy: cy + found.dy, members: members.map((m) => m.id), centred: pillRows.flat(), limit });
  }

  // ── step 3 (W7.2): labels off their subject's drawing ──
  // W7.1 pilots (critic S2, lints L60): a Callout pill over the layers it names (watch-a2 b11/b12/b22), a pill on the
  // grid cells (touch b05), a status card over the grid plate's top edge (touch b16–b18). A label lives in empty stage
  // beside its subject: a Callout keeps its dot on the part and gets a library leader (props.layout) to a pill just
  // below / above / beside the subject; a pill or a card slides below / above it. First candidate that check() accepts.
  const subjectsNow = world.filter((i) => (FIT.subjects as readonly string[]).includes(i.component) && focalOf(i));
  for (const lab of world) {
    if (!(FIT.labels as readonly string[]).includes(lab.component) || exclude.has(lab.id) || pinOwner.has(lab.id)) continue;
    if (lab.component === "SourceTag" && (lab.props as { variant?: string } | undefined)?.variant === "stack") continue;
    const geo = lab.component === "Callout" ? fitCalloutGeo(lab, lib) : null;
    const pill = geo ? geo.pill : drawnBox(lab, lib);
    if (!pill) continue;
    const hits = subjectsNow
      .filter((sj) => sj.id !== lab.id && shareTime(sj.id, lab.id, FIT.shareMinF))
      .map((sj) => drawnBox(sj, lib))
      .filter((b): b is Box => !!b && overlapArea(pill, b) > FIT.labelOverlap * pill.w * pill.h);
    if (!hits.length) continue;
    const F = unionBox(hits);
    const g = FIT.labelGap;
    const cands: Inst[] = [];
    if (geo && lab.props) {
      const D = geo.dot;
      const sx = D.x + 24 + pill.w <= F.x + F.w ? 1 : -1;
      const ax = sx > 0 ? D.x + 24 : D.x - 24;
      const spots: Pt[] = [
        { x: ax, y: F.y + F.h + g + pill.h / 2 },
        { x: ax, y: F.y - g - pill.h / 2 },
        { x: F.x + F.w + g + 28, y: D.y },
        { x: F.x - g - 28, y: D.y },
      ];
      for (const sp of spots) {
        const props = { ...lab.props, layout: { dx: Math.round(sp.x - D.x), dy: Math.round(sp.y - D.y) } };
        const rel = fitCalloutGeo({ ...lab, x: 0, y: 0 }, lib, props);
        if (rel) cands.push({ ...lab, props, x: D.x - rel.dot.x, y: D.y - rel.dot.y });
      }
    } else {
      const b = drawnBox(lab, lib)!;
      cands.push({ ...lab, y: lab.y + (F.y + F.h + g - b.y) }, { ...lab, y: lab.y + (F.y - g - (b.y + b.h)) });
    }
    let why = "";
    for (const c of cands) {
      const broke = check(new Map([[lab.id, c]]));
      if (broke === null) {
        commit(new Map([[lab.id, c]]));
        const nb = drawnBox(c, lib)!;
        fits.push({ id: lab.id, kind: "label", scale: 1, cx: nb.x + nb.w / 2, cy: nb.y + nb.h / 2, members: [lab.id], centred: [], limit: geo ? "leader" : "slide" });
        why = "";
        break;
      }
      if (!why) why = broke;
    }
    if (why) skipped.push({ id: lab.id, why: `label: ${why}` });
  }
  return { world, fits, skipped, trace };
}

const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const unionBox = (bs: readonly Box[]): Box => {
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
};

// ── W7.2 camera framing (stage fill, step 0) ──────────────────────────────────────────────────────────────────
//
// W7.1 pilots on real Lambda stills: subjects at 40–70 % of the width, in the upper half, the lower stage empty —
// the director's camera targets a station centre or a hand-picked point, so the group it shows sits off the stage's
// middle, and a station of small cards (status card + pills) never grows (no sole focal SUBJECT for the local zoom).
// frameCamera() re-aims every camera HOLD (camera0 and each key after its move) at the group it shows: the union of
// every instance visible on the hold's review frames whose centre is on stage under the director's framing. The new
// target puts that group's centre on the free stage's middle (x 540, y 809); the zoom grows (never shrinks, ≤ ×1.6,
// ≤ 1.5 absolute) until the group spans FIT.fillW (840 px, so text stays ≤ 960) or the stage height. Accepted only if,
// on every review frame of the hold, the group keeps the safe zone (x 64–1016, text ≤ 960, focal y 218–1400, clear of
// the caption card), nothing that was off the stage comes on, the moves into and out of the hold keep L9 (peak ≤ 150
// px/f, a > 900 px pan only on a longPan ≥ 22 f) and the predicted slowest render chunk stays ≤ FIT.renderSecMax;
// else a smaller zoom, then centring alone, then the director's framing. Holds under tilt are left alone. Runs BEFORE
// fitWorld (whose checks then use the framed camera): targets become {x, y}, so the lint / digest timeline resolved
// from the fitted board is the render's.

export const FRAME = {
  /** Max zoom gain over the director's and the absolute cap (type stays near its designed size). */
  maxGain: 1.6,
  maxZoom: 1.5,
  /** Vertical margin inside the free stage (focalTop..captionTop) the group keeps. */
  marginY: 28,
  /** Below this gain and centre offset (screen px) the hold is left as the director framed it. */
  minGain: 1.04,
  minShiftPx: 24,
  /** = lints MAX_PEAK_PX_PER_F / LONG_PAN_PX / longPan ≥ 22 f (L9; the test pins them). */
  maxPeakPxPerF: 150,
  longPanPx: 900,
  longPanMinF: 22,
  /** = lints OFFCENTRE_PX / OFFCENTRE_SKIP (L40): the focal group's centre within this of x 540; typography skipped. */
  offCentrePx: 60,
  offCentreSkip: ["KineticWord", "Stamp"] as readonly string[],
  /** = lints DUP_CAM_ZOOM / DUP_CAM_PX (L43 "same picture" camera): a director's move may not be framed away. */
  dupZoom: 0.06,
  dupPx: 40,
  /** = lints DUP_STILL_LOOKBACK (L28): a still is compared with this many beats before it. */
  dupLookback: 2,
  /** = lints EMPTY_BAND_SHARE (L41): an empty band of the focal stage may not newly exceed this share. */
  emptyBandShare: 0.55,
} as const;

export interface CameraFrame {
  /** "camera0" or "<beatId>.<keyIndex>". */
  key: string;
  zoom: number;
  /** Director's zoom. */
  was: number;
  /** World centre of the framed group. */
  cx: number;
  cy: number;
  members: string[];
}

/** Camera holds: camera0 up to the first key, then each key from the end of its move to the next key. */
function cameraHolds(tl: Pick<Timeline, "cameraSegments" | "durationF" | "camera0">): { key: string; seg: number; start: number; end: number; cam: CamState }[] {
  const segs = tl.cameraSegments;
  const out = [{ key: "camera0", seg: -1, start: 0, end: segs[0]?.startF ?? tl.durationF, cam: tl.camera0 }];
  segs.forEach((s, i) => out.push({ key: `${s.beatId}.${s.keyIndex}`, seg: i, start: s.endF, end: segs[i + 1]?.startF ?? tl.durationF, cam: s.to }));
  return out;
}

/** L9 trouble of one move (0 = fine): peak over the cap, or a long pan on a short / non-longPan move. */
function moveTrouble(s: CameraSegment | undefined): number {
  if (!s || s.transition === "hardCut") return 0;
  const peak = Math.max(0, s.peakPxPerF - FRAME.maxPeakPxPerF);
  const pan = s.panPx > FRAME.longPanPx && (s.ease !== "longPan" || s.durF < FRAME.longPanMinF) ? s.panPx - FRAME.longPanPx : 0;
  return peak + pan;
}

/** Components whose drawn plate hugs its text, centred in a wider footprint (StatusCard): the frame step first shrinks
 *  the footprint onto the widest plate the instance ever draws (base + every override), about the same centre — no
 *  visible change, but the safe-zone lints (which read footprints) then measure what is drawn. */
export const HUG_TIGHTEN: readonly string[] = ["StatusCard"];

export function tightenHugs(sb: Storyboard, tl: Pick<Timeline, "events">, lib: FootprintLookup): Storyboard {
  let changed = false;
  const world = sb.world.map((i) => {
    if (!HUG_TIGHTEN.includes(i.component) || !i.props) return i;
    const box = instanceBox(i, lib);
    const cf = lib[i.component]?.contentFor;
    if (!box || !cf) return i;
    const variants = [i.props];
    for (const e of tl.events) if (e.kind === "action" && e.target === i.id && e.props) variants.push({ ...variants[variants.length - 1], ...e.props });
    const pw = Math.max(...variants.map((v) => cf(v, i.w)?.w ?? box.w));
    const own = box.w / (i.scale ?? 1);
    if (!(pw < own - 1) || pw < 60) return i;
    changed = true;
    const w = Math.ceil(pw);
    return { ...i, x: i.x + ((own - w) / 2) * (i.scale ?? 1), w };
  });
  return changed ? { ...sb, world } : sb;
}

export function frameCamera(sb: Storyboard, words: WordsFileT | null | undefined, lib: FootprintLookup): { sb: Storyboard; framed: CameraFrame[]; skipped: { key: string; why: string }[]; trace: string[] } {
  /** One line per rejected candidate (diagnostics: scripts / tests). */
  const trace: string[] = [];
  let cur = tightenHugs(sb, resolveTimeline(sb, words, lib), lib);
  let tl = resolveTimeline(cur, words, lib);
  const framed: CameraFrame[] = [];
  const skipped: { key: string; why: string }[] = [];
  const S = FIT.safe;
  const midY = (S.focalTop + S.captionTop) / 2;
  const t0 = predictChunkMax(cur, tl, lib);
  const allowed = t0 > FIT.renderSecMax ? t0 + 0.01 : FIT.renderSecMax;
  const focalOf = (i: InstanceT) => i.focal ?? lib[i.component]?.focal ?? true;
  const holds = cameraHolds(tl);
  const tlDir = tl;
  /** = lints SAME_CAM (L28 / L43). */
  const sameLint = (a: CamState, b: CamState) => Math.abs(a.zoom / b.zoom - 1) <= FRAME.dupZoom && Math.hypot(a.x - b.x, a.y - b.y) * a.zoom <= FRAME.dupPx && Math.abs(a.tiltX - b.tiltX) <= 1;
  /** The last hold framed: its member set, the director's camera and the framed one (a run of holds on the same group
   *  keeps the director's relative moves — a push-in stays a push-in, never collapses into one framing: L43). */
  type Framed = { h: number; members: string; dir: CamState; now: { x: number; y: number; zoom: number } };
  let last: Framed | null = null;
  /** Every framed hold by index (a director-held framing follows the framed hold it repeats, within the L28 lookback),
   *  and every hold's focal set (a repeat only matters for the same picture: L28 compares near-identical stills). */
  const framedAt = new Map<number, Framed>();
  const focalAt = new Map<number, string>();
  for (let h = 0; h < holds.length; h++) {
    const hold = cameraHolds(tl)[h];
    const vis = fitVisibility(cur, tl);
    const frames = fitFrames(tl).filter((f) => f >= hold.start && f < hold.end);
    if (!frames.length || hold.cam.tiltX) continue;
    const visibleAt = (id: string, f: number) => {
      const v = vis.get(id)!;
      return f >= v.from && f < v.to;
    };
    // the group: instances on the hold's frames whose box centre is on stage under the director's framing
    const boxes = new Map<string, Box>();
    for (const i of cur.world) {
      const b = drawnBox(i, lib);
      if (!b || !frames.some((f) => visibleAt(i.id, f))) continue;
      const sc = toScreen(b, hold.cam);
      const c = { x: sc.x + sc.w / 2, y: sc.y + sc.h / 2 };
      if (c.x >= 0 && c.x <= WIDTH && c.y >= S.focalTop && c.y <= S.captionTop) boxes.set(i.id, b);
    }
    const members = cur.world.filter((i) => boxes.has(i.id));
    const memberKey = members.map((m) => m.id).join(",");
    const hasGraph = members.some((m) => m.component === "NodeGraph");
    if (!members.some(focalOf)) continue;
    const U = unionBox([...boxes.values()]);
    // x: the focal group's centre (L40 reads it; typography excluded) on x 540, as far as the whole group still fits
    const fb = members.filter((m) => focalOf(m) && !FRAME.offCentreSkip.includes(m.component)).map((m) => boxes.get(m.id)!);
    const fcx = fb.length ? (Math.min(...fb.map((b) => b.x)) + Math.max(...fb.map((b) => b.x + b.w))) / 2 : U.x + U.w / 2;
    const txFor = (z: number) => {
      const lo = U.x + U.w - (S.textRight - CAM_ANCHOR.x) / z;
      const hi = U.x + (CAM_ANCHOR.x - S.left) / z;
      return lo <= hi ? Math.min(hi, Math.max(lo, fcx)) : U.x + U.w / 2;
    };
    const cy = U.y + U.h / 2;
    const z0 = hold.cam.zoom;
    type Cand = { x: number; y: number; zoom: number };
    const cands: Cand[] = [];
    // the hold before was framed and this one shows the same group, or the director held the framing (a move the
    // lints read as none): keep the director's move relative to the framed hold
    // the director repeats an earlier framing (L28 compares a still with the DUP_STILL_LOOKBACK beats before it):
    // follow that hold's framing exactly
    const focalKey = members.filter(focalOf).map((m) => m.id).join(",");
    focalAt.set(h, focalKey);
    const repeats = (j: number) => j >= 0 && focalAt.get(j) === focalKey && sameLint(holds[j].cam, hold.cam);
    const rep = [h - 1, h - 2].map((j) => (repeats(j) ? (framedAt.get(j) ?? null) : null)).find((x) => x) ?? null;
    const repDir = [h - 1, h - 2].some(repeats);
    const held = !!rep;
    if (repDir && !rep) continue; // it repeats a hold left as the director framed it: leave this one too
    const run = rep ?? (last && last.h === h - 1 && last.members === memberKey ? last : null);
    if (run) {
      // same group as the hold before: keep the director's move relative to it (then the plain framing below)
      const k = z0 / run.dir.zoom;
      cands.push({ x: run.now.x + (hold.cam.x - run.dir.x), y: run.now.y + (hold.cam.y - run.dir.y), zoom: run.now.zoom * k });
    }
    // … nor a held framing into a move (L28 would lose a duplicate still): a director-held framing follows the framed
    // hold before it (the relative candidate) or stays as it was
    if (!held) {
      const zFill = Math.min(FIT.fillW / (U.w * (1 + HOLD_DRIFT)), (S.captionTop - S.focalTop - 2 * FRAME.marginY) / U.h, FRAME.maxZoom, z0 * FRAME.maxGain);
      const hiZ = Math.max(z0, zFill);
      // y: a group that BUILDS over the hold (a card, then its pills) is centred minimax over the hold's frames — the
      // worst frame's visible part as close to the stage middle as the full group allows (W7.1 hook: one card at the
      // top of an empty stage for three beats); then the whole group's centre
      const cys = frames
        .map((f) => members.filter((m) => visibleAt(m.id, f)).map((m) => boxes.get(m.id)!))
        .filter((bs) => bs.length)
        .map((bs) => {
          const u = unionBox(bs);
          return u.y + u.h / 2;
        });
      const cyMid = cys.length ? (Math.min(...cys) + Math.max(...cys)) / 2 : cy;
      const ys = Math.abs(cyMid - cy) > 1 ? [cyMid, cy] : [cy];
      for (let z = hiZ; z > z0 + 1e-6; z = Math.round((z - 0.04) * 1000) / 1000) for (const y of ys) cands.push({ x: txFor(z), y: y + (CAM_ANCHOR.y - midY) / z, zoom: z });
      for (const y of ys) cands.push({ x: txFor(z0), y: y + (CAM_ANCHOR.y - midY) / z0, zoom: z0 });
    }

    const shiftOf = (c: Cand) => Math.hypot((c.x - hold.cam.x) * c.zoom, (c.y - hold.cam.y) * c.zoom);
    const segBefore = hold.seg;
    const segAfter = hold.seg + 1 < tl.cameraSegments.length ? hold.seg + 1 : -1;
    const trouble0 = moveTrouble(tl.cameraSegments[segBefore]) + (segAfter >= 0 ? moveTrouble(tl.cameraSegments[segAfter]) : 0);
    // overshoot of a screen box against the stage (px), per rule; a member's may not grow, an outsider may not come on
    // (per rule: L3 safe zone, text ≤ 960, header band, caption line, caption card — none may grow)
    const over = (sc: Box, focal: boolean, cap: Box | null): number[] => [
      Math.max(0, S.left - sc.x, sc.x + sc.w - S.right, S.top - sc.y, sc.y + sc.h - S.bottom),
      Math.max(0, sc.x + sc.w - S.textRight),
      Math.max(0, S.focalTop - sc.y),
      focal ? Math.max(0, sc.y + sc.h - S.captionTop) : 0,
      cap && sc.x < cap.x + cap.w && sc.x + sc.w > cap.x && sc.y < cap.y + cap.h && sc.y + sc.h > cap.y ? 1 : 0,
    ];
    // mid-move frames are transit (L3 reads settled frames only; L23 warns): there only the caption line / card count
    const worse = (n: number[], a: number[], moving: boolean) => n.some((v, k) => (!moving || k >= 3) && v > a[k] + 0.5 * (k < 4 ? 1 : 0));
    /** L40 input: the focal (non-typography) group's screen centre offset from x 540 on frame f under camera c. */
    const offX = (f: number, c: CamState, world: readonly InstanceT[] = cur.world) => {
      const bx = world.filter((i) => visibleAt(i.id, f) && focalOf(i) && !FRAME.offCentreSkip.includes(i.component)).map((i) => drawnBox(i, lib)).filter((b): b is Box => !!b).map((b) => toScreen(b, c)).filter(onViewport);
      return bx.length ? Math.abs((Math.min(...bx.map((b) => b.x)) + Math.max(...bx.map((b) => b.x + b.w))) / 2 - CAM_ANCHOR.x) : 0;
    };
    /** L41 input: the tallest empty horizontal band of the focal stage on frame f under camera c (every item drawn). */
    const gapY = (f: number, c: CamState, world: readonly InstanceT[] = cur.world) => {
      const iv = world
        .filter((i) => visibleAt(i.id, f))
        .map((i) => drawnBox(i, lib))
        .filter((b): b is Box => !!b)
        .map((b) => toScreen(b, c))
        .filter(onViewport)
        .map((b) => [Math.max(S.focalTop, b.y), Math.min(S.captionTop, b.y + b.h)] as const)
        .filter(([a, b]) => b > a)
        .sort((a, b) => a[0] - b[0]);
      let at: number = S.focalTop;
      let gap = 0;
      for (const [a, b] of iv) {
        gap = Math.max(gap, a - at);
        at = Math.max(at, b);
      }
      return Math.max(gap, S.captionTop - at);
    };
    let why = "";
    let done = false;
    for (const cand of cands) {
      const z = Math.round(cand.zoom * 1000) / 1000;
      if (z < 0.6 || z > 2.2) continue;
      if (z / z0 < FRAME.minGain && shiftOf(cand) < FRAME.minShiftPx && !(run && cand === cands[0])) break;
      if (held && cand !== cands[0]) break;
      // a NodeGraph grows best through its own drawn layout (fitWorld step 1, which needs room around it): a hold on
      // a graph is re-aimed only for a real zoom gain, never just re-centred
      if (hasGraph && z / z0 < FRAME.minGain && !(run && cand === cands[0])) continue;
      const target = { x: Math.round(cand.x), y: Math.round(cand.y) };
      const next = withHoldCamera(cur, tl, hold.seg, target, z);
      if (!next) break;
      const nextById = new Map(next.world.map((i) => [i.id, i]));
      const tl2 = resolveTimeline(next, words, lib);
      // the lints' "same camera" (L28 / L43) between this hold and the one before stays what the director made it:
      // the framing never turns a move into a hold (a hidden move = a new L43 run) …
      const prevNow = h > 0 ? cameraHolds(tl2)[h - 1].cam : null;
      const prevDir = h > 0 ? holds[h - 1].cam : null;
      const nowCam = cameraHolds(tl2)[h].cam;
      if (prevNow && prevDir && !sameLint(prevDir, hold.cam) && sameLint(prevNow, nowCam)) {
        trace.push(`${hold.key} ×${(z / z0).toFixed(2)}: same framing as the hold before`);
        if (!why) why = `×${(z / z0).toFixed(2)}: hides the move from the hold before`;
        continue;
      }
      let bad = "";
      // every review frame the change can reach: the hold and the moves into and out of it
      const from = segBefore >= 0 ? tl.cameraSegments[segBefore].startF : 0;
      const to = segAfter >= 0 ? tl.cameraSegments[segAfter].endF : tl.durationF;
      for (const f of fitFrames(tl).filter((x) => x >= from && x < to)) {
        const c1 = cameraAt(tl, f);
        const c2 = cameraAt(tl2, f);
        const cap = captionCardAt(tl2, f);
        for (const i of cur.world) {
          if (!visibleAt(i.id, f)) continue;
          const b = drawnBox(i, lib);
          const b2 = drawnBox(nextById.get(i.id)!, lib);
          if (!b || !b2) continue;
          const a = toScreen(b, c1);
          const n = toScreen(b2, c2);
          // anything on the frame keeps (or improves) its standing; nothing off the frame comes on (L3 / L23 read
          // every instance on the viewport)
          if (onViewport(n)) {
            if (!onViewport(a) && !(c1.moving || c2.moving)) bad = `f${f}: ${i.id} comes into view`;
            else if (worse(over(n, focalOf(i), cap), over(a, focalOf(i), captionCardAt(tl, f)), c1.moving || c2.moving)) bad = `f${f}: ${i.id} leaves the stage`;
          }
          if (bad) break;
        }
        if (!bad && offX(f, c2, next.world) > Math.max(FRAME.offCentrePx, offX(f, c1) + 0.5)) bad = `f${f}: focal group off-centre (L40)`;
        if (!bad && !c2.moving && gapY(f, c2, next.world) > Math.max(FRAME.emptyBandShare * (S.captionTop - S.focalTop), gapY(f, c1) + 0.5)) bad = `f${f}: empty stage band (L41)`;
        if (bad) break;
      }
      if (!bad && moveTrouble(tl2.cameraSegments[segBefore]) + (segAfter >= 0 ? moveTrouble(tl2.cameraSegments[segAfter]) : 0) > trouble0 + 0.5) bad = "camera move speed (L9)";
      if (!bad && predictChunkMax(next, tl2, lib) > allowed) bad = "render time";
      if (bad) {
        if (!why) why = `×${(z / z0).toFixed(2)}: ${bad}`;
        trace.push(`${hold.key} ×${(z / z0).toFixed(2)} (${target.x},${target.y}): ${bad}`);
        continue;
      }
      cur = next;
      tl = tl2;
      framed.push({ key: hold.key, zoom: z, was: z0, cx: Math.round(U.x + U.w / 2), cy: Math.round(cy), members: members.map((m) => m.id) });
      last = { h, members: memberKey, dir: hold.cam, now: { ...target, zoom: z } };
      framedAt.set(h, last);
      done = true;
      break;
    }
    if (!done && why) skipped.push({ key: hold.key, why });
  }
  return { sb: cur, framed, skipped, trace };
}

/** The storyboard with hold `seg`'s camera (camera0 when -1) re-aimed at `target` with `zoom`; null = not found. */
function withHoldCamera(sb: Storyboard, tl: Pick<Timeline, "cameraSegments">, seg: number, target: { x: number; y: number }, zoom: number): Storyboard | null {
  if (seg < 0) return { ...sb, camera0: { ...(sb.camera0 ?? { tiltX: 0 }), target, zoom } };
  const s = tl.cameraSegments[seg];
  const beat = sb.beats[s.beatIndex];
  if (!beat?.camera[s.keyIndex]) return null;
  return { ...sb, beats: sb.beats.map((b, i) => (i === s.beatIndex ? { ...b, camera: b.camera.map((k, j) => (j === s.keyIndex ? { ...k, target, zoom } : k)) } : b)) };
}

/**
 * The storyboard to render: the camera framed on what each hold shows (frameCamera), then fitWorld over that camera —
 * fitted world, and every camera target `{ instance }` of a moved instance pinned to that instance's ORIGINAL box
 * centre, so the camera path is frameCamera's. `fits` = what fitWorld changed; `framed` = the re-aimed holds.
 */
export function fitStoryboard(sb: Storyboard, words: WordsFileT | null | undefined, lib: FootprintLookup): { sb: Storyboard; fits: StageFit[]; skipped: { id: string; why: string }[]; framed?: CameraFrame[] } {
  const fc = frameCamera(sb, words, lib);
  const framed = fc.framed;
  sb = fc.sb;
  const tl = resolveTimeline(sb, words, lib);
  const { world, fits, skipped } = fitWorld(sb, tl, lib);
  if (!fits.length) return { sb, fits, skipped, framed };
  const moved = new Set(fits.flatMap((f) => f.members.concat(f.centred)));
  const pin = (t: CameraTargetT): CameraTargetT => {
    if (!("instance" in t) || !moved.has(t.instance)) return t;
    const inst = sb.world.find((i) => i.id === t.instance);
    const b = inst ? instanceBox(inst, lib) : null;
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : t;
  };
  return {
    sb: {
      ...sb,
      world,
      ...(sb.camera0 ? { camera0: { ...sb.camera0, target: pin(sb.camera0.target) } } : {}),
      beats: sb.beats.map((b) => (b.camera.some((c) => "instance" in c.target && moved.has(c.target.instance)) ? { ...b, camera: b.camera.map((c) => ({ ...c, target: pin(c.target) })) } : b)),
    },
    fits,
    skipped,
    framed,
  };
}
