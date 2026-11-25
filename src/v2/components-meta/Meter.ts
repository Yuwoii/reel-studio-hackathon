// Meter — R7 N-6 (bar gauge; the bible §6.5 ProcessBox memory bar extracted, ContainerBox embeds it).
//
//   memory                                   62%      label mono 500 28 textDim (danger when full) · value tabular
//   ████████████████████████░░░░░░░░░░░░░░░░░│        track bgRaised2 24 px radius.pill; fill tone colour
//                                     limit 512Mi    limit tick 2 px + mono 400 26 textDim label (optional)
//
// Fill: neutral = text, accent = "the important thing", danger = red; over the limit / state full → danger + pulse
// 0.7↔1 / 20 f. The value tweens over 12 f (bible bezier) and the number follows it discretely (floored frame); a
// new valueLabel scrambles. No circular dials (R7). Not focal, but it knocks the data field out under itself: an
// opaque raised plate (bgRaised, 1 px border, radius.box) inset METER.platePad inside the footprint, so field digits never sit under
// the label / value / limit texts (W2 fix). The value keeps ≥ METER.tickClear px from a limit tick under it.
//
// Renderer: remotion/v2/components/Meter.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const MeterProps = z
  .object({
    /** Left, mono 500 28 px ("memory", "usage", "UPS battery"). */
    label: z.string().min(1).max(24),
    /** Fill level 0..1. Ignored when valueLabel and limitLabel are numbers in one unit ("2GB" / "limit 4GB"): the fill
     *  is then derived from them (derivedFill), so the bar always matches its labels. */
    value: z.number().min(0).max(1),
    /** Limit tick position 0..1 (default 1 = the end of the track). */
    limit: z.number().min(0).max(1).default(1),
    /** Label under the limit tick ("limit 512Mi", "memory.max"). */
    limitLabel: z.string().min(1).max(20).optional(),
    /** Right, replaces the percentage ("317Mi", "4 min left"); scrambles when it changes. */
    valueLabel: z.string().min(1).max(14).optional(),
    /** Label shown in the full state ("OUT OF MEMORY"); scrambles in. */
    fullLabel: z.string().min(1).max(24).optional(),
    /** Fill colour: neutral = white (default), accent = lime, danger = red, dim = textDim. */
    tone: Tone.default("neutral"),
  })
  .strict();

export type MeterPropsT = z.output<typeof MeterProps>;

export const METER = {
  defaultW: 560,
  minW: 320,
  maxW: 952,
  labelPx: 28,
  rowH: 36,
  rowGap: 14,
  trackH: 24,
  tickOver: 6,
  tickW: 2,
  limitGap: 6,
  limitPx: 26,
  limitRowH: 34,
  gapLR: 24,
  tweenF: 12,
  scrambleF: 8,
  /** Field knockout plate: padding around the content, inside the footprint. */
  platePad: 24,
  /** Min gap between the value text and a limit tick that falls under it. */
  tickClear: 8,
} as const;

const mono = (chars: number, px: number) => chars * px * 0.6;

/** Right-hand text width budget: valueLabel, or "100%". */
const valueChars = (p: Pick<MeterPropsT, "valueLabel">) => Math.max(p.valueLabel?.length ?? 0, 4);

export function meterMinWidth(p: MeterPropsT): number {
  const label = Math.max(p.label.length, p.fullLabel?.length ?? 0);
  const tick = p.limitLabel !== undefined || p.limit < 1 ? METER.tickW + METER.tickClear : 0;
  const row = mono(label, METER.labelPx) + METER.gapLR + mono(valueChars(p), METER.labelPx) + tick;
  const lim = p.limitLabel ? mono(p.limitLabel.length, METER.limitPx) : 0;
  return Math.ceil(Math.max(METER.minW, row, lim)) + 2 * METER.platePad;
}

/** Content height (label row + track + optional limit row), without the plate padding. */
export function meterContentHeight(p: Pick<MeterPropsT, "limitLabel">): number {
  const base = METER.rowH + METER.rowGap + METER.trackH;
  return p.limitLabel ? base + METER.tickOver + METER.limitGap + METER.limitRowH : base;
}

/** Footprint height incl. the knockout plate padding. */
export function meterHeight(p: Pick<MeterPropsT, "limitLabel">): number {
  return meterContentHeight(p) + 2 * METER.platePad;
}

// ── W5.1 number-true fill ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A quantity read off a label: "400 MB", "1 Gi", "limit 512Mi", "62%", "300 s". `base` is in bytes / percent /
 * seconds; any other unit (or none) is a "count" that only compares with the very same unit. W6: the ONE parser for
 * labels — the Meter fill (derivedFill, renderer + digest) and the lints (L37/L46, src/v2/lints.ts) both use it, so
 * what the bar draws and what the checks read can never disagree.
 */
export interface Quantity {
  n: number;
  unit: string;
  dim: "bytes" | "percent" | "time" | "count" | "rate";
  base: number;
}
/** Lower-cased unit → [dimension, factor to base] (bytes SI + IEC; "m" is not a unit: minutes, metres, millions). */
export const QTY_UNITS: Record<string, [Quantity["dim"], number]> = {
  b: ["bytes", 1], kb: ["bytes", 1e3], mb: ["bytes", 1e6], gb: ["bytes", 1e9], tb: ["bytes", 1e12], k: ["bytes", 1e3], g: ["bytes", 1e9],
  ki: ["bytes", 1024], mi: ["bytes", 1024 ** 2], gi: ["bytes", 1024 ** 3], ti: ["bytes", 1024 ** 4], kib: ["bytes", 1024], mib: ["bytes", 1024 ** 2], gib: ["bytes", 1024 ** 3], tib: ["bytes", 1024 ** 4],
  // W7: rates (SignalTrace rate × span → cycles; base = Hz). = SignalTrace TRACE_RATE_UNITS (test pins them equal)
  bpm: ["rate", 1 / 60], hz: ["rate", 1], khz: ["rate", 1e3], mhz: ["rate", 1e6], ghz: ["rate", 1e9],
  "%": ["percent", 1], ms: ["time", 1e-3], s: ["time", 1], sec: ["time", 1], secs: ["time", 1], seconds: ["time", 1], min: ["time", 60], mins: ["time", 60], h: ["time", 3600], hours: ["time", 3600],
};
const QTY_RE = /(?<![\p{L}\p{N}_.])(\d+(?:[.,]\d+)?)\s*(%|[A-Za-z]+)?/u;

/** The FIRST quantity in a label, or null ("memory.max", "HUNDREDS MB", "P99"). Grouping commas are dropped
 *  ("1,500 MB" = 1500 MB); a lone comma before 1–2 digits is a decimal point ("1,5 GB"). "2 of 4 GB" = 2 "of" (a
 *  count): it never compares with a byte limit, so such a label never decides a fill. */
export function parseQuantity(s: unknown): Quantity | null {
  if (typeof s !== "string") return null;
  const m = QTY_RE.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const u = QTY_UNITS[unit];
  return u ? { n, unit, dim: u[0], base: n * u[1] } : { n, unit, dim: "count", base: n };
}

/** Same dimension (a count only with the very same unit) and a positive reference. */
export function sameDim(a: Quantity | null, b: Quantity | null): a is Quantity {
  return !!a && !!b && a.dim === b.dim && (a.dim !== "count" || a.unit === b.unit) && b.base > 0;
}

/**
 * Fill derived from the labels (W5.1, number-true): valueLabel and limitLabel both numeric in the same dimension →
 * value / limit, placed against the limit tick (× props.limit), clamped 0..1. null = not derivable (the props'
 * `value` stays in charge). With a derivable fill the bar can never contradict its own numbers — not even in `full`.
 */
export function derivedFill(p: Pick<MeterPropsT, "valueLabel" | "limitLabel" | "limit">): number | null {
  const v = parseQuantity(p.valueLabel);
  const l = parseQuantity(p.limitLabel);
  if (!sameDim(v, l)) return null;
  return Math.max(0, Math.min(1, (v.base / l!.base) * (p.limit ?? 1)));
}

export const meta = {
  name: "Meter",
  version: 3,
  tier: "p0",
  spec: "R7 N-6",
  summary: "Horizontal bar gauge: mono label + tabular value, 24 px track, limit tick; turns red and pulses when full.",
  families: ["outage", "systems", "network", "data"],
  propsSchema: MeterProps,
  propsSchemaName: "MeterProps",
  example: { label: "memory", value: 0.62, limitLabel: "limit 512Mi", tone: "accent" },
  states: ["ok", "full", "empty"],
  verbs: {
    enter: { durF: 13, does: "entrance spring, plate opaque first, label/track/value 3 f later (the fill stays empty until the first countUp, if the instance has one)" },
    exit: { durF: 8, does: "label/track/value fade + blur over 4 f on the still-opaque plate, then the plate fades + blurs over 4 f" },
    countUp: { durF: 12, does: "fill tweens 0 → value over 12 f, the number counts with it" },
    state: { durF: 12, does: "ok = fill to `value`; full = danger + pulse, label → fullLabel, fill to 100 % — unless the labels are numeric: then the fill is ALWAYS valueLabel / limitLabel (\"2GB\" of \"limit 4GB\" = half the bar, also when full: no bar contradicts its own number); empty = drain to 0 (12 f tween; colours snap)", props: ["value", "valueLabel", "label", "limitLabel"] },
    pulse: { durF: 12, does: "one glow flash of the fill" },
  },
  focal: false,
  footprint: (p, w) => ({ w: Math.min(METER.maxW, Math.max(w ?? METER.defaultW, meterMinWidth(p))), h: meterHeight(p) }),
  sfx: { state: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof MeterProps>;
