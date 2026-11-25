// Figure — the in-reel escape hatch (ADR-001 §2.3 / §5, D1 #7): a capped, keyframable vector primitive rendered by
// fixed code. ≤ 80 nodes in total (children included), path `d` restricted to M/L/A/Z (+ relative m/l/a/z), colours
// by token name only. Renderer: remotion/v2/components/Figure.tsx.
//
// Where the nodes come from: a storyboard carries them on the INSTANCE (`Instance.figure`, src/schema/storyboard.v2.ts
// FigNode — L13 counts them there); the Slot passes them to the Render as RenderProps.figure. The props channel `nodes`
// below is the SAME schema, redeclared here because meta files may only import `zod` at runtime
// (test/v2-components-c.test.ts checks both schemas agree); it feeds the V2Gallery fixtures and unit tests, and the
// Render falls back to it when `figure` is absent.
//
// Size: a Figure's World box is timeline.ts figureBox(Instance.figure). meta.footprint() only sees props, so for a
// storyboard Figure (props.nodes absent) it returns the 600 × 400 fallback and RenderProps.size carries that value;
// the Render never reads p.size — it draws at figureBounds(nodes), 1:1 with the World box.
//
// Node timing: node anchors (`enter.at`, `exit.at`, track keys, `fillTo`, `morphTo`) are beat-relative `At` values.
// They resolve inside the beat that contains the Figure's enter frame (no enter: its first action; else frame 0).
// In the gallery (no beats) keyword = phraseStart = the enter frame, phraseEnd = the exit frame (or the composition
// end), and {word: n} = enter + 6 n.
import { z } from "zod";
import type { FigNodeT } from "../../schema/storyboard.v2.js";
import type { ComponentMetaDef } from "./_types.js";

/** = storyboard TOKENS (src/schema/storyboard.v2.ts); the test checks they stay identical. */
export const FIG_TOKENS = ["bg", "bgRaised", "bgRaised2", "border", "borderStrong", "text", "textDim", "textFaint", "textFainter", "accent", "accentInk", "danger", "dangerBg"] as const;
const Token = z.enum(FIG_TOKENS);
const Id = z.string().regex(/^[a-z0-9-]{2,32}$/, "id: 2–32 chars of a-z 0-9 -");
const AtRef = z.enum(["keyword", "phraseStart", "phraseEnd"]);
const At = z.union([AtRef, z.object({ word: z.number().int().min(0) }).strict(), z.object({ ref: AtRef, offsetF: z.number().int().min(-15).max(45) }).strict()]);
const Ease = z.enum(["bible", "longPan", "pushOut", "enter", "linear"]);
const PATH_D = /^[MLAZmlaz0-9.,\s-]{1,4000}$/;
const TrackKey = z.object({ at: At, value: z.number(), ease: Ease.default("bible"), durF: z.number().int().min(1).max(60).default(16) });
const Track = z.array(TrackKey).max(8);

/** Same rules as the storyboard FigNode (zod 4, recursive). */
export const FigNode: z.ZodType<FigNodeT> = z.lazy(() =>
  z
    .object({
      id: Id,
      kind: z.enum(["rect", "line", "polyline", "arc", "path", "text", "arrow", "group"]),
      geom: z
        .object({
          x: z.number(),
          y: z.number(),
          w: z.number().optional(),
          h: z.number().optional(),
          r: z.number().optional(),
          points: z.array(z.tuple([z.number(), z.number()])).max(64).optional(),
          d: z.string().regex(PATH_D, "path d: only M/L/A/Z commands and numbers").optional(),
          text: z.string().max(40).optional(),
          font: z.enum(["sans", "mono"]).optional(),
          size: z.enum(["label", "body", "title"]).optional(),
        })
        .strict(),
      stroke: Token.optional(),
      fill: Token.optional(),
      strokeW: z.enum(["hair", "thin", "bold"]).optional(),
      enter: z.object({ at: At, how: z.enum(["fade", "drawOn", "scaleIn", "scramble"]) }).optional(),
      exit: z.object({ at: At, how: z.enum(["fade", "drawOff"]) }).optional(),
      tracks: z.object({ x: Track, y: Track, w: Track, h: Track, opacity: Track, strokeDash: Track, rotate: Track }).partial().optional(),
      fillTo: z.array(z.object({ at: At, token: Token })).max(4).optional(),
      morphTo: z.array(z.object({ at: At, d: z.string().regex(PATH_D), durF: z.number().int().min(6).max(40) })).max(3).optional(),
      children: z.array(FigNode).max(40).optional(),
    })
    .strict(),
) as z.ZodType<FigNodeT>;

export const FIGURE_MAX_NODES = 80;

/** Total node count, children included (= countFigNodes in the storyboard schema). */
export function countFigureNodes(nodes: readonly FigNodeT[] | undefined): number {
  let n = 0;
  for (const x of nodes ?? []) n += 1 + countFigureNodes(x.children);
  return n;
}

export const FigureProps = z
  .object({
    /** Gallery / test channel for the instance's `figure` nodes (storyboards put them on Instance.figure). */
    nodes: z
      .array(FigNode)
      .min(1)
      .max(FIGURE_MAX_NODES)
      .refine((n) => countFigureNodes(n) <= FIGURE_MAX_NODES, `a Figure has at most ${FIGURE_MAX_NODES} nodes (children included)`)
      .optional(),
  })
  .strict();

export type FigurePropsT = z.output<typeof FigureProps>;

/** Text sizes (px, final size; amendments §2 min 26) and the box estimate per char / line (= timeline.ts figNodeBox). */
export const FIGURE = {
  textPx: { label: 26, body: 32, title: 44 },
  /** Conservative advance per char (W2.1, was 16 / 20 / 26 for both fonts — a 44 px Inter title is ~0.68 em, so it
   *  drew past its box): mono = ceil(0.6 em) (JetBrains Mono), sans = ceil(0.68 em) (Inter 600, caps-heavy text). */
  charW: { mono: { label: 16, body: 20, title: 27 }, sans: { label: 18, body: 22, title: 30 } },
  lineH: { label: 32, body: 40, title: 52 },
  strokePx: { hair: 1, thin: 2, bold: 4 },
  /** Box used when no nodes are known (planned-stub era / an empty props channel). */
  fallback: { w: 600, h: 400 },
  /** Gallery word spacing for {word: n} anchors (no words.json). */
  galleryWordF: 6,
  /** drawOn verb: nodes without their own enter draw on in order, this many frames apart (max total 24 f). */
  drawStaggerF: 3,
  drawStaggerMaxF: 24,
} as const;

export interface FigBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Node box relative to its parent origin; a rect's `r` is its corner radius, so rects are always boxed by x,y,w,h
 * (missing w/h = 0). Rule-for-rule identical to timeline.ts figNodeBox (World placement, L3, culling); the two cannot
 * share code under the import rules, so test/v2-components-c.test.ts asserts they agree on every node kind.
 */
export function figureNodeBox(n: FigNodeT): FigBox | null {
  const g = n.geom;
  const pts: [number, number][] = [];
  if (n.kind === "rect") {
    pts.push([g.x, g.y], [g.x + (g.w ?? 0), g.y + (g.h ?? 0)]);
  } else if (n.kind === "group") {
    for (const c of n.children ?? []) {
      const b = figureNodeBox(c);
      if (b) pts.push([g.x + b.x, g.y + b.y], [g.x + b.x + b.w, g.y + b.y + b.h]);
    }
  } else if (g.points?.length) {
    for (const p of g.points) pts.push([p[0], p[1]]);
  } else if (g.d) {
    const nums = (g.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  } else if (g.r !== undefined) {
    pts.push([g.x - g.r, g.y - g.r], [g.x + g.r, g.y + g.r]);
  } else {
    const sz = g.size ?? "label";
    const w = g.w ?? (g.text ? g.text.length * FIGURE.charW[g.font ?? "mono"][sz] : 0);
    const h = g.h ?? (g.text ? FIGURE.lineH[sz] : 0);
    pts.push([g.x, g.y], [g.x + w, g.y + h]);
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Bounding box of all nodes relative to the instance origin (= timeline.ts figureBox), or null. */
export function figureBounds(nodes: readonly FigNodeT[] | undefined): FigBox | null {
  const boxes = (nodes ?? []).map(figureNodeBox).filter((b): b is FigBox => !!b);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const meta = {
  name: "Figure",
  version: 2,
  tier: "figure",
  spec: "ADR-001 §2.3 / §5 (Figure primitive)",
  summary: "Escape hatch: ≤80 token-coloured vector nodes (rect/line/polyline/arc/path/text/arrow/group) with draw-on, keyframe tracks, fill changes and path morphs.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: FigureProps,
  propsSchemaName: "FigureProps",
  example: {
    nodes: [
      { id: "plate", kind: "rect", geom: { x: 0, y: 0, w: 480, h: 200, r: 22 }, fill: "bgRaised", stroke: "borderStrong" },
      { id: "label", kind: "text", geom: { x: 32, y: 28, text: "memory limit", font: "mono", size: "label" }, fill: "textDim" },
    ],
  },
  states: [],
  verbs: {
    enter: { durF: 13, does: "entrance spring, plate first: the card-surface rects are opaque before any content shows (content +3 f); nodes with their own `enter` animate on their own anchors" },
    exit: { durF: 8, does: "content first: the content fades + blurs over 4 f on the opaque card surface, then the surface fades 4 f (nodes with `exit` fade / draw off earlier)" },
    drawOn: { durF: 40, does: "nodes without their own `enter` draw on in node order (strokes evolve 16 f, fills fade in after, text scrambles), 3 f apart, ≤ 24 f total" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    glitch: { durF: 4, does: "4 f glitch of the figure content (the card surface stays untouched): one crisp copy, a red and a faint white ghost 2–4 px either side + one surface-backed slice band, all clipped to the content bounds (counts toward the 0–3 budget)" },
  },
  focal: true,
  footprint: (p, _w) => {
    const b = figureBounds(p.nodes);
    return b ? { w: Math.max(1, Math.ceil(b.w)), h: Math.max(1, Math.ceil(b.h)) } : { ...FIGURE.fallback };
  },
  sfx: { drawOn: "tick", glitch: "glitch" },
  // "self" (W2.1 r2, plateFade): the card-surface rects are the plate (opaque before / after the content)
  enterExit: "self",
} satisfies ComponentMetaDef<typeof FigureProps>;
