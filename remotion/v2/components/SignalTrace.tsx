// SignalTrace renderer (W7 spec §4.1). Meta: src/v2/components-meta/SignalTrace.ts.
//
// Opaque bgRaised plate (radius.card, 2 px borderStrong) → title row (sans 600 44 + rate chip) → scope panel
// (bgRaised2, faint 10 × 4 grid, 1 px baseline) with the generated traces (3 px, round joins) → bottom row (span
// bracket drawn as lines + the honesty tag) → legend chips. Every value comes from the meta's pure generators
// (traceValue / traceCycles / sampledMax / tracePeaks), so the digest and the lints read what is drawn.
// Motion: draw-on through the shared DrawPath mask (bible ease), filtered morph 18 f, sample dots 3 f apart, sum line
// 18 f, sweep cursor 5 px/f (< blur.minPxPerF: no blur window). Colours snap; tokens only. enterExit "self" (plateFade).
import React from "react";
import { interpolate } from "remotion";
import {
  beatDirection,
  drawnTrace,
  drawnTraceTone,
  flippedTraces,
  meta,
  phaseArc,
  samplePositions,
  SIGNAL_TRACE,
  signalTraceLayout,
  sumValue,
  TAG_TEXT,
  traceCycles,
  tracePeaks,
  traceDashed,
  tracePoint,
  traceTone,
  traceValue,
  type SignalTracePropsT,
  type TraceDefT,
} from "../../../src/v2/components-meta/SignalTrace";
import { clampX, drawOn, easeBible, flash, pulse, scramble } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps, type TrackEvent } from "./contract";
import { plateFade } from "./plateFade";
import { DrawPath } from "./primitives";

const S = SIGNAL_TRACE;
const TONE: Record<string, ColorToken> = { accent: "accent", danger: "danger", neutral: "text", dim: "textDim" };
const GLOW: Record<string, ColorToken> = { accent: "markAccent", danger: "markDanger", neutral: "borderStrong", dim: "border" };
const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Filter amount (0 = raw, 1 = filtered) at frame: walks the state changes, morphing 18 f toward the latest target. */
export function cleanAt(events: readonly TrackEvent[], frame: number): number {
  let v = 0;
  for (const e of events) {
    if (e.f > frame) break;
    if (e.do !== "state" || !e.state) continue;
    const target = e.state === "filtered" ? 1 : e.state === "raw" ? 0 : null;
    if (target === null) continue;
    const from = v;
    v = from + (target - from) * easeBible(clamp01((frame - e.f) / S.morphF));
  }
  return v;
}

/** Colour token of trace i (meta traceTone: a neutral trace 0 takes the instance tone only when no other trace is
 *  coloured). */
export function traceToken(p: Pick<SignalTracePropsT, "tone" | "traces">, _t: TraceDefT, i: number, dim: boolean): ColorToken {
  if (dim) return "textDim";
  return TONE[traceTone(p, i)] ?? "text";
}

/** W7.3 flip: frames of the mirror motion when a state override toggles a trace's invert. */
export const FLIP_F = 14;

/** Draw progress 0..1 of the traces at frame (drawOn actions; else one draw after the entrance; none = drawn). */
export function traceDraw(events: readonly TrackEvent[], enterF: number | null, frame: number): number {
  const d = events.filter((e) => e.do === "drawOn");
  if (d.length) {
    const last = [...d].reverse().find((e) => e.f <= frame);
    return last ? drawOn(frame, last.f, S.drawF) : 0;
  }
  return enterF === null ? 1 : drawOn(frame, enterF + S.drawDelayF, S.drawF);
}

/** First frame the sum line may draw (state `summed` entered at `stateF`): not before the traces are fully drawn
 *  (the latest drawOn ≤ that frame + drawF, else the entrance draw). -Infinity = no constraint (initial state). */
export function summedStartF(events: readonly TrackEvent[], enterF: number | null, stateF: number | null): number {
  const at = stateF ?? -Infinity;
  const d = events.filter((e) => e.do === "drawOn");
  let done = -Infinity;
  if (d.length) {
    const lastD = [...d].reverse().find((e) => e.f <= Math.max(at, d[0].f));
    done = (lastD ?? d[0]).f + S.drawF;
  } else if (enterF !== null) done = enterF + S.drawDelayF + S.drawF;
  return Math.max(at, done);
}

/** Cursor x (0..1) of the latest sweep mark, null = no sweep in flight. */
export function sweepAt(p: Pick<RenderProps<SignalTracePropsT>, "props" | "events" | "size">, frame: number): number | null {
  if (!p.props.sweep) return null;
  const m = [...p.events].reverse().find((e) => e.do === "mark" && e.f <= frame && (e.props?.sweep === true || (e.props?.sweep === undefined && p.props.sweep)));
  if (!m) return null;
  const pw = p.size.w - 2 * S.pad - 2 * S.insetX;
  const x = ((frame - m.f) * S.sweepPxPerF) / pw;
  return frame - m.f > S.sweepMaxF || x > 1 ? null : x;
}

const path = (pts: { x: number; y: number }[]) => pts.map((q, i) => `${i ? "L" : "M"} ${r1(q.x)} ${r1(q.y)}`).join(" ");

/** Values of trace i at the panel's x grid, morphing from the previous props over 18 f after a traces override. */
function traceValues(p: RenderProps<SignalTracePropsT>, i: number, clean: number): number[] {
  const n = S.points;
  const cur = p.props.traces[i] ? drawnTrace(p.props, i) : undefined;
  const old = p.prev.traces[i] ? drawnTrace(p.prev, i) : undefined;
  // a flip (invert toggled) mirrors the trace about its baseline: the point-wise morph old → −old IS the mirror motion
  const flip = p.changeF !== null && flippedTraces(p.prev, p.props).includes(i);
  const dur = flip ? FLIP_F : S.morphF;
  const k = p.changeF !== null && old && (p.prev.traces !== p.props.traces || p.prev.residual !== p.props.residual) ? easeBible(clamp01((p.frame - p.changeF) / dur)) : 1;
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const x = j / (n - 1);
    const a = cur ? traceValue(cur, x, traceCycles(p.props, i), clean) : 0;
    const b = k < 1 && old ? traceValue(old, x, traceCycles(p.prev, i), clean) : a;
    out.push(b + (a - b) * k);
  }
  return out;
}

const Render: React.FC<RenderProps<SignalTracePropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const { w, h } = p.size;
  const P = p.props;
  const L = signalTraceLayout(p.base, w);
  const st = p.state.name;
  const dim = st === "dim";
  const clean = cleanAt(p.events, p.frame);
  const draw = traceDraw(p.events, p.enterF, p.frame);
  const kick = flash(p.frame, p.last("focus"), 4);
  const glow = flash(p.frame, p.last("pulse"), 5);
  const pt = (x: number, v: number) => tracePoint(w, L.panelY, x, v);
  const px0 = S.pad + S.insetX;
  const px1 = w - S.pad - S.insetX;
  const sampled = st === "sampled";
  // 2026-11-03 (anc 37 s): the sum never starts before the inputs are fully drawn — a sum line racing ahead of
  // half-drawn, already-dimmed inputs read as an empty panel. Until then the card shows the inputs as in `raw`.
  const sumStartF = summedStartF(p.events, p.enterF, p.state.f);
  const summed = st === "summed" && P.combine === "sum" && p.frame >= sumStartF;
  const stDrawn = st === "summed" && !summed ? "raw" : st;
  const sweep = sweepAt(p, p.frame);

  // ── traces ──
  const lines: React.ReactNode[] = [];
  const n = S.points;
  P.traces.forEach((t, i) => {
    const v = traceValues(p, i, clean);
    const pts = v.map((y, j) => pt(j / (n - 1), y));
    // W7.3: while summed the inputs are dim ghosts (the sum is the card's one lime line); dash keeps them apart
    const tok: ColorToken = TONE[drawnTraceTone(P, i, dim ? "dim" : stDrawn)] ?? "text";
    const dashed = traceDashed(P, i);
    const op = summed ? 0.3 : sampled && i === 0 ? 0.35 : dashed ? S.dashOpacity : i > 0 && traceTone(P, i) === "neutral" ? 0.5 : 1;
    const shadow = i === 0 && glow > 0 ? `drop-shadow(0 0 ${r1(10 * glow)}px ${color[GLOW[traceTone(P, 0)] ?? "markAccent"]})` : undefined;
    const dash = dashed ? S.dash : undefined;
    if (sweep !== null) {
      // monitor sweep: the trace is redrawn behind the cursor; a short gap ahead of it is erased
      const gx = S.sweepGap / (px1 - px0);
      const behind = pts.filter((_, j) => j / (n - 1) <= sweep);
      const ahead = pts.filter((_, j) => j / (n - 1) >= sweep + gx);
      lines.push(
        <g key={`t${i}`} style={{ opacity: op, filter: shadow }}>
          {behind.length > 1 ? <path d={path(behind)} fill="none" stroke={color[tok]} strokeWidth={S.lineW} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash} /> : null}
          {ahead.length > 1 ? <path d={path(ahead)} fill="none" stroke={color[tok]} strokeWidth={S.lineW} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash} opacity={0.45} /> : null}
        </g>,
      );
    } else {
      lines.push(
        <g key={`t${i}`} style={{ opacity: op, filter: shadow }} strokeLinejoin="round">
          <DrawPath d={path(pts)} progress={draw} id={`${p.id}-tr-${i}`} stroke={tok} strokeWidth={S.lineW} dash={dash} />
        </g>,
      );
    }
  });

  // ── sum line (state summed) ──
  let sumEl: React.ReactNode = null;
  if (summed) {
    const pts = Array.from({ length: n }, (_, j) => pt(j / (n - 1), sumValue(P, j / (n - 1), clean)));
    const prog = drawOn(p.frame, Number.isFinite(sumStartF) ? sumStartF : 0, S.morphF);
    sumEl = <DrawPath d={path(pts)} progress={prog} id={`${p.id}-sum`} stroke={dim ? "textDim" : TONE[P.sumTone]} strokeWidth={S.sumW} />;
  }

  // ── samples (state sampled) ──
  let sampleEl: React.ReactNode = null;
  if (sampled && P.samples > 0) {
    const t0 = P.traces[0];
    const c0 = traceCycles(P, 0);
    const tok = traceToken(P, t0, 0, dim);
    const sx = samplePositions(P.samples);
    const at = p.state.f ?? 0;
    const shown = sx.filter((_, k) => p.f >= at + k * S.sampleStepF).length;
    const vals = sx.map((x) => traceValue(t0, x, c0, clean));
    // stepped (sample-and-hold) reconstruction through the popped samples
    const steps: { x: number; y: number }[] = [];
    for (let k = 0; k < shown; k++) {
      const a = pt(k === 0 ? 0 : (sx[k - 1] + sx[k]) / 2, vals[k]);
      const b = pt(k === sx.length - 1 ? 1 : (sx[k] + sx[k + 1]) / 2, vals[k]);
      if (k > 0) steps.push({ x: a.x, y: pt(0, vals[k - 1]).y });
      steps.push(a, b);
    }
    sampleEl = (
      <g>
        {steps.length > 1 ? <path d={path(steps)} fill="none" stroke={color[tok]} strokeWidth={S.lineW} strokeLinejoin="miter" /> : null}
        {sx.slice(0, shown).map((x, k) => {
          const q = pt(x, vals[k]);
          const s = interpolate(p.frame, [at + k * S.sampleStepF, at + k * S.sampleStepF + 4], [0.4, 1], { ...clampX, easing: easeBible });
          return <circle key={k} cx={r1(q.x)} cy={r1(q.y)} r={r1(S.dotR * s)} fill={color[tok]} stroke={color.bgRaised2} strokeWidth={2} />;
        })}
      </g>
    );
  }

  // ── peaks ──
  let peakEl: React.ReactNode = null;
  // peak ticks sit on the CLEAN signal: shown once it is filtered (or when trace 0 has no noise / drift at all)
  const t0clean = P.traces[0].noise === 0 && P.traces[0].drift === 0;
  if (P.peaks && draw >= 1 && (t0clean || clean >= 0.99) && sweep === null) {
    const t0 = { ...P.traces[0], noise: 0, drift: 0 };
    const c0 = traceCycles(P, 0);
    const xsP = tracePeaks(P);
    const hl = P.highlight;
    const hlF = p.last("mark") ?? p.changeF ?? 0;
    // W7.2: a dipping (returned-light) trace gets its beat ticks BELOW the line, at the dip
    const tk = beatDirection(P.traces[0]) === "dip" ? -1 : 1;
    peakEl = (
      <g>
        {xsP.map((x, k) => {
          const q = pt(x, traceValue(t0, x, c0, 1));
          const ring = hl === k;
          const s = ring ? interpolate(p.frame, [hlF, hlF + 10], [0.5, 1], { ...clampX, easing: easeBible }) : 1;
          return (
            <g key={k}>
              <line x1={r1(q.x)} x2={r1(q.x)} y1={r1(q.y - 34 * tk)} y2={r1(q.y - 20 * tk)} stroke={color[ring && !dim ? "accent" : "textDim"]} strokeWidth={2} strokeLinecap="round" />
              {ring ? <circle cx={r1(q.x)} cy={r1(q.y)} r={r1(S.ringR * s)} fill="none" stroke={color[dim ? "textDim" : "accent"]} strokeWidth={3} /> : null}
            </g>
          );
        })}
      </g>
    );
  }

  // ── phase mark (W7.1): arc from trace 0's peak to trace 1 at the same x + the degrees chip; draws on when it
  // first appears (a state / mark that sets phaseMark), else once the traces are drawn ──
  let phaseEl: React.ReactNode = null;
  let phaseChip: React.ReactNode = null;
  const ph = phaseArc(P, w, L.panelY);
  if (ph && !summed && sweep === null) {
    const m = [...p.events].reverse().find((e) => e.f <= p.f && (e.do === "mark" || e.do === "state") && e.props?.phaseMark !== undefined);
    const from = m ? m.f : (p.enterF ?? 0) + S.drawDelayF + S.drawF;
    const k = Math.min(draw, drawOn(p.frame, from, S.phaseDrawF));
    const chipIn = interpolate(p.frame, [from + 6, from + S.phaseDrawF], [0, 1], { ...clampX, easing: easeBible });
    const tok: ColorToken = dim ? "textDim" : "text";
    if (k > 0) {
      const top = ph.apexY + 4;
      const ys0 = ph.yPeak0 - 40; // above the peak tick
      const ys1 = ph.yPeak1 - 14;
      const shift = ph.x1 - ph.x0 > 8;
      const d = shift ? `M ${r1(ph.x0)} ${r1(ys0)} C ${r1(ph.x0)} ${r1(top)} ${r1(ph.x1)} ${r1(top)} ${r1(ph.x1)} ${r1(ys1)}` : `M ${r1(ph.x0)} ${r1(top)} L ${r1(ph.x0)} ${r1(ys0)}`;
      const t1 = traceToken(P, P.traces[1], 1, dim);
      phaseEl = (
        <g>
          <circle cx={r1(ph.x0)} cy={r1(ph.yPeak0)} r={7} fill={color[traceToken(P, P.traces[0], 0, dim)]} stroke={color.bgRaised2} strokeWidth={2} opacity={Math.min(1, k * 3)} />
          <DrawPath d={d} progress={k} id={`${p.id}-phase`} stroke={tok} strokeWidth={3} />
          {k >= 1 && shift ? <path d={`M ${r1(ph.x1)} ${r1(ys1)} l -9 -13 M ${r1(ph.x1)} ${r1(ys1)} l 9 -13`} fill="none" stroke={color[tok]} strokeWidth={3} strokeLinecap="round" /> : null}
          {shift ? <circle cx={r1(ph.x1)} cy={r1(ph.yPeak1)} r={7} fill={color[t1]} stroke={color.bgRaised2} strokeWidth={2} opacity={k >= 1 ? 1 : 0} /> : null}
        </g>
      );
    }
    if (p.f >= from + 6) {
      phaseChip = (
        <div style={{ position: "absolute", left: r1(ph.chip.x), top: r1(ph.chip.y), height: ph.chip.h, display: "flex", alignItems: "center", opacity: chipIn, transform: `scale(${0.85 + 0.15 * chipIn})`, transformOrigin: "0% 50%" }}>
          <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: S.phasePx, color: color[tok], height: ph.chip.h, lineHeight: `${ph.chip.h - 4}px`, padding: "0 14px", boxSizing: "border-box", background: color.bgRaised, border: `2px solid ${color.borderStrong}`, borderRadius: radius.pill, whiteSpace: "pre", fontVariantNumeric: "tabular-nums" }}>{ph.text}</span>
        </div>
      );
    }
  }

  // ── W7.3 flip mark: the mirror axis (the baseline, in the flipped trace's tone) + a vertical arrow from where a
  // peak WAS to where it is now; held until the instance's next change (the latest change was the flip) ──
  let flipEl: React.ReactNode = null;
  const flips = p.changeF !== null && !summed && !dim && sweep === null ? flippedTraces(p.prev, P) : [];
  if (flips.length && p.changeF !== null && draw >= 0.25) {
    const i = flips[0];
    const tok: ColorToken = TONE[traceTone(P, i)] ?? "text";
    const t0 = { ...drawnTrace(P, i), noise: 0, drift: 0 };
    const c = traceCycles(P, i);
    // the old trace's highest point nearest the panel's 30 % mark (where the arrow reads clearly)
    let best = 0.3;
    let bestV = -Infinity;
    // only where the trace is already drawn (a flip right after the entrance lands mid draw-on)
    const hiX = Math.max(0.15, Math.min(0.62, draw - 0.06));
    for (let j = 0; j <= 120; j++) {
      const x = 0.1 + ((hiX - 0.1) * j) / 120;
      const v = -traceValue(t0, x, c, 1) - 0.15 * Math.abs(x - 0.3);
      if (v > bestV) {
        bestV = v;
        best = x;
      }
    }
    const was = pt(best, -traceValue(t0, best, c, 1));
    const now = pt(best, traceValue(t0, best, c, 1));
    const axisIn = interpolate(p.frame, [p.changeF, p.changeF + 6], [0, 1], { ...clampX, easing: easeBible });
    const arrowK = drawOn(p.frame, p.changeF + 2, FLIP_F);
    const ay = was.y + (now.y - was.y) * arrowK;
    const dir = Math.sign(now.y - was.y) || 1;
    flipEl = (
      <g opacity={axisIn}>
        <line x1={px0} x2={px1} y1={L.panelY + S.panelH / 2} y2={L.panelY + S.panelH / 2} stroke={color[tok]} strokeWidth={2} strokeDasharray="6 8" opacity={0.85} />
        <circle cx={r1(was.x)} cy={r1(was.y)} r={7} fill="none" stroke={color.textDim} strokeWidth={2} />
        {arrowK > 0.15 ? (
          <>
            <line x1={r1(was.x)} x2={r1(was.x)} y1={r1(was.y + dir * 8)} y2={r1(ay - dir * 10)} stroke={color[tok]} strokeWidth={4} strokeLinecap="round" />
            <path d={`M ${r1(was.x - 11)} ${r1(ay - dir * 14)} L ${r1(was.x)} ${r1(ay)} L ${r1(was.x + 11)} ${r1(ay - dir * 14)}`} fill="none" stroke={color[tok]} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : null}
      </g>
    );
  }

  // ── window band + threshold ──
  let windowEl: React.ReactNode = null;
  if (P.window) {
    const a = pt(P.window.from, 0).x;
    const b = pt(P.window.to, 0).x;
    const wt = dim ? "dim" : P.window.tone;
    const set = p.changeF !== null && p.prev.window !== P.window ? p.changeF : (p.enterF ?? 0) + S.drawDelayF;
    const wipe = interpolate(p.frame, [set, set + 8], [0, 1], { ...clampX, easing: easeBible });
    const edge: ColorToken = wt === "danger" ? "danger" : wt === "accent" ? "accent" : "borderStrong";
    const fill: ColorToken = wt === "danger" ? "dangerBg" : "border";
    const throb = wt === "danger" ? pulse(p.frame, set + 8) : 1;
    windowEl = (
      <g opacity={wipe}>
        <rect x={r1(a)} y={L.panelY + 2} width={r1((b - a) * wipe)} height={S.panelH - 4} fill={color[fill]} />
        <line x1={r1(a)} x2={r1(a)} y1={L.panelY + 8} y2={L.panelY + S.panelH - 8} stroke={color[edge]} strokeWidth={2} strokeDasharray="8 8" opacity={throb} />
        <line x1={r1(b)} x2={r1(b)} y1={L.panelY + 8} y2={L.panelY + S.panelH - 8} stroke={color[edge]} strokeWidth={2} strokeDasharray="8 8" opacity={throb * wipe} />
      </g>
    );
  }
  let thrEl: React.ReactNode = null;
  if (P.threshold !== undefined) {
    const y = pt(0, P.threshold).y;
    thrEl = <line x1={px0} x2={px1} y1={r1(y)} y2={r1(y)} stroke={color[dim ? "textDim" : "textDim"]} strokeWidth={2} strokeDasharray="12 10" />;
  }

  // ── sweep cursor ──
  const cursor = sweep !== null ? <line x1={r1(px0 + sweep * (px1 - px0))} x2={r1(px0 + sweep * (px1 - px0))} y1={L.panelY + 10} y2={L.panelY + S.panelH - 10} stroke={color.textDim} strokeWidth={2} /> : null;

  // ── scope grid ──
  const grid: React.ReactNode[] = [];
  for (let k = 1; k < 10; k++) {
    const x = S.pad + ((w - 2 * S.pad) * k) / 10;
    grid.push(<line key={`gx${k}`} x1={r1(x)} x2={r1(x)} y1={L.panelY} y2={L.panelY + S.panelH} stroke={color.border} strokeWidth={1} />);
  }
  for (const k of [-1, 1]) {
    const y = L.panelY + S.panelH / 2 + (k * S.panelH) / 4;
    grid.push(<line key={`gy${k}`} x1={S.pad} x2={w - S.pad} y1={y} y2={y} stroke={color.border} strokeWidth={1} />);
  }

  // ── rate chip (scramble verb / rate override rolls the text) ──
  const rateTok: ColorToken = dim ? "textDim" : P.tone === "accent" ? "accent" : P.tone === "danger" ? "danger" : "text";
  let rateText = P.rate ?? "";
  const scr = p.last("scramble");
  if (P.rate && scr !== undefined && p.f < scr + 8) rateText = scramble(P.rate, P.rate, p.f, scr, 8, `${p.id}:rate:${scr}`, { holdDigits: false });
  else if (P.rate && p.changeF !== null && p.prev.rate !== P.rate && p.f < p.changeF + 8) rateText = scramble(p.prev.rate ?? P.rate, P.rate, p.f, p.changeF, 8, `${p.id}:rate:${p.changeF}`, { changedOnly: true });
  const chipPx = L.chipTop ? S.chipPx : S.smallPx + 2;
  const chipH = L.chipTop ? S.chipH : S.rowH;
  const chip = P.rate ? (
    <span style={{ display: "inline-flex", alignItems: "center", height: chipH, padding: `0 ${S.chipPadX}px`, boxSizing: "border-box", borderRadius: radius.pill, border: `2px solid ${color[rateTok === "text" ? "borderStrong" : rateTok]}`, fontFamily: font.mono, fontWeight: 500, fontSize: chipPx, color: color[rateTok], fontVariantNumeric: "tabular-nums", whiteSpace: "pre" }}>{rateText}</span>
  ) : null;

  const small: React.CSSProperties = { fontFamily: font.mono, fontWeight: 400, fontSize: S.smallPx, color: color.textDim, whiteSpace: "pre", fontVariantNumeric: "tabular-nums" };
  // span bracket: the full trace width (the drawn x range IS the span), label centred on a plate
  const spanEl = P.span && L.spanY !== null ? (
    <div style={{ position: "absolute", left: px0, top: L.spanY, width: px1 - px0, height: S.rowH }}>
      <svg width={px1 - px0} height={S.rowH} style={{ position: "absolute", left: 0, top: 0 }}>
        <line x1={1} x2={1} y1={10} y2={S.rowH - 10} stroke={color.textDim} strokeWidth={2} />
        <line x1={1} x2={px1 - px0 - 1} y1={S.rowH / 2} y2={S.rowH / 2} stroke={color.textDim} strokeWidth={2} />
        <line x1={px1 - px0 - 1} x2={px1 - px0 - 1} y1={10} y2={S.rowH - 10} stroke={color.textDim} strokeWidth={2} />
      </svg>
      <div style={{ position: "absolute", left: 0, top: 0, width: px1 - px0, height: S.rowH, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ ...small, color: color.text, background: color.bgRaised, padding: "0 14px" }}>{P.span}</span>
      </div>
    </div>
  ) : null;
  const tagPill = P.tag !== "none" ? <span style={{ ...small, height: S.rowH - 4, lineHeight: `${S.rowH - 6}px`, padding: "0 12px", boxSizing: "border-box", border: `1px solid ${color.border}`, borderRadius: radius.pill, letterSpacing: "0.04em" }}>{TAG_TEXT[P.tag]}</span> : null;
  const legendEl = L.legendY !== null ? (
    <div style={{ position: "absolute", left: S.pad, top: L.legendY, width: w - 2 * S.pad, height: S.rowH, display: "flex", alignItems: "center", gap: S.legendGap }}>
      {L.legend.map((e, k) => {
        const tok: ColorToken = e.trace < 0 ? (dim ? "textDim" : TONE[P.sumTone]) : (TONE[drawnTraceTone(P, e.trace, dim ? "dim" : stDrawn)] ?? "text");
        const on = e.trace >= 0 || summed;
        return (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 10, opacity: on ? 1 : 0.4 }}>
            {e.trace >= 0 && traceDashed(P, e.trace) ? (
              <svg width={S.legendSwatch} height={8}><line x1={1} x2={S.legendSwatch - 1} y1={4} y2={4} stroke={color[tok]} strokeWidth={S.lineW} strokeDasharray="8 6" /></svg>
            ) : (
              <span style={{ width: S.legendSwatch, height: e.trace < 0 ? S.sumW : S.lineW, borderRadius: 2, background: color[tok] }} />
            )}
            <span style={small}>{e.text}</span>
          </span>
        );
      })}
      {!L.chipTop ? chip : null}
      {L.tag === "legend" ? <span style={{ marginLeft: "auto", display: "inline-flex" }}>{tagPill}</span> : null}
    </div>
  ) : null;
  const tagRowEl = L.tag === "own" && L.tagY !== null ? <div style={{ position: "absolute", right: S.pad, top: L.tagY, height: S.rowH, display: "flex", alignItems: "center" }}>{tagPill}</div> : null;
  const thrLabel = P.threshold !== undefined && P.thresholdLabel ? (
    <div style={{ position: "absolute", right: S.pad + S.insetX, top: Math.round(pt(0, P.threshold).y - (P.threshold > 0.4 ? -8 : 44)), height: 36, display: "flex", alignItems: "center" }}>
      <span style={{ ...small, padding: "0 10px", background: color.bgRaised2, borderRadius: 8 }}>{P.thresholdLabel}</span>
    </div>
  ) : null;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box", borderRadius: radius.card, border: `${S.border}px solid ${color.borderStrong}`, background: color.bgRaised, ...fade.plate }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.content }}>
          <div style={{ position: "absolute", left: S.pad, top: L.titleY, width: w - 2 * S.pad, height: S.chipH, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
            <span style={{ fontFamily: font.sans, fontWeight: 600, fontSize: S.titlePx, lineHeight: `${S.titleLh}px`, color: color[dim ? "textDim" : "text"], whiteSpace: "pre" }}>{P.title}</span>
            {L.chipTop && chip ? chip : L.tag === "title" ? tagPill : null}
          </div>
          <div style={{ position: "absolute", left: S.pad, top: L.panelY, width: w - 2 * S.pad, height: S.panelH, borderRadius: S.panelRadius, background: color.bgRaised2 }} />
          <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "hidden" }}>
            <defs>
              <clipPath id={`${p.id}-panel`}>
                <rect x={S.pad} y={L.panelY} width={w - 2 * S.pad} height={S.panelH} rx={S.panelRadius} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${p.id}-panel)`}>
              {grid}
              <line x1={S.pad} x2={w - S.pad} y1={L.panelY + S.panelH / 2} y2={L.panelY + S.panelH / 2} stroke={color.borderStrong} strokeWidth={1} />
              {windowEl}
              {thrEl}
              {lines}
              {sumEl}
              {sampleEl}
              {peakEl}
              {phaseEl}
              {flipEl}
              {cursor}
            </g>
          </svg>
          {phaseChip}
          {thrLabel}
          {spanEl}
          {legendEl}
          {tagRowEl}
        </div>
      </div>
    </div>
  );
};

export const SignalTrace = defineComponent({ ...meta, Render });
