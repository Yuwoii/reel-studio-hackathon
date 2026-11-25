// VersusBadges — bible §6.12 (+ amendments §6 / R7 generalisation #4: neutral tones for comparisons that are not
// good-vs-bad, e.g. TCP vs QUIC).
//
//      ┌────────┐            ┌────────┐
//      │   AI   │     vs     │   AI   │     220 px square badges, radius.card, 2 px tone border, opaque plate;
//      └────────┘            └────────┘     badge text mono 600 (120 px ≤ 2 chars, 96 px ≤ 3, 64 px ≤ 5)
//      defenders             attackers      labels mono 500 30 px in the tone colour, "vs" mono 500 30 px textDim, each on a small opaque bgRaised plate
//
// Entrance: the shared spring plus the two badges sliding apart from a near-centre start (40 px apart, never
// overlapping; 14 f, bible ease); labels fade in over the end of the slide, "vs" after they part. Both badges share
// one type size (the smaller of the two badgePx). States: even, left (the left side wins: the right dims — colours only, the plate stays opaque), right.
// Renderer: remotion/v2/components/VersusBadges.tsx.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const VersusBadgesProps = z
  .object({
    leftBadge: z.string().min(1).max(5),
    leftLabel: z.string().min(1).max(14),
    /** accent (lime: defenders, the good one), danger (red: attackers), neutral (white: plain comparison), dim. */
    leftTone: Tone.default("accent"),
    rightBadge: z.string().min(1).max(5),
    rightLabel: z.string().min(1).max(14),
    rightTone: Tone.default("danger"),
    /** The word between the badges. */
    vs: z.string().min(1).max(4).default("vs"),
  })
  .strict();

export type VersusBadgesPropsT = z.output<typeof VersusBadgesProps>;

export const VERSUS = {
  defaultW: 760,
  minW: 640,
  maxW: 952,
  badge: 220,
  border: 2,
  labelPx: 30,
  labelLh: 40,
  labelGap: 18,
  vsPx: 30,
  slideF: 14,
  /** Enter: the badges start this far apart (edge to edge) and slide out to w/4 · 3w/4 — they never overlap. */
  slideStartGap: 40,
  /** Labels fade in over the last part of the slide (slide progress 0.6 → 1). */
  labelFadeFrom: 0.6,
  vsDelayF: 8,
  vsFadeF: 6,
  /** Dimmed side (W2.1 fix B r2: fully, no olive / mauve mid-mix): the loser's border goes to `border` and its glyph +
   *  label snap to the `textDim` token (the plate stays opaque). Only the border fades over the state change. */
  dimMix: 1,
  /** Labels and "vs" sit on small opaque bgRaised plates (1 px border outline) so no field glyph meets them. */
  platePadX: 12,
  /** The "vs" chip gets wider padding than the label plates, so it reads as a chip, not as part of a field row. */
  vsPadX: 20,
  plateRadius: 8,
  plateBorder: 1,
} as const;

/** Badge text size by length (text is set at its final size; it never scales to fit). */
export const badgePx = (s: string): number => (s.length <= 2 ? 120 : s.length <= 3 ? 96 : 64);

export const meta = {
  name: "VersusBadges",
  version: 1,
  tier: "core",
  spec: "bible §6.12 + amendments §6 (neutral tones)",
  summary: "Two square badges with labels that slide apart from the centre (defenders vs attackers, or neutral A vs B); a state picks the winner.",
  families: ["security", "network", "systems", "science", "data", "outage"],
  propsSchema: VersusBadgesProps,
  propsSchemaName: "VersusBadgesProps",
  example: { leftBadge: "AI", leftLabel: "defenders", rightBadge: "AI", rightLabel: "attackers" },
  states: ["even", "left", "right"],
  verbs: {
    enter: { durF: VERSUS.slideF + 2, does: "plate-first entrance (plateFade: spring y 24→0, scale 0.97→1, badge plates opaque before the glyphs) + the badges slide apart (from 40 px apart, never overlapping) over 14 f, labels fade in at the end of the slide; \"vs\" fades in from +8 f (each small plate goes opaque before its text); a bg backing band clears the field between the badges so the \"vs\" chip stands alone" },
    exit: { durF: 8, does: "content-first exit (plateFade): glyphs and labels fade + blur 4 f on the opaque plates, then the plates 4 f" },
    state: { durF: 8, does: "even / left / right: the losing side dims (border fades to border over 6 f; glyph and label snap to textDim at mid-change, never a mid-mix; its plate stays opaque); tones (colours snap) and labels (8 f scramble) may change", props: ["leftLabel", "rightLabel", "leftTone", "rightTone", "leftBadge", "rightBadge"] },
    pulse: { durF: 12, does: "one inset glow flash on both badges in their tone colours" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    glitch: { durF: 4, does: "4 f red/white tinted-copy glitch with slice displacement on the badge glyphs only, clipped to each rounded badge (counts toward the 0–3 budget)" },
  },
  focal: true,
  footprint: (p, w) => {
    const label = Math.max(p.leftLabel.length, p.rightLabel.length) * VERSUS.labelPx * 0.6 + 2 * (VERSUS.platePadX + VERSUS.plateBorder);
    // each half must hold its badge and its label centred on it
    const need = 2 * Math.max(VERSUS.badge, label) + VERSUS.vsPx * 0.6 * p.vs.length + 2 * (VERSUS.vsPadX + VERSUS.plateBorder) + 64;
    return { w: Math.min(VERSUS.maxW, Math.max(w ?? VERSUS.defaultW, VERSUS.minW, Math.ceil(need))), h: VERSUS.badge + VERSUS.labelGap + VERSUS.labelLh };
  },
  sfx: { enter: "whoosh", state: "tick", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof VersusBadgesProps>;
