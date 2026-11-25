// WeeksPoster renderer (meta: src/v3/components-meta/WeeksPoster.ts). One <svg>, all vector (camera zooms up to 4×
// stay sharp; no canvas, no <pattern> tiles that seam at fractional zoom). Every count comes from the meta's one model
// (fillAt / livedAt / drawnCounts / counterAt), so the counter, the digest and the tests read what is drawn.
// Paper (offset shadow, 2 tape strips) → title, counter, legend, year labels, tag, "1 box = 1 week" → the grid outline
// (one path) → one filled path per share (+ a lighter "wet ink" leading row) → lived overlay → you-are-here → the empty
// boxes in lime (state empty; the shares step back) → focus ring; dim = group opacity. Box paths are cached once per
// (years, grid y) and sliced per range, so a frame joins ≤ 9 slices of short strings.
import React from "react";
import { interpolate } from "remotion";
import { cellXY, counterAt, drawnCounts, emptyRange, fillAt, fmtInt, gridH, gridW, gridY, livedAt, meta, POSTER, posterH, posterRanges, rangeBox, rowY, stepBackAt, topBand, WEEKS_TAG_TEXT, type WeeksPosterPropsT } from "../../../src/v3/components-meta/WeeksPoster";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color, font, radius } from "../../v2/theme";
import { poster, posterInk } from "./tokens";

const CELLS = new Map<string, string[]>();
/** One closed square sub-path per box ("M x y h11.5 v11.5 h-11.5 Z"), coordinates rounded to 0.5. */
function cells(years: number, gy: number): string[] {
  const key = `${years}:${gy}`;
  let c = CELLS.get(key);
  if (!c) {
    const h = (x: number) => Math.round(x * 2) / 2;
    c = Array.from({ length: years * 52 }, (_, i) => {
      const q = cellXY(i, gy);
      return `M${h(q.x)} ${h(q.y)}h${POSTER.cell}v${POSTER.cell}h-${POSTER.cell}Z`;
    });
    CELLS.set(key, c);
  }
  return c;
}
const run = (c: readonly string[], a: number, b: number) => (b > a ? c.slice(a, b).join("") : "");

const Render: React.FC<RenderProps<WeeksPosterPropsT>> = ({ props: p, base, frame, f, events, last }) => {
  const H = posterH(p);
  const PW = POSTER.w - POSTER.shadow, PH = H - POSTER.shadow;
  const gy = gridY(p);
  const gh = gridH(p.years);
  const c = cells(p.years, gy);
  const R = posterRanges(p);
  const fill = fillAt(p, base.show, events, frame);
  const lived = livedAt(base, events, frame, p.showHere);
  const d = drawnCounts(p, fill, lived);
  const E = emptyRange(p);
  const stepBack = stepBackAt(fill, frame);
  const shareOpacity = 1 - 0.6 * stepBack;
  const kick = flash(frame, last("focus"), 5);
  const ping = last("pulse");
  const pingT = ping === undefined ? 1 : interpolate(frame, [ping, ping + 10], [0, 1], clampX);
  const tb = topBand(p);
  // digits from the discrete frame f (RenderProps contract): motion-blur sub-samples must never draw different numbers
  const counter = p.counter === "none" ? null : fmtInt(counterAt(p, fillAt(p, base.show, events, f), livedAt(base, events, f, p.showHere)));
  const mono = (px: number): React.CSSProperties => ({ fontFamily: font.mono, fontSize: px, letterSpacing: "0.02em" });
  const sans = (px: number, w = 600): React.CSSProperties => ({ fontFamily: font.sans, fontSize: px, fontWeight: w });
  const tag = WEEKS_TAG_TEXT[p.tag];
  const chipW = (PW - 2 * POSTER.pad - (POSTER.legendPerRow - 1) * 16) / POSTER.legendPerRow;
  const here = cellXY(R.here, gy);
  const hereOn = p.age !== undefined && p.showHere ? lived : 0;
  // focus: the newest filled share, or the empty boxes once they are highlighted
  const focusBox = (() => {
    if (fill.empty > 0.5 && E.b > E.a) return rangeBox(E.a, E.b, gy);
    for (let k = R.segs.length - 1; k >= 0; k--) if (d.seg[k] > 0) return rangeBox(R.segs[k].a, R.segs[k].a + d.seg[k], gy);
    return null;
  })();
  return (
    <svg width={POSTER.w} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {/* paper: offset shadow (3 rects, falling alpha, no filter), paper gradient, tape (all inside the footprint) */}
      {[0, 1, 2].map((k) => (
        <rect key={k} x={2 + k * 2} y={4 + k * 2} width={PW} height={PH} rx={6} fill={poster.shadow(0.22 - k * 0.06)} />
      ))}
      <defs>
        <linearGradient id={`wp-paper-${p.years}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={poster.paper} />
          <stop offset="1" stopColor={poster.paperLow} />
        </linearGradient>
      </defs>
      <g opacity={fill.dim ? 0.45 : 1}>
        <rect x={0} y={0} width={PW} height={PH} rx={6} fill={`url(#wp-paper-${p.years})`} stroke={poster.edge} strokeWidth={2} />
        <rect x={60} y={5} width={120} height={20} transform="rotate(-4 120 15)" fill={poster.tape} stroke={poster.tapeEdge} strokeWidth={1} />
        <rect x={PW - 180} y={6} width={120} height={20} transform={`rotate(5 ${PW - 120} 16)`} fill={poster.tape} stroke={poster.tapeEdge} strokeWidth={1} />
        {/* the poster's own text */}
        {p.title ? <text x={POSTER.pad} y={POSTER.titleRowY + tb.titlePx * 0.82} fill={poster.text} style={sans(tb.titlePx)}>{p.title}</text> : null}
        {counter ? (
          <g>
            <text x={tb.right} y={POSTER.titleRowY + 50} textAnchor="end" fill={poster.text} style={{ ...mono(POSTER.counterPx), fontWeight: 600 }}>{counter}</text>
            <text x={tb.right - tb.digitsW - 14} y={POSTER.titleRowY + 50} textAnchor="end" fill={poster.textDim} style={mono(POSTER.counterLabelPx)}>{p.counterLabel}</text>
          </g>
        ) : null}
        {p.legend
          ? R.segs.map((s, k) => {
              const row = Math.floor(k / POSTER.legendPerRow), col = k % POSTER.legendPerRow;
              const x = POSTER.pad + col * (chipW + 16), y = POSTER.legendY + row * POSTER.legendRowH;
              return (
                <g key={k} opacity={0.35 + 0.65 * Math.min(1, (fill.seg[k] ?? 0) * 4)}>
                  <rect x={x} y={y} width={chipW} height={POSTER.chipH} rx={radius.pill} fill="none" stroke={poster.gridLine} strokeWidth={1.5} />
                  <rect x={x + 12} y={y + 10} width={24} height={24} rx={4} fill={posterInk[s.tone]} />
                  <text x={x + 48} y={y + 31} fill={poster.text} style={mono(POSTER.legendPx)}>{s.label}</text>
                </g>
              );
            })
          : null}
        {Array.from({ length: Math.floor((p.years - 1) / 10) }, (_, i) => (i + 1) * 10).map((a) => (
          <text key={a} x={POSTER.gridX - 12} y={rowY(a, gy) + POSTER.cell - 1} textAnchor="end" fill={poster.textDim} style={mono(POSTER.yearPx)}>{a}</text>
        ))}
        <text x={POSTER.gridX} y={gy + gh + 32} fill={poster.textDim} style={mono(POSTER.scalePx)}>1 box = 1 week</text>
        {tag ? (
          <g transform={`translate(${POSTER.gridX + gridW - (tag.length * 0.6 * POSTER.scalePx + 24)} ${gy + gh + 10})`}>
            {/* chip y gy+gh+10 … +40 (+0.75 stroke): inside the paper, which ends at gy+gh+44 */}
            <rect x={0} y={0} width={tag.length * 0.6 * POSTER.scalePx + 24} height={30} rx={radius.pill} fill="none" stroke={poster.gridLine} strokeWidth={1.5} />
            <text x={12} y={22} fill={poster.textDim} style={mono(POSTER.scalePx)}>{tag}</text>
          </g>
        ) : null}
        {/* the grid: every box outlined */}
        <path d={c.join("")} fill="none" stroke={poster.gridLine} strokeWidth={1.2} />
        {/* the shares, in their inks; the newest row of each running wave a little lighter (wet ink) */}
        <g opacity={shareOpacity}>
          {R.segs.map((s, k) => {
            const n = d.seg[k];
            if (n <= 0) return null;
            const end = s.a + n;
            const wet = (fill.seg[k] ?? 0) < 1 ? Math.max(s.a, end - POSTER.cols) : end;
            return (
              <g key={k}>
                <path d={run(c, s.a, wet)} fill={posterInk[s.tone]} />
                {wet < end ? <path d={run(c, wet, end)} fill={posterInk[s.tone]} opacity={0.55} /> : null}
              </g>
            );
          })}
          {/* lived weeks: ink at 30 % (mutes the shares, greys the free lived boxes: used) */}
          {d.lived > 0 ? <path d={run(c, 0, d.lived)} fill={posterInk.ink} opacity={0.3} /> : null}
        </g>
        {/* the boxes still empty: lime highlighter, ink outlines kept */}
        {d.empty > 0 ? (
          <g>
            <path d={run(c, E.a, E.a + d.empty)} fill={color.accent} />
            <path d={run(c, E.a, E.a + d.empty)} fill="none" stroke={poster.gridLine} strokeWidth={1.2} />
          </g>
        ) : null}
        {/* you are here */}
        {hereOn > 0 ? (
          <g opacity={hereOn}>
            <rect x={here.x} y={here.y} width={POSTER.cell} height={POSTER.cell} fill={color.danger} />
            <circle cx={here.x + POSTER.cell / 2} cy={here.y + POSTER.cell / 2} r={16} fill="none" stroke={color.danger} strokeWidth={3} />
            <path d={`M 12 ${here.y - 4} L 30 ${here.y + POSTER.cell / 2} L 12 ${here.y + POSTER.cell + 4} Z`} fill={color.danger} />
            {pingT < 1 ? <circle cx={here.x + POSTER.cell / 2} cy={here.y + POSTER.cell / 2} r={16 + 30 * pingT} fill="none" stroke={color.danger} strokeWidth={3} opacity={1 - pingT} /> : null}
          </g>
        ) : null}
        {focusBox && kick > 0.01 ? (
          <rect x={focusBox.x0 - 8} y={focusBox.y0 - 8} width={focusBox.x1 - focusBox.x0 + 16} height={focusBox.y1 - focusBox.y0 + 16} rx={10} fill="none" stroke={color.accent} strokeWidth={5} opacity={kick} />
        ) : null}
      </g>
    </svg>
  );
};

export const WeeksPoster = defineComponent({ ...meta, Render });
