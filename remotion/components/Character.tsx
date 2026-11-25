// Character: shape-built SVG for EVERY species, EVERY accessory drawn, EVERY action animated. Idle bob + blink are
// always on (on top of any action), facing flips the whole figure, enter animations slide/pop in during ~0.6 s.
// Local units: feet at (0,0), up is -y, ~210 units tall; rendered at 2 px/unit × placement scale.

import React from "react";
import { Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CharacterDef, CharacterPlacement, Palette } from "../../src/schema/index.js";
import { darken, lighten } from "../color";
import { BANDS, type CameraBounds, clamp, GROUND_Y, SAFE, visibleSceneRange } from "../safeZone";
import { useCameraOffset } from "./CameraDrift";
import { useTheme } from "../styles";

type Species = CharacterDef["species"];
type Action = CharacterPlacement["action"];
type Accessory = CharacterDef["accessories"][number];

const UNIT_PX = 2;
const CHAR_HEIGHT_UNITS = 215;
/** Largest scale that keeps the head below the title band. */
export const MAX_CHAR_SCALE = (GROUND_Y - BANDS.stage.top) / (CHAR_HEIGHT_UNITS * UNIT_PX);

type Plan = "biped" | "quad" | "swim";

interface Anatomy {
  plan: Plan;
  head: { cx: number; cy: number; r: number };
  eyes: [number, number][];
  eyeR: number;
  mouth: [number, number];
  neck: { x: number; y: number; w: number };
  body: { cx: number; cy: number; rx: number; ry: number };
  shoulders: [number, number][]; // biped arms (left, right)
}

const SKIN = "#f2c39b";

function anatomy(species: Species): Anatomy {
  const biped: Anatomy = {
    plan: "biped",
    head: { cx: 0, cy: -142, r: 50 },
    eyes: [
      [-18, -146],
      [18, -146],
    ],
    eyeR: 7,
    mouth: [0, -120],
    neck: { x: 0, y: -94, w: 76 },
    body: { cx: 0, cy: -62, rx: 44, ry: 38 },
    shoulders: [
      [-38, -84],
      [38, -84],
    ],
  };
  const quad: Anatomy = {
    plan: "quad",
    head: { cx: 58, cy: -122, r: 42 },
    eyes: [
      [48, -130],
      [74, -130],
    ],
    eyeR: 6.5,
    mouth: [86, -98],
    neck: { x: 40, y: -88, w: 62 },
    body: { cx: -12, cy: -70, rx: 70, ry: 36 },
    shoulders: [],
  };
  switch (species) {
    case "human":
    case "bear":
    case "rabbit":
    case "creature":
      return biped;
    case "robot":
      return { ...biped, head: { cx: 0, cy: -148, r: 48 }, eyes: [[-18, -150], [18, -150]], mouth: [0, -124], neck: { x: 0, y: -100, w: 70 } };
    case "dog":
    case "cat":
    case "fox":
      return quad;
    case "penguin":
      return {
        ...biped,
        head: { cx: 0, cy: -148, r: 44 },
        eyes: [[-15, -152], [15, -152]],
        mouth: [0, -134],
        neck: { x: 0, y: -102, w: 92 },
        body: { cx: 0, cy: -88, rx: 62, ry: 86 },
        shoulders: [[-56, -100], [56, -100]],
      };
    case "snowman":
      return {
        ...biped,
        head: { cx: 0, cy: -152, r: 42 },
        eyes: [[-14, -158], [14, -158]],
        mouth: [0, -128],
        neck: { x: 0, y: -112, w: 70 },
        body: { cx: 0, cy: -56, rx: 58, ry: 56 },
        shoulders: [[-44, -82], [44, -82]],
      };
    case "bird":
      return {
        ...biped,
        head: { cx: 0, cy: -118, r: 56 },
        eyes: [[-20, -124], [20, -124]],
        mouth: [0, -104],
        neck: { x: 0, y: -78, w: 80 },
        body: { cx: 0, cy: -92, rx: 64, ry: 66 },
        shoulders: [[-58, -96], [58, -96]],
      };
    case "fish":
      return {
        plan: "swim",
        head: { cx: 40, cy: -128, r: 44 },
        eyes: [[44, -132], [66, -132]],
        eyeR: 7,
        mouth: [84, -110],
        neck: { x: 10, y: -120, w: 20 },
        body: { cx: 0, cy: -120, rx: 84, ry: 52 },
        shoulders: [],
      };
    default: {
      const _x: never = species;
      return biped;
    }
  }
}

// ── action → pose ───────────────────────────────────────────────────────────────────────────────────────────────

interface Pose {
  dx: number;
  dy: number;
  rot: number; // whole-body lean (deg)
  squash: number; // scaleY around the feet
  armL: number; // outward angle (deg), 0 = hanging down
  armR: number;
  legSwing: number; // deg, alternating
  headTilt: number;
  headDy: number;
  tailWag: number;
  /** Quadrupeds: how far the near front paw is raised (deg). Separate from arms so "happy" doesn't stick a leg out. */
  pawLift: number;
  eyes: "open" | "happy" | "wide" | "sad" | "up";
  mouth: "smile" | "grin" | "frown" | "o" | "wobble" | "flat";
  fx: "none" | "think" | "shiver" | "surprise" | "sweat" | "hearts" | "dust";
}

export function poseFor(action: Action, f: number, seed: number): Pose {
  const idleBob = Math.sin(f / 10 + seed) * 3;
  const base: Pose = {
    dx: 0,
    dy: idleBob,
    rot: 0,
    squash: 1 + Math.sin(f / 10 + seed) * 0.012,
    armL: 16 + Math.sin(f / 12 + seed) * 4,
    armR: 16 + Math.sin(f / 12 + seed + 1) * 4,
    legSwing: 0,
    headTilt: Math.sin(f / 23 + seed) * 2,
    headDy: 0,
    tailWag: Math.sin(f / 8 + seed) * 12,
    pawLift: 0,
    eyes: "open",
    mouth: "smile",
    fx: "none",
  };
  switch (action) {
    case "idle":
      return base;
    case "walk": {
      const s = Math.sin(f / 4);
      return { ...base, dy: -Math.abs(s) * 5, legSwing: s * 20, armL: 16 - s * 18, armR: 16 + s * 18, tailWag: s * 18 };
    }
    case "run": {
      const s = Math.sin(f / 2.4);
      return { ...base, dy: -Math.abs(s) * 10, rot: 8, legSwing: s * 34, armL: 30 - s * 40, armR: 30 + s * 40, tailWag: s * 25, mouth: "grin", fx: "dust" };
    }
    case "jump": {
      const ph = (f % 30) / 30;
      const h = Math.max(0, Math.sin(ph * Math.PI * 1.15));
      const land = ph > 0.87 ? 1 - (ph - 0.87) * 3 : 1;
      return { ...base, dy: -70 * h, squash: h > 0.05 ? 1.05 : 0.9 + 0.1 * (1 - land), armL: 40 + 100 * h, armR: 40 + 100 * h, legSwing: 0, mouth: "grin", eyes: h > 0.4 ? "happy" : "open" };
    }
    case "wave":
      return { ...base, armR: 150 + Math.sin(f / 3) * 22, pawLift: 80 + Math.sin(f / 3) * 22, mouth: "grin" };
    case "happy": {
      const b = Math.abs(Math.sin(f / 5));
      // quadrupeds prance (small alternating leg swing) instead of raising a paw
      return { ...base, dy: -b * 14, squash: 1 + 0.03 * b, armL: 60 + b * 50, armR: 60 + b * 50, legSwing: Math.sin(f / 5) * 8, eyes: "happy", mouth: "grin", tailWag: Math.sin(f / 2) * 30, fx: "hearts" };
    }
    case "sad":
      return { ...base, dy: Math.sin(f / 18) * 1.5, armL: 6, armR: 6, headTilt: -6, headDy: 8, eyes: "sad", mouth: "frown", tailWag: Math.sin(f / 20) * 3, fx: "sweat" };
    case "think":
      return { ...base, armR: -150 + Math.sin(f / 15) * 4, pawLift: 30, headTilt: 7 + Math.sin(f / 20) * 2, eyes: "up", mouth: "flat", fx: "think" };
    case "shiver": {
      const j = Math.sin(f * 2.1) * 3.5;
      return { ...base, dx: j, dy: 0, armL: 4, armR: 4, rot: j * 0.4, eyes: "sad", mouth: "wobble", fx: "shiver" };
    }
    case "surprised": {
      const pop = Math.max(0, Math.sin(Math.min(1, f / 10) * Math.PI)) * 22;
      return { ...base, dy: -pop + idleBob, armL: 90, armR: 90, eyes: "wide", mouth: "o", fx: "surprise" };
    }
    default: {
      const _x: never = action;
      return base;
    }
  }
}

// ── shape helpers ─────────────────────────────────────────────────────────────────────────────────────────────

/** Scalloped ellipse outline (fluffy coats). Arcs bulge outward. */
function fluffyPath(cx: number, cy: number, rx: number, ry: number, n: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i <= n; i++) {
    const [x, y] = pts[i % n];
    const [px, py] = pts[i - 1];
    const r = (Math.hypot(x - px, y - py) / 2) * 1.08;
    d += ` A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d + " Z";
}

const Blob: React.FC<{ cx: number; cy: number; rx: number; ry: number; fill: string; fluffy?: boolean; o: React.SVGProps<SVGPathElement> }> = ({ cx, cy, rx, ry, fill, fluffy, o }) =>
  fluffy ? <path d={fluffyPath(cx, cy, rx, ry, Math.max(10, Math.round((rx + ry) / 7)))} fill={fill} {...o} /> : <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} {...(o as React.SVGProps<SVGEllipseElement>)} />;

/** A limb hanging from (x,y), rotated by `a` degrees. */
const Limb: React.FC<{ x: number; y: number; a: number; len: number; w: number; fill: string; o: object; tip?: string }> = ({ x, y, a, len, w, fill, o, tip }) => (
  <g transform={`translate(${x} ${y}) rotate(${a.toFixed(2)})`}>
    <rect x={-w / 2} y={-w / 2} width={w} height={len + w / 2} rx={w / 2} fill={fill} {...o} />
    {tip && <circle cx={0} cy={len} r={w * 0.62} fill={tip} {...o} />}
  </g>
);

// ── face ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const Face: React.FC<{ an: Anatomy; pose: Pose; blink: boolean; ink: string; sw: number; species: Species }> = ({ an, pose, blink, ink, sw, species }) => {
  const eyeFill = species === "robot" ? "#7df9ff" : ink;
  const eyes = an.eyes.map(([x, y], i) => {
    const r = an.eyeR;
    if (blink && pose.eyes !== "happy") return <path key={i} d={`M${x - r},${y} Q${x},${y + 3} ${x + r},${y}`} stroke={ink} strokeWidth={sw} fill="none" strokeLinecap="round" />;
    switch (pose.eyes) {
      case "happy":
        return <path key={i} d={`M${x - r},${y + 2} Q${x},${y - r * 1.4} ${x + r},${y + 2}`} stroke={ink} strokeWidth={sw} fill="none" strokeLinecap="round" />;
      case "wide":
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={r * 1.7} fill="#fff" stroke={ink} strokeWidth={sw * 0.7} />
            <circle cx={x} cy={y} r={r * 0.9} fill={eyeFill} />
          </g>
        );
      case "sad":
        return (
          <g key={i}>
            <ellipse cx={x} cy={y + 2} rx={r * 0.9} ry={r} fill={eyeFill} />
            <line x1={x - r * 1.3} y1={y - r * (i === 0 ? 1.4 : 2.4)} x2={x + r * 1.3} y2={y - r * (i === 0 ? 2.4 : 1.4)} stroke={ink} strokeWidth={sw * 0.8} strokeLinecap="round" />
          </g>
        );
      case "up":
        return (
          <g key={i}>
            <ellipse cx={x} cy={y} rx={r} ry={r * 1.2} fill={eyeFill} />
            <circle cx={x + 1.5} cy={y - r * 0.7} r={r * 0.4} fill="#fff" />
          </g>
        );
      case "open":
        return (
          <g key={i}>
            <ellipse cx={x} cy={y} rx={r} ry={r * 1.2} fill={eyeFill} />
            <circle cx={x + r * 0.35} cy={y - r * 0.45} r={r * 0.38} fill="#fff" />
          </g>
        );
      default: {
        const _x: never = pose.eyes;
        return null;
      }
    }
  });
  const [mx, my] = an.mouth;
  let mouth: React.ReactNode = null;
  const beaked = species === "penguin" || species === "bird";
  if (beaked) {
    // the beak is the mouth; open-mouth expressions show a small dark gap under it
    mouth = pose.mouth === "o" || pose.mouth === "grin" ? <ellipse cx={mx} cy={my + 14} rx={7} ry={5} fill="#7a1f2b" stroke={ink} strokeWidth={sw * 0.6} /> : null;
  } else switch (pose.mouth) {
    case "smile":
      mouth = <path d={`M${mx - 9},${my} Q${mx},${my + 8} ${mx + 9},${my}`} stroke={ink} strokeWidth={sw} fill="none" strokeLinecap="round" />;
      break;
    case "grin":
      mouth = <path d={`M${mx - 12},${my - 2} Q${mx},${my + 16} ${mx + 12},${my - 2} Z`} fill="#7a1f2b" stroke={ink} strokeWidth={sw * 0.8} strokeLinejoin="round" />;
      break;
    case "frown":
      mouth = <path d={`M${mx - 9},${my + 5} Q${mx},${my - 4} ${mx + 9},${my + 5}`} stroke={ink} strokeWidth={sw} fill="none" strokeLinecap="round" />;
      break;
    case "o":
      mouth = <ellipse cx={mx} cy={my + 3} rx={7} ry={9} fill="#7a1f2b" stroke={ink} strokeWidth={sw * 0.8} />;
      break;
    case "wobble":
      mouth = <path d={`M${mx - 12},${my + 2} l4,-4 l4,4 l4,-4 l4,4 l4,-4`} stroke={ink} strokeWidth={sw * 0.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      break;
    case "flat":
      mouth = <line x1={mx - 6} y1={my + 2} x2={mx + 8} y2={my} stroke={ink} strokeWidth={sw} strokeLinecap="round" />;
      break;
    default: {
      const _x: never = pose.mouth;
    }
  }
  return (
    <g>
      {eyes}
      {mouth}
    </g>
  );
};

// ── species bodies ────────────────────────────────────────────────────────────────────────────────────────────────

interface DrawCtx {
  def: CharacterDef;
  an: Anatomy;
  pose: Pose;
  pal: Palette;
  ink: string;
  sw: number;
  f: number;
  o: { stroke: string; strokeWidth: number; strokeLinejoin: "round" };
}

/** Head-level features drawn BEHIND the head circle (ears that stick out). */
function headBack(c: DrawCtx): React.ReactNode {
  const { def, an, o } = c;
  const { cx, cy, r } = an.head;
  const b = def.bodyColor;
  const a = def.accentColor;
  switch (def.species) {
    case "bear":
      return (
        <g>
          <circle cx={cx - r * 0.72} cy={cy - r * 0.72} r={r * 0.32} fill={b} {...o} />
          <circle cx={cx + r * 0.72} cy={cy - r * 0.72} r={r * 0.32} fill={b} {...o} />
          <circle cx={cx - r * 0.72} cy={cy - r * 0.72} r={r * 0.16} fill={a} />
          <circle cx={cx + r * 0.72} cy={cy - r * 0.72} r={r * 0.16} fill={a} />
        </g>
      );
    case "rabbit": {
      const flop = Math.sin(c.f / 14) * 4;
      return (
        <g>
          <ellipse cx={cx - r * 0.38} cy={cy - r * 1.35} rx={r * 0.24} ry={r * 0.75} fill={b} {...o} transform={`rotate(${-8 + flop} ${cx - r * 0.38} ${cy - r * 0.7})`} />
          <ellipse cx={cx + r * 0.38} cy={cy - r * 1.35} rx={r * 0.24} ry={r * 0.75} fill={b} {...o} transform={`rotate(${8 - flop} ${cx + r * 0.38} ${cy - r * 0.7})`} />
          <ellipse cx={cx - r * 0.38} cy={cy - r * 1.32} rx={r * 0.11} ry={r * 0.55} fill={a} transform={`rotate(${-8 + flop} ${cx - r * 0.38} ${cy - r * 0.7})`} />
          <ellipse cx={cx + r * 0.38} cy={cy - r * 1.32} rx={r * 0.11} ry={r * 0.55} fill={a} transform={`rotate(${8 - flop} ${cx + r * 0.38} ${cy - r * 0.7})`} />
        </g>
      );
    }
    case "cat":
    case "fox":
      return (
        <g>
          <polygon points={`${cx - r * 0.85},${cy - r * 0.3} ${cx - r * 0.6},${cy - r * 1.25} ${cx - r * 0.1},${cy - r * 0.8}`} fill={b} {...o} />
          <polygon points={`${cx + r * 0.1},${cy - r * 0.85} ${cx + r * 0.6},${cy - r * 1.3} ${cx + r * 0.85},${cy - r * 0.35}`} fill={b} {...o} />
          <polygon points={`${cx + r * 0.25},${cy - r * 0.85} ${cx + r * 0.55},${cy - r * 1.1} ${cx + r * 0.7},${cy - r * 0.5}`} fill={a} />
        </g>
      );
    case "creature":
      return (
        <g>
          <polygon points={`${cx - r * 0.6},${cy - r * 0.7} ${cx - r * 0.85},${cy - r * 1.35} ${cx - r * 0.25},${cy - r * 0.9}`} fill={a} {...o} />
          <polygon points={`${cx + r * 0.6},${cy - r * 0.7} ${cx + r * 0.85},${cy - r * 1.35} ${cx + r * 0.25},${cy - r * 0.9}`} fill={a} {...o} />
        </g>
      );
    case "robot": {
      const blinkOn = Math.floor(c.f / 15) % 2 === 0;
      return (
        <g>
          <line x1={cx} y1={cy - r} x2={cx} y2={cy - r - 28} stroke={c.ink} strokeWidth={c.sw} />
          <circle cx={cx} cy={cy - r - 32} r={8} fill={blinkOn ? c.pal.primary : darken(c.pal.primary, 0.4)} {...o} />
        </g>
      );
    }
    case "human":
    case "dog":
    case "penguin":
    case "snowman":
    case "bird":
    case "fish":
      return null;
    default: {
      const _x: never = def.species;
      return null;
    }
  }
}

/** Head shape + species face details (in front of head circle, behind eyes). */
function headFront(c: DrawCtx): React.ReactNode {
  const { def, an, o, ink, sw } = c;
  const { cx, cy, r } = an.head;
  const b = def.bodyColor;
  const a = def.accentColor;
  const fluffy = def.fluffy;
  switch (def.species) {
    case "human":
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill={SKIN} {...o} />
          {/* hair cap in accentColor */}
          <path d={`M${cx - r},${cy + 2} A${r},${r} 0 0,1 ${cx + r},${cy + 2} Q${cx + r * 0.4},${cy - r * 0.55} ${cx - r * 0.2},${cy - r * 0.35} Q${cx - r * 0.7},${cy - r * 0.2} ${cx - r},${cy + 2} Z`} fill={a} {...o} />
          <circle cx={cx - r * 0.55} cy={cy + r * 0.3} r={r * 0.13} fill="#ff9e9e" opacity={0.6} />
          <circle cx={cx + r * 0.55} cy={cy + r * 0.3} r={r * 0.13} fill="#ff9e9e" opacity={0.6} />
        </g>
      );
    case "bear":
      return (
        <g>
          <Blob cx={cx} cy={cy} rx={r} ry={r * 0.95} fill={b} fluffy={fluffy} o={o} />
          <ellipse cx={cx} cy={cy + r * 0.42} rx={r * 0.42} ry={r * 0.3} fill={lighten(a, 0.3)} />
          <ellipse cx={cx} cy={cy + r * 0.3} rx={r * 0.14} ry={r * 0.1} fill={ink} />
        </g>
      );
    case "rabbit":
      return (
        <g>
          <Blob cx={cx} cy={cy} rx={r} ry={r * 0.92} fill={b} fluffy={fluffy} o={o} />
          <ellipse cx={cx} cy={cy + r * 0.3} rx={r * 0.1} ry={r * 0.07} fill={a} />
          <circle cx={cx - r * 0.55} cy={cy + r * 0.32} r={r * 0.13} fill="#ff9e9e" opacity={0.6} />
          <circle cx={cx + r * 0.55} cy={cy + r * 0.32} r={r * 0.13} fill="#ff9e9e" opacity={0.6} />
        </g>
      );
    case "creature":
      return (
        <g>
          <Blob cx={cx} cy={cy} rx={r * 1.05} ry={r} fill={b} fluffy={fluffy} o={o} />
          {[-0.5, 0, 0.5].map((k, i) => (
            <circle key={i} cx={cx + k * r * 0.9} cy={cy - r * 0.55 + Math.abs(k) * 6} r={r * 0.1} fill={a} />
          ))}
        </g>
      );
    case "robot":
      return (
        <g>
          <rect x={cx - r} y={cy - r * 0.9} width={r * 2} height={r * 1.8} rx={r * 0.25} fill={b} {...o} />
          <rect x={cx - r * 0.75} y={cy - r * 0.55} width={r * 1.5} height={r * 0.75} rx={r * 0.18} fill="#1d2433" />
          <rect x={cx - r * 1.18} y={cy - r * 0.25} width={r * 0.18} height={r * 0.5} fill={a} {...o} />
          <rect x={cx + r} y={cy - r * 0.25} width={r * 0.18} height={r * 0.5} fill={a} {...o} />
        </g>
      );
    case "penguin":
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill={b} {...o} />
          <path d={`M${cx - r * 0.78},${cy + r * 0.2} Q${cx - r * 0.5},${cy - r * 0.6} ${cx},${cy - r * 0.15} Q${cx + r * 0.5},${cy - r * 0.6} ${cx + r * 0.78},${cy + r * 0.2} Q${cx},${cy + r * 0.95} ${cx - r * 0.78},${cy + r * 0.2} Z`} fill="#ffffff" />
          <polygon points={`${cx - 12},${cy + r * 0.32} ${cx + 12},${cy + r * 0.32} ${cx},${cy + r * 0.62}`} fill={a} stroke={ink} strokeWidth={sw * 0.6} strokeLinejoin="round" />
        </g>
      );
    case "snowman":
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill={b} {...o} />
          {/* carrot nose */}
          <polygon points={`${cx - 2},${cy} ${cx + 30},${cy + 6} ${cx - 2},${cy + 12}`} fill={a} {...o} />
        </g>
      );
    case "bird": {
      return (
        <g>
          {/* crest */}
          <path d={`M${cx - 6},${cy - r * 0.95} q-6,-28 10,-34 q-2,14 8,30 Z`} fill={a} {...o} />
          {/* beak */}
          <polygon points={`${cx - 11},${cy + r * 0.12} ${cx + 11},${cy + r * 0.12} ${cx},${cy + r * 0.42}`} fill={c.pal.accent} {...o} />
        </g>
      );
    }
    case "dog":
    case "cat":
    case "fox": {
      const isDog = def.species === "dog";
      const isFox = def.species === "fox";
      const earSwing = isDog ? Math.sin(c.f / 9) * 5 + c.pose.tailWag * 0.1 : 0;
      return (
        <g>
          <Blob cx={cx} cy={cy} rx={r} ry={r * 0.95} fill={b} fluffy={fluffy} o={o} />
          {/* muzzle */}
          {isFox ? (
            <path d={`M${cx + r * 0.2},${cy + r * 0.05} Q${cx + r * 0.9},${cy - r * 0.05} ${cx + r * 1.32},${cy + r * 0.32} Q${cx + r * 0.9},${cy + r * 0.75} ${cx + r * 0.2},${cy + r * 0.55} Z`} fill="#ffffff" {...o} />
          ) : (
            <Blob cx={cx + r * 0.72} cy={cy + r * 0.38} rx={r * 0.5} ry={r * 0.36} fill={isDog ? lighten(b, 0.25) : lighten(b, 0.35)} fluffy={fluffy} o={o} />
          )}
          <ellipse cx={cx + r * (isFox ? 1.3 : 1.12)} cy={cy + r * (isFox ? 0.3 : 0.24)} rx={r * 0.15} ry={r * 0.11} fill={ink} />
          {/* sheepadoodle-style eye patch for dogs */}
          {isDog && <ellipse cx={cx + r * 0.38} cy={cy - r * 0.18} rx={r * 0.3} ry={r * 0.32} fill={a} opacity={0.95} />}
          {/* whiskers */}
          {def.species === "cat" &&
            [-1, 1].map((k) => <line key={k} x1={cx + r * 1.0} y1={cy + r * 0.35} x2={cx + r * 1.45} y2={cy + r * (0.35 + k * 0.16)} stroke={ink} strokeWidth={sw * 0.5} />)}
          {/* floppy dog ears (front) */}
          {isDog && (
            <g transform={`rotate(${earSwing.toFixed(2)} ${cx - r * 0.25} ${cy - r * 0.6})`}>
              <Blob cx={cx - r * 0.42} cy={cy - r * 0.05} rx={r * 0.3} ry={r * 0.62} fill={a} fluffy={fluffy} o={o} />
            </g>
          )}
        </g>
      );
    }
    case "fish":
      return null;
    default: {
      const _x: never = def.species;
      return null;
    }
  }
}

/** Body (+ legs, tail, arms) of the species, drawn before the head. */
function bodyAndLimbs(c: DrawCtx, armsFront: boolean): React.ReactNode {
  const { def, an, pose, o, ink } = c;
  const b = def.bodyColor;
  const a = def.accentColor;
  const fluffy = def.fluffy;
  const bd = an.body;
  const leg = (x: number, dir: number, fill: string, len = 40, w = 20, tip?: string) => (
    <Limb x={x} y={-len} a={pose.legSwing * dir} len={len - 4} w={w} fill={fill} o={o} tip={tip} />
  );
  const arms = (fill: string, len: number, w: number, tip?: string) =>
    an.shoulders.map(([x, y], i) => (
      <Limb key={i} x={x} y={y} a={i === 0 ? pose.armL : -pose.armR} len={len} w={w} fill={fill} o={o} tip={tip} />
    ));
  switch (def.species) {
    case "human":
      return armsFront ? (
        arms(b, 40, 18, SKIN)
      ) : (
        <g>
          {leg(-16, 1, "#3d4a6b", 42, 20, "#2a2a35")}
          {leg(16, -1, "#3d4a6b", 42, 20, "#2a2a35")}
          <path d={`M${-40},${-36} Q${-44},${-92} 0,${-96} Q${44},${-92} ${40},${-36} Z`} fill={b} {...o} />
        </g>
      );
    case "bear":
    case "rabbit":
    case "creature": {
      if (armsFront) return arms(b, 36, 22);
      const tail =
        def.species === "rabbit" ? (
          <circle cx={-bd.rx * 0.9} cy={bd.cy + 14} r={14} fill="#ffffff" {...o} />
        ) : def.species === "creature" ? (
          <g>
            {/* little wings + tail */}
            <path d={`M${-bd.rx * 0.6},${bd.cy - 20} q-60,-50 -70,10 q30,-6 40,20 Z`} fill={a} {...o} transform={`rotate(${Math.sin(c.f / 5) * 10} ${-bd.rx * 0.6} ${bd.cy - 20})`} />
            <path d={`M${bd.rx * 0.6},${bd.cy - 20} q60,-50 70,10 q-30,-6 -40,20 Z`} fill={a} {...o} transform={`rotate(${-Math.sin(c.f / 5) * 10} ${bd.rx * 0.6} ${bd.cy - 20})`} />
          </g>
        ) : null;
      return (
        <g>
          {tail}
          {leg(-18, 1, b, 38, 24)}
          {leg(18, -1, b, 38, 24)}
          <Blob cx={bd.cx} cy={bd.cy} rx={bd.rx} ry={bd.ry} fill={b} fluffy={fluffy} o={o} />
          <ellipse cx={bd.cx} cy={bd.cy + 6} rx={bd.rx * 0.6} ry={bd.ry * 0.62} fill={lighten(def.species === "creature" ? a : b, 0.35)} />
        </g>
      );
    }
    case "robot":
      return armsFront ? (
        arms("#b8c2cc", 38, 16, a)
      ) : (
        <g>
          {leg(-18, 1, "#8d99a6", 40, 18)}
          {leg(18, -1, "#8d99a6", 40, 18)}
          <rect x={-44} y={-100} width={88} height={68} rx={12} fill={b} {...o} />
          <rect x={-24} y={-86} width={48} height={30} rx={6} fill="#1d2433" />
          {[0, 1, 2].map((k) => (
            <circle key={k} cx={-12 + k * 12} cy={-71} r={4} fill={Math.floor(c.f / 8 + k) % 3 === 0 ? c.pal.highlight : "#3a4458"} />
          ))}
        </g>
      );
    case "penguin":
      return armsFront ? (
        an.shoulders.map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${i === 0 ? pose.armL : -pose.armR})`}>
            <ellipse cx={0} cy={30} rx={13} ry={36} fill={b} {...o} />
          </g>
        ))
      ) : (
        <g>
          <ellipse cx={-22} cy={-4} rx={22} ry={9} fill={a} {...o} transform={`rotate(${pose.legSwing * 0.5} -22 -4)`} />
          <ellipse cx={22} cy={-4} rx={22} ry={9} fill={a} {...o} transform={`rotate(${-pose.legSwing * 0.5} 22 -4)`} />
          <ellipse cx={bd.cx} cy={bd.cy} rx={bd.rx} ry={bd.ry} fill={b} {...o} />
          <ellipse cx={bd.cx} cy={bd.cy + 22} rx={bd.rx * 0.68} ry={bd.ry * 0.66} fill="#ffffff" />
        </g>
      );
    case "snowman":
      return armsFront ? (
        an.shoulders.map(([x, y], i) => {
          const ang = i === 0 ? pose.armL + 40 : -(pose.armR + 40);
          return (
            <g key={i} transform={`translate(${x} ${y}) rotate(${ang})`}>
              <line x1={0} y1={0} x2={0} y2={58} stroke="#6b4423" strokeWidth={7} strokeLinecap="round" />
              <line x1={0} y1={40} x2={i === 0 ? 12 : -12} y2={52} stroke="#6b4423" strokeWidth={5} strokeLinecap="round" />
            </g>
          );
        })
      ) : (
        <g>
          <circle cx={bd.cx} cy={bd.cy} r={bd.rx} fill={b} {...o} />
          <circle cx={0} cy={-104} r={36} fill={b} {...o} />
          {[-120, -100, -80].map((y) => (
            <circle key={y} cx={0} cy={y + 10} r={5} fill={ink} />
          ))}
        </g>
      );
    case "bird":
      return armsFront ? (
        an.shoulders.map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${(i === 0 ? pose.armL : -pose.armR) * 0.8 + (i === 0 ? 10 : -10)})`}>
            <path d="M0,0 C-14,20 -10,50 0,62 C10,50 14,20 0,0 Z" fill={darken(b, 0.12)} {...o} />
          </g>
        ))
      ) : (
        <g>
          {[-16, 16].map((x, i) => (
            <g key={x} transform={`rotate(${pose.legSwing * (i ? -1 : 1)} ${x} -30)`}>
              <line x1={x} y1={-30} x2={x} y2={-2} stroke="#e0902a" strokeWidth={6} strokeLinecap="round" />
              <path d={`M${x - 10},0 L${x + 10},0`} stroke="#e0902a" strokeWidth={6} strokeLinecap="round" />
            </g>
          ))}
          <Blob cx={bd.cx} cy={bd.cy} rx={bd.rx} ry={bd.ry} fill={b} fluffy={fluffy} o={o} />
          <ellipse cx={0} cy={bd.cy + 22} rx={bd.rx * 0.6} ry={bd.ry * 0.5} fill={lighten(a, 0.45)} />
        </g>
      );
    case "dog":
    case "cat":
    case "fox": {
      if (armsFront) return null;
      // quadruped facing right: four legs, tail, body. Wave/think lift the front paw (armR drives it).
      const paw = (x: number, dir: number, front: boolean, near: boolean) => {
        const extra = front && near ? -Math.min(110, pose.pawLift) : 0;
        return (
          <Limb
            key={`${x}`}
            x={x}
            y={-44}
            a={pose.legSwing * dir + extra}
            len={40}
            w={19}
            fill={near ? b : darken(b, 0.12)}
            o={o}
            tip={fluffy ? (near ? b : darken(b, 0.12)) : undefined}
          />
        );
      };
      const tailCol = def.species === "fox" ? b : def.species === "dog" ? b : b;
      const tailRot = -30 + pose.tailWag;
      const tail =
        def.species === "fox" ? (
          <g transform={`translate(${bd.cx - bd.rx + 8} ${bd.cy - 10}) rotate(${tailRot})`}>
            <path d="M0,0 C-30,-10 -70,-30 -80,-70 C-50,-60 -20,-40 0,-14 Z" fill={tailCol} {...o} />
            <path d="M-62,-52 C-70,-58 -76,-64 -80,-70 C-70,-66 -62,-62 -56,-58 Z" fill="#ffffff" {...o} />
          </g>
        ) : def.species === "cat" ? (
          <g transform={`translate(${bd.cx - bd.rx + 6} ${bd.cy - 6}) rotate(${tailRot * 0.5})`}>
            <path d="M0,0 C-30,-6 -40,-50 -20,-80" stroke={ink} strokeWidth={22 + c.sw} fill="none" strokeLinecap="round" />
            <path d="M0,0 C-30,-6 -40,-50 -20,-80" stroke={tailCol} strokeWidth={22 - c.sw} fill="none" strokeLinecap="round" />
          </g>
        ) : (
          <g transform={`translate(${bd.cx - bd.rx + 8} ${bd.cy - 12}) rotate(${tailRot})`}>
            <Blob cx={-22} cy={-24} rx={fluffy ? 22 : 12} ry={fluffy ? 30 : 30} fill={tailCol} fluffy={fluffy} o={o} />
          </g>
        );
      return (
        <g>
          {/* far legs sit between the near ones so all four read separately */}
          {paw(bd.cx - 52, -1, false, false)}
          {paw(bd.cx + 28, 1, true, false)}
          {tail}
          <Blob cx={bd.cx} cy={bd.cy} rx={bd.rx} ry={bd.ry} fill={b} fluffy={fluffy} o={o} />
          {/* accent patches (sheepadoodle back patch / fox belly / cat stripes) */}
          {def.species === "dog" && <Blob cx={bd.cx - 22} cy={bd.cy - 6} rx={bd.rx * 0.42} ry={bd.ry * 0.62} fill={a} fluffy={fluffy} o={{}} />}
          {def.species === "fox" && <ellipse cx={bd.cx + 30} cy={bd.cy + 14} rx={30} ry={18} fill="#ffffff" />}
          {def.species === "cat" &&
            [-30, -6, 18].map((x) => <path key={x} d={`M${bd.cx + x},${bd.cy - bd.ry + 4} q6,14 0,26`} stroke={a} strokeWidth={7} fill="none" strokeLinecap="round" />)}
          {paw(bd.cx - 24, 1, false, true)}
          {paw(bd.cx + 52, -1, true, true)}
        </g>
      );
    }
    case "fish": {
      if (armsFront) return null;
      const wag = Math.sin(c.f / (pose.legSwing ? 2.5 : 6)) * 14;
      return (
        <g>
          <g transform={`translate(${bd.cx - bd.rx + 10} ${bd.cy}) rotate(${wag})`}>
            <path d="M0,0 L-56,-42 Q-44,0 -56,42 Z" fill={a} {...o} />
          </g>
          <path d={`M-10,${bd.cy - bd.ry + 4} q20,-36 50,-6 Z`} fill={a} {...o} />
          <ellipse cx={bd.cx} cy={bd.cy} rx={bd.rx} ry={bd.ry} fill={b} {...o} />
          {[-30, -6, 18].map((x) => (
            <path key={x} d={`M${x},${bd.cy - 30} q12,30 0,60`} stroke={darken(b, 0.18)} strokeWidth={5} fill="none" />
          ))}
          <g transform={`translate(10 ${bd.cy + 14}) rotate(${Math.sin(c.f / 5) * 20})`}>
            <path d="M0,0 q-18,22 -34,12 q8,-14 34,-12 Z" fill={a} {...o} />
          </g>
        </g>
      );
    }
    default: {
      const _x: never = def.species;
      return null;
    }
  }
}

// ── accessories ───────────────────────────────────────────────────────────────────────────────────────────────────

function accessoryBack(acc: Accessory, c: DrawCtx): React.ReactNode {
  const { an, pal, o, f } = c;
  switch (acc) {
    case "cape": {
      const flap = Math.sin(f / 7) * 10;
      if (an.plan === "quad") {
        const { x, y } = an.neck;
        return <path d={`M${x + 10},${y - 10} Q${x - 60},${y - 20} ${-90},${-70 + flap} L${-70},${-40 + flap} Q${x - 50},${y + 20} ${x},${y + 10} Z`} fill={pal.primary} {...o} />;
      }
      const y = an.neck.y;
      return <path d={`M${-34},${y} L${34},${y} L${54 + flap * 0.4},${-8} Q0,${-2 + flap * 0.5} ${-54 + flap * 0.4},${-8} Z`} fill={pal.primary} {...o} />;
    }
    case "backpack": {
      if (an.plan === "quad") return null; // saddle pack is drawn in front
      const bd = an.body;
      return <rect x={-bd.rx - 14} y={bd.cy - 34} width={bd.rx * 2 + 28} height={62} rx={16} fill={pal.accent} {...o} />;
    }
    case "scarf":
    case "hat":
    case "beanie":
    case "glasses":
    case "bow":
    case "crown":
    case "collar":
      return null;
    default: {
      const _x: never = acc;
      return null;
    }
  }
}

function accessoryFront(acc: Accessory, c: DrawCtx): React.ReactNode {
  const { an, pal, o, ink, sw, def, f } = c;
  const { cx, cy, r } = an.head;
  const top = cy - r * (def.species === "robot" ? 0.9 : 0.92);
  switch (acc) {
    case "scarf": {
      const { x, y, w } = an.neck;
      const col = def.accentColor;
      const tailSway = Math.sin(f / 9) * 6;
      return (
        <g>
          <rect x={x - w / 2} y={y - 10} width={w} height={22} rx={11} fill={col} {...o} />
          <rect x={x - w / 2 + 8} y={y - 4} width={w - 16} height={5} fill={lighten(col, 0.4)} opacity={0.8} />
          <g transform={`rotate(${tailSway} ${x + w * 0.22} ${y + 6})`}>
            <rect x={x + w * 0.12} y={y + 4} width={20} height={44} rx={6} fill={col} {...o} />
            <rect x={x + w * 0.12} y={y + 34} width={20} height={5} fill={lighten(col, 0.4)} />
          </g>
        </g>
      );
    }
    case "collar": {
      const { x, y, w } = an.neck;
      return (
        <g>
          <rect x={x - w / 2} y={y - 7} width={w} height={14} rx={7} fill={pal.primary} {...o} />
          <circle cx={x + (an.plan === "quad" ? w * 0.3 : 0)} cy={y + 16} r={9} fill={pal.highlight} {...o} />
        </g>
      );
    }
    case "hat":
      return (
        <g transform={`rotate(-6 ${cx} ${top})`}>
          <rect x={cx - r * 0.95} y={top - 4} width={r * 1.9} height={12} rx={6} fill="#26222e" {...o} />
          <rect x={cx - r * 0.6} y={top - 62} width={r * 1.2} height={60} rx={6} fill="#26222e" {...o} />
          <rect x={cx - r * 0.6} y={top - 20} width={r * 1.2} height={12} fill={def.accentColor} />
        </g>
      );
    case "beanie":
      return (
        <g>
          <path d={`M${cx - r * 0.98},${cy - r * 0.2} A${r},${r * 0.95} 0 0,1 ${cx + r * 0.98},${cy - r * 0.2} Z`} fill={def.accentColor} {...o} />
          <rect x={cx - r * 1.02} y={cy - r * 0.34} width={r * 2.04} height={r * 0.3} rx={r * 0.12} fill={lighten(def.accentColor, 0.3)} {...o} />
          <circle cx={cx} cy={cy - r * 1.0} r={r * 0.2} fill="#ffffff" {...o} />
        </g>
      );
    case "glasses": {
      const [[x1, y1], [x2, y2]] = an.eyes;
      const gr = an.eyeR * 2.1;
      return (
        <g fill="#ffffff" fillOpacity={0.18} stroke={ink} strokeWidth={sw * 0.9}>
          <circle cx={x1} cy={y1} r={gr} />
          <circle cx={x2} cy={y2} r={gr} />
          <line x1={x1 + gr} y1={y1} x2={x2 - gr} y2={y2} />
        </g>
      );
    }
    case "bow": {
      const bx = cx + r * 0.62;
      const by = cy - r * 0.78;
      return (
        <g transform={`rotate(${Math.sin(f / 12) * 4} ${bx} ${by})`}>
          <polygon points={`${bx},${by} ${bx - 30},${by - 18} ${bx - 30},${by + 18}`} fill={pal.primary} {...o} />
          <polygon points={`${bx},${by} ${bx + 30},${by - 18} ${bx + 30},${by + 18}`} fill={pal.primary} {...o} />
          <circle cx={bx} cy={by} r={8} fill={darken(pal.primary, 0.2)} {...o} />
        </g>
      );
    }
    case "crown": {
      const w = r * 1.2;
      const y0 = top + 6;
      const sparkle = 0.6 + 0.4 * Math.sin(f / 4);
      return (
        <g>
          <polygon
            points={`${cx - w / 2},${y0} ${cx - w / 2},${y0 - 34} ${cx - w / 4},${y0 - 16} ${cx},${y0 - 42} ${cx + w / 4},${y0 - 16} ${cx + w / 2},${y0 - 34} ${cx + w / 2},${y0}`}
            fill={pal.highlight}
            {...o}
          />
          <circle cx={cx} cy={y0 - 12} r={6} fill={pal.primary} opacity={sparkle} />
        </g>
      );
    }
    case "backpack": {
      if (an.plan === "quad") {
        const bd = an.body;
        return (
          <g>
            <rect x={bd.cx - 34} y={bd.cy - bd.ry - 8} width={64} height={46} rx={12} fill={pal.accent} {...o} />
            <rect x={bd.cx - 22} y={bd.cy - bd.ry + 6} width={40} height={12} rx={4} fill={darken(pal.accent, 0.2)} />
          </g>
        );
      }
      const [[sx1, sy1], [sx2, sy2]] = an.shoulders.length ? an.shoulders : [[-30, -84], [30, -84]];
      return (
        <g stroke={darken(pal.accent, 0.3)} strokeWidth={8} strokeLinecap="round">
          <line x1={sx1 + 10} y1={sy1 - 4} x2={sx1 + 14} y2={sy1 + 46} />
          <line x1={sx2 - 10} y1={sy2 - 4} x2={sx2 - 14} y2={sy2 + 46} />
        </g>
      );
    }
    case "cape": {
      // clasp at the neck
      const { x, y } = an.neck;
      return <circle cx={x} cy={y} r={7} fill={pal.highlight} {...o} />;
    }
    default: {
      const _x: never = acc;
      return null;
    }
  }
}

// ── fx (thought bubble, shiver lines, surprise spikes, sweat drop, hearts, run dust) ────────────────────────────

function Fx({ c }: { c: DrawCtx }) {
  const { an, pose, f, ink, pal } = c;
  const { cx, cy, r } = an.head;
  switch (pose.fx) {
    case "none":
      return null;
    case "think":
      return (
        <g>
          {[0, 1, 2].map((i) => {
            const on = (Math.floor(f / 8) % 4) > i;
            return <circle key={i} cx={cx + r * 0.9 + i * 22} cy={cy - r * 0.9 - i * 24} r={7 + i * 5} fill="#ffffff" stroke={ink} strokeWidth={3} opacity={on ? 1 : 0.2} />;
          })}
        </g>
      );
    case "shiver":
      return (
        <g stroke="#bfe6ff" strokeWidth={5} strokeLinecap="round" opacity={0.9}>
          {[-1, 1].map((k) => (
            <g key={k}>
              <path d={`M${k * (an.body.rx + 20)},${an.body.cy - 30} q${k * 8},10 0,20 q${-k * 8},10 0,20`} fill="none" transform={`translate(${Math.sin(f * 1.7) * 3} 0)`} />
              <path d={`M${k * (an.body.rx + 38)},${an.body.cy - 20} q${k * 8},10 0,20`} fill="none" />
            </g>
          ))}
        </g>
      );
    case "surprise":
      return (
        <g stroke={pal.highlight} strokeWidth={7} strokeLinecap="round">
          {[-50, -20, 20, 50].map((a) => {
            const rr = r + 18 + Math.sin(f / 3) * 4;
            const rad = ((a - 90) * Math.PI) / 180;
            return <line key={a} x1={cx + Math.cos(rad) * rr} y1={cy + Math.sin(rad) * rr} x2={cx + Math.cos(rad) * (rr + 22)} y2={cy + Math.sin(rad) * (rr + 22)} />;
          })}
        </g>
      );
    case "sweat": {
      const t = (f % 45) / 45;
      return <path d={`M${cx + r * 0.85},${cy - r * 0.2 + t * 30} q8,12 0,18 q-8,-6 0,-18 Z`} fill="#7fd0ff" stroke={ink} strokeWidth={2.5} opacity={1 - t} />;
    }
    case "hearts":
      return (
        <g>
          {[0, 1].map((i) => {
            const t = ((f + i * 22) % 44) / 44;
            // start clear of the ears/fluff (above-outside the head) and rise only a little: at max scale the
            // figure top is already at the title band
            const x = cx + (i ? 1 : -1) * (r * 1.05 + t * 10);
            const y = cy - r - 14 - t * 34;
            return <path key={i} d="M0,10 C-16,0 -14,-12 -6,-12 C-2,-12 0,-9 0,-6 C0,-9 2,-12 6,-12 C14,-12 16,0 0,10 Z" fill={pal.primary} stroke={ink} strokeWidth={2} opacity={1 - t} transform={`translate(${x} ${y}) scale(1.5)`} />;
          })}
        </g>
      );
    case "dust":
      return (
        <g fill="#d8c8a8">
          {[0, 1, 2].map((i) => {
            const t = ((f + i * 6) % 18) / 18;
            return <circle key={i} cx={-60 - t * 50} cy={-8 - t * 16} r={6 + t * 10} opacity={0.7 * (1 - t)} />;
          })}
        </g>
      );
    default: {
      const _x: never = pose.fx;
      return null;
    }
  }
}

// ── horizontal extent ────────────────────────────────────────────────────────────────────────────────────────────

/** Min left screen margin for characters (px); the left safe inset is 0 but a cropped tail looks broken. */
const CHAR_SCREEN_MARGIN = 24;

/**
 * Horizontal extent [left, right] in body units of a figure FACING RIGHT, measured from the drawing code
 * incl. fluffy scallops (~+12), the wagging tail at its widest angle, raised arms, the run lean and fx
 * (hearts/dust). Quadrupeds: tail tip reaches ~-140, snout/hearts ~+125. Fish: tail fin ~-140.
 */
function figureExtent(species: Species): [number, number] {
  const plan = anatomy(species).plan;
  switch (plan) {
    case "quad":
      return [-152, 140];
    case "swim":
      return [-148, 112];
    case "biped":
      return [-124, 124];
    default: {
      const _x: never = plan;
      return [-150, 150];
    }
  }
}

/** Extent after the facing flip (facing left mirrors the figure). */
export function screenExtent(species: Species, flip: 1 | -1): [number, number] {
  const [l, r] = figureExtent(species);
  return flip === 1 ? [l, r] : [-r, -l];
}

/** Where a character stands this beat (constant over the beat) + its on-stage bounding box in scene px. */
export interface CharacterBox {
  x: number;
  scale: number;
  flip: 1 | -1;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Top of the tallest figure (head + fluff + hat) in body units above the ground line. */
const FIGURE_TOP_UNITS = 205;

/**
 * Keep the WHOLE figure (tail, fluff, raised arms, fx) in frame for the whole beat, accounting for the camera's
 * worst-case push-in + drift. If the visible range is too narrow for the figure, it is shrunk to fit.
 */
export function characterLayout(def: CharacterDef, placement: CharacterPlacement, xOverride: number | undefined, cam: CameraBounds): CharacterBox {
  const flip: 1 | -1 = (placement.facing ?? "right") === "left" ? -1 : 1;
  const [extL, extR] = screenExtent(def.species, flip);
  const [visL, visR] = visibleSceneRange(cam, CHAR_SCREEN_MARGIN, SAFE.right);
  const wanted = Math.min(MAX_CHAR_SCALE, Math.max(0.4, placement.scale ?? 1)) * UNIT_PX;
  const scale = Math.min(wanted, (visR - visL) / (extR - extL));
  const xWanted = xOverride ?? characterX(placement.position ?? "center");
  const x = clamp(xWanted, visL - extL * scale, visR - extR * scale);
  return { x, scale, flip, left: x + extL * scale, right: x + extR * scale, top: GROUND_Y - FIGURE_TOP_UNITS * scale, bottom: GROUND_Y };
}

// ── main component ────────────────────────────────────────────────────────────────────────────────────────────────

export function characterX(position: CharacterPlacement["position"]): number {
  const w = SAFE.right - SAFE.left;
  switch (position) {
    case "left":
      return SAFE.left + w * 0.22;
    case "center":
      return SAFE.left + w * 0.5;
    case "right":
      return SAFE.left + w * 0.78;
    default: {
      const _x: never = position;
      return SAFE.left + w * 0.5;
    }
  }
}

export const Character: React.FC<{ def: CharacterDef; placement: CharacterPlacement; index: number; xOverride?: number }> = ({ def, placement, index, xOverride }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette, style } = useTheme();
  const seed = random(`char-${def.id}`) * 10;
  const an = anatomy(def.species);
  const pose = poseFor(placement.action ?? "idle", frame, seed + index);
  // blink: ~every 2.5–3.5 s for 4 frames (deterministic per character)
  const period = 75 + Math.floor(random(`blink-${def.id}`) * 30);
  const blink = (frame + Math.floor(seed * 7)) % period < 4;
  const sw = style.outline ? 4 : 3.2;
  const o = { stroke: palette.ink, strokeWidth: sw, strokeLinejoin: "round" as const };
  const c: DrawCtx = { def, an, pose, pal: palette, ink: palette.ink, sw, f: frame, o };

  const { x, scale, flip } = characterLayout(def, placement, xOverride, useCameraOffset());

  // entrance
  let enterDx = 0;
  let enterScale = 1;
  const enterT = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const enter = placement.enter ?? "none";
  switch (enter) {
    case "none":
      break;
    case "from-left":
      enterDx = -(x + 300) * (1 - enterT);
      break;
    case "from-right":
      enterDx = (1080 - x + 300) * (1 - enterT);
      break;
    case "pop":
      enterScale = spring({ frame, fps, config: { damping: 10, stiffness: 170 } });
      break;
    default: {
      const _x: never = enter;
    }
  }
  const floatY = an.plan === "swim" ? Math.sin(frame / 12 + seed) * 10 - 40 : 0;
  const headT = `translate(0 ${pose.headDy}) rotate(${pose.headTilt} ${an.head.cx} ${an.head.cy + an.head.r})`;
  const accs = (def.accessories ?? []) as Accessory[];
  const hardShadow = style.shadow === "hard";

  return (
    <g transform={`translate(${(x + enterDx).toFixed(1)} ${GROUND_Y}) scale(${(scale * enterScale).toFixed(4)})`}>
      {/* ground shadow (stays on the ground while the body hops) */}
      <ellipse cx={0} cy={0} rx={an.plan === "quad" ? 95 : 64} ry={hardShadow ? 9 : 11} fill="#000" opacity={hardShadow ? 0.3 : 0.16 * (1 - Math.min(0.6, -pose.dy / 120))} />
      <g transform={`scale(${flip} 1)`}>
        <g transform={`translate(${pose.dx.toFixed(2)} ${(pose.dy + floatY).toFixed(2)}) rotate(${pose.rot} 0 0) scale(1 ${pose.squash.toFixed(4)})`}>
          {accs.map((a, i) => (
            <React.Fragment key={`b${i}`}>{accessoryBack(a, c)}</React.Fragment>
          ))}
          {bodyAndLimbs(c, false)}
          <g transform={headT}>
            {headBack(c)}
            {headFront(c)}
            <Face an={an} pose={pose} blink={blink} ink={palette.ink} sw={sw} species={def.species} />
            {accs
              .filter((a) => a !== "scarf" && a !== "collar" && a !== "backpack" && a !== "cape")
              .map((a, i) => (
                <React.Fragment key={`h${i}`}>{accessoryFront(a, c)}</React.Fragment>
              ))}
          </g>
          {accs
            .filter((a) => a === "scarf" || a === "collar" || a === "backpack" || a === "cape")
            .map((a, i) => (
              <React.Fragment key={`f${i}`}>{accessoryFront(a, c)}</React.Fragment>
            ))}
          {bodyAndLimbs(c, true)}
          <Fx c={c} />
        </g>
      </g>
    </g>
  );
};

/** Spread characters that share a position so they don't stack on top of each other. */
export function layoutCharacters(placements: CharacterPlacement[]): number[] {
  const xs = placements.map((p) => characterX(p.position ?? "center"));
  const seen = new Map<number, number>();
  return xs.map((x) => {
    const n = seen.get(x) ?? 0;
    seen.set(x, n + 1);
    return x + (n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 200);
  });
}
