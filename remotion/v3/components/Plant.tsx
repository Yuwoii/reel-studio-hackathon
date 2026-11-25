// Plant renderer (meta: src/v3/components-meta/Plant.ts). One <svg>, all vector: a sky card (day ↔ night blend from
// nightAt), the ground strip, the plant (rooted sway about its base), the pore marks (open/shut by poresOpen), rings.
import React from "react";
import { interpolate } from "remotion";
import { meta, nightAt, PLANT, poresOpen, type PlantKind, type PlantPropsT } from "../../../src/v3/components-meta/Plant";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color } from "../../v2/theme";
import { plant } from "./tokens";

const STARS = [[90, 120], [180, 260], [300, 90], [420, 210], [520, 80], [760, 290], [110, 420], [700, 470], [250, 360], [600, 330], [60, 640], [740, 640]] as const;

function Cactus() {
  const body = "M 330 930 L 330 300 Q 330 228 400 228 Q 470 228 470 300 L 470 930 Z";
  const armL = "M 334 660 L 262 660 Q 214 660 214 612 L 214 450 Q 214 404 256 404 Q 298 404 298 450 L 298 600 L 334 600 Z";
  const armR = "M 466 560 L 548 560 Q 590 560 590 518 L 590 360 Q 590 316 548 316 Q 506 316 506 360 L 506 500 L 466 500 Z";
  const spines: React.ReactNode[] = [];
  for (let y = 300; y < 920; y += 46) {
    for (const x of [330, 470]) spines.push(<path key={`${x}-${y}`} d={`M ${x} ${y} l ${x < 400 ? -14 : 14} -6 M ${x} ${y} l ${x < 400 ? -14 : 14} 6`} stroke={plant.spine} strokeWidth={2.5} strokeLinecap="round" />);
  }
  for (let y = 440; y < 650; y += 44) for (const x of [214, 298]) spines.push(<path key={`l${x}-${y}`} d={`M ${x} ${y} l ${x < 256 ? -12 : 12} -5 M ${x} ${y} l ${x < 256 ? -12 : 12} 5`} stroke={plant.spine} strokeWidth={2.5} strokeLinecap="round" />);
  for (let y = 350; y < 550; y += 44) for (const x of [506, 590]) spines.push(<path key={`r${x}-${y}`} d={`M ${x} ${y} l ${x < 548 ? -12 : 12} -5 M ${x} ${y} l ${x < 548 ? -12 : 12} 5`} stroke={plant.spine} strokeWidth={2.5} strokeLinecap="round" />);
  return (
    <g>
      {[armL, armR, body].map((d, k) => (
        <path key={k} d={d} fill={plant.stem} stroke={plant.stemRib} strokeWidth={4} strokeLinejoin="round" />
      ))}
      {[365, 400, 435].map((x) => (
        <path key={x} d={`M ${x} ${x === 400 ? 232 : 250} L ${x} 925`} stroke={plant.stemRib} strokeWidth={3} opacity={0.7} />
      ))}
      <path d="M 256 412 L 256 650" stroke={plant.stemRib} strokeWidth={3} opacity={0.7} />
      <path d="M 548 324 L 548 552" stroke={plant.stemRib} strokeWidth={3} opacity={0.7} />
      <path d="M 344 300 Q 346 250 392 240" fill="none" stroke={plant.leafHi} strokeWidth={6} strokeLinecap="round" opacity={0.6} />
      {spines}
    </g>
  );
}

function Corn() {
  const leaves: [number, number, number][] = [[820, -1, 230], [740, 1, 250], [660, -1, 240], [560, 1, 270], [470, -1, 220], [390, 1, 200]];
  return (
    <g>
      {leaves.map(([y, side, len], k) => {
        const tipX = 400 + side * len, tipY = y - 80 - (k % 2) * 30;
        const d = `M 400 ${y} Q ${400 + side * len * 0.55} ${y - 150} ${tipX} ${tipY} Q ${400 + side * len * 0.45} ${y - 100} 400 ${y + 26} Z`;
        return <path key={k} d={d} fill={k % 2 ? plant.leaf : plant.leafHi} stroke={plant.leafDeep} strokeWidth={3} strokeLinejoin="round" />;
      })}
      <rect x={389} y={250} width={22} height={680} rx={10} fill={plant.stem} stroke={plant.stemRib} strokeWidth={3} />
      {[360, 470, 580, 690, 800].map((y) => (
        <rect key={y} x={385} y={y} width={30} height={10} rx={4} fill={plant.stemRib} />
      ))}
      {/* tassel */}
      {[-30, -15, 0, 15, 30].map((dx, k) => (
        <path key={k} d={`M 400 258 Q ${400 + dx} 200 ${400 + dx * 1.8} ${170 + Math.abs(dx)}`} fill="none" stroke={plant.wheat} strokeWidth={5} strokeLinecap="round" />
      ))}
      {/* the cob in its husk */}
      <ellipse cx={444} cy={630} rx={30} ry={84} transform="rotate(14 444 630)" fill={plant.wheat} stroke={plant.wheatDeep} strokeWidth={3} />
      <path d="M 410 710 Q 420 600 450 540 Q 440 640 470 700 Z" fill={plant.leafHi} stroke={plant.leafDeep} strokeWidth={3} />
    </g>
  );
}

function Wheat() {
  const stalks = [[300, -40], [360, -16], [420, 8], [480, 30], [540, 50]] as const;
  return (
    <g>
      {stalks.map(([x, lean], k) => {
        const top = 300 + (k % 2) * 40;
        const tx = x + lean;
        return (
          <g key={k}>
            <path d={`M ${x} 930 Q ${x + lean * 0.3} 600 ${tx} ${top + 120}`} fill="none" stroke={plant.wheatDeep} strokeWidth={6} strokeLinecap="round" />
            {Array.from({ length: 7 }, (_, j) => (
              <g key={j}>
                <ellipse cx={tx - 9} cy={top + 110 - j * 17} rx={8} ry={13} transform={`rotate(-25 ${tx - 9} ${top + 110 - j * 17})`} fill={plant.wheat} stroke={plant.wheatDeep} strokeWidth={2} />
                <ellipse cx={tx + 9} cy={top + 110 - j * 17} rx={8} ry={13} transform={`rotate(25 ${tx + 9} ${top + 110 - j * 17})`} fill={plant.wheat} stroke={plant.wheatDeep} strokeWidth={2} />
              </g>
            ))}
            <path d={`M ${tx} ${top} l 0 -50`} stroke={plant.wheat} strokeWidth={2} />
          </g>
        );
      })}
      {/* leaves; the one on the left carries the pore marks */}
      <path d="M 298 790 Q 250 640 150 520 Q 280 620 304 740 Z" fill={plant.leaf} stroke={plant.leafDeep} strokeWidth={3} />
      <path d="M 490 760 Q 560 680 660 620 Q 570 700 494 806 Z" fill={plant.leafHi} stroke={plant.leafDeep} strokeWidth={3} />
      <path d="M 410 860 Q 330 820 240 800 Q 340 850 414 892 Z" fill={plant.leaf} stroke={plant.leafDeep} strokeWidth={3} />
    </g>
  );
}

const BODY: Record<PlantKind, React.FC> = { cactus: Cactus, corn: Corn, wheat: Wheat };

const Render: React.FC<RenderProps<PlantPropsT>> = ({ props: p, base, frame, events, last, id }) => {
  const night = nightAt(base.start, events, frame);
  const open = poresOpen(p.kind, night);
  const pc = PLANT.pores[p.kind];
  const sway = PLANT.swayDeg * Math.sin(frame / 48) * (p.kind === "cactus" ? 0.25 : 1);
  const ping = last("pulse");
  const pingT = ping === undefined ? 1 : interpolate(frame, [ping, ping + 10], [0, 1], clampX);
  const ring = flash(frame, last("focus"), 8);
  const g = (n: string) => `plant-${n}-${id}`;
  const S = PLANT.sun;
  const Body = BODY[p.kind];
  const GY = PLANT.ground;
  return (
    <svg width={PLANT.w} height={PLANT.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <linearGradient id={g("day")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={plant.daySky} />
          <stop offset="1" stopColor="#5F87A6" />
        </linearGradient>
        <linearGradient id={g("night")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0B0F1C" />
          <stop offset="1" stopColor={plant.nightSky} />
        </linearGradient>
        <clipPath id={g("card")}>
          <rect x={0} y={40} width={PLANT.w} height={PLANT.h - 40} rx={32} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${g("card")})`}>
        <rect x={0} y={40} width={PLANT.w} height={GY} fill={`url(#${g("day")})`} />
        <rect x={0} y={40} width={PLANT.w} height={GY} fill={`url(#${g("night")})`} opacity={night} />
        {STARS.map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r={k % 3 ? 2.5 : 3.5} fill={plant.star} opacity={night * (0.6 + 0.4 * Math.sin(frame / 20 + k))} />
        ))}
        {/* sun ↔ moon */}
        <g opacity={1 - night}>
          <circle cx={S.x} cy={S.y} r={S.r + 26} fill={plant.sun} opacity={0.18} />
          <circle cx={S.x} cy={S.y} r={S.r} fill={plant.sun} />
        </g>
        <g opacity={night}>
          <circle cx={S.x} cy={S.y} r={S.r * 0.85} fill={plant.moon} />
          <circle cx={S.x + 22} cy={S.y - 14} r={S.r * 0.72} fill="#0E1322" />
        </g>
        {/* ground */}
        <rect x={0} y={GY} width={PLANT.w} height={PLANT.h - GY} fill={p.kind === "cactus" ? plant.sand : plant.soil} />
        <path d={`M 0 ${GY} Q 200 ${GY - 14} 400 ${GY} T 800 ${GY}`} fill={p.kind === "cactus" ? plant.sand : plant.soilHi} />
        {/* the plant (rooted sway) */}
        <g transform={`rotate(${sway.toFixed(3)} 400 ${GY})`}>
          <Body />
          {p.pores
            ? [[-26, -14], [0, -24], [26, -14], [-30, 12], [0, 2], [30, 12], [0, 28]].map(([dx, dy], k) => (
                <g key={k}>
                  {open > 0.02 ? <circle cx={pc.x + dx} cy={pc.y + dy} r={9} fill={plant.moon} opacity={0.25 * open} /> : null}
                  <ellipse cx={pc.x + dx} cy={pc.y + dy} rx={6} ry={4.5} fill={plant.guard} stroke={plant.guardEdge} strokeWidth={1.5} />
                  <ellipse cx={pc.x + dx} cy={pc.y + dy} rx={1 + 1.6 * open} ry={3.4} fill={plant.airSpace} />
                </g>
              ))
            : null}
        </g>
        {/* night: the plant darkens with the sky */}
        <rect x={0} y={40} width={PLANT.w} height={PLANT.h - 40} fill="#060912" opacity={0.28 * night} />
      </g>
      <rect x={0} y={40} width={PLANT.w} height={PLANT.h - 40} rx={32} fill="none" stroke={color.borderStrong} strokeWidth={2} />
      {pingT < 1 ? <circle cx={pc.x} cy={pc.y} r={40 + 40 * pingT} fill="none" stroke={color.accent} strokeWidth={4} opacity={1 - pingT} /> : null}
      {ring > 0.01 ? <rect x={14} y={54} width={PLANT.w - 28} height={PLANT.h - 68} rx={26} fill="none" stroke={color.accent} strokeWidth={5} opacity={ring} /> : null}
    </svg>
  );
};

export const Plant = defineComponent({ ...meta, Render });
