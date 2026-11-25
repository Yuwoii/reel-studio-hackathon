// CaptionScrim renderer (meta: src/v3/components-meta/CaptionScrim.ts) + `CaptionBandScrim`, the plain fixed layer
// for ExplainerV3: mount it once between the moving world and SubtitleCard —
//   <CaptionBandScrim />            (defaults: y 1220 → 1560, 85 %)
import React from "react";
import { interpolate } from "remotion";
import { CaptionScrimProps, CS, meta, type CaptionScrimPropsT } from "../../../src/v3/components-meta/CaptionScrim";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX } from "../../v2/motion";

/** rgba of the v2 bg (#131313) at alpha a. */
const bgA = (a: number) => `rgba(19,19,19,${Math.max(0, Math.min(1, a)).toFixed(3)})`;

function gradient(strength: number): string {
  return `linear-gradient(to bottom, ${bgA(0)} 0%, ${bgA(strength * 0.6)} ${CS.solidFrom * 60}%, ${bgA(strength)} ${CS.solidFrom * 100}%, ${bgA(strength)} 100%)`;
}

/** Fixed full-width band in FRAME px (no camera): for ExplainerV3 / boards that want it all reel long. */
export const CaptionBandScrim: React.FC<Partial<CaptionScrimPropsT>> = (p) => {
  const q = CaptionScrimProps.parse(p);
  return <div style={{ position: "absolute", left: 0, top: q.top, width: CS.w, height: q.bottom - q.top, background: gradient(q.strength), pointerEvents: "none" }} />;
};

const Render: React.FC<RenderProps<CaptionScrimPropsT>> = ({ props: p, frame, enterF, exitF, size }) => {
  const inO = enterF === null ? 1 : interpolate(frame, [enterF, enterF + 8], [0, 1], clampX);
  const outO = exitF === null ? 1 : interpolate(frame, [exitF, exitF + 8], [1, 0], clampX);
  if (inO * outO <= 0) return null;
  return <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, background: gradient(p.strength), opacity: inO * outO, pointerEvents: "none" }} />;
};

export const CaptionScrim = defineComponent({ ...meta, Render });
