// Callout — R7 N-1 (leader label). A 10 px dot pinned to a world anchor, a 2 px `textDim` leader line (over an 8 px
// bg knockout stroke; the dot has a 3 px bg halo ring, so neither sits on field glyphs) and a mono 500 26 px label in a bgRaised pill with a 1 px `border` outline. Dot colour = tone (neutral textDim, accent,
// danger — danger pulses 0.7↔1 / 20 f; dim).
//
//                    ┌──────────────────────────────┐
//            ╱───────│ SIGKILL · cannot be caught   │     dir "ne": the label sits up-right of the dot;
//          ╱         └──────────────────────────────┘     the dot is at the box's bottom-left (+18 px margin)
//        ●
//
// Anchor: the instance (x, y) is the box's top-left as for every component; the dot sits at calloutGeometry().dot
// inside the box (bottom-left for "ne", bottom-right for "nw", top-left for "se", top-right for "sw", left-middle
// for "e", right-middle for "w"). Put the dot on the thing you point at: x = targetX − dot.x, y = targetY − dot.y.
// Own entrance (enterExit "self"): the dot pops (6 f), the line draws (10 f), then the label fades in (6 f); the exit
// is the reverse in 8 f (label text first on its opaque plate, then the plate, the leader and the dot). danger also
// colours the leader and the pill (danger border on dangerSurface). Renderer: remotion/v2/components/Callout.tsx.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const CalloutProps = z
  .object({
    /** Mono 500 26 px label. */
    text: z.string().min(1).max(30),
    tone: Tone.default("neutral"),
    /** Where the label sits relative to the dot. */
    dir: z.enum(["ne", "nw", "se", "sw", "e", "w"]).default("ne"),
    /** Leader length: diagonal leg 48 / 88 / 140 px (+28 px horizontal), or 60 / 110 / 170 px for e / w. */
    reach: z.enum(["short", "medium", "long"]).default("medium"),
    /** LIBRARY-SET (stage fill, never authored): the pill's attach point relative to the dot (px), replacing dir /
     *  reach — the fit moves a pill that sits on its subject's drawing out to empty stage, the dot stays on the part. */
    layout: z.object({ dx: z.number().min(-900).max(900), dy: z.number().min(-900).max(900) }).strict().optional(),
  })
  .strict();

export type CalloutPropsT = z.output<typeof CalloutProps>;

export const CALLOUT = {
  dot: 10,
  /** Clearance around the dot (the pulse ring grows to r = 16). */
  dotMargin: 18,
  ringR: 16,
  /** Leader: 2 px textDim over a bg knockout stroke `knockW` wide (separates it from the DataField). */
  line: 2,
  knockW: 8,
  /** bg halo ring around the dot (px beyond its radius). */
  dotHalo: 3,
  diag: { short: 48, medium: 88, long: 140 },
  straight: { short: 60, medium: 110, long: 170 },
  tailPx: 28,
  px: 26,
  lh: 32,
  padX: 18,
  pillH: 52,
  border: 1,
  dotF: 6,
  lineDelayF: 4,
  lineF: 10,
  labelDelayF: 12,
  labelF: 6,
  /** Exit: label text 0–4 f, its plate 4–8 f (plateFade timing), leader retracts 3–7, dot shrinks 5–8. */
  exitF: 8,
} as const;

export const calloutPillW = (text: string) => Math.ceil(text.length * CALLOUT.px * 0.6 + 2 * CALLOUT.padX + 2 * CALLOUT.border + 2);

export interface CalloutGeometry {
  w: number;
  h: number;
  /** Dot centre inside the box (= the world anchor relative to the instance's top-left). */
  dot: { x: number; y: number };
  /** Leader polyline points (dot → elbow → label edge), box coordinates. */
  points: { x: number; y: number }[];
  pill: { x: number; y: number; w: number; h: number };
}

/** Pure layout for footprint and Render. */
export function calloutGeometry(p: Pick<CalloutPropsT, "text" | "dir" | "reach"> & { layout?: CalloutPropsT["layout"] }): CalloutGeometry {
  const C = CALLOUT;
  const pw = calloutPillW(p.text);
  const lay = p.layout;
  const sx = lay ? (lay.dx < 0 ? -1 : 1) : p.dir === "nw" || p.dir === "sw" || p.dir === "w" ? -1 : 1;
  const sy = p.dir === "ne" || p.dir === "nw" ? -1 : p.dir === "se" || p.dir === "sw" ? 1 : 0;
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  if (lay) {
    // library layout: leader to the elbow, then a short horizontal tail into the pill
    const tail = Math.min(C.tailPx, Math.abs(lay.dx));
    pts.push({ x: lay.dx - sx * tail, y: lay.dy }, { x: lay.dx, y: lay.dy });
  } else if (sy !== 0) {
    const L = C.diag[p.reach];
    pts.push({ x: sx * L, y: sy * L }, { x: sx * (L + C.tailPx), y: sy * L });
  } else pts.push({ x: sx * C.straight[p.reach], y: 0 });
  const end = pts[pts.length - 1];
  const pill = { x: sx > 0 ? end.x : end.x - pw, y: end.y - C.pillH / 2, w: pw, h: C.pillH };
  const x0 = Math.min(-C.dotMargin, pill.x);
  const y0 = Math.min(-C.dotMargin, pill.y);
  const x1 = Math.max(C.dotMargin, pill.x + pill.w);
  const y1 = Math.max(C.dotMargin, pill.y + pill.h);
  const tx = (q: { x: number; y: number }) => ({ x: q.x - x0, y: q.y - y0 });
  return { w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0), dot: tx(pts[0]), points: pts.map(tx), pill: { ...pill, ...tx(pill) } };
}

export const meta = {
  name: "Callout",
  version: 1,
  tier: "p0",
  spec: "R7 N-1",
  summary: "Leader label: a tone dot pinned on a world point, a thin leader line and a mono label pill (place the box so calloutGeometry().dot lands on the target).",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: CalloutProps,
  propsSchemaName: "CalloutProps",
  example: { text: "SIGKILL · cannot be caught", tone: "danger" },
  states: ["neutral", "accent", "danger", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: CALLOUT.labelDelayF + CALLOUT.labelF, does: "dot pops 0 → 1 (6 f), the leader draws (10 f from +4), the label pill fades in plate-first (6 f from +12: plate opaque by +15, then the text)" },
    exit: { durF: CALLOUT.exitF, does: "the reverse in 8 f: label text fades + blurs on its opaque plate (0–4), then the plate (4–8); the leader retracts (3–7), the dot shrinks (5–8)" },
    drawOn: { durF: CALLOUT.lineF, does: "re-draw the leader from the dot over 10 f" },
    state: { durF: 8, does: "tone change (snap): dot colour; danger also turns the leader and the pill border red on a dangerSurface plate, and pulses the dot 0.7↔1 / 20 f; a new text scrambles 8 f (rolling digits masked, never a false number; the pill springs to the new width)", props: ["text"] },
    pulse: { durF: 12, does: "one ring ripple out of the dot (r 5 → 16, fading) in the tone colour" },
  },
  focal: false,
  anchor: (p) => calloutGeometry(p).dot,
  shape: (p) => {
    const g = calloutGeometry(p);
    return { parts: [{ part: "", x: 0, y: 0, w: g.w, h: g.h }], dot: g.dot, points: g.points, pill: g.pill };
  },
  footprint: (p) => {
    const g = calloutGeometry(p);
    return { w: g.w, h: g.h };
  },
  sfx: { enter: "tick", pulse: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof CalloutProps>;
