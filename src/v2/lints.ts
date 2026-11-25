// v2 storyboard lints that need no rendering (ADR-001 §6; numbering L1..L22 where it maps; L23–L27 W3.1, L28–L32 W3.2, L37–L43 W5 over the visual digest, L50–L52 + L56–L57 W7/W7.1 lintsW7.ts, L53–L55 W7 lintsPhysical.ts, L58–L61 W7.2 lintsW72.ts, L62–L63 W7.3 lintsW73.ts,
// L46–L49 W5.1 number-true quantities / cell meaning / list highlights / inverted fragments; since W5.1 over the stage-fitted board the renderer draws). Pure TypeScript, $0, run
// on every save_storyboard. Everything frame-based goes through resolveTimeline(), so a lint frame is the rendered
// frame. Render-dependent checks (pixel census, φ from blur probes, post-render QA) live elsewhere and feed `opts`.
//
// Severity: "block" = the storyboard cannot be saved/rendered; "error" = must be fixed before the Script card;
// "warn" = shown on the card. `ok` = no block and no error.

import { findBadGlyphs, GLYPH_EXTRA, glyphAllowed, onScreenStrings } from "./glyphs.js";
import { framesPerLambda, MAX_RENDERERS, MIN_FRAMES_PER_LAMBDA } from "./render-plan.js";
import { LIBRARY_LOOKUP, metaFor, parseInstanceProps, rejectedOverrides } from "./library.js";
import { calloutGeometry, calloutPillW, type CalloutPropsT } from "./components-meta/Callout.js";
import { pointerGeometry, type PointerArrowPropsT } from "./components-meta/PointerArrow.js";
import { edgeSegments, edgeStateOf, graphMetrics, NODE_GRAPH, nodeCentre, nodeOutline, type NodeGraphPropsT } from "./components-meta/NodeGraph.js";
import type { TimelinePropsT } from "./components-meta/Timeline.js";
import { fieldClockMs, presetForTopic } from "./fieldFamilies.js";
import { LIBRARY_HASH, LIBRARY_VERSION } from "./registry.gen.js";
// W3.3: L11 and the summary print the pace every other surface prints (rubric R8, card, script.md).
import { PACE_METRIC, spokenWords } from "../schema/script.v2.js";
import { countFigNodes, parseStoryboard, SERIES, type BeatT, type InstanceT, type Storyboard, type WordsFileT } from "../schema/storyboard.v2.js";
import {
  actionFlight,
  actionsByInstance,
  cameraAt,
  type Box,
  figNodeBox,
  DISPLAY_MAX_PX,
  ESTIMATE_WPS,
  type FootprintLookup,
  HEIGHT,
  instanceBox,
  MAX_DISPLAY_WORDS,
  normToken,
  RENDER_T0,
  RENDER_T_SAMPLE,
  fitStoryboard,
  resolveTimeline,
  samplesAt,
  type Timeline,
  type TimelineBeat,
  toScreen,
  tokenize,
  WIDTH,
  type CamState,
  CAM_ANCHOR,
} from "./timeline.js";
import { nearestAnchor, registrySfxLookup, SFX_ANCHOR_TOL_F, sfxAnchors } from "./sfx-anchors.js";
import { BOX_CELLS, beatSnapshots, boxCellKinds, boxReadout, type BeatSnapshot, digestItem, drawnTexts, meterReadout, type OnScreen, rawPropsAt, settledFrame, stateAt, visibility } from "./visualDigest.js";
import { CONTAINER_BOX_STATES, type ContainerBoxState, ignoredValue, parseLimit } from "./components-meta/ContainerBox.js";
import { parseQuantity, QTY_UNITS, type Quantity } from "./components-meta/Meter.js";
import { formatValue, heroText } from "./components-meta/HeroStat.js";
import { colourPolarityIssues, ctaHeroIssues, headerProductIssues, kineticIssues, persistentVisualIssues } from "./lintsW7.js";
import { physicalTruthIssues } from "./lintsPhysical.js";
import { actHeaderIssues, colourRoleIssues, craftIssues, keywordChangeIssues } from "./lintsW72.js";
import { drawingHonestyIssues, keyStepIssues } from "./lintsW73.js";

export type Severity = "block" | "error" | "warn";
export interface LintResult {
  id: string;
  severity: Severity;
  message: string;
  beatId?: string;
  path?: string;
  frame?: number;
  /** Machine-applicable proposal (W3.2): `path` in the storyboard (e.g. "cover", "world.c1") and the value to merge. */
  fix?: { path: string; value: Record<string, unknown> };
}
export interface LintReport {
  ok: boolean;
  blocked: boolean;
  counts: Record<Severity, number>;
  results: LintResult[];
  storyboard?: Storyboard;
  timeline?: Timeline;
  /** Summary numbers for the Script card. */
  stats?: { durationSec: number; durationF: number; words: number; wordsPerSec: number; displayPhrases: number; hardCuts: number; glitches: number; renderTmaxSec: number; sfx: number; phiMeasured: boolean };
}
export interface LintOptions {
  /** Component registry (default: the generated registry + shipped metas, src/v2/library.ts). */
  lib?: FootprintLookup;
  /** World-weight factor from the blur probes (L18). Omitted → 1 for dev, and the report says "φ unmeasured"
   *  (ADR §6 W2 caveat: the 32-sample constants are extrapolated until the first production reel measures φ). */
  phi?: number;
  /** W0: the render's output rate (L18 predicts on output frames). Default OUTPUT_FPS, so the director's submit /
   *  review lints, the stills gate and the final render all judge L18 at the rate that will actually render (a board
   *  can no longer pass at 30 and warn/block only after ✅ at 60). 30 = the author rate (unchanged v2 L18). */
  outputFps?: OutputFps;
  /** LIBRARY_HASH of the pinned site (L15). Omit to skip the hash check. */
  pinnedLibraryHash?: string;
  /** Allow up to 6 hard cuts inside TTS gaps (owner option in ADR L8). Default false → ≤2. */
  allowGapCuts?: boolean;
  /** W5.1: false = lint the director's layout as written; default = the stage-fitted layout the renderer draws. */
  fit?: boolean;
  /** W7.2: the script's track (the director passes it): "how-it-works" requires act header labels (L58). */
  track?: "root-cause" | "how-it-works";
  /** W7.3: the script's KEY STEP beat (script.story.outline[].key; the director passes it): L62 holds it to a drawn
   *  change of the focal subject that matches its words (how-it-works). */
  keyStep?: string;
}

// Constants (bible §1, ADR §6, D1)
export const SAFE = { left: 64, right: 1016, top: 150, bottom: 1560, textRight: 960 } as const;
/** Header band (solid top band, D1 #11: header ≈184 px on a band to ≈218 px). */
export const HEADER_BAND_BOTTOM = 218;
/** Subtitle card top for a one-line card (1520 − (46·1.25 + 2·28)). Focal boxes stay above it. */
export const SUBTITLE_TOP = 1406;
export const DURATION_SEC = { min: 60, max: 80 } as const;
export const MAX_DURATION_F = 2400;
export const WPS_BAND = { min: 2.5, max: 3.4 } as const;
export const KEYWORD_TOL_F = 3;
export const KEYWORD_TOL_WHISPER_F = 4;
export const CUT_ONSET_TOL_F = 4;
export const MAX_HARD_CUTS = 2;
export const MAX_GLITCH = 3;
export const MAX_FOCAL = 3;
export const MAX_FIGURES_VISIBLE = 2;
export const CTA_MAX_WORDS = 7;
export const MAX_PEAK_PX_PER_F = 150;
export const LONG_PAN_PX = 900;
export const L18_BLOCK_SEC = 262;
export const L18_WARN_SEC = 220;
/** W0 (v3 ADR-002 §10): the rates the Explainer renders at. 30 = the author rate (default, every v2 render so far). */
export type OutputFps = 30 | 60;
/** W0: THE output-rate switch of the final render (30 = off; 60 = the time-base wrapper). Owner decision D1 5c: stays
 *  30 until the owner has seen the 60 fps A/B on the phone and Instagram playback is confirmed. It lives here (not in
 *  render.ts, which re-exports it) so every lintStoryboard caller defaults to the rate that renders. src/ cannot import
 *  remotion/ (tsconfig.build rootDir), so the composition gets it as inputProps.outputFps from render.ts. */
export const OUTPUT_FPS: OutputFps = 30;
/** Blur sub-samples per OUTPUT frame when one output frame spans 1/mul author frames (R6 "thr3" rule: the screen speed
 *  per output frame halves at 60 fps, so n = max(8, ceil(n30 / mul)) whenever the author frame blurs). mul 1 = n30.
 *  Mirrors remotion/v2/WeightedMotionBlur.tsx samplesForSpan (parity test, test/v3-w0-*.test.ts). */
export function outputBlurSamples(n30: number, mul: number): number {
  return mul === 1 || n30 <= 1 ? n30 : Math.max(8, Math.ceil(n30 / mul));
}
/** W0: L18 calibration at 60 fps (research/v3/W0/run-*.log, l18-scan.ts). Uncalibrated, the per-output-frame model predicts a
 *  slowest chunk 1.39× the 30 fps one on TLS and 1.32× on ANC (jobs/_dev/w71/anc); the like-for-like Lambda renders
 *  took TLS 1.94× (R6 V8/V9 225.0 / 116.1 s) and 1.57× (W0 187.8 / 119.5 s), ANC 1.47× (W0 182.4 / 124.4 s). Implied
 *  cal = real ratio / model ratio: 1.94 / 1.39 = 1.40, 1.57 / 1.39 = 1.13, 1.47 / 1.32 = 1.11. We take the WORST
 *  measured (≈ 1.39–1.40), so at 60 fps L18 over- rather than under-predicts: TLS predicts 425 s, ANC 444 s (warn).
 *  Over all 72 saved v2 boards the uncalibrated 60/30 ratio is 1.32–1.44, × 1.39 = 1.84–2.00 ≤ the ×2 thresholds, so
 *  a board the timeline fit holds at ≤ 220 s (30 fps) predicts ≤ 440 s at 60 fps — never a 60 fps block. */
export const L18_FPS60_CAL = 1.39;
/** W0: at 60 fps the L18 thresholds are this many times the 30 fps ones (block 524 / warn 440 model s ≈ 280 / 235 s
 *  real at the measured φ ≈ 0.52–0.54 — and real is lower still, since the cal above is the worst case — < ½ of the
 *  600 s function timeout). The 30 fps thresholds keep their meaning. x264 "slow" (W0) costs real time the 32-sample
 *  constants were not fitted on: TLS 108.4 → 119.5 s (+10 %), ANC 104.5 → 124.4 s (+19 %, single runs, Lambda noise is
 *  ±40 % between runs of similar boards), i.e. measured φ 0.49 → 0.54 (TLS) and 0.43 → 0.52 (ANC) — still ≈ ½ of the φ = 1
 *  default, so the gate keeps its margin; re-measure φ on the first live W0 reel. */
export const L18_FPS60_THRESHOLD_MUL = 2;
/** L18 block / warn thresholds (model s) for an output rate. */
export function l18Thresholds(outputFps: OutputFps = 30): { block: number; warn: number } {
  const k = outputFps === 30 ? 1 : L18_FPS60_THRESHOLD_MUL;
  return { block: L18_BLOCK_SEC * k, warn: L18_WARN_SEC * k };
}
/** Renderer count used by L18 = the real render layout (render-plan.ts). */
export const RENDERERS = MAX_RENDERERS;
/** Frames a scramble / count-up / enter needs to settle (HeroStat: one digit per 2 f from f4; scramble 6–8 f). */
export const SETTLE_F = 24;
/** L21: frames a flight must be on screen (amendments §7 motion.flightMinOnscreenF). */
export const FLIGHT_MIN_ONSCREEN_F = 8;
/** Font cmap allow-list (L19): ONE definition in src/v2/glyphs.ts, shared with remotion/v2/theme.ts and the render guard. */
export { GLYPH_EXTRA, glyphAllowed };
/** Stamp shake ↔ Stamp entrance pairing window (frames) for L10. */
export const STAMP_SHAKE_PAIR_F = 3;
/** Amendments §1/§T layout tokens used by L23 (layout.focal.bottom, layout.caption, layout.hairlineY). */
export const FOCAL_BOTTOM = 1400;
export const CAPTION = { left: 64, bottom: 1520, maxW: 886, padX: 36, padY: 28, linePx: 46 * 1.25 } as const;
export const CAPTION_CARD_H = Math.ceil(CAPTION.linePx + 2 * CAPTION.padY); // 114 → top 1406 (= SUBTITLE_TOP)
export const HAIRLINE_Y = 1560;
/** L23 clip region: below the header band, above the footer hairline, inside the frame. */
export const CLIP_REGION = { x0: 0, x1: WIDTH, y0: HEADER_BAND_BOTTOM, y1: HAIRLINE_Y } as const;
/** L24: warn when one component is more than this share of the world (W3 r3: 11 of 20 instances were StatusCards). */
export const MONOCULTURE_SHARE = 0.4;
export const MONOCULTURE_MIN_INSTANCES = 6;
/** Frames after the keyword the stills review (ADR stills: keywordF + 6). */
export const STILL_OFFSET_F = 6;
/** L23: an instance entering on this frame is still near-transparent for this many frames (entrance spring). */
export const ENTER_GRACE_F = 3;
/** L28: two beats' review stills read as the same frame when ≥ this share of the on-screen content is unchanged
 *  (same instance, same box, same persistent state) under the same camera; compared with the previous LOOKBACK beats.
 *  W3.1 event-recent: b05 / b15 (pulse only) and b09 (b07's graph state again) = 100 %. NOT lower: b03 there (a pills
 *  row entering under the held 404 card, 90 % unchanged) has the same shape as the golden OOMKill fixture's b04 (a
 *  SourceTag entering under its held cards, 93 %), so a build-up beat that adds one small element is not flagged. */
export const DUP_STILL_SHARE = 0.95;
export const DUP_STILL_LOOKBACK = 2;
/** L28 "same camera": zoom within 6 %, target within 40 screen px. */
export const DUP_CAM_ZOOM = 0.06;
export const DUP_CAM_PX = 40;
/** L29: a NodeGraph should fill ≥ 70 % of the content width (or of the focal height, for a tall chain) at its best
 *  beat. W3.1 event-recent: the graph's nodes spanned ≈ 577 of 952 px (61 %) at zoom 0.9 and read small. */
export const GRAPH_MIN_FILL = 0.7;
export const CONTENT_W = SAFE.right - SAFE.left; // 952
export const FOCAL_H = FOCAL_BOTTOM - HEADER_BAND_BOTTOM; // 1182
/** L30: an edge end further than this from its node outline is not docked on the node. */
export const EDGE_DOCK_TOL = 3;
/** L31: a clock Timeline's bar span and its pill / bracket duration may differ by at most this factor. */
export const TIMELINE_SPAN_TOL = 1.5;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const HEADER_RE = {
  // Amendments §3b. EVENT `MMM DD YYYY · PHASE`; SPEC `<SOURCE ID> · <YEAR|STEP n/m>`; CLOCK `T+<n> <unit> · <STAGE>`.
  EVENT: /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{2}) (\d{4}) · [A-Z][A-Z ]*$/,
  // W7.2: or the how-it-works act form `STEP n/m · <ACT>` (lintsW72.ts actHeaderIssues holds that track to it)
  SPEC: /^(?:[A-Z0-9][A-Z0-9 .:/+-]* · (?:\d{4}|STEP \d+\/\d+)|STEP \d+\/\d+ · [A-Z][A-Z0-9 .:/+-]*)$/,
  CLOCK: /^T\+\d+(?:\.\d+)? (?:MS|S|MIN|H|D) · [A-Z0-9][A-Z0-9 .:/+-]*$/,
} as const;
const HEADER_FORMAT = { EVENT: "MMM DD YYYY · PHASE", SPEC: "<SOURCE ID> · <YEAR|STEP n/m> or STEP n/m · <ACT>", CLOCK: "T+<n> <unit> · <STAGE>" } as const;

/** Spoken number words that need a source (L16). "one" is excluded: too common as a pronoun. */
const NUMBER_WORDS = new Set([
  "zero", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million", "millions", "billion", "billions", "trillion", "percent", "twice", "half", "double", "triple",
]);
/** A digit not glued to a preceding letter, hyphen or underscore ("node-3", "x86", "v2" are names, not numbers). */
const NUMERIC = /(?<![\p{L}\p{N}_-])\d/u;

export function hasNumber(text: string): boolean {
  return NUMERIC.test(text) || tokenize(text).some((t) => NUMBER_WORDS.has(normToken(t)));
}

export function glyphOk(ch: string): boolean {
  return glyphAllowed(ch.codePointAt(0)!);
}

function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsIn(x, out));
  return out;
}

const iou = (a: Box, b: Box) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = x * y;
  return i / (a.w * a.h + b.w * b.h - i || 1);
};
/** Footer hairline y (amendments §1): below it the platform UI covers the world. */
const STAGE_BOTTOM = 1560;
/** Box overlaps the stage (above the footer hairline). */
const intersectsStage = (b: Box) => b.x < WIDTH && b.x + b.w > 0 && b.y < STAGE_BOTTOM && b.y + b.h > 0;
const intersectsViewport = (b: Box) => b.x < WIDTH && b.x + b.w > 0 && b.y < HEIGHT && b.y + b.h > 0;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Camera tilt as the renderer applies it (remotion/v2/camera.ts tiltTransform): `perspective(1600px) rotateX(t°)`
 *  around the stage centre (CAM_ANCHOR), t clamped to 0–25°, flat at ≤ 0.01°. */
export const TILT_PERSPECTIVE_PX = 1600;
export const MAX_TILT_DEG = 25;

/**
 * World box → screen box, INCLUDING the camera tilt (W3.1 minor: timeline.toScreen ignores tiltX, so on a tilted beat
 * the projected boxes were wrong, worst near the bottom edge where the caption sits). Each corner goes through the same
 * transform as the rendered plane: flat camera (toScreen), then rotateX about the stage centre (y' = dy·cos t,
 * z' = dy·sin t, towards the viewer for dy > 0) and the 1600 px perspective (scale P / (P − z')); the result is the
 * corners' bounding box. A flat camera returns toScreen exactly. (The 3 f Stamp shake, ±6 px, is not modelled.)
 */
export function projectBox(b: Box, c: CamState): Box {
  const flat = toScreen(b, c);
  const t = Math.max(0, Math.min(MAX_TILT_DEG, c.tiltX));
  if (t <= 0.01) return flat;
  const th = (t * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of [[flat.x, flat.y], [flat.x + flat.w, flat.y], [flat.x, flat.y + flat.h], [flat.x + flat.w, flat.y + flat.h]] as const) {
    const dx = x - CAM_ANCHOR.x;
    const dy = y - CAM_ANCHOR.y;
    const k = TILT_PERSPECTIVE_PX / (TILT_PERSPECTIVE_PX - dy * sin);
    const sx = CAM_ANCHOR.x + dx * k;
    const sy = CAM_ANCHOR.y + dy * cos * k;
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy);
    y1 = Math.max(y1, sy);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// visibility() / settledFrame() live in visualDigest.ts (W5: the digest and these lints share one notion of "on screen").
export { settledFrame, visibility };

/** Subtitle card box (screen px) for a display phrase of text width `textWidthPx` — the same formula as
 *  remotion/v2/layers/SubtitleCard.tsx captionCardBox (padding 2×36 + 1 px borders + 6 px slack, max 886). */
export function captionCardBox(textWidthPx: number): Box {
  const w = Math.min(CAPTION.maxW, Math.ceil(textWidthPx) + 2 * CAPTION.padX + 2 + 6);
  return { x: CAPTION.left, y: CAPTION.bottom - CAPTION_CARD_H, w, h: CAPTION_CARD_H };
}

/** Caption card on screen at frame f (the phrase shown from showF until the next swap), or null before the first. */
export function captionBoxAt(tl: Pick<Timeline, "displayPhrases">, f: number): Box | null {
  const d = tl.displayPhrases.find((p) => f >= p.showF && f < p.hideF);
  return d ? captionCardBox(d.widthPx) : null;
}

export interface ContentPart {
  /** "" for the whole instance, "node:<id>" for a NodeGraph node (+ label plate), "fig:<i>" for a Figure node. */
  part: string;
  /** World box. */
  box: Box;
}

/** What an instance actually draws, as world boxes: NodeGraph = one box per node (square/dot + label plate, from the
 *  component's own geometry: nodeCentre + NODE_GRAPH), Figure = one box per top-level node, everything else = its
 *  footprint box. The instance box of a NodeGraph is its whole canvas (padding included), which both over- and
 *  under-reports what is really under the caption; per-node boxes are what the viewer sees. */
export function contentParts(inst: InstanceT, lib: FootprintLookup): ContentPart[] {
  const wb = instanceBox(inst, lib);
  if (!wb) return [];
  const s = inst.scale ?? 1;
  if (inst.component === "NodeGraph") {
    const pr = parseInstanceProps("NodeGraph", inst.props);
    if (pr?.ok) {
      const p = pr.value as NodeGraphPropsT;
      const W = wb.w / s;
      const H = wb.h / s;
      const G = graphMetrics(p, W, H); // W5.1: the drawn metrics (props.layout from the stage-fill pass; spec without)
      return p.nodes.map((n) => {
        const c = nodeCentre(n, W, H, G);
        const size = n.shape === "dot" ? G.dot : G.node;
        const plateW = n.label.length * G.charW + 2 * G.labelPadX;
        const half = Math.max(size, plateW) / 2;
        const y0 = c.y - size / 2;
        const y1 = c.y + size / 2 + G.labelGap + G.labelLineH;
        return { part: `node:${n.id}`, box: { x: wb.x + (c.x - half) * s, y: wb.y + y0 * s, w: 2 * half * s, h: (y1 - y0) * s } };
      });
    }
  }
  if (inst.component === "Figure" && inst.figure?.length) {
    const out: ContentPart[] = [];
    inst.figure.forEach((n, i) => {
      const b = figNodeBox(n);
      if (b) out.push({ part: `fig:${i}`, box: { x: inst.x + b.x * s, y: inst.y + b.y * s, w: Math.max(1, b.w * s), h: Math.max(1, b.h * s) } });
    });
    if (out.length) return out;
  }
  return [{ part: "", box: wb }];
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const inside = (b: Box, r: { x0: number; x1: number; y0: number; y1: number }) => b.x >= r.x0 - 0.5 && b.x + b.w <= r.x1 + 0.5 && b.y >= r.y0 - 0.5 && b.y + b.h <= r.y1 + 0.5;
const touches = (b: Box, r: { x0: number; x1: number; y0: number; y1: number }) => b.x < r.x1 && b.x + b.w > r.x0 && b.y < r.y1 && b.y + b.h > r.y0;
const fmtBox = (b: Box) => `[${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}]`;

/** Review frames of a beat for L23: the keyword frame, the stills frame (keywordF + 6) and the settled frame. */
export function reviewFrames(tl: Timeline, beat: TimelineBeat): { f: number; kind: "keyword" | "still" | "settled" }[] {
  const last = tl.durationF - 1;
  const out: { f: number; kind: "keyword" | "still" | "settled" }[] = [];
  for (const [f, kind] of [[Math.min(last, beat.keywordF), "keyword"], [Math.min(last, beat.keywordF + STILL_OFFSET_F), "still"], [settledFrame(tl, beat), "settled"]] as const)
    if (!out.some((o) => o.f === f)) out.push({ f, kind });
  return out;
}

function partRank(p: BeatT["part"]): number | null {
  switch (p) {
    case "hook":
      return 0;
    case "stakes":
    case "reveal":
      return 1;
    case "mechanism":
      return 2;
    case "context":
    case "climax":
    case "closure":
      return 3;
    case "cta":
      return 4;
    default:
      return null; // twist: allowed anywhere after the hook; ask: banned (L12)
  }
}

/** L18 per-chunk render prediction (ADR §6). */
export function predictRender(tl: Timeline, phi = 1, renderers?: number, outputFps: OutputFps = 30): { fpl: number; chunks: number[]; tMax: number } {
  if (outputFps !== 30) return predictRenderAtOutput(tl, phi, renderers, outputFps / 30);
  // Same chunking as the real render (framesPerLambda); `renderers` only for what-if analysis.
  const fpl = renderers === undefined ? framesPerLambda(tl.durationF) : Math.max(MIN_FRAMES_PER_LAMBDA, Math.ceil(tl.durationF / renderers));
  const chunks: number[] = [];
  for (let c = 0; c * fpl < tl.durationF; c++) {
    let t = 0;
    for (let f = c * fpl; f < Math.min((c + 1) * fpl, tl.durationF); f++) t += phi * (RENDER_T0 + RENDER_T_SAMPLE * samplesAt(tl, f));
    chunks.push(t);
  }
  return { fpl, chunks, tMax: Math.max(0, ...chunks) };
}

/** W0: L18 on OUTPUT frames (mul output frames per author frame): the real render's chunking of durationF × mul frames,
 *  outputBlurSamples per output frame, × L18_FPS60_CAL. `fpl` and the chunk ranges are in OUTPUT frames. */
function predictRenderAtOutput(tl: Timeline, phi: number, renderers: number | undefined, mul: number): { fpl: number; chunks: number[]; tMax: number } {
  const frames = tl.durationF * mul;
  const fpl = renderers === undefined ? framesPerLambda(frames) : Math.max(MIN_FRAMES_PER_LAMBDA, Math.ceil(frames / renderers));
  const chunks: number[] = [];
  for (let c = 0; c * fpl < frames; c++) {
    let t = 0;
    for (let o = c * fpl; o < Math.min((c + 1) * fpl, frames); o++) t += phi * L18_FPS60_CAL * (RENDER_T0 + RENDER_T_SAMPLE * outputBlurSamples(samplesAt(tl, Math.floor(o / mul)), mul));
    chunks.push(t);
  }
  return { fpl, chunks, tMax: Math.max(0, ...chunks) };
}

/** What drives the slowest L18 chunk: its frame range, the base cost and each blur window (camera move / flight) in
 *  it with the beat that owns it. W3 r3 evergreen-tls (257 s): the last chunk held two camera moves (b19 longPan +
 *  b20), ≈ 120 + 59 s of blur over a 79 s base — the move layout, not framesPerLambda or the world size. */
export function l18Drivers(tl: Timeline, pr: { fpl: number; chunks: number[]; tMax: number }, phi = 1): string {
  const c = pr.chunks.indexOf(pr.tMax);
  if (c < 0) return "";
  const f0 = c * pr.fpl;
  const f1 = Math.min(tl.durationF, (c + 1) * pr.fpl);
  const base = phi * RENDER_T0 * (f1 - f0);
  const parts: string[] = [];
  for (const w of tl.blurWindows) {
    const a = Math.max(f0, w.startF);
    const z = Math.min(f1, w.endF);
    if (z <= a) continue;
    let sec = 0;
    for (let f = a; f < z; f++) sec += phi * RENDER_T_SAMPLE * w.samples[f - w.startF];
    const seg = tl.cameraSegments.find((s) => s.transition === "move" && s.startF < w.endF && s.endF > w.startF);
    parts.push(`${seg ? `${seg.beatId} camera ${seg.ease} ${seg.durF} f` : `flight f${w.startF}–${w.endF - 1}`} ≈${Math.round(sec)} s`);
  }
  const moves = parts.length;
  return `chunk ${c + 1}/${pr.chunks.length} (f${f0}–${f1 - 1}): base ≈${Math.round(base)} s + ${moves ? parts.join(" + ") : "no blur"}${moves > 1 ? `; ${moves} blurred moves share one ${pr.fpl}-frame chunk — space them ≥ ${pr.fpl} f apart, make one a hard cut, or shorten one` : ""}`;
}

// ── W3.2 helpers (L28–L31) ──────────────────────────────────────────────────────────────────────────────────────

const boxUnion = (bs: readonly Box[]): Box | null => {
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Verbs that only kick / flash what is already there: they do not make a still look different. */
const EMPHASIS_VERBS = new Set(["pulse", "focus", "glitch"]);
/** Verbs whose effect stays after they run (a grown bar, a counted value, a re-scrambled text). */
const LASTING_VERBS = new Set(["drawOn", "countUp", "scramble"]);

/** Persistent look of an instance at frame f: its last state, its props overrides (of any verb) merged in order, how
 *  often each lasting verb ran, plus a `mark` (packet / highlight) fired in `beatId` itself — the still catches it in
 *  flight. */
export function instanceLook(tl: Pick<Timeline, "events">, instId: string, f: number, beatId: string): string {
  let state: string | undefined;
  let props: Record<string, unknown> = {};
  const lasting: Record<string, number> = {};
  let markNow = false;
  for (const e of tl.events) {
    if (e.kind !== "action" || e.target !== instId || e.frame > f) continue;
    // W5: props overrides count whatever verb carries them. A `mark` with props.shown (Terminal reveals the next line)
    // or props.cells (ContainerBox repaint) changes the still for good; before, only state / lasting verbs merged
    // their props, so W3.3 dns b16 / b18 (one new terminal line each) read as duplicates of b15 / b17.
    if (e.props) props = { ...props, ...e.props };
    if (e.do === "state") state = e.state ?? state;
    else if (LASTING_VERBS.has(e.do)) lasting[e.do] = (lasting[e.do] ?? 0) + 1;
    else if (e.do === "mark" && e.beatId === beatId) markNow = true;
  }
  return JSON.stringify([state ?? null, props, lasting, markNow]);
}

/**
 * L28 (W5.1 fr1): does the beat's keyword name a part of the still that gets no change? Returns a description, or null.
 * Named = an on-screen item whose drawn text the keyword names (L48's token match). It gets no change when it is in
 * `same` (held as it was), or when it is a non-focal item that changed while every focal item on the still is in `same`
 * (the named change went to a side tag, the focal diagram held its picture).
 */
export function keywordPartUnchanged(snap: Pick<BeatSnapshot, "items"> | undefined, same: ReadonlySet<string>, keyword: string): string | null {
  const kw = keyword.replace(/[^\p{L}\p{N}' -]+/gu, " ").trim();
  if (!snap || !kw) return null;
  const named = snap.items.filter((o) => drawnTexts(o).some((t) => itemNamedScore(kw, t.text) > 0));
  if (!named.length) return null;
  const focalHeld = snap.items.filter((o) => o.focal).every((o) => same.has(o.inst.id));
  const unchanged = named.filter((o) => same.has(o.inst.id) || (!o.focal && focalHeld));
  if (unchanged.length < named.length) return null;
  const desc = (o: OnScreen) => `${o.inst.id}${same.has(o.inst.id) ? " (held unchanged)" : " (a side tag; the focal diagram is unchanged)"}`;
  return unchanged.slice(0, 3).map(desc).join(", ");
}

/** "07:29" / "7:29" / "07:29:30" → minutes after midnight; anything else → null. */
export function parseClockMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const se = m[3] ? Number(m[3]) : 0;
  return h < 24 && mi < 60 && se < 60 ? h * 60 + mi + se / 60 : null;
}

/** A duration written on a pill / bracket ("~5 MIN", "6 h 10 min", "5m", "90 S", "1.5 H") → minutes; null when the
 *  text carries no duration ("FOUND BY AI", "ROOT EXPIRED"). Bare numbers do not count. */
export function parseDurationMin(s: string): number | null {
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;
  let total = 0;
  let hit = false;
  for (const m of s.matchAll(re)) {
    const v = Number(m[1]);
    const u = m[2].toLowerCase();
    total += u.startsWith("h") ? v * 60 : u.startsWith("m") ? v : v / 60;
    hit = true;
  }
  return hit ? total : null;
}

const fmtMin = (m: number) => (m >= 60 && m % 60 !== 0 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : m >= 60 ? `${m / 60} h` : `${Math.round(m * 10) / 10} min`);

/**
 * Clock Timeline (scale "clock", every tick HH:MM): minutes between tick positions `from` and `to` (tick units, linear
 * between neighbouring ticks; a time going backwards crosses midnight). null when a tick is not a clock time.
 */
export function clockSpanMin(ticks: readonly string[], from: number, to: number): number | null {
  const t = ticks.map(parseClockMin);
  if (t.some((x) => x === null)) return null;
  const abs: number[] = [];
  for (const x of t as number[]) abs.push(abs.length && x < abs[abs.length - 1] - 1e-9 ? x + 1440 * Math.ceil((abs[abs.length - 1] - x) / 1440) : x);
  const at = (u: number) => {
    const i = Math.max(0, Math.min(abs.length - 2, Math.floor(u)));
    return abs[i] + (abs[i + 1] - abs[i]) * (u - i);
  };
  return at(to) - at(from);
}

export interface TimelineSpanIssue {
  text: string;
  field: "pill" | "duration";
  spanMin: number;
  saysMin: number;
  /** Tick pair whose span matches the stated duration best (from, to), when one is within tolerance. */
  suggest?: [number, number];
}

/** L31 check of one props state: the pill / bracket duration vs the lit bar span on a clock Timeline. */
export function timelineSpanIssues(p: Pick<TimelinePropsT, "ticks" | "scale" | "from" | "to" | "pill" | "duration">): TimelineSpanIssue[] {
  if (p.scale !== "clock") return [];
  const n = p.ticks.length;
  const span = clockSpanMin(p.ticks, p.from, p.to ?? n - 1);
  if (span === null || span <= 0) return [];
  const out: TimelineSpanIssue[] = [];
  for (const field of ["pill", "duration"] as const) {
    const text = p[field];
    const says = text ? parseDurationMin(text) : null;
    if (!text || says === null || says <= 0) continue;
    if (span / says <= TIMELINE_SPAN_TOL && says / span <= TIMELINE_SPAN_TOL) continue;
    let best: [number, number] | undefined;
    let bestErr = Infinity;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const s = clockSpanMin(p.ticks, a, b)!;
        const err = Math.abs(Math.log(s / says));
        if (s > 0 && err < bestErr && err <= Math.log(TIMELINE_SPAN_TOL)) {
          bestErr = err;
          best = [a, b];
        }
      }
    out.push({ text, field, spanMin: span, saysMin: says, suggest: best });
  }
  return out;
}

export interface GraphEdgeIssue {
  edge: string;
  kind: "label-end" | "crosses";
  message: string;
}

/**
 * L30: NodeGraph edges that the label plates hide, from the component's own edge geometry (edgeSegments = what the
 * renderer draws; labels sit on opaque plates ABOVE the edges):
 *  - "label-end": an edge end that is not docked on its node (outline ± 3 px) and not on the designed bottom port below
 *    its own label — the side-port line was blocked by a label plate wider than the node, so the fallback line stops
 *    at the plate edge and reads as ending at the label (W3.1 event-recent MERGE→SCHEMA UPDATE, 65 px short);
 *  - "crosses": an edge that runs under ANOTHER node's square / dot or label plate.
 * `w`, `h` = the graph's unscaled footprint.
 */
export function nodeGraphEdgeIssues(p: NodeGraphPropsT, w: number, h: number): GraphEdgeIssue[] {
  const G = graphMetrics(p, w, h); // W5.1: drawn metrics (= NODE_GRAPH sizes without props.layout)
  const segs = edgeSegments(p, w, h, G);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const centre = (id: string) => nodeCentre(byId.get(id)!, w, h, G);
  const out: GraphEdgeIssue[] = [];
  const docked = (id: string, x: number, y: number) => {
    const n = byId.get(id)!;
    const c = centre(id);
    const half = (n.shape === "dot" ? G.dot : G.node) / 2;
    if (n.shape === "dot") {
      const d = Math.abs(Math.hypot(x - c.x, y - c.y) - half);
      return d <= EDGE_DOCK_TOL ? 0 : d;
    } else {
      const dx = Math.abs(x - c.x) - half;
      const dy = Math.abs(y - c.y) - half;
      const d = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      const onBorder = d <= EDGE_DOCK_TOL && Math.max(dx, dy) >= -EDGE_DOCK_TOL;
      if (onBorder) return 0;
      // designed bottom port: the edge leaves below its own label plate (NodeGraph sideOf "B")
      const o = nodeOutline(n, G);
      if (Math.abs(y - c.y - o.label.y1) <= EDGE_DOCK_TOL && Math.abs(x - c.x) <= G.portMax + EDGE_DOCK_TOL) return 0;
      return d;
    }
  };
  // exact rects a segment must not pass under: other nodes' square / dot box and label plate (not grown)
  const rectsOf = (id: string) => {
    const n = byId.get(id)!;
    const c = centre(id);
    const size = n.shape === "dot" ? G.dot : G.node;
    const plateW = n.label.length * G.charW + 2 * G.labelPadX;
    const top = c.y + size / 2 + G.labelGap;
    return [
      { what: "node", x0: c.x - size / 2, x1: c.x + size / 2, y0: c.y - size / 2, y1: c.y + size / 2 },
      { what: "label", x0: c.x - plateW / 2, x1: c.x + plateW / 2, y0: top, y1: top + G.labelLineH },
    ];
  };
  const hits = (s: { ax: number; ay: number; bx: number; by: number }, r: { x0: number; x1: number; y0: number; y1: number }) => {
    let t0 = 0;
    let t1 = 1;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    for (const [p0, d, lo, hi] of [[s.ax, dx, r.x0 + 1, r.x1 - 1], [s.ay, dy, r.y0 + 1, r.y1 - 1]] as const) {
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
  };
  p.edges.forEach((e, i) => {
    const s = segs[i];
    const key = `${e.from}>${e.to}`;
    for (const [id, x, y] of [[e.from, s.ax, s.ay], [e.to, s.bx, s.by]] as const) {
      const off = docked(id, x, y);
      if (off > EDGE_DOCK_TOL) {
        const n = byId.get(id)!;
        out.push({
          edge: key,
          kind: "label-end",
          message: `edge ${key} ends on the "${n.label}" label plate, ${Math.round(off)} px short of the ${id} node — it reads as stopping at the label (the side-port line would cross the plate, which is wider than the node). Move the other end level with or above ${id} so the edge meets the node's side above its label, or shorten the label`,
        });
      }
    }
    for (const n of p.nodes) {
      if (n.id === e.from || n.id === e.to) continue;
      for (const r of rectsOf(n.id))
        if (hits(s, r)) {
          out.push({ edge: key, kind: "crosses", message: `edge ${key} runs under the ${r.what === "label" ? `"${n.label}" label plate` : `${n.id} node`} — move ${n.id} off the line, or route the edge through another node` });
          break;
        }
    }
  });
  return out;
}

// ── W3.2 FR1: Callout vs NodeGraph geometry (L33) ─────────────────────────────────────────────────────────────────
//
// W3.2 r1 evergreen-oom (stills r1-f1069 / r2-f1487 / r2-f1642): Callouts "METASPACE · THREADS" / "DIRECT BUFFERS ·
// GLIBC" / "EXTRA 2GB" sat on the cgroup→OOM-killer edge butting against the KILL node with their dot in empty space,
// "memory.max" covered the "page cache" label with its dot on the heap→cg edge, "NO JAVA OutOfMemoryError" rested on
// the JVM node's top border with its dot in the void. L22 passed them all (the dot was inside the graph's footprint).

/** L33: a Callout dot on a NodeGraph must be within this many px of a node box (square / dot). */
export const CALLOUT_NODE_TOL = 24;
/** L33: clearance kept between a Callout plate and the graph's node boxes, label plates and edges ("rests on" = hit). */
export const CALLOUT_PLATE_CLEAR = 6;
/** Corner radius of a node square: a dot placed on a top / bottom side sits this far in from the corner. */
const NODE_CORNER = 16;

export interface GraphNodeGeom {
  id: string;
  label: string;
  /** World box of the square / dot. */
  box: Box;
  /** World box of the label plate. */
  plate: Box;
}
export interface GraphGeom {
  id: string;
  box: Box;
  nodes: GraphNodeGeom[];
  /** World edge segments, same order as props.edges. */
  edges: { key: string; ax: number; ay: number; bx: number; by: number }[];
}

/** World geometry of a NodeGraph instance (renderer geometry: nodeCentre, NODE_GRAPH sizes, edgeSegments). */
export function graphGeometry(inst: InstanceT, lib: FootprintLookup, props?: NodeGraphPropsT): GraphGeom | null {
  const wb = instanceBox(inst, lib);
  let p = props;
  if (!p) {
    const pr = parseInstanceProps("NodeGraph", inst.props);
    if (!pr?.ok) return null;
    p = pr.value as NodeGraphPropsT;
  }
  if (!wb) return null;
  const s = inst.scale ?? 1;
  const W = wb.w / s;
  const H = wb.h / s;
  const G = graphMetrics(p, W, H); // W5.1: drawn metrics
  const w2 = (x: number, y: number, w: number, h: number): Box => ({ x: wb.x + x * s, y: wb.y + y * s, w: w * s, h: h * s });
  const nodes = p.nodes.map((n) => {
    const c = nodeCentre(n, W, H, G);
    const size = n.shape === "dot" ? G.dot : G.node;
    const plateW = n.label.length * G.charW + 2 * G.labelPadX;
    return { id: n.id, label: n.label, box: w2(c.x - size / 2, c.y - size / 2, size, size), plate: w2(c.x - plateW / 2, c.y + size / 2 + G.labelGap, plateW, G.labelLineH) };
  });
  const segs = edgeSegments(p, W, H, G);
  const edges = p.edges.map((e, i) => ({ key: `${e.from}>${e.to}`, ax: wb.x + segs[i].ax * s, ay: wb.y + segs[i].ay * s, bx: wb.x + segs[i].bx * s, by: wb.y + segs[i].by * s }));
  return { id: inst.id, box: wb, nodes, edges };
}

/** World geometry of a Callout placed at (x, y) with scale s: dot centre, leader polyline and label plate. */
export function calloutWorld(at: { x: number; y: number; scale?: number }, p: Pick<CalloutPropsT, "text" | "dir" | "reach">): { dot: { x: number; y: number }; points: { x: number; y: number }[]; pill: Box } {
  const g = calloutGeometry(p);
  const s = at.scale ?? 1;
  const pt = (q: { x: number; y: number }) => ({ x: at.x + q.x * s, y: at.y + q.y * s });
  return { dot: pt(g.dot), points: g.points.map(pt), pill: { x: at.x + g.pill.x * s, y: at.y + g.pill.y * s, w: g.pill.w * s, h: g.pill.h * s } };
}

const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const boxDist = (p: { x: number; y: number }, b: Box) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)));
/** Does segment a→b pass through the open box b? (Liang–Barsky) */
export function segHitsBox(a: { x: number; y: number }, c: { x: number; y: number }, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  for (const [p0, d, lo, hi] of [[a.x, dx, b.x, b.x + b.w], [a.y, dy, b.y, b.y + b.h]] as const) {
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

export interface CalloutGraphCheck {
  /** What the (grown) label plate covers: "KILL node", "\"page cache\" label", "cg>oom edge". */
  plateHits: string[];
  /** Leader segments crossing another node box or label plate (not the one the dot sits on). */
  leaderHits: string[];
  /** Distance from the dot to the nearest node box (0 = on it). */
  dotDist: number;
  nearest: GraphNodeGeom;
}

/** L33 check of one Callout placement against one NodeGraph. */
export function calloutGraphCheck(c: ReturnType<typeof calloutWorld>, g: GraphGeom): CalloutGraphCheck {
  const plate = grow(c.pill, CALLOUT_PLATE_CLEAR);
  const plateHits: string[] = [];
  for (const n of g.nodes) {
    if (overlaps(plate, n.box)) plateHits.push(`${n.id} node`);
    if (overlaps(plate, n.plate)) plateHits.push(`"${n.label}" label`);
  }
  for (const e of g.edges) if (segHitsBox({ x: e.ax, y: e.ay }, { x: e.bx, y: e.by }, plate)) plateHits.push(`${e.key} edge`);
  let nearest = g.nodes[0];
  let dotDist = Infinity;
  for (const n of g.nodes) {
    const d = boxDist(c.dot, n.box);
    if (d < dotDist) {
      dotDist = d;
      nearest = n;
    }
  }
  const leaderHits: string[] = [];
  for (const n of g.nodes) {
    const own = n === nearest && dotDist <= CALLOUT_NODE_TOL;
    for (let i = 0; i + 1 < c.points.length; i++) {
      if (!own && segHitsBox(c.points[i], c.points[i + 1], n.box)) leaderHits.push(`${n.id} node`);
      if (segHitsBox(c.points[i], c.points[i + 1], n.plate)) leaderHits.push(`"${n.label}" label`);
    }
  }
  return { plateHits: [...new Set(plateHits)], leaderHits: [...new Set(leaderHits)], dotDist, nearest };
}

const DIRS = ["ne", "nw", "se", "sw", "e", "w"] as const;
const REACHES = ["short", "medium", "long"] as const;
type CalloutDir = (typeof DIRS)[number];
type CalloutReach = (typeof REACHES)[number];

/** Where the dot goes on a node for a given dir: the side the plate leaves from (w → left side middle, e → right side
 *  middle, ne / nw → top side near that corner, se / sw → bottom side near that corner). */
export function nodeAnchorPoint(n: Pick<GraphNodeGeom, "box">, dir: CalloutDir): { x: number; y: number } {
  const b = n.box;
  const inset = Math.min(NODE_CORNER, b.w / 4);
  const cy = b.y + b.h / 2;
  switch (dir) {
    case "w":
      return { x: b.x, y: cy };
    case "e":
      return { x: b.x + b.w, y: cy };
    case "ne":
      return { x: b.x + b.w - inset, y: b.y };
    case "nw":
      return { x: b.x + inset, y: b.y };
    case "se":
      return { x: b.x + b.w - inset, y: b.y + b.h };
    case "sw":
      return { x: b.x + inset, y: b.y + b.h };
  }
}

export interface CalloutPlacement {
  x: number;
  y: number;
  dir: CalloutDir;
  reach: CalloutReach;
  node: string;
}

/**
 * Anchor resolution for a Callout on a NodeGraph node (the `anchor: {instance, node}` idea, computed lint-side until the
 * component takes the prop): the instance (x, y) that puts the dot on the node's side for `dir`, trying the requested
 * dir / reach first, then every other dir × reach; the first placement whose plate (+ clearance) and leader are clear
 * of every node box, label plate and edge, and whose plate stays inside x 64…960, wins. null = no clean spot.
 */
export function calloutAnchorPlacement(g: GraphGeom, nodeId: string, p: Pick<CalloutPropsT, "text" | "dir" | "reach">, scale = 1): CalloutPlacement | null {
  const n = g.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const dirs = [p.dir, ...DIRS.filter((d) => d !== p.dir)];
  const reaches = [p.reach, ...REACHES.filter((r) => r !== p.reach)];
  for (const dir of dirs)
    for (const reach of reaches) {
      const geo = calloutGeometry({ text: p.text, dir, reach });
      const t = nodeAnchorPoint(n, dir);
      const at = { x: Math.round(t.x - geo.dot.x * scale), y: Math.round(t.y - geo.dot.y * scale), scale };
      const cw = calloutWorld(at, { text: p.text, dir, reach });
      if (cw.pill.x < SAFE.left || cw.pill.x + cw.pill.w > SAFE.textRight) continue;
      const chk = calloutGraphCheck(cw, g);
      if (chk.plateHits.length || chk.leaderHits.length || chk.dotDist > CALLOUT_NODE_TOL) continue;
      return { x: at.x, y: at.y, dir, reach, node: n.id };
    }
  return null;
}

/** Props in force on an instance at frame f: the base props with every action's props override up to f merged in. */
function propsAt(tl: Pick<Timeline, "events">, inst: InstanceT, f: number): Record<string, unknown> {
  let props: Record<string, unknown> = { ...(inst.props ?? {}) };
  for (const e of tl.events) if (e.kind === "action" && e.target === inst.id && e.frame <= f && e.props) props = { ...props, ...e.props };
  return props;
}

/** L11 / stats pace by PACE_METRIC: spoken words of every beat phrase over the narration duration (tl.durationMs =
 *  last beat's audio end + TAIL_MS, the same "last phrase end + tail" the rubric uses). */
export function lintPace(sb: Pick<Storyboard, "beats">, tl: Pick<Timeline, "durationMs">): { words: number; durationSec: number; wps: number; metric: string } {
  const words = sb.beats.reduce((n, b) => n + spokenWords(b.phrase).length, 0);
  const durationSec = tl.durationMs / 1000;
  return { words, durationSec, wps: durationSec > 0 ? words / durationSec : 0, metric: PACE_METRIC };
}

/** What a NodeGraph draws on screen at a camera: the union box of its node squares / dots and label TEXT (the plate's
 *  padding is background), and each label's text right edge. null = props do not parse. */
export function graphDrawn(inst: InstanceT, lib: FootprintLookup, props: Record<string, unknown>, cam: CamState): { box: Box; labels: { id: string; label: string; right: number }[] } | null {
  const pr = parseInstanceProps("NodeGraph", props);
  if (!pr?.ok) return null;
  const g = graphGeometry(inst, lib, pr.value as NodeGraphPropsT);
  if (!g || !g.nodes.length) return null;
  const wb = instanceBox(inst, lib);
  const s0 = inst.scale ?? 1;
  const pad = (wb ? graphMetrics(pr.value as NodeGraphPropsT, wb.w / s0, wb.h / s0).labelPadX : NODE_GRAPH.labelPadX) * s0;
  const boxes: Box[] = [];
  const labels: { id: string; label: string; right: number }[] = [];
  for (const n of g.nodes) {
    const text = projectBox({ x: n.plate.x + pad, y: n.plate.y, w: Math.max(1, n.plate.w - 2 * pad), h: n.plate.h }, cam);
    boxes.push(projectBox(n.box, cam), text);
    labels.push({ id: n.id, label: n.label, right: text.x + text.w });
  }
  return { box: boxUnion(boxes)!, labels };
}

interface ReachHit {
  severity: Severity;
  beats: string[];
  frame: number;
  beatId: string;
  maxX: number;
  labels: Set<string>;
}
/** L3 text-line findings, merged per instance + kind across beats. */
function reachCollector() {
  const m = new Map<string, ReachHit & { id: string; kind: "label" | "node" | "box" }>();
  return {
    note(id: string, kind: "label" | "node" | "box", severity: Severity, beatId: string, frame: number, x: number, labels: string[] = []) {
      const k = `${id}|${kind}`;
      const h = m.get(k) ?? m.set(k, { id, kind, severity, beats: [], frame, beatId, maxX: x, labels: new Set() }).get(k)!;
      if (!h.beats.includes(beatId)) h.beats.push(beatId);
      if (x > h.maxX) h.maxX = x;
      labels.forEach((l) => h.labels.add(l));
    },
    results(): { severity: Severity; message: string; beatId: string; frame: number }[] {
      // a graph with a label past the line already says so; drop its "node" warning
      const labelled = new Set([...m.values()].filter((h) => h.kind === "label").map((h) => h.id));
      return [...m.values()]
        .filter((h) => !(h.kind === "node" && labelled.has(h.id)))
        .map((h) => {
          const span = h.beats.length > 1 ? `${h.beats[0]}–${h.beats[h.beats.length - 1]}, ${h.beats.length} beats` : `${h.beats[0]} @${h.frame}`;
          const x = Math.round(h.maxX);
          const message =
            h.kind === "label"
              ? `NodeGraph "${h.id}" node label${h.labels.size > 1 ? "s" : ""} ${[...h.labels].map((l) => `"${l}"`).join(", ")} reach${h.labels.size > 1 ? "" : "es"} x ${x} (${span}): label text past x ${SAFE.textRight} is cut or crowds the frame edge — move ${h.labels.size > 1 ? "those nodes" : "that node"} left (node x lower by ≈${x - SAFE.textRight} px on screen), shorten the label, or lower the zoom`
              : `"${h.id}" reaches x ${x} (${span}; keep text ≤ ${SAFE.textRight})`;
          return { severity: h.severity, message, beatId: h.beatId, frame: h.frame };
        });
    },
  };
}

// ── W3.3: monotony (L34) and KineticWord / caption duplication (L35) ─────────────────────────────────────────────

/** L34: this many consecutive beats without a visible focal change and without a camera move → warn. */
export const MONOTONY_RUN = 3;
/** L34: a props-only NodeGraph update (same state name, new nodeStates / edgeStates) is a visible change only when it
 *  recolours at least this share of the graph's nodes + edges. W3.2 r3 event-recent: b06–b16 each recoloured 1–4 of
 *  10 elements (sheet.png: the same graph frame for 11 beats); b19's 9-of-10 "everything recovered" recolour reads. */
export const GRAPH_RECOLOUR_SHARE = 0.5;
/** Verbs that leave a visible, lasting change on their target. */
const CHANGE_VERBS = new Set(["enter", "exit", "drawOn", "countUp", "scramble"]);

/** Effective node / edge states of NodeGraph props ("n1" → state, "n1>n2" → state). */
function graphElementStates(props: Record<string, unknown>): Map<string, string> | null {
  const pr = parseInstanceProps("NodeGraph", props);
  if (!pr?.ok) return null;
  const p = pr.value as NodeGraphPropsT;
  const m = new Map<string, string>();
  for (const n of p.nodes) m.set(n.id, String(p.nodeStates?.[n.id] ?? n.state ?? ""));
  for (const e of p.edges) m.set(`${e.from}>${e.to}`, String(edgeStateOf(p, e.from, e.to)));
  return m;
}

/**
 * Per beat: did something focal visibly change, and what. A change = a camera move / cut starting in the beat, or on a
 * FOCAL instance: enter / exit / drawOn / countUp / scramble, a `state` action to a different state name, or a props
 * override that changes how it looks (a NodeGraph only when ≥ GRAPH_RECOLOUR_SHARE of its nodes + edges change state).
 * Emphasis (pulse / focus / mark / glitch), the header, the data field and non-focal instances (SourceTags…) are not.
 */
export function beatChanges(sb: Storyboard, tl: Timeline, lib: FootprintLookup = LIBRARY_LOOKUP): { id: string; changed: boolean; did: string }[] {
  const instById = new Map(sb.world.map((i) => [i.id, i]));
  const cur = new Map<string, { state: string | null; props: Record<string, unknown> }>();
  for (const inst of sb.world) cur.set(inst.id, { state: null, props: { ...(inst.props ?? {}) } });
  const why = new Map<string, string[]>();
  const did = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  for (const sg of tl.cameraSegments) {
    const b = tl.beats.find((x) => sg.startF >= x.startF && sg.startF < x.endF);
    if (b) push(why, b.id, sg.transition === "hardCut" ? "cut" : "camera move");
  }
  for (const e of tl.events) {
    if (e.kind !== "action") continue;
    const inst = instById.get(e.target);
    const c = cur.get(e.target);
    if (!inst || !c) continue;
    const focal = inst.focal ?? lib[inst.component]?.focal ?? true;
    const before = c.props;
    const after = e.props ? { ...before, ...e.props } : before;
    let changed = false;
    let what: string = e.do;
    if (CHANGE_VERBS.has(e.do)) changed = true;
    else if (e.do === "state") {
      if ((e.state ?? null) !== c.state) {
        changed = true;
        what = `state ${e.state}`;
      } else if (e.props) {
        if (inst.component === "NodeGraph") {
          const a = graphElementStates(before);
          const z = graphElementStates(after);
          if (a && z) {
            let n = 0;
            for (const [k, v] of z) if (a.get(k) !== v) n++;
            changed = n / Math.max(1, z.size) >= GRAPH_RECOLOUR_SHARE;
            what = `recolours ${n}/${z.size}`;
          } else changed = JSON.stringify(before) !== JSON.stringify(after);
        } else changed = JSON.stringify(before) !== JSON.stringify(after);
      }
      c.state = e.state ?? c.state;
    }
    c.props = after;
    if (!focal) {
      if (e.target !== "header" && e.target !== "datafield") push(did, e.beatId, `${e.target} ${what} (not focal)`);
      continue;
    }
    push(changed ? why : did, e.beatId, `${e.target} ${what}`);
  }
  return tl.beats.map((b) => {
    const w = why.get(b.id) ?? [];
    const d = did.get(b.id) ?? [];
    return { id: b.id, changed: w.length > 0, did: w.length ? w.join(", ") : d.length ? d.join(", ") : "no action" };
  });
}

/** L34 runs: maximal stretches of ≥ MONOTONY_RUN unchanged beats (the CTA may hold the closing frame). */
export function monotonyRuns(sb: Storyboard, tl: Timeline, lib: FootprintLookup = LIBRARY_LOOKUP): { beats: { id: string; did: string }[] }[] {
  const ch = beatChanges(sb, tl, lib);
  const out: { beats: { id: string; did: string }[] }[] = [];
  let run: { id: string; did: string }[] = [];
  const flush = () => {
    if (run.length >= MONOTONY_RUN) out.push({ beats: run });
    run = [];
  };
  ch.forEach((c, i) => {
    if (c.changed || sb.beats[i].part === "cta") flush();
    else run.push({ id: c.id, did: c.did });
  });
  flush();
  return out;
}

/** L35: the caption text a KineticWord duplicates ("the beat's phrase", or a display phrase of ≥ 2 words that is a run
 *  of the card's words), or null. Compared on normalised tokens. */
export function kineticCaptionDup(text: string, phrase: string, displays: readonly string[]): string | null {
  const t = tokenize(text).map(normToken).filter(Boolean);
  if (!t.length) return null;
  const ph = tokenize(phrase).map(normToken).filter(Boolean);
  if (ph.length && ph.join(" ") === t.join(" ")) return "the beat's phrase";
  const card = ` ${t.join(" ")} `;
  for (const d of displays) {
    const dt = tokenize(d).map(normToken).filter(Boolean);
    if (dt.length >= 2 && card.includes(` ${dt.join(" ")} `)) return `the caption "${d}"`;
  }
  return null;
}

// ── W5 packet V: label-vs-state (L37), unsourced Meter numbers (L38), composition (L39–L42), digest monotony (L43) ──

/** W6: ONE quantity parser for the renderer fill and the lints (components-meta/Meter.ts: first number, grouping
 *  commas, SI/IEC bytes, percent, time, counts). */
export { parseQuantity, type Quantity };
const comparable = (a: Quantity | null, b: Quantity | null): a is Quantity => !!a && !!b && a.dim === b.dim && a.dim !== "time" && (a.dim !== "count" || a.unit === b.unit) && b.base > 0;

/** L37: a full bar whose readout is below this share of its limit reads as "the readout hit the limit". */
export const FULL_READOUT_MIN = 0.95;
/** L37: readout / limit vs the drawn fill (in limit units) may differ by this much before the picture lies. */
export const FILL_READOUT_TOL = 0.15;
/** L37: an explicit cell map may disagree with the bar by this share of the 20 cells (3 cells). */
export const CELL_FILL_TOL = 0.15;

export interface LabelStateIssue {
  severity: Severity;
  kind: string;
  message: string;
}
/**
 * Meter / ContainerBox readout vs what the bar draws, at one moment (state + props in force). W3.3 evergreen-oom r2 b19:
 * Meter "pod cgroup" FULL and red at the 1 Gi tick, readout "400 MB" — on screen "400 MB reached 1 Gi", the inverse of
 * the reel's thesis. Readout-vs-bar conflicts block; a cell map that disagrees with the bar is an error.
 */
export function labelStateIssues(component: string, state: string | null, p: Record<string, unknown>): LabelStateIssue[] {
  const out: LabelStateIssue[] = [];
  if (component === "Meter") {
    const m = meterReadout(state, p);
    const full = state === "full" || m.level >= m.limit - 1e-9;
    const vq = typeof p.valueLabel === "string" ? parseQuantity(p.valueLabel) : null;
    const lq = parseQuantity(p.limitLabel);
    if (vq?.dim === "percent") {
      const want = full ? 1 : m.level;
      if (full && vq.n / 100 < FULL_READOUT_MIN) out.push({ severity: "block", kind: "full-low", message: `state ${state === "full" ? "full" : "at the limit"} draws the bar at 100 % but valueLabel reads "${p.valueLabel}"` });
      else if (!full && Math.abs(vq.n / 100 - want) > FILL_READOUT_TOL) out.push({ severity: "block", kind: "fill", message: `valueLabel "${p.valueLabel}" but the bar is drawn at ${Math.round(want * 100)} %` });
    } else if (comparable(vq, lq)) {
      const ratio = vq.base / lq!.base;
      if (full && ratio < FULL_READOUT_MIN) out.push({ severity: "block", kind: "full-low", message: `state ${state === "full" ? "full" : "at the limit"} fills the bar to the "${p.limitLabel}" tick, but valueLabel "${p.valueLabel}" is ${Math.round(ratio * 100)} % of it — the readout says "${p.valueLabel}" hit the limit` });
      else if (state === "empty" && vq.base > 0) out.push({ severity: "block", kind: "empty", message: `state empty drains the bar but valueLabel still reads "${p.valueLabel}"` });
      else if (!full && state !== "empty" && Math.abs(ratio - m.level / (m.limit || 1)) > FILL_READOUT_TOL) out.push({ severity: "block", kind: "fill", message: `valueLabel "${p.valueLabel}" is ${Math.round(ratio * 100)} % of "${p.limitLabel}" but the bar is drawn at ${Math.round((100 * m.level) / (m.limit || 1))} % of the limit` });
    }
  } else if (component === "ContainerBox") {
    const b = boxReadout(state, p);
    const lim = parseLimit(typeof p.limitLabel === "string" ? p.limitLabel : undefined);
    if (lim && lim.used !== null && lim.max > 0 && (state === "full" || state === "killed") && lim.used / lim.max < FULL_READOUT_MIN)
      out.push({ severity: "block", kind: "full-low", message: `state ${state} draws a full red bar but limitLabel "${p.limitLabel}" reads ${Math.round((100 * lim.used) / lim.max)} % used` });
    // W6 (W5.1 r2 oom "1 cell = 50 MB" in a "limit 1 Gi" box: 20 cells = 1000 MB ≠ 1024 MiB): the full box IS the limit
    const cellQ = typeof p.cellValue === "number" && typeof p.unitLabel === "string" ? parseQuantity(`${p.cellValue} ${p.unitLabel}`) : null;
    const limQ = lim ? parseQuantity(`${lim.max}${lim.tail.trim()}`) : null;
    if (cellQ?.dim === "bytes" && limQ?.dim === "bytes" && Math.abs(BOX_CELLS * cellQ.base - limQ.base) > cellQ.base * 1.0001)
      out.push({ severity: "error", kind: "scale", message: `"1 cell = ${p.cellValue} ${p.unitLabel}" makes the ${BOX_CELLS} cells ${Number((BOX_CELLS * (p.cellValue as number)).toPrecision(4))} ${p.unitLabel}, but limitLabel "${p.limitLabel}" is ${Number(((limQ.base / cellQ.base) * (p.cellValue as number)).toPrecision(4))} ${p.unitLabel} — make the limit in limitLabel ${Number((BOX_CELLS * (p.cellValue as number)).toPrecision(4))} ${p.unitLabel}, or cellValue + unitLabel one ${BOX_CELLS}th of the limit` });
    // W7 ContainerBox v3: with cells / groups the bar IS the used cells (boxFill), so bar vs cells can no longer disagree;
    // an authored value more than one cell off is ignored by the renderer — warn so the director stops believing it
    const ign = state && state !== "full" && state !== "killed" && state !== "freed" && (CONTAINER_BOX_STATES as readonly string[]).includes(state) ? ignoredValue(state as ContainerBoxState, p as Parameters<typeof ignoredValue>[1]) : null;
    if (ign) out.push({ severity: "warn", kind: "value-ignored", message: `value ${ign.authored} is ignored: the cells decide the bar (drawn at ${Math.round(ign.drawn * 100)} % = ${Math.round(ign.drawn * BOX_CELLS)} used cells) — drop value or match it to the cells` });
    else if (b.usedCells !== null && Array.isArray(p.cells) && (p.cells as unknown[]).length >= BOX_CELLS && state !== "killed" && state !== "freed" && Math.abs(b.usedCells / BOX_CELLS - b.fill) > CELL_FILL_TOL)
      out.push({ severity: "error", kind: "cells", message: `${b.usedCells} of ${BOX_CELLS} cells are in use but the bar is drawn at ${Math.round(b.fill * 100)} % (state ${state ?? "?"}) — make the cells and value agree` });
  }
  return out;
}

/** Normalised label for cross-instance comparison ("HEAP" ≡ "heap"). */
const labelKey = (s: unknown) => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]+/g, "") : "");

/** L37 cross-check: two items on screen under the same label (≥ 3 chars) showing different quantities of one kind
 *  (a HeroStat "HEAP 400 MB" next to a Meter "heap 600 MB"). */
export function crossLabelConflicts(items: readonly Pick<OnScreen, "inst" | "state" | "props">[]): { a: string; b: string; label: string; va: string; vb: string }[] {
  const shown: { id: string; key: string; label: string; text: string; q: Quantity }[] = [];
  for (const o of items) {
    const p = o.props;
    let label: unknown;
    let text: string | null = null;
    if (o.inst.component === "HeroStat") {
      label = p.label;
      text = heroText(p as { prefix?: string; suffix?: string }, formatValue((p.value as number | string) ?? "", typeof p.decimals === "number" ? p.decimals : 0));
    } else if (o.inst.component === "Meter") {
      label = p.label;
      text = meterReadout(o.state, p).readout;
    }
    const q = parseQuantity(text);
    const key = labelKey(label);
    if (q && key.length >= 3 && text) shown.push({ id: o.inst.id, key, label: String(label), text, q });
  }
  const out: { a: string; b: string; label: string; va: string; vb: string }[] = [];
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i];
      const c = shown[j];
      if (a.key !== c.key || !comparable(a.q, c.q)) continue;
      if (Math.abs(a.q.base - c.q.base) / Math.max(a.q.base, c.q.base) > 0.1) out.push({ a: a.id, b: c.id, label: a.label, va: a.text, vb: c.text });
    }
  return out;
}

/** Numbers a Meter shows over the reel: its label texts with digits (base + overrides) and the derived "%" readout
 *  when no valueLabel is set (the renderer prints round(level × 100) %). `derived` marks the latter. */
export function meterShownNumbers(snaps: readonly BeatSnapshot[], instId: string): { text: string; derived: boolean; beatId: string }[] {
  const out: { text: string; derived: boolean; beatId: string }[] = [];
  const seen = new Set<string>();
  for (const s of snaps)
    for (const o of s.items) {
      if (o.inst.id !== instId || o.inst.component !== "Meter") continue;
      const p = o.props;
      const m = meterReadout(o.state, p);
      const texts: [string, boolean][] = [];
      for (const k of ["label", "valueLabel", "limitLabel", "fullLabel"] as const) if (typeof p[k] === "string" && hasNumber(p[k] as string)) texts.push([p[k] as string, false]);
      if (typeof p.valueLabel !== "string") texts.push([m.readout, true]);
      for (const [t, derived] of texts)
        if (!seen.has(t)) {
          seen.add(t);
          out.push({ text: t, derived, beatId: s.beat.id });
        }
    }
  return out;
}

/**
 * DS1 extension for Meters (W5; director tools wire it with their page store, like sourcedTextFindingsFrom): every
 * number a SOURCED, non-illustrative Meter shows must be on one of its source pages (instance sourceIds, else the
 * sourceIds of the beats that act on it). A derived "39%" (no valueLabel) counts: W3.3 oom r2's stills review flagged
 * the unsourced "39%" by eye. Returns findings in the director's review-finding shape. Unknown pages are skipped.
 */
export function meterNumberFindingsFrom(sb: Storyboard, tl: Timeline, pageText: (sourceId: string) => string | null, lib: FootprintLookup = LIBRARY_LOOKUP): { id: "DS1"; severity: "error"; message: string; beatId?: string }[] {
  const snaps = beatSnapshots(sb, tl, lib);
  const out: { id: "DS1"; severity: "error"; message: string; beatId?: string }[] = [];
  for (const inst of sb.world) {
    if (inst.component !== "Meter" || inst.illustrative) continue;
    const ids = new Set(inst.sourceIds);
    if (!ids.size) for (const b of sb.beats) if (b.actions.some((a) => a.target === inst.id)) b.sourceIds.forEach((x) => ids.add(x));
    const texts = [...ids].map(pageText).filter((t): t is string => typeof t === "string");
    if (!texts.length) continue;
    const hay = texts.join(" ").replace(/(\d),(\d{3})\b/g, "$1$2");
    const missing: { text: string; derived: boolean; beatId: string }[] = [];
    for (const sh of meterShownNumbers(snaps, inst.id)) {
      const nums = (sh.text.match(/(?<![\p{L}\p{N}_.])\d+(?:\.\d+)?/gu) ?? []).filter((n) => !/^0+$/.test(n));
      if (nums.some((n) => !new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d]|\\.\\d)`).test(hay))) missing.push(sh);
    }
    if (missing.length)
      out.push({
        id: "DS1",
        severity: "error",
        beatId: missing[0].beatId,
        message: `Meter "${inst.id}" is sourced (${[...ids].join(", ")}) but shows ${missing.slice(0, 4).map((m) => `"${m.text}"${m.derived ? " (the derived percentage of value)" : ""}`).join(", ")}, which no source page says — set valueLabel / limitLabel to the source's figure, or mark the instance illustrative`,
      });
  }
  return out;
}

// ── W5.1 packet N: number-true quantities vs the narration (L46), cell-state meaning (L47), list highlights (L48),
// inverted quote fragments (L49). Pure, over the digest snapshots of the stage-fitted board. ─────────────────────────

/** A quantity the narration speaks ("2 gigabytes", "two gigabytes", "4GB", "500 megabytes", "75 percent", "500 threads"). */
export interface SpokenQuantity extends Quantity {
  /** The words as spoken. */
  text: string;
}
const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, half: 0.5,
};
/** Spoken unit words → [dim, factor] (the written forms parseQuantity knows are added below). */
const SPOKEN_UNITS: Record<string, [Quantity["dim"], number]> = {
  byte: ["bytes", 1], bytes: ["bytes", 1], kilobyte: ["bytes", 1e3], kilobytes: ["bytes", 1e3], megabyte: ["bytes", 1e6], megabytes: ["bytes", 1e6], meg: ["bytes", 1e6], megs: ["bytes", 1e6],
  gigabyte: ["bytes", 1e9], gigabytes: ["bytes", 1e9], gig: ["bytes", 1e9], gigs: ["bytes", 1e9], terabyte: ["bytes", 1e12], terabytes: ["bytes", 1e12],
  kibibytes: ["bytes", 1024], mebibytes: ["bytes", 1024 ** 2], gibibytes: ["bytes", 1024 ** 3], percent: ["percent", 1], "%": ["percent", 1],
};
const NUM_WORD_RE = Object.keys(NUM_WORDS).join("|");
const SPOKEN_QTY_RE = new RegExp(`(?<![\\p{L}\\p{N}_.])(\\d+(?:[.,]\\d+)?|(?:${NUM_WORD_RE})(?:[- ](?:${NUM_WORD_RE}))?)(?:\\s+(hundred|thousand))?\\s*-?\\s*(%|[A-Za-z]+)`, "giu");
/** Plural / singular-insensitive noun key ("threads" ≡ "thread"). */
const nounKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/(?:es|s)$/, "");
/** Words that follow a number but are not its unit (counts are only compared against a matching unitLabel). */
const NOT_A_UNIT = /^(?:and|or|of|to|the|a|an|in|on|at|by|for|is|are|was|were|times|x|more|less|plus|minus|out|per)$/i;

/** Quantities spoken in a phrase, in order. Bytes / percent always; any other "<number> <noun>" is a count of that noun. */
export function spokenQuantities(phrase: string): SpokenQuantity[] {
  const out: SpokenQuantity[] = [];
  for (const m of phrase.matchAll(SPOKEN_QTY_RE)) {
    let n: number;
    if (/^\d/.test(m[1])) n = Number(m[1].replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    else n = m[1].toLowerCase().split(/[- ]/).reduce((a, w) => a + (NUM_WORDS[w] ?? 0), 0);
    if (m[2]) n *= m[2].toLowerCase() === "hundred" ? 100 : 1000;
    const unitRaw = m[3];
    const unit = unitRaw.toLowerCase();
    if (!Number.isFinite(n) || n <= 0 || NOT_A_UNIT.test(unit)) continue;
    const u = SPOKEN_UNITS[unit] ?? QTY_UNITS[unit];
    if (u && u[0] !== "time") out.push({ n, unit, dim: u[0], base: n * u[1], text: m[0].trim() });
    else if (!u && /^[a-z]{3,}$/i.test(unitRaw) && /^\d/.test(m[1])) out.push({ n, unit: nounKey(unit), dim: "count", base: n, text: m[0].trim() });
  }
  return out;
}

/** "200 MB" / "1 cell = 200 MB": what one unit label stands for (unitLabel "MB" → bytes 1e6, "%" → percent, "users" →
 *  count of "user"); null = unreadable. */
function unitOf(label: string): { dim: Quantity["dim"]; factor: number; unit: string } | null {
  const l = label.trim().toLowerCase();
  const u = SPOKEN_UNITS[l] ?? QTY_UNITS[l];
  if (u) return u[0] === "time" ? null : { dim: u[0], factor: u[1], unit: l };
  return /^[a-z][a-z ]{1,}$/.test(l) ? { dim: "count", factor: 1, unit: nounKey(l.split(" ").pop()!) } : null;
}

/** One drawn quantity a phrase may be naming, in the spoken dimension. */
interface DrawnQty {
  dim: Quantity["dim"];
  /** Read at a scale the reel only STATES (a limit in the narration / a pill), not one the component shows. */
  inferred?: boolean;
  unit?: string;
  base: number;
  /** How it reads ("10 cells = 2 GB", "valueLabel 2GB"). */
  what: string;
}
/** A quantity component that changed on a beat, with what it draws and how close a spoken number must come. */
export interface DrawnQuantities {
  instId: string;
  component: string;
  /** The drawn quantities a phrase may name (base units). */
  shown: DrawnQty[];
  /** dims the component can show numbers in WITH a visible unit (scale chip / numeric label). */
  labelled: Set<Quantity["dim"]>;
  /** Count nouns it shows (unitLabel / caption). */
  nouns: Set<string>;
  /** Absolute tolerance per dim (one cell, or a share of the number). */
  tol: (dim: Quantity["dim"], q: number) => number;
  /** ContainerBox without its own byte scale: per-cell bytes inferred from a limit the reel states (or null). */
  inferredCell?: number | null;
  /** The cells that changed on the beat (ContainerBox / UnitGrid), for the message. */
  changed?: number;
}

/** L46 tolerance for a number on a label (Meter readout) or a fill, as a share of the spoken number. */
export const QTY_SPOKEN_TOL = 0.12;

/** Byte limit the reel STATES next to the word "limit" (a phrase "under the 4 GB limit", a pill "LIMIT 4GB"); null = none. */
export function statedLimit(texts: readonly string[]): Quantity | null {
  for (const t of texts) {
    const m = /\blimits?\b\W{0,3}(?:of\W+|is\W+|=\W*)?(\d+(?:[.,]\d+)?\s*[a-z]+)|(\d+(?:[.,]\d+)?\s*[-\s]?[a-z]+)\W{0,3}(?:memory\W+)?limits?\b/i.exec(t);
    const hit = m ? (m[1] ?? m[2]) : null;
    // spoken words first ("4 gigabytes" is a count of "gigabytes" to parseQuantity), then the written form ("4GB")
    const q = hit ? [spokenQuantities(hit)[0], parseQuantity(hit)].find((x) => x?.dim === "bytes") : null;
    if (q) return q;
  }
  return null;
}

const USED = (k: string) => k !== "empty" && k !== "freed";

/** What a ContainerBox / Meter / UnitGrid draws on a beat it changes on (prev = the same item at the previous beat it
 *  was on screen, or null). `limit` = statedLimit of the reel (ContainerBox without a byte scale). */
export function drawnQuantities(o: Pick<OnScreen, "inst" | "state" | "props">, prev: Pick<OnScreen, "state" | "props"> | null, limit: Quantity | null): DrawnQuantities | null {
  const p = o.props;
  const shown: DrawnQty[] = [];
  const labelled = new Set<Quantity["dim"]>();
  const nouns = new Set<string>();
  const add = (dim: Quantity["dim"], base: number, what: string, unit?: string) => {
    if (Number.isFinite(base) && base > 0) shown.push({ dim, base, what, ...(unit ? { unit } : {}) });
  };
  if (o.inst.component === "ContainerBox") {
    const b = boxReadout(o.state, p);
    const pb = prev ? boxReadout(prev.state, prev.props) : null;
    const kinds = boxCellKinds(b.fill, p) ?? Array.from({ length: BOX_CELLS }, (_, i) => (i < Math.round(b.fill * BOX_CELLS) ? "filled" : "empty"));
    const pk = prev && pb ? (boxCellKinds(pb.fill, prev.props) ?? Array.from({ length: BOX_CELLS }, (_, i) => (i < Math.round(pb.fill * BOX_CELLS) ? "filled" : "empty"))) : null;
    const changedIdx = kinds.map((k, i) => (USED(k) && (!pk || pk[i] !== k) ? i : -1)).filter((i) => i >= 0);
    const used = kinds.filter(USED).length;
    const cellCounts: [number, string][] = [];
    if (changedIdx.length) {
      cellCounts.push([changedIdx.length, `the ${changedIdx.length} cell(s) that change on this beat`]);
      for (const k of new Set(changedIdx.map((i) => kinds[i]))) cellCounts.push([kinds.filter((x) => x === k).length, `all ${kinds.filter((x) => x === k).length} "${k}" cells`]);
    } else for (const k of new Set(kinds.filter(USED))) cellCounts.push([kinds.filter((x) => x === k).length, `the ${kinds.filter((x) => x === k).length} "${k}" cells`]);
    cellCounts.push([used, `all ${used} used cells`]);
    // the scale: the "1 cell = …" chip, else a limit with a unit on the meter row, else (unlabelled) a limit the reel states
    const unit = typeof p.unitLabel === "string" ? unitOf(p.unitLabel) : null;
    const lim = parseLimit(typeof p.limitLabel === "string" ? p.limitLabel : undefined);
    const limQ = lim ? parseQuantity(`${lim.max}${lim.tail.trim()}`) : null;
    let perCell: { dim: Quantity["dim"]; base: number; unit?: string } | null = null;
    if (unit && typeof p.cellValue === "number") perCell = { dim: unit.dim, base: p.cellValue * unit.factor, unit: unit.unit };
    else if (limQ && limQ.dim === "bytes") perCell = { dim: "bytes", base: limQ.base / BOX_CELLS };
    if (perCell) {
      labelled.add(perCell.dim);
      if (perCell.dim === "count" && perCell.unit) nouns.add(perCell.unit);
      for (const [n, what] of cellCounts) add(perCell.dim, n * perCell.base, what, perCell.unit);
      add(perCell.dim, BOX_CELLS * perCell.base, `the whole box (${BOX_CELLS} cells, the limit)`, perCell.unit);
      if (lim?.used != null && limQ) add("bytes", (lim.used / lim.max) * limQ.base, `the readout ${b.right}`);
    }
    for (const [n, what] of cellCounts) add("percent", (100 * n) / BOX_CELLS, what);
    add("percent", 100 * b.fill, "the bar fill");
    const inferredCell = !perCell && limit ? limit.base / BOX_CELLS : null;
    if (inferredCell) for (const [n, what] of cellCounts) shown.push({ dim: "bytes", base: n * inferredCell, what, inferred: true });
    return { instId: o.inst.id, component: "ContainerBox", shown, labelled, nouns, tol: (dim, q) => (dim === "percent" ? 100 / BOX_CELLS + 1e-6 : perCell && dim === perCell.dim ? perCell.base * 1.0001 : QTY_SPOKEN_TOL * q), inferredCell, changed: changedIdx.length };
  }
  if (o.inst.component === "Meter") {
    const m = meterReadout(o.state, p);
    const vq = typeof p.valueLabel === "string" ? parseQuantity(p.valueLabel) : null;
    const lq = parseQuantity(p.limitLabel);
    if (vq && vq.dim !== "time" && vq.dim !== "count") {
      add(vq.dim, vq.base, `valueLabel "${p.valueLabel}"`);
      labelled.add(vq.dim);
    }
    if (lq && lq.dim !== "time" && lq.dim !== "count") {
      add(lq.dim, lq.base, `limitLabel "${p.limitLabel}"`);
      add(lq.dim, (m.level / (m.limit || 1)) * lq.base, `the bar (${Math.round((100 * m.level) / (m.limit || 1))} % of "${p.limitLabel}")`);
      labelled.add(lq.dim);
    }
    if (!vq) {
      add("percent", 100 * m.level, `the readout ${m.readout}`);
      labelled.add("percent");
    }
    add("percent", (100 * m.level) / (m.limit || 1), "the bar fill");
    return { instId: o.inst.id, component: "Meter", shown, labelled, nouns, tol: (_d, q) => QTY_SPOKEN_TOL * q };
  }
  if (o.inst.component === "UnitGrid") {
    const filled = typeof p.filled === "number" ? p.filled : 0;
    const pf = prev && typeof prev.props.filled === "number" ? prev.props.filled : 0;
    const unit = typeof p.unitLabel === "string" ? unitOf(p.unitLabel) : null;
    const cv = typeof p.cellValue === "number" ? p.cellValue : 1;
    const counts: [number, string][] = [[filled, `the ${filled} lit cells`], ...(filled !== pf ? [[Math.abs(filled - pf), `the ${Math.abs(filled - pf)} cells that change`] as [number, string]] : [])];
    if (unit) {
      labelled.add(unit.dim);
      if (unit.dim === "count") nouns.add(unit.unit);
      for (const [n, what] of counts) add(unit.dim, n * cv * unit.factor, what, unit.unit);
    }
    if (!unit || unit.dim !== "percent") for (const [n, what] of counts) add("percent", n, `${what} of 100`);
    const capNoun = typeof p.caption === "string" ? /\d+\s+(?:of\s+\d+\s+)?([a-z]+)/i.exec(p.caption)?.[1] : undefined;
    if (capNoun) {
      nouns.add(nounKey(capNoun));
      labelled.add("count");
      for (const [n, what] of counts) add("count", n * cv, what, nounKey(capNoun));
    }
    labelled.add("percent");
    return { instId: o.inst.id, component: "UnitGrid", shown, labelled, nouns, tol: (dim, q) => (unit && dim === unit.dim ? cv * unit.factor * 1.0001 : dim === "percent" && !unit ? 1.0001 : QTY_SPOKEN_TOL * q), changed: Math.abs(filled - pf) };
  }
  return null;
}

const fmtBase = (q: { dim: Quantity["dim"]; base: number; unit?: string }) =>
  q.dim === "percent"
    ? `${Math.round(q.base)} %`
    : q.dim === "bytes"
      ? q.base >= 1e9
        ? `${Math.round(q.base / 1e8) / 10} GB`
        : `${Math.round(q.base / 1e5) / 10} MB`
      : `${Math.round(q.base * 10) / 10}${q.unit ? ` ${q.unit}` : ""}`;

export interface QuantityIssue {
  beatId: string;
  frame: number;
  instId: string;
  severity: Severity;
  message: string;
}

/**
 * L46: on a beat that CHANGES a quantity component (enter / state / countUp / mark / props), a number the phrase speaks
 * in a dimension the component draws must be one it draws (± one cell, or ± QTY_SPOKEN_TOL of a label / fill). W5 r2
 * evergreen-oom b04 "an extra 2 gigabytes" added 2 of 20 cells (= 400 MB at the 4 GB limit); W3.3 "400 MB" on a full
 * 1 Gi bar. Block when the component shows that dimension with a visible unit (a "1 cell = …" chip, a numeric limit or
 * readout); a spoken size on a component with no unit at all is an error: the viewer cannot read the number off it.
 * A visible ILLUSTRATIVE text on screen exempts the beat. Phrases with no quantity are not checked.
 */
export function quantityNarrationIssues(sb: Pick<Storyboard, "beats" | "world">, tl: Pick<Timeline, "events">, snaps: readonly BeatSnapshot[]): QuantityIssue[] {
  const QTY = new Set(["ContainerBox", "Meter", "UnitGrid"]);
  // a keyword act on the component (focus / pulse point the viewer AT its quantity) counts like a change
  const CHANGE = new Set(["enter", "state", "countUp", "mark", "drawOn", "focus", "pulse"]);
  const stated = statedLimit([...sb.beats.map((b) => b.phrase), ...sb.world.flatMap((i) => stringsIn(i.props))]);
  const last = new Map<string, OnScreen>();
  const unlabelled = new Set<string>();
  const out: QuantityIssue[] = [];
  for (const s of snaps) {
    const phrase = sb.beats[s.beat.index]?.phrase ?? "";
    const spoken = spokenQuantities(phrase);
    const illustrative = s.items.some((o) => drawnTexts(o).some((t) => /illustrative/i.test(t.text)));
    const acted = new Set(tl.events.filter((e) => e.kind === "action" && e.beatId === s.beat.id && (CHANGE.has(e.do) || !!e.props)).map((e) => (e.kind === "action" ? e.target : "")));
    const changed: DrawnQuantities[] = [];
    for (const o of s.items) {
      if (!QTY.has(o.inst.component)) continue;
      if (acted.has(o.inst.id)) {
        const d = drawnQuantities(o, last.get(o.inst.id) ?? null, stated);
        if (d) changed.push(d);
      }
      last.set(o.inst.id, o);
    }
    if (!spoken.length || !changed.length || illustrative) continue;
    const comparable = (d: DrawnQuantities, q: SpokenQuantity) => q.dim !== "count" || d.nouns.has(q.unit);
    const hits = (d: DrawnQuantities, q: SpokenQuantity, inferred = false) =>
      d.shown.some((x) => !!x.inferred === inferred && x.dim === q.dim && (q.dim !== "count" || x.unit === q.unit) && Math.abs(x.base - q.base) <= (inferred ? d.inferredCell! * 1.0001 : d.tol(q.dim, q.base)));
    // the beat is fine when ONE spoken number is drawn by ONE of the components it changes
    if (spoken.some((q) => changed.some((d) => comparable(d, q) && hits(d, q)))) continue;
    for (const d of changed) {
      const qs = spoken.filter((q) => comparable(d, q) && (d.labelled.has(q.dim) || q.dim === "bytes" || q.dim === "percent"));
      if (!qs.length) continue;
      const q = qs[0];
      const name = `${d.component} "${d.instId}"`;
      if (!d.labelled.has(q.dim)) {
        // no visible unit: a mismatch at the limit the reel states is reported on its beat; otherwise once per instance
        const atLimit = !!d.inferredCell && q.dim === "bytes";
        const mismatch = atLimit && !qs.some((x) => x.dim === "bytes" && hits(d, x, true));
        if (!mismatch && unlabelled.has(d.instId)) continue;
        // drawn cells that CONTRADICT the scale the reel states (W5 r2 oom b04: "2 gigabytes" = 10 cells at the 4 GB
        // limit, 2 cells drawn) block like a labelled mismatch; a merely unlabelled scale is an error
        unlabelled.add(d.instId);
        const inferred = atLimit
          ? mismatch
            ? ` At the limit the reel states (${fmtBase({ dim: "bytes", base: d.inferredCell! * BOX_CELLS })} → ${fmtBase({ dim: "bytes", base: d.inferredCell! })} per cell) ${q.text} is ${Math.round(q.base / d.inferredCell!)} cells, but ${d.changed ? `${d.changed} cell(s) change on this beat (= ${fmtBase({ dim: "bytes", base: d.changed * d.inferredCell! })})` : "no cell changes"}.`
            : ` (At the limit the reel states, ${fmtBase({ dim: "bytes", base: d.inferredCell! })} per cell, the cells do match — but nothing on screen says so.)`
          : "";
        out.push({ beatId: s.beat.id, frame: s.frame, instId: d.instId, severity: mismatch ? "block" : "error", message: `${s.beat.id} @${s.frame}: the phrase says "${q.text}" while ${name} changes, but it shows no ${q.dim === "bytes" ? "size unit" : q.dim} scale — the viewer cannot read ${q.text} off it.${inferred} Set cellValue + unitLabel ("1 cell = …") and fill the cells to that scale${d.component === "Meter" ? " (or give it a valueLabel / limitLabel in that unit)" : ""}, or put an ILLUSTRATIVE tag on screen` });
      } else {
        const near = d.shown.filter((x) => x.dim === q.dim).map((x) => `${x.what} = ${fmtBase(x)}`).slice(0, 3).join(", ");
        out.push({ beatId: s.beat.id, frame: s.frame, instId: d.instId, severity: "block", message: `${s.beat.id} @${s.frame}: the phrase says "${q.text}" but ${name} draws ${near || "nothing in that unit"} — the drawn quantity must equal the spoken one (± one cell): fill the cells / bar to ${q.text} at its scale, or say the number it draws` });
      }
    }
  }
  return out;
}

/** L47: words that say a freed / reclaimed cell is used again (a re-fill), on the beat it turns used. */
export const REFILL_RE = /\b(?:re-?fill\w*|fill(?:s|ed|ing)?|alloc\w*|grow\w*|grew|new|reus\w*|again|back|climb\w*|ris(?:e|es|ing)|rose|creep\w*|balloon\w*|leak\w*|spik\w*|re-?fault\w*|re-?charg\w*|reload\w*|restart\w*|return\w*|refill\w*|takes? over|re-?use\w*)\b/i;

/**
 * L47: a ContainerBox cell drawn "freed" (reclaimed) must not later turn used (danger / filled / accent) in the same
 * instance unless that beat's phrase says it is filled again. W5 r2 evergreen-oom b14 → b15: the page-cache cell b14
 * reclaims turns red at b15 under "anonymous pages and shmem mostly cannot be reclaimed" — drawn, it says page cache
 * is the unreclaimable part (the w32/r3 page-cache-blame mechanism). A box that (re-)enters or is killed / freed
 * starts a new episode (the freed cells are forgotten).
 */
export function cellStateIssues(sb: Pick<Storyboard, "beats">, snaps: readonly BeatSnapshot[]): { beatId: string; frame: number; instId: string; cells: number[]; from: string; to: string; message: string }[] {
  const freed = new Map<string, Map<number, string>>();
  const out: { beatId: string; frame: number; instId: string; cells: number[]; from: string; to: string; message: string }[] = [];
  let onPrev = new Set<string>();
  for (const s of snaps) {
    const phrase = sb.beats[s.beat.index]?.phrase ?? "";
    const on = new Set(s.items.map((o) => o.inst.id));
    for (const o of s.items) {
      if (o.inst.component !== "ContainerBox") continue;
      // a new episode: the box (re-)enters, or was killed / drained (the story restarts the memory) — forget freed cells
      if (!onPrev.has(o.inst.id) || o.state === "killed" || o.state === "freed") freed.delete(o.inst.id);
      const kinds = boxCellKinds(boxReadout(o.state, o.props).fill, o.props);
      if (!kinds) continue;
      const f = freed.get(o.inst.id) ?? freed.set(o.inst.id, new Map()).get(o.inst.id)!;
      const back: number[] = [];
      kinds.forEach((k, i) => {
        if (k === "freed") f.set(i, f.get(i) ?? s.beat.id);
        else if (USED(k) && f.has(i)) back.push(i);
      });
      if (!back.length) continue;
      const from = f.get(back[0])!;
      for (const i of back) f.delete(i);
      if (REFILL_RE.test(phrase)) continue;
      const to = [...new Set(back.map((i) => kinds[i]))].join("/");
      out.push({
        beatId: s.beat.id,
        frame: s.frame,
        instId: o.inst.id,
        cells: back.map((i) => i + 1),
        from,
        to,
        message: `${s.beat.id} @${s.frame}: ContainerBox "${o.inst.id}" cell${back.length > 1 ? "s" : ""} ${back.map((i) => i + 1).join(", ")} ${back.length > 1 ? "were" : "was"} freed at ${from} and turn${back.length > 1 ? "" : "s"} ${to} here, but "${phrase}" says nothing refills ${back.length > 1 ? "them" : "it"} — drawn, the reclaimed part becomes the failing part. Keep the freed cell${back.length > 1 ? "s" : ""} freed (or empty) on this beat, or add a beat whose phrase says new allocations refill it`,
      });
    }
    onPrev = on;
  }
  return out;
}

// L48 helpers: does a list item name what the phrase / a co-visible terminal says? Token match with prefixes,
// acronyms ("OOM" = out of memory) and prefix-concatenations ("MEMCG" = memory cgroup).
const ITEM_STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "for", "is", "it", "was", "by", "at", "no", "not"]);
const toks = (s: string) => s.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean);
function abbreviates(t: string, ev: readonly string[], i: number): boolean {
  // t = prefixes (≥ 2 chars; the first ≥ 3) of ev[i], ev[i+1], … in order, ≥ 2 tokens
  const go = (rest: string, j: number, k: number): boolean => {
    if (!rest) return k >= 2;
    if (j >= ev.length || k >= 4) return false;
    for (let n = Math.min(rest.length, ev[j].length); n >= (k === 0 ? 3 : 2); n--) if (ev[j].startsWith(rest.slice(0, n)) && go(rest.slice(n), j + 1, k + 1)) return true;
    return false;
  };
  return go(t, i, 0);
}
function tokenNamed(t: string, ev: readonly string[]): boolean {
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e === t || (t.length >= 3 && e.startsWith(t)) || (e.length >= 4 && t.startsWith(e))) return true;
    if (t.length >= 2 && t.length <= 5 && i + t.length <= ev.length && ev.slice(i, i + t.length).map((w) => w[0]).join("") === t) return true;
    if (t.length >= 4 && abbreviates(t, ev, i)) return true;
  }
  return false;
}
/** How many of an item's words the evidence names (stop words excluded). */
export function itemNamedScore(item: string, evidence: string): number {
  const ev = toks(evidence);
  return [...new Set(toks(item).filter((t) => !ITEM_STOP.has(t)))].filter((t) => tokenNamed(t, ev)).length;
}

/**
 * L48: a highlighted list item (SourceTag stack / VersionPills `highlight`, 0-INDEXED) must be the item the beat names.
 * On a beat that acts on the list (enter / state / mark / focus / pulse) or on a co-visible Terminal, the phrase + the
 * terminal lines shown + kinetic words are matched against each item; when exactly one item is named best and the
 * highlight points elsewhere → error. Also: a stack drawn in the accent tone paints EVERY pill lime, so its highlight
 * is invisible. W5 r2 evergreen-oom b19: highlight 1 lit GLOBAL OOM under "Kernel logs show which it was" next to the
 * terminal line "Memory cgroup out of memory" (MEMCG OOM is index 0), and the stack's accent state made both pills lime.
 */
export function highlightIssues(sb: Pick<Storyboard, "beats">, tl: Pick<Timeline, "events">, snaps: readonly BeatSnapshot[]): { beatId: string; frame: number; instId: string; kind: "index" | "invisible"; message: string }[] {
  const out: { beatId: string; frame: number; instId: string; kind: "index" | "invisible"; message: string }[] = [];
  const seen = new Set<string>();
  for (const s of snaps) {
    const acted = new Set(tl.events.filter((e) => e.kind === "action" && e.beatId === s.beat.id).map((e) => (e.kind === "action" ? e.target : "")));
    const termActed = s.items.some((o) => o.inst.component === "Terminal" && acted.has(o.inst.id));
    const evidence = [sb.beats[s.beat.index]?.phrase ?? "", ...s.items.filter((o) => o.inst.component === "Terminal" || o.inst.component === "KineticWord").flatMap((o) => drawnTexts(o).filter((t) => t.what === "term" || t.what === "kinetic").map((t) => t.text))].join(" \n ");
    for (const o of s.items) {
      const stack = o.inst.component === "SourceTag" && o.props.variant === "stack";
      if (!stack && o.inst.component !== "VersionPills") continue;
      const hi = o.props.highlight;
      const items = Array.isArray(o.props.items) ? (o.props.items as unknown[]).map(String) : [];
      if (typeof hi !== "number" || hi >= items.length) continue;
      if (!acted.has(o.inst.id) && !termActed) continue;
      const tone = String(o.state ?? o.props.tone ?? "");
      if (stack && tone === "accent" && !seen.has(`${o.inst.id}|inv`)) {
        seen.add(`${o.inst.id}|inv`);
        out.push({ beatId: s.beat.id, frame: s.frame, instId: o.inst.id, kind: "invisible", message: `${s.beat.id} @${s.frame}: SourceTag stack "${o.inst.id}" is in the accent tone, so EVERY pill is lime and its highlight ("${items[hi]}") is invisible — keep the stack neutral and let \`highlight\` mark the one item` });
      }
      const scores = items.map((it) => itemNamedScore(it, evidence));
      const best = Math.max(...scores);
      if (best <= 0 || scores.filter((x) => x === best).length !== 1) continue;
      const want = scores.indexOf(best);
      if (want === hi || seen.has(`${o.inst.id}|${s.beat.id}|idx`)) continue;
      seen.add(`${o.inst.id}|${s.beat.id}|idx`);
      out.push({ beatId: s.beat.id, frame: s.frame, instId: o.inst.id, kind: "index", message: `${s.beat.id} @${s.frame}: ${o.inst.component} "${o.inst.id}" highlights item ${hi} "${items[hi]}" (highlight is 0-indexed), but this beat names "${items[want]}" (index ${want}) — set highlight ${want}` });
    }
  }
  return out;
}

/** L49: verbs that NEGATE the clause after them ("missed validating that X" = X was never checked, so not-X held). */
const NEG_LEAD_RE = /\b(?:missed|miss(?:es|ing)?|failed|fail(?:s|ing)?|forgot|forget(?:s|ting)?|neglected|never|skipped|omitted|didn[’']?t|did not|doesn[’']?t|does not|without)\s+(?:[a-z’']+\s+){0,3}?(?:that|whether|if)\s+(.+)$/i;
const NEG_WORDS = new Set(["no", "not", "never", "missed", "missing", "without", "failed", "unchecked", "skipped", "nt"]);

/**
 * L49: an on-screen string that quotes the clause after a negating verb, without the verb, says the opposite of the
 * phrase. W5 r2 event-recent b12: "The SDK missed validating that a flag's name was not nil." → a red terminal line
 * "flag name was not nil" (the name WAS nil). Matched when the string's words are ≥ 3 consecutive words of that clause
 * (articles / possessives ignored) and the string has no negating word of its own beyond the clause's.
 */
export function invertedFragmentIssues(sb: Pick<Storyboard, "beats">, snaps: readonly BeatSnapshot[]): { beatId: string; frame: number; instId: string; text: string; message: string }[] {
  const out: { beatId: string; frame: number; instId: string; text: string; message: string }[] = [];
  const norm = (s: string) => toks(s).filter((t) => t !== "a" && t !== "an" && t !== "the");
  for (const s of snaps) {
    const phrase = sb.beats[s.beat.index]?.phrase ?? "";
    const m = NEG_LEAD_RE.exec(phrase);
    if (!m) continue;
    const clause = norm(m[1]);
    const lead = phrase.slice(0, m.index + m[0].length - m[1].length);
    for (const o of s.items)
      for (const t of drawnTexts(o)) {
        const w = norm(t.text);
        // a string with a negating word of its own ("no nil check on flag name") re-states the negation: fine
        if (w.length < 3 || w.some((x) => NEG_WORDS.has(x) && !clause.includes(x))) continue;
        const at = clause.findIndex((_, i) => w.every((x, j) => clause[i + j] === x));
        if (at < 0) continue;
        out.push({ beatId: s.beat.id, frame: s.frame, instId: o.inst.id, text: t.text, message: `${s.beat.id} @${s.frame}: ${o.inst.component} "${o.inst.id}" draws "${t.text}", the clause after "${lead.trim().split(/\s+/).slice(-4).join(" ")}" without its negating verb — on screen it states the opposite of the phrase. Draw what was actually true (e.g. "${m[1].replace(/\bwas not\b/i, "=").replace(/\bis not\b/i, "=").replace(/[.!?]+$/, "")}" → the value it really had, or "no check on …")` });
      }
  }
  return out;
}

/** L39: a focal NodeGraph must, at its best beat, span ≥ 60 % of the content width AND ≥ 25 % of the focal height
 *  (W3.3: tls graph 54 % wide, dns graph 13 % of the focal height). L29 (warn) keeps the 70 % target. */
export const SUBJECT_MIN_W = 0.6;
export const SUBJECT_MIN_H = 0.25;
/** L40: the focal group's centre may sit this far (screen px) left / right of the frame centre x 540. KineticWord and
 *  Stamp are typography on the left text axis and do not count. W3.3 tls: the graph centre at x ≈ 464 for 17 beats. */
export const OFFCENTRE_PX = 60;
const OFFCENTRE_SKIP = new Set(["KineticWord", "Stamp"]);
/** L41: a horizontal band of the focal stage (y 218–1400) with nothing in it, as a share of the focal height, held
 *  over this many consecutive story beats. Calibrated so the golden OOMKill board (worst: 724 px for 2 beats) passes. */
export const EMPTY_BAND_SHARE = 0.55;
export const EMPTY_BAND_RUN = 3;
/** L43: this many consecutive beats whose digests differ only trivially → error (L34 warns from MONOTONY_RUN). */
export const DIGEST_MONOTONY_RUN = 3;
/** L43: a ContainerBox / Meter fill change below this, or fewer cell changes than BOX_CELL_STEP, is trivial. */
export const FILL_STEP = 0.1;
export const BOX_CELL_STEP = 2;

/** Largest empty horizontal band (screen y) of the focal stage, given the items' screen boxes. */
export function emptyBand(boxes: readonly Box[], y0 = HEADER_BAND_BOTTOM, y1 = FOCAL_BOTTOM): { from: number; to: number } {
  const iv = boxes.map((b) => [Math.max(y0, b.y), Math.min(y1, b.y + b.h)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let cur = y0;
  let best = { from: y0, to: y0 };
  for (const [a, b] of iv) {
    if (a - cur > best.to - best.from) best = { from: cur, to: a };
    cur = Math.max(cur, b);
  }
  if (y1 - cur > best.to - best.from) best = { from: cur, to: y1 };
  return best;
}

const SAME_CAM = (a: CamState, b: CamState) => Math.abs(a.zoom / b.zoom - 1) <= DUP_CAM_ZOOM && Math.hypot(a.x - b.x, a.y - b.y) * a.zoom <= DUP_CAM_PX && Math.abs(a.tiltX - b.tiltX) <= 1;

/** Why two consecutive snapshots differ visibly, or null when they differ only trivially (L43): same camera, same
 *  focal instances, no state change, and props changes below the per-component steps (a NodeGraph recolour of fewer
 *  than GRAPH_RECOLOUR_SHARE of its elements, a fill change < FILL_STEP, < BOX_CELL_STEP cells). Pills, quotes,
 *  emphasis (pulse / focus / mark packets) and non-focal instances never count. */
export function visibleChange(prev: BeatSnapshot, cur: BeatSnapshot): string | null {
  if (!SAME_CAM(prev.cam, cur.cam)) return "camera move";
  const fp = new Map(prev.items.filter((o) => o.focal).map((o) => [o.inst.id, o]));
  const fc = new Map(cur.items.filter((o) => o.focal).map((o) => [o.inst.id, o]));
  for (const id of fc.keys()) if (!fp.has(id)) return `${id} enters`;
  for (const id of fp.keys()) if (!fc.has(id)) return `${id} leaves`;
  for (const [id, c] of fc) {
    const p = fp.get(id)!;
    const comp = c.inst.component;
    if (comp !== "NodeGraph" && c.state !== p.state) return `${id} state ${c.state}`;
    if (comp === "NodeGraph") {
      const a = graphElementStates(p.props);
      const z = graphElementStates(c.props);
      if (!a || !z) {
        if (digestItem(p) !== digestItem(c)) return `${id} props`;
        continue;
      }
      let n = 0;
      for (const [k, v] of z) if (a.get(k) !== v) n++;
      if (n / Math.max(1, z.size) >= GRAPH_RECOLOUR_SHARE) return `${id} recolours ${n}/${z.size}`;
      if (c.state !== p.state) return `${id} state ${c.state}`;
      const labels = (x: Record<string, unknown>) => JSON.stringify(((x.nodes as { label?: string }[] | undefined) ?? []).map((nd) => nd.label));
      if (labels(p.props) !== labels(c.props)) return `${id} relabels`;
    } else if (comp === "ContainerBox") {
      const a = boxReadout(p.state, p.props);
      const z = boxReadout(c.state, c.props);
      if (Math.abs(a.fill - z.fill) >= FILL_STEP - 1e-9) return `${id} fill ${Math.round(a.fill * 100)}→${Math.round(z.fill * 100)} %`;
      const ca = Array.isArray(p.props.cells) ? (p.props.cells as unknown[]).map(String) : [];
      const cz = Array.isArray(c.props.cells) ? (c.props.cells as unknown[]).map(String) : [];
      let n = 0;
      for (let i = 0; i < BOX_CELLS; i++) if ((ca[i] ?? "") !== (cz[i] ?? "")) n++;
      if (n >= BOX_CELL_STEP) return `${id} repaints ${n} cells`;
      if (a.left !== z.left || a.right !== z.right || p.props.title !== c.props.title || p.props.subtitle !== c.props.subtitle) return `${id} relabels`;
    } else if (comp === "Meter") {
      const a = meterReadout(p.state, p.props);
      const z = meterReadout(c.state, c.props);
      if (Math.abs(a.level - z.level) >= FILL_STEP - 1e-9) return `${id} fill ${Math.round(a.level * 100)}→${Math.round(z.level * 100)} %`;
      if (a.readout !== z.readout || a.label !== z.label || p.props.limitLabel !== c.props.limitLabel) return `${id} relabels`;
    } else if (digestItem(p) !== digestItem(c)) return `${id} ${comp === "Terminal" ? "shows a new line" : "props change"}`;
  }
  return null;
}

/** L43 runs: maximal stretches of ≥ DIGEST_MONOTONY_RUN beats, each only trivially different from the one before
 *  (the CTA may hold the closing frame and breaks a run). */
export function digestMonotonyRuns(snaps: readonly BeatSnapshot[]): { beats: string[]; digests: string[] }[] {
  const out: { beats: string[]; digests: string[] }[] = [];
  let run: BeatSnapshot[] = [];
  const flush = () => {
    if (run.length >= DIGEST_MONOTONY_RUN) out.push({ beats: run.map((s) => s.beat.id), digests: run.map((s) => s.items.filter((o) => o.focal).map(digestItem).join(" · ")) });
    run = [];
  };
  snaps.forEach((s, i) => {
    if (s.beat.part === "cta") return flush();
    const prev = snaps[i - 1];
    if (!run.length || !prev || visibleChange(prev, s) !== null) {
      flush();
      run = [s];
    } else run.push(s);
  });
  flush();
  return out;
}

// ── W5 fix round 1 (packet V): attribution of a party's count, caption negator drops, packet traces ──────────────

/** Hosts whose pages carry an author, not an owner the narration could name (blog platforms, forums, aggregators). */
const AUTHOR_HOSTS = new Set(["dev", "medium", "substack", "github", "gitlab", "reddit", "ycombinator", "stackoverflow", "stackexchange", "x", "twitter", "linkedin", "youtube", "wikipedia", "hashnode", "lobste", "mastodon", "bsky", "news"]);
/** Generic words of a title prefix ("Hetzner status: …" → "Hetzner"). */
const OWNER_GENERIC = /\b(status|blog|engineering|docs?|documentation|incident|incidents|report|post-?mortem|news|updates?|the|official|community|forum|support|help|security|advisory)\b/gi;
const compact = (s: string) => s.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9]/g, "");

/** The registrable label of a URL host ("status.hetzner.com" → "hetzner", "www.magicpages.co" → "magicpages",
 *  "bbc.co.uk" → "bbc"); null for a non-URL ref. */
export function hostLabel(ref: string): string | null {
  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? null;
  const sld = parts[parts.length - 2];
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && ["co", "com", "org", "net", "ac", "gov"].includes(sld)) return parts[parts.length - 3];
  return sld;
}

/** Who published a source: { key (host label), name (title prefix before ":" / " — " / " | ", generic words dropped;
 *  else the key) }. null when the page has an author rather than an owner (dev.to, Medium, GitHub, forums). */
export function sourceOwner(src: { title: string; ref: string }): { key: string; name: string } | null {
  const key = hostLabel(src.ref);
  if (!key || AUTHOR_HOSTS.has(key)) return null;
  const m = /^(.{2,40}?)\s*(?::|\s[—–|-]\s)/.exec(src.title);
  const prefix = m ? m[1].replace(OWNER_GENERIC, "").replace(/\s+/g, " ").trim() : "";
  return { key, name: prefix && prefix.split(" ").length <= 4 ? prefix : key };
}

const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
/** Counts in a line of narration: numbers left once dates ("October 20", "20 Oct"), years (1900–2099), clock times
 *  ("19:04", "07:34 UTC") and versions ("1.2.3", "TLS 1.3", "v2", "HTTP/2") are taken out. "84 sites" → ["84"]. */
export function countsIn(text: string): string[] {
  const t = text
    .replace(new RegExp(`\\b(?:${MONTH_RE})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), " ")
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_RE})\\b`, "gi"), " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d+(?:\.\d+){2,}\b/g, " ")
    .replace(/\b[a-z]+\/?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b(?:tls|ssl|http|version|php|python|node|kernel|linux|ubuntu|debian|windows|ios|android)\s+\d+(?:\.\d+)*\b/gi, " ");
  return [...t.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?%?/g)].map((m) => m[0].replace(/,$/, ""));
}

/** Nouns of an incident's reach: a count in front of one ("84 sites", "about 260 customer sites", "1,320 servers")
 *  sizes the outage. */
const IMPACT_NOUN = /^(?:sites?|websites?|customers?|users?|accounts?|servers?|machines?|hosts?|nodes?|vms?|instances?|services?|apps?|applications?|domains?|stores?|shops?|businesses|companies|organi[sz]ations|tenants?|projects?|repos?|repositories|databases?|clusters?|pods?|containers?|workloads?|regions?|zones?|devices?|people|requests?|connections?|deployments?|teams?|clients?|subscribers?|members?|blogs?|publications?|newsletters?)$/;
/** The counts of countsIn that size an impact: a number followed within two words by an IMPACT_NOUN. */
export function impactCountsIn(text: string): string[] {
  const words = text.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z0-9%,.-]/g, "").replace(/[,.]+$/, ""));
  const counts = new Set(countsIn(text));
  const out: string[] = [];
  words.forEach((w, i) => {
    if (counts.has(w) && words.slice(i + 1, i + 3).some((x) => IMPACT_NOUN.test(x))) out.push(w);
  });
  return out;
}

export interface AttributionIssue {
  /** First beat that states a count from this party's source. */
  beatId: string;
  part: string;
  owner: string;
  counts: string[];
  /** The reel's subject(s) (most-named owner), for the message. */
  subjects: string[];
  /** A HeroStat that enters on that beat and does not name the owner (label / caption / tag). */
  heroId: string | null;
  /** The narration names the owner on or before that beat (then only the hero caption is missing). */
  named: boolean;
}

/**
 * L44: a count taken from ONE party's report must name that party on or before the beat that first states it, when
 * the reel is about someone else (W5 r1 vswitch-mac blocker: the hook "On October 20, 84 sites went completely
 * offline" took Magic Pages' own count — 84 of ITS sites — from its post-mortem, and read as the size of Hetzner's
 * platform-wide outage; Magic Pages was not named until b18).
 *
 * Event reels only (an evergreen reel quotes documents, not victims). Owners come from the storyboard sources (host
 * label + title prefix). The subject is the owner the narration names in the most beats (ties: more sources); every
 * owner at that count is a subject and never needs naming. A beat counts when all its sourceIds belong to one
 * non-subject owner and its phrase sizes an impact (impactCountsIn: "84 sites", not "19:04" or "12 minutes"). Reels
 * with fewer than two owners are skipped (a single-owner reel is about that owner).
 */
export function attributionIssues(sb: Pick<Storyboard, "mode" | "sources" | "beats" | "world">): AttributionIssue[] {
  if (sb.mode !== "event") return [];
  const owners = new Map<string, { key: string; names: Set<string>; sources: number }>();
  const ownerOf = new Map<string, string>();
  for (const s of sb.sources) {
    const o = sourceOwner(s);
    if (!o) continue;
    const cur = owners.get(o.key) ?? { key: o.key, names: new Set<string>([o.key]), sources: 0 };
    cur.names.add(o.name);
    cur.sources++;
    owners.set(o.key, cur);
    ownerOf.set(s.id, o.key);
  }
  if (owners.size < 2) return [];
  const names = (key: string) => [...owners.get(key)!.names].map(compact).filter((n) => n.length >= 3);
  const mentions = (text: string, key: string) => names(key).some((n) => compact(text).includes(n));
  const tally = new Map([...owners.keys()].map((k) => [k, sb.beats.filter((b) => mentions(b.phrase, k)).length]));
  const top = Math.max(...tally.values());
  let subjects = [...owners.keys()].filter((k) => tally.get(k) === top);
  if (subjects.length > 1) {
    const most = Math.max(...subjects.map((k) => owners.get(k)!.sources));
    subjects = subjects.filter((k) => owners.get(k)!.sources === most);
  }
  const display = (key: string) => [...owners.get(key)!.names].find((n) => n !== key) ?? key;
  const out: AttributionIssue[] = [];
  const done = new Set<string>();
  sb.beats.forEach((b, i) => {
    const ks = [...new Set(b.sourceIds.map((id) => ownerOf.get(id) ?? `?${id}`))];
    if (ks.length !== 1 || !owners.has(ks[0]) || subjects.includes(ks[0]) || done.has(ks[0])) return;
    const counts = impactCountsIn(b.phrase);
    if (!counts.length) return;
    const key = ks[0];
    done.add(key);
    const named = sb.beats.slice(0, i + 1).some((x) => mentions(x.phrase, key));
    const heroes = b.actions.filter((a) => a.do === "enter").map((a) => sb.world.find((w) => w.id === a.target)).filter((w): w is InstanceT => w?.component === "HeroStat");
    const bare = heroes.find((h) => !mentions(["label", "caption", "tag", "prefix", "suffix"].map((k) => String((h.props ?? {})[k] ?? "")).join(" "), key));
    if (named && !bare) return;
    out.push({ beatId: b.id, part: b.part, owner: display(key), counts, subjects: subjects.map(display), heroId: bare?.id ?? null, named });
  });
  return out;
}

/** Negators a caption must not drop: "no", "not", "never", "nothing", … and any "-n't" contraction. */
const NEGATOR = /^(?:no|not|never|nothing|none|nobody|noone|nowhere|neither|nor|cannot|without)$|n[’']t$/;
/** Negators that sit on the SUBJECT ("Nothing … was lost", "no data was lost"): the clause after them is the negated
 *  predicate, so a later phrase that carries that clause alone reads as the opposite. Verb negators (not / n't /
 *  never) keep their verb in their own phrase; what follows them is a complement or a relative clause. */
const SUBJECT_NEGATOR = /^(?:no|nothing|none|nobody|noone|no-one|nowhere|neither)$/;
/** Auxiliaries / copulas: a display phrase with one after its first word and before its last reads as its own clause. */
const AUX = /^(?:is|are|was|were|be|been|being|am|has|have|had|do|does|did|can|could|will|would|shall|should|may|might|must)$/;
const bare = (w: string) => w.toLowerCase().replace(/^[^a-z0-9’']+|[^a-z0-9’']+$/g, "");

/**
 * L5b (negator drop, W5 r1 major): a display phrase that, read alone, states the opposite of its sentence — an
 * earlier phrase of the sentence holds a subject negator (SUBJECT_NEGATOR), this phrase holds no negator, and it reads
 * as a clause of its own (an auxiliary after its first word with a complement after it). vswitch b02 "Nothing that was saved was lost." split 3/3 showed
 * "saved was lost." on its own in the hook. "Nothing that was saved / was lost." passes (the second phrase starts on
 * the verb and reads as a continuation), as do fragments like "reliably installed.".
 */
export function negatorDrops(tl: Pick<Timeline, "beats" | "displayPhrases">): { id: string; beatId: string; text: string; sentence: string }[] {
  const out: { id: string; beatId: string; text: string; sentence: string }[] = [];
  for (const b of tl.beats) {
    // sentences of the beat as [first, last] global word indices
    const sents: [number, number][] = [];
    let s0 = 0;
    b.words.forEach((w, i) => {
      if (/[.?!…]["”’)]*$/.test(w.text) || i === b.words.length - 1) {
        sents.push([b.words[s0].globalIndex, w.globalIndex]);
        s0 = i + 1;
      }
    });
    const word = (g: number) => b.words.find((w) => w.globalIndex === g)!.text;
    for (const d of tl.displayPhrases) {
      if (d.beatId !== b.id) continue;
      for (const [a, z] of sents) {
        const lo = Math.max(a, d.firstWord);
        const hi = Math.min(z, d.lastWord);
        if (lo > hi) continue;
        const sentence = Array.from({ length: z - a + 1 }, (_, k) => word(a + k));
        const part = Array.from({ length: hi - lo + 1 }, (_, k) => bare(word(lo + k)));
        // only a phrase AFTER the subject negator's phrase (a phrase before it is still true as stated)
        const before = Array.from({ length: Math.max(0, lo - a) }, (_, k) => bare(word(a + k)));
        if (part.length === sentence.length || part.some((w) => NEGATOR.test(w)) || !before.some((w) => SUBJECT_NEGATOR.test(w))) continue;
        if (part.some((w, k) => k >= 1 && k <= part.length - 2 && AUX.test(w))) out.push({ id: d.id, beatId: b.id, text: d.text, sentence: sentence.join(" ") });
      }
    }
  }
  return out;
}

/** Undirected edges a packet route "a>b>c" travels: [["a","b"],["b","c"]]. */
export function packetRouteEdges(packet: string): [string, string][] {
  const ids = packet.split(">");
  return ids.slice(1).map((to, i) => [ids[i], to]);
}
/** Narration that says traffic was lost / dropped / refused on the way. */
export const LOSS_WORDS = /\b(?:loss|lost|los(?:e|es|ing)|drop(?:s|ped|ping)?|unanswered|unreachable|fail(?:s|ed|ing)?|broke(?:n)?|cut off|time[sd]? out|timeouts?|refused|blackhole[sd]?|dies|died)\b/i;

/**
 * L45 (error, W5 r1 major): a NodeGraph packet (`mark` with props.packet) is a 22 px dot that lives ~0.4 s per hop and
 * leaves no trace, so it never shows in a still and barely reads on a phone (vswitch b06 "wrk>sw>db", b19 "wrk>db").
 * Until the renderer holds the route, the storyboard must: at the end of the beat every edge on the route is lit
 * (edgeStates active | broken), and when the narration says the traffic is lost / dropped, the route shows where it
 * died (a broken edge, or a danger / degraded node on it).
 */
export function packetTraceIssues(sb: Pick<Storyboard, "world" | "beats">, tl: Timeline): { beatId: string; instId: string; packet: string; unlit: string[]; loss: boolean; frame: number }[] {
  const out: { beatId: string; instId: string; packet: string; unlit: string[]; loss: boolean; frame: number }[] = [];
  const phrase = new Map(sb.beats.map((b) => [b.id, b.phrase]));
  for (const e of tl.events) {
    if (e.kind !== "action" || e.do !== "mark" || typeof e.props?.packet !== "string") continue;
    const inst = sb.world.find((w) => w.id === e.target);
    const beat = tl.beats.find((b) => b.id === e.beatId);
    if (!inst || inst.component !== "NodeGraph" || !beat) continue;
    const f = Math.max(e.frame, Math.min(tl.durationF - 1, beat.endF - 1));
    const pr = parseInstanceProps("NodeGraph", rawPropsAt(tl, inst, f));
    if (!pr?.ok) continue;
    const g = pr.value as NodeGraphPropsT;
    const route = packetRouteEdges(e.props.packet);
    const unlit = route.filter(([a, b]) => edgeStateOf(g, a, b) === "idle" || !g.edges.some((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a))).map(([a, b]) => `${a}>${b}`);
    const says = LOSS_WORDS.test(phrase.get(beat.id) ?? "");
    const nodeState = (id: string) => String(g.nodeStates?.[id] ?? g.nodes.find((n) => n.id === id)?.state ?? "ok");
    const died = route.some(([a, b]) => edgeStateOf(g, a, b) === "broken") || e.props.packet.split(">").some((id) => ["danger", "degraded"].includes(nodeState(id)));
    if (unlit.length || (says && !died)) out.push({ beatId: beat.id, instId: inst.id, packet: e.props.packet, unlit, loss: says && !died, frame: f });
  }
  return out;
}

/** Tones a legend can name on screen: pills / stacks / callouts / cards / pills groups in that tone, or a box whose
 *  own full / killed state prints its danger label. */
function legendTones(items: readonly OnScreen[]): Set<string> {
  const t = new Set<string>();
  for (const o of items) {
    const tone = String(o.state ?? o.props.tone ?? "");
    if (["SourceTag", "Callout", "StatusCard", "VersionPills", "HeroStat", "Timeline"].includes(o.inst.component)) t.add(tone);
    if (o.inst.component === "ContainerBox" && (o.state === "full" || o.state === "killed")) t.add("danger");
  }
  return t;
}

export function lintStoryboard(input: unknown, words?: WordsFileT | null, opts: LintOptions = {}): LintReport {
  // L1 (+ L2/L13/L14/L15 tagged schema issues)
  const parsed = parseStoryboard(input);
  if (!parsed.ok || !parsed.value) {
    const out: LintResult[] = [];
    for (const i of parsed.issues) out.push({ id: i.lint, severity: i.lint === "L1" || i.lint === "L15" || i.lint === "L5b" ? "block" : "error", message: i.message, path: i.path });
    // An L2-only failure still blocks the save (the schema rejected it), so make sure something blocks.
    if (!out.some((r) => r.severity === "block")) out.push({ id: "L1", severity: "block", message: "storyboard failed schema validation" });
    const counts = { block: 0, error: 0, warn: 0 } as Record<Severity, number>;
    for (const r of out) counts[r.severity]++;
    return { ok: counts.block === 0 && counts.error === 0, blocked: counts.block > 0, counts, results: out, storyboard: undefined, timeline: undefined, stats: undefined };
  }
  return lintParsedStoryboard(parsed.value, words, opts);
}

/**
 * The v2 battery on an ALREADY PARSED board (no schema pass; W4 carry-over from W3b): v3 runs it on the lowered v2.1
 * board, whose v3 component ids / zoom > 2.2 / pauseAfterMs the v2 schema would refuse. Same checks, same order as
 * lintStoryboard after its parse (which now calls this).
 */
export function lintParsedStoryboard(own: Storyboard, words?: WordsFileT | null, opts: LintOptions = {}): LintReport {
  const out: LintResult[] = [];
  const add = (id: string, severity: Severity, message: string, extra: Partial<LintResult> = {}) => out.push({ id, severity, message, ...extra });
  const fitMoved = new Set<string>();
  const finish = (sb?: Storyboard, tl?: Timeline, stats?: LintReport["stats"]): LintReport => {
    const counts = { block: 0, error: 0, warn: 0 } as Record<Severity, number>;
    for (const r of out) {
      counts[r.severity]++;
      if (r.fix && fitMoved.has(r.fix.path.replace(/^world\./, ""))) delete r.fix;
    }
    return { ok: counts.block === 0 && counts.error === 0, blocked: counts.block > 0, counts, results: out, storyboard: sb, timeline: tl, stats };
  };

  const lib = opts.lib ?? LIBRARY_LOOKUP;
  // W5.1: lint what RENDERS — the library's stage-fill pass (fitStoryboard, the same call the Explainer's buildScene
  // makes) may enlarge / re-centre the focal subject and set NodeGraph props.layout; camera keys are pinned so the
  // path is the director's. The report keeps the director's own storyboard (signatures, fixes, stills renders).
  const fitted = opts.fit === false ? null : fitStoryboard(own, words, lib);
  const sb = fitted?.sb ?? own;
  // a world fix computed on a fitted (moved / zoomed) instance is in drawn coordinates, not the director's: drop it
  for (const f of fitted?.fits ?? []) for (const id of [...f.members, ...f.centred]) fitMoved.add(id);
  const tl = resolveTimeline(sb, words, lib);
  const beatById = new Map(sb.beats.map((b) => [b.id, b]));
  const instById = new Map(sb.world.map((i) => [i.id, i]));

  // L15 library version / hash
  if (sb.libraryVersion !== LIBRARY_VERSION) add("L15", "block", `libraryVersion ${sb.libraryVersion} ≠ ${LIBRARY_VERSION}`);
  if (opts.pinnedLibraryHash !== undefined && opts.pinnedLibraryHash !== LIBRARY_HASH) add("L15", "block", `LIBRARY_HASH ${LIBRARY_HASH} ≠ pinned site ${opts.pinnedLibraryHash}`);

  // L5 phrase tokens = TTS tokens; keyword exactly once
  for (const i of tl.issues) {
    if (i.code === "words-count" || i.code === "words-text" || i.code === "words-order") add("L5", "block", i.message, { beatId: i.beatId });
    else if (i.code === "keyword-missing" || i.code === "keyword-repeated") add("L5", "block", i.message, { beatId: i.beatId });
    else if (i.code === "display-mismatch") add("L5b", "block", i.message, { beatId: i.beatId });
    else if (i.code === "words-missing") add("L5", words ? "block" : "warn", i.message, { beatId: i.beatId });
    else if (i.code === "anchor-range" || i.code === "target-missing") add("L1", "block", i.message, { beatId: i.beatId });
  }
  if (!words) add("L5", "warn", `no words.json: all timings estimated at ${ESTIMATE_WPS} w/s in-beat (pre-TTS checkpoint)`);

  // L5b display phrases: ≤5 words, single line, keyword placement
  for (const d of tl.displayPhrases) {
    // D1 #8 (binding): ≤5 display words. No minimum: amendments allow 1–5 (one word as a punch), superseding ADR's 3–6.
    if (d.wordCount > MAX_DISPLAY_WORDS) add("L5b", "block", `${d.id} "${d.text}": ${d.wordCount} words (max ${MAX_DISPLAY_WORDS}, D1 #8)`, { beatId: d.beatId });
    if (d.widthPx > DISPLAY_MAX_PX) add("L5b", "block", `${d.id} "${d.text}": ≈${d.widthPx} px wide, wraps to 2 lines (max ${DISPLAY_MAX_PX})`, { beatId: d.beatId });
  }
  for (const b of tl.beats) {
    const kwLast = b.keywordWord + b.words.filter((w) => w.isKeyword).length - 1;
    const kwPhrase = tl.displayPhrases.find((d) => d.beatId === b.id && d.keywordWord !== null);
    if (b.keywordCount === 1 && (!kwPhrase || kwLast > kwPhrase.lastWord)) add("L5b", "block", `${b.id}: keyword "${sb.beats[b.index].keyword}" is split across display phrases`, { beatId: b.id });
    if (sb.captions.style === "keyword" && b.displayPhraseIds.length > 1) add("L5b", "error", `${b.id}: captions.style "keyword" needs one display phrase per beat (each phrase exactly one keyword); got ${b.displayPhraseIds.length}`, { beatId: b.id });
  }
  // L5b negator drop (W5 r1): a display phrase that read alone says the opposite of its sentence ("saved was lost.")
  for (const d of negatorDrops(tl))
    add("L5b", "block", `${d.id} "${d.text}": read alone, this caption drops the negation of "${d.sentence}" and says the opposite — keep the negator and its verb in one display phrase: set the beat's display split (e.g. subject + negator first, the verb phrase after) so no phrase reads as a clause without its "not / nothing / n't"`, { beatId: d.beatId });

  // L6 every beat has an action or camera key landing on its keyword
  const tol = /whisper/.test(tl.timingSource) ? KEYWORD_TOL_WHISPER_F : KEYWORD_TOL_F;
  for (const b of tl.beats) {
    const frames = tl.events.filter((e) => (e.kind === "action" || e.kind === "camera") && e.beatId === b.id).map((e) => e.frame);
    const best = frames.reduce((m, f) => Math.min(m, Math.abs(f - b.keywordF)), Infinity);
    if (best > tol) add("L6", "error", `${b.id}: no action/camera key within ±${tol} f of the keyword (frame ${b.keywordF}; nearest ${best === Infinity ? "none" : `${best} f off`})`, { beatId: b.id, frame: b.keywordF });
  }

  // L7 something changes in every beat (schema: ≥1 action); a beat of only `focus` actions on nothing new is weak
  for (const b of sb.beats) if (b.actions.every((a) => a.do === "focus") && !b.camera.length) add("L7", "warn", `${b.id}: only focus actions and no camera move — does anything change?`, { beatId: b.id });

  // L8 hard cuts: count + placement (in a TTS pause, or ±4 f of a display-phrase onset)
  const maxCuts = opts.allowGapCuts ? 6 : MAX_HARD_CUTS;
  if (tl.hardCuts.length > maxCuts) add("L8", "error", `${tl.hardCuts.length} hard cuts (max ${maxCuts})`);
  for (const f of tl.hardCuts) {
    const inPause = tl.beats.some((b, i) => i + 1 < tl.beats.length && f >= b.lastWordEndF && f <= tl.beats[i + 1].firstWordF);
    const nearOnset = tl.displayPhrases.some((d) => Math.abs(d.startF - f) <= CUT_ONSET_TOL_F);
    if (!inPause && !nearOnset) add("L8", "error", `hard cut at frame ${f} is neither in a pause nor within ±${CUT_ONSET_TOL_F} f of a phrase onset`, { frame: f });
  }

  // L9 camera moves
  let prevEnd = -1;
  for (const s of tl.cameraSegments) {
    const where = { beatId: s.beatId, frame: s.startF };
    if (s.startF < prevEnd) add("L9", "error", `${s.beatId}: camera move at ${s.startF} overlaps the previous move (ends ${prevEnd})`, where);
    prevEnd = Math.max(prevEnd, s.endF);
    if (s.transition === "hardCut") continue;
    if (s.ease === "bible" && (s.durF < 12 || s.durF > 20)) add("L9", "error", `${s.beatId}: bible-ease move of ${s.durF} f (12–20)`, where);
    if (s.panPx > LONG_PAN_PX && (s.ease !== "longPan" || s.durF < 22)) add("L9", "error", `${s.beatId}: ${Math.round(s.panPx)} px pan needs ease longPan ≥22 f (got ${s.ease} ${s.durF} f)`, where);
    if (s.ease === "longPan" && s.durF < 22) add("L9", "error", `${s.beatId}: longPan of ${s.durF} f (≥22)`, where);
    if (s.peakPxPerF > MAX_PEAK_PX_PER_F) add("L9", "error", `${s.beatId}: peak screen speed ${Math.round(s.peakPxPerF)} px/f (max ${MAX_PEAK_PX_PER_F})`, where);
    if (s.endF > tl.durationF) add("L9", "error", `${s.beatId}: camera move runs past the end of the reel`, where);
  }

  // L10 glitch / shake budget (optional, 0–3). A camera shake that lands with a Stamp entrance (±3 f) is part of the
  // Stamp slam (bible §6.11: scale 1.4 → 1 + 3 f shake) and does not count; a free-standing shake still does.
  const stampEnters = tl.events.filter((e) => e.kind === "action" && e.do === "enter" && instById.get(e.target)?.component === "Stamp").map((e) => e.frame);
  const freeShakes = tl.events.filter((e) => e.kind === "camera" && e.shake && !stampEnters.some((f) => Math.abs(f - e.frame) <= STAMP_SHAKE_PAIR_F)).length;
  const glitches = sb.beats.reduce((n, b) => n + b.actions.filter((a) => a.do === "glitch").length, 0) + freeShakes;
  if (glitches > MAX_GLITCH) add("L10", "error", `${glitches} glitch/shake moments (max ${MAX_GLITCH}; Stamp shakes excluded)`);

  // L11 duration + pace
  const durationSec = tl.durationMs / 1000;
  if (durationSec < DURATION_SEC.min || durationSec > DURATION_SEC.max) add("L11", "block", `duration ${r1(durationSec)} s (must be ${DURATION_SEC.min}–${DURATION_SEC.max} s)`);
  if (tl.durationF > MAX_DURATION_F) add("L11", "block", `durationF ${tl.durationF} > ${MAX_DURATION_F}`);
  // W3.3: PACE_METRIC (rubric.ts) — spoken words ("1.0.2" = 5) over the narration duration (last beat audio end +
  // tail = tl.durationMs). It used to be TTS tokens over first-word-start → last-word-end, so lint said 2.57 w/s where
  // the rubric, card and script.md said 2.64 for the same W3.2 r3 evergreen-oom reel.
  const pace = lintPace(sb, tl);
  const nWords = pace.words;
  const wps = pace.wps;
  if (wps < WPS_BAND.min || wps > WPS_BAND.max) add("L11", "error", `pace ${wps.toFixed(2)} words/s (band ${WPS_BAND.min}–${WPS_BAND.max}; ${PACE_METRIC})`);

  // L12 part order, CTA, header mode
  const parts = sb.beats.map((b) => b.part);
  if (parts[0] !== "hook") add("L12", "error", `first beat must be the hook (got ${parts[0]})`, { beatId: sb.beats[0].id });
  const last = sb.beats[sb.beats.length - 1];
  if (last.part !== "cta") add("L12", "error", `last beat must be the CTA (got ${last.part})`, { beatId: last.id });
  const ctas = sb.beats.filter((b) => b.part === "cta");
  if (ctas.length > 1) add("L12", "error", `${ctas.length} CTA beats (exactly one, last)`);
  if (last.part === "cta") {
    const n = tokenize(last.phrase).length;
    if (n > CTA_MAX_WORDS) add("L12", "error", `CTA "${last.phrase}" has ${n} words (≤${CTA_MAX_WORDS})`, { beatId: last.id });
    if (!/\b(follow|subscribe)\b/i.test(last.phrase)) add("L12", "warn", `CTA has no follow/subscribe`, { beatId: last.id });
  }
  for (const b of sb.beats) if (b.part === "ask") add("L12", "error", `${b.id}: mid-roll follow ask is not allowed (D1 #12)`, { beatId: b.id });
  if (!parts.includes("mechanism")) add("L12", "error", `no mechanism beats`);
  let rank = 0;
  sb.beats.forEach((b, i) => {
    const r = partRank(b.part);
    if (i > 0 && b.part === "hook" && sb.beats[i - 1].part !== "hook") add("L12", "error", `${b.id}: hook after the opening`, { beatId: b.id });
    if (r === null) return;
    if (r < rank) add("L12", "error", `${b.id}: part "${b.part}" after a later part (order hook → stakes/reveal → mechanism → context/climax/closure → cta)`, { beatId: b.id });
    rank = Math.max(rank, r);
  });
  const headerLabels: { beat?: BeatT; label: string; frame: number }[] = [{ label: sb.headerRight, frame: 0 }];
  for (const e of tl.events) if (e.kind === "header" && e.right) headerLabels.push({ beat: beatById.get(e.beatId), label: e.right, frame: e.frame });
  // W7 (W6 bug list): an EVENT label without a year BLOCKS — an undated event header reads as today's news
  for (const h of headerLabels)
    if (!HEADER_RE[sb.headerMode].test(h.label)) {
      const noYear = sb.headerMode === "EVENT" && !/\b(?:19|20)\d{2}\b/.test(h.label);
      add("L12", noYear ? "block" : "error", `header "${h.label}" does not match ${sb.headerMode} mode (${HEADER_FORMAT[sb.headerMode]})${noYear ? " — an EVENT label carries the event's year" : ""}`, { beatId: h.beat?.id });
    }

  // L3 "keep text ≤ 960": one result per instance (W3.3: W3.2 r3 event-recent printed the same graph 13 times, which
  // buried the one real L24 warning) — collected over the beats, emitted after the loop.
  const textReach = reachCollector();
  // L13 Figures visible per review frame (node cap is schema-level)
  // L3 / L4 safe zone + focal budget at every beat's settled review frame
  const vis = visibility(sb, tl);
  const meta = (inst: InstanceT) => lib[inst.component];
  for (const b of tl.beats) {
    const f = settledFrame(tl, b);
    const cam = cameraAt(tl, f);
    const shown = sb.world
      .filter((inst) => {
        const v = vis.get(inst.id)!;
        return f >= v.from && f < v.to;
      })
      .map((inst) => {
        // W3.3: a NodeGraph is checked by what it DRAWS (node squares / dots + label text, after layout), not by its
        // canvas — W3.2 r3 event-recent: 13 "graph reaches x 992–999" warnings while "Domain" ended near x 860.
        const g = inst.component === "NodeGraph" ? graphDrawn(inst, lib, propsAt(tl, inst, f), cam) : null;
        const wb = instanceBox(inst, lib);
        return { inst, sb: g ? g.box : wb ? projectBox(wb, cam) : null, graph: g, focal: inst.focal ?? meta(inst)?.focal ?? true };
      })
      .filter((x) => (x.sb ? intersectsViewport(x.sb) : true));
    const where = { beatId: b.id, frame: f };
    for (const x of shown) {
      if (!x.sb) continue;
      const s = x.sb;
      if (s.x < SAFE.left - 0.5 || s.x + s.w > SAFE.right + 0.5 || s.y < SAFE.top - 0.5 || s.y + s.h > SAFE.bottom + 0.5)
        add("L3", "error", `${b.id} @${f}: "${x.inst.id}" at screen [${Math.round(s.x)},${Math.round(s.y)} ${Math.round(s.w)}×${Math.round(s.h)}] leaves the safe zone x ${SAFE.left}–${SAFE.right}, y ${SAFE.top}–${SAFE.bottom}`, where);
      else if (x.graph) {
        // node label text past x 960 = the text is cut / crowds the edge → error; only a square / dot past 960 → warn
        const over = x.graph.labels.filter((l) => l.right > SAFE.textRight + 0.5);
        if (over.length) textReach.note(x.inst.id, "label", "error", b.id, f, Math.max(...over.map((l) => l.right)), over.map((l) => l.label));
        else if (s.x + s.w > SAFE.textRight + 0.5) textReach.note(x.inst.id, "node", "warn", b.id, f, s.x + s.w);
      } else if (s.x + s.w > SAFE.textRight + 0.5) textReach.note(x.inst.id, "box", "warn", b.id, f, s.x + s.w);
      if (x.focal && (s.y + s.h > SUBTITLE_TOP + 0.5 || s.y < HEADER_BAND_BOTTOM - 0.5)) add("L3", "error", `${b.id} @${f}: focal "${x.inst.id}" (y ${Math.round(s.y)}–${Math.round(s.y + s.h)}) overlaps the ${s.y < HEADER_BAND_BOTTOM ? "header band" : "subtitle card"}`, where);
    }
    const focal = shown.filter((x) => x.focal);
    if (focal.length > MAX_FOCAL) add("L4", "error", `${b.id} @${f}: ${focal.length} focal elements on screen (max ${MAX_FOCAL}): ${focal.map((x) => x.inst.id).join(", ")}`, where);
    for (let i = 0; i < shown.length; i++)
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i];
        const c = shown[j];
        if (!a.sb || !c.sb) continue;
        const o = iou(a.sb, c.sb);
        if (o > 0.05) add("L4", a.focal && c.focal ? "error" : "warn", `${b.id} @${f}: "${a.inst.id}" and "${c.inst.id}" overlap (IoU ${o.toFixed(2)})`, where);
      }
    const figs = shown.filter((x) => x.inst.component === "Figure").length;
    if (figs > MAX_FIGURES_VISIBLE) add("L13", "error", `${b.id} @${f}: ${figs} Figures visible (max ${MAX_FIGURES_VISIBLE})`, where);
    const unknown = shown.filter((x) => !x.sb).map((x) => x.inst.id);
    if (unknown.length) add("L3", "warn", `${b.id}: no footprint for ${unknown.join(", ")} — safe zone unchecked`, { beatId: b.id });
  }
  for (const r of textReach.results()) add("L3", r.severity, r.message, { beatId: r.beatId, frame: r.frame });
  for (const inst of sb.world) {
    const st = sb.stations.find((s) => s.id === inst.station)!;
    const wb = instanceBox(inst, lib);
    if (wb && (wb.x < st.x || wb.y < st.y || wb.x + wb.w > st.x + st.w || wb.y + wb.h > st.y + st.h)) add("L3", "warn", `"${inst.id}" sticks out of its station "${st.id}"`);
    if (inst.component === "Figure" && countFigNodes(inst.figure) > 80) add("L13", "error", `"${inst.id}" has more than 80 nodes`);
  }

  // L16 numbers spoken or shown are sourced
  for (const b of sb.beats) if (hasNumber(b.phrase) && !b.sourceIds.length && !b.illustrative) add("L16", "block", `${b.id}: "${b.phrase}" states a number without sourceIds (or mark it illustrative)`, { beatId: b.id });
  const actedSources = new Map<string, Set<string>>();
  for (const b of sb.beats) for (const a of b.actions) for (const s of b.sourceIds) (actedSources.get(a.target) ?? actedSources.set(a.target, new Set()).get(a.target)!).add(s);
  for (const inst of sb.world) {
    const texts = [...stringsIn(inst.props), ...stringsIn(inst.figure?.map((n) => n.geom.text ?? ""))];
    const numeric = texts.filter(hasNumber);
    if (numeric.length && !inst.illustrative && !inst.sourceIds.length && !actedSources.get(inst.id)?.size) add("L16", "block", `"${inst.id}" shows numbers (${numeric.slice(0, 3).map((t) => JSON.stringify(t)).join(", ")}) without sourceIds`);
  }
  // The opening label (frame 0, no beat) is sourced by storyboard.headerSourceIds; later labels by their beat.
  // A SPEC "STEP n/m" counter is the reel's own structure, not a claim, so it alone needs no source.
  for (const h of headerLabels) {
    const claim = h.label.replace(/· STEP \d+\/\d+$/, "").replace(/^STEP \d+\/\d+ · /, "");
    const sourced = h.beat ? h.beat.sourceIds.length > 0 || h.beat.illustrative : sb.headerSourceIds.length > 0;
    if (hasNumber(claim) && !sourced) add("L16", "block", `header "${h.label}" shows a number or date without a source${h.beat ? "" : " (set headerSourceIds)"}`, { beatId: h.beat?.id });
  }

  // L17 header widths + EVENT dates parse and are monotonic
  const series = sb.series ?? SERIES;
  const leftLen = series.length + 3 + sb.codename.length;
  if (leftLen > 30) add("L17", "error", `header left "${series} · ${sb.codename}" is ${leftLen} chars (≤30)`);
  if (sb.headerMode === "EVENT") {
    let prev = -Infinity;
    for (const h of headerLabels) {
      const m = HEADER_RE.EVENT.exec(h.label);
      if (!m) continue;
      const mo = MONTHS.indexOf(m[1]);
      const day = Number(m[2]);
      const t = Date.UTC(Number(m[3]), mo, day);
      if (new Date(t).getUTCDate() !== day) add("L17", "error", `header date "${h.label}" does not exist`, { beatId: h.beat?.id });
      if (t < prev) add("L17", "warn", `header date "${h.label}" goes back in time (flashbacks must be intended)`, { beatId: h.beat?.id });
      prev = Math.max(prev, t);
    }
  }

  // L18 render-time prediction
  const outFps = opts.outputFps ?? OUTPUT_FPS;
  const pr = predictRender(tl, opts.phi ?? 1, undefined, outFps);
  const l18 = l18Thresholds(outFps);
  if (pr.tMax > l18.warn) {
    const why = outFps === 30 ? l18Drivers(tl, pr, opts.phi ?? 1) : `chunk ${pr.chunks.indexOf(pr.tMax) + 1}/${pr.chunks.length} of ${pr.fpl} output frames at ${outFps} fps`;
    if (pr.tMax > l18.block) add("L18", "block", `predicted slowest chunk ${Math.round(pr.tMax)} s > ${l18.block} s (fewer/slower moves, lower maxSamples, or shorter) — ${why}`);
    else add("L18", "warn", `predicted slowest chunk ${Math.round(pr.tMax)} s > ${l18.warn} s — ${why}`);
  }

  // L19 glyph allow-list for everything that reaches the screen (the same list the render-side guard checks)
  const badByWhere = new Map<string, { beatId?: string; chars: Set<string> }>();
  for (const g of findBadGlyphs(onScreenStrings(sb))) {
    const e = badByWhere.get(g.where) ?? badByWhere.set(g.where, { beatId: g.beatId, chars: new Set() }).get(g.where)!;
    e.chars.add(g.char);
  }
  for (const [where, e] of badByWhere)
    add("L19", "block", `${where}: glyph(s) ${[...e.chars].map((c) => `"${c}" U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(", ")} not in the font allow-list`, { beatId: e.beatId });

  // L20 frame 0 and the cover are settled. A shipped component's action is unsettled for its verb's declared durF
  // (VerbSpec.durF: UnitGrid countUp 60 f, NodeGraph mark 56 f, state changes that scramble values, …); planned
  // components and the header/datafield fall back to SETTLE_F for the four classic animating verbs.
  const settleF = (e: Timeline["events"][number]): number => {
    if (e.kind !== "action") return 0;
    const inst = instById.get(e.target);
    const m = inst ? metaFor(inst.component) : undefined;
    if (m) return m.verbs[e.do as keyof typeof m.verbs]?.durF ?? SETTLE_F;
    return e.do === "countUp" || e.do === "scramble" || e.do === "enter" || e.do === "glitch" ? SETTLE_F : 0;
  };
  const unsettled = (f: number) => tl.events.filter((e) => e.kind === "action" && f >= e.frame && f < e.frame + settleF(e) && !(e.frame <= 0 && f === 0 && e.do === "enter"));
  const label = (e: Timeline["events"][number]) => (e.kind === "action" ? `${e.target} ${e.do} @${e.frame}+${settleF(e)}f` : "");
  const z = unsettled(0).filter((e) => e.kind === "action" && e.do !== "enter");
  if (z.length) add("L20", "error", `frame 0 is not settled (${z.map(label).join(", ")})`, { frame: 0 });
  const cv = unsettled(tl.coverF);
  const cm = cameraAt(tl, tl.coverF).moving;
  if (cv.length || cm) {
    // W3.2 FR1 (W3.2 r1 evergreen-tls: cover b19 keyword+24 landed inside a 26 f longPan that starts at phraseStart):
    // propose a settled frame of the cover beat (nothing unsettled, camera stopped, for ≥ STILL_OFFSET_F frames) as a
    // `cover` the director can paste (also in `fix`).
    const cb = tl.beats.find((b) => (sb.cover ? b.id === sb.cover.beat : tl.coverF >= b.startF && tl.coverF < b.endF)) ?? tl.beats[tl.beats.length - 1];
    const calm = (f: number) => unsettled(f).length === 0 && !cameraAt(tl, f).moving;
    const calmSpan = (a: number, b: number) => {
      for (let k = a; k <= b; k++) if (!calm(k)) return false;
      return true;
    };
    // forward inside the cover beat: first calm frame + 6 (calm all the way); else backward: the latest frame of the
    // beat that has been calm for the 6 f before it (W3.2 r1 evergreen-tls: keyword+24 = 1788 fell past b19's end
    // into b20's pan, so only the backward search finds b19's held shot)
    const lastF = Math.min(tl.durationF - 1, cb.endF - 1);
    let prop: number | null = null;
    for (let f = tl.coverF; f + STILL_OFFSET_F <= lastF && prop === null; f++) if (calm(f) && calmSpan(f, f + STILL_OFFSET_F)) prop = f + STILL_OFFSET_F;
    for (let f = Math.min(tl.coverF, lastF); f - STILL_OFFSET_F >= cb.startF && prop === null; f--) if (calm(f) && calmSpan(f - STILL_OFFSET_F, f)) prop = f;
    const what = [...cv.map(label), ...(cm ? ["camera moving"] : [])].join(", ");
    // `at` offsets are limited to −15…45 f (schema At): pick the first ref that reaches the proposed frame
    const refs = [["keyword", cb.keywordF], ["phraseEnd", cb.lastWordEndF], ["phraseStart", cb.firstWordF]] as const;
    const ref = prop === null ? undefined : refs.find(([, rf]) => prop! - rf >= -15 && prop! - rf <= 45);
    if (prop !== null && ref) {
      const value = { beat: cb.id, at: { ref: ref[0], offsetF: prop - ref[1] } };
      add("L20", "error", `cover frame ${tl.coverF} is not settled (${what}) — use cover ${JSON.stringify(value)} (frame ${prop}: everything settled and the camera still for ≥ ${STILL_OFFSET_F} f)`, { frame: tl.coverF, beatId: cb.id, fix: { path: "cover", value } });
    } else add("L20", "error", `cover frame ${tl.coverF} is not settled (${what}) — ${prop === null ? `${cb.id} never settles after it` : `the first settled frame ${prop} is out of reach of a cover anchor`}; put the cover on a beat whose camera holds`, { frame: tl.coverF, beatId: cb.id });
  }

  // L21 flights: a component that flies through the world (meta.flight) must be on screen for ≥ 8 f of the flight
  // window (motion.flightMinOnscreenF), measured with the instance box under the camera at each frame. The window is
  // the action's REAL flight (timeline actionFlight: props-aware meta.flightFor, e.g. a NodeGraph packet route; a mark
  // with no packet in force does not fly) — the same profile the blur windows use.
  const actsByInst = actionsByInstance(tl.events);
  for (const e of tl.events) {
    if (e.kind !== "action") continue;
    const inst = instById.get(e.target);
    const m = inst ? metaFor(inst.component) : undefined;
    if (!inst || !m?.flight || !m.flight.verbs.includes(e.do as never)) continue;
    const wb = instanceBox(inst, lib);
    if (!wb) continue;
    const durF = actionFlight(inst, lib, actsByInst.get(inst.id) ?? [], { f: e.frame, do: e.do, state: e.state, props: e.props }).length;
    if (!durF) continue;
    const need = Math.min(FLIGHT_MIN_ONSCREEN_F, durF);
    let on = 0;
    for (let f = Math.max(0, e.frame); f < Math.min(tl.durationF, e.frame + durF); f++) if (intersectsStage(projectBox(wb, cameraAt(tl, f)))) on++;
    if (on < need) add("L21", "error", `${e.beatId}: ${inst.component} "${inst.id}" ${e.do} flight is on screen ${on} f of ${durF} (needs ≥ ${need} f)`, { beatId: e.beatId, frame: e.frame });
  }

  // L22 (W2.1, warn) a PointerArrow tip / Callout dot must point AT something: inside (±24 px) another instance's box
  // that is on screen when the pointer enters, or — when it points into the DataField — a `mark` action in the beat it
  // enters (a highlighted row/cell to land on). r3 gallery: arrowheads on arbitrary field glyphs read as noise.
  for (const inst of sb.world) {
    if (inst.component !== "PointerArrow" && inst.component !== "Callout") continue;
    const parsed = parseInstanceProps(inst.component, inst.props);
    const wb = instanceBox(inst, lib);
    if (!parsed?.ok || !wb) continue;
    const s = inst.scale ?? 1;
    const local = inst.component === "PointerArrow" ? pointerGeometry(parsed.value as PointerArrowPropsT, { w: wb.w / s, h: wb.h / s }).tip : calloutGeometry(parsed.value as CalloutPropsT).dot;
    const pt = { x: wb.x + local.x * s, y: wb.y + local.y * s };
    const v = vis.get(inst.id)!;
    const enterF = v.from;
    const PAD = 24;
    const onTarget = sb.world.some((o) => {
      if (o.id === inst.id || o.component === "PointerArrow" || o.component === "Callout") return false;
      const ov = vis.get(o.id)!;
      if (!(enterF >= ov.from && enterF < ov.to)) return false;
      const ob = instanceBox(o, lib);
      return !!ob && pt.x >= ob.x - PAD && pt.x <= ob.x + ob.w + PAD && pt.y >= ob.y - PAD && pt.y <= ob.y + ob.h + PAD;
    });
    const enterEv = tl.events.find((e) => e.kind === "action" && e.target === inst.id && e.do === "enter");
    const beatId = enterEv?.beatId;
    const marked = beatId !== undefined && tl.events.some((e) => e.kind === "action" && e.beatId === beatId && e.do === "mark" && e.target !== inst.id);
    if (!onTarget && !marked)
      add("L22", "warn", `${inst.component} "${inst.id}" points at nothing: its ${inst.component === "PointerArrow" ? "tip" : "dot"} (${Math.round(pt.x)},${Math.round(pt.y)}) is on no visible instance and no \`mark\` highlights a target in ${beatId ?? "its beat"}`, { beatId });
  }

  // L23 (W3.1) caption / hairline clearance and frame clipping, per content part (NodeGraph nodes, Figure nodes, other
  // footprints) projected through the camera at the keyword frame, the stills frame and the settled frame. W3 r3
  // evergreen-tls b06: the NodeGraph's X3 node sat under the caption pill at the keyword (camera still panning) and
  // nothing fired, because L3 only looked at the settled frame and at the whole graph canvas.
  //  - focal content over the caption card, or below the caption-safe line (layout.focal.bottom 1400) → block
  //  - non-focal content under the caption card → warn
  //  - content cut by the frame edge, the header band (y < 218) or the footer hairline (1560) → error (warn while the
  //    camera is moving: transit through the edge during a pan is expected; the settled frames must be clean)
  const exitAt = new Map<string, number>();
  for (const e of tl.events) if (e.kind === "action" && e.do === "exit" && !exitAt.has(e.target)) exitAt.set(e.target, e.frame);
  const partsOf = new Map(sb.world.map((inst) => [inst.id, contentParts(inst, lib)]));
  const actedBy = (beatId: string, target: string, f: number) => tl.events.some((e) => e.kind === "action" && e.beatId === beatId && e.target === target && e.frame <= f);
  for (const b of tl.beats) {
    const seen = new Map<string, LintResult>();
    const put = (key: string, r: LintResult) => {
      const prev = seen.get(key);
      const rank = { block: 3, error: 2, warn: 1 } as const;
      if (!prev || rank[r.severity] > rank[prev.severity]) seen.set(key, r);
    };
    for (const { f, kind } of reviewFrames(tl, b)) {
      const cam = cameraAt(tl, f);
      const cap = captionBoxAt(tl, f);
      for (const inst of sb.world) {
        const v = vis.get(inst.id)!;
        if (f < v.from + (v.from > 0 ? ENTER_GRACE_F : 0) || f >= v.to) continue; // not in yet / still near-transparent
        const ex = exitAt.get(inst.id);
        if (ex !== undefined && f >= ex) continue; // fading out
        const focal = inst.focal ?? meta(inst)?.focal ?? true;
        for (const cp of partsOf.get(inst.id) ?? []) {
          const sc = projectBox(cp.box, cam);
          if (!touches(sc, { x0: 0, x1: WIDTH, y0: 0, y1: HEIGHT })) continue;
          const what = `${inst.component} "${inst.id}"${cp.part ? ` ${cp.part}` : ""}`;
          const at = `${b.id} @${f} (${kind}${cam.moving ? ", camera moving" : ""})`;
          const where = { beatId: b.id, frame: f };
          const underCap = cap !== null && overlaps(sc, cap);
          // W3.2 (W3.1 minor): a part that sits ENTIRELY under the footer (screen y ≥ 1560, still inside the frame) used
          // to be skipped by the `sc.y < HAIRLINE_Y` guard. The guard stays for parts of a neighbouring station that
          // merely peek in below the hairline; a part the beat ACTS on (any action of this instance in this beat, by
          // this frame) is what the beat shows, so hiding it under the footer / header is reported.
          const actedNow = actedBy(b.id, inst.id, f);
          const hidden = !touches(sc, CLIP_REGION);
          if (focal && (underCap || sc.y + sc.h > FOCAL_BOTTOM + 0.5) && (sc.y < HAIRLINE_Y || actedNow))
            put(`${!underCap && hidden ? "hid" : "cap"}:${inst.id}:${cp.part}`, { id: "L23", severity: "block", message: `${at}: focal ${what} at screen ${fmtBox(sc)} ${underCap ? "is under the caption card" : hidden && sc.y >= HAIRLINE_Y ? `is hidden below the footer hairline y ${HAIRLINE_Y}` : `runs below the caption-safe line y ${FOCAL_BOTTOM}`} — frame it inside y ${HEADER_BAND_BOTTOM}–${FOCAL_BOTTOM} (camera target at its centre / lower zoom / move it up)`, ...where });
          else if (!focal && underCap) put(`cap:${inst.id}:${cp.part}`, { id: "L23", severity: "warn", message: `${at}: ${what} at screen ${fmtBox(sc)} is under the caption card`, ...where });
          if (touches(sc, CLIP_REGION) && !inside(sc, CLIP_REGION)) {
            const edge = sc.y < CLIP_REGION.y0 ? "the header band" : sc.y + sc.h > CLIP_REGION.y1 ? "the footer hairline" : "the frame edge";
            put(`clip:${inst.id}:${cp.part}`, { id: "L23", severity: cam.moving ? "warn" : "error", message: `${at}: ${what} at screen ${fmtBox(sc)} is cut by ${edge}`, ...where });
          } else if (hidden && actedNow && !(focal && sc.y + sc.h > FOCAL_BOTTOM)) {
            // (a focal part hidden below the footer already blocks above, as "hidden below the footer hairline")
            const edge = sc.y >= CLIP_REGION.y1 ? "below the footer hairline" : sc.y + sc.h <= CLIP_REGION.y0 ? "behind the header band" : "outside the frame";
            put(`hid:${inst.id}:${cp.part}`, { id: "L23", severity: cam.moving ? "warn" : "error", message: `${at}: ${what} at screen ${fmtBox(sc)} is hidden ${edge} while the beat acts on it`, ...where });
          }
        }
      }
    }
    out.push(...seen.values());
  }

  // L24 (W3.1, warn) component monoculture: one component > 40 % of the world reads as a slideshow of cards and hides
  // the mechanism (W3 r3 evergreen-tls: 11/20 StatusCards; the two-path branch was never drawn).
  if (sb.world.length >= MONOCULTURE_MIN_INSTANCES) {
    const byComp = new Map<string, number>();
    for (const inst of sb.world) byComp.set(inst.component, (byComp.get(inst.component) ?? 0) + 1);
    for (const [c, n] of byComp)
      if (n / sb.world.length > MONOCULTURE_SHARE)
        add("L24", "warn", `${c} is ${n} of ${sb.world.length} instances (${Math.round((100 * n) / sb.world.length)} % > ${Math.round(MONOCULTURE_SHARE * 100)} %): draw the mechanism (NodeGraph nodeStates/edgeStates, Timeline, VersionPills, Terminal…) instead of stacking ${c}s`);
  }

  // L25 (W3.1, warn) the data field matches the topic: family default, or a topic rule (TLS / PKI → certs).
  {
    const topicText = [sb.codename, sb.headerRight, ...headerLabels.map((h) => h.label), ...sb.beats.map((b) => b.phrase)].join(" \n ");
    const want = presetForTopic(sb.family, topicText);
    if (want.rule && sb.datafield.preset !== want.preset)
      add("L25", "warn", `datafield preset "${sb.datafield.preset}" on a ${want.rule.id.toUpperCase()} topic (${want.hits.slice(0, 4).join(", ")}): use "${want.preset}" — ${want.rule.why}`);
  }

  // L26 (W3.1, warn) countUp on a year: a 0 → 2021 counter reads as a quantity, not a date (W3 r3 evergreen-tls b03).
  for (const inst of sb.world) {
    if (inst.component !== "HeroStat") continue;
    const v = (inst.props as { value?: unknown } | undefined)?.value;
    const isYear = (typeof v === "number" && Number.isInteger(v) && v >= 1900 && v <= 2100) || (typeof v === "string" && /^(19|20)\d{2}$/.test(v.trim()));
    if (!isYear) continue;
    const cu = tl.events.find((e) => e.kind === "action" && e.target === inst.id && e.do === "countUp");
    if (cu) add("L26", "warn", `${cu.beatId}: HeroStat "${inst.id}" counts up to the year ${String(v)} — enter it without countUp (the 8 f scramble), or show a date`, { beatId: cu.beatId, frame: cu.frame });
  }

  // L27 (W3.1, warn) a KineticWord whose accent word is the beat's keyword must use the keyword's colour (W3 r3 b19:
  // "path." lime in the card, red in the caption, same frame).
  for (const e of tl.events) {
    if (e.kind !== "action" || e.do !== "enter") continue;
    const inst = instById.get(e.target);
    if (!inst || inst.component !== "KineticWord") continue;
    const p = (inst.props ?? {}) as { text?: string; accentWord?: string; tone?: string };
    const beat = beatById.get(e.beatId);
    const tb = tl.beats.find((x) => x.id === e.beatId);
    if (!beat || !tb || typeof p.text !== "string") continue;
    const ws = p.text.trim().split(/\s+/);
    const accent = p.accentWord ?? ws[ws.length - 1];
    const tone = p.tone ?? "accent";
    const kwToks = tokenize(beat.keyword).map(normToken);
    if (kwToks.includes(normToken(accent)) && (tone === "accent" || tone === "danger") && tone !== tb.keywordColor)
      add("L27", "warn", `${beat.id}: KineticWord "${inst.id}" accent "${accent}" is ${tone} but the caption keyword "${beat.keyword}" is ${tb.keywordColor} — use tone "${tb.keywordColor}"`, { beatId: beat.id, frame: e.frame });
    else if (!kwToks.includes(normToken(accent)) && (tone === "accent" || tone === "danger")) {
      // W3.3 (W3.2 r3 evergreen-oom b16): the card accents "page." while the caption's keyword is "every" — two
      // different words lit in one frame. When the keyword is on the card, it is the word to accent.
      const kwWord = ws.find((w) => kwToks.includes(normToken(w)));
      if (kwWord)
        add("L27", "warn", `${beat.id}: KineticWord "${inst.id}" accents "${accent}" (${tone}) but the caption keyword is "${beat.keyword}" (${tb.keywordColor}), which is also on the card — set accentWord "${kwWord}" and tone "${tb.keywordColor}" so the same word lights up in both`, { beatId: beat.id, frame: e.frame });
    }
  }

  const snaps = beatSnapshots(sb, tl, lib);
  const snapById = new Map(snaps.map((x) => [x.beat.id, x]));

  // L28 (W3.2, warn) duplicate / near-identical review stills: a beat whose still (settled frame) shows the same picture
  // as one of the previous DUP_STILL_LOOKBACK beats — same camera, ≥ 95 % of the on-screen content area unchanged (same
  // instance, same box, same persistent state; pulse / focus / glitch are emphasis, not change). W3.1 event-recent: the
  // pulse-only beats b05 / b15 repeated the previous frame and b09 repeated b07's graph state; W3 r1 evergreen-tls b15
  // resolved to the very frame of b14. The CTA beat may hold the closing frame.
  {
    const looks = tl.beats.map((b) => {
      const f = settledFrame(tl, b);
      const cam = cameraAt(tl, f);
      const items = new Map<string, { box: Box; sig: string; area: number }>();
      for (const inst of sb.world) {
        const v = vis.get(inst.id)!;
        const ex = exitAt.get(inst.id);
        if (f < v.from || f >= v.to || (ex !== undefined && f >= ex)) continue;
        const box = boxUnion((partsOf.get(inst.id) ?? []).map((p) => p.box));
        if (!box) continue;
        const sc = projectBox(box, cam);
        if (!touches(sc, CLIP_REGION)) continue;
        items.set(inst.id, { box, sig: instanceLook(tl, inst.id, f, b.id), area: sc.w * sc.h });
      }
      return { b, f, cam, items };
    });
    looks.forEach((cur, i) => {
      if (cur.b.part === "cta") return;
      let best: { prev: (typeof looks)[number]; share: number; same: string[] } | null = null;
      for (let k = Math.max(0, i - DUP_STILL_LOOKBACK); k < i; k++) {
        const prev = looks[k];
        const zr = cur.cam.zoom / prev.cam.zoom;
        if (Math.abs(zr - 1) > DUP_CAM_ZOOM || Math.hypot(cur.cam.x - prev.cam.x, cur.cam.y - prev.cam.y) * cur.cam.zoom > DUP_CAM_PX || Math.abs(cur.cam.tiltX - prev.cam.tiltX) > 1) continue;
        let union = 0;
        let same = 0;
        const sameIds: string[] = [];
        for (const id of new Set([...cur.items.keys(), ...prev.items.keys()])) {
          const a = cur.items.get(id);
          const p = prev.items.get(id);
          union += Math.max(a?.area ?? 0, p?.area ?? 0);
          if (a && p && a.sig === p.sig) {
            same += a.area;
            sameIds.push(id);
          }
        }
        const share = union > 0 ? same / union : 1;
        if (share >= DUP_STILL_SHARE && (!best || share >= best.share)) best = { prev, share, same: sameIds };
      }
      if (best) {
        // W3.2 FR1: an exact repeat whose own beat does nothing but emphasis (pulse / focus / glitch, or no action at
        // all) and has no camera move is an ERROR at submit time, so the board is fixed before stills are spent on it
        // (W3.2 r1 evergreen-tls b13 = b12 + "graph pulse"). Other near-duplicates (a state that re-shows an earlier
        // look, a ≥ 95 % build-up) stay warnings.
        const acts = beatById.get(cur.b.id)?.actions ?? [];
        const emphasisOnly = acts.every((a) => EMPHASIS_VERBS.has(a.do) || a.target === "datafield");
        const camMove = tl.cameraSegments.some((sg) => sg.startF >= cur.b.startF && sg.startF < cur.b.endF);
        const hard = emphasisOnly && !camMove && best.share >= 0.999;
        const verbs = [...new Set(acts.map((a) => a.do))].join(" / ") || "no action";
        // W5.1 fr1: also an ERROR when the keyword NAMES a part of the still and that part gets no change — it is held
        // unchanged, or its only change is a non-focal side tag entering while every focal instance stays as it was
        // (W5.1 r1 evergreen-oom b14 "Dirty": a dim DIRTY PAGES pill entered, the box held b12's picture; warned, and
        // only the model critic caught it two rounds later).
        const unnamed = hard ? null : keywordPartUnchanged(snapById.get(cur.b.id), new Set(best.same), sb.beats[cur.b.index]?.keyword ?? "");
        add(
          "L28",
          hard || unnamed ? "error" : "warn",
          `${cur.b.id} still @${cur.f} looks like ${best.prev.b.id} @${best.prev.f}: same camera, ${Math.round(best.share * 100)} % of the on-screen content unchanged (${best.same.join(", ") || "nothing but the field"})${hard ? ` and the beat only does ${verbs} — that is not a change` : ""}${unnamed ? ` and the keyword "${sb.beats[cur.b.index]?.keyword}" names ${unnamed}` : ""} — give the keyword a visible change (a state / props change, a new instance, a camera move or a cut), or merge the beats`,
          { beatId: cur.b.id, frame: cur.f },
        );
      }
    });
  }

  // L29 (W3.2, warn) a NodeGraph is the mechanism's spine: at its best beat its drawn nodes (+ label plates) should span
  // ≥ 70 % of the 952 px content width, or of the focal height (y 218–1400) for a tall chain. W3.1 event-recent: the
  // graph spanned ≈ 577 px (61 %) for 16 beats while y 920–1400 stayed empty.
  for (const inst of sb.world) {
    if (inst.component !== "NodeGraph") continue;
    const content = boxUnion((partsOf.get(inst.id) ?? []).map((p) => p.box));
    if (!content) continue;
    let bestFill = -1;
    let bestAt: { beat: string; f: number; sc: Box } | null = null;
    const beats: string[] = [];
    for (const b of tl.beats) {
      const f = settledFrame(tl, b);
      const v = vis.get(inst.id)!;
      const ex = exitAt.get(inst.id);
      if (f < v.from || f >= v.to || (ex !== undefined && f >= ex)) continue;
      const sc = projectBox(content, cameraAt(tl, f));
      if (!touches(sc, CLIP_REGION)) continue;
      beats.push(b.id);
      const fill = Math.max(sc.w / CONTENT_W, sc.h / FOCAL_H);
      if (fill > bestFill) {
        bestFill = fill;
        bestAt = { beat: b.id, f, sc };
      }
    }
    if (bestAt && bestFill < GRAPH_MIN_FILL)
      add(
        "L29",
        "warn",
        `NodeGraph "${inst.id}" draws small: its nodes span at most ${Math.round(bestAt.sc.w)}×${Math.round(bestAt.sc.h)} px on screen (${Math.round((100 * bestAt.sc.w) / CONTENT_W)} % of the ${CONTENT_W} px content width, ${Math.round((100 * bestAt.sc.h) / FOCAL_H)} % of the ${FOCAL_H} px focal height; ${beats[0]}${beats.length > 1 ? `–${beats[beats.length - 1]}` : ""}) — spread node x towards 0…1, raise w (≤ ${NODE_GRAPH.maxW}) or the camera zoom so it fills ≥ ${Math.round(GRAPH_MIN_FILL * 100)} %`,
        { beatId: bestAt.beat, frame: bestAt.f },
      );
  }

  // L30 (W3.2, warn) NodeGraph edges hidden by label plates (component geometry, see nodeGraphEdgeIssues).
  for (const inst of sb.world) {
    if (inst.component !== "NodeGraph") continue;
    const pr = parseInstanceProps("NodeGraph", inst.props);
    const wb = instanceBox(inst, lib);
    if (!pr?.ok || !wb) continue;
    const s = inst.scale ?? 1;
    for (const iss of nodeGraphEdgeIssues(pr.value as NodeGraphPropsT, wb.w / s, wb.h / s)) add("L30", "warn", `NodeGraph "${inst.id}": ${iss.message}`);
  }

  // L31 (W3.2, warn) a clock Timeline's lit bar must span the duration its pill / bracket states. W3.1 event-recent b18:
  // the bar was lit 07:29→07:47 (18 min) under a "~5 MIN" pill, so the visual misstated the 07:35–07:40 outage. Checked
  // for the instance props and after every state action's props overrides (merged in order). Also: the clock unit drawn
  // after the last tick repeated in the label ("UTC · SEP 30 2026" + "07:47 UTC").
  for (const inst of sb.world) {
    if (inst.component !== "Timeline") continue;
    const pr = parseInstanceProps("Timeline", inst.props);
    if (!pr?.ok) continue;
    const base = pr.value as TimelinePropsT;
    const evs = tl.events.filter((e) => e.kind === "action" && e.target === inst.id);
    const firstBeat = evs[0]?.beatId;
    const states: { p: TimelinePropsT; beatId?: string; frame?: number }[] = [{ p: base, beatId: firstBeat, frame: evs[0]?.frame }];
    let cur: Record<string, unknown> = { ...(inst.props ?? {}) };
    for (const e of evs) {
      if (e.kind !== "action" || e.do !== "state" || !e.props) continue;
      cur = { ...cur, ...e.props };
      const r = parseInstanceProps("Timeline", cur);
      if (r?.ok) states.push({ p: r.value as TimelinePropsT, beatId: e.beatId, frame: e.frame });
    }
    const said = new Set<string>();
    for (const st of states)
      for (const iss of timelineSpanIssues(st.p)) {
        const n = st.p.ticks.length;
        const from = st.p.from;
        const to = st.p.to ?? n - 1;
        const at = (u: number) => (Number.isInteger(u) ? st.p.ticks[u] : `tick ${u}`);
        const msg = `Timeline "${inst.id}" bar is lit ${at(from)}→${at(to)} (${fmtMin(iss.spanMin)}) but its ${iss.field} says "${iss.text}" (${fmtMin(iss.saysMin)}) — ${iss.suggest ? `set from ${iss.suggest[0]} / to ${iss.suggest[1]} (${st.p.ticks[iss.suggest[0]]}→${st.p.ticks[iss.suggest[1]]}) and keep the other ticks as context` : "add ticks that bound that window and set from / to on them"}`;
        if (said.has(msg)) continue;
        said.add(msg);
        add("L31", "warn", msg, { beatId: st.beatId, frame: st.frame });
      }
    const unit = base.scale === "clock" ? base.unit : null;
    if (unit && base.label && tokenize(base.label).some((t) => normToken(t) === normToken(unit)))
      add("L31", "warn", `Timeline "${inst.id}" label "${base.label}" repeats the unit "${unit}" that the clock axis already prints after the last tick — drop it from the label`, { beatId: firstBeat });
  }

  // L32 (W3.2, warn) the logs field's clock matches the story's clock. Without a seed hint the logs preset prints
  // 06:23:xx rows; W3.1 event-recent (a 07:35 UTC incident, seed "rail404") showed 06:23 behind every beat. The time
  // the story names first (beat phrases, header labels, Timeline ticks) is the hint to use: seed "<slug>@HH:MM".
  if (sb.datafield.preset === "logs") {
    const CLOCK = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g;
    const times: { min: number; text: string }[] = [];
    const scan = (s: string) => {
      for (const m of s.matchAll(CLOCK)) times.push({ min: Number(m[1]) * 60 + Number(m[2]), text: `${m[1].padStart(2, "0")}:${m[2]}` });
    };
    sb.beats.forEach((b) => scan(b.phrase));
    headerLabels.forEach((h) => scan(h.label));
    for (const inst of sb.world) if (inst.component === "Timeline") ((inst.props as { ticks?: unknown } | undefined)?.ticks as unknown[] | undefined)?.forEach((t) => typeof t === "string" && scan(t));
    if (times.length) {
      const first = times[0];
      const hint = fieldClockMs(sb.datafield.seed);
      const slug = sb.datafield.seed.replace(/@.*$/, "").slice(0, 33);
      if (hint === null) add("L32", "warn", `datafield logs seed "${sb.datafield.seed}" has no clock hint, so the log rows read 06:23:xx while the story is at ${first.text} — use seed "${slug}@${first.text}"`);
      else {
        const d = Math.abs(hint / 60000 - first.min);
        if (Math.min(d, 1440 - d) > 180) add("L32", "warn", `datafield logs clock ${sb.datafield.seed.replace(/^.*@/, "")} is far from the story's ${first.text} — use seed "${slug}@${first.text}"`);
      }
    }
  }

  // L33 (W3.2 FR1, error) a Callout on a NodeGraph must not collide with it and must point at a node: its label plate
  // (+ 6 px) may not cover a node box, a label plate or an edge, its leader may not cross another node / label, and its
  // dot must be within 24 px of a node box. Checked while both are on screen (from the later entrance until the first
  // exit), at that start and at every props change of either. The message (and `fix`) carry the resolved placement on
  // the nearest node: the x / y that puts the dot on the node's side for `dir` with a clean plate.
  {
    const graphs = sb.world.filter((i) => i.component === "NodeGraph");
    const live = (id: string) => {
      const v = vis.get(id)!;
      const ex = exitAt.get(id);
      return { from: v.from, to: ex !== undefined ? Math.min(v.to, ex) : v.to };
    };
    for (const c of sb.world) {
      if (c.component !== "Callout" || !graphs.length) continue;
      const cl = live(c.id);
      let reported = false;
      for (const g of graphs) {
        if (reported) break;
        const gl = live(g.id);
        const from = Math.max(cl.from, gl.from);
        const to = Math.min(cl.to, gl.to);
        if (from >= to) continue;
        const frames = new Set([from]);
        for (const e of tl.events) if (e.kind === "action" && (e.target === c.id || e.target === g.id) && e.props && e.frame > from && e.frame < to) frames.add(e.frame);
        for (const f of [...frames].sort((a, b) => a - b)) {
          const cp = parseInstanceProps("Callout", propsAt(tl, c, f));
          const gp = parseInstanceProps("NodeGraph", propsAt(tl, g, f));
          if (!cp?.ok || !gp?.ok) break;
          const geo = graphGeometry(g, lib, gp.value as NodeGraphPropsT);
          if (!geo) break;
          const cpv = cp.value as CalloutPropsT;
          const cw = calloutWorld({ x: c.x, y: c.y, scale: c.scale }, cpv);
          const onGraph = overlaps(grow(cw.pill, CALLOUT_PLATE_CLEAR), grow(geo.box, CALLOUT_NODE_TOL)) || boxDist(cw.dot, geo.box) <= CALLOUT_NODE_TOL;
          if (!onGraph) continue;
          const chk = calloutGraphCheck(cw, geo);
          const lost = chk.dotDist > CALLOUT_NODE_TOL;
          if (!chk.plateHits.length && !chk.leaderHits.length && !lost) continue;
          const beat = tl.beats.find((b) => f >= b.startF && f < b.endF);
          const probs = [
            ...(chk.plateHits.length ? [`its "${cpv.text}" plate ${fmtBox(cw.pill)} covers ${chk.plateHits.join(", ")}`] : []),
            ...(chk.leaderHits.length ? [`its leader crosses ${chk.leaderHits.join(", ")}`] : []),
            ...(lost ? [`its dot (${Math.round(cw.dot.x)},${Math.round(cw.dot.y)}) is ${Math.round(chk.dotDist)} px from the nearest node (${chk.nearest.id}) — it points at nothing (keep it ≤ ${CALLOUT_NODE_TOL} px from a node box)`] : []),
          ];
          const target = chk.nearest;
          const place = calloutAnchorPlacement(geo, target.id, cpv, c.scale ?? 1);
          const others = geo.nodes.filter((n) => n.id !== target.id).map((n) => n.id).join(", ");
          const hint = place
            ? `anchor it on ${target.id} ("${target.label}"): x ${place.x}, y ${place.y}, dir "${place.dir}", reach "${place.reach}" puts the dot on its ${place.dir === "w" ? "left" : place.dir === "e" ? "right" : place.dir.startsWith("n") ? "top" : "bottom"} side with a clear plate (for another node — ${others} — put the dot on that node's side the same way)`
            : `no clean spot next to ${target.id} ("${target.label}") for a ${calloutPillW(cpv.text)} px plate — shorten the text, pick another node (${others}), or spread the graph's nodes`;
          add("L33", "error", `${beat?.id ?? "?"} @${f}: Callout "${c.id}" on NodeGraph "${g.id}": ${probs.join("; ")} — ${hint}`, {
            beatId: beat?.id,
            frame: f,
            ...(place ? { fix: { path: `world.${c.id}`, value: { x: place.x, y: place.y, props: { dir: place.dir, reach: place.reach } } } } : {}),
          });
          reported = true;
          break;
        }
      }
    }
  }

  // L34 (W3.3, warn) visual monotony: ≥ 3 beats in a row where nothing focal visibly changes and the camera holds.
  // W3.2 r3 event-recent b05–b18 (sheet.png): the NodeGraph sat still for 11 beats while each beat recoloured one or two
  // nodes / edges; L28 passed because every still differed by a node colour. See beatChanges() for what counts.
  for (const run of monotonyRuns(sb, tl, lib)) {
    const ids = run.beats.map((x) => x.id);
    add(
      "L34",
      "warn",
      `${ids[0]}–${ids[ids.length - 1]}: ${ids.length} beats in a row with no visible change on a focal element and no camera move (${run.beats.map((x) => `${x.id} ${x.did}`).join("; ")}) — break the run with a real change: a new focal instance, a state change, a recolour of ≥ ${Math.round(GRAPH_RECOLOUR_SHARE * 100)} % of the graph, a drawOn / countUp, or a camera move / cut to the part that changes`,
      { beatId: ids[0], frame: tl.beats.find((x) => x.id === ids[0])?.keywordF },
    );
  }

  // L35 (W3.3, warn) a KineticWord that says what the caption says: W3.2 r3 event-recent b22 ("A race, then a modified
  // fallback.") and evergreen-oom b16 ("The kernel counts every page.") put the beat's whole phrase on the card while
  // the subtitle card showed the same words underneath — the climax punch reads twice.
  for (const e of tl.events) {
    if (e.kind !== "action" || e.do !== "enter") continue;
    const inst = instById.get(e.target);
    const tb = tl.beats.find((x) => x.id === e.beatId);
    if (!inst || inst.component !== "KineticWord" || !tb) continue;
    const text = (inst.props as { text?: unknown } | undefined)?.text;
    if (typeof text !== "string") continue;
    const dup = kineticCaptionDup(text, sb.beats[tb.index].phrase, tl.displayPhrases.filter((d) => d.beatId === tb.id).map((d) => d.text));
    if (dup)
      add("L35", "warn", `${tb.id}${tb.part === "climax" ? " (climax)" : ""}: KineticWord "${inst.id}" "${text}" repeats ${dup} word for word — the card and the subtitle say the same thing at once; put the punch on the card in fewer, different words (the keyword, or the one word the line turns on) and let the subtitle carry the sentence`, { beatId: tb.id, frame: e.frame });
  }

  // L36 (W4 fix round 2, warn) an SFX off its visual event: W4 evergreen dns b03/b06/b12/b15, oom b04/b19, tls b19 left
  // every whoosh on the default "keyword" anchor while its pan / drawOn started at phraseStart, so the whoosh was heard
  // on a static frame. Every storyboard sound must sit within ±SFX_ANCHOR_TOL_F of a camera key or an action whose
  // registry sfx matches (src/v2/sfx-anchors.ts; the mixer re-anchors whoosh / tick / thud, but the director owns sync).
  const sfxFor = registrySfxLookup(sb.world);
  for (const e of tl.events) {
    if (e.kind !== "sfx" || e.type === "silenceHole") continue;
    const anchors = sfxAnchors(tl, e.beatIndex, e.type, sfxFor);
    if (anchors.some((a) => Math.abs(a.frame - e.frame) <= SFX_ANCHOR_TOL_F)) continue;
    const near = nearestAnchor(anchors, e.frame);
    const tb = tl.beats[e.beatIndex];
    const fix = !near
      ? `${e.beatId} has no ${e.type} moment — add the camera move / action it belongs to, or drop the SFX`
      : `move it onto ${near.what} at frame ${near.frame}${tb && near.frame === tb.firstWordF ? ' (write at: "phraseStart" — SFX default to the keyword)' : ""}`;
    add("L36", "warn", `${e.beatId}: ${e.type} SFX at frame ${e.frame} is not within ±${SFX_ANCHOR_TOL_F} f of a ${e.type} visual event (camera key or matching action); it would play on a still frame — ${fix}`, { beatId: e.beatId, frame: e.frame });
  }

  // ── W5 packet V: lints over the visual-state digest (what is on screen at each review frame) ──────────────────
  // (snaps: computed before L28, which reads the drawn texts too)

  // L37 (block / error) Meter / ContainerBox / HeroStat label vs state: checked at every review frame AND right after
  // each state / props change (the change frame + its tween), so a conflict that a later beat repairs still fires.
  // W3.3 evergreen-oom r2 b19: Meter "pod cgroup" FULL at the 1 Gi tick reading "400 MB" (no check caught it).
  {
    const seen = new Set<string>();
    const report = (instId: string, comp: string, beatId: string, f: number, state: string | null, props: Record<string, unknown>) => {
      for (const iss of labelStateIssues(comp, state, props)) {
        const key = `${instId}|${iss.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const fix =
          comp === "Meter"
            ? iss.kind === "full-low"
              ? `change valueLabel with the state (e.g. "${props.limitLabel ?? "the limit"}" or "memory.current"), drop the number, or show the number as one segment of a bar that stays below the tick`
              : "set value to readout ÷ limit (or the readout to what the bar draws)"
            : "make the readout, the bar and the cells say the same thing";
        add("L37", iss.severity, `${beatId} @${f}: ${comp} "${instId}" ${iss.message} — ${fix}`, { beatId, frame: f });
      }
    };
    for (const s of snaps) for (const o of s.items) if (o.inst.component === "Meter" || o.inst.component === "ContainerBox") report(o.inst.id, o.inst.component, s.beat.id, s.frame, o.state, o.props);
    for (const e of tl.events) {
      if (e.kind !== "action" || (e.do !== "state" && !e.props)) continue;
      const inst = instById.get(e.target);
      if (!inst || (inst.component !== "Meter" && inst.component !== "ContainerBox")) continue;
      const f = Math.min(tl.durationF - 1, e.frame + 12);
      const raw = rawPropsAt(tl, inst, f);
      const pr = parseInstanceProps(inst.component, raw);
      report(inst.id, inst.component, e.beatId, f, stateAt(tl, inst, f), pr?.ok ? pr.value : raw);
    }
    for (const s of snaps)
      for (const c of crossLabelConflicts(s.items)) {
        const key = `${c.a}|${c.b}|x`;
        if (seen.has(key)) continue;
        seen.add(key);
        add("L37", "block", `${s.beat.id} @${s.frame}: "${c.a}" and "${c.b}" both say ${JSON.stringify(c.label)} on screen but read ${c.va} vs ${c.vb} — one label, one number: relabel one of them`, { beatId: s.beat.id, frame: s.frame });
      }
  }

  // L38 (block) a Meter that draws a number nobody sourced: base-props digits are L16's; this adds the action-props
  // overrides and the derived "62%" readout of a Meter without valueLabel (W3.3 oom r2: the stills review caught an
  // unsourced "39%" by eye). Sourced Meters are page-checked by meterNumberFindingsFrom (director tools, DS1).
  for (const inst of sb.world) {
    if (inst.component !== "Meter" || inst.illustrative || inst.sourceIds.length || actedSources.get(inst.id)?.size) continue;
    const base = new Set(stringsIn(inst.props).filter(hasNumber));
    const extra = meterShownNumbers(snaps, inst.id).filter((x) => !base.has(x.text));
    if (extra.length) add("L38", "block", `Meter "${inst.id}" shows ${extra.slice(0, 3).map((x) => `"${x.text}"${x.derived ? " (derived from value)" : ""}`).join(", ")} (${extra[0].beatId}) without sourceIds — source it, give it a sourced valueLabel, or mark it illustrative`, { beatId: extra[0].beatId });
  }

  // W5.1 packet N over the same snapshots (the stage-fitted board):
  // L46 a number the phrase speaks ≠ the quantity a changing ContainerBox / Meter / UnitGrid draws (block with a visible
  //     unit, error without one); L47 a freed cell turns used again with no re-fill in the phrase; L48 a list highlight
  //     (0-indexed) on another item than the beat names / invisible in an accent stack; L49 a drawn string that quotes the
  //     clause after a negating verb ("missed validating that … was not nil") and so says the opposite.
  for (const x of quantityNarrationIssues(sb, tl, snaps)) add("L46", x.severity, x.message, { beatId: x.beatId, frame: x.frame });
  for (const x of cellStateIssues(sb, snaps)) add("L47", "error", x.message, { beatId: x.beatId, frame: x.frame });
  for (const x of highlightIssues(sb, tl, snaps)) add("L48", "error", x.message, { beatId: x.beatId, frame: x.frame });
  for (const x of invertedFragmentIssues(sb, snaps)) add("L49", "error", x.message, { beatId: x.beatId, frame: x.frame });
  // W7 (W6 D2 review): L50 colour polarity, L51 the CTA keeps the hero object, L52 a diagram unchanged > 4 beats
  for (const x of [...colourPolarityIssues(snaps, sb), ...ctaHeroIssues(snaps), ...persistentVisualIssues(snaps, tl)]) add(x.id, x.severity, x.message, { beatId: x.beatId, frame: x.frame });
  // W7.1: L56 KineticWord complete phrase + hold, L57 a header that names a vendor product
  for (const x of [...kineticIssues(snaps, sb), ...headerProductIssues(sb)]) add(x.id, x.severity, x.message, { beatId: x.beatId, frame: x.frame });
  // W7 library: L53 SignalTrace / L54 LayerStack / L55 SensorGrid number- and geometry-truth (src/v2/lintsPhysical.ts)
  for (const x of physicalTruthIssues(snaps, sb, tl)) add(x.id, x.severity, x.message, { beatId: x.beatId, frame: x.frame });

  // L39 (error) focal subject too small: a focal NodeGraph spans < 60 % of the content width or < 25 % of the focal
  // height at EVERY beat it is on screen (W3.3 tls 54 % wide; dns 13 % of the focal height). L29 warns below 70 %.
  for (const inst of sb.world) {
    if (inst.component !== "NodeGraph" || !(inst.focal ?? lib[inst.component]?.focal ?? true)) continue;
    let best: { w: number; h: number; beat: string; f: number; score: number } | null = null;
    const on: string[] = [];
    for (const s of snaps) {
      const o = s.items.find((x) => x.inst.id === inst.id);
      if (!o) continue;
      on.push(s.beat.id);
      const w = o.screen.w / CONTENT_W;
      const h = o.screen.h / FOCAL_H;
      const score = Math.min(w / SUBJECT_MIN_W, h / SUBJECT_MIN_H);
      if (!best || score > best.score) best = { w, h, beat: s.beat.id, f: s.frame, score };
    }
    if (best && best.score < 1)
      add("L39", "error", `NodeGraph "${inst.id}" is too small to carry the mechanism: at its largest (${best.beat}) it spans ${Math.round(best.w * 100)} % of the ${CONTENT_W} px width and ${Math.round(best.h * 100)} % of the ${FOCAL_H} px focal height (${on[0]}–${on[on.length - 1]}; need ≥ ${SUBJECT_MIN_W * 100} % and ≥ ${SUBJECT_MIN_H * 100} %) — spread the nodes over x 0.05–0.95 and y, raise w, or zoom the camera on it`, { beatId: best.beat, frame: best.f });
  }

  // L40 (error) focal group off-centre: the union of the focal items (typography excluded) has its centre more than
  // OFFCENTRE_PX left / right of x 540, merged over consecutive beats with the same focal set (W3.3 tls x ≈ 464).
  {
    let run: { ids: string; beats: string[]; dx: number[]; f: number } | null = null;
    const flush = () => {
      if (run) {
        const worst = run.dx.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
        add("L40", "error", `${run.beats[0]}${run.beats.length > 1 ? `–${run.beats[run.beats.length - 1]}` : ""}: focal ${run.ids} sits ${Math.round(Math.abs(worst))} px ${worst < 0 ? "left" : "right"} of the frame centre (max ${OFFCENTRE_PX}) — centre the group on x 540 (instance x, or the camera target at its centre)`, { beatId: run.beats[0], frame: run.f });
      }
      run = null;
    };
    for (const s of snaps) {
      const foc = s.items.filter((o) => o.focal && !OFFCENTRE_SKIP.has(o.inst.component));
      const u = boxUnion(foc.map((o) => o.screen));
      const dx = u ? u.x + u.w / 2 - WIDTH / 2 : 0;
      const ids = foc.map((o) => o.inst.id).join(", ");
      if (!u || Math.abs(dx) <= OFFCENTRE_PX || s.beat.part === "cta") {
        flush();
        continue;
      }
      if (run && run.ids === ids) {
        run.beats.push(s.beat.id);
        run.dx.push(dx);
      } else {
        flush();
        run = { ids, beats: [s.beat.id], dx: [dx], f: s.frame };
      }
    }
    flush();
  }

  // L41 (error) a large empty band held: ≥ EMPTY_BAND_SHARE of the focal height (y 218–1400) with nothing drawn, over
  // ≥ EMPTY_BAND_RUN consecutive story beats (hook / climax / cta punch frames are allowed to be sparse).
  {
    let run: { beats: string[]; band: { from: number; to: number }; f: number }[] = [];
    const flush = () => {
      if (run.length >= EMPTY_BAND_RUN) {
        const w = run.reduce((a, b) => (b.band.to - b.band.from > a.band.to - a.band.from ? b : a));
        add("L41", "error", `${run[0].beats[0]}–${run[run.length - 1].beats[0]}: ${run.length} beats leave a ${Math.round(w.band.to - w.band.from)} px empty band (y ${Math.round(w.band.from)}–${Math.round(w.band.to)}, ≥ ${Math.round(EMPTY_BAND_SHARE * 100)} % of the focal height) — grow the subject (w / zoom), bring the next element up into the band, or centre the group vertically`, { beatId: run[0].beats[0], frame: run[0].f });
      }
      run = [];
    };
    for (const s of snaps) {
      if (["hook", "climax", "cta"].includes(s.beat.part)) {
        flush();
        continue;
      }
      const band = emptyBand(s.items.map((o) => o.screen));
      if (band.to - band.from >= EMPTY_BAND_SHARE * FOCAL_H) run.push({ beats: [s.beat.id], band, f: s.frame });
      else flush();
    }
    flush();
  }

  // L42 (error) legend / colour mismatch: a ContainerBox draws lime or red cells while nothing else on screen names
  // that colour (a pill / card / callout in the same tone). W3.3 oom r2 b06–b11: lime page-cache cells under a
  // neutral "PAGE CACHE · RECLAIMABLE" pill — the colour had no legend.
  {
    const runs = new Map<string, { beats: string[]; f: number }>();
    for (const s of snaps) {
      const tones = legendTones(s.items);
      for (const o of s.items) {
        if (o.inst.component !== "ContainerBox") continue;
        const b = boxReadout(o.state, o.props);
        for (const tone of ["accent", "danger"] as const) {
          if (!b.cells?.[tone] || tones.has(tone)) continue;
          const k = `${o.inst.id}|${tone}`;
          (runs.get(k) ?? runs.set(k, { beats: [], f: s.frame }).get(k)!).beats.push(s.beat.id);
        }
      }
    }
    for (const [k, r] of runs) {
      const [id, tone] = k.split("|");
      add("L42", "error", `ContainerBox "${id}" draws ${tone === "accent" ? "lime" : "red"} cells with nothing on screen in that colour to name them (${r.beats[0]}${r.beats.length > 1 ? `–${r.beats[r.beats.length - 1]}, ${r.beats.length} beats` : ""}) — give the pill / label that names those cells tone "${tone}", or draw them in the colour of the label that names them`, { beatId: r.beats[0], frame: r.f });
    }
  }

  // L43 (error) digest monotony: ≥ 3 consecutive beats whose on-screen digest differs only trivially (no camera move,
  // no focal enter / exit / state change, recolours < 50 % of a graph, fill steps < 0.1). W3.3: tls b06–b08 / b09–b11
  // (one border colour per beat), oom b12–b15 (reclaim drawn once, then held), dns b06–b11 (graph carried by pills).
  const monotony = digestMonotonyRuns(snaps);
  // W7.2 (W7.1 pilot review): L58 act header, L59 the picture changes on every keyword (camera moves aside) + stations,
  // L60 on-screen craft (meta titles, counts vs the drawn grid, held kinetic, labels on subjects / in the header
  // band), L61 one lime role per card (src/v2/lintsW72.ts)
  for (const x of [
    ...actHeaderIssues(sb, { required: opts.track === "how-it-works" }),
    // the pacing rules (L59, the held KineticWord) are the how-it-works track's (owner brief: clear fundamentals)
    ...(opts.track === "how-it-works" ? keywordChangeIssues(snaps, sb, { skipBeats: new Set(monotony.flatMap((r) => r.beats)) }) : []),
    ...craftIssues(snaps, sb, tl, lib, { heldKinetic: opts.track === "how-it-works" }),
    ...colourRoleIssues(snaps),
    // W7.3 (W7.2 pilot review): L62 the key step is drawn (how-it-works), L63 drawing honesty (src/v2/lintsW73.ts)
    ...(opts.track === "how-it-works" && opts.keyStep ? keyStepIssues(snaps, sb, opts.keyStep) : []),
    ...drawingHonestyIssues(snaps, sb),
  ])
    add(x.id, x.severity, x.message, { beatId: x.beatId, frame: x.frame });
  for (const run of monotony)
    add("L43", "error", `${run.beats[0]}–${run.beats[run.beats.length - 1]}: ${run.beats.length} beats show the same picture (${[...new Set(run.digests)].slice(0, 2).join(" / ") || "no focal"}) — each beat's keyword needs a visible change: a new focal element, a state change, a recolour of ≥ ${Math.round(GRAPH_RECOLOUR_SHARE * 100)} % of the graph, a fill step ≥ ${FILL_STEP}, a new terminal line, or a camera move to the part that changes`, { beatId: run.beats[0], frame: snaps.find((s) => s.beat.id === run.beats[0])?.frame });

  // L44 (block) a count from one party's report stated before that party is named, in a reel about someone else
  // (W5 r1 vswitch-mac: "84 sites went completely offline" = Magic Pages' own sites, read as Hetzner's whole outage).
  for (const a of attributionIssues(sb)) {
    if (!a.named)
      add("L44", "block", `${a.beatId} (${a.part}): "${a.counts.join(", ")}" comes only from a ${a.owner} source, but the reel is about ${a.subjects.join(" / ")} and ${a.owner} is not named until later — a viewer reads it as the whole incident's number: name the party in this line (e.g. "At ${a.owner}, ${a.counts[0]} …"), and caption any hero with "${a.owner.toUpperCase()}"`, { beatId: a.beatId });
    if (a.heroId) add("L44", a.named ? "error" : "block", `${a.beatId}: HeroStat "${a.heroId}" shows a count from a ${a.owner} source without naming ${a.owner} — put "${a.owner.toUpperCase()}" in its caption, label or tag`, { beatId: a.beatId, fix: { path: `world.${a.heroId}`, value: { props: { caption: a.owner.toUpperCase() } } } });
  }

  // L45 (error) a packet mark with no held trace: the route is unlit when the beat ends, or the narration says the
  // traffic was lost and the route does not show where (W5 r1: vswitch b06 / b19 packets never showed in a still).
  for (const p of packetTraceIssues(sb, tl)) {
    const why = [p.unlit.length ? `edges ${p.unlit.join(", ")} are idle when the beat ends` : "", p.loss ? "the line says the traffic is lost but no edge on the route is broken and no node on it is danger" : ""].filter(Boolean).join("; ");
    add("L45", "error", `${p.beatId}: NodeGraph "${p.instId}" packet "${p.packet}" lives ~0.4 s per hop and leaves no trace (${why}) — in the same beat add a state action whose edgeStates light the route (active), and mark where it died (broken edge / danger node) when it is lost`, { beatId: p.beatId, frame: p.frame });
  }

  // Header actions must target the header only with state/scramble/pulse; datafield with mark/state/glitch.
  for (const b of sb.beats)
    for (const a of b.actions) {
      if (a.target === "header" && !["state", "scramble", "pulse", "glitch"].includes(a.do)) add("L1", "error", `${b.id}: header does not support "${a.do}"`, { beatId: b.id });
      if (a.target === "datafield" && !["mark", "state", "glitch", "pulse"].includes(a.do)) add("L1", "error", `${b.id}: datafield does not support "${a.do}"`, { beatId: b.id });
      const inst = instById.get(a.target);
      const shipped = inst ? metaFor(inst.component) : undefined;
      if (inst && shipped) {
        // W2 contract: a shipped component implements exactly the verbs its meta declares
        if (!(a.do in shipped.verbs)) add("L1", "error", `${b.id}: ${inst.component} "${inst.id}" has no verb "${a.do}" (it has ${Object.keys(shipped.verbs).join(", ")})`, { beatId: b.id });
        if (a.do === "state" && (!a.state || !shipped.states.includes(a.state))) add("L1", "error", `${b.id}: ${inst.component} "${inst.id}" state "${a.state ?? ""}" is not one of ${shipped.states.join(", ")}`, { beatId: b.id });
        continue;
      }
      const verbs = inst ? (lib[inst.component] as { verbs?: readonly string[] } | undefined)?.verbs : undefined;
      if (inst && verbs && !["enter", "exit", "focus", "glitch"].includes(a.do) && !verbs.includes(a.do)) add("L1", "warn", `${b.id}: ${inst.component} "${inst.id}" does not declare verb "${a.do}" (registry placeholder)`, { beatId: b.id });
    }

  // L1 instance props vs the shipped component's propsSchema (planned components have no schema yet), and action
  // props overrides the component would drop
  for (const inst of sb.world) {
    const pr = parseInstanceProps(inst.component, inst.props);
    if (!pr) continue;
    if (!pr.ok) {
      add("L1", "block", `instance "${inst.id}" (${inst.component}) props: ${pr.error}`, { path: `world.${sb.world.indexOf(inst)}.props` });
      continue;
    }
    const evs = tl.events.flatMap((e) => (e.kind === "action" && e.target === inst.id ? [{ f: e.frame, do: e.do, state: e.state, props: e.props }] : []));
    for (const r of rejectedOverrides(inst.component, pr.value, evs, inst.w)) add("L1", "error", `instance "${inst.id}" @${r.event.f}: ${r.reason}`, { frame: r.event.f });
  }

  // anchors that resolve outside the reel
  for (const e of tl.events) if (e.frame >= tl.durationF) add("L1", "error", `${e.beatId}: ${e.kind} at frame ${e.frame} is past the end (${tl.durationF})`, { beatId: e.beatId, frame: e.frame });

  const stats = {
    durationSec: r1(durationSec),
    durationF: tl.durationF,
    words: nWords,
    wordsPerSec: Math.round(wps * 100) / 100,
    displayPhrases: tl.displayPhrases.length,
    hardCuts: tl.hardCuts.length,
    glitches,
    renderTmaxSec: Math.round(pr.tMax),
    sfx: tl.events.filter((e) => e.kind === "sfx").length,
    phiMeasured: opts.phi !== undefined,
  };
  return finish(own, tl, stats);
}

/** One line per result, for the director tool response and the Script card. */
export function formatLintReport(r: LintReport): string {
  const head = r.stats ? `${r.stats.durationSec} s · ${r.stats.words} words · ${r.stats.wordsPerSec} w/s · ${r.stats.displayPhrases} captions · cuts ${r.stats.hardCuts} · glitch ${r.stats.glitches} · L18 ${r.stats.renderTmaxSec} s${r.stats.phiMeasured ? "" : " (φ unmeasured)"}` : "schema invalid";
  const lines = r.results.map((x) => `${x.severity.toUpperCase()} ${x.id}${x.beatId ? ` ${x.beatId}` : ""}: ${x.message}`);
  return [`${r.ok ? "OK" : r.blocked ? "BLOCKED" : "ERRORS"} — ${head}`, ...lines].join("\n");
}
