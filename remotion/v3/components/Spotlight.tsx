// Spotlight renderer (meta: src/v3/components-meta/Spotlight.ts). A radial gradient (transparent hole → bg at `dim`).
import React from "react";
import { interpolate } from "remotion";
import { meta, SPOT, type SpotlightPropsT } from "../../../src/v3/components-meta/Spotlight";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX } from "../../v2/motion";
import { color } from "../../v2/theme";

const Render: React.FC<RenderProps<SpotlightPropsT>> = ({ props: p, frame, enterF, exitF, id }) => {
  const a = (enterF === null ? 1 : interpolate(frame, [enterF, enterF + SPOT.fadeF], [0, 1], clampX)) * (exitF === null ? 1 : interpolate(frame, [exitF, exitF + 8], [1, 0], clampX));
  if (a <= 0) return null;
  const cx = SPOT.w / 2, cy = SPOT.h / 2;
  const R = p.r * (1 + SPOT.feather);
  const gid = `spot-${id}`;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0 }} width={SPOT.w} height={SPOT.h}>
      <defs>
        <radialGradient id={gid} cx={cx} cy={cy} r={R} gradientUnits="userSpaceOnUse">
          <stop offset={`${(100 * p.r) / R}%`} stopColor={color.bg} stopOpacity={0} />
          <stop offset="100%" stopColor={color.bg} stopOpacity={p.dim * a} />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={SPOT.w} height={SPOT.h} fill={`url(#${gid})`} />
    </svg>
  );
};

export const Spotlight = defineComponent({ ...meta, Render });
