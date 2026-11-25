// Envelope renderer (meta: src/v3/components-meta/Envelope.ts). Promoted from v3lab/hook (screen-space there; a
// footprint-origin world component here).
import React from "react";
import { interpolate } from "remotion";
import { ENV, envelopeBox, meta, type EnvelopePropsT } from "../../../src/v3/components-meta/Envelope";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color } from "../../v2/theme";

const Render: React.FC<RenderProps<EnvelopePropsT>> = ({ props: p, frame, state, last, size }) => {
  const b = envelopeBox(p.w);
  const open = state.name === "open" ? (state.f === null ? 1 : interpolate(frame, [state.f, state.f + ENV.openF], [0, 1], clampX)) : 0;
  const glow = (p.glow ? 1 : 0) * Math.max(0.6, 1 - 0.4 * flash(frame, last("pulse"), 6)) + flash(frame, last("pulse"), 6) * 0.5;
  const W = b.W, H = b.H, l = -W / 2, t = -H / 2;
  const flapY = interpolate(open, [0, 1], [1, -1], clampX);
  const half = interpolate(open, [0, 1], [0, W * 0.42], clampX);
  const sealO = interpolate(open, [0, 0.7, 1], [1, 1, 0.85], clampX);
  const noteRise = interpolate(open, [0.25, 1], [0, H * 0.78], clampX);
  const sealR = W * ENV.sealR;
  const sealFill = open > 0 ? color.danger : color.accent;
  const flap = (
    <g transform={`translate(0 ${t}) scale(1 ${flapY}) translate(0 ${-t})`}>
      <path d={`M ${l} ${t} L 0 ${t + H * 0.55} L ${-l} ${t} Z`} fill={color.bgRaised} stroke={color.text} strokeWidth={3} strokeLinejoin="round" />
    </g>
  );
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={size.w} height={size.h}>
      <g transform={`translate(${b.cx} ${b.top + H / 2})`}>
        {open >= 0.5 ? flap : null}
        {open > 0.25 ? (
          <g transform={`translate(0 ${-noteRise})`}>
            <rect x={l + W * 0.12} y={t + H * 0.08} width={W * 0.76} height={H * 0.8} rx={8} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={2} />
            {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={l + W * 0.24 + i * W * 0.1} cy={t + H * 0.22} r={W * 0.03} fill={color.text} />)}
          </g>
        ) : null}
        <rect x={l} y={t} width={W} height={H} rx={10} fill={color.bgRaised2} stroke={color.text} strokeWidth={3} />
        <path d={`M ${l + 4} ${t + H - 4} L 0 ${t + H * 0.45} L ${-l - 4} ${t + H - 4}`} fill="none" stroke={color.borderStrong} strokeWidth={2} />
        {open < 0.5 ? flap : null}
        <circle cx={0} cy={t + H * 0.55} r={sealR * 2.1} fill={color.accent} opacity={0.2 * glow * sealO * (open > 0 ? 0 : 1)} />
        <g opacity={sealO}>
          <path d={`M ${-half} ${t + H * 0.55 - sealR} A ${sealR} ${sealR} 0 0 0 ${-half} ${t + H * 0.55 + sealR} Z`} fill={sealFill} />
          <path d={`M ${half} ${t + H * 0.55 - sealR} A ${sealR} ${sealR} 0 0 1 ${half} ${t + H * 0.55 + sealR} Z`} fill={sealFill} />
        </g>
      </g>
    </svg>
  );
};

export const Envelope = defineComponent({ ...meta, Render });
