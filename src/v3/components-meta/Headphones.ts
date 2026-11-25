// Headphones — generic over-ear noise-cancelling headphones (new in W3a; ANC pilot gap, ADR §3), 760 × 760.
//   view "pair":    front view — headband, two cups, the small outer microphone on the left cup.
//   view "cutaway": one cup cut open, outside world on the LEFT, the ear on the RIGHT: outer mic on the shell, the
//                   speaker (driver) inside, the cushion, the ear. state "anc": the outside noise wave reaches the
//                   mic, the driver plays the INVERTED wave, and only a small residual reaches the ear. The cups also
//                   block high hiss passively (R1 facts A02–A03) — the residual is drawn small, never zero.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const HP = {
  w: 760,
  h: 760,
  /** headband: cubic from (x0, yEnd) via two controls at yTop − 40 → its top sits at 0.25·yEnd + 0.75·(yTop − 40) */
  pair: { band: { x0: 150, x1: 610, yTop: 90, yEnd: 400 }, cupL: { x: 70, y: 380, w: 170, h: 260 }, cupR: { x: 520, y: 380, w: 170, h: 260 }, mic: { x: 88, y: 440 } },
  cut: { shell: { x: 230, y: 160, w: 300, h: 440 }, mic: { x: 232, y: 260 }, driver: { x: 420, y: 380, h: 220 }, cushion: { x: 510, y: 190, w: 56, h: 380 }, ear: { x: 650, y: 380 }, noise: { x0: 20, x1: 200 }, out: { x0: 448, x1: 504 }, resid: { x0: 572, x1: 598 } },
  waveY: 380,
} as const;

/** Default "pair": establish the headphones as an object first; the cutaway alone is abstract to a non-technical
 *  viewer (W3a review) — a board shows the pair before switching to the cutaway. */
export const HeadphonesProps = z.object({ view: z.enum(["pair", "cutaway"]).default("pair") }).strict();
export type HeadphonesPropsT = z.output<typeof HeadphonesProps>;

export const meta: V3MetaDef<typeof HeadphonesProps> = {
  name: "Headphones",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3 (device a); R1 facts review A02–A03",
  summary: "Generic over-ear headphones: pair view, or a cup cutaway (outer mic, driver, cushion, ear); anc = inverted wave, small residual.",
  families: ["science"],
  propsSchema: HeadphonesProps,
  propsSchemaName: "HeadphonesProps",
  example: { view: "cutaway" },
  states: ["off", "anc"],
  verbs: {
    enter: { durF: 12, does: "headphones rise in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 12, does: "off ↔ anc (mic listens, driver plays the inverted wave, residual small)", props: ["view"] },
  },
  focal: true,
  footprint: () => ({ w: HP.w, h: HP.h }),
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["headphones"],
  anchors: (p): AnchorMap => {
    if (p.view === "pair") {
      const P = HP.pair;
      return {
        headband: { x: HP.w / 2, y: 0.25 * P.band.yEnd + 0.75 * (P.band.yTop - 40), r: 80, label: "the headband", physical: "holds the two cups on your head" },
        "cup.left": { x: P.cupL.x + P.cupL.w / 2, y: P.cupL.y + P.cupL.h / 2, r: 140, label: "the left ear cup", physical: "covers the ear; blocks some noise by itself" },
        "cup.right": { x: P.cupR.x + P.cupR.w / 2, y: P.cupR.y + P.cupR.h / 2, r: 140, label: "the right ear cup", physical: "covers the ear; blocks some noise by itself" },
        mic: { x: P.mic.x, y: P.mic.y, r: 22, label: "the outer microphone", physical: "listens to the noise outside the cup" },
      };
    }
    const C = HP.cut;
    return {
      shell: { x: C.shell.x + 70, y: HP.waveY, r: 230, label: "the ear cup", physical: "the cup shell (cut open here)" },
      mic: { x: C.mic.x, y: C.mic.y, r: 24, label: "the outer microphone", physical: "listens to the noise outside the cup" },
      driver: { x: C.driver.x, y: C.driver.y, r: 70, label: "the speaker", physical: "the driver: plays music, and the opposite (inverted) noise wave" },
      cushion: { x: C.cushion.x + C.cushion.w / 2, y: C.cushion.y + C.cushion.h / 2, r: 60, label: "the cushion", physical: "seals around the ear; blocks the high hiss passively" },
      ear: { x: C.ear.x, y: C.ear.y, r: 80, label: "your ear", physical: "hears what is left: the residual" },
      noise: { x: (C.noise.x0 + C.noise.x1) / 2, y: HP.waveY, r: 90, label: "the outside noise", physical: "low rumble arriving from outside" },
    };
  },
  /** The object without the empty room around it: the pair (cups + band) or the cut cup (shell → ear); the outside
   *  noise wave is context. */
  content: (p) => (p.view === "pair" ? { x: HP.pair.cupL.x, y: HP.pair.band.yTop - 40, w: HP.pair.cupR.x + HP.pair.cupR.w - HP.pair.cupL.x, h: HP.pair.cupL.y + HP.pair.cupL.h - HP.pair.band.yTop + 40 } : { x: HP.cut.shell.x, y: HP.cut.shell.y, w: HP.cut.ear.x + 80 - HP.cut.shell.x, h: HP.cut.shell.h }),
  describe: (state, p) =>
    p.view === "pair"
      ? `Headphones view=pair anc=${state === "anc" ? "on" : "off"}`
      : state === "anc"
        ? "Headphones view=cutaway anc=on mic=listening driver=plays inverted wave residual=small (cups also block high hiss passively)"
        : "Headphones view=cutaway anc=off noise=passes into the cup (only the cushion blocks some high hiss)",
};
