// Snooper — "anyone snooping" as a recognisable drawn person with a magnifying glass (S1 reviews: S1's snooper was a
// blank phone and did not read). Footprint w × 1.15 w: head + hooded shoulders, a magnifier in the near hand.
// state "looking" (10 f): the magnifier comes up in front of the eye (lens glint, the eye shows big through it);
// "idle": magnifier lowered. `facing`: which way the person looks. Neutral greys, no red (it is a person, not an alarm).
// pulse: a quick lean-in.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const SN = { aspect: 1.15, lookF: 10 } as const;

export const SnooperProps = z
  .object({
    w: z.number().int().min(160).max(700).default(360),
    facing: z.enum(["left", "right"]).default("left"),
  })
  .strict();
export type SnooperPropsT = z.output<typeof SnooperProps>;

/** Parts for facing "left" (mirrored for "right"), footprint px. */
export function snooperGeom(w: number) {
  const head = { x: 0.56 * w, y: 0.36 * w, r: 0.17 * w };
  const eye = { x: head.x - 0.075 * w, y: head.y - 0.01 * w };
  const lensUp = { x: 0.26 * w, y: eye.y + 0.01 * w, r: 0.14 * w };
  const lensDown = { x: 0.3 * w, y: 0.86 * w, r: 0.11 * w };
  return { W: w, H: Math.round(SN.aspect * w), head, eye, lensUp, lensDown };
}

export const meta: V3MetaDef<typeof SnooperProps> = {
  name: "Snooper",
  version: 1,
  tier: "p0",
  spec: "S2 brief 2026-11-02 (drawn person with a magnifier)",
  summary: "Drawn person in a hood with a magnifying glass; raises it to peek (anyone snooping on the way).",
  families: ["security", "network"],
  propsSchema: SnooperProps,
  propsSchemaName: "SnooperProps",
  example: { w: 360, facing: "left" },
  states: ["idle", "looking"],
  verbs: {
    enter: { durF: 12, does: "the snooper slides in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: SN.lookF, does: "idle → looking: the magnifier comes up in front of the eye" },
    pulse: { durF: 10, does: "leans in for a closer look" },
  },
  focal: true,
  footprint: (p) => ({ w: p.w, h: Math.round(SN.aspect * p.w) }),
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["snooper"],
  anchors: (p, _s, _c, state): AnchorMap => {
    const g = snooperGeom(p.w);
    const mx = (x: number) => (p.facing === "right" ? p.w - x : x);
    const lens = state === "looking" ? g.lensUp : g.lensDown;
    return {
      snooper: { x: p.w / 2, y: g.H / 2, r: p.w / 2, label: "a snooper", physical: "anyone on the way who tries to look (on the Wi-Fi, a router, a cable)" },
      head: { x: mx(g.head.x), y: g.head.y, r: g.head.r * 1.15, label: "the snooper's head", physical: "the person looking" },
      eye: { x: mx(state === "looking" ? g.lensUp.x : g.eye.x), y: state === "looking" ? g.lensUp.y : g.eye.y, r: p.w * 0.05, label: "the snooper's eye", physical: "where they look" },
      magnifier: { x: mx(lens.x), y: lens.y, r: lens.r * 1.2, label: "the magnifying glass", physical: "trying to read what passes by" },
    };
  },
  describe: (state, p) => `Snooper (drawn person with a magnifier, facing ${p.facing}) ${state === "looking" ? "LOOKING through the magnifier" : "magnifier lowered"}`,
};
