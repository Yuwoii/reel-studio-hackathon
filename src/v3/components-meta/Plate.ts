// Plate — a treated photo or page capture from the asset registry (ADR-002 §4.3): one image in the instance box, no
// CSS filter (the dark treatment and any brand mask are baked into the file at ingest). `aspect` (h / w) is LIBRARY-SET
// from the manifest by the lowering (W3b) — the gallery sets it the same way; a mismatch is a lint (A4/A3, W3b).
// anchors(props, size, {asset}) = the manifest's plate-normalised anchors scaled to the box.
import { z } from "zod";
import type { AnchorCtx, AnchorMap, V3MetaDef } from "./_types.js";

export const PlateProps = z
  .object({
    asset: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){0,5}@\d{1,3}$/),
    aspect: z.number().min(0.2).max(5),
    w: z.number().int().min(200).max(4000).default(1080),
    /** "feather" (default for photos): the edges fade into the canvas over `PLATE_FEATHER` of the short side, so a
     *  photo sits IN the dark scene instead of reading as a picture in a box (W3a review). "card": hard edges, for
     *  screenshots / page captures that are meant to look like a screen. */
    edge: z.enum(["feather", "card"]).default("feather"),
  })
  .strict();
export type PlatePropsT = z.output<typeof PlateProps>;

/** Feather width as a share of the plate's short side (fade to transparent at the edge). */
export const PLATE_FEATHER = 0.12;

export function plateAnchors(size: { w: number; h: number }, ctx?: AnchorCtx): AnchorMap {
  const out: AnchorMap = {};
  for (const [k, a] of Object.entries(ctx?.asset?.anchors ?? {})) {
    const at = a.at ?? (a.box ? { x: (a.box.x0 + a.box.x1) / 2, y: (a.box.y0 + a.box.y1) / 2 } : null);
    if (!at) continue;
    out[k] = { x: at.x * size.w, y: at.y * size.h, r: a.r !== undefined ? a.r * size.w : a.box ? (Math.max(a.box.x1 - a.box.x0, (a.box.y1 - a.box.y0) * (size.h / size.w)) * size.w) / 2 : undefined, label: a.label, physical: a.physical };
  }
  return out;
}

export const meta: V3MetaDef<typeof PlateProps> = {
  name: "Plate",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §4.3",
  summary: "A treated real photo or page capture from the asset library (search_assets); anchors come from its manifest.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: PlateProps,
  propsSchemaName: "PlateProps",
  example: { asset: "rack-aisle-dark@2", aspect: 1.7778 },
  states: [],
  verbs: { enter: { durF: 12, does: "plate fades/rises in" }, exit: { durF: 8, does: "fades out" } },
  focal: true,
  footprint: (p) => ({ w: p.w, h: Math.round(p.w * p.aspect) }),
  sfx: { enter: "whoosh" },
  v3kind: "plate",
  anchors: (_p, size, ctx) => plateAnchors(size, ctx),
  describe: (_s, p) => `PLATE[${p.asset}]${p.edge === "card" ? " hard-edged card" : " feathered into the background"}`,
};
