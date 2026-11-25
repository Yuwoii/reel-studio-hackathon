// SkinPPG renderer (meta: src/v3/components-meta/SkinPPG.ts). Everything is a pure function of the frame through the
// meta's model (ppgBeat / modeAt / backLevel / returnedAt / vesselScale), so the vessels, the light coming back and the
// trace dip on the SAME beats. LEDs = steady glow (ppg.ledLevel shimmer), never at heart rate (R1 facts review W02).
import React from "react";
import { interpolate } from "remotion";
import { backLevel, meta, modeAt, returnedAt, SKIN, skinHash, skinHeight, vesselScale, watchOffset, type SkinPPGPropsT } from "../../../src/v3/components-meta/SkinPPG";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color, font } from "../../v2/theme";
import { ledLevel } from "./ppg";
import { ledGreen, tissue } from "./tokens";
import { LedDisc } from "./WatchBack";

const cubic = (c: readonly number[], dx = 0, dy = 0) => `M ${c[0] + dx} ${c[1] + dy} C ${c[2] + dx} ${c[3] + dy}, ${c[4]} ${c[5]}, ${c[6]} ${c[7]}`;
const cubicBack = (c: readonly number[], dx = 0, dy = 0) => `M ${c[0]} ${c[1]} C ${c[2]} ${c[3]}, ${c[4] + dx} ${c[5] + dy}, ${c[6] + dx} ${c[7] + dy}`;

/** Arrow head at the end of a cubic (direction from its last control point). */
function head(c: readonly number[], dx: number, dy: number, size: number): string {
  const ex = c[6] + dx, ey = c[7] + dy;
  const a = Math.atan2(ey - (c[5] + dy), ex - (c[4] + dx));
  return `M ${ex} ${ey} L ${ex - size * Math.cos(a - 0.5)} ${ey - size * Math.sin(a - 0.5)} M ${ex} ${ey} L ${ex - size * Math.cos(a + 0.5)} ${ey - size * Math.sin(a + 0.5)}`;
}

const Render: React.FC<RenderProps<SkinPPGPropsT>> = ({ props: p, frame, f, events, base, last, changeF, prev, id }) => {
  const W = SKIN.w;
  const H = skinHeight(p);
  const m = modeAt(base.start, events, frame);
  const off = watchOffset(m, frame);
  const led = m.on * ledLevel(f);
  const back = backLevel(p, m, frame);
  const vs = vesselScale(p, frame);
  const g = (n: string) => `skin-${n}-${id}`;
  const S = SKIN.surface;
  const sensorGlow = flash(frame, last("pulse"), 6);
  const ring = flash(frame, last("focus"), 8);
  // contrast callout fades in over 10 f when switched on by a props override
  const cIn = p.contrast ? (changeF !== null && !prev.contrast ? interpolate(frame, [changeF, changeF + 10], [0, 1], clampX) : 1) : 0;
  const dash = (speed: number) => -((frame * speed) % 64);
  const rays = (["rayL", "rayR"] as const).map((k) => SKIN[k]);

  // ── trace strip ──
  let traceEl: React.ReactNode = null;
  if (p.trace) {
    const T = SKIN.trace;
    const n = T.windowF;
    const x0 = T.padX, x1 = T.w - T.padX;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const fi = Math.floor(f) - (n - i);
      const mi = modeAt(base.start, events, fi);
      const v = returnedAt(p, mi, fi);
      const x = x0 + ((x1 - x0) * i) / n;
      const y = T.bottom - v * (T.bottom - T.top);
      pts.push(`${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const vNow = returnedAt(p, m, Math.floor(f));
    const yNow = T.bottom - vNow * (T.bottom - T.top);
    traceEl = (
      <g>
        <rect x={T.x + 2} y={T.y} width={T.w - 4} height={T.h} rx={16} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={2} />
        <text x={T.padX} y={T.y + 44} fill={color.textDim} style={{ fontFamily: font.mono, fontSize: 26, letterSpacing: "0.02em" }}>{p.traceLabel}</text>
        <line x1={x0} x2={x1} y1={T.bottom} y2={T.bottom} stroke={color.border} strokeWidth={1} />
        <path d={pts.join(" ")} fill="none" stroke={m.on > 0.01 ? ledGreen(0.9) : color.textDim} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x1} cy={yNow} r={9} fill={m.on > 0.01 ? ledGreen(1) : color.textDim} />
      </g>
    );
  }

  // ── callout: green soaked up, red bounces back ──
  let callout: React.ReactNode = null;
  if (cIn > 0) {
    const C = SKIN.callout;
    const vx = C.cx - 10, vy = C.cy + 16;
    callout = (
      <g opacity={cIn}>
        <line x1={450 + 24 * vs} y1={560} x2={C.cx - C.r * 0.8} y2={C.cy + C.r * 0.55} stroke={color.borderStrong} strokeWidth={2} strokeDasharray="6 6" />
        <circle cx={C.cx} cy={C.cy} r={C.r} fill={color.bgRaised} stroke={color.borderStrong} strokeWidth={3} />
        <circle cx={vx} cy={vy} r={50 * vs} fill={tissue.blood} stroke={tissue.bloodDeep} strokeWidth={4} />
        <circle cx={vx - 16} cy={vy - 18} r={12} fill={tissue.bloodHi} />
        {/* green ray ends at the blood: soaked up */}
        <path d={`M ${C.cx - 96} ${C.cy - 70} L ${vx - 38 * vs} ${vy - 34 * vs}`} stroke={ledGreen(0.95)} strokeWidth={8} strokeLinecap="round" strokeDasharray="14 10" strokeDashoffset={dash(2)} />
        <circle cx={vx - 40 * vs} cy={vy - 36 * vs} r={9} fill={ledGreen(0.35)} />
        {/* red light bounces back out */}
        <path d={`M ${vx + 30 * vs} ${vy - 40 * vs} L ${C.cx + 84} ${C.cy - 82}`} stroke={tissue.blood} strokeWidth={8} strokeLinecap="round" strokeDasharray="14 10" strokeDashoffset={dash(2)} />
        <path d={`M ${C.cx + 84} ${C.cy - 82} l -22 2 M ${C.cx + 84} ${C.cy - 82} l -4 21`} stroke={tissue.blood} strokeWidth={8} strokeLinecap="round" />
        <rect x={C.cx - 150} y={C.cy + C.r + 14} width={300} height={92} rx={14} fill={color.bgRaised} stroke={color.border} strokeWidth={2} />
        <text x={C.cx} y={C.cy + C.r + 50} textAnchor="middle" fill={ledGreen(1)} style={{ fontFamily: font.mono, fontSize: 26 }}>green: soaked up</text>
        <text x={C.cx} y={C.cy + C.r + 86} textAnchor="middle" fill={tissue.bloodText} style={{ fontFamily: font.mono, fontSize: 26 }}>red: bounces back</text>
      </g>
    );
  }

  // ── loose: room light under the watch ──
  let ambientEl: React.ReactNode = null;
  if (m.loose > 0.02) {
    const yg = S + off.dy / 2; // middle of the gap
    const fl = 0.55 + 0.45 * skinHash(f);
    const a = (k: number) => tissue.ambient(m.loose * fl * k);
    ambientEl = (
      <g>
        {[-1, 1].map((side) => {
          const xe = side < 0 ? 0 : W;
          return (
            <g key={side}>
              <path d={`M ${xe} ${yg - 150} L ${xe} ${yg - 60} L ${SKIN.sensor.x} ${yg + 4} Z`} fill={a(0.12)} />
              <path d={`M ${xe + side * -30} ${yg - 120} L ${SKIN.sensor.x + side * 30} ${yg}`} stroke={a(0.7)} strokeWidth={5} strokeLinecap="round" strokeDasharray="16 12" strokeDashoffset={dash(3)} />
            </g>
          );
        })}
        {/* some LED light escapes sideways through the gap */}
        <path d={`M ${SKIN.ledL.x + off.dx} ${yg} L ${150} ${yg}`} stroke={ledGreen(0.5 * m.loose * led)} strokeWidth={6} strokeLinecap="round" strokeDasharray="14 12" strokeDashoffset={dash(3)} />
        <path d={`M ${SKIN.ledR.x + off.dx} ${yg} L ${W - 150} ${yg}`} stroke={ledGreen(0.5 * m.loose * led)} strokeWidth={6} strokeLinecap="round" strokeDasharray="14 12" strokeDashoffset={dash(3)} />
      </g>
    );
  }

  const cb = SKIN.caseBox, dm = SKIN.dome;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <linearGradient id={g("case")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#36373b" />
          <stop offset="100%" stopColor="#1c1c1e" />
        </linearGradient>
        <radialGradient id={g("sens")}>
          <stop offset="0%" stopColor={ledGreen(0.6 * back + 0.4 * sensorGlow)} />
          <stop offset="100%" stopColor={ledGreen(0)} />
        </radialGradient>
        <clipPath id={g("tissue")}>
          <rect x={0} y={S} width={W} height={SKIN.fatTo - S} />
        </clipPath>
      </defs>

      {/* tissue layers */}
      <rect x={0} y={S} width={W} height={SKIN.epiTo - S} fill={tissue.epidermis} />
      <rect x={0} y={SKIN.epiTo} width={W} height={SKIN.dermisTo - SKIN.epiTo} fill={tissue.dermis} />
      <rect x={0} y={SKIN.dermisTo} width={W} height={SKIN.fatTo - SKIN.dermisTo} fill={tissue.fat} />
      <g clipPath={`url(#${g("tissue")})`}>
        {Array.from({ length: 9 }, (_, i) => (
          <ellipse key={i} cx={50 + i * 100 + (i % 2) * 30} cy={SKIN.dermisTo + 60 + (i % 3) * 22} rx={44} ry={30} fill="none" stroke={tissue.fatCell} strokeWidth={3} />
        ))}
        {/* vessels (cut across): swell on every beat */}
        {SKIN.vessels.map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r * vs} fill={tissue.blood} stroke={tissue.bloodDeep} strokeWidth={3} />
            <circle cx={x - r * 0.3} cy={y - r * 0.32} r={r * 0.28} fill={tissue.bloodHi} />
          </g>
        ))}
        {ring > 0.01 ? <circle cx={450} cy={545} r={330} fill="none" stroke={color.accent} strokeOpacity={ring} strokeWidth={4} /> : null}
      </g>
      <line x1={0} x2={W} y1={S} y2={S} stroke={tissue.line} strokeWidth={3} />
      {/* light paths: in (steady, LED level) → back to the sensor (dimmer while the vessels are full) */}
      {led > 0.01
        ? rays.map((r, i) => (
            <g key={i}>
              <path d={cubic(r.in, off.dx, off.dy)} fill="none" stroke={ledGreen(0.16 * led)} strokeWidth={26} strokeLinecap="round" />
              <path d={cubic(r.in, off.dx, off.dy)} fill="none" stroke={ledGreen(0.92 * led)} strokeWidth={7} strokeLinecap="round" strokeDasharray="18 14" strokeDashoffset={dash(3)} />
              <path d={cubicBack(r.back, off.dx, off.dy)} fill="none" stroke={ledGreen(0.16 * back * back)} strokeWidth={26} strokeLinecap="round" />
              <path d={cubicBack(r.back, off.dx, off.dy)} fill="none" stroke={ledGreen(0.06 + 0.9 * back * back)} strokeWidth={3 + 4 * back} strokeLinecap="round" strokeDasharray="18 14" strokeDashoffset={dash(3)} />
            </g>
          ))
        : null}
      <line x1={0} x2={W} y1={SKIN.epiTo} y2={SKIN.epiTo} stroke={color.border} strokeWidth={2} />
      <line x1={0} x2={W} y1={SKIN.dermisTo} y2={SKIN.dermisTo} stroke={color.border} strokeWidth={2} />
      <line x1={0} x2={W} y1={SKIN.fatTo} y2={SKIN.fatTo} stroke={color.borderStrong} strokeWidth={2} strokeDasharray="10 8" />
      {/* the back-arrow heads sit just under the sensor (in front of the epidermis) */}
      {led > 0.01 ? rays.map((r, i) => <path key={i} d={head(r.back, off.dx, off.dy, 18)} fill="none" stroke={ledGreen(0.1 + 0.9 * back * back)} strokeWidth={6} strokeLinecap="round" />) : null}

      {/* motion: the watch shifts on the wrist (a double arrow over the case) */}
      {m.motion > 0.02 ? (
        <g opacity={m.motion} stroke={color.text} strokeWidth={5} strokeLinecap="round" fill="none">
          <path d={`M ${cb.x + 60} ${cb.y - 34} H ${cb.x + cb.w - 60}`} />
          <path d={`M ${cb.x + 60} ${cb.y - 34} l 18 -12 M ${cb.x + 60} ${cb.y - 34} l 18 12 M ${cb.x + cb.w - 60} ${cb.y - 34} l -18 -12 M ${cb.x + cb.w - 60} ${cb.y - 34} l -18 12`} />
        </g>
      ) : null}

      {ambientEl}

      {/* watch: strap + case + underside, moved by the loose gap / motion jiggle */}
      <g transform={`translate(${off.dx} ${off.dy})`}>
        <rect x={-20} y={SKIN.strapY} width={cb.x + 40} height={SKIN.strapH} rx={18} fill="#2a2b2e" stroke={color.border} strokeWidth={2} />
        <rect x={cb.x + cb.w - 20} y={SKIN.strapY} width={W - cb.x - cb.w + 40} height={SKIN.strapH} rx={18} fill="#2a2b2e" stroke={color.border} strokeWidth={2} />
        <rect x={cb.x} y={cb.y} width={cb.w} height={cb.h} rx={48} fill={`url(#${g("case")})`} stroke={color.borderStrong} strokeWidth={4} />
        <path d={`M ${cb.x + 50} ${cb.y + 16} Q ${cb.x + cb.w / 2} ${cb.y + 2} ${cb.x + cb.w - 50} ${cb.y + 16}`} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={3} strokeLinecap="round" />
        <rect x={dm.x} y={dm.y} width={dm.w} height={dm.h} rx={14} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={3} />
        <circle cx={SKIN.sensor.x} cy={SKIN.sensor.y} r={46} fill={`url(#${g("sens")})`} />
        <rect x={SKIN.sensor.x - 18} y={SKIN.sensor.y - 12} width={36} height={22} rx={5} fill={color.bg} stroke={color.textFaint} strokeWidth={3} />
        <LedDisc cx={SKIN.ledL.x} cy={SKIN.ledL.y} r={14} level={led} id={g("ledL")} />
        <LedDisc cx={SKIN.ledR.x} cy={SKIN.ledR.y} r={14} level={led} id={g("ledR")} />
      </g>

      {callout}
      {traceEl}
    </svg>
  );
};

export const SkinPPG = defineComponent({ ...meta, Render });
