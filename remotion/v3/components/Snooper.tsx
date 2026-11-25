// Snooper renderer (meta: src/v3/components-meta/Snooper.ts). Flat drawn person in a hood (facing left by default,
// mirrored for "right"), holding a magnifying glass; in "looking" the lens is in front of the eye and shows it big.
import React from "react";
import { interpolate } from "remotion";
import { meta, SN, snooperGeom, type SnooperPropsT } from "../../../src/v3/components-meta/Snooper";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color } from "../../v2/theme";

const Render: React.FC<RenderProps<SnooperPropsT>> = ({ props: p, frame, state, last, size, id }) => {
  const w = p.w;
  const g = snooperGeom(w);
  const sf = state.f;
  const look = state.name === "looking" ? (sf === null ? 1 : interpolate(frame, [sf, sf + SN.lookF], [0, 1], clampX)) : 0;
  const lean = flash(frame, last("pulse"), 8);
  const L = { x: interpolate(look, [0, 1], [g.lensDown.x, g.lensUp.x]), y: interpolate(look, [0, 1], [g.lensDown.y, g.lensUp.y]), r: interpolate(look, [0, 1], [g.lensDown.r, g.lensUp.r]) };
  // handle runs down-right from the lens to the hand
  const ang = interpolate(look, [0, 1], [0.9, 1.05]);
  const hx = L.x + Math.cos(ang) * (L.r + w * 0.17), hy = L.y + Math.sin(ang) * (L.r + w * 0.17);
  const hs = L.x + Math.cos(ang) * L.r, hsy = L.y + Math.sin(ang) * L.r;
  const shoulder = { x: 0.5 * w, y: 0.74 * w };
  const elbow = { x: interpolate(look, [0, 1], [0.48 * w, 0.52 * w]), y: interpolate(look, [0, 1], [0.98 * w, 0.86 * w]) };
  const H = g.head;
  const hood = "#2b2c2f";
  const skin = "#9a9a9a";
  const sw = Math.max(2.5, w * 0.009);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={size.w} height={size.h}>
      <defs>
        <clipPath id={`sn-lens-${id}`}><circle cx={L.x} cy={L.y} r={L.r * 0.86} /></clipPath>
      </defs>
      <g transform={`${p.facing === "right" ? `translate(${w} 0) scale(-1 1)` : ""} translate(${-lean * w * 0.03} ${lean * w * 0.01})`}>
        {/* torso + hood (behind the head) */}
        <path d={`M ${0.1 * w} ${g.H} C ${0.12 * w} ${0.8 * w}, ${0.3 * w} ${0.64 * w}, ${0.56 * w} ${0.62 * w} C ${0.82 * w} ${0.64 * w}, ${0.98 * w} ${0.8 * w}, ${w} ${g.H} Z`} fill={hood} stroke={color.borderStrong} strokeWidth={sw} />
        <path d={`M ${H.x - H.r * 1.45} ${H.y + H.r * 1.5} C ${H.x - H.r * 1.6} ${H.y - H.r * 0.4}, ${H.x - H.r * 0.9} ${H.y - H.r * 1.55}, ${H.x + H.r * 0.2} ${H.y - H.r * 1.5} C ${H.x + H.r * 1.4} ${H.y - H.r * 1.45}, ${H.x + H.r * 1.75} ${H.y - H.r * 0.2}, ${H.x + H.r * 1.45} ${H.y + H.r * 1.6} Z`} fill={hood} stroke={color.borderStrong} strokeWidth={sw} />
        {/* face (profile hint: nose to the left) */}
        <circle cx={H.x} cy={H.y} r={H.r} fill={skin} />
        <path d={`M ${H.x - H.r * 0.92} ${H.y - H.r * 0.1} L ${H.x - H.r * 1.18} ${H.y + H.r * 0.22} L ${H.x - H.r * 0.9} ${H.y + H.r * 0.3}`} fill={skin} />
        <path d={`M ${H.x - H.r * 0.75} ${H.y - H.r * 0.42} L ${H.x - H.r * 0.15} ${H.y - H.r * 0.5}`} stroke="#3a3a3a" strokeWidth={sw * 1.4} strokeLinecap="round" />
        <ellipse cx={g.eye.x} cy={g.eye.y} rx={w * 0.03} ry={w * 0.022} fill={color.text} />
        <circle cx={g.eye.x - w * 0.012} cy={g.eye.y} r={w * 0.013} fill={color.bg} />
        <path d={`M ${H.x - H.r * 0.7} ${H.y + H.r * 0.55} L ${H.x - H.r * 0.3} ${H.y + H.r * 0.5}`} stroke="#555" strokeWidth={sw} strokeLinecap="round" />
        {/* arm: shoulder → elbow → hand */}
        <path d={`M ${shoulder.x} ${shoulder.y} Q ${elbow.x} ${elbow.y} ${hx} ${hy}`} fill="none" stroke={hood} strokeWidth={w * 0.09} strokeLinecap="round" />
        <path d={`M ${shoulder.x} ${shoulder.y} Q ${elbow.x} ${elbow.y} ${hx} ${hy}`} fill="none" stroke={color.borderStrong} strokeWidth={sw} strokeLinecap="round" opacity={0.6} />
        {/* magnifier: handle, rim, lens */}
        <line x1={hs} y1={hsy} x2={hx} y2={hy} stroke="#3d3e42" strokeWidth={w * 0.035} strokeLinecap="round" />
        <circle cx={hx} cy={hy} r={w * 0.04} fill={skin} />
        <circle cx={L.x} cy={L.y} r={L.r * 0.92} fill="rgba(200,220,255,0.10)" />
        {look > 0.5 ? (
          <g clipPath={`url(#sn-lens-${id})`} opacity={interpolate(look, [0.5, 1], [0, 1], clampX)}>
            {/* the eye, magnified through the lens */}
            <ellipse cx={L.x + L.r * 0.05} cy={L.y} rx={L.r * 0.5} ry={L.r * 0.34} fill={color.text} />
            <circle cx={L.x - L.r * 0.12} cy={L.y} r={L.r * 0.22} fill={color.bg} />
            <circle cx={L.x - L.r * 0.2} cy={L.y - L.r * 0.08} r={L.r * 0.06} fill={color.text} />
          </g>
        ) : null}
        <circle cx={L.x} cy={L.y} r={L.r * 0.92} fill="none" stroke={color.text} strokeWidth={w * 0.025} />
        <path d={`M ${L.x - L.r * 0.55} ${L.y - L.r * 0.35} A ${L.r * 0.65} ${L.r * 0.65} 0 0 1 ${L.x - L.r * 0.1} ${L.y - L.r * 0.65}`} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={w * 0.012} strokeLinecap="round" />
      </g>
    </svg>
  );
};

export const Snooper = defineComponent({ ...meta, Render });
