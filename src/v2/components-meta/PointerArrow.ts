// PointerArrow — bible §6.7: a dashed red line with a small mono label (`pointer → freed memory`) that draws itself
// on. R2 §7 recipe: evolvePath drives an SVG mask, the visible path keeps its own dash pattern ("14 10", 4 px).
//
//   right:  pointer → freed memory            down:  ┆  label
//           ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌>               ┆
//                                                    v
// Horizontal arrows span the instance width (default 400) with the label above the line (left-aligned at the tail);
// vertical arrows are `reach` long with the label to the right. `bend` arcs a horizontal arrow up or down.
// The label sits on an opaque bgRaised plate (1 px border outline) and the line + head get a bg knockout halo, so the arrow stays legible over a
// busy DataField. The arrow animates its own entrance (enterExit "self": the line draws on 16 f, the head lands, the label fades).
// Renderer: remotion/v2/components/PointerArrow.tsx.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const PointerArrowProps = z
  .object({
    /** Mono 500 26 px in the tone colour. */
    label: z.string().min(1).max(30),
    /** Arrow direction (the head end). */
    dir: z.enum(["right", "left", "down", "up"]).default("right"),
    /** Horizontal arrows only: arc up / down (a quadratic curve), or straight. */
    bend: z.enum(["none", "up", "down"]).default("none"),
    /** Vertical arrows only: length short 160 / medium 260 / long 380 px. */
    reach: z.enum(["short", "medium", "long"]).default("medium"),
    /** danger (bible: red pointer to freed memory), neutral (grey), accent, dim. */
    tone: Tone.default("danger"),
  })
  .strict();

export type PointerArrowPropsT = z.output<typeof PointerArrowProps>;

export const POINTER_ARROW = {
  defaultW: 400,
  minLen: 120,
  maxW: 952,
  labelPx: 26,
  labelLh: 34,
  labelGap: 10,
  band: 52, // horizontal: the line's band below the label (straight line at its centre; bends use ±)
  bendPx: 32,
  stroke: 4,
  dash: "14 10",
  head: 20, // arrowhead leg length
  /** Label plate (opaque `bgRaised` pill, radius 8, 1 px `border` outline — like the Callout label) so the label
   *  never sits straight on DataField glyphs. */
  labelPadX: 10,
  labelRadius: 8,
  labelBorder: 1,
  /** bg-coloured knockout stroke under the dashed line + head (the line reads over any field). */
  haloW: 14,
  sideGap: 18, // vertical: line → label
  lineX: 16, // vertical: x of the line inside the box
  reachPx: { short: 160, medium: 260, long: 380 },
  drawF: 16,
  labelDelayF: 8,
  labelFadeF: 6,
} as const;

export const pointerLabelWidth = (label: string) => Math.ceil(label.length * POINTER_ARROW.labelPx * 0.6 + 2 * POINTER_ARROW.labelPadX + 4);

export function pointerArrowSize(p: PointerArrowPropsT, w: number | undefined): { w: number; h: number } {
  const A = POINTER_ARROW;
  if (p.dir === "left" || p.dir === "right") {
    return { w: Math.min(A.maxW, Math.max(w ?? A.defaultW, A.minLen, pointerLabelWidth(p.label))), h: A.labelLh + A.labelGap + A.band };
  }
  return { w: Math.min(A.maxW, A.lineX + A.head + A.sideGap + pointerLabelWidth(p.label)), h: A.reachPx[p.reach] };
}

/** Geometry inside the box: path d (tail → tip), tip point + unit direction (for the head), label box. */
export function pointerGeometry(p: PointerArrowPropsT, size: { w: number; h: number }) {
  const A = POINTER_ARROW;
  const m = A.head + 2; // keep the head inside the box
  if (p.dir === "left" || p.dir === "right") {
    const top = A.labelLh + A.labelGap;
    const mid = top + A.band / 2;
    const yEnd = p.bend === "up" ? mid + A.bendPx / 4 : p.bend === "down" ? mid - A.bendPx / 4 : mid;
    const yCtl = p.bend === "up" ? mid - A.bendPx * 1.5 : p.bend === "down" ? mid + A.bendPx * 1.5 : mid;
    const [x0, x1] = p.dir === "right" ? [A.stroke, size.w - m] : [size.w - A.stroke, m];
    const d = p.bend === "none" ? `M ${x0} ${mid} L ${x1} ${mid}` : `M ${x0} ${yEnd} Q ${size.w / 2} ${yCtl} ${x1} ${yEnd}`;
    // tangent at the tip of a quadratic = tip − control
    const tx = p.bend === "none" ? x1 - x0 : x1 - size.w / 2;
    const ty = p.bend === "none" ? 0 : yEnd - yCtl;
    const n = Math.hypot(tx, ty) || 1;
    const labelLeft = p.dir === "right" ? 0 : Math.max(0, size.w - pointerLabelWidth(p.label));
    return { d, tip: { x: x1, y: p.bend === "none" ? mid : yEnd }, dirV: { x: tx / n, y: ty / n }, label: { x: labelLeft, y: 0, w: pointerLabelWidth(p.label), h: A.labelLh } };
  }
  const x = A.lineX;
  const [y0, y1] = p.dir === "down" ? [A.stroke, size.h - m] : [size.h - A.stroke, m];
  return {
    d: `M ${x} ${y0} L ${x} ${y1}`,
    tip: { x, y: y1 },
    dirV: { x: 0, y: p.dir === "down" ? 1 : -1 },
    label: { x: A.lineX + A.head + A.sideGap, y: (size.h - A.labelLh) / 2, w: pointerLabelWidth(p.label), h: A.labelLh },
  };
}

export const meta = {
  name: "PointerArrow",
  version: 1,
  tier: "core",
  spec: "bible §6.7 (R2 §7 dashed draw-on through a mask)",
  summary: "Dashed pointer arrow with a mono label that draws itself on (left/right across the instance width, or up/down).",
  families: ["security", "systems", "network", "outage", "science", "data"],
  propsSchema: PointerArrowProps,
  propsSchemaName: "PointerArrowProps",
  example: { label: "pointer → freed memory", dir: "right", tone: "danger" },
  states: ["danger", "neutral", "accent", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: POINTER_ARROW.labelDelayF + POINTER_ARROW.labelFadeF + 2, does: "the dashed line draws on over 16 f (bible ease), the head lands at the end, the label fades in from +8 f" },
    exit: { durF: 8, does: "8 f exit: line + head opacity → 0, blur 0 → 8 px; the label pill is content-first (plateFade: text fades + blurs on the opaque plate 0–4 f, then the plate 4–8 f)" },
    drawOn: { durF: POINTER_ARROW.drawF, does: "re-draw the line from the tail over 16 f (the label stays)" },
    state: { durF: 8, does: "tone change: line/label colours snap; a new label scrambles 8 f", props: ["label"] },
  },
  focal: false,
  footprint: (p, w) => pointerArrowSize(p, w),
  sfx: { enter: "whoosh", drawOn: "whoosh" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof PointerArrowProps>;
