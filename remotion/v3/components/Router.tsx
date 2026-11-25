// Router renderer (meta: src/v3/components-meta/Router.ts).
import React from "react";
import { meta, RT, type RouterPropsT } from "../../../src/v3/components-meta/Router";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { flash } from "../../v2/motion";
import { color } from "../../v2/theme";

const Render: React.FC<RenderProps<RouterPropsT>> = ({ f, frame, state, last, id }) => {
  const gid = `rt-body-${id}`;
  const active = state.name === "active";
  const hit = flash(frame, last("pulse"), 5);
  const b = RT.body;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={RT.w} height={RT.h}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2d2e31" /><stop offset="60%" stopColor="#1f2022" /><stop offset="100%" stopColor="#161618" /></linearGradient>
      </defs>
      {[RT.antL, RT.antR].map((a, i) => (
        <g key={i}>
          <line x1={a.x0} y1={a.y0} x2={a.x1} y2={a.y1} stroke="#2f3033" strokeWidth={14} strokeLinecap="round" />
          <line x1={a.x0 - 3} y1={a.y0 - 6} x2={a.x1 - 3} y2={a.y1 + 4} stroke="rgba(255,255,255,0.14)" strokeWidth={3} strokeLinecap="round" />
          <rect x={a.x0 - 16} y={a.y0 - 12} width={32} height={14} rx={4} fill="#2a2b2e" />
        </g>
      ))}
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={28} fill={`url(#${gid})`} stroke={color.borderStrong} strokeWidth={3} />
      <line x1={b.x + 26} x2={b.x + b.w - 26} y1={b.y + 3} y2={b.y + 3} stroke="rgba(255,255,255,0.22)" strokeWidth={2} strokeLinecap="round" />
      {/* vent slots along the top face */}
      {Array.from({ length: 14 }, (_, k) => <rect key={k} x={b.x + 90 + k * 26} y={b.y + 22} width={14} height={34} rx={6} fill="#121213" />)}
      {/* feet */}
      {[b.x + 50, b.x + b.w - 90].map((x) => <rect key={x} x={x} y={b.y + b.h - 2} width={40} height={8} rx={3} fill="#232427" />)}
      {Array.from({ length: RT.led.n }, (_, i) => {
        const on = active ? (i + Math.floor(f / 3)) % 2 === 0 : hit > 0.2 && i === 0;
        return <circle key={i} cx={RT.led.x0 + i * RT.led.dx} cy={RT.led.y} r={RT.led.r} fill={on ? color.accent : color.textDim} opacity={on ? 1 : 0.5} />;
      })}
      <rect x={RT.port.x} y={RT.port.y} width={RT.port.w} height={RT.port.h} rx={8} fill="#0c0c0d" stroke={color.borderStrong} strokeWidth={2} />
      <rect x={RT.port.x + 14} y={RT.port.y + 4} width={RT.port.w - 28} height={4} rx={2} fill="#2f3033" />
    </svg>
  );
};

export const Router = defineComponent({ ...meta, Render });
