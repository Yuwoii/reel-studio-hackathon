// Building renderer (meta: src/v3/components-meta/Building.ts).
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { BD, meta, type BuildingPropsT } from "../../../src/v3/components-meta/Building";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX } from "../../v2/motion";
import { color } from "../../v2/theme";

const Render: React.FC<RenderProps<BuildingPropsT>> = ({ frame, state, id }) => {
  const g = (n: string) => `bd-${n}-${id}`;
  const mix = (on: boolean) => (on ? (state.f === null ? 1 : interpolate(frame, [state.f, state.f + 10], [0, 1], clampX)) : 0);
  const doorGlow = state.name === "door" ? mix(true) : state.name === "mailroom" ? 1 : 0;
  const mailGlow = state.name === "mailroom" ? mix(true) : 0;
  const wins: React.ReactNode[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const lit = (r * 7 + c * 3) % 5 === 0;
      const x = BD.win.x0 + c * BD.win.dx, y = BD.win.y0 + r * BD.win.dy;
      wins.push(
        <g key={`${r}-${c}`}>
          <rect x={x - 4} y={y - 4} width={BD.win.w + 8} height={BD.win.h + 8} rx={10} fill="#2c2d30" />
          <rect x={x} y={y} width={BD.win.w} height={BD.win.h} rx={6} fill={lit ? `url(#${g("lit")})` : `url(#${g("glass")})`} />
          <line x1={x + BD.win.w / 2} x2={x + BD.win.w / 2} y1={y} y2={y + BD.win.h} stroke="#2c2d30" strokeWidth={4} />
          <line x1={x + 6} x2={x + BD.win.w * 0.4} y1={y + 8} y2={y + 8} stroke="rgba(255,255,255,0.10)" strokeWidth={3} strokeLinecap="round" />
        </g>,
      );
    }
  const d = BD.door;
  const m = BD.mailroom;
  const s = BD.side;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={BD.w} height={BD.h}>
      <defs>
        <linearGradient id={g("body")} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#252629" /><stop offset="70%" stopColor="#1c1d1f" /><stop offset="100%" stopColor="#161618" /></linearGradient>
        <linearGradient id={g("glass")} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#1d2228" /><stop offset="100%" stopColor="#111315" /></linearGradient>
        <linearGradient id={g("lit")} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b3a33" /><stop offset="100%" stopColor="#2a2925" /></linearGradient>
      </defs>
      {/* rooftop plant room + antenna: a building silhouette, not a box */}
      <rect x={BD.body.x + 380} y={BD.roof.y - 42} width={150} height={44} rx={6} fill="#1f2022" stroke={color.border} strokeWidth={2} />
      <line x1={BD.body.x + 140} x2={BD.body.x + 140} y1={BD.roof.y - 60} y2={BD.roof.y} stroke={color.borderStrong} strokeWidth={4} />
      <rect x={BD.roof.x} y={BD.roof.y} width={BD.roof.w} height={BD.roof.h} rx={8} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={3} />
      <rect x={BD.body.x} y={BD.body.y} width={BD.body.w} height={BD.body.h} rx={12} fill={`url(#${g("body")})`} stroke={color.borderStrong} strokeWidth={3} />
      {/* floor bands */}
      {[0, 1, 2, 3, 4].map((k) => <line key={k} x1={BD.body.x + 6} x2={BD.body.x + BD.body.w - 6} y1={BD.win.y0 - 18 + k * BD.win.dy} y2={BD.win.y0 - 18 + k * BD.win.dy} stroke="rgba(255,255,255,0.06)" strokeWidth={3} />)}
      {wins}
      {/* entrance canopy + step */}
      <rect x={d.x - 30} y={d.y - 26} width={d.w + 60} height={16} rx={5} fill="#2c2d30" stroke={color.borderStrong} strokeWidth={2} />
      <rect x={d.x - 20} y={BD.groundY - 2} width={d.w + 40} height={10} rx={3} fill="#232427" />
      <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={10} fill={color.bgRaised2} stroke={interpolateColors(mailGlow, [0, 1], [color.border, color.accent])} strokeWidth={3} />
      <rect x={m.x + 6} y={m.y + 6} width={m.w - 12} height={m.h - 12} rx={6} fill={color.accent} opacity={0.18 * mailGlow} />
      {[0, 1, 2].map((i) => <rect key={i} x={m.x + 22 + i * 42} y={m.y + 58} width={30} height={20} rx={3} fill={color.textFaint} opacity={0.4 + 0.6 * mailGlow} />)}
      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={10} fill={color.bgRaised2} stroke={color.border} strokeWidth={2} />
      <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={10} fill={color.bg} stroke={interpolateColors(doorGlow, [0, 1], [color.borderStrong, color.accent])} strokeWidth={4} />
      <rect x={d.x + 8} y={d.y + 8} width={d.w - 16} height={d.h - 8} rx={6} fill={color.accent} opacity={0.12 * doorGlow} />
      <line x1={d.x + d.w / 2} y1={d.y} x2={d.x + d.w / 2} y2={d.y + d.h} stroke={color.border} strokeWidth={2} />
      <line x1={0} y1={BD.groundY} x2={BD.w} y2={BD.groundY} stroke={color.borderStrong} strokeWidth={3} />
    </svg>
  );
};

export const Building = defineComponent({ ...meta, Render });
