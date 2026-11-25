// LabelPill — a mono pill (≤ 24 chars) with a leader to a dot on the bound anchor. (dx, dy) is the pill centre relative
// to the anchor in screen px. Footprint = box around dot + pill; meta.anchor = the dot.
// size (S1 reviews: "pills ≈ 25–30 px are small at phone size; ≥ 40 px with a solid backing"): md = type.pill 30 px
// (the W3a default, unchanged), lg = 42 px, xl = 54 px — lg/xl get an opaque raised backing and a 3 px border.
// Promoted from remotion/v3lab/overlays.tsx. A13 (W3b): its text must be spoken by the voice.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const PILL = { px: 30, ch: 18, padX: 26, h: 60, dot: 6, margin: 8 } as const;
/** Per-size metrics; JetBrains Mono advance = 0.6 em. md = PILL. */
export const PILL_SIZES = {
  md: { px: 30, ch: 18, padX: 26, h: 60, dot: 6, border: 2, lead: 2 },
  lg: { px: 42, ch: 25.2, padX: 32, h: 80, dot: 8, border: 3, lead: 3 },
  xl: { px: 54, ch: 32.4, padX: 38, h: 100, dot: 10, border: 3, lead: 4 },
} as const;
export type PillSize = keyof typeof PILL_SIZES;
export const LabelPillProps = z
  .object({
    text: z.string().min(1).max(24),
    dx: z.number().min(-700).max(700).default(0),
    dy: z.number().min(-900).max(900).default(-140),
    tone: z.enum(["accent", "neutral"]).default("neutral"),
    size: z.enum(["md", "lg", "xl"]).default("md"),
  })
  .strict();
export type LabelPillPropsT = z.output<typeof LabelPillProps>;

export function pillGeom(p: Pick<LabelPillPropsT, "text" | "dx" | "dy"> & { size?: PillSize }) {
  const S = PILL_SIZES[p.size ?? "md"];
  const pw = Math.round(p.text.length * S.ch + 2 * S.padX);
  const minX = Math.min(-S.dot, p.dx - pw / 2) - PILL.margin;
  const minY = Math.min(-S.dot, p.dy - S.h / 2) - PILL.margin;
  const maxX = Math.max(S.dot, p.dx + pw / 2) + PILL.margin;
  const maxY = Math.max(S.dot, p.dy + S.h / 2) + PILL.margin;
  const ax = -minX, ay = -minY;
  return { w: maxX - minX, h: maxY - minY, ax, ay, pw, S, pill: { x: ax + p.dx - pw / 2, y: ay + p.dy - S.h / 2, w: pw, h: S.h } };
}

export const meta: V3MetaDef<typeof LabelPillProps> = {
  name: "LabelPill",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §4.3 overlays",
  summary: "Mono label pill with a leader to a named part (bind it to an anchor; say the word in the voice).",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: LabelPillProps,
  propsSchemaName: "LabelPillProps",
  example: { text: "the S of https", dx: 0, dy: -140 },
  states: [],
  verbs: { enter: { durF: 12, does: "dot, leader, then pill" }, exit: { durF: 8, does: "fades" }, state: { durF: 6, does: "changes the text", props: ["text", "tone", "size"] } },
  focal: false,
  footprint: (p) => {
    const g = pillGeom(p);
    return { w: g.w, h: g.h };
  },
  anchor: (p) => {
    const g = pillGeom(p);
    return { x: g.ax, y: g.ay };
  },
  sfx: { enter: "tick" },
  enterExit: "self",
  v3kind: "overlay",
  anchors: (p): AnchorMap => {
    const g = pillGeom(p);
    return {
      dot: { x: g.ax, y: g.ay, r: g.S.dot, label: "label dot", physical: "sits on the bound anchor" },
      pill: { x: g.pill.x + g.pill.w / 2, y: g.pill.y + g.pill.h / 2, r: g.pw / 2, label: "label", physical: "the label text" },
    };
  },
  describe: (_s, p) => `PILL "${p.text}"${p.size === "md" ? "" : ` (${p.size}, ${PILL_SIZES[p.size].px} px)`}`,
};
