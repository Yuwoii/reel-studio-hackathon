// ServerRack renderer (meta: src/v3/components-meta/ServerRack.ts).
import React from "react";
import { meta, SR, unitY, type ServerRackPropsT } from "../../../src/v3/components-meta/ServerRack";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { flash } from "../../v2/motion";
import { color } from "../../v2/theme";
import { hash01 } from "./ppg";

/** Drive-bay layout per server (varied so the rack reads as real, mixed hardware, not 8 copies). */
function bays(i: number): { x: number; w: number }[] {
  const k = i % 3;
  if (k === 1) return [0, 1].map((j) => ({ x: SR.bay.x0 + j * 124, w: 112 }));
  if (k === 2) return Array.from({ length: 6 }, (_, j) => ({ x: SR.bay.x0 + j * 41, w: 32 }));
  return [0, 1, 2, 3].map((j) => ({ x: SR.bay.x0 + j * SR.bay.dx, w: SR.bay.w }));
}

const Render: React.FC<RenderProps<ServerRackPropsT>> = ({ props: p, f, frame, state, last, id }) => {
  const busy = state.name === "busy";
  const fl = flash(frame, last("focus"), 8);
  const F = SR.frame;
  const g = (n: string) => `sr-${n}-${id}`;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={SR.w} height={SR.h}>
      <defs>
        {/* top-lit metal: lighter at the top edge of every surface */}
        <linearGradient id={g("frame")} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#262628" /><stop offset="100%" stopColor="#141415" /></linearGradient>
        <linearGradient id={g("unit")} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2e2f32" /><stop offset="55%" stopColor="#222325" /><stop offset="100%" stopColor="#1a1a1c" /></linearGradient>
        <linearGradient id={g("bay")} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0e0e0f" /><stop offset="100%" stopColor="#19191b" /></linearGradient>
      </defs>
      <rect x={F.x} y={F.y} width={F.w} height={F.h} rx={18} fill={`url(#${g("frame")})`} stroke={color.borderStrong} strokeWidth={4} />
      <line x1={F.x + 18} x2={F.x + F.w - 18} y1={F.y + 3} y2={F.y + 3} stroke="rgba(255,255,255,0.22)" strokeWidth={2} strokeLinecap="round" />
      {[F.x + 22, F.x + F.w - 28].map((x) => (
        <g key={x}>
          <rect x={x} y={F.y + 30} width={6} height={F.h - 60} rx={3} fill={color.bgRaised2} />
          {Array.from({ length: 26 }, (_, k) => <rect key={k} x={x + 1.5} y={F.y + 44 + k * 39} width={3} height={6} rx={1} fill="#0b0b0c" />)}
        </g>
      ))}
      {/* a few cables leaving the back-right corner (rack reality, not a box) */}
      <path d={`M ${F.x + F.w - 6} ${F.y + 160} C ${F.x + F.w + 40} ${F.y + 220}, ${F.x + F.w + 18} ${F.y + 420}, ${F.x + F.w + 30} ${F.y + 640}`} fill="none" stroke="#2a2b2e" strokeWidth={9} strokeLinecap="round" />
      <path d={`M ${F.x + F.w - 6} ${F.y + 300} C ${F.x + F.w + 26} ${F.y + 360}, ${F.x + F.w + 8} ${F.y + 560}, ${F.x + F.w + 18} ${F.y + 760}`} fill="none" stroke="#232427" strokeWidth={7} strokeLinecap="round" />
      {Array.from({ length: p.units }, (_, k) => {
        const i = k + 1;
        const y = unitY(i);
        const act = p.active === i;
        return (
          <g key={i}>
            {/* rack ears with screws */}
            {[SR.unit.x - 14, SR.unit.x + SR.unit.w + 2].map((x) => (
              <g key={x}>
                <rect x={x} y={y + 8} width={12} height={SR.unit.h - 16} rx={3} fill="#2a2b2e" />
                <circle cx={x + 6} cy={y + 24} r={3.5} fill="#0d0d0e" />
                <circle cx={x + 6} cy={y + SR.unit.h - 24} r={3.5} fill="#0d0d0e" />
              </g>
            ))}
            <rect x={SR.unit.x} y={y} width={SR.unit.w} height={SR.unit.h} rx={10} fill={`url(#${g("unit")})`} stroke={act ? color.accent : color.border} strokeWidth={act ? 3 + 2 * fl : 2} />
            <line x1={SR.unit.x + 10} x2={SR.unit.x + SR.unit.w - 10} y1={y + 2.5} y2={y + 2.5} stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeLinecap="round" />
            {bays(i).map((b, j) => (
              <g key={j}>
                <rect x={b.x} y={y + 20} width={b.w} height={SR.bay.h} rx={6} fill={`url(#${g("bay")})`} stroke={color.border} strokeWidth={2} />
                <rect x={b.x + 6} y={y + SR.bay.h + 6} width={Math.max(10, b.w * 0.45)} height={5} rx={2.5} fill="#3a3b3f" />
              </g>
            ))}
            {Array.from({ length: 20 }, (_, j) => <circle key={j} cx={SR.vent.x0 + (j % 5) * 20} cy={y + 30 + Math.floor(j / 5) * 14} r={3.2} fill="#0c0c0d" />)}
            {[0, 1, 2].map((j) => {
              const on = busy ? hash01(i * 31 + j * 7 + Math.floor(f / 2) * 13) > 0.45 : j === 0;
              return <circle key={j} cx={SR.led.x0 + j * SR.led.dx} cy={y + SR.led.dy} r={SR.led.r} fill={on ? color.accent : color.textDim} opacity={on ? 1 : 0.45} />;
            })}
            <rect x={SR.led.x0 - 6} y={y + 70} width={56} height={12} rx={6} fill={color.bg} />
          </g>
        );
      })}
    </svg>
  );
};

export const ServerRack = defineComponent({ ...meta, Render });
