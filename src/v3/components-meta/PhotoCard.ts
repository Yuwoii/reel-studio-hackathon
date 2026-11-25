// PhotoCard — a small drawn card carrying a real photo AS CONTENT (owner S1 feedback 2026-11-02 #3: the ONLY real
// image allowed is content shown on a screen, e.g. the cat picture). Footprint w × w: a raised rounded card with the
// photo inset. state "scrambled" (10 f): rows of random characters wipe over the photo top → bottom (what a snooper
// sees of locked content); "shown": the photo. `photo` = a photo asset ref (default cat-photo@1; policy-allowed only —
// the bundle ships only allowed files, a refused ref draws an empty card).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const PC = { pad: 0.05, radius: 0.07, scrambleF: 10, glyphRows: 7 } as const;
export const DEFAULT_PHOTO = "cat-photo@1";
export const PHOTO_REF = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}@\d{1,3}$/;

export const PhotoCardProps = z
  .object({
    photo: z.string().regex(PHOTO_REF).default(DEFAULT_PHOTO),
    w: z.number().int().min(100).max(900).default(320),
    tilt: z.number().min(-12).max(12).default(0),
  })
  .strict();
export type PhotoCardPropsT = z.output<typeof PhotoCardProps>;

export const meta: V3MetaDef<typeof PhotoCardProps> = {
  name: "PhotoCard",
  version: 1,
  tier: "p0",
  spec: "S2 brief 2026-11-02 (the cat picture as a travelling card)",
  summary: "Small card with a real photo as content (default: the cat picture); can turn into scrambled characters.",
  families: ["security", "network", "data"],
  propsSchema: PhotoCardProps,
  propsSchemaName: "PhotoCardProps",
  example: { photo: DEFAULT_PHOTO, w: 320 },
  states: ["shown", "scrambled"],
  verbs: {
    enter: { durF: 12, does: "card pops in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: PC.scrambleF, does: "shown ↔ scrambled: random characters wipe over the photo (or clear off it)", props: ["photo", "tilt"] },
    pulse: { durF: 10, does: "card bumps (lands / is handed on)" },
  },
  focal: true,
  footprint: (p) => ({ w: p.w, h: p.w }),
  sfx: { enter: "whoosh", state: "glitch", pulse: "tick" },
  v3kind: "device",
  assetIds: ["photo-card"],
  anchors: (p, _s, _c, state): AnchorMap => ({
    card: { x: p.w / 2, y: p.w / 2, r: p.w / 2, label: state === "scrambled" ? "the scrambled picture" : "the cat picture", physical: state === "scrambled" ? "the picture as an outsider sees it: unreadable characters" : "the photo you post" },
    photo: { x: p.w / 2, y: p.w / 2, r: p.w * (0.5 - PC.pad), label: "the photo", physical: "the picture itself" },
  }),
  describe: (state, p) => `PhotoCard[${p.photo}] ${state === "scrambled" ? "SCRAMBLED (random characters, photo hidden)" : "photo visible"}`,
};
