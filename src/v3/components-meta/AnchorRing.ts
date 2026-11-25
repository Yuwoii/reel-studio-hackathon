// AnchorRing — a 3 px accent ring drawn on (8 f) around a bound anchor, then a soft halo pulse (1.2 s). Screen-space
// overlay (W3b OverlayLayer keeps its pixel size under zoom). Footprint = the ring box; meta.anchor = its centre.
// Promoted from remotion/v3lab/overlays.tsx.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const RING = { pad: 24, drawF: 8, stroke: 3, periodF: 36 } as const;
export const AnchorRingProps = z
  .object({ r: z.number().min(8).max(220).default(30), tone: z.enum(["accent", "danger", "neutral"]).default("accent"), pulse: z.boolean().default(true) })
  .strict();
export type AnchorRingPropsT = z.output<typeof AnchorRingProps>;
const side = (r: number) => 2 * (r + RING.pad);

export const meta: V3MetaDef<typeof AnchorRingProps> = {
  name: "AnchorRing",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §4.3 overlays",
  summary: "Ring around a named part of a real object (bind it to an anchor).",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: AnchorRingProps,
  propsSchemaName: "AnchorRingProps",
  example: { r: 30 },
  states: [],
  verbs: { enter: { durF: RING.drawF, does: "ring draws on" }, exit: { durF: 8, does: "ring fades" }, pulse: { durF: 12, does: "one halo pulse" } },
  focal: false,
  footprint: (p) => ({ w: side(p.r), h: side(p.r) }),
  anchor: (p) => ({ x: side(p.r) / 2, y: side(p.r) / 2 }),
  sfx: { enter: "tick" },
  enterExit: "self",
  v3kind: "overlay",
  anchors: (p): AnchorMap => ({ centre: { x: side(p.r) / 2, y: side(p.r) / 2, r: p.r, label: "ring centre", physical: "sits on the bound anchor" } }),
  describe: (_s, p) => `RING r${p.r} ${p.tone}`,
};
