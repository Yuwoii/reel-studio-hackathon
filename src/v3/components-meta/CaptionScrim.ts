// CaptionScrim — a darkening band behind the caption card (S1 reviews: zoomed browser text and the sign-in form slid
// under/next to the caption during the hook and payoff zooms; "darken/scrim the band while zoomed"). Screen-space,
// full width: transparent at `top`, ramping to `strength` × bg by the caption's top edge and solid to `bottom`
// (default 1220 → 1560 = above the v2 caption box, bottom 1520, to the footer hairline 1560).
//
// It is NOT bound to a part: ExplainerV3 should mount the plain `CaptionBandScrim` (remotion/v3/components/
// CaptionScrim.tsx) once between the moving world and SubtitleCard. As a library component (overlay kind) it pins its
// top-centre (meta.anchor), so a board can also bind it with space "screen" for a single zoomed beat.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const CS = { w: 1080, top: 1220, bottom: 1560, solidFrom: 0.55 } as const;

export const CaptionScrimProps = z
  .object({
    top: z.number().int().min(900).max(1500).default(CS.top),
    bottom: z.number().int().min(1300).max(1920).default(CS.bottom),
    strength: z.number().min(0).max(1).default(0.85),
  })
  .strict()
  .refine((p) => p.bottom - p.top >= 120, "band ≥ 120 px");
export type CaptionScrimPropsT = z.output<typeof CaptionScrimProps>;

export const meta: V3MetaDef<typeof CaptionScrimProps> = {
  name: "CaptionScrim",
  version: 1,
  tier: "p0",
  spec: "S1 REVIEWS (caption band bleed) / S2 brief 2026-11-02",
  summary: "Screen-space dark gradient band behind the captions so zoomed content never fights the caption text.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: CaptionScrimProps,
  propsSchemaName: "CaptionScrimProps",
  example: { top: CS.top, bottom: CS.bottom, strength: 0.85 },
  states: [],
  verbs: { enter: { durF: 8, does: "band fades in" }, exit: { durF: 8, does: "band fades out" }, state: { durF: 8, does: "changes the strength", props: ["strength"] } },
  focal: false,
  footprint: (p) => ({ w: CS.w, h: p.bottom - p.top }),
  anchor: () => ({ x: CS.w / 2, y: 0 }),
  sfx: {},
  v3kind: "overlay",
  anchors: (p): AnchorMap => ({
    band: { x: CS.w / 2, y: (p.bottom - p.top) / 2, r: CS.w / 2, label: "caption band", physical: "darkened strip behind the captions" },
  }),
  describe: (_s, p) => `CAPTION SCRIM y ${p.top}–${p.bottom} @${Math.round(p.strength * 100)}%`,
};
