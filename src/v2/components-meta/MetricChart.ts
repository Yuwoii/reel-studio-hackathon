// MetricChart — R7 N-4 (families outage, systems, science, data). Renderer: remotion/v2/components/MetricChart.tsx.
//
//   896 × 480 panel on bgRaised (radius.card, 2 px border). Title mono 26 textDim top-left, ≥ 24 px above the top y
//   label. 1 px gridlines in `border`, mono 26 axis labels in textDim (y: 3 ticks with unit, each sitting just above its gridline; x: ≤ 6
//   labels). Series line 3 px `text`
//   (greyscale) with a head dot while drawing; optional area fill = `text` gradient 0.06 → 0. Threshold line dashed
//   `danger` (ends on full dashes) with a mono 26 label on a bgRaised plate at its left end. Incident window = dangerBg
//   band (over the opaque bgRaised panel). Spike marker = danger dot + ring + mono 26 label on a bgRaised plate with a
//   danger outline, ≥ 16 px clear of the threshold line. x labels are centred on their ticks (plot inset to fit).
//   The line draws left → right (24 f; extensions 18 f) up to `upTo`. Values come from sourced numbers only;
//   otherwise the instance is `illustrative` and needs an IllustrativeTag (R7 N-14).
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Index = z.number().int().min(0).max(59);

export const MetricChartProps = z
  .object({
    /** Mono 26 textDim, top-left ("p99 latency · ms"). */
    title: z.string().min(1).max(40),
    kind: z.enum(["line", "area"]).default("line"),
    /** The series (sourced numbers), 2–60 points, evenly spaced on x. */
    values: z.array(z.number().finite()).min(2).max(60),
    /** ≤ 6 x-axis labels, spread evenly from the first to the last point. */
    xLabels: z.array(z.string().min(1).max(7)).max(6).default([]),
    /** y range (default: 0 or the minimum … a rounded-up maximum). */
    yMin: z.number().finite().optional(),
    yMax: z.number().finite().optional(),
    /** Unit appended to the y labels ("ms", "%", "Gi"). */
    unit: z.string().max(3).default(""),
    /** Decimals of the y labels. */
    decimals: z.number().int().min(0).max(2).default(0),
    threshold: z.number().finite().optional(),
    thresholdLabel: z.string().min(1).max(14).optional(),
    /** Incident window band, by point index. */
    window: z.object({ from: Index, to: Index }).strict().optional(),
    /** Spike marker at this point index (danger). */
    spike: Index.optional(),
    spikeLabel: z.string().min(1).max(14).optional(),
    /** Last drawn point index (default: all). A drawOn with props.upTo extends the line. */
    upTo: Index.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const n = p.values.length;
    if (p.window && (p.window.from >= p.window.to || p.window.to >= n)) ctx.addIssue({ code: "custom", message: `window must satisfy from < to < ${n}`, path: ["window"] });
    if (p.spike !== undefined && p.spike >= n) ctx.addIssue({ code: "custom", message: `spike index ≥ ${n}`, path: ["spike"] });
    if (p.upTo !== undefined && (p.upTo < 1 || p.upTo >= n)) ctx.addIssue({ code: "custom", message: `upTo must be 1…${n - 1}`, path: ["upTo"] });
    if (p.yMin !== undefined && p.yMax !== undefined && p.yMin >= p.yMax) ctx.addIssue({ code: "custom", message: "yMin must be < yMax", path: ["yMin"] });
    if (p.thresholdLabel && p.threshold === undefined) ctx.addIssue({ code: "custom", message: "thresholdLabel needs a threshold", path: ["thresholdLabel"] });
    if (p.spikeLabel && p.spike === undefined) ctx.addIssue({ code: "custom", message: "spikeLabel needs a spike", path: ["spikeLabel"] });
  });

export type MetricChartPropsT = z.output<typeof MetricChartProps>;

export const METRIC_CHART = {
  defaultW: 896,
  minW: 640,
  maxW: 952,
  h: 480,
  pad: 32,
  border: 2,
  titlePx: 26,
  titleTop: 28,
  lineH: 32,
  axisPx: 26,
  /** Mono 26 advance (JetBrains Mono 0.6 em). */
  charW: 15.6,
  /** W2.1: 116 (was 96 — the top y label sat ~10 px under the title and read as its second line). The top label's
   *  glyph top (plotTop − yLabelLift − cap 19 px) now clears the title row (titleTop + lineH) by ≥ titleClear. */
  plotTop: 116,
  titleClear: 24,
  xLabelGap: 14,
  yLabelGap: 14,
  /** y labels sit above their gridline: text baseline this many px over the line (clears the x-label row). */
  yLabelLift: 8,
  lineW: 3,
  gridW: 1,
  thresholdW: 2,
  /** dash, gap (px); the gap stretches so the line starts and ends on a full dash. */
  thresholdDash: [12, 10],
  spikeR: 10,
  spikeRingR: 30,
  /** Label plates (threshold + spike labels): bgRaised, mono 26 text, 10 px side padding, 40 px tall, radius 8. */
  plateX: 10,
  plateH: 40,
  plateR: 8,
  /** Minimum gap between a label plate and the threshold line. */
  labelClear: 16,
  /** Draw-head dot radius (text colour) while the line draws. */
  headR: 6,
  /** Area fill: `text` at this opacity at the top of the plot, fading to 0 at the baseline. */
  areaTopOpacity: 0.06,
  drawF: 24,
  extendF: 18,
  /** Dim state: the breach band and the spike marker / OOMKilled plate drop to this opacity (the threshold label is
   *  already textDim at 0.5), so a dimmed chart keeps no red focal point. */
  dimChromaOp: 0.35,
  /** Panel settles (entrance spring) before the line starts. */
  drawDelayF: 6,
} as const;

/** "Nice" rounded-up maximum: 1 / 2 / 2.5 / 5 × 10^k. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * k >= v - 1e-9) return m * k;
  return 10 * k;
}

export function chartRange(p: Pick<MetricChartPropsT, "values" | "yMin" | "yMax" | "threshold">): { lo: number; hi: number } {
  const all = p.threshold !== undefined ? [...p.values, p.threshold] : p.values;
  const lo = p.yMin ?? Math.min(0, ...all);
  const hi = p.yMax ?? niceCeil(Math.max(...all) * 1.1 - lo) + lo;
  return { lo, hi: hi > lo ? hi : lo + 1 };
}

export const meta = {
  name: "MetricChart",
  version: 2,
  tier: "p0",
  spec: "R7 N-4",
  summary: "Line/area chart panel: greyscale series draws left → right, mono axes, dashed danger threshold, dangerBg incident window, danger spike marker.",
  families: ["outage", "systems", "science", "data"],
  propsSchema: MetricChartProps,
  propsSchemaName: "MetricChartProps",
  example: { title: "p99 latency · ms", values: [120, 130, 118, 140, 610, 980, 220, 135], unit: "ms", threshold: 500, spike: 5 },
  states: ["normal", "breach", "dim"],
  verbs: {
    enter: { durF: 13, does: "entrance spring, panel first (opaque before the axes / title show, content +3 f); the line then draws left → right over 24 f (unless a drawOn is scheduled)" },
    exit: { durF: 8, does: "content first: axes, series, danger marks and a breach border fade + blur 4 f on the opaque panel, then the panel fades 4 f" },
    drawOn: { durF: 24, does: "draw (or extend) the line to props.upTo (default: the last point): 24 f from empty, 18 f for an extension", props: ["upTo"] },
    state: { durF: 8, does: "normal / breach (border danger, threshold pulses 0.7↔1 / 20 f) / dim; may set a new threshold (draws on 12 f)", props: ["threshold", "thresholdLabel"] },
    mark: { durF: 10, does: "reveal the incident window (band wipes in 8 f) and/or the spike marker (pop + ring)", props: ["window", "spike", "spikeLabel"] },
    pulse: { durF: 12, does: "ring pulse on the spike marker" },
  },
  focal: true,
  footprint: (_p, w) => ({ w: Math.min(METRIC_CHART.maxW, Math.max(METRIC_CHART.minW, w ?? METRIC_CHART.defaultW)), h: METRIC_CHART.h }),
  sfx: { drawOn: "tick", mark: "thud", state: "tick" },
  // "self" (W2.1 r2, plateFade): the panel is the plate, opaque before / after everything drawn on it
  enterExit: "self",
} satisfies ComponentMetaDef<typeof MetricChartProps>;
