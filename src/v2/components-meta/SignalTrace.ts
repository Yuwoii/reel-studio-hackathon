// SignalTrace — W7 (spec research/notes/W7-library-spec.md §4.1, R7 N-13 Waveform). A generated, illustrative signal on
// a scope panel: a heartbeat in reflected light (PPG), noise + anti-noise = silence (ANC), a sampler missing the peak,
// a touch line crossing its threshold. Shapes are GENERATED from a few semantic props (never typed points), so the
// drawn cycle count is the spoken number: numeric `rate` × `span` decide the cycles (traceCycles, L53).
//
//   Heart rate                                [ 72 bpm ]     title sans 600 44 · rate chip mono 500 30 (pill)
//   ┌───────────────────────────────────────────────────┐
//   │  /\_      /\_      /\_      /\_      /\_      /\_  │     panel bgRaised2, 3 px traces, faint scope grid
//   │─/───\────/───\────/───\────/───\────/───\────/───\─│     baseline 1 px; window band; dashed threshold
//   └───────────────────────────────────────────────────┘
//   |──── 5 s ────|                          ILLUSTRATIVE     span bracket (lines) · honesty tag pill
//   ━ light at sensor   ━ filtered                            legend chips (only traces with a label + sum)
//
// States: raw · filtered (noise + drift → 0 over 18 f) · sampled (line dims, sample dots pop L→R, stepped
// reconstruction) · summed (combine sum: the result line draws on) · dim. Inner motion (sweep cursor) ≤ 5 px/f: no
// blur window, no flight. Renderer: remotion/v2/components/SignalTrace.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef, DrawnShape } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);
const Ref = z.string().regex(/^[a-z0-9-]{1,16}$/);
const Tag = z.enum(["illustrative", "notToScale", "simulated", "none"]);

export const TRACE_SHAPES = ["sine", "pulse", "ppg", "square", "saw", "noise", "flat", "step"] as const;

export const TraceDef = z
  .object({
    id: Ref,
    /** Generator, deterministic from (shape, cycles, phase; seeded by the shape, so an inverted twin cancels exactly).
     *  `ppg` = systolic peak + dicrotic notch. */
    shape: z.enum(TRACE_SHAPES),
    /** Visible periods across the panel. DERIVED (ignored) when the instance has numeric `rate` + `span` (L53). */
    cycles: z.number().min(0.5).max(12).default(3),
    /** Share of the half-height. */
    amp: z.number().min(0).max(1).default(0.7),
    phase: z.number().min(0).max(1).default(0),
    /** Anti-phase copy (noise cancelling). */
    invert: z.boolean().default(false),
    /** Seeded jitter, share of amp. */
    noise: z.number().min(0).max(1).default(0),
    /** Slow baseline wander (motion artefact). */
    drift: z.number().min(0).max(1).default(0),
    /** Legend chip. */
    label: z.string().min(1).max(16).optional(),
    tone: Tone.default("neutral"),
    /** Line style. Default (W7.1): with ≥ 2 traces a grey (neutral) trace is DASHED, so noise (grey dashed) and
     *  anti-noise (lime solid) stay separable where they overlap; set "solid" / "dashed" to force it. */
    line: z.enum(["solid", "dashed"]).optional(),
    /** W7.2 what a pulse-type trace (ppg / pulse) PLOTS, which decides the drawn direction of each beat:
     *  "absorbed" = light taken up by the blood (a beat is a PEAK); "returned" = light that comes back to the sensor
     *  (more blood absorbs more, so a beat is a DIP). Unset: "returned" when the label names light that comes back
     *  (returned / reflected / at the sensor / photodiode / detected), else "absorbed" (tracePolarity). */
    polarity: z.enum(["absorbed", "returned"]).optional(),
  })
  .strict();
export type TraceDefT = z.output<typeof TraceDef>;

export const SignalTraceProps = z
  .object({
    title: z.string().min(1).max(28),
    traces: z.array(TraceDef).min(1).max(3),
    /** overlay: lines on top of each other. sum: the `summed` state also draws trace0 + trace1 (+ trace2) as one line. */
    combine: z.enum(["overlay", "sum"]).default("overlay"),
    sumLabel: z.string().min(1).max(16).optional(),
    sumTone: Tone.default("accent"),
    /** Sampling (state `sampled`): n evenly spaced sample dots + the stepped reconstruction a sampler "sees". */
    samples: z.number().int().min(0).max(40).default(0),
    /** Tick over every peak of trace 0 (`highlight: k` rings peak k). */
    peaks: z.boolean().default(false),
    /** Peak index ringed in accent (mark / state may set it; needs peaks). */
    highlight: z.number().int().min(0).max(23).optional(),
    /** Monitor sweep: a `mark` with sweep true runs a 2 px cursor across the panel (≤ 5 px/f) that redraws the trace. */
    sweep: z.boolean().default(false),
    /** Highlighted x-window 0..1 ("motion here", "the moment the graph missed"). */
    window: z.object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1), tone: Tone.default("neutral") }).strict().optional(),
    /** Dashed horizontal line at this level (-1..1 of the half-height): a touch controller's detect threshold. */
    threshold: z.number().min(-1).max(1).optional(),
    thresholdLabel: z.string().min(1).max(14).optional(),
    /** W7.1 phase mark between trace 0 and trace 1: an arc over the traces from a peak of trace 0 to the matching peak
     *  of trace 1 (the shift along time) + a label chip.
     *  "auto" prints the COMPUTED offset ("180°" for an inverted twin; phaseDegrees). It draws on (12 f) when it first
     *  appears: set it on the keyword's state / mark so "180 degrees out of phase" lands on a visible change. */
    phaseMark: z.union([z.literal("auto"), z.string().min(1).max(10)]).optional(),
    /** W7.3 imperfect cancellation: the share of the noise an anti-phase twin (same shape, `invert` differs) does NOT
     *  cancel — the inverted trace is drawn at amp × (1 − residual), so the sum keeps a small wiggle. Unset: 0.12 on a
     *  `combine: "sum"` card with such a twin (real ANC leaves a residual), else 0. Set 0 ONLY when the source says
     *  the cancellation is total. A non-zero value below 0.12 is drawn at 0.12 (MIN_DRAWN_RESIDUAL: smaller reads as
     *  a flat line at card scale). */
    residual: z.number().min(0).max(0.5).optional(),
    /** Bottom-left span bracket label ("5 s", "1 ms", "time"). Numeric spans are L16-sourced unless tag != none. */
    span: z.string().min(1).max(12).optional(),
    /** Rate chip ("72 bpm", "60 Hz"). Numeric + a numeric span → drives every trace's `cycles` (rate × span). */
    rate: z.string().min(1).max(14).optional(),
    /** Rate chip + trace 0 when its own tone is neutral. */
    tone: Tone.default("neutral"),
    tag: Tag.default("illustrative"),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const t of p.traces) {
      if (ids.has(t.id)) ctx.addIssue({ code: "custom", path: ["traces"], message: `trace id "${t.id}" is used twice` });
      ids.add(t.id);
    }
    if (p.window && p.window.from >= p.window.to) ctx.addIssue({ code: "custom", path: ["window"], message: "window.from must be < window.to" });
    if (p.combine === "sum" && p.traces.length < 2) ctx.addIssue({ code: "custom", path: ["combine"], message: "combine \"sum\" needs ≥ 2 traces" });
    if (p.thresholdLabel && p.threshold === undefined) ctx.addIssue({ code: "custom", path: ["thresholdLabel"], message: "thresholdLabel needs a threshold" });
    if (p.highlight !== undefined && !p.peaks) ctx.addIssue({ code: "custom", path: ["highlight"], message: "highlight rings a peak: set peaks true" });
    if (p.phaseMark !== undefined && p.traces.length < 2) ctx.addIssue({ code: "custom", path: ["phaseMark"], message: "phaseMark compares trace 0 with trace 1: needs ≥ 2 traces" });
  });

export type SignalTracePropsT = z.output<typeof SignalTraceProps>;

export const SIGNAL_TRACE = {
  defaultW: 900,
  minW: 760,
  maxW: 952,
  pad: 36,
  border: 2,
  titlePx: 44,
  titleLh: 52,
  chipPx: 30,
  chipH: 52,
  chipPadX: 18,
  rowGap: 20,
  panelH: 340,
  panelRadius: 16,
  /** Trace inset inside the panel (x) and the half-height a value of ±1 spans. */
  insetX: 20,
  half: 120,
  /** Values are clamped here (sums of several traces). */
  clampV: 1.25,
  lineW: 3,
  sumW: 4,
  points: 360,
  rowH: 40,
  smallPx: 26,
  legendSwatch: 28,
  legendGap: 28,
  dotR: 7,
  ringR: 24,
  drawF: 24,
  drawDelayF: 4,
  morphF: 18,
  sampleStepF: 3,
  sweepPxPerF: 5,
  sweepMaxF: 180,
  sweepGap: 28,
  maxCycles: 12,
  /** Dashed (grey) trace pattern and opacity. */
  dash: "14 10",
  dashOpacity: 0.75,
  /** Phase arc: bulge (px right of the x), label chip, draw-on frames. */
  phaseBulge: 46,
  phasePx: 30,
  phaseChipH: 46,
  phaseDrawF: 12,
} as const;

const S = SIGNAL_TRACE;
const mono = (chars: number, px: number) => chars * px * 0.6;

/** Honesty tag text (shared by every W7 component). */
export const TAG_TEXT: Record<z.output<typeof Tag>, string> = { illustrative: "ILLUSTRATIVE", notToScale: "NOT TO SCALE", simulated: "SIMULATED", none: "" };

// ── number truth: rate × span → cycles (L53) ─────────────────────────────────────────────────────────────────────

/** Rate / time units (lower case) → factor to Hz / seconds. = Meter QTY_UNITS "rate" + "time" (test pins them equal;
 *  meta files cannot share runtime code). */
export const TRACE_RATE_UNITS: Record<string, number> = { bpm: 1 / 60, hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };
export const TRACE_TIME_UNITS: Record<string, number> = { ms: 1e-3, s: 1, sec: 1, secs: 1, seconds: 1, min: 60, mins: 60, h: 3600, hours: 3600, "µs": 1e-6, us: 1e-6 };
const NUM_RE = /(?<![\p{L}\p{N}_.])(\d+(?:[.,]\d+)?)\s*(µs|[A-Za-z]+)?/u;

function readQty(s: string | undefined, units: Record<string, number>): number | null {
  if (!s) return null;
  const m = NUM_RE.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  const f = units[(m[2] ?? "").toLowerCase()];
  return Number.isFinite(n) && f !== undefined ? n * f : null;
}

/** Rate in Hz from the rate chip ("72 bpm" → 1.2), null = not a frequency. */
export const rateHz = (rate: string | undefined) => readQty(rate, TRACE_RATE_UNITS);
/** Span in seconds ("5 s" → 5), null = not a time. */
export const spanSeconds = (span: string | undefined) => readQty(span, TRACE_TIME_UNITS);

/** Cycles derived from rate × span (uncapped), null = not derivable (each trace keeps its own `cycles`). */
export function derivedCycles(p: Pick<SignalTracePropsT, "rate" | "span">): number | null {
  const hz = rateHz(p.rate);
  const s = spanSeconds(p.span);
  return hz !== null && s !== null && hz * s > 0 ? hz * s : null;
}

/** THE cycle count drawn for trace i (renderer, digest and L53 all call this): rate × span when both parse, capped at
 *  12 (a GHz carrier is drawn at the cap and needs tag notToScale), else the trace's own `cycles`. */
export function traceCycles(p: Pick<SignalTracePropsT, "rate" | "span" | "traces">, i = 0): number {
  const d = derivedCycles(p);
  if (d !== null) return Math.min(S.maxCycles, Math.max(0.5, d));
  return p.traces[i]?.cycles ?? 3;
}

/** True when the drawn cycles are capped below the spoken rate × span (the picture is not to scale). */
export const cyclesCapped = (p: Pick<SignalTracePropsT, "rate" | "span">) => (derivedCycles(p) ?? 0) > S.maxCycles;

// ── W7.1 line identity: ONE tone / dash rule (renderer, legend, digest, L50 drawn tones) ────────────────────────────

/** Declared tone of trace i before the twin rule (a neutral trace 0 takes the instance tone when no other is coloured). */
function baseTone(p: Pick<SignalTracePropsT, "tone" | "traces">, i: number): "accent" | "danger" | "neutral" | "dim" {
  const t = p.traces[i];
  if (!t) return "neutral";
  if (t.tone !== "neutral") return t.tone;
  const othersColoured = p.traces.some((o, k) => k !== i && (o.tone === "accent" || o.tone === "danger"));
  return i === 0 && !othersColoured ? p.tone : "neutral";
}

/**
 * W7.3 twin identity: traces 0 and 1 of the same shape that would both draw grey (W7.2 anc: "NOISE" and "MIRROR WAVE"
 * both neutral → both grey dashed, indistinguishable where they overlap). The library separates them: the original is
 * grey DASHED, its twin (the inverted one; else trace 1) lime SOLID — noise vs anti-noise. null = no such pair.
 */
export function twinIdentity(p: Pick<SignalTracePropsT, "tone" | "traces">): { grey: number; lime: number } | null {
  const [a, b] = p.traces;
  if (!a || !b || a.shape !== b.shape || baseTone(p, 0) !== "neutral" || baseTone(p, 1) !== "neutral") return null;
  if (p.traces.slice(2).some((_, k) => baseTone(p, k + 2) === "accent")) return null;
  return a.invert && !b.invert ? { grey: 1, lime: 0 } : { grey: 0, lime: 1 };
}

/** Drawn tone of trace i. A neutral trace 0 takes the instance tone only when no other trace has its own accent / danger
 *  tone (W7.1: noise neutral + anti-noise accent used to draw BOTH lime; now the noise stays grey); a grey twin pair is
 *  split grey / lime (twinIdentity). */
export function traceTone(p: Pick<SignalTracePropsT, "tone" | "traces">, i: number): "accent" | "danger" | "neutral" | "dim" {
  const tw = twinIdentity(p);
  if (tw && i === tw.lime) return "accent";
  return baseTone(p, i);
}

/** W7.3 the tone trace i is DRAWN in at a state: while `summed` the inputs step back to dim ghosts (the sum is the
 *  card's one lime quantity; lints L61 / L50 read this, not the declared tone). */
export function drawnTraceTone(p: Pick<SignalTracePropsT, "tone" | "traces" | "combine">, i: number, state: string | null | undefined): "accent" | "danger" | "neutral" | "dim" {
  if (state === "dim") return "dim";
  if (state === "summed" && p.combine === "sum") return "dim";
  return traceTone(p, i);
}

/** Is trace i drawn dashed? A twin pair: grey dashed / lime solid (overrides `line`). Else explicit `line`, else: a grey
 *  trace among ≥ 2 traces. */
export function traceDashed(p: Pick<SignalTracePropsT, "tone" | "traces">, i: number): boolean {
  const t = p.traces[i];
  if (!t) return false;
  const tw = twinIdentity(p);
  if (tw && (i === tw.grey || i === tw.lime)) return i === tw.grey;
  if (t.line) return t.line === "dashed";
  return p.traces.length >= 2 && traceTone(p, i) === "neutral";
}

/** Default residual of an anti-phase twin on a sum card (share of the noise left over). */
export const DEFAULT_RESIDUAL = 0.12;

/** Index of the anti-phase partner of trace 0 / 1 (same shape, cycles, phase, `invert` differs), null = none. */
export function antiPhasePair(p: Pick<SignalTracePropsT, "traces">): { orig: number; anti: number } | null {
  const [a, b] = p.traces;
  if (!a || !b || a.shape !== b.shape || a.invert === b.invert || a.phase !== b.phase) return null;
  return a.invert ? { orig: 1, anti: 0 } : { orig: 0, anti: 1 };
}

/** 2026-11-03 (anc 38 s / 57 s review): the smallest residual that still DRAWS as a visible wiggle at card scale
 *  (0.12 × amp 0.7 × 120 px ≈ 10 px). A non-zero residual below it is drawn (and reported) at this floor; 0 stays the
 *  total cancellation a source must state. */
export const MIN_DRAWN_RESIDUAL = DEFAULT_RESIDUAL;

/** The residual in force: explicit (non-zero floored at MIN_DRAWN_RESIDUAL), else DEFAULT_RESIDUAL on a sum card with
 *  an anti-phase twin, else 0. */
export function traceResidual(p: Pick<SignalTracePropsT, "traces" | "combine" | "residual">): number {
  if (!antiPhasePair(p)) return 0;
  const r = p.residual ?? (p.combine === "sum" ? DEFAULT_RESIDUAL : 0);
  return r > 0 ? Math.max(r, MIN_DRAWN_RESIDUAL) : 0;
}

/** Trace i as DRAWN: an anti-phase twin's amp scaled by (1 − residual). Renderer, sum, digest and lints read this. */
export function drawnTrace(p: Pick<SignalTracePropsT, "traces" | "combine" | "residual">, i: number): TraceDefT {
  const t = p.traces[i];
  const pair = antiPhasePair(p);
  const r = traceResidual(p);
  return pair && pair.anti === i && r > 0 ? { ...t, amp: t.amp * (1 - r) } : t;
}

/** Trace ids whose `invert` differs between two props (same shape): a W7.3 FLIP (the renderer mirrors the trace about
 *  its baseline, the digest prints "flip"). */
export function flippedTraces(prev: Pick<SignalTracePropsT, "traces">, next: Pick<SignalTracePropsT, "traces">): number[] {
  const out: number[] = [];
  next.traces.forEach((t, i) => {
    const o = prev.traces[i];
    if (o && o.id === t.id && o.shape === t.shape && !!o.invert !== !!t.invert) out.push(i);
  });
  return out;
}

/** Phase offset of trace 1 against trace 0 in degrees (0–359), null = not comparable (different shape or cycles). */
export function phaseDegrees(p: Pick<SignalTracePropsT, "traces" | "rate" | "span">): number | null {
  const [a, b] = p.traces;
  if (!a || !b || a.shape !== b.shape || traceCycles(p, 0) !== traceCycles(p, 1)) return null;
  const deg = (b.phase - a.phase) * 360 + (a.invert !== b.invert ? 180 : 0);
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
}

/** The phase chip text ("180°"), null = no phase mark. "auto" with incomparable traces prints "phase". */
export function phaseText(p: Pick<SignalTracePropsT, "traces" | "rate" | "span" | "phaseMark">): string | null {
  if (p.phaseMark === undefined) return null;
  if (p.phaseMark !== "auto") return p.phaseMark;
  const d = phaseDegrees(p);
  return d === null ? "phase" : `${Math.round(d)}°`;
}

// ── deterministic generators ─────────────────────────────────────────────────────────────────────────────────────

/** 32-bit string hash → 0..1 (FNV-1a + a mix), stable across platforms. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
const gauss = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd));
/** Asymmetric bump: rise sd `a`, fall sd `b`. */
const bump = (x: number, mu: number, a: number, b: number) => gauss(x, mu, x < mu ? a : b);

/** The clean periodic shape at x (0..1 across the panel), in -1..1. */
export function shapeAt(shape: (typeof TRACE_SHAPES)[number], x: number, cycles: number, phase: number, seed: string): number {
  const u = frac(x * cycles + phase);
  switch (shape) {
    case "sine":
      return Math.sin(TAU * (x * cycles + phase));
    case "pulse":
      return -1 + 2 * bump(u, 0.3, 0.03, 0.045);
    case "ppg":
      // systolic upstroke (fast), slower fall, dicrotic notch then a smaller diastolic bump
      return -1 + 2 * Math.max(bump(u, 0.2, 0.05, 0.11), 0.42 * bump(u, 0.5, 0.06, 0.09));
    case "square":
      return Math.tanh(9 * Math.sin(TAU * (x * cycles + phase)));
    case "saw":
      return 2 * u - 1;
    case "step": {
      // low, then a smooth rise at `phase` (default mid-panel) and it stays up: a threshold crossing
      const at = phase > 0 ? phase : 0.5;
      return -0.6 + 1.2 / (1 + Math.exp(-(x - at) * 60));
    }
    case "noise": {
      // band-limited seeded noise: 5 incommensurate sines (cycles sets the busiest one)
      let v = 0;
      let n = 0;
      for (let k = 1; k <= 5; k++) {
        const fq = cycles * (0.45 + 0.37 * k + 0.6 * hash01(`${seed}:f${k}`));
        v += Math.sin(TAU * (x * fq + hash01(`${seed}:p${k}`) + phase)) / k;
        n += 1 / k;
      }
      return (v / n) * 1.6;
    }
    case "flat":
    default:
      return 0;
  }
}

/** Seeded high-frequency jitter in -1..1 (the `noise` prop). */
function jitter(x: number, seed: string): number {
  let v = 0;
  for (let k = 0; k < 4; k++) v += Math.sin(TAU * (x * (31 + 17 * k + 11 * hash01(`${seed}:j${k}`)) + hash01(`${seed}:q${k}`)));
  return v / 2.6;
}

/** Slow baseline wander in -1..1 (the `drift` prop). */
function wander(x: number, seed: string): number {
  return 0.7 * Math.sin(TAU * (0.55 * x + hash01(`${seed}:d0`))) + 0.3 * Math.sin(TAU * (1.7 * x + hash01(`${seed}:d1`)));
}

/** Shapes whose beats have a drawn direction (polarity applies). */
export const PULSE_SHAPES: readonly string[] = ["ppg", "pulse"];
/** A trace label that names light coming BACK to a sensor (W7.1 pilot: "RETURNED LIGHT" drawn as a rise was wrong). */
const RETURNED_RE = /\b(?:return(?:ed|s|ing)?|reflect(?:ed|s|ion)?|back|reach(?:es|ing)?|received?|detected|photodiode|at (?:the )?(?:sensor|detector|diode))\b/i;

/** What a pulse-type trace plots (null = the shape has no beat direction). Explicit `polarity`, else the label. */
export function tracePolarity(t: Pick<TraceDefT, "shape" | "polarity" | "label">): "absorbed" | "returned" | null {
  if (!PULSE_SHAPES.includes(t.shape)) return null;
  if (t.polarity) return t.polarity;
  return t.label && RETURNED_RE.test(t.label) ? "returned" : "absorbed";
}

/** Drawn direction of each beat of trace t: "dip" (returned light, or an inverted absorbed copy) or "rise"; null =
 *  not a pulse-type trace. Renderer, peaks, digest and the physics judge's input all read this. */
export function beatDirection(t: Pick<TraceDefT, "shape" | "polarity" | "label" | "invert">): "rise" | "dip" | null {
  const pol = tracePolarity(t);
  if (pol === null) return null;
  return (pol === "returned") !== t.invert ? "dip" : "rise";
}

/**
 * Value of trace `t` at x (0..1), in half-height units (amp included, invert applied). `clean` 0..1 removes noise and
 * drift (the `filtered` morph); `cycles` = traceCycles(). Pure.
 */
export function traceValue(t: TraceDefT, x: number, cycles: number, clean = 0): number {
  // seeded by the SHAPE (not the id): an `invert` copy with the same shape / cycles / phase / noise / drift is the exact
  // mirror image, so noise + anti-noise sums to a flat line (L53c)
  const seed = t.shape;
  // W7.2 polarity: returned light DIPS on every beat (more blood → more absorbed → less light back)
  let v = shapeAt(t.shape, x, cycles, t.phase, seed) * t.amp * (tracePolarity(t) === "returned" ? -1 : 1);
  const keep = 1 - Math.min(1, Math.max(0, clean));
  if (keep > 0 && t.noise > 0) v += jitter(x, seed) * t.noise * 0.45 * Math.max(0.35, t.amp) * keep;
  if (keep > 0 && t.drift > 0) v += wander(x, seed) * t.drift * 0.55 * keep;
  return t.invert ? -v : v;
}

/** Sum of every trace at x (combine sum), as drawn (an anti-phase twin at its residual amp). */
export function sumValue(p: Pick<SignalTracePropsT, "traces" | "rate" | "span"> & Partial<Pick<SignalTracePropsT, "combine" | "residual">>, x: number, clean = 0): number {
  const q = { combine: p.combine ?? "overlay", residual: p.residual, traces: p.traces };
  return p.traces.reduce((a, _t, i) => a + traceValue(drawnTrace(q, i), x, traceCycles(p, i), clean), 0);
}

const xs = (n: number) => Array.from({ length: n }, (_, i) => i / (n - 1));

/** Max |sum| over the panel (L53c: "silence" needs < 0.1). */
export function sumFlatness(p: Pick<SignalTracePropsT, "traces" | "rate" | "span"> & Partial<Pick<SignalTracePropsT, "combine" | "residual">>, clean = 1): number {
  return Math.max(...xs(S.points).map((x) => Math.abs(sumValue(p, x, clean))));
}

/** Sample positions 0..1 (cell centres) for n samples. */
export const samplePositions = (n: number) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);

/**
 * L53b: the sampled reconstruction's max over the true trace-0 max inside the panel (or the window): < 0.8 = the
 * sampler misses the peak. 1 when there are no samples. Clean (filtered) signal.
 */
export function sampledMax(p: Pick<SignalTracePropsT, "traces" | "rate" | "span" | "samples" | "window">): number {
  if (!p.samples) return 1;
  const t = p.traces[0];
  const c = traceCycles(p, 0);
  const lo = p.window?.from ?? 0;
  const hi = p.window?.to ?? 1;
  const inside = (x: number) => x >= lo && x <= hi;
  const trueMax = Math.max(...xs(S.points).filter(inside).map((x) => traceValue(t, x, c, 1)));
  const samp = samplePositions(p.samples).filter(inside).map((x) => traceValue(t, x, c, 1));
  if (!samp.length) return 0;
  const base = Math.min(...xs(S.points).map((x) => traceValue(t, x, c, 1)));
  const span = trueMax - base;
  return span <= 1e-9 ? 1 : (Math.max(...samp) - base) / span;
}

/** Peak x positions (0..1) of trace 0's clean signal: local maxima above the midpoint of its range. */
export function tracePeaks(p: Pick<SignalTracePropsT, "traces" | "rate" | "span">): number[] {
  const t = p.traces[0];
  const c = traceCycles(p, 0);
  const n = 720;
  // beats of a dipping trace are its minima (a "peak" = a beat, so a ring / callout lands on the dip)
  const sign = beatDirection(t) === "dip" ? -1 : 1;
  const v = Array.from({ length: n }, (_, i) => sign * traceValue({ ...t, noise: 0, drift: 0 }, i / (n - 1), c, 1));
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  if (hi - lo < 1e-6) return [];
  const cut = lo + 0.55 * (hi - lo);
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) if (v[i] >= cut && v[i] > v[i - 1] && v[i] >= v[i + 1]) out.push(i / (n - 1));
  return out;
}

// ── layout ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LegendEntry {
  text: string;
  /** Trace index, or -1 = the sum line. */
  trace: number;
  w: number;
}

export function signalLegend(p: Pick<SignalTracePropsT, "traces" | "combine" | "sumLabel">): LegendEntry[] {
  const out: LegendEntry[] = [];
  p.traces.forEach((t, i) => {
    if (t.label) out.push({ text: t.label, trace: i, w: Math.ceil(S.legendSwatch + 10 + mono(t.label.length, S.smallPx)) });
  });
  if (p.combine === "sum" && p.sumLabel) out.push({ text: p.sumLabel, trace: -1, w: Math.ceil(S.legendSwatch + 10 + mono(p.sumLabel.length, S.smallPx)) });
  return out;
}

const chipW = (rate: string | undefined) => (rate ? Math.ceil(mono(rate.length, S.chipPx) + 2 * S.chipPadX + 2) : 0);
const tagW = (tag: SignalTracePropsT["tag"]) => (tag === "none" ? 0 : Math.ceil(mono(TAG_TEXT[tag].length, S.smallPx) + 2 * 12 + 2));
/** Span bracket width: the text + two 40 px arms + end ticks. */
export const spanW = (span: string | undefined) => (span ? Math.ceil(mono(span.length, S.smallPx) + 2 * 52) : 0);

/** Does the rate chip fit on the title row (else it moves to the legend row)? */
function chipOnTop(p: Pick<SignalTracePropsT, "title" | "rate">, w: number): boolean {
  return !p.rate || p.title.length * S.titlePx * 0.62 + 24 + chipW(p.rate) <= w - 2 * S.pad;
}

/** The honesty tag sits on the title row when no rate chip does and it fits, else on the legend row (own row if the
 *  legend is full). */
function tagPlace(p: SignalTracePropsT, w: number): "title" | "legend" | "own" | null {
  if (p.tag === "none") return null;
  const inner = w - 2 * S.pad;
  const top = chipOnTop(p, w);
  if (!(p.rate && top) && p.title.length * S.titlePx * 0.62 + 24 + tagW(p.tag) <= inner) return "title";
  const row = legendRowW(p, w);
  return row + (row ? 24 : 0) + tagW(p.tag) <= inner ? "legend" : "own";
}

/** Width of the legend row's left part: legend entries (+ the rate chip when it is not on the title row). */
function legendRowW(p: SignalTracePropsT, w: number): number {
  const items = signalLegend(p).map((e) => e.w);
  if (p.rate && !chipOnTop(p, w)) items.push(chipW(p.rate));
  return items.length ? items.reduce((a, x) => a + x, 0) + (items.length - 1) * S.legendGap : 0;
}

export function signalTraceMinWidth(p: SignalTracePropsT): number {
  const inner = Math.max(
    p.title.length * S.titlePx * 0.62,
    spanW(p.span),
    signalLegend(p).reduce((a, e) => a + e.w + S.legendGap, -S.legendGap) + (p.rate ? S.legendGap + chipW(p.rate) : 0),
    tagW(p.tag),
  );
  return Math.ceil(Math.max(S.minW, inner + 2 * S.pad));
}

export function signalTraceWidth(p: SignalTracePropsT, w: number | undefined): number {
  return Math.min(S.maxW, Math.max(w ?? S.defaultW, signalTraceMinWidth(p)));
}

/** Rows (y, footprint-relative) for these props at width w: title · panel · span bracket (full panel width) · legend
 *  row (legend entries, a rate chip that did not fit the title row, the tag) · an own tag row when the legend is full. */
export function signalTraceLayout(p: SignalTracePropsT, w: number) {
  const top = chipOnTop(p, w);
  const tag = tagPlace(p, w);
  const legend = signalLegend(p);
  const titleY = S.pad;
  const panelY = titleY + S.titleLh + S.rowGap;
  let y = panelY + S.panelH;
  const spanY = p.span ? y + 14 : null;
  if (spanY !== null) y = spanY + S.rowH;
  const hasLegendRow = legend.length > 0 || (!!p.rate && !top) || tag === "legend";
  const legendY = hasLegendRow ? y + (spanY !== null ? 10 : S.rowGap) : null;
  if (legendY !== null) y = legendY + S.rowH;
  const tagY = tag === "own" ? y + 10 : null;
  if (tagY !== null) y = tagY + S.rowH;
  return { titleY, panelY, spanY, legendY, tagY, tag, chipTop: top, h: Math.ceil(y + S.pad), legend, bottomY: legendY };
}

/** Panel point for x (0..1) and a value v (half-height units). */
export function tracePoint(w: number, panelY: number, x: number, v: number): { x: number; y: number } {
  const x0 = S.pad + S.insetX;
  const x1 = w - S.pad - S.insetX;
  const cv = Math.max(-S.clampV, Math.min(S.clampV, v));
  return { x: x0 + x * (x1 - x0), y: panelY + S.panelH / 2 - cv * S.half };
}

/** Phase-arc geometry (footprint-relative): the phase is a SHIFT along time, so the arc arches over the traces from a
 *  peak of trace 0 (the one nearest the panel's 35 % mark) to the matching peak of trace 1, (degrees / 360) of a period
 *  later; the chip sits beside the arc's end. Both peak points + the chip box; null = no phase mark. Shared by the
 *  renderer, shape() and the tests. */
export function phaseArc(p: SignalTracePropsT, w: number, panelY: number): { x0: number; x1: number; yPeak0: number; yPeak1: number; apexY: number; chip: { x: number; y: number; w: number; h: number }; text: string } | null {
  const text = phaseText(p);
  if (text === null || p.traces.length < 2) return null;
  const peaks = tracePeaks(p);
  const px = peaks.length ? peaks.reduce((a, b) => (Math.abs(b - 0.35) < Math.abs(a - 0.35) ? b : a)) : 0.35;
  const deg = phaseDegrees(p) ?? 0;
  const px1 = Math.min(1, px + deg / 360 / Math.max(0.5, traceCycles(p, 1)));
  const v = (i: number, x: number) => traceValue({ ...drawnTrace(p, i), noise: 0, drift: 0 }, x, traceCycles(p, i), 1);
  const a = tracePoint(w, panelY, px, v(0, px));
  const b = tracePoint(w, panelY, px1, v(1, px1));
  const apexY = panelY + 22;
  const cw = Math.ceil(mono(text.length, S.phasePx) + 2 * 14 + 4);
  const right = w - S.pad - 12;
  const cx = b.x + 18 + cw <= right ? b.x + 18 : Math.max(S.pad + 12, a.x - 18 - cw);
  return { x0: a.x, x1: b.x, yPeak0: a.y, yPeak1: b.y, apexY, chip: { x: cx, y: apexY - 4, w: cw, h: S.phaseChipH }, text };
}

export const meta = {
  name: "SignalTrace",
  version: 4,
  tier: "p0",
  spec: "W7 library spec §4.1 (R7 N-13 Waveform)",
  summary: "Scope panel with 1–3 GENERATED traces: raw → filtered (noise + drift melt) → sampled (dots + steps, can miss the peak) → summed (noise + inverted copy → small residual, 0 = total only if the source says so; inputs dim, the sum is the one lime line); a state action toggling a trace's invert FLIPS it (axis + arrow held); rate × span sets the drawn cycles (72 bpm × 5 s = 6 beats); grey beside coloured is DASHED (a grey twin pair: original grey dashed, twin lime solid); ppg / pulse beats PEAK for absorbed light, DIP for returned light (polarity); phaseMark \"auto\" arcs a peak to its twin with the computed \"180°\"; peak ticks + ring, threshold, window, sweep; honesty tag.",
  families: ["science", "data", "network", "systems"],
  propsSchema: SignalTraceProps,
  propsSchemaName: "SignalTraceProps",
  example: { title: "Heart rate", traces: [{ id: "ppg", shape: "ppg", label: "light at sensor" }], rate: "72 bpm", span: "5 s", tone: "accent", peaks: true },
  states: ["raw", "filtered", "sampled", "summed", "dim", "final"],
  verbs: {
    enter: { durF: 13, does: "plate-first entrance (plateFade); with no drawOn action the traces draw L→R 4 f after the entrance (24 f)" },
    exit: { durF: 8, does: "content fades + blurs 4 f on the opaque plate, then the plate 4 f" },
    drawOn: { durF: 24, does: "every trace draws left → right through a mask (bible ease, 24 f); the traces stay empty until the first drawOn when the instance has one" },
    state: {
      durF: 18,
      does: "raw: traces as generated · filtered: noise + drift melt to 0 over 18 f (same x grid) · sampled: the line dims to 0.35, sample dots pop L→R 3 f apart with the stepped reconstruction in trace-0 tone (a peak between samples stays visible only as the faint line) · summed: the sum line draws on over 18 f (a small residual wiggle unless residual 0), the inputs dim to ghosts · flip (W7.3): a `traces` override that toggles one trace's invert mirrors it about the baseline over 14 f, with the mirror axis + a flip arrow held until the next change · dim: everything textDim. A `traces` override morphs point-wise over 18 f; a new rate scrambles · final (CTA): back to the last live (non idle / dim) state with its props, so 'Follow' lands on the climax picture",
      props: ["traces", "window", "rate", "samples", "sumLabel", "sumTone", "highlight", "threshold", "thresholdLabel", "phaseMark", "residual"],
    },
    mark: { durF: 12, does: "props.highlight k rings peak k (accent ring + pop, 10 f); props.sweep true runs a monitor sweep cursor across the panel at 5 px/f that redraws the trace behind it (≤ 180 f, no blur); props.phaseMark draws the phase arc + chip (12 f)", props: ["highlight", "sweep", "phaseMark"] },
    pulse: { durF: 12, does: "one glow on trace 0 (a heartbeat accent)" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    scramble: { durF: 8, does: "the rate chip rolls to its value (e.g. -- bpm → 72 bpm)", props: ["rate"] },
  },
  focal: true,
  footprint: (p, w) => {
    const W = signalTraceWidth(p, w);
    return { w: W, h: signalTraceLayout(p, W).h };
  },
  contentBox: (p, w) => {
    const W = signalTraceWidth(p, w);
    return { x: 0, y: 0, w: W, h: signalTraceLayout(p, W).h };
  },
  shape: (p, w): DrawnShape => {
    const W = signalTraceWidth(p, w);
    const L = signalTraceLayout(p, W);
    const parts: DrawnShape["parts"] = [{ part: "", x: 0, y: 0, w: W, h: L.h }, { part: "panel", x: S.pad, y: L.panelY, w: W - 2 * S.pad, h: S.panelH }];
    p.traces.forEach((t) => parts.push({ part: `trace:${t.id}`, x: S.pad, y: L.panelY, w: W - 2 * S.pad, h: S.panelH }));
    tracePeaks(p).forEach((x, k) => {
      const pt = tracePoint(W, L.panelY, x, traceValue({ ...p.traces[0], noise: 0, drift: 0 }, x, traceCycles(p, 0), 1));
      parts.push({ part: `peak:${k}`, x: pt.x - S.ringR, y: pt.y - S.ringR, w: 2 * S.ringR, h: 2 * S.ringR });
    });
    if (p.window) {
      const a = tracePoint(W, L.panelY, p.window.from, 0).x;
      const b = tracePoint(W, L.panelY, p.window.to, 0).x;
      parts.push({ part: "window", x: a, y: L.panelY, w: b - a, h: S.panelH });
    }
    const ph = phaseArc(p, W, L.panelY);
    if (ph) {
      const x0 = Math.min(ph.x0, ph.chip.x) - 8;
      const x1 = Math.max(ph.x1, ph.chip.x + ph.chip.w) + 8;
      parts.push({ part: "phase", x: x0, y: ph.apexY - 8, w: x1 - x0, h: Math.max(ph.yPeak0, ph.yPeak1) - ph.apexY + 16 });
    }
    if (p.rate) {
      const cw = chipW(p.rate);
      parts.push(L.chipTop ? { part: "rate", x: W - S.pad - cw, y: L.titleY, w: cw, h: S.chipH } : { part: "rate", x: S.pad, y: L.legendY ?? L.panelY, w: cw, h: S.rowH });
    }
    return { parts };
  },
  sfx: { drawOn: "whoosh", mark: "tick", scramble: "chatter", state: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof SignalTraceProps>;
