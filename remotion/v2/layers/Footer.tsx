// Screen-fixed footer (amendments §1): footerTop → footerBottom gradient from the 1 px hairline at y = 1560 to the
// bottom edge, plus a soft fade of the world into it. Nothing important lives here (platform UI).
import React from "react";
import { AbsoluteFill } from "remotion";
import { color, layout } from "../theme";

/** Soft floor above the hairline (W2 fix): the world (mostly DataField rows — focal content ends at 1400) fades toward
 *  the footer instead of stopping on a hard line. Eased (zero slope at the top), ≤ 85 % bg at the hairline. */
const FLOOR_TOP = layout.focal.bottom + 40;
const FLOOR_STOPS = [0, 0.25, 0.5, 0.75, 1].map((t) => {
  const a = 0.85 * t * t * (3 - 2 * t);
  return `color-mix(in srgb, ${color.bg} ${(a * 100).toFixed(1)}%, transparent) ${(FLOOR_TOP + t * (layout.footer.top - FLOOR_TOP)).toFixed(1)}px`;
});

export const Footer: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: layout.footer.top, background: `linear-gradient(transparent 0px, ${FLOOR_STOPS.join(", ")})` }} />
    <div style={{ position: "absolute", left: 0, top: layout.footer.top, width: "100%", height: layout.footer.bottom - layout.footer.top, background: `linear-gradient(${color.footerTop}, ${color.footerBottom})` }} />
    <div style={{ position: "absolute", left: 0, top: layout.hairlineY, width: "100%", height: 1, background: color.hairline }} />
  </AbsoluteFill>
);
