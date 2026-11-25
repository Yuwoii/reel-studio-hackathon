// Glow renderer (meta: src/v3/components-meta/Glow.ts). Radial gradient only (no CSS filter).
import React from "react";
import { interpolate } from "remotion";
import { GLOW, glowGeom, meta, type GlowPropsT } from "../../../src/v3/components-meta/Glow";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX } from "../../v2/motion";
import { color, font, radius } from "../../v2/theme";
import { ledLevel, returnedLevel } from "./ppg";
import { LED_GREEN } from "./tokens";

const ACC = { r: 0xd4, g: 0xf8, b: 0x4a };

const Render: React.FC<RenderProps<GlowPropsT>> = ({ props: p, frame, enterF, exitF, size, id }) => {
  const a = (enterF === null ? 1 : interpolate(frame, [enterF, enterF + 10], [0, 1], clampX)) * (exitF === null ? 1 : interpolate(frame, [exitF, exitF + 8], [1, 0], clampX));
  if (a <= 0) return null;
  const g = glowGeom(p);
  const level = p.mode === "steady" ? 1 : p.mode === "shimmer" ? ledLevel(frame) : returnedLevel(frame, p.bpm, p.dip, 30, enterF ?? 0);
  const c = p.light === "led" ? LED_GREEN : ACC;
  const k = p.onPhoto ? GLOW.photoAlpha : 1;
  const rgba = (al: number) => `rgba(${c.r}, ${c.g}, ${c.b}, ${(Math.max(0, Math.min(1, al)) * a * k).toFixed(3)})`;
  const gid = `glow-${id}`;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h }}>
      <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={size.w} height={size.h}>
        <defs>
          <radialGradient id={gid} cx={g.ax} cy={g.ay} r={g.R} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={rgba(0.62 * level)} />
            <stop offset={`${(100 * p.r) / g.R * 0.7}%`} stopColor={rgba(0.4 * level)} />
            <stop offset="100%" stopColor={rgba(0)} />
          </radialGradient>
        </defs>
        <circle cx={g.ax} cy={g.ay} r={g.R} fill={`url(#${gid})`} />
      </svg>
      {g.label && p.label ? (
        <div style={{ position: "absolute", left: g.label.x, top: g.label.y, width: g.label.w, height: g.label.h, boxSizing: "border-box", background: color.bgRaised, border: `1px solid ${color.borderStrong}`, borderRadius: radius.pill, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.mono, fontSize: GLOW.labelPx, color: color.text, whiteSpace: "pre", opacity: a }}>{p.label}</div>
      ) : null}
    </div>
  );
};

export const Glow = defineComponent({ ...meta, Render });
