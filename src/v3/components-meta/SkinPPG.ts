// SkinPPG — a drawn cross-section of the wrist under a smartwatch (2026-11-03 mechanism components, owner-approved plan
// after the W4 watch-hr review: "show the skin, the vessels filling, the green light going in and coming back").
// 900 × 1160 with the trace strip (900 × 880 without). Illustrative layout, no real product.
//
//   ┌ watch case ─────────┐            watch body + strap resting on the skin; on its underside two green LEDs and
//   └─[LED]──[sensor]──[LED]┘           the light sensor (photodiode) between them
//   ═══════ epidermis ═══════          skin surface
//      ○    ╲   ●   ╱    ○             dermis: tiny blood vessels (discs, cut across) that SWELL on every heartbeat;
//      ○     ╲_●_╱     ○               green light goes in from each LED, bends through the vessels and comes back to
//   ░░░░░░ fat ░░░░░░░░░░░             the sensor — DIMMER while the vessels are full, brighter between beats
//   ┌ light back ───────────────┐      optional trace strip: the returned light over the last 4 s, dips on the SAME
//   │ ‾‾\_/‾‾‾\_/‾‾‾\_/‾‾‾\_/‾• │      beats the vessels swell (one pure model, ppgBeat)
//   └───────────────────────────┘
//
// States (initial = props.start, default "measuring": LEDs lit from frame 0, no ramp):
//   off        LEDs dark, no light, vessels still pulse (the heart beats regardless), trace flat "no light"
//   measuring  LEDs steady (they flash hundreds of times a second: never at heart rate), returned light dips per beat
//   loose      the watch lifts off the skin (a gap): room light leaks in under it to the sensor, some LED light escapes
//              sideways, the trace turns noisy and the beat dips get shallow
//   motion     the watch shifts on the wrist (workout): the trace turns jagged, big swings swamp the beat dips
// A state change blends over 12 f; the trace history keeps the state each past sample was taken in (pure modeAt()).
// `contrast`: an inset callout on one vessel — green light ends in the red blood (soaked up), red light bounces back.
// Same bundle-safety rules as every meta: runtime import of `zod` only.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const SKIN = {
  w: 900,
  hTrace: 1160,
  hBare: 880,
  /** skin surface y; layer boundaries */
  surface: 300,
  epiTo: 350,
  dermisTo: 720,
  fatTo: 860,
  /** watch case + underside (at rest on the skin) */
  caseBox: { x: 240, y: 70, w: 420, h: 200 },
  dome: { x: 330, y: 262, w: 240, h: 34 },
  strapY: 234,
  strapH: 48,
  ledL: { x: 370, y: 294 },
  ledR: { x: 530, y: 294 },
  sensor: { x: 450, y: 294 },
  /** loose-strap gap at full blend (px) */
  gapPx: 48,
  /** motion jiggle: two sines, peak own speed ≤ 5 px/f (inner motion, no blur window) */
  jiggle: [{ a: 8, hz: 1.4 }, { a: 4, hz: 3.0 }] as const,
  /** vessels cut across: x, y, r (dermis) */
  vessels: [
    [150, 470, 20],
    [300, 520, 16],
    [450, 560, 24],
    [610, 500, 18],
    [760, 460, 20],
    [220, 640, 14],
    [520, 655, 16],
    [700, 630, 15],
    [380, 430, 12],
  ] as const,
  /** a vessel's radius grows by this share when it is fullest */
  swell: 0.3,
  /** banana light paths LED → depth → sensor (cubic: in = start..bottom, back = bottom..sensor) */
  rayL: { in: [370, 300, 362, 420, 380, 520, 410, 545], back: [410, 545, 440, 520, 452, 420, 450, 302] },
  rayR: { in: [530, 300, 538, 420, 520, 520, 490, 545], back: [490, 545, 460, 520, 448, 420, 450, 302] },
  trace: { x: 0, y: 900, w: 900, h: 240, padX: 40, top: 968, bottom: 1104, windowF: 120 },
  callout: { cx: 742, cy: 430, r: 118 },
  blendF: 12,
} as const;

export const SKIN_STATES = ["off", "measuring", "loose", "motion"] as const;
export type SkinState = (typeof SKIN_STATES)[number];

export const SkinPPGProps = z
  .object({
    bpm: z.number().int().min(40).max(180).default(72),
    /** depth of the per-beat dip of the RETURNED light (0.15–0.5); the vessels swell in step */
    dip: z.number().min(0.15).max(0.5).default(0.35),
    /** the trace strip under the cross-section (returned light over the last 4 s) */
    trace: z.boolean().default(true),
    /** the strip's label (mono, top-left) */
    traceLabel: z.string().min(1).max(22).default("light back"),
    /** inset callout: green light soaked up by the red blood, red light bounces back */
    contrast: z.boolean().default(false),
    /** state at frame 0 (no ramp): "measuring" = LEDs lit from the first frame */
    start: z.enum(SKIN_STATES).default("measuring"),
    /** freeze one moment of the beat (vessels, light back AND the trace): "full" = vessels full, light back dim (trace
     *  flat low) · "empty" = vessels empty between beats, light back bright (trace flat high) · "none" = beating. A
     *  props override (state verb) cuts between full and empty for a "dimmer on a beat / brighter between" contrast. */
    hold: z.enum(["none", "full", "empty"]).default("none"),
  })
  .strict();
export type SkinPPGPropsT = z.output<typeof SkinPPGProps>;

// ── pure model (renderer, describe and the tests read the same functions) ─────────────────────────────────────────

const frac = (x: number) => x - Math.floor(x);
/** Deterministic per-frame hash in [0, 1) (same as ppg.ts hash01; metas cannot import the renderer side). */
export function skinHash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Beat envelope 0..1 at frame f (0 between beats, 1 = vessels fullest / returned light lowest): fast rise in the first
 *  12 % of the beat, slower fall by 60 % (= ppg.ts returnedLevel's shape, so WatchBack, Glow and SkinPPG agree). */
export function ppgBeat(f: number, bpm: number, fps = 30): number {
  const ph = frac((f / fps) * (bpm / 60));
  const d = ph < 0.12 ? ph / 0.12 : ph < 0.6 ? 1 - (ph - 0.12) / 0.48 : 0;
  return d * d * (3 - 2 * d);
}

type BeatP = Pick<SkinPPGPropsT, "bpm"> & { hold?: SkinPPGPropsT["hold"] };
/** The beat envelope as drawn: ppgBeat, or frozen at 1 (hold "full") / 0 (hold "empty"). */
export const beatOf = (p: BeatP, f: number) => (p.hold === "full" ? 1 : p.hold === "empty" ? 0 : ppgBeat(f, p.bpm));

export interface SkinMode {
  /** LEDs on 0..1 */
  on: number;
  /** loose strap blend 0..1 */
  loose: number;
  /** workout motion blend 0..1 */
  motion: number;
}
const MODE: Record<SkinState, SkinMode> = {
  off: { on: 0, loose: 0, motion: 0 },
  measuring: { on: 1, loose: 0, motion: 0 },
  loose: { on: 1, loose: 1, motion: 0 },
  motion: { on: 1, loose: 0, motion: 1 },
};
export interface SkinStateEvent {
  f: number;
  do: string;
  state?: string;
}
const isSkinState = (s: string | undefined): s is SkinState => !!s && (SKIN_STATES as readonly string[]).includes(s);

/** Blended mode at frame f from the initial state + the state events (each change eases over blendF frames). */
export function modeAt(initial: string, events: readonly SkinStateEvent[], f: number): SkinMode {
  let cur: SkinMode = { ...MODE[isSkinState(initial) ? initial : "measuring"] };
  for (const e of events) {
    if (e.f > f) break;
    if (e.do !== "state" || !isSkinState(e.state)) continue;
    const t = Math.min(1, Math.max(0, (f - e.f) / SKIN.blendF));
    const k = t * t * (3 - 2 * t);
    const to = MODE[e.state];
    cur = { on: cur.on + (to.on - cur.on) * k, loose: cur.loose + (to.loose - cur.loose) * k, motion: cur.motion + (to.motion - cur.motion) * k };
  }
  return cur;
}

/** Watch offset (px) at f: lifted by the gap when loose, jiggling sideways in motion. */
export function watchOffset(m: SkinMode, f: number, fps = 30): { dx: number; dy: number } {
  const t = f / fps;
  const dx = m.motion * SKIN.jiggle.reduce((a, j, i) => a + j.a * Math.sin(2 * Math.PI * j.hz * t + i * 1.3), 0);
  const dy = -SKIN.gapPx * m.loose + m.motion * 2 * Math.sin(2 * Math.PI * 2.2 * t);
  return { dx, dy };
}

/** Returned light at the sensor, 0..1 (1 = brightest), as the trace plots it: LED light back (dips on every beat;
 *  shallower when loose: ambient light swamps it) + ambient flicker (loose) + motion swings and jumps (motion). */
export function returnedAt(p: BeatP & Pick<SkinPPGPropsT, "dip">, m: SkinMode, f: number): number {
  if (m.on <= 0.001 && m.loose <= 0.001) return 0;
  const beat = beatOf(p, f);
  const depth = (p.dip / 0.5) * (1 - 0.7 * m.loose) * (1 - 0.3 * m.motion);
  let v = 0.88 - 0.7 * depth * beat;
  // loose: room light flickers in (fast, deterministic per frame) and lifts the level
  v += m.loose * (-0.12 + 0.5 * (skinHash(f) - 0.5) + 0.1 * Math.sin(f * 0.9));
  // motion: big slow swings + sharp jumps when the watch shifts
  const t = f / 30;
  v += m.motion * (-0.18 + 0.3 * Math.sin(2 * Math.PI * 1.4 * t + 0.4) + 0.16 * Math.sin(2 * Math.PI * 3.1 * t) + (skinHash(Math.floor(f / 7)) > 0.72 ? 0.3 * (skinHash(f) - 0.3) : 0));
  return Math.max(0, Math.min(1, v * m.on + (1 - m.on) * 0));
}

/** Brightness 0..1 of the light coming BACK (ray + sensor halo) from the LEDs only: 1 between beats, low on a beat. */
export function backLevel(p: BeatP & Pick<SkinPPGPropsT, "dip">, m: SkinMode, f: number): number {
  return m.on * (1 - (p.dip / 0.5) * 0.92 * beatOf(p, f) * (1 - 0.6 * m.loose));
}

/** Vessel radius share at f (1 = at rest, 1 + swell = fullest). The heart beats in every state. */
export const vesselScale = (p: BeatP, f: number) => 1 + SKIN.swell * beatOf(p, f);

export const skinHeight = (p: Pick<SkinPPGPropsT, "trace">) => (p.trace ? SKIN.hTrace : SKIN.hBare);

const mid = (c: readonly number[], t: number) => {
  // point on a cubic bezier given as [x0,y0,x1,y1,x2,y2,x3,y3]
  const u = 1 - t;
  const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: b[0] * c[0] + b[1] * c[2] + b[2] * c[4] + b[3] * c[6], y: b[0] * c[1] + b[1] * c[3] + b[2] * c[5] + b[3] * c[7] };
};
export const bezierAt = mid;

const LOOSE_LIFT = (state: string | undefined) => (state === "loose" ? -SKIN.gapPx : 0);

export const meta: V3MetaDef<typeof SkinPPGProps> = {
  name: "SkinPPG",
  version: 1,
  tier: "p0",
  spec: "2026-11-03 mechanism plan (W4 watch-hr review b05/b08/b10/b13/b14); R1 facts review W02",
  summary:
    "Wrist cross-section under a watch: skin layers with tiny blood vessels that swell on every heartbeat; green light goes in from the LEDs and comes back to the sensor DIMMER while the vessels are full, brighter between beats; optional trace strip dipping on the same beats; states loose (gap, room light leaks, noisy trace) and motion (watch shifts, jagged trace); optional red-blood vs green-light callout.",
  families: ["science"],
  propsSchema: SkinPPGProps,
  propsSchemaName: "SkinPPGProps",
  example: { bpm: 72, trace: true },
  states: [...SKIN_STATES],
  initialState: (p) => p.start,
  verbs: {
    enter: { durF: 12, does: "cross-section rises in (LEDs already lit when start is measuring)" },
    exit: { durF: 8, does: "fades out" },
    state: {
      durF: SKIN.blendF,
      does: "off (LEDs dark, vessels still pulse) · measuring (steady LEDs, light back dips per beat) · loose (watch lifts: a gap, room light leaks to the sensor, trace noisy) · motion (watch shifts: trace jagged); blends 12 f, the trace keeps each sample's state",
      props: ["contrast", "bpm", "traceLabel", "hold"],
    },
    pulse: { durF: 10, does: "a brief glow on the sensor (a reading is taken)" },
    focus: { durF: 18, does: "ring flash on the vessels" },
  },
  focal: true,
  footprint: (p) => ({ w: SKIN.w, h: skinHeight(p) }),
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["skin-ppg"],
  /** Watch parts follow the loose gap (state "loose"): bind overlays to skin parts when the strap changes. */
  anchors: (p, _size, _ctx, state): AnchorMap => {
    const lift = LOOSE_LIFT(state ?? p.start);
    const out: AnchorMap = {
      watch: { x: SKIN.caseBox.x + SKIN.caseBox.w / 2, y: SKIN.caseBox.y + SKIN.caseBox.h / 2 + lift, r: 220, label: "the watch", physical: "the watch on the wrist, seen cut through from the side" },
      "led.left": { x: SKIN.ledL.x, y: SKIN.ledL.y + lift, r: 18, label: "a green LED", physical: "shines green light into the skin (flashes hundreds of times a second)" },
      "led.right": { x: SKIN.ledR.x, y: SKIN.ledR.y + lift, r: 18, label: "a green LED", physical: "shines green light into the skin (flashes hundreds of times a second)" },
      leds: { x: SKIN.sensor.x, y: SKIN.sensor.y + lift, r: 100, label: "the green LEDs", physical: "both LEDs on the underside of the watch", group: ["led.left", "led.right"] },
      sensor: { x: SKIN.sensor.x, y: SKIN.sensor.y + lift, r: 20, label: "the light sensor", physical: "photodiode: measures how much green light comes back" },
      skin: { x: SKIN.w / 2, y: SKIN.surface, r: 300, label: "your skin", physical: "the skin surface under the watch" },
      vessels: { x: SKIN.w / 2, y: 545, r: 340, label: "tiny blood vessels", physical: "vessels in the skin that fill with blood on every heartbeat", group: ["vessel"] },
      vessel: { x: 450, y: 560, r: 40, label: "a tiny blood vessel", physical: "swells with blood on each heartbeat" },
      "light.in": { ...bezierAt(SKIN.rayL.in, 0.5), r: 40, label: "green light going in", physical: "LED light entering the skin" },
      "light.back": { ...bezierAt(SKIN.rayL.back, 0.5), r: 40, label: "green light coming back", physical: "the light that reaches the sensor: less of it while the vessels are full" },
    };
    if ((state ?? p.start) === "loose") {
      out.gap = { x: SKIN.w / 2, y: SKIN.surface - SKIN.gapPx / 2, r: 60, label: "the gap", physical: "a loose strap lifts the watch off the skin" };
      out.ambient = { x: 120, y: SKIN.surface - SKIN.gapPx / 2 - 40, r: 60, label: "room light", physical: "outside light leaking in under the watch" };
    }
    if (p.trace) {
      const T = SKIN.trace;
      out.trace = { x: T.w / 2, y: T.y + T.h / 2, r: 200, label: "the reading", physical: "how much light comes back, over the last few seconds" };
      out["trace.now"] = { x: T.w - T.padX, y: (T.top + T.bottom) / 2, r: 40, label: "the latest reading", physical: "the newest point of the trace" };
    }
    // the inset circle + its caption box (= remotion/v3/components/SkinPPG.tsx: rect cx ± 150, cy + r + 14 … + 92)
    const C = SKIN.callout;
    if (p.contrast) out.callout = { x: C.cx, y: C.cy, r: C.r, box: { x0: C.cx - 150, y0: C.cy - C.r, x1: C.cx + 150, y1: C.cy + C.r + 106 }, edge: true, label: "red blood, green light", physical: "red blood soaks up green light; red light bounces back" };
    return out;
  },
  continuous: (p) => p.hold === "none",
  whenToUse: { text: "a line about light going into the skin, blood vessels filling, or the light coming back to a sensor (heart rate, pulse oximetry)", words: ["light", "skin", "vessel", "blood", "pulse", "heartbeat", "sensor"] },
  describe: (state, p) => {
    const tr = p.trace ? `; trace "${p.traceLabel}" ` : "";
    const cc = p.contrast ? "; callout: green light ends in a red vessel (soaked up), red light bounces back" : "";
    if (state === "off") return `SkinPPG wrist cross-section: watch on the skin, LEDs OFF (no light), vessels still swell per beat @${p.bpm}bpm${p.trace ? "; trace flat (no light)" : ""}${cc}`;
    const base =
      p.hold === "full"
        ? `SkinPPG wrist cross-section, FROZEN on a beat: LEDs steady green; vessels FULL (swollen); the light coming back to the sensor is DIM and thin${p.trace ? " (trace held low)" : ""}`
        : p.hold === "empty"
          ? `SkinPPG wrist cross-section, FROZEN between beats: LEDs steady green; vessels EMPTY (small); the light coming back to the sensor is BRIGHT${p.trace ? " (trace held high)" : ""}`
          : `SkinPPG wrist cross-section: LEDs steady green; green light goes into the skin and back to the sensor; vessels swell once per beat @${p.bpm}bpm and the light coming back is DIMMER while they are full, brighter between beats`;
    if (state === "loose") return `${base}; LOOSE strap: the watch is lifted (visible gap), room light leaks in to the sensor, some LED light escapes sideways${tr ? `${tr}NOISY, beat dips shallow` : ""}${cc}`;
    if (state === "motion") return `${base}; MOTION: the watch shifts on the wrist${tr ? `${tr}JAGGED, big swings swamp the beat dips` : ""}${cc}`;
    return `${base}${tr && p.hold === "none" ? `${tr}dips on the same beats` : ""}${cc}`;
  },
};
