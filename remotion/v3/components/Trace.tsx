// Trace renderer (meta: src/v3/components-meta/Trace.ts).
import React from "react";
import { interpolate } from "remotion";
import { meta, TRACE, traceGeom, type TracePropsT } from "../../../src/v3/components-meta/Trace";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, drawOn } from "../../v2/motion";
import { color } from "../../v2/theme";
import { ledGreen } from "./tokens";

const Render: React.FC<RenderProps<TracePropsT>> = ({ props: p, frame, enterF, exitF, size }) => {
  const e0 = enterF ?? -TRACE.drawF;
  if (frame < e0) return null;
  const out = exitF !== null ? interpolate(frame, [exitF, exitF + 8], [1, 0], clampX) : 1;
  if (out <= 0) return null;
  const g = traceGeom(p);
  const segs = g.pts.slice(1).map((q, i) => Math.hypot(q.x - g.pts[i].x, q.y - g.pts[i].y));
  const len = segs.reduce((s, x) => s + x, 0);
  const prog = drawOn(frame, e0, TRACE.drawF);
  const col = p.style === "light" ? ledGreen(0.9) : p.style === "data" ? color.accent : color.textDim;
  const d = g.pts.map((q, i) => `${i ? "L" : "M"} ${q.x} ${q.y}`).join(" ");
  const at = (s: number) => {
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= s) {
        const t = segs[i] ? (s - acc) / segs[i] : 0;
        return { x: g.pts[i].x + (g.pts[i + 1].x - g.pts[i].x) * t, y: g.pts[i].y + (g.pts[i + 1].y - g.pts[i].y) * t, i };
      }
      acc += segs[i];
    }
    const e = g.pts[g.pts.length - 1];
    return { x: e.x, y: e.y, i: segs.length - 1 };
  };
  const tip = at(len * prog);
  const last = g.pts[tip.i];
  const ang = Math.atan2(tip.y - last.y, tip.x - last.x);
  const dotS = p.dot && prog >= 1 ? (((frame - e0 - TRACE.drawF) % TRACE.loopF) / TRACE.loopF) * len : null;
  const dp = dotS !== null ? at(dotS) : null;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: out }} width={size.w} height={size.h}>
      <path d={d} fill="none" stroke={col} strokeWidth={TRACE.stroke} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${len}`} strokeDashoffset={len * (1 - prog)} />
      {p.arrow && prog > 0.05 ? <path d={`M ${tip.x} ${tip.y} L ${tip.x - 18 * Math.cos(ang - 0.45)} ${tip.y - 18 * Math.sin(ang - 0.45)} M ${tip.x} ${tip.y} L ${tip.x - 18 * Math.cos(ang + 0.45)} ${tip.y - 18 * Math.sin(ang + 0.45)}`} fill="none" stroke={col} strokeWidth={TRACE.stroke} strokeLinecap="round" /> : null}
      {dp ? <circle cx={dp.x} cy={dp.y} r={TRACE.dotR} fill={col} /> : null}
    </svg>
  );
};

export const Trace = defineComponent({ ...meta, Render });
