// WifiSignal renderer (meta: src/v3/components-meta/WifiSignal.ts).
import React from "react";
import { interpolate } from "remotion";
import { meta, WF, type WifiSignalPropsT } from "../../../src/v3/components-meta/WifiSignal";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX } from "../../v2/motion";
import { color } from "../../v2/theme";

const Render: React.FC<RenderProps<WifiSignalPropsT>> = ({ frame, state, last }) => {
  const active = state.name === "active";
  const lp = last("pulse");
  // a sweep: arcs light inner → outer over sweepF (looping while active)
  const sweep = active ? (frame % WF.sweepF) / WF.sweepF : lp !== undefined ? interpolate(frame, [lp, lp + WF.sweepF], [0, 1], clampX) : -1;
  const arc = (r: number) => {
    const a = (45 * Math.PI) / 180;
    const x0 = WF.cx - r * Math.sin(a), y0 = WF.cy - r * Math.cos(a), x1 = WF.cx + r * Math.sin(a);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0}`;
  };
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={WF.w} height={WF.h}>
      <circle cx={WF.cx} cy={WF.cy} r={20} fill={active || sweep >= 0 ? color.accent : color.text} />
      {WF.r.map((r, i) => {
        const on = sweep >= 0 && sweep * 3 >= i && sweep * 3 < i + 1.6;
        return <path key={i} d={arc(r)} fill="none" stroke={on ? color.accent : color.text} strokeWidth={22} strokeLinecap="round" opacity={on ? 1 : 0.8} />;
      })}
    </svg>
  );
};

export const WifiSignal = defineComponent({ ...meta, Render });
