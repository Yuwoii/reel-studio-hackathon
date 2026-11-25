// RequestPill — bible §6.6. A small mono pill (`POST /upload · huge ▮▮▮▮▮▮`) that flies in from off-screen to its
// world position (the instance box = where it lands) with motion blur, then squashes on impact (1 → 0.96 → 1, 6 f).
//
//   [ POST /upload · huge ■■■■■■ ]   mono 500 30 px (type.pill), radius.pill, 2 px border, opaque bgRaised2 plate
//
// The payload blocks are drawn as rectangles (U+25AE is not on the L19 glyph allow-list). The pill moves itself
// (flight metadata → blur windows, L21) and owns its enter/exit: before `enter` it is culled; `enter` = the flight.
// While flying it is drawn OUTSIDE its box, on the approach path (that is what `flight` declares).
// Renderer: remotion/v2/components/RequestPill.tsx.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const RequestPillProps = z
  .object({
    /** Mono 500 30 px, e.g. "POST /upload · huge", "malloc +160Mi", "GET /health". */
    text: z.string().min(1).max(28),
    /** Payload size as 0–8 blocks after the text (bible "huge ▮▮▮▮▮▮"). */
    blocks: z.number().int().min(0).max(8).default(0),
    /** Initial state: neutral (white text, grey border), danger (attacker/oversized: red border + dangerSurface,
     *  red blocks), accent (the request that matters: lime border + blocks), dim. */
    tone: Tone.default("neutral"),
    /** Side the pill flies in from (off-screen, FLIGHT.distancePx away from its landing spot). */
    from: z.enum(["left", "right", "top", "bottom"]).default("left"),
  })
  .strict();

export type RequestPillPropsT = z.output<typeof RequestPillProps>;

export const REQUEST_PILL = {
  px: 30, // type.pill
  lh: 36,
  padX: 24,
  padY: 14,
  border: 2,
  blockW: 12,
  blockH: 24,
  blockGap: 5,
  blocksGap: 16,
  /** Flight: distance from off-screen to the landing spot, duration (bible ease), impact squash after landing. */
  distancePx: 1000,
  flightF: 22,
  impactF: 6,
} as const;

/** Peak world speed of the flight: the bible bezier peaks at ≈ 2.86 × the mean speed. */
export const REQUEST_PILL_PEAK_PX_PER_F = Math.ceil((2.86 * REQUEST_PILL.distancePx) / REQUEST_PILL.flightF);

export function requestPillWidth(p: Pick<RequestPillPropsT, "text" | "blocks">): number {
  const R = REQUEST_PILL;
  const text = p.text.length * R.px * 0.6;
  const blocks = p.blocks > 0 ? R.blocksGap + p.blocks * R.blockW + (p.blocks - 1) * R.blockGap : 0;
  return Math.ceil(2 * R.padX + 2 * R.border + text + blocks);
}

export const meta = {
  name: "RequestPill",
  version: 1,
  tier: "core",
  spec: "bible §6.6",
  summary: "Mono request pill that flies in from off-screen (motion-blurred) to its spot and squashes on impact; place it where it should land (e.g. inside a ContainerBox).",
  families: ["security", "outage", "network", "systems", "data"],
  propsSchema: RequestPillProps,
  propsSchemaName: "RequestPillProps",
  example: { text: "POST /upload · huge", blocks: 6, tone: "danger" },
  states: ["neutral", "danger", "accent", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: REQUEST_PILL.flightF + REQUEST_PILL.impactF, does: "fly in from `from` (1000 px, 22 f, bible ease, on screen ≥ 8 f), then impact squash 1 → 0.96 → 1 over 6 f against the leading edge" },
    exit: { durF: 8, does: "8 f content-first exit in place (plateFade): text + blocks fade and blur 4 f on the opaque pill, then the pill 4 f" },
    state: { durF: 8, does: "tone change: border/plate cross-fade 6 f, text/blocks colours snap; a new text scrambles 8 f", props: ["text", "blocks"] },
    pulse: { durF: 12, does: "one glow flash of the border in the state colour" },
    focus: { durF: 10, does: "impact-style squash in place (1 → 0.96 → 1, 6 f)" },
  },
  focal: false,
  // The pill hugs its text: the instance `w` is ignored (a wider box would only be empty space).
  footprint: (p) => ({ w: requestPillWidth(p), h: REQUEST_PILL.lh + 2 * REQUEST_PILL.padY + 2 * REQUEST_PILL.border }),
  flight: { verbs: ["enter"], durF: REQUEST_PILL.flightF, peakPxPerF: REQUEST_PILL_PEAK_PX_PER_F },
  sfx: { enter: "whoosh", state: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof RequestPillProps>;
