// WatchBack renderer (meta: src/v3/components-meta/WatchBack.ts). Radial gradients only, no CSS filter.
// measuring: LEDs = ppg.ledLevel (steady + per-frame shimmer); the returned-light halo around each light sensor =
// ppg.returnedLevel (dips once per beat). Never the other way round (R1 facts review W02).
import React from "react";
import { interpolate } from "remotion";
import { meta, WB, WB_PARTS, type WatchBackPropsT } from "../../../src/v3/components-meta/WatchBack";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color } from "../../v2/theme";
import { ledLevel, returnedLevel } from "./ppg";
import { ledGreen } from "./tokens";

const P = (k: keyof typeof WB_PARTS) => ({ x: WB_PARTS[k].x * WB.w, y: WB_PARTS[k].y * WB.h, r: WB_PARTS[k].r * WB.w });

/** LED disc with a glow halo; `level` 0..1. */
export const LedDisc: React.FC<{ cx: number; cy: number; r: number; level: number; id: string }> = ({ cx, cy, r, level, id }) => (
  <>
    <defs>
      <radialGradient id={`${id}-halo`}>
        <stop offset="0%" stopColor={ledGreen(0.55 * level)} />
        <stop offset="45%" stopColor={ledGreen(0.18 * level)} />
        <stop offset="100%" stopColor={ledGreen(0)} />
      </radialGradient>
      <radialGradient id={`${id}-core`}>
        <stop offset="0%" stopColor={ledGreen(0.2 + 0.8 * level)} />
        <stop offset="70%" stopColor={ledGreen(0.15 + 0.7 * level)} />
        <stop offset="100%" stopColor={ledGreen(0.1 + 0.35 * level)} />
      </radialGradient>
    </defs>
    {level > 0 ? <circle cx={cx} cy={cy} r={r * 3.2} fill={`url(#${id}-halo)`} /> : null}
    <circle cx={cx} cy={cy} r={r} fill={level > 0 ? `url(#${id}-core)` : color.bgRaised2} stroke={color.borderStrong} strokeWidth={2} />
  </>
);

const Render: React.FC<RenderProps<WatchBackPropsT>> = ({ props: p, frame, state, last }) => {
  const { w, h } = WB;
  const on = state.name === "measuring";
  const fromF = on ? (state.f ?? 0) : 0;
  const ramp = on ? (state.f === null ? 1 : interpolate(frame, [fromF, fromF + 8], [0, 1], clampX)) : 0;
  const led = on ? ledLevel(frame) * ramp : 0;
  const ret = on ? returnedLevel(frame, p.bpm, p.dip, 30, fromF) * ramp : 0;
  const s = P("sensorWindow");
  const ring = flash(frame, last("focus"), 8);
  return (
    <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <radialGradient id="wb-ret">
          <stop offset="0%" stopColor={ledGreen(0.42 * ret)} />
          <stop offset="60%" stopColor={ledGreen(0.12 * ret)} />
          <stop offset="100%" stopColor={ledGreen(0)} />
        </radialGradient>
      </defs>
      <rect x={w * 0.22} y={0} width={w * 0.56} height={h * 0.14} rx={18} fill={color.bgRaised} stroke={color.border} strokeWidth={2} />
      <rect x={w * 0.22} y={h * 0.86} width={w * 0.56} height={h * 0.14} rx={18} fill={color.bgRaised} stroke={color.border} strokeWidth={2} />
      <rect x={w * 0.04} y={h * 0.1} width={w * 0.92} height={h * 0.8} rx={w * 0.2} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={4} />
      <rect x={w * 0.09} y={h * 0.15} width={w * 0.82} height={h * 0.7} rx={w * 0.16} fill="none" stroke={color.border} strokeWidth={2} />
      <rect x={w * 0.955} y={h * 0.3} width={w * 0.035} height={h * 0.1} rx={8} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={2} />
      <rect x={w * 0.955} y={h * 0.48} width={w * 0.025} height={h * 0.14} rx={6} fill={color.bgRaised2} stroke={color.border} strokeWidth={2} />
      <circle cx={s.x} cy={s.y} r={s.r + 14} fill="none" stroke={ring > 0.01 ? color.accent : color.border} strokeOpacity={ring > 0.01 ? ring : 1} strokeWidth={2} />
      <circle cx={s.x} cy={s.y} r={s.r} fill={color.bg} stroke={color.borderStrong} strokeWidth={3} />
      {(["sensor.top", "sensor.left", "sensor.right", "sensor.bottom"] as const).map((k) => {
        const q = P(k);
        return (
          <g key={k}>
            {on ? <circle cx={q.x} cy={q.y} r={q.r * 2.1} fill="url(#wb-ret)" /> : null}
            <circle cx={q.x} cy={q.y} r={q.r} fill={color.bgRaised} stroke={color.textFaint} strokeWidth={3} />
            <circle cx={q.x - q.r * 0.3} cy={q.y - q.r * 0.3} r={q.r * 0.22} fill={color.textFainter} />
          </g>
        );
      })}
      {(["led.left", "led.right"] as const).map((k) => {
        const q = P(k);
        return <LedDisc key={k} cx={q.x} cy={q.y} r={q.r} level={led} id={`wb-${k.replace(".", "-")}`} />;
      })}
    </svg>
  );
};

export const WatchBack = defineComponent({ ...meta, Render });
