// MetricChart renderer (R7 N-4). Meta: src/v2/components-meta/MetricChart.ts.
//
//   ┌ p99 latency · ms ─────────────────────────────┐   896 × 480 bgRaised panel, radius.card, 2 px border
//   │ 1,000ms ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │   gridlines 1 px `border`, mono 26 textDim axes
//   │   500ms SLO 500ms - - - - - - - - - [OOMKilled]│   threshold dashed danger, label on a plate at the LEFT end;
//   │       0 ───────╱╲_______                       │   series 3 px `text` (+ head dot while drawing), area = faint
//   │         06:00  06:10  06:20                    │   text gradient 0.06 → 0; incident window dangerBg band;
//   └───────────────────────────────────────────────┘   spike = danger dot + ring + label on a bgRaised plate (danger
//                                                       outline), ≥ 16 px clear of the threshold line
// The line draws left → right (bible ease) after the panel's entrance; drawOn {upTo} extends it. state: normal /
// breach (danger border, threshold pulses) / dim (line, threshold grey; band + spike marker drop to C.dimChromaOp).
// mark reveals the window (wipe 8 f) and the spike (pop + ring).
// y labels sit ABOVE their gridline (glyph bottom C.yLabelLift px over it), so the baseline label never stacks on the
// first x label at the plot origin. enterExit "self" (plateFade, W2.1 r2): the panel (bgRaised + border) is opaque
// before the title / axes / series appear (content spring +3 f); on exit everything drawn on it fades + blurs over the
// first 4 f while the panel stays opaque, then the empty panel fades 4 f — the field never reads through a
// translucent panel under the chart line or the danger band. A breach (danger) border fades with the content
// (CHROMA_LEAD_F), so no red outline outlives the chart on the grey panel.
// Pure function of the frame; text colours snap, plate colours cross-fade 6 f.
import React from "react";
import { interpolate } from "remotion";
import { chartRange, meta, METRIC_CHART, type MetricChartPropsT } from "../../../src/v2/components-meta/MetricChart";
import { clampX, drawOn, easeBible, enterProgress, formatCount, pulse, stateMix } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps, type TrackEvent } from "./contract";
import { plateFade } from "./plateFade";
import { DrawPath } from "./primitives";

const C = METRIC_CHART;
export const CHROMA_LEAD_F = 4;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Dash pattern for a run of `len` px that starts AND ends on a full dash (gap stretched to fit). */
export function fittedDash(len: number, dash: number, gap: number): string {
  if (len <= dash) return `${r2(Math.max(0, len))} ${gap}`;
  const n = Math.max(2, Math.round((len + gap) / (dash + gap)));
  return `${dash} ${r2((len - n * dash) / (n - 1))}`;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Spike-label plate: above the marker, else below it, else beside it; always ≥ C.labelClear px from the threshold
 * line (when there is one) and inside the panel (top ≥ minTop). First candidate that fits wins.
 */
export function spikeLabelRect(cx: number, cy: number, lw: number, g: { plotL: number; plotR: number; plotB: number; minTop: number; ty: number | null }): Rect {
  const pw = lw + 2 * C.plateX;
  const ph = C.plateH;
  const x = Math.min(g.plotR - pw, Math.max(g.plotL, cx - pw / 2));
  const clearOf = (r: Rect) => g.ty === null || r.y >= g.ty + C.labelClear || r.y + r.h <= g.ty - C.labelClear;
  const fits = (r: Rect) => r.y >= g.minTop && r.y + r.h <= g.plotB && clearOf(r);
  const aboveBottom = Math.min(cy - C.spikeRingR - 6, g.ty !== null && g.ty <= cy + 1 ? g.ty - C.labelClear : Infinity);
  const above: Rect = { x, y: aboveBottom - ph, w: pw, h: ph };
  if (fits(above)) return above;
  const belowTop = Math.max(cy + C.spikeRingR + 6, g.ty !== null && g.ty >= cy - 1 ? g.ty + C.labelClear : -Infinity);
  const below: Rect = { x, y: belowTop, w: pw, h: ph };
  if (fits(below)) return below;
  const sx = cx - C.spikeRingR - 6 - pw >= g.plotL ? cx - C.spikeRingR - 6 - pw : Math.min(g.plotR - pw, cx + C.spikeRingR + 6);
  const sy = g.ty !== null && Math.abs(cy - g.ty) < ph / 2 + C.labelClear ? (g.ty - C.labelClear - ph >= g.minTop ? g.ty - C.labelClear - ph : g.ty + C.labelClear) : cy - ph / 2;
  return { x: sx, y: sy, w: pw, h: ph };
}

/** Threshold-label plate: the LEFT end of the line (above, else below); moved to the right end if it meets `avoid`. */
export function thresholdLabelRect(ty: number, lw: number, g: { plotL: number; plotR: number; plotT: number; plotB: number }, avoid: Rect | null): Rect {
  const pw = lw + 2 * C.plateX;
  const ph = C.plateH;
  const ys = [ty - 6 - ph, ty + 6].filter((y) => y >= g.plotT - ph / 2 && y + ph <= g.plotB);
  const xs = [g.plotL + 4, g.plotR - pw - 4];
  for (const x of xs) for (const y of ys.length ? ys : [ty + 6]) {
    const r = { x, y, w: pw, h: ph };
    if (!avoid || !hit(r, { x: avoid.x - 8, y: avoid.y - 8, w: avoid.w + 16, h: avoid.h + 16 })) return r;
  }
  return { x: xs[0], y: ys[0] ?? ty + 6, w: pw, h: ph };
}

export interface DrawStep {
  f: number;
  from: number;
  to: number;
  dur: number;
}

const validIndex = (v: unknown, n: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v < n;

/** Line draw schedule: drawOn actions (each extends to props.upTo, default the last point), else one draw after enter. */
export function drawSteps(base: Pick<MetricChartPropsT, "values" | "upTo">, events: readonly TrackEvent[], enterF: number | null): DrawStep[] | null {
  const n = base.values.length;
  const draws = events.filter((e) => e.do === "drawOn");
  if (!draws.length) {
    if (enterF === null) return null; // drawn from frame 0
    return [{ f: enterF + C.drawDelayF, from: 0, to: base.upTo ?? n - 1, dur: C.drawF }];
  }
  const out: DrawStep[] = [];
  let at = 0;
  draws.forEach((e, i) => {
    const up = e.props?.upTo;
    const to = validIndex(up, n) ? up : i === 0 ? (base.upTo ?? n - 1) : n - 1;
    if (to <= at) return;
    out.push({ f: e.f, from: at, to, dur: at === 0 ? C.drawF : C.extendF });
    at = to;
  });
  return out;
}

/** Drawn extent in point-index units at `frame` (continuous: the tip may blur). */
export function drawnUpTo(steps: DrawStep[] | null, frame: number, n: number, baseUpTo: number | undefined): number {
  if (steps === null) return baseUpTo ?? n - 1;
  let u = 0;
  for (const s of steps) {
    if (frame < s.f) break;
    u = s.from + (s.to - s.from) * easeBible(Math.min(1, (frame - s.f) / s.dur));
  }
  return u;
}

/** First integer frame at which the drawn extent reaches index `i` (undefined = never / not yet scheduled). */
function reachF(steps: DrawStep[] | null, i: number): number | undefined {
  if (steps === null) return 0;
  for (const s of steps) {
    if (s.to < i) continue;
    for (let f = s.f; f <= s.f + s.dur; f++) if (s.from + (s.to - s.from) * easeBible(Math.min(1, (f - s.f) / s.dur)) >= i - 1e-6) return f;
  }
  return undefined;
}

const lastWith = (events: readonly TrackEvent[], verb: TrackEvent["do"], key: string, f: number) => {
  let hit: number | undefined;
  for (const e of events) {
    if (e.f > f) break;
    if (e.do === verb && e.props && key in e.props) hit = e.f;
  }
  return hit;
};

const BORDER: Record<string, ColorToken> = { normal: "border", breach: "danger", dim: "border" };

/** plateFade style with the opacity rounded (and dropped once it is ≈ 1). */
const tidyR = (x: number) => Math.round(x * 1000) / 1000;
const tidy = <T extends React.CSSProperties & { opacity: number }>(st: T): React.CSSProperties => ({ ...st, opacity: st.opacity >= 0.999 ? undefined : tidyR(st.opacity) });

const Render: React.FC<RenderProps<MetricChartPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const { w, h } = p.size;
  const P = p.props;
  const n = P.values.length;
  const { lo, hi } = chartRange(P);
  const tick = (v: number) => `${formatCount(v, P.decimals)}${P.unit}`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const yLabelW = Math.max(...ticks.map((v) => tick(v).length)) * C.charW;
  const xl = P.xLabels;
  // x labels are centred on their ticks: inset the plot so the first and last fit inside the panel padding
  const firstHalf = xl.length ? (xl[0].length * C.charW) / 2 : 0;
  const lastHalf = xl.length > 1 ? (xl[xl.length - 1].length * C.charW) / 2 : 0;
  const plotL = Math.max(C.pad + yLabelW + C.yLabelGap, C.pad + firstHalf);
  const plotR = w - C.pad - lastHalf;
  const plotT = C.plotTop;
  const plotB = h - C.pad - (P.xLabels.length ? C.lineH + C.xLabelGap : 8);
  const X = (i: number) => plotL + (i / (n - 1)) * (plotR - plotL);
  const Y = (v: number) => plotB - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (plotB - plotT);

  const steps = drawSteps(p.base, p.events, p.enterF);
  const u = drawnUpTo(steps, p.frame, n, p.base.upTo);
  const lineStart = steps?.[0]?.f ?? 0;

  const plotTopLimit = C.titleTop + C.lineH + 8; // a label plate may rise into the headroom above plotT, never into the title row
  const st = p.state.name;
  const t = stateMix(p.frame, p.state.f);
  const prevSt = p.state.prev ?? st;
  // border change: two stacked outlines cross-fade by opacity (an RGB lerp of danger → a translucent white goes pink)
  const borders: { tok: ColorToken; op: number }[] = t >= 1 || BORDER[prevSt] === BORDER[st] ? [{ tok: BORDER[st], op: 1 }] : [{ tok: BORDER[prevSt], op: 1 - t }, { tok: BORDER[st], op: t }];
  const dim = st === "dim";
  const lead = p.exitF === null ? 1 : 1 - interpolate(p.frame, [p.exitF, p.exitF + CHROMA_LEAD_F], [0, 1], clampX);

  // series up to u
  const k = Math.floor(u);
  const pts: [number, number][] = [];
  for (let i = 0; i <= Math.min(k, n - 1); i++) pts.push([X(i), Y(P.values[i])]);
  if (u > k && k + 1 < n) {
    const fr = u - k;
    pts.push([X(k + fr), Y(P.values[k] + (P.values[k + 1] - P.values[k]) * fr)]);
  }
  const lineD = pts.length >= 2 ? pts.map((q, i) => `${i ? "L" : "M"} ${r2(q[0])} ${r2(q[1])}`).join(" ") : null;
  // head dot at the draw position while a draw step runs (fades over its last 4 f)
  const activeStep = steps?.find((s) => p.frame >= s.f && p.frame < s.f + s.dur);
  const headOp = activeStep && pts.length >= 2 ? interpolate(p.frame, [activeStep.f + activeStep.dur - 4, activeStep.f + activeStep.dur], [1, 0], clampX) : 0;
  const head = headOp > 0 ? pts[pts.length - 1] : null;
  const areaD = lineD && P.kind === "area" ? `${lineD} L ${r2(pts[pts.length - 1][0])} ${r2(plotB)} L ${r2(pts[0][0])} ${r2(plotB)} Z` : null;

  // threshold: draws on with the line, or when a state action sets it
  let threshold: React.ReactNode = null;
  if (P.threshold !== undefined) {
    const setF = lastWith(p.events, "state", "threshold", p.f) ?? lineStart;
    const prog = steps === null && setF === 0 ? 1 : drawOn(p.frame, setF, 12);
    if (prog > 0) {
      const ty = Y(P.threshold);
      const breachPulse = st === "breach" && p.state.f !== null && p.frame >= p.state.f + motion.scrambleF[1] ? pulse(p.frame, p.state.f + motion.scrambleF[1]) : 1;
      // the spike label's slot (if any) is reserved even before it appears, so the threshold label never jumps
      const spikeSlot = P.spike !== undefined && P.spikeLabel ? spikeLabelRect(X(P.spike), Y(P.values[P.spike]), P.spikeLabel.length * C.charW, { plotL, plotR, plotB, minTop: plotTopLimit, ty }) : null;
      const lr = P.thresholdLabel ? thresholdLabelRect(ty, P.thresholdLabel.length * C.charW, { plotL, plotR, plotT, plotB }, spikeSlot) : null;
      threshold = (
        <g>
          <g opacity={r2(breachPulse * (dim ? 0.5 : 1))}>
            <DrawPath d={`M ${r2(plotL)} ${r2(ty)} L ${r2(plotR)} ${r2(ty)}`} progress={prog} id={`${p.id}-thr-${setF}`} stroke={dim ? "textDim" : "danger"} strokeWidth={C.thresholdW} dash={fittedDash(plotR - plotL, C.thresholdDash[0], C.thresholdDash[1])} maskWidth={12} />
          </g>
          {P.thresholdLabel && lr ? (
            <g opacity={r2(prog * (dim ? 0.5 : 1))}>
              <rect x={r2(lr.x)} y={r2(lr.y)} width={r2(lr.w)} height={r2(lr.h)} rx={C.plateR} fill={color.bgRaised} />
              <text x={r2(lr.x + C.plateX)} y={r2(lr.y + lr.h / 2 + C.axisPx * 0.35)} fill={color[dim ? "textDim" : "danger"]} fontFamily={font.mono} fontWeight={500} fontSize={C.axisPx} style={{ whiteSpace: "pre" }}>
                {P.thresholdLabel}
              </text>
            </g>
          ) : null}
        </g>
      );
    }
  }

  // incident window: grows with the line, or wipes in on a mark
  let band: React.ReactNode = null;
  if (P.window) {
    const markF = lastWith(p.events, "mark", "window", p.f);
    const x0 = X(P.window.from);
    const x1full = X(P.window.to);
    const x1 = markF !== undefined ? x0 + (x1full - x0) * easeBible(interpolate(p.frame, [markF, markF + 8], [0, 1], clampX)) : u > P.window.from ? Math.min(x1full, X(u)) : x0;
    if (x1 > x0) band = <rect x={r2(x0)} y={r2(plotT)} width={r2(x1 - x0)} height={r2(plotB - plotT)} fill={color.dangerBg} opacity={dim ? C.dimChromaOp : 1} />;
  }

  // spike marker
  let spike: React.ReactNode = null;
  if (P.spike !== undefined) {
    const markF = lastWith(p.events, "mark", "spike", p.f);
    const appearF = markF ?? reachF(steps, P.spike);
    if (appearF !== undefined && p.frame >= appearF && (markF !== undefined || u >= P.spike - 1e-6)) {
      const cx = X(P.spike);
      const cy = Y(P.values[P.spike]);
      const pop = enterProgress(p.frame, appearF);
      const ringAt = Math.max(appearF, p.last("pulse") ?? -1);
      const rt = interpolate(p.frame, [ringAt, ringAt + 12], [0, 1], clampX);
      const lr = P.spikeLabel ? spikeLabelRect(cx, cy, P.spikeLabel.length * C.charW, { plotL, plotR, plotB, minTop: plotTopLimit, ty: P.threshold !== undefined ? Y(P.threshold) : null }) : null;
      spike = (
        <g opacity={dim ? C.dimChromaOp : 1}>
          {rt < 1 ? <circle cx={r2(cx)} cy={r2(cy)} r={r2(C.spikeR + (C.spikeRingR - C.spikeR) * rt)} fill="none" stroke={color.danger} strokeWidth={2} opacity={r2(1 - rt)} /> : null}
          <circle cx={r2(cx)} cy={r2(cy)} r={r2(C.spikeR * pop)} fill={color.danger} stroke={color.bgRaised} strokeWidth={3} />
          {P.spikeLabel && lr ? (
            <g opacity={r2(Math.min(1, pop))}>
              <rect x={r2(lr.x)} y={r2(lr.y)} width={r2(lr.w)} height={r2(lr.h)} rx={C.plateR} fill={color.bgRaised} stroke={color.danger} strokeWidth={2} />
              <text x={r2(lr.x + C.plateX)} y={r2(lr.y + lr.h / 2 + C.axisPx * 0.35)} fill={color.danger} fontFamily={font.mono} fontWeight={500} fontSize={C.axisPx} style={{ whiteSpace: "pre" }}>
                {P.spikeLabel}
              </text>
            </g>
          ) : null}
        </g>
      );
    }
  }

  const gradId = `${p.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-area`;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      {/* the opaque panel: alpha 1 before the content shows, last to go on exit (plateFade) */}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...tidy(fade.plate) }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, borderRadius: radius.card, background: color.bgRaised }} />
        {borders.map((b) => {
          const op = b.op * (b.tok === "danger" ? lead : 1);
          return op <= 0.001 ? null : <div key={b.tok} style={{ position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box", borderRadius: radius.card, border: `${C.border}px solid ${color[b.tok]}`, opacity: op < 1 ? r2(op) : undefined }} />;
        })}
      </div>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...tidy(fade.content) }}>
        <div style={{ position: "absolute", left: C.pad, top: C.titleTop, height: C.lineH, lineHeight: `${C.lineH}px`, fontFamily: font.mono, fontWeight: 500, fontSize: C.titlePx, color: color.textDim, whiteSpace: "pre" }}>{P.title}</div>
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
          {areaD ? (
            <defs>
              <linearGradient id={gradId} x1="0" y1={r2(plotT)} x2="0" y2={r2(plotB)} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={color.text} stopOpacity={C.areaTopOpacity} />
                <stop offset="1" stopColor={color.text} stopOpacity={0} />
              </linearGradient>
            </defs>
          ) : null}
          {ticks.map((v, i) => (
            <g key={`t${i}`}>
              <line x1={r2(plotL)} x2={r2(plotR)} y1={r2(Y(v)) + 0.5} y2={r2(Y(v)) + 0.5} stroke={color.border} strokeWidth={C.gridW} />
              <text x={r2(plotL - C.yLabelGap)} y={r2(Y(v) - C.yLabelLift)} textAnchor="end" fill={color.textDim} fontFamily={font.mono} fontWeight={400} fontSize={C.axisPx} style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "pre" }}>
                {tick(v)}
              </text>
            </g>
          ))}
          {xl.map((s, j) => {
            const i = xl.length === 1 ? 0 : (j * (n - 1)) / (xl.length - 1);
            return (
              <text key={`x${j}`} x={r2(X(i))} y={r2(plotB + C.xLabelGap + C.axisPx * 0.8)} textAnchor="middle" fill={color.textDim} fontFamily={font.mono} fontWeight={400} fontSize={C.axisPx} style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "pre" }}>
                {s}
              </text>
            );
          })}
          {band}
          {areaD ? <path d={areaD} fill={`url(#${gradId})`} stroke="none" opacity={dim ? 0.5 : 1} /> : null}
          {threshold}
          {lineD ? <path d={lineD} fill="none" stroke={color[dim ? "textDim" : "text"]} strokeWidth={C.lineW} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {head ? <circle cx={r2(head[0])} cy={r2(head[1])} r={C.headR} fill={color[dim ? "textDim" : "text"]} stroke={color.bgRaised} strokeWidth={3} opacity={headOp < 1 ? r2(headOp) : undefined} /> : null}
          {spike}
        </svg>
      </div>
    </div>
  );
};

export const MetricChart = defineComponent({ ...meta, Render });
