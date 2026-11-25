// debugSafeZone overlay: shades the Reels UI insets red and outlines the text box + layout bands.

import React from "react";
import { BANDS, FRAME, GROUND_Y, SAFE, TEXT_BOX } from "../safeZone";

export const SafeZoneDebug: React.FC = () => {
  const band = (name: string, b: { top: number; bottom: number }, col: string) => (
    <g key={name}>
      <rect x={TEXT_BOX.left} y={b.top} width={TEXT_BOX.right - TEXT_BOX.left} height={b.bottom - b.top} fill="none" stroke={col} strokeWidth={3} strokeDasharray="14 8" />
      {/* label sits in the right inset column (outside the text box) so it never covers HUD/title text */}
      <text x={FRAME.width - 8} y={b.top + 22} fill={col} fontSize={18} fontFamily="monospace" textAnchor="end" stroke="#000" strokeWidth={4} paintOrder="stroke">
        {name}
      </text>
    </g>
  );
  return (
    <svg width={FRAME.width} height={FRAME.height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <g fill="#ff0040" opacity={0.28}>
        <rect x={0} y={0} width={FRAME.width} height={SAFE.top} />
        <rect x={0} y={SAFE.bottom} width={FRAME.width} height={FRAME.height - SAFE.bottom} />
        <rect x={SAFE.right} y={SAFE.top} width={FRAME.width - SAFE.right} height={SAFE.bottom - SAFE.top} />
      </g>
      <rect x={SAFE.left + 2} y={SAFE.top} width={SAFE.right - SAFE.left - 4} height={SAFE.bottom - SAFE.top} fill="none" stroke="#ff0040" strokeWidth={4} />
      {band("HUD", BANDS.hud, "#00e5ff")}
      {band("TITLE", BANDS.title, "#ffe600")}
      {band("STAGE", BANDS.stage, "#7CFF00")}
      {band("CAPTIONS", BANDS.captions, "#ff9f00")}
      <line x1={0} x2={FRAME.width} y1={GROUND_Y} y2={GROUND_Y} stroke="#ffffff" strokeWidth={2} strokeDasharray="6 6" />
    </svg>
  );
};
