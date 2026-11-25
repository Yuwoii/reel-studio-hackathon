// Plant — a drawn whole plant in its ground under a day / night sky (2026-11-10 concept device, with LeafSection, after
// rs-20261110-61f00b plants C3 / C4 / CAM: the hook object was a cactus and v3 had none). 800 × 1100. Generic plants, no
// species-accurate botany: kind wheat (a c3 crop), corn (c4), cactus (cam).
//
//   sky card (day: blue + sun · night: dark + moon + stars), ground strip at the bottom
//   the plant swaying a little (rooted, ≤ 1.2°); `pores`: a ring of small pore marks on one leaf / the stem that are
//   OPEN (light) or SHUT (dark) the way the pathway does it — cactus open at night, wheat / corn open by day.
//
// States (initial = props.start): day · night (sky, sun / moon and the pores blend over 14 f).
// Same bundle-safety rules as every meta: runtime import of `zod` only.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const PLANT = {
  w: 800,
  h: 1100,
  ground: 930,
  sun: { x: 650, y: 150, r: 56 },
  /** where the pore marks sit per kind (the anchor the camera pushes into before a cut to LeafSection) */
  pores: { cactus: { x: 400, y: 560 }, corn: { x: 520, y: 520 }, wheat: { x: 246, y: 640 } },
  blendF: 14,
  swayDeg: 1.2,
} as const;

export const PLANT_KINDS = ["wheat", "corn", "cactus"] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];
export const PATHWAY_OF: Record<PlantKind, "c3" | "c4" | "cam"> = { wheat: "c3", corn: "c4", cactus: "cam" };

export const PlantProps = z
  .object({
    kind: z.enum(PLANT_KINDS).default("cactus"),
    start: z.enum(["day", "night"]).default("day"),
    /** pore marks on one leaf / the stem (open or shut by the pathway's rule) */
    pores: z.boolean().default(true),
  })
  .strict();
export type PlantPropsT = z.output<typeof PlantProps>;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** Night 0..1 at frame f. */
export function nightAt(start: string, events: readonly { f: number; do: string; state?: string }[], f: number): number {
  let cur = start === "night" ? 1 : 0;
  for (const e of events) {
    if (e.f > f) break;
    if (e.do !== "state" || (e.state !== "day" && e.state !== "night")) continue;
    const to = e.state === "night" ? 1 : 0;
    cur = cur + (to - cur) * smooth((f - e.f) / PLANT.blendF);
  }
  return cur;
}
/** Pores open 0..1: cam opens at night, c3 / c4 by day. */
export const poresOpen = (kind: PlantKind, night: number) => (PATHWAY_OF[kind] === "cam" ? night : 1 - night);

const NAME: Record<PlantKind, string> = { wheat: "a wheat plant", corn: "a corn plant", cactus: "a cactus" };

export const meta: V3MetaDef<typeof PlantProps> = {
  name: "Plant",
  version: 1,
  tier: "p0",
  spec: "2026-11-10 concept device (rs-20261110-61f00b plants C3 / C4 / CAM: the hook object, day vs night)",
  summary:
    "A drawn whole plant in its ground under the sky: kind wheat (a C3 crop), corn (C4) or cactus (CAM); state day (blue sky, sun) or night (dark sky, moon, stars); pores = small pore marks on a leaf / the stem, OPEN by day for wheat and corn, OPEN at night for the cactus (shut otherwise). Sways a little. The pores anchor is where to push in before cutting to a LeafSection.",
  families: ["science"],
  propsSchema: PlantProps,
  propsSchemaName: "PlantProps",
  example: { kind: "cactus", start: "night", pores: true },
  states: ["day", "night"],
  initialState: (p) => p.start,
  verbs: {
    enter: { durF: 12, does: "the plant rises in under its sky" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: PLANT.blendF, does: "day ↔ night: the sky darkens / lightens, sun ↔ moon and stars, the pore marks open or shut by the plant's rule (cactus at night, wheat / corn by day)" },
    pulse: { durF: 10, does: "a ping ring on the pores" },
    focus: { durF: 18, does: "ring flash around the plant" },
  },
  focal: true,
  footprint: () => ({ w: PLANT.w, h: PLANT.h }),
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["plant"],
  anchors: (p): AnchorMap => {
    const pc = PLANT.pores[p.kind];
    const out: AnchorMap = {
      plant: { x: PLANT.w / 2, y: 560, r: 380, label: NAME[p.kind], physical: `${NAME[p.kind]} growing in the ground (drawn)` },
      sky: { x: PLANT.sun.x, y: PLANT.sun.y, r: PLANT.sun.r + 30, label: "the sun or the moon", physical: "day (sun) or night (moon)" },
      ground: { x: PLANT.w / 2, y: (PLANT.ground + PLANT.h) / 2, r: 300, label: p.kind === "cactus" ? "dry desert sand" : "the field soil", physical: "the ground the plant grows in" },
    };
    if (p.kind === "cactus") out.stem = { x: 400, y: 600, r: 300, label: "the cactus stem", physical: "the thick green stem: a cactus makes its food here (its spines are its leaves)" };
    else out.leaf = { x: pc.x, y: pc.y, r: 120, label: p.kind === "corn" ? "a corn leaf" : "a wheat leaf", physical: "one of the plant's leaves" };
    if (p.pores) out.pores = { x: pc.x, y: pc.y, r: 46, label: "its pores", physical: "tiny openings that let carbon dioxide in and water vapour out" };
    return out;
  },
  content: () => ({ x: 0, y: 40, w: PLANT.w, h: PLANT.h - 40 }),
  continuous: () => true,
  whenToUse: { text: "the hook or payoff: a plant (cactus, corn, wheat) in the open, day vs night", words: ["cactus", "cacti", "corn", "maize", "wheat", "plant"] },
  describe: (state, p) => {
    const night = state === "night";
    const open = poresOpen(p.kind, night ? 1 : 0) > 0.5;
    return `Plant: ${NAME[p.kind]} in the ground, ${night ? "NIGHT (dark sky, moon, stars)" : "DAY (blue sky, sun)"}${p.pores ? `; its pore marks are ${open ? "OPEN" : "SHUT"}` : ""}; sways a little`;
  },
};
