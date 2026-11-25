// v3lab overlays: screen-space primitives bound to an anchor's SCREEN position (computed per frame by the shot), so
// they follow the moving plate but keep their own pixel size (text never scales below type.minText).
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { clampX, drawOn, enterProgress } from "../v2/motion";
import { color, font, layout, radius, type, vignetteCss } from "../v2/theme";

export interface Pt {
  x: number;
  y: number;
}

/** Background, vignette, a clipped stage (top 150 to 1560) for the real-object shot, and the dark footer. */
export const Stage: React.FC<{ children: React.ReactNode; overlay?: React.ReactNode }> = ({ children, overlay }) => (
  <AbsoluteFill style={{ background: color.bg }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: layout.stage.bottom, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0 }}>{children}</div>
    </div>
    <AbsoluteFill style={{ background: vignetteCss, pointerEvents: "none" }} />
    <div style={{ position: "absolute", left: 0, top: layout.footer.top, width: 1080, height: layout.footer.bottom - layout.footer.top, background: `linear-gradient(${color.footerTop}, ${color.footerBottom})` }} />
    <div style={{ position: "absolute", left: 0, top: layout.hairlineY, width: 1080, height: 2, background: color.hairline }} />
    {overlay}
  </AbsoluteFill>
);

/** 3 px accent ring drawn on over 8 f, then a soft pulse (period 1.2 s). */
export const AnchorRing: React.FC<{ at: Pt; r: number; frame: number; enterF: number; exitF?: number }> = ({ at, r, frame, enterF, exitF }) => {
  if (frame < enterF || (exitF !== undefined && frame >= exitF + 8)) return null;
  const p = drawOn(frame, enterF, 8);
  const pulse = frame >= enterF + 8 ? 0.5 + 0.5 * Math.cos(((frame - enterF - 8) / 36) * 2 * Math.PI) : 1;
  const out = exitF !== undefined ? interpolate(frame, [exitF, exitF + 8], [1, 0], clampX) : 1;
  const c = 2 * Math.PI * r;
  const halo = r + 6 + 8 * (1 - pulse);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: out }} width={1080} height={1920}>
      <circle cx={at.x} cy={at.y} r={halo} fill="none" stroke={color.markAccent} strokeWidth={2} opacity={p >= 1 ? 0.3 + 0.7 * (1 - pulse) : 0} />
      <circle cx={at.x} cy={at.y} r={r} fill="none" stroke={color.accent} strokeWidth={3} strokeLinecap="round"
        strokeDasharray={`${c}`} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${at.x} ${at.y})`} />
    </svg>
  );
};

/**
 * Mono pill (type.pill 30 px) on bgRaised with a 2 px leader to the anchor. `offset` places the pill's centre
 * relative to the anchor (screen px). Enters with the shared spring.
 */
export const LabelPill: React.FC<{ at: Pt; text: string; offset: Pt; frame: number; enterF: number; exitF?: number; accent?: boolean }> = ({ at, text, offset, frame, enterF, exitF, accent }) => {
  if (frame < enterF) return null;
  const e = enterProgress(frame, enterF);
  const out = exitF !== undefined ? interpolate(frame, [exitF, exitF + 8], [1, 0], clampX) : 1;
  if (out <= 0) return null;
  const px = type.pill.size;
  const w = Math.round(text.length * px * 0.6 + 2 * 26);
  const h = 60;
  const cx = at.x + offset.x;
  const cy = at.y + offset.y;
  // leader: from the anchor to the nearest point on the pill box
  const nx = Math.min(Math.max(at.x, cx - w / 2), cx + w / 2);
  const ny = Math.min(Math.max(at.y, cy - h / 2), cy + h / 2);
  const lead = drawOn(frame, enterF, 10);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1080} height={1920}>
        <line x1={at.x} y1={at.y} x2={at.x + (nx - at.x) * lead} y2={at.y + (ny - at.y) * lead} stroke={color.borderStrong} strokeWidth={2} />
        <circle cx={at.x} cy={at.y} r={6} fill={accent ? color.accent : color.text} />
      </svg>
      <div style={{
        position: "absolute", left: cx - w / 2, top: cy - h / 2, width: w, height: h, boxSizing: "border-box",
        background: color.bgRaised, border: `2px solid ${color.borderStrong}`, borderRadius: radius.pill,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: font.mono, fontWeight: type.pill.weight, fontSize: px, color: accent ? color.accent : color.text, whiteSpace: "pre",
        opacity: e, transform: `translateY(${(1 - e) * 12}px) scale(${0.97 + 0.03 * e})`,
      }}>{text}</div>
    </div>
  );
};

/** Top-left option tag ("A · ILLUSTRATION"), type.header, textDim. */
export const OptionTag: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", left: layout.headerLeftTextX, top: layout.headerTextTop - 6, padding: "10px 18px",
    background: color.bgRaised, border: `1px solid ${color.border}`, borderRadius: radius.pill,
    fontFamily: font.mono, fontWeight: type.header.weight, fontSize: 26, letterSpacing: type.header.tracking, color: color.textDim, whiteSpace: "pre" }}>
    {text}
  </div>
);

/** Footer note (attribution / source), mono 26, textDim. */
export const FooterNote: React.FC<{ text: string; line?: number }> = ({ text, line = 0 }) => (
  <div style={{ position: "absolute", left: layout.margin, top: layout.footer.top + 48 + line * 44, width: 1080 - 2 * layout.margin,
    fontFamily: font.mono, fontWeight: 400, fontSize: type.minText, letterSpacing: "0.02em", color: color.textDim, whiteSpace: "pre" }}>
    {text}
  </div>
);
