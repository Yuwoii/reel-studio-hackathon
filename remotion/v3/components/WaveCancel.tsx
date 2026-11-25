// WaveCancel renderer (meta: src/v3/components-meta/WaveCancel.ts). Every line comes from the meta's one model
// (soundAt / oppositeAt / leftAt, revealAt for the draw order), so the digest, the anchors and the tests read what is drawn.
// Plate bgRaised (radius.card) → title / column titles → lane A (sound grey dashed + opposite lime) → lane B "what's left"
// (same scale; lime once summed, the inputs step back) → legend + honesty tag. Draw-on = the polyline cut at the
// progress x (left → right). Tokens only.
import React from "react";
import { interpolate } from "remotion";
import { flowShift, lanePoint, leftAt, meta, oppositeAt, revealAt, soundAt, WAVE_TAG_TEXT, waveLayout, WC, type WaveCancelPropsT, type WaveCol } from "../../../src/v3/components-meta/WaveCancel";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color, font, radius } from "../../v2/theme";

const r1 = (x: number) => Math.round(x * 10) / 10;

function line(col: WaveCol, lane: "a" | "b", fn: (x: number) => number, upTo: number): string {
  if (upTo <= 0) return "";
  const n = WC.points;
  const out: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    if (x > upTo) {
      const q = lanePoint(col, lane, upTo, fn(upTo));
      out.push(`L ${r1(q.x)} ${r1(q.y)}`);
      break;
    }
    const q = lanePoint(col, lane, x, fn(x));
    out.push(`${i ? "L" : "M"} ${r1(q.x)} ${r1(q.y)}`);
  }
  return out.join(" ");
}

const Render: React.FC<RenderProps<WaveCancelPropsT>> = ({ props: p, base, frame, events, enterF, last }) => {
  const L = waveLayout(p);
  const rv = revealAt(base.show, events, enterF, frame);
  const ghost = 1 - 0.55 * rv.left;
  const laneBIn = interpolate(rv.left, [0, 0.15], [0, 1], clampX);
  const kick = flash(frame, last("focus"), 6);
  const glow = flash(frame, last("pulse"), 5);
  const dimAll = rv.dim ? 0.45 : 1;
  const single = L.cols.length === 1;
  const mono = (px: number): React.CSSProperties => ({ fontFamily: font.mono, fontSize: px, letterSpacing: "0.02em" });

  return (
    <svg width={L.w} height={L.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <rect x={1} y={1} width={L.w - 2} height={L.h - 2} rx={radius.card} fill={color.bgRaised} stroke={color.borderStrong} strokeWidth={2} />
      <g opacity={dimAll}>
        {single ? (
          <text x={WC.pad} y={WC.titleY + 42} fill={color.text} style={{ fontFamily: font.sans, fontWeight: 600, fontSize: WC.titlePx }}>{L.cols[0].pn.title}</text>
        ) : null}
        {L.cols.map((c, ci) => {
          const s = flowShift(p, c.pn, c.w - 2 * WC.insetX, frame);
          const la = WC.laneA, lb = WC.laneB;
          const sound = line(c, "a", (x) => soundAt(c.pn, x, s), rv.sound);
          const opp = line(c, "a", (x) => oppositeAt(c.pn, x, s), rv.opposite);
          const left = line(c, "b", (x) => leftAt(c.pn, x, s), rv.left);
          const spike = c.pn.shape === "spike";
          const a = spike ? lanePoint(c, "a", WC.spike.at, soundAt(c.pn, WC.spike.at)) : null;
          const b = spike ? lanePoint(c, "a", WC.spike.at + c.pn.delay, oppositeAt(c.pn, WC.spike.at + c.pn.delay)) : null;
          const lagIn = spike ? interpolate(rv.opposite, [0.6, 1], [0, 1], clampX) : 0;
          return (
            <g key={ci}>
              {!single ? (
                <text x={c.x + 4} y={WC.titleY + 40} fill={color.text} style={{ fontFamily: font.sans, fontWeight: 600, fontSize: WC.colTitlePx }}>{c.pn.title}</text>
              ) : null}
              {/* lane A: the sound + the opposite */}
              <rect x={c.x} y={la.y} width={c.w} height={la.h} rx={16} fill={color.bgRaised2} stroke={color.border} strokeWidth={2} />
              <line x1={c.x + 10} x2={c.x + c.w - 10} y1={la.y + la.h / 2} y2={la.y + la.h / 2} stroke={color.border} strokeWidth={1} />
              <g opacity={ghost}>
                {sound ? <path d={sound} fill="none" stroke={rv.left > 0 ? color.textDim : color.text} strokeOpacity={0.8} strokeWidth={WC.lineW} strokeDasharray="14 10" strokeLinecap="round" strokeLinejoin="round" /> : null}
                {opp ? <path d={opp} fill="none" stroke={rv.left > 0 ? color.textDim : color.accent} strokeWidth={WC.lineW} strokeLinecap="round" strokeLinejoin="round" /> : null}
              </g>
              {spike && a && b && lagIn > 0 ? (
                <g opacity={lagIn}>
                  <path d={`M ${a.x} ${la.y + 26} V ${la.y + 40} M ${a.x} ${la.y + 33} H ${b.x} M ${b.x} ${la.y + 26} V ${la.y + 40}`} stroke={color.text} strokeWidth={3} fill="none" />
                  <path d={`M ${b.x} ${la.y + 33} l -10 -6 M ${b.x} ${la.y + 33} l -10 6`} stroke={color.text} strokeWidth={3} fill="none" />
                  <g transform={`translate(${b.x + 14} ${la.y + 14})`}>
                    <rect x={0} y={0} width={p.lagLabel.length * 18 + 24} height={40} rx={radius.pill} fill={color.bgRaised} stroke={color.borderStrong} strokeWidth={2} />
                    <text x={12} y={29} fill={color.text} style={mono(30)}>{p.lagLabel}</text>
                  </g>
                </g>
              ) : null}
              {/* lane B: what's left, same scale */}
              <g opacity={laneBIn}>
                <rect x={c.x} y={lb.y} width={c.w} height={lb.h} rx={16} fill={color.bgRaised2} stroke={kick > 0.01 ? color.accent : color.border} strokeOpacity={kick > 0.01 ? kick : 1} strokeWidth={kick > 0.01 ? 4 : 2} />
                <line x1={c.x + 10} x2={c.x + c.w - 10} y1={lanePoint(c, "b", 0, 0).y} y2={lanePoint(c, "b", 0, 0).y} stroke={color.border} strokeWidth={1} />
                <line x1={c.x + 10} x2={c.x + c.w - 10} y1={lb.y + lb.labelH} y2={lb.y + lb.labelH} stroke={color.border} strokeWidth={1} />
                <text x={c.x + 16} y={lb.y + 30} fill={color.textDim} style={mono(26)}>{p.leftLabel}</text>
                {left ? <path d={left} fill="none" stroke={color.accent} strokeWidth={WC.sumW} strokeLinecap="round" strokeLinejoin="round" style={glow > 0 ? { filter: `drop-shadow(0 0 ${r1(10 * glow)}px ${color.markAccent})` } : undefined} /> : null}
              </g>
            </g>
          );
        })}
        {/* legend + tag */}
        <g transform={`translate(${WC.pad} ${WC.legendY})`}>
          <line x1={0} x2={34} y1={18} y2={18} stroke={color.text} strokeOpacity={0.8} strokeWidth={WC.lineW} strokeDasharray="10 6" />
          <text x={46} y={28} fill={color.textDim} style={mono(26)}>{p.soundLabel}</text>
          <line x1={66 + p.soundLabel.length * 15.6} x2={100 + p.soundLabel.length * 15.6} y1={18} y2={18} stroke={rv.left > 0 ? color.textDim : color.accent} strokeWidth={WC.lineW} />
          <text x={112 + p.soundLabel.length * 15.6} y={28} fill={color.textDim} style={mono(26)}>{p.oppositeLabel}</text>
        </g>
        {p.tag !== "none" ? (
          <g transform={`translate(${L.w - WC.pad - (WAVE_TAG_TEXT[p.tag].length * 15.6 + 24)} ${WC.legendY - 2})`}>
            <rect x={0} y={0} width={WAVE_TAG_TEXT[p.tag].length * 15.6 + 24} height={40} rx={radius.pill} fill="none" stroke={color.border} strokeWidth={2} />
            <text x={12} y={28} fill={color.textDim} style={mono(26)}>{WAVE_TAG_TEXT[p.tag]}</text>
          </g>
        ) : null}
      </g>
    </svg>
  );
};

export const WaveCancel = defineComponent({ ...meta, Render });
