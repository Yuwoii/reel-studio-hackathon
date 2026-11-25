// (a) WatchBack: a generic smartwatch underside (illustrative layout, no real product's arrangement), 720×860 px at
// world (0,0). Anchors normalised to the box (WATCH_ANCHORS) — the same layout the 3D discs use.
import React from "react";
import { color } from "../../v2/theme";
import { heartPulse, ledGreen } from "../theme";

export const WB = { w: 720, h: 860 } as const;
export const WATCH_ANCHORS = {
  case: { x: 0.5, y: 0.5 },
  sensor: { x: 0.5, y: 0.5, r: 0.3 },
  led_l: { x: 0.44, y: 0.5, r: 0.045 },
  led_r: { x: 0.56, y: 0.5, r: 0.045 },
  pd_top: { x: 0.5, y: 0.38, r: 0.05 },
  pd_left: { x: 0.36, y: 0.52, r: 0.05 },
  pd_right: { x: 0.64, y: 0.52, r: 0.05 },
  pd_bottom: { x: 0.5, y: 0.64, r: 0.05 },
} as const;
export type WatchAnchor = keyof typeof WATCH_ANCHORS;
export const wbPx = (a: WatchAnchor) => ({ x: WATCH_ANCHORS[a].x * WB.w, y: WATCH_ANCHORS[a].y * WB.h });

/** Green LED with a pulsing glow (radial gradients only — no CSS filter). */
export const LedGlow: React.FC<{ cx: number; cy: number; r: number; level: number; id: string }> = ({ cx, cy, r, level, id }) => (
  <>
    <defs>
      <radialGradient id={`${id}-halo`}>
        <stop offset="0%" stopColor={ledGreen(0.55 * level)} />
        <stop offset="45%" stopColor={ledGreen(0.18 * level)} />
        <stop offset="100%" stopColor={ledGreen(0)} />
      </radialGradient>
      <radialGradient id={`${id}-core`}>
        <stop offset="0%" stopColor={ledGreen(0.35 + 0.65 * level)} />
        <stop offset="70%" stopColor={ledGreen(0.25 + 0.6 * level)} />
        <stop offset="100%" stopColor={ledGreen(0.15 + 0.3 * level)} />
      </radialGradient>
    </defs>
    <circle cx={cx} cy={cy} r={r * 3.2} fill={`url(#${id}-halo)`} />
    <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-core)`} stroke={color.borderStrong} strokeWidth={2} />
  </>
);

export const WatchBack: React.FC<{ frame: number; pulseFrom: number }> = ({ frame, pulseFrom }) => {
  const { w, h } = WB;
  const level = heartPulse(frame, pulseFrom);
  const s = WATCH_ANCHORS.sensor;
  const R = (k: WatchAnchor) => (WATCH_ANCHORS[k] as { r: number }).r * w;
  const P = wbPx;
  return (
    <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {/* band stubs */}
      <rect x={w * 0.22} y={-h * 0.08} width={w * 0.56} height={h * 0.24} rx={18} fill={color.bgRaised} stroke={color.border} strokeWidth={2} />
      <rect x={w * 0.22} y={h * 0.84} width={w * 0.56} height={h * 0.24} rx={18} fill={color.bgRaised} stroke={color.border} strokeWidth={2} />
      {/* case */}
      <rect x={w * 0.04} y={h * 0.1} width={w * 0.92} height={h * 0.8} rx={w * 0.2} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={4} />
      <rect x={w * 0.09} y={h * 0.15} width={w * 0.82} height={h * 0.7} rx={w * 0.16} fill="none" stroke={color.border} strokeWidth={2} />
      {/* crown + button on the side */}
      <rect x={w * 0.955} y={h * 0.3} width={w * 0.035} height={h * 0.1} rx={8} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={2} />
      <rect x={w * 0.955} y={h * 0.48} width={w * 0.025} height={h * 0.14} rx={6} fill={color.bgRaised2} stroke={color.border} strokeWidth={2} />
      {/* sensor window */}
      <circle cx={s.x * w} cy={s.y * h} r={s.r * w + 14} fill="none" stroke={color.border} strokeWidth={2} />
      <circle cx={s.x * w} cy={s.y * h} r={s.r * w} fill={color.bg} stroke={color.borderStrong} strokeWidth={3} />
      {(["pd_top", "pd_left", "pd_right", "pd_bottom"] as const).map((k) => (
        <g key={k}>
          <circle cx={P(k).x} cy={P(k).y} r={R(k)} fill={color.bgRaised} stroke={color.textFaint} strokeWidth={3} />
          <circle cx={P(k).x - R(k) * 0.3} cy={P(k).y - R(k) * 0.3} r={R(k) * 0.22} fill={color.textFainter} />
        </g>
      ))}
      <LedGlow cx={P("led_l").x} cy={P("led_l").y} r={R("led_l")} level={level} id="wb-ledl" />
      <LedGlow cx={P("led_r").x} cy={P("led_r").y} r={R("led_r")} level={level} id="wb-ledr" />
    </svg>
  );
};
