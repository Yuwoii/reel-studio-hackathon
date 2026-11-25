// WaveCancel — the noise-cancelling wave chart (2026-11-03 mechanism components, owner-approved plan after the W4 anc
// review: the "after cancelling" leftover must be DRAWN, slow vs quick must show why quick is harder, a sudden spike
// must show the opposite copy arriving late). One physical model for every mode: the headphones make the opposite of
// the sound a fixed short DELAY later (mic → circuit → speaker), so
//
//     opposite(x) = −sound(x − delay)        what's left(x) = sound(x) + opposite(x)
//
// and the picture follows from that, never from a typed residual:
//   cancel   one panel: sound (grey dashed) + opposite (lime) on top, WHAT'S LEFT in its own lane below at the SAME
//            scale — a small wiggle, never a flat line (delay > 0)
//   compare  side by side, same time axis, same delay: SLOW HUM (few cycles — the opposite lines up, small leftover)
//            vs QUICK SOUND (ratio × the cycles — the same delay is a big part of each squeeze: the opposite lags,
//            most gets through)
//   spike    a sudden sharp spike; its opposite arrives LATE (bracket "late"), so most of the spike gets through
//            (and the late copy shows up on its own, after it)
//
//   SOUND + OPPOSITE                         ILLUSTRATIVE      title (cancel / spike) · column titles (compare)
//   ┌───────────────────────────────────────────────────┐
//   │  ╱‾╲  ╱‾╲  ╱‾╲     grey dashed sound, lime opposite │      lane A (260)
//   └───────────────────────────────────────────────────┘
//   ┌ what's left ──────────────────────────────────────┐
//   │  ~~~~~~~~~~~~~~~~~~~  same scale, lime once summed │      lane B (230, label strip 40): appears when summed
//   └───────────────────────────────────────────────────┘
//   ┄ noise   ━ opposite                     ILLUSTRATIVE      legend + honesty tag
//
// States (initial = props.show, default "summed" so an instance that is never stated is never an empty panel):
//   noise → opposite (draws on L→R 18 f) → summed (the leftover lane fades in and draws on 18 f, the inputs step back to
//   ghosts; never before the inputs are fully drawn: revealAt()) · dim. `flow` scrolls the sine waves at 2 px/f
//   (inner motion, no blur window); the spike never scrolls. Runtime imports: zod only.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const WC = {
  pad: 36,
  titleY: 36,
  titlePx: 44,
  colTitlePx: 38,
  laneA: { y: 108, h: 260 },
  /** lane B: a 40 px label strip on top, then the plot (the leftover never runs into its label) */
  laneB: { y: 384, h: 230, labelH: 40 },
  legendY: 634,
  h: 710,
  wSingle: 900,
  wCompare: 920,
  colGap: 32,
  insetX: 18,
  /** wave amplitude as a share of `half` (px per unit) */
  amp: 0.8,
  half: 100,
  points: 260,
  drawF: 20,
  oppF: 18,
  sumF: 18,
  flowPxPerF: 2,
  spike: { at: 0.3, sd: 0.02 },
  lineW: 4,
  sumW: 5,
  maxCycles: 14,
} as const;

export const WAVE_MODES = ["cancel", "compare", "spike"] as const;
export const WAVE_STATES = ["noise", "opposite", "summed", "dim"] as const;

export const WaveCancelProps = z
  .object({
    mode: z.enum(WAVE_MODES).default("cancel"),
    /** cancel / spike title (compare shows the two column titles instead). Default per mode. */
    title: z.string().min(1).max(24).optional(),
    /** compare: the two column titles (slow, quick) */
    columns: z.tuple([z.string().min(1).max(14), z.string().min(1).max(14)]).default(["SLOW HUM", "QUICK SOUND"]),
    /** visible cycles of the (slow) sound across a panel. Default: cancel 3, compare 1.5 */
    cycles: z.number().min(0.5).max(6).optional(),
    /** compare: the quick sound has ratio × the slow cycles (same time axis) */
    ratio: z.number().min(2).max(10).default(5),
    /** the opposite's delay, share of the panel's time span (mic → circuit → speaker). Default: cancel 0.0067,
     *  compare 0.022, spike 0.035. Bigger = worse cancelling; 0 is refused (real cancelling always leaves some). */
    delay: z.number().min(0.002).max(0.15).optional(),
    /** legend / lane words */
    soundLabel: z.string().min(1).max(16).default("noise"),
    oppositeLabel: z.string().min(1).max(16).default("opposite"),
    leftLabel: z.string().min(1).max(16).default("what's left"),
    /** spike: the bracket chip between the spike and its late copy */
    lagLabel: z.string().min(1).max(10).default("late"),
    /** sine waves scroll at 2 px/f (the spike never does) */
    flow: z.boolean().default(true),
    /** state at frame 0 */
    show: z.enum(["noise", "opposite", "summed"]).default("summed"),
    tag: z.enum(["illustrative", "notToScale", "none"]).default("illustrative"),
  })
  .strict();
export type WaveCancelPropsT = z.output<typeof WaveCancelProps>;

export const WAVE_TAG_TEXT = { illustrative: "ILLUSTRATIVE", notToScale: "NOT TO SCALE", none: "" } as const;

// ── model ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WavePanel {
  key: "" | "slow" | "quick";
  shape: "sine" | "spike";
  cycles: number;
  /** delay of the opposite, share of the panel width */
  delay: number;
  title: string;
}

export function wavePanels(p: WaveCancelPropsT): WavePanel[] {
  if (p.mode === "compare") {
    const c = p.cycles ?? 1.5;
    const d = p.delay ?? 0.022;
    return [
      { key: "slow", shape: "sine", cycles: c, delay: d, title: p.columns[0] },
      { key: "quick", shape: "sine", cycles: Math.min(WC.maxCycles, c * p.ratio), delay: d, title: p.columns[1] },
    ];
  }
  if (p.mode === "spike") return [{ key: "", shape: "spike", cycles: 1, delay: p.delay ?? 0.035, title: p.title ?? "SUDDEN SPIKE" }];
  return [{ key: "", shape: "sine", cycles: p.cycles ?? 3, delay: p.delay ?? 0.0067, title: p.title ?? "SOUND + OPPOSITE" }];
}

const gauss = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd));

/** The sound at x (0..1 across the panel), shifted by `s` (flow), in amp units (±1 × WC.amp). */
export function soundAt(pn: WavePanel, x: number, s = 0): number {
  if (pn.shape === "spike") return WC.amp * gauss(x, WC.spike.at, WC.spike.sd);
  return WC.amp * Math.sin(2 * Math.PI * pn.cycles * (x - s));
}
/** The opposite the headphones play: the sound, flipped, `delay` later. */
export const oppositeAt = (pn: WavePanel, x: number, s = 0) => -soundAt(pn, x - pn.delay, s);
/** What reaches the ear. */
export const leftAt = (pn: WavePanel, x: number, s = 0) => soundAt(pn, x, s) + oppositeAt(pn, x, s);

/** Share of the sound that gets through: max |what's left| / max |sound| over the panel (sine: 2·sin(π·delay·cycles)). */
export function leftShare(pn: WavePanel): number {
  let m = 0;
  for (let i = 0; i <= 600; i++) m = Math.max(m, Math.abs(leftAt(pn, i / 600)));
  if (pn.shape === "spike") {
    // the spike's own moment: how much of the PEAK gets through (the late copy is a separate blip after it)
    return Math.abs(leftAt(pn, WC.spike.at)) / WC.amp;
  }
  return m / WC.amp;
}

/** Scroll shift (share of the panel) at frame f: 2 px/f for sine waves with flow, none for the spike. */
export function flowShift(p: Pick<WaveCancelPropsT, "flow">, pn: WavePanel, innerW: number, f: number): number {
  return p.flow && pn.shape === "sine" ? (f * WC.flowPxPerF) / innerW : 0;
}

const ease = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};
const LEVEL: Record<string, number> = { noise: 0, opposite: 1, summed: 2 };

/** Draw progress 0..1 of the sound, the opposite and the leftover at `frame`. The opposite never starts before the
 *  sound is drawn, the leftover never before the opposite is (the anc 37 s bug: a sum drawn over half-drawn inputs
 *  read as an empty panel). `enterF` null = in from the start (drawn). */
export function revealAt(initial: string, events: readonly { f: number; do: string; state?: string }[], enterF: number | null, frame: number): { sound: number; opposite: number; left: number; dim: boolean } {
  const e0 = enterF ?? -1e6;
  let level = LEVEL[initial] ?? 2;
  let oppAt = level >= 1 ? e0 : Infinity;
  let sumAt = level >= 2 ? e0 : Infinity;
  let dim = false;
  for (const e of events) {
    if (e.f > frame) break;
    if (e.do !== "state" || !e.state) continue;
    if (e.state === "dim") {
      dim = true;
      continue;
    }
    const L = LEVEL[e.state];
    if (L === undefined) continue;
    dim = false;
    if (L >= 1 && level < 1) oppAt = e.f;
    if (L >= 2 && level < 2) sumAt = e.f;
    if (L < 1) oppAt = Infinity;
    if (L < 2) sumAt = Infinity;
    level = L;
  }
  const sound = ease((frame - e0) / WC.drawF);
  const oppStart = Math.max(oppAt, e0 + WC.drawF);
  const opposite = Number.isFinite(oppAt) ? ease((frame - oppStart) / WC.oppF) : 0;
  const sumStart = Math.max(sumAt, oppStart + WC.oppF);
  const left = Number.isFinite(sumAt) ? ease((frame - sumStart) / WC.sumF) : 0;
  return { sound, opposite, left, dim };
}

// ── layout ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WaveCol {
  x: number;
  w: number;
  pn: WavePanel;
}
export function waveLayout(p: WaveCancelPropsT): { w: number; h: number; cols: WaveCol[] } {
  const pns = wavePanels(p);
  const w = p.mode === "compare" ? WC.wCompare : WC.wSingle;
  const inner = w - 2 * WC.pad;
  if (pns.length === 2) {
    const cw = (inner - WC.colGap) / 2;
    return { w, h: WC.h, cols: pns.map((pn, i) => ({ x: WC.pad + i * (cw + WC.colGap), w: cw, pn })) };
  }
  return { w, h: WC.h, cols: [{ x: WC.pad, w: inner, pn: pns[0] }] };
}

/** Lane point: x 0..1 across a column's lane, value v (amp units) → footprint px. */
export function lanePoint(col: Pick<WaveCol, "x" | "w">, lane: "a" | "b", x: number, v: number): { x: number; y: number } {
  const top = lane === "a" ? WC.laneA.y : WC.laneB.y + WC.laneB.labelH;
  const h = lane === "a" ? WC.laneA.h : WC.laneB.h - WC.laneB.labelH;
  const lim = h / 2 - 8;
  const y = Math.max(-lim, Math.min(lim, v * WC.half));
  return { x: col.x + WC.insetX + x * (col.w - 2 * WC.insetX), y: top + h / 2 - y };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const meta: V3MetaDef<typeof WaveCancelProps> = {
  name: "WaveCancel",
  version: 1,
  tier: "p0",
  spec: "2026-11-03 mechanism plan (W4 anc review: residual drawn, slow vs quick, late copy)",
  summary:
    "Noise-cancelling wave chart from ONE model (opposite = the sound flipped, a short delay later): cancel = sound + opposite, the leftover drawn small in its own lane (never flat); compare = SLOW HUM vs QUICK SOUND side by side, same delay: the opposite lines up for slow, lags for quick (most gets through); spike = a sudden spike whose opposite arrives late, so most of it gets through.",
  families: ["science"],
  propsSchema: WaveCancelProps,
  propsSchemaName: "WaveCancelProps",
  example: { mode: "compare" },
  states: [...WAVE_STATES],
  initialState: (p) => p.show,
  verbs: {
    enter: { durF: 12, does: "chart rises in; the waves draw on left → right (20 f)" },
    exit: { durF: 8, does: "fades out" },
    state: {
      durF: WC.sumF,
      does: "noise (only the sound) · opposite (the opposite draws on 18 f, after the sound is drawn) · summed (the 'what's left' lane fades in and its line draws on 18 f, after the opposite is drawn; the inputs step back) · dim",
      props: ["delay", "soundLabel", "oppositeLabel", "leftLabel", "lagLabel"],
    },
    focus: { durF: 10, does: "ring flash on the leftover lane(s)" },
    pulse: { durF: 10, does: "one glow on the leftover line" },
  },
  focal: true,
  footprint: (p) => {
    const L = waveLayout(p);
    return { w: L.w, h: L.h };
  },
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["wave-cancel"],
  anchors: (p, _size, _ctx, state): AnchorMap => {
    const L = waveLayout(p);
    const st = state ?? p.show;
    const out: AnchorMap = {};
    for (const c of L.cols) {
      const k = c.pn.key;
      const name = (s: string) => (k ? `${k}.${s}` : s);
      const cx = c.x + c.w / 2;
      if (k) out[k] = { x: cx, y: L.h / 2, r: c.w / 2, label: c.pn.title.toLowerCase(), physical: `the ${c.pn.title.toLowerCase()} column` };
      out[name("waves")] = { x: cx, y: WC.laneA.y + WC.laneA.h / 2, r: Math.min(c.w, WC.laneA.h) / 2, label: `${p.soundLabel} + ${p.oppositeLabel}`, physical: "the sound and the opposite wave the headphones play" };
      if (st === "summed") out[name("left")] = { x: cx, y: WC.laneB.y + WC.laneB.h / 2, r: Math.min(c.w, WC.laneB.h) / 2, label: p.leftLabel, physical: `what reaches your ear: about ${pct(leftShare(c.pn))} of the sound` };
      if (c.pn.shape === "spike") {
        const a = lanePoint(c, "a", WC.spike.at, soundAt(c.pn, WC.spike.at));
        const b = lanePoint(c, "a", WC.spike.at + c.pn.delay, oppositeAt(c.pn, WC.spike.at + c.pn.delay));
        out.spike = { x: a.x, y: a.y, r: 30, label: "the sudden spike", physical: "a sharp sound, over in an instant" };
        if (st !== "noise") {
          out.copy = { x: b.x, y: b.y, r: 30, label: "the late copy", physical: "the opposite spike, arriving too late" };
          out.lag = { x: (a.x + b.x) / 2, y: WC.laneA.y + 34, r: 40, label: p.lagLabel, physical: "the delay between the spike and its opposite" };
        }
      }
    }
    return out;
  },
  continuous: (p) => p.flow && p.mode !== "spike",
  whenToUse: { text: "a line about cancelling a sound with its opposite: the opposite wave, squeeze vs stretch, what is left, why slow hums cancel and quick sounds do not", words: ["cancel", "opposite", "squeez", "stretch", "wave", "what's left", "leftover"] },
  describe: (state, p) => {
    const L = waveLayout(p);
    const tag = p.tag === "none" ? "" : ` [${WAVE_TAG_TEXT[p.tag]}]`;
    const one = (c: WaveCol) => {
      const s = leftShare(c.pn);
      if (state === "noise") return `${c.pn.title}: only the ${p.soundLabel} (grey dashed)`;
      if (c.pn.shape === "spike")
        return state === "summed"
          ? `${c.pn.title}: the opposite spike arrives LATE ("${p.lagLabel}" bracket) → ${p.leftLabel}: the spike gets through almost whole (~${pct(s)} of its peak), then the late copy on its own`
          : `${c.pn.title}: spike (grey dashed) + its opposite (lime) arriving LATE ("${p.lagLabel}" bracket)`;
      const fit = s < 0.35 ? "the opposite lines up" : "the opposite LAGS behind each squeeze";
      return state === "summed"
        ? `${c.pn.title}: ${fit} → ${p.leftLabel} (own lane, same scale) ~${pct(s)} of the sound${s < 0.35 ? ": a small wiggle, not silence" : ": most gets through"}`
        : `${c.pn.title}: ${p.soundLabel} (grey dashed) + ${p.oppositeLabel} (lime), ${fit}`;
    };
    return `WaveCancel ${p.mode}${state === "dim" ? " dimmed" : ""}: ${L.cols.map(one).join(" | ")}${tag}`;
  },
};
