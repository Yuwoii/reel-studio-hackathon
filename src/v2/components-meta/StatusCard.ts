// StatusCard — bible §6.1 (+ amendments §2: danger cards sit on the opaque dangerSurface, never a scrim).
// `wikipedia.org` (sans 600 40 px) left, `● partly down` (mono 500 26 px) right, one 120 px row. Cards stack with an
// 18 px gap (place instances 138 px apart). Renderer: remotion/v2/components/StatusCard.tsx.
// W2.1: the plate HUGS its content (label + a 96 px gap + status, statusCardHugWidth) centred in the footprint, and
// tweens its width over 6 f when an override changes the text; the footprint stays the honest outer bound (sized from
// the base props / instance w, so overrides keep their room). "● " is shown in every state but dim (Running gets its
// status dot) and is always reserved in the width estimate. Content wider than the 952 px safe zone is an L1 error.
//
// Template for every component meta: imports ONLY `zod` at runtime (+ `import type` from ./_types.js).
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

// Tone = the storyboard Tone enum (src/schema/storyboard.v2.ts). Redeclared because meta files may not import
// relative runtime modules; test/v2-components.test.ts checks it stays identical.
const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const StatusCardProps = z
  .object({
    /** Left, sans 600 40 px, white (textDim in the dim state). */
    label: z.string().min(1).max(28),
    /** Right, mono 500 26 px; colour follows the state. */
    status: z.string().min(1).max(24),
    /** Initial state: neutral = grey card + lime status (bible "...and millions more · run PHP"); danger = red
     *  border + dangerSurface + pulsing "● status"; accent = lime border + "● status"; dim = de-emphasised. */
    tone: Tone.default("neutral"),
    /** Force the "●" before the status (default: shown for neutral, danger and accent; hidden when dim). */
    dot: z.boolean().optional(),
  })
  .strict()
  .refine((p) => statusCardMinWidth(p) <= STATUS_CARD.maxW, {
    message: "label + status are too long for one card row (estimated width > 952 px): shorten the label or the status",
    path: ["label"],
  });

export type StatusCardPropsT = z.output<typeof StatusCardProps>;

/** Layout constants shared by footprint() and the Render (keep them in sync: the footprint must be honest). */
export const STATUS_CARD = {
  defaultW: 860,
  maxW: 952, // x 64–1016
  h: 120,
  padX: 40,
  gap: 24,
  labelPx: 40, // bible §6.1
  statusPx: 26, // amendments §2 min text size
  border: 2,
  stackGapPx: 18,
  /** Gap between label and status in the hugging plate (the plate never stretches the row wider than this). */
  hugGap: 96,
  /** Plate width tween after a text override. */
  hugF: 6,
} as const;

/** Conservative text-width estimates (Inter 600 ≈ 0.62 em incl. caps, JetBrains Mono = 0.6 em advance). */
// "● " is reserved unless the dot is forced off: a state change (neutral → danger, dim → accent) may show it.
/** Structural (not Pick<StatusCardPropsT>): the schema refine calls these, so they cannot depend on its type. */
interface RowText {
  label: string;
  status: string;
  dot?: boolean;
}

const rowWidth = (p: RowText, gap: number): number => {
  const label = p.label.length * STATUS_CARD.labelPx * 0.62;
  const status = (p.status.length + (p.dot === false ? 0 : 2)) * STATUS_CARD.statusPx * 0.6;
  return Math.ceil(2 * STATUS_CARD.padX + label + gap + status);
};

export function statusCardMinWidth(p: RowText): number {
  return rowWidth(p, STATUS_CARD.gap);
}

/** Footprint width: the instance w (default 860), at least the text row, at most the safe zone. */
export const statusCardWidth = (p: RowText, w: number | undefined) => Math.min(STATUS_CARD.maxW, Math.max(w ?? STATUS_CARD.defaultW, statusCardMinWidth(p)));

/** Width of the content-hugging plate for these texts (label + 96 px gap + status), never above `maxW`. */
export function statusCardHugWidth(p: RowText, maxW: number): number {
  return Math.min(maxW, rowWidth(p, STATUS_CARD.hugGap));
}

export const meta = {
  name: "StatusCard",
  version: 2,
  tier: "core",
  spec: "bible §6.1",
  summary: "One-row status card hugging its text: label left, ● status right; flips neutral → danger with a scramble and a pulse.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: StatusCardProps,
  propsSchemaName: "StatusCardProps",
  example: { label: "checkout-api", status: "Terminated", tone: "neutral" },
  states: ["neutral", "danger", "accent", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: 13, does: "entrance spring (y 24→0, scale 0.97→1), plate opaque first, label + status 3 f later" },
    exit: { durF: 8, does: "label + status fade + blur over 4 f on the still-opaque plate, then the plate fades + blurs over 4 f" },
    state: { durF: 8, does: "tone change: border/surface/status colours cross-fade 6 f; a new status/label scrambles in 8 f; danger then pulses 0.7↔1 / 20 f", props: ["status", "label"] },
    pulse: { durF: 12, does: "one glow flash of the border in the state colour" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    scramble: { durF: 8, does: "re-scramble the status text (or settle into a new one)", props: ["status"] },
    glitch: { durF: 4, does: "4 f red/white tinted-copy glitch with slice displacement (counts toward the 0–3 budget)" },
  },
  focal: true,
  footprint: (p, w) => ({ w: statusCardWidth(p, w), h: STATUS_CARD.h }),
  // W7.2: the DRAWN plate hugs its texts, centred in the footprint (W7.1 pilot: an 872 px footprint drew a 576 px
  // card, so stage fill and the size lints believed the hook already filled the stage)
  contentBox: (p, w) => {
    const W = statusCardWidth(p, w);
    const pw = statusCardHugWidth(p, W);
    return { x: (W - pw) / 2, y: 0, w: pw, h: STATUS_CARD.h };
  },
  sfx: { state: "tick", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof StatusCardProps>;
