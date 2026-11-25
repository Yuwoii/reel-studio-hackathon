// Timeline — bible §6.4 (+ amendments §6: gains a clock scale = R7 N-15 ClockAxis; no separate id).
//
//   restart back-off                              [ found by AI ]   label (mono 500 28, tone) · lime pill at the bar end
//                                                                   (right-aligned to the card's inner edge instead when
//                                                                   the bar end would crowd it against the label)
//   ●█████████┼████████┼████████┼███████●────────┤                 20 px tone bar ON the 2 px axis (W2 fix round 2:
//                                                                   one track; event dots cap the bar ends), ticks below
//   10s      20s      40s      80s      160s     5m                 tick labels mono 400 26 textDim
//   └──────────── 6 h 10 min ────────────┘                         clock scale only: duration bracket (SVG strokes)
//
// scale "years": year/step ticks. scale "clock": HH:MM ticks (each label centred on its tick by the time text alone;
// the unit "UTC" is a separate textDim label right after the last tick), an
// optional duration bracket under the bar span, an optional `cursor` hairline (moves 12 f on a state change; the
// header story-clock can bind to the same value) and up to 6 event dots on the axis (Callout instances carry their
// labels). Positions (`from`, `to`, `cursor`, `marks[].at`) are in tick units: 0 = first tick, ticks.length − 1 = last.
//
// Renderer: remotion/v2/components/Timeline.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const TimelineProps = z
  .object({
    /** 2–8 tick labels, left → right ("2019", "PHP 5.4", "10s", "08:00"). */
    ticks: z.array(z.string().min(1).max(8)).min(2).max(8),
    /** "years" (bible §6.4) or "clock" (R7 N-15 ClockAxis: HH:MM axis + duration bracket + cursor). */
    scale: z.enum(["years", "clock"]).default("years"),
    /** Bar label, mono 500 28 px in the tone colour ("2 bugs · every version from 5.4"). */
    label: z.string().min(1).max(32).optional(),
    /** Bar colour / initial state: danger (default, bible) / accent / neutral (white) / dim. */
    tone: Tone.default("danger"),
    /** Bar span in tick units (default: the whole axis). */
    from: z.number().min(0).default(0),
    to: z.number().min(0).optional(),
    /** Lime pill that drops in at the bar end once the bar has grown ("found by AI"). */
    pill: z.string().min(1).max(16).optional(),
    /** Clock scale: unit appended to the last tick label. */
    unit: z.string().min(1).max(5).default("UTC"),
    /** Clock scale: duration bracket under the bar span ("6 h 10 min"). */
    duration: z.string().min(1).max(14).optional(),
    /** Clock scale: position of the cursor hairline (accent), in tick units. */
    cursor: z.number().min(0).optional(),
    /** Event dots on the axis (≤ 6), in tick units; tone = dot colour (default neutral = white). */
    marks: z.array(z.object({ at: z.number().min(0), tone: Tone.default("neutral") }).strict()).max(6).default([]),
  })
  .strict()
  .refine((p) => [p.from, p.to ?? 0, p.cursor ?? 0, ...p.marks.map((m) => m.at)].every((v) => v <= p.ticks.length - 1), { message: "from / to / cursor / marks[].at must be ≤ ticks.length − 1 (tick units)", path: ["to"] })
  .refine((p) => p.to === undefined || p.to > p.from, { message: "to must be > from", path: ["to"] })
  .refine((p) => p.scale === "clock" || (p.duration === undefined && p.cursor === undefined), { message: "duration and cursor need scale: \"clock\"", path: ["scale"] })
  .refine((p) => timelineMinWidth(p) <= TIMELINE.maxW, { message: "ticks / label / pill are too wide for the 896 px card (inside layout.rightSafeX): use fewer or shorter ticks, or a shorter label / pill", path: ["ticks"] });

export type TimelinePropsT = z.output<typeof TimelineProps>;

export const TIMELINE = {
  /** 840 centred on the stage (x 120–960) stays inside layout.rightSafeX (W2.1); maxW = rightSafeX − margin. */
  defaultW: 840,
  maxW: 896,
  padX: 40,
  padY: 32,
  border: 2,
  topRowH: 56,
  labelPx: 28,
  pillPx: 30,
  pillPadX: 22,
  pillGap: 24,
  /** Top row → bar: leaves ≥ 12 px between the pill's bottom and the cursor hairline's top (barY − cursorOver). */
  gapTop: 28,
  cursorOver: 12,
  barH: 20,
  axisPx: 2,
  /** Ticks run from the axis down to this far below the bar's bottom edge (visible under the bar too). */
  tickStub: 8,
  tickLabelGap: 8,
  tickPx: 26,
  tickRowH: 34,
  tickMinGap: 16,
  bracketGap: 16,
  bracketH: 34,
  /** Event dot diameter (all tones the same), drawn with a 3 px bgRaised ring; larger than the bar so a dot at a bar
   *  end reads as its cap. */
  markPx: 24,
  markRing: 3,
  /** Frames a dot pops 0.4 → 1 once the bar front reaches it. */
  markPopF: 4,
  /** Clock unit label: gap after the last tick label. */
  unitGap: 10,
  drawF: 16,
  pillDelayF: 4,
  moveF: 12,
} as const;

const mono = (chars: number, px: number) => chars * px * 0.6;

/** Displayed tick labels: the tick text only, so every label centres on its own tick (the clock unit is separate). */
export function tickLabels(p: Pick<TimelinePropsT, "ticks">): string[] {
  return [...p.ticks];
}

/** Clock scale: the unit label drawn (textDim) right after the last tick label; null on the years scale. */
export function axisUnit(p: Pick<TimelinePropsT, "scale" | "unit">): string | null {
  return p.scale === "clock" ? p.unit : null;
}

/** Extra room right of the last tick label that the unit label needs (0 without a unit). */
function unitRoom(p: Pick<TimelinePropsT, "scale" | "unit">): number {
  const u = axisUnit(p);
  return u === null ? 0 : TIMELINE.unitGap + mono(u.length, TIMELINE.tickPx);
}

export const pillWidth = (text: string) => Math.ceil(mono(text.length, TIMELINE.pillPx) + 2 * TIMELINE.pillPadX + 2);

export function hasBracket(p: Pick<TimelinePropsT, "scale" | "duration">): boolean {
  return p.scale === "clock" && p.duration !== undefined;
}

export interface TimelineLayout {
  /** Inner (padding-box) width. */
  innerW: number;
  x0: number;
  x1: number;
  /** Tick unit → x (padding-box coordinates). */
  x: (t: number) => number;
  topY: number;
  barY: number;
  /** The axis stroke is centred on axisY + 1 (= the bar's centre line). */
  axisY: number;
  /** Bottom end of the tick strokes. */
  tickY2: number;
  tickLabelY: number;
  bracketY: number;
}

export function timelineLayout(p: Pick<TimelinePropsT, "ticks" | "scale" | "unit">, w: number): TimelineLayout {
  const innerW = w - 2 * TIMELINE.border;
  const labels = tickLabels(p);
  const inset = Math.ceil(Math.max(12, ...labels.map((l) => mono(l.length, TIMELINE.tickPx) / 2)));
  const lastHalf = mono(labels[labels.length - 1].length, TIMELINE.tickPx) / 2;
  const insetR = Math.ceil(Math.max(inset, lastHalf + unitRoom(p)));
  const x0 = TIMELINE.padX + inset;
  const x1 = innerW - TIMELINE.padX - insetR;
  const n = p.ticks.length;
  const topY = TIMELINE.padY;
  const barY = topY + TIMELINE.topRowH + TIMELINE.gapTop;
  const axisY = barY + TIMELINE.barH / 2 - TIMELINE.axisPx / 2;
  const tickY2 = barY + TIMELINE.barH + TIMELINE.tickStub;
  const tickLabelY = tickY2 + TIMELINE.tickLabelGap;
  const bracketY = tickLabelY + TIMELINE.tickRowH + TIMELINE.bracketGap;
  return { innerW, x0, x1, x: (t) => x0 + ((x1 - x0) * t) / (n - 1), topY, barY, axisY, tickY2, tickLabelY, bracketY };
}

/** Structural (not Pick<TimelinePropsT>): the schema refine calls it, so it cannot depend on the schema type. */
export function timelineMinWidth(p: { ticks: string[]; scale: "years" | "clock"; unit: string; label?: string; pill?: string }): number {
  const chrome = 2 * TIMELINE.border + 2 * TIMELINE.padX;
  const labels = tickLabels(p);
  const maxTick = Math.max(...labels.map((l) => mono(l.length, TIMELINE.tickPx)));
  const axis = maxTick + (p.ticks.length - 1) * (maxTick + TIMELINE.tickMinGap) + unitRoom(p);
  const top = (p.label ? mono(p.label.length, TIMELINE.labelPx) : 0) + (p.pill ? TIMELINE.pillGap + pillWidth(p.pill) : 0);
  return Math.ceil(chrome + Math.max(axis, top));
}

export function timelineHeight(p: Pick<TimelinePropsT, "scale" | "duration">): number {
  const rows = TIMELINE.topRowH + TIMELINE.gapTop + TIMELINE.barH + TIMELINE.tickStub + TIMELINE.tickLabelGap + TIMELINE.tickRowH;
  return 2 * TIMELINE.border + 2 * TIMELINE.padY + rows + (hasBracket(p) ? TIMELINE.bracketGap + TIMELINE.bracketH : 0);
}

export const meta = {
  name: "Timeline",
  version: 2,
  tier: "core",
  spec: "bible §6.4 + amendments §6 + R7 N-15 (clock scale)",
  summary: "Tick axis with a tone bar that grows on drawOn and a lime pill at its end; clock scale adds bracket + cursor.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: TimelineProps,
  propsSchemaName: "TimelineProps",
  example: { ticks: ["10s", "20s", "40s", "80s", "160s", "5m"], label: "restart back-off", tone: "danger" },
  states: ["danger", "accent", "neutral", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: 13, does: "entrance spring, plate opaque first, content 3 f later (the bar stays empty until the first drawOn, if the instance has one; a clock bracket row is reserved from the first frame)" },
    exit: { durF: 8, does: "content fades + blurs over 4 f on the still-opaque plate, then the plate fades + blurs over 4 f" },
    drawOn: { durF: 33, does: "bar grows along the axis from `from` to `to` over 16 f (bible bezier; the plate opens the clock bracket row and the bracket draws with it, dots pop as it passes); the pill drops in 4 f after the bar lands" },
    state: { durF: 12, does: "bar colour snaps to the tone (a resolve to accent turns the label white, never lime; the cursor is textDim until accent, then snaps lime); a new `to` regrows the bar and a new `cursor` slides the hairline over 12 f; label/pill/duration scramble 8 f", props: ["label", "pill", "to", "cursor", "duration"] },
    pulse: { durF: 12, does: "one glow flash of the bar" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
  },
  focal: true,
  footprint: (p, w) => ({ w: Math.min(TIMELINE.maxW, Math.max(w ?? TIMELINE.defaultW, timelineMinWidth(p))), h: timelineHeight(p) }),
  sfx: { drawOn: "whoosh", state: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof TimelineProps>;
