// Headphones renderer (meta: src/v3/components-meta/Headphones.ts). Waves are pure functions of the frame.
import React from "react";
import { interpolate } from "remotion";
import { HP, meta, type HeadphonesPropsT } from "../../../src/v3/components-meta/Headphones";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX } from "../../v2/motion";
import { color } from "../../v2/theme";

/** Sine polyline from x0 to x1 at baseline y, amplitude a, wavelength L, phase ph (rad). */
function wave(x0: number, x1: number, y: number, a: number, L: number, ph: number): string {
  const pts: string[] = [];
  for (let x = x0; x <= x1; x += 4) pts.push(`${x},${(y + a * Math.sin(((x - x0) / L) * 2 * Math.PI + ph)).toFixed(1)}`);
  return `M ${pts.join(" L ")}`;
}

const Pair: React.FC<{ on: number; id: string }> = ({ on, id }) => {
  const P = HP.pair;
  const g = (n: string) => `hp-${n}-${id}`;
  const cup = (c: { x: number; y: number; w: number; h: number }, side: 1 | -1) => (
    <g>
      {/* yoke (the fork holding the cup) */}
      <path d={`M ${c.x + c.w / 2} ${c.y - 18} V ${c.y + 30}`} stroke="#3a3b3f" strokeWidth={14} strokeLinecap="round" />
      {/* cushion edge on the inner side, then the filled, top-lit cup shell */}
      <rect x={c.x + (side === 1 ? c.w - 34 : -6)} y={c.y + 14} width={40} height={c.h - 28} rx={20} fill="#151516" stroke={color.border} strokeWidth={2} />
      <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={70} fill={`url(#${g("cup")})`} stroke={color.borderStrong} strokeWidth={4} />
      <rect x={c.x + 26} y={c.y + 26} width={c.w - 52} height={c.h - 52} rx={50} fill={`url(#${g("plate")})`} stroke={color.border} strokeWidth={2} />
      <path d={`M ${c.x + 36} ${c.y + 30} Q ${c.x + c.w / 2} ${c.y + 12} ${c.x + c.w - 36} ${c.y + 30}`} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={3} strokeLinecap="round" />
    </g>
  );
  const band = `M ${P.band.x0} ${P.band.yEnd} C ${P.band.x0} ${P.band.yTop - 40}, ${P.band.x1} ${P.band.yTop - 40}, ${P.band.x1} ${P.band.yEnd}`;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={HP.w} height={HP.h}>
      <defs>
        <linearGradient id={g("cup")} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#36373b" /><stop offset="50%" stopColor="#242528" /><stop offset="100%" stopColor="#18181a" /></linearGradient>
        <linearGradient id={g("plate")} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#2b2c2f" /><stop offset="100%" stopColor="#1b1b1d" /></linearGradient>
      </defs>
      <path d={band} fill="none" stroke="#2a2b2e" strokeWidth={40} strokeLinecap="round" />
      {/* padded underside of the headband */}
      <path d={band} fill="none" stroke="#1a1a1b" strokeWidth={22} strokeLinecap="round" transform="translate(0 12)" />
      <path d={band} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={3} transform="translate(0 -17)" />
      {cup(P.cupL, 1)}
      {cup(P.cupR, -1)}
      <circle cx={P.mic.x} cy={P.mic.y} r={10} fill={on > 0.5 ? color.accent : color.textDim} />
    </svg>
  );
};

const Cutaway: React.FC<{ on: number; frame: number }> = ({ on, frame }) => {
  const C = HP.cut;
  const y = HP.waveY;
  const ph = (frame / 30) * 2 * Math.PI * 0.8;
  const s = C.shell;
  // D-shaped shell open to the right (towards the ear)
  const shell = `M ${s.x + s.w} ${s.y} H ${s.x + 110} Q ${s.x} ${s.y} ${s.x} ${s.y + 110} V ${s.y + s.h - 110} Q ${s.x} ${s.y + s.h} ${s.x + 110} ${s.y + s.h} H ${s.x + s.w}`;
  const d = C.driver;
  const resid = interpolate(on, [0, 1], [26, 6], clampX);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={HP.w} height={HP.h}>
      <path d={wave(C.noise.x0, C.noise.x1, y, 34, 120, ph)} fill="none" stroke={color.textDim} strokeWidth={5} strokeLinecap="round" />
      <path d={shell} fill="none" stroke={color.borderStrong} strokeWidth={18} strokeLinejoin="round" />
      <path d={shell} fill="none" stroke={color.bgRaised2} strokeWidth={10} strokeLinejoin="round" />
      <rect x={C.mic.x - 16} y={C.mic.y - 22} width={32} height={44} rx={14} fill={on > 0.5 ? color.accent : color.bgRaised} stroke={color.borderStrong} strokeWidth={3} />
      <path d={`M ${d.x - 50} ${y - 40} L ${d.x + 30} ${y - d.h / 2} L ${d.x + 30} ${y + d.h / 2} L ${d.x - 50} ${y + 40} Z`} fill={color.bgRaised} stroke={color.borderStrong} strokeWidth={3} />
      <rect x={d.x - 80} y={y - 40} width={30} height={80} rx={6} fill={color.bgRaised2} stroke={color.border} strokeWidth={2} />
      <rect x={C.cushion.x} y={C.cushion.y} width={C.cushion.w} height={C.cushion.h} rx={28} fill={color.bgRaised2} stroke={color.border} strokeWidth={3} />
      {on > 0 ? <path d={wave(C.out.x0, C.out.x1, y, 30 * on, 56, ph + Math.PI)} fill="none" stroke={color.accent} strokeWidth={5} strokeLinecap="round" opacity={on} /> : null}
      <path d={wave(C.resid.x0, C.resid.x1, y, resid, 26, ph)} fill="none" stroke={color.textDim} strokeWidth={4} strokeLinecap="round" />
      <ellipse cx={C.ear.x} cy={C.ear.y} rx={48} ry={110} fill={color.bgRaised} stroke={color.borderStrong} strokeWidth={3} />
      <path d={`M ${C.ear.x + 6} ${C.ear.y - 60} Q ${C.ear.x - 28} ${C.ear.y - 20} ${C.ear.x - 4} ${C.ear.y + 20} Q ${C.ear.x + 18} ${C.ear.y + 50} ${C.ear.x - 10} ${C.ear.y + 70}`} fill="none" stroke={color.border} strokeWidth={4} strokeLinecap="round" />
    </svg>
  );
};

const Render: React.FC<RenderProps<HeadphonesPropsT>> = ({ props: p, frame, state, id }) => {
  const on = state.name === "anc" ? (state.f === null ? 1 : interpolate(frame, [state.f, state.f + 12], [0, 1], clampX)) : 0;
  return p.view === "pair" ? <Pair on={on} id={id} /> : <Cutaway on={on} frame={frame} />;
};

export const Headphones = defineComponent({ ...meta, Render });
