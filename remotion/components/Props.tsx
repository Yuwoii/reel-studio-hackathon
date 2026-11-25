// Props: every PROPS kind drawn from basic shapes in a ±50 unit box, and every PROP_ANIMATIONS entry.
// Placement x/y (0..1) maps into the STAGE (safe zone minus text bands, see safeZone.ts) and the prop's box is
// kept fully inside it. Props pop in with a short staggered spring at the start of the beat.

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Palette, PropPlacement } from "../../src/schema/index.js";
import { darken, lighten } from "../color";
import { type AvoidBox, placeProp } from "../safeZone";
import { useCameraOffset } from "./CameraDrift";

export type { AvoidBox } from "../safeZone";
import { useTheme } from "../styles";

type Kind = PropPlacement["kind"];
type Anim = PropPlacement["animation"];

/** Base rendered size of a prop at scale 1 (px). */
export const PROP_BASE_PX = 150;

function defaultColor(kind: Kind, p: Palette): string {
  switch (kind) {
    case "sun":
    case "star":
    case "coin":
    case "lightbulb":
    case "lightning":
    case "trophy":
    case "key":
      return p.highlight;
    case "moon":
      return "#fff3c4";
    case "cloud":
    case "snowflake":
      return "#ffffff";
    case "tree":
    case "pine-tree":
    case "maze-wall":
      return darken(p.ground, 0.1);
    case "house":
    case "heart":
    case "fire":
    case "thermometer":
    case "chart-down":
    case "exclamation":
      return p.primary;
    case "globe":
    case "water-drop":
      return "#3fa9f5";
    case "arrow":
    case "question-mark":
    case "chart-up":
    case "clock":
    case "flower":
    case "door":
    case "ski":
      return p.accent;
    case "rock":
    case "mountain":
      return "#8d93a3";
    default: {
      const _x: never = kind;
      return p.primary;
    }
  }
}

/** Draws the shape in a ±50 box. `m` = main colour, `ink` = outline colour, `f` = beat frame (for inner motion). */
function drawProp(kind: Kind, m: string, p: Palette, ink: string, sw: number, f: number): React.ReactNode {
  const o = { stroke: ink, strokeWidth: sw, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  switch (kind) {
    case "sun":
      return (
        <g>
          {Array.from({ length: 10 }, (_, i) => (
            <rect key={i} x={-4} y={-50} width={8} height={16} rx={4} fill={m} transform={`rotate(${i * 36 + f * 0.8})`} />
          ))}
          <circle r={30} fill={m} {...o} />
          <circle r={18} fill={lighten(m, 0.4)} />
        </g>
      );
    case "moon":
      return <path d="M10,-44 A44,44 0 1,0 40,24 A34,34 0 1,1 10,-44 Z" fill={m} {...o} />;
    case "cloud":
      return (
        <g fill={m} {...o}>
          <path d="M-42,18 A18,18 0 0,1 -36,-12 A22,22 0 0,1 0,-26 A22,22 0 0,1 34,-10 A16,16 0 0,1 42,18 Z" />
        </g>
      );
    case "tree":
      return (
        <g>
          <rect x={-7} y={10} width={14} height={40} fill="#7a4b2a" {...o} />
          <circle cx={0} cy={-12} r={34} fill={m} {...o} />
          <circle cx={-10} cy={-22} r={10} fill={lighten(m, 0.25)} />
        </g>
      );
    case "pine-tree":
      return (
        <g>
          <rect x={-6} y={30} width={12} height={20} fill="#7a4b2a" {...o} />
          <polygon points="0,-50 -26,-10 -14,-10 -36,30 36,30 14,-10 26,-10" fill={m} {...o} />
        </g>
      );
    case "house":
      return (
        <g>
          <rect x={-36} y={-6} width={72} height={52} fill={lighten(m, 0.75)} {...o} />
          <polygon points="-46,-4 0,-46 46,-4" fill={m} {...o} />
          <rect x={-10} y={16} width={20} height={30} fill={darken(m, 0.2)} {...o} />
          <rect x={14} y={6} width={14} height={14} fill="#bfe6ff" {...o} />
        </g>
      );
    case "maze-wall":
      return (
        <g>
          <rect x={-48} y={-30} width={96} height={60} fill={m} {...o} />
          <rect x={-48} y={-40} width={96} height={14} fill={lighten(m, 0.25)} {...o} />
          {[-30, 0, 30].map((x) => (
            <circle key={x} cx={x} cy={-38} r={9} fill={lighten(m, 0.25)} />
          ))}
        </g>
      );
    case "snowflake":
      return (
        <g stroke={m} strokeWidth={7} strokeLinecap="round">
          {[0, 60, 120].map((a) => (
            <g key={a} transform={`rotate(${a})`}>
              <line x1={0} y1={-44} x2={0} y2={44} />
              <line x1={0} y1={-30} x2={-12} y2={-42} />
              <line x1={0} y1={-30} x2={12} y2={-42} />
              <line x1={0} y1={30} x2={-12} y2={42} />
              <line x1={0} y1={30} x2={12} y2={42} />
            </g>
          ))}
          <circle r={8} fill={m} stroke="none" />
        </g>
      );
    case "thermometer": {
      const lvl = 0.55 + 0.1 * Math.sin(f / 10);
      return (
        <g>
          <rect x={-12} y={-48} width={24} height={72} rx={12} fill="#ffffff" {...o} />
          <circle cx={0} cy={30} r={18} fill={m} {...o} />
          <rect x={-6} y={24 - 66 * lvl} width={12} height={66 * lvl} fill={m} />
          {[-30, -14, 2].map((y) => (
            <line key={y} x1={14} x2={24} y1={y} y2={y} stroke={ink} strokeWidth={4} />
          ))}
        </g>
      );
    }
    case "globe":
      return (
        <g>
          <circle r={42} fill={m} {...o} />
          <path d="M-20,-30 q14,6 10,18 q-12,8 -2,20 q10,4 2,22 q-22,-4 -30,-30 q4,-22 20,-30 Z" fill="#4caf50" />
          <path d="M18,-24 q16,10 12,34 q-10,6 -16,-4 q-6,-14 4,-30 Z" fill="#4caf50" />
          <ellipse rx={42} ry={14} fill="none" stroke={lighten(m, 0.4)} strokeWidth={3} />
          <circle r={42} fill="none" {...o} />
        </g>
      );
    case "arrow":
      return <polygon points="-44,-12 10,-12 10,-32 46,0 10,32 10,12 -44,12" fill={m} {...o} />;
    case "star":
      return <polygon points="0,-48 13,-16 46,-14 20,8 29,42 0,22 -29,42 -20,8 -46,-14 -13,-16" fill={m} {...o} />;
    case "heart":
      return <path d="M0,40 C-50,6 -46,-36 -20,-38 C-6,-39 0,-28 0,-22 C0,-28 6,-39 20,-38 C46,-36 50,6 0,40 Z" fill={m} {...o} />;
    case "question-mark":
      return (
        <g>
          <path d="M-22,-18 C-22,-48 26,-50 26,-20 C26,-2 4,2 4,20" fill="none" stroke={ink} strokeWidth={24} strokeLinecap="round" />
          <path d="M-22,-18 C-22,-48 26,-50 26,-20 C26,-2 4,2 4,20" fill="none" stroke={m} strokeWidth={14} strokeLinecap="round" />
          <circle cx={4} cy={40} r={10} fill={m} {...o} />
        </g>
      );
    case "exclamation":
      return (
        <g>
          <rect x={-12} y={-48} width={24} height={64} rx={12} fill={m} {...o} />
          <circle cx={0} cy={36} r={12} fill={m} {...o} />
        </g>
      );
    case "flower":
      return (
        <g>
          <path d="M0,10 L0,50" stroke="#3f9a52" strokeWidth={8} />
          <ellipse cx={14} cy={36} rx={12} ry={6} fill="#3f9a52" />
          {Array.from({ length: 6 }, (_, i) => (
            <ellipse key={i} cx={0} cy={-26} rx={12} ry={20} fill={m} {...o} transform={`rotate(${i * 60} 0 -8)`} />
          ))}
          <circle cx={0} cy={-8} r={12} fill={p.highlight} {...o} />
        </g>
      );
    case "rock":
      return (
        <g>
          <path d="M-46,36 L-36,-4 L-10,-26 L24,-20 L44,8 L46,36 Z" fill={m} {...o} />
          <path d="M-18,-12 L8,-14 L20,2" fill="none" stroke={lighten(m, 0.3)} strokeWidth={5} />
        </g>
      );
    case "door":
      return (
        <g>
          <path d="M-30,48 L-30,-24 A30,30 0 0,1 30,-24 L30,48 Z" fill={m} {...o} />
          <path d="M-18,40 L-18,-20 A18,18 0 0,1 18,-20 L18,40" fill="none" stroke={darken(m, 0.25)} strokeWidth={5} />
          <circle cx={16} cy={12} r={5} fill={p.highlight} {...o} />
        </g>
      );
    case "key":
      return (
        <g>
          <circle cx={-24} cy={0} r={20} fill={m} {...o} />
          <circle cx={-24} cy={0} r={8} fill={darken(m, 0.35)} />
          <rect x={-6} y={-7} width={50} height={14} fill={m} {...o} />
          <rect x={26} y={5} width={8} height={14} fill={m} {...o} />
          <rect x={38} y={5} width={8} height={10} fill={m} {...o} />
        </g>
      );
    case "clock":
      return (
        <g>
          <circle r={44} fill="#ffffff" {...o} stroke={m} strokeWidth={10} />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={-2} y={-36} width={4} height={8} fill={ink} transform={`rotate(${i * 30})`} />
          ))}
          <line x1={0} y1={0} x2={0} y2={-24} stroke={ink} strokeWidth={6} strokeLinecap="round" transform={`rotate(${f * 1})`} />
          <line x1={0} y1={0} x2={0} y2={-32} stroke={ink} strokeWidth={4} strokeLinecap="round" transform={`rotate(${f * 12})`} />
          <circle r={5} fill={ink} />
        </g>
      );
    case "water-drop":
      return (
        <g>
          <path d="M0,-48 C18,-20 34,0 34,16 A34,34 0 0,1 -34,16 C-34,0 -18,-20 0,-48 Z" fill={m} {...o} />
          <ellipse cx={-12} cy={10} rx={7} ry={12} fill="#ffffff" opacity={0.7} />
        </g>
      );
    case "fire": {
      const fl = Math.sin(f / 3) * 4;
      return (
        <g>
          <path d={`M0,${-48 + fl} C24,-20 36,-6 34,16 A34,30 0 0,1 -34,16 C-36,-6 -18,-14 -10,-34 C-4,-20 4,-22 0,${-48 + fl} Z`} fill={m} {...o} />
          <path d={`M0,${-10 - fl} C12,4 18,12 16,24 A16,16 0 0,1 -16,24 C-16,12 -6,4 0,${-10 - fl} Z`} fill={p.highlight} />
        </g>
      );
    }
    case "lightning":
      return <polygon points="8,-50 -30,6 -4,6 -14,50 30,-8 4,-8" fill={m} {...o} />;
    case "mountain":
      return (
        <g>
          <polygon points="-50,40 -6,-42 50,40" fill={m} {...o} />
          <polygon points="-6,-42 -20,-16 -10,-20 0,-12 8,-22 12,-30" fill="#ffffff" />
        </g>
      );
    case "lightbulb": {
      const glow = 0.25 + 0.2 * Math.sin(f / 5);
      return (
        <g>
          <circle cx={0} cy={-12} r={46} fill={m} opacity={glow} />
          <path d="M-16,20 C-16,6 -30,0 -30,-16 A30,30 0 0,1 30,-16 C30,0 16,6 16,20 Z" fill={m} {...o} />
          <rect x={-14} y={20} width={28} height={20} rx={4} fill="#9aa0aa" {...o} />
          <path d="M-8,-4 L-2,-16 L4,-4 L10,-16" fill="none" stroke={darken(m, 0.4)} strokeWidth={4} />
        </g>
      );
    }
    case "coin":
      return (
        <g>
          <circle r={40} fill={m} {...o} />
          <circle r={28} fill="none" stroke={darken(m, 0.2)} strokeWidth={5} />
          <text x={0} y={14} textAnchor="middle" fontSize={40} fontWeight={900} fill={darken(m, 0.35)} fontFamily='"Montserrat", sans-serif'>
            $
          </text>
        </g>
      );
    case "chart-up":
    case "chart-down": {
      const up = kind === "chart-up";
      const pts = up ? "-34,26 -12,8 6,16 34,-26" : "-34,-26 -12,-4 6,-12 34,26";
      return (
        <g>
          <rect x={-48} y={-46} width={96} height={92} rx={10} fill="#ffffff" {...o} />
          {[-24, -4, 16].map((x, i) => (
            <rect key={i} x={x} y={up ? 30 - (i + 1) * 14 : 30 - (3 - i) * 14} width={14} height={(up ? i + 1 : 3 - i) * 14} fill={lighten(m, 0.55)} />
          ))}
          <polyline points={pts} fill="none" stroke={m} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
          <polygon points={up ? "34,-26 16,-24 30,-10" : "34,26 16,24 30,10"} fill={m} />
        </g>
      );
    }
    case "ski":
      return (
        <g>
          {[-14, 14].map((dx) => (
            <g key={dx} transform={`translate(${dx} 0) rotate(-12)`}>
              <path d="M-6,46 L-6,-36 Q-6,-48 6,-48 Q6,-40 6,-36 L6,46 Z" fill={m} {...o} />
            </g>
          ))}
          <line x1={-40} y1={-30} x2={40} y2={44} stroke={ink} strokeWidth={5} />
          <line x1={40} y1={-30} x2={-40} y2={44} stroke={ink} strokeWidth={5} />
        </g>
      );
    case "trophy":
      return (
        <g>
          <path d="M-28,-44 L28,-44 L24,-6 A24,22 0 0,1 -24,-6 Z" fill={m} {...o} />
          <path d="M-28,-36 C-50,-36 -48,-6 -24,-8 M28,-36 C50,-36 48,-6 24,-8" fill="none" stroke={m} strokeWidth={8} />
          <rect x={-6} y={14} width={12} height={16} fill={m} {...o} />
          <rect x={-24} y={30} width={48} height={14} rx={3} fill={darken(m, 0.25)} {...o} />
          <polygon points="0,-36 5,-24 18,-24 8,-16 12,-4 0,-11 -12,-4 -8,-16 -18,-24 -5,-24" fill={lighten(m, 0.5)} />
        </g>
      );
    default: {
      const _x: never = kind;
      return null;
    }
  }
}

/** Transform for an animation (in prop units, around the prop centre unless noted). t = 0..1 through the beat. */
export function animTransform(anim: Anim, f: number, t: number, seed: number): { transform: string; opacity: number } {
  switch (anim) {
    case "none":
      return { transform: "", opacity: 1 };
    case "bob":
      return { transform: `translate(0 ${(Math.sin(f / 9 + seed) * 6).toFixed(2)})`, opacity: 1 };
    case "spin":
      return { transform: `rotate(${((f * 4 + seed * 40) % 360).toFixed(1)})`, opacity: 1 };
    case "pulse":
      return { transform: `scale(${(1 + 0.1 * Math.sin(f / 4 + seed)).toFixed(3)})`, opacity: 1 };
    case "grow":
      return { transform: `scale(${(0.5 + 0.6 * t).toFixed(3)})`, opacity: 1 };
    case "shrink":
      return { transform: `scale(${(1.1 - 0.6 * t).toFixed(3)})`, opacity: 1 };
    case "sway":
      return { transform: `rotate(${(Math.sin(f / 10 + seed) * 10).toFixed(2)} 0 50)`, opacity: 1 };
    case "fall": {
      // drifts down from above to its spot and keeps gently swaying (looping fall for snowflakes/leaves)
      const cyc = (f % 75) / 75;
      return { transform: `translate(${(Math.sin(f / 12 + seed) * 14).toFixed(2)} ${(-60 + cyc * 120).toFixed(1)}) rotate(${(f * 1.5) % 360})`, opacity: Math.min(1, Math.sin(cyc * Math.PI) * 1.6) };
    }
    case "melt": {
      // squash toward the bottom edge over the beat and fade a little
      const k = 1 - 0.65 * t;
      return { transform: `translate(0 ${(50 * (1 - k)).toFixed(2)}) scale(${(1 + 0.35 * t).toFixed(3)} ${k.toFixed(3)})`, opacity: 1 - 0.3 * t };
    }
    default: {
      const _x: never = anim;
      return { transform: "", opacity: 1 };
    }
  }
}

export const Prop: React.FC<{ prop: PropPlacement; index: number; durationInFrames: number; avoid?: AvoidBox[] }> = ({ prop, index, durationInFrames, avoid = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette, style } = useTheme();
  const scale = Math.min(3, Math.max(0.3, prop.scale ?? 1));
  const px = PROP_BASE_PX * scale;
  const k = px / 100; // units → px
  // keep the whole prop (incl. fall/sway travel) inside the stage, in frame and off the characters
  const pos = placeProp(prop.x, prop.y, px * 0.6, useCameraOffset(), avoid);
  const m = prop.colorRole ? palette[prop.colorRole] : defaultColor(prop.kind, palette);
  const ink = palette.ink;
  const sw = style.pixelSize ? 5 : 4;
  const t = Math.min(1, frame / Math.max(1, durationInFrames));
  const a = animTransform(prop.animation ?? "bob", frame, t, index * 1.7);
  const enter = spring({ frame: frame - 2 - index * 3, fps, config: { damping: 12, stiffness: 160 } });
  const shadow = style.shadow === "soft";
  return (
    <g transform={`translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)}) scale(${(k * enter).toFixed(4)})`} opacity={interpolate(enter, [0, 0.3], [0, 1], { extrapolateRight: "clamp" })}>
      {shadow && <ellipse cx={0} cy={56} rx={34} ry={7} fill="#000" opacity={0.12} />}
      <g transform={a.transform} opacity={a.opacity}>
        {drawProp(prop.kind, m, palette, ink, sw, frame)}
      </g>
    </g>
  );
};

export const Props: React.FC<{ props: PropPlacement[]; durationInFrames: number; avoid?: AvoidBox[] }> = ({ props, durationInFrames, avoid }) => (
  <g>
    {props.map((p, i) => (
      <Prop key={i} prop={p} index={i} durationInFrames={durationInFrames} avoid={avoid} />
    ))}
  </g>
);
