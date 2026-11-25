// Particles: every PARTICLES kind. Fully deterministic — positions come from remotion's seeded random() and the
// frame number (never Math.random), so every render/still/Lambda chunk draws identical frames.

import React from "react";
import { random, useCurrentFrame } from "remotion";
import type { Scene } from "../../src/schema/index.js";
import { useTheme } from "../styles";

type Kind = Scene["particles"]["kind"];

const W = 1180;
const H = 2020;

function maxCount(kind: Kind): number {
  switch (kind) {
    case "none":
      return 0;
    case "snow":
      return 90;
    case "rain":
      return 110;
    case "sparkles":
      return 40;
    case "dust":
      return 60;
    case "bubbles":
      return 35;
    case "leaves":
      return 30;
    default: {
      const _x: never = kind;
      return 0;
    }
  }
}

/** Wrap v into [0, m). */
const wrap = (v: number, m: number) => ((v % m) + m) % m;

export const Particles: React.FC<{ kind: Kind; intensity: number; seed: number }> = ({ kind, intensity, seed }) => {
  const frame = useCurrentFrame();
  const { palette, style } = useTheme();
  const n = Math.round(maxCount(kind) * Math.min(1, Math.max(0.08, intensity)));
  if (n === 0) return null;
  const r = (k: string, i: number) => random(`${seed}-${kind}-${k}-${i}`);
  const items: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const depth = 0.5 + r("d", i); // 0.5..1.5: size + speed
    const x0 = r("x", i) * W - 50;
    const y0 = r("y", i) * H - 50;
    switch (kind) {
      case "none":
        break;
      case "snow": {
        const y = wrap(y0 + frame * 2.2 * depth, H) - 50;
        const x = wrap(x0 + Math.sin(frame / 25 + i) * 22 * depth, W) - 50;
        items.push(<circle key={i} cx={x} cy={y} r={4 + 6 * depth} fill="#ffffff" opacity={0.65 + 0.3 * r("o", i)} />);
        break;
      }
      case "rain": {
        const y = wrap(y0 + frame * 26 * depth, H) - 50;
        const x = wrap(x0 - frame * 5 * depth, W) - 50;
        items.push(<line key={i} x1={x} y1={y} x2={x - 10 * depth} y2={y + 46 * depth} stroke="#cfe8ff" strokeWidth={3 + 2 * depth} strokeLinecap="round" opacity={0.6} />);
        break;
      }
      case "sparkles": {
        const life = 40 + r("l", i) * 40;
        const ph = wrap(frame + r("p", i) * life, life) / life; // 0..1 lifecycle
        const s = Math.sin(ph * Math.PI) * (14 + 14 * depth);
        // respawn at a new spot each cycle
        const cyc = Math.floor((frame + r("p", i) * life) / life);
        const x = random(`${seed}-spx-${i}-${cyc}`) * 1000 + 20;
        const y = random(`${seed}-spy-${i}-${cyc}`) * 1300 + 200;
        const col = i % 3 === 0 ? palette.highlight : "#ffffff";
        items.push(
          <path
            key={i}
            d={`M${x},${y - s} Q${x},${y} ${x + s},${y} Q${x},${y} ${x},${y + s} Q${x},${y} ${x - s},${y} Q${x},${y} ${x},${y - s} Z`}
            fill={col}
            opacity={0.9}
          />,
        );
        break;
      }
      case "dust": {
        const x = wrap(x0 + frame * 1.6 * depth, W) - 50;
        const y = y0 + Math.sin(frame / 30 + i) * 30;
        items.push(<circle key={i} cx={x} cy={y} r={2 + 4 * depth} fill="#e8d2a8" opacity={0.35 + 0.3 * r("o", i)} />);
        break;
      }
      case "bubbles": {
        const y = wrap(y0 - frame * 3 * depth, H) - 50;
        const x = x0 + Math.sin(frame / 14 + i) * 16;
        const rad = 8 + 14 * depth;
        items.push(
          <g key={i} opacity={0.75}>
            <circle cx={x} cy={y} r={rad} fill="#bfe9ff" fillOpacity={0.15} stroke="#e8f8ff" strokeWidth={3} />
            <circle cx={x - rad * 0.35} cy={y - rad * 0.35} r={rad * 0.22} fill="#ffffff" />
          </g>,
        );
        break;
      }
      case "leaves": {
        const y = wrap(y0 + frame * 2.6 * depth, H) - 50;
        const x = wrap(x0 + Math.sin(frame / 20 + i) * 40 + frame * 1.2, W) - 50;
        const rot = (frame * 3 * (i % 2 ? 1 : -1) + r("r", i) * 360) % 360;
        const col = [palette.accent, palette.primary, "#e0a030", "#7fbf4f"][i % 4];
        items.push(<path key={i} d="M0,-14 C10,-6 10,6 0,14 C-10,6 -10,-6 0,-14 Z" fill={col} transform={`translate(${x} ${y}) rotate(${rot}) scale(${0.9 + depth * 0.6})`} />);
        break;
      }
      default: {
        const _x: never = kind;
      }
    }
  }
  return <g shapeRendering={style.pixelSize ? "crispEdges" : undefined}>{items}</g>;
};
