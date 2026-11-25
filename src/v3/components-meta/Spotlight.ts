// Spotlight — dims everything except a soft circle around a bound anchor (screen-space overlay). Footprint is 2× the
// frame on each side so the dimming covers the screen wherever the anchor sits; meta.anchor = its centre.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const SPOT = { w: 2160, h: 3840, feather: 0.35, fadeF: 10 } as const;
export const SpotlightProps = z.object({ r: z.number().min(40).max(500).default(160), dim: z.number().min(0.3).max(0.85).default(0.6) }).strict();
export type SpotlightPropsT = z.output<typeof SpotlightProps>;

export const meta: V3MetaDef<typeof SpotlightProps> = {
  name: "Spotlight",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §4.3 overlays",
  summary: "Darkens the frame except a soft circle on a named part.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: SpotlightProps,
  propsSchemaName: "SpotlightProps",
  example: { r: 160 },
  states: [],
  verbs: { enter: { durF: SPOT.fadeF, does: "dimming fades in" }, exit: { durF: 8, does: "dimming fades out" }, state: { durF: 10, does: "resizes the hole", props: ["r", "dim"] } },
  focal: false,
  footprint: () => ({ w: SPOT.w, h: SPOT.h }),
  anchor: () => ({ x: SPOT.w / 2, y: SPOT.h / 2 }),
  sfx: {},
  enterExit: "self",
  v3kind: "overlay",
  anchors: (p): AnchorMap => ({ centre: { x: SPOT.w / 2, y: SPOT.h / 2, r: p.r, label: "spotlight centre", physical: "sits on the bound anchor" } }),
  describe: (_s, p) => `SPOTLIGHT r${p.r} dim${Math.round(p.dim * 100)}%`,
};
