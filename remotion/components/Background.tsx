// Background presets (every BACKGROUNDS entry × every TIMES_OF_DAY). Drawn as SVG inside the scene layer; layers
// are wrapped in <Parallax depth> so camera drift moves near layers more than far ones. Every preset carries
// some ambient motion (clouds, waves, twinkles, sway) so a scene is never static.

import React, { useId } from "react";
import { random, useCurrentFrame } from "remotion";
import type { Palette, Scene } from "../../src/schema/index.js";
import { darken, lighten, mix } from "../color";
import { GROUND_Y } from "../safeZone";
import { useTheme, type StyleDef } from "../styles";
import { Parallax } from "./CameraDrift";

type Tod = Scene["background"]["timeOfDay"];
type Preset = Scene["background"]["preset"];

const X0 = -220;
const X1 = 1300;
const Y_BOTTOM = 2150;

interface BgCtx {
  pal: Palette;
  tod: Tod;
  style: StyleDef;
  frame: number;
  /** Apply time-of-day lighting to a colour (day = unchanged). */
  t: (c: string) => string;
  uid: string;
}

function todTint(tod: Tod): (c: string) => string {
  switch (tod) {
    case "day":
      return (c) => c;
    case "dusk":
      return (c) => mix(c, "#8a3f6e", 0.28);
    case "night":
      return (c) => mix(c, "#0e1638", 0.58);
    default: {
      const _x: never = tod;
      return (c) => c;
    }
  }
}

function skyColors(pal: Palette, tod: Tod): [string, string] {
  switch (tod) {
    case "day":
      return [darken(pal.sky, 0.08), lighten(pal.sky, 0.5)];
    case "dusk":
      return [mix(pal.sky, "#33245e", 0.75), mix("#ff8a5c", pal.highlight, 0.25)];
    case "night":
      return [mix(pal.sky, "#060a20", 0.88), mix(pal.sky, "#1d2a63", 0.75)];
    default: {
      const _x: never = tod;
      return [pal.sky, pal.sky];
    }
  }
}

/** Vertical gradient; pixel style quantises it into hard bands. */
const Gradient: React.FC<{ id: string; top: string; bottom: string; bands: number }> = ({ id, top, bottom, bands }) => {
  if (bands > 1) {
    const stops: React.ReactNode[] = [];
    for (let i = 0; i < bands; i++) {
      const c = mix(top, bottom, i / (bands - 1));
      stops.push(<stop key={`a${i}`} offset={i / bands} stopColor={c} />, <stop key={`b${i}`} offset={(i + 1) / bands} stopColor={c} />);
    }
    return (
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        {stops}
      </linearGradient>
    );
  }
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={top} />
      <stop offset="1" stopColor={bottom} />
    </linearGradient>
  );
};

const SkyFill: React.FC<{ c: BgCtx; top?: string; bottom?: string; toY?: number }> = ({ c, top, bottom, toY = Y_BOTTOM }) => {
  const [a, b] = skyColors(c.pal, c.tod);
  const id = `${c.uid}-sky`;
  return (
    <>
      <defs>
        <Gradient id={id} top={top ?? a} bottom={bottom ?? b} bands={c.style.skyBands} />
      </defs>
      <rect x={X0} y={-200} width={X1 - X0} height={toY + 200} fill={`url(#${id})`} />
    </>
  );
};

/** Smooth hill silhouette from baseY with a sum of two sines. */
function hillPath(baseY: number, amp: number, wl: number, phase: number, bottom = Y_BOTTOM): string {
  const pts: string[] = [];
  for (let x = X0; x <= X1; x += 20) {
    const y = baseY - amp * (0.55 + 0.3 * Math.sin((x / wl) * Math.PI * 2 + phase) + 0.15 * Math.sin((x / (wl * 0.37)) * Math.PI * 2 + phase * 2.3));
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M${X0},${bottom} L${pts.join(" L")} L${X1},${bottom} Z`;
}

/** Jagged mountain range. */
function mountainPath(baseY: number, height: number, n: number, seed: string): string {
  const step = (X1 - X0) / n;
  const pts: string[] = [`${X0},${baseY}`];
  for (let i = 0; i < n; i++) {
    const px = X0 + step * (i + 0.5) + (random(`${seed}-x${i}`) - 0.5) * step * 0.4;
    const ph = height * (0.6 + 0.4 * random(`${seed}-h${i}`));
    pts.push(`${px.toFixed(1)},${(baseY - ph).toFixed(1)}`);
    pts.push(`${(X0 + step * (i + 1)).toFixed(1)},${(baseY - height * 0.18 * random(`${seed}-v${i}`)).toFixed(1)}`);
  }
  return `M${X0},${Y_BOTTOM} L${pts.join(" L")} L${X1},${Y_BOTTOM} Z`;
}

const Cloud: React.FC<{ x: number; y: number; s: number; fill: string }> = ({ x, y, s, fill }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill}>
    <ellipse cx={0} cy={0} rx={70} ry={34} />
    <circle cx={-30} cy={-18} r={32} />
    <circle cx={18} cy={-30} r={40} />
    <circle cx={52} cy={-8} r={28} />
  </g>
);

const Clouds: React.FC<{ c: BgCtx; n?: number; yMin?: number; yMax?: number }> = ({ c, n = 4, yMin = 220, yMax = 640 }) => {
  if (c.tod === "night") n = Math.max(1, Math.floor(n / 2));
  const fill = c.t(c.tod === "dusk" ? "#ffd6c4" : "#ffffff");
  const span = X1 - X0 + 400;
  return (
    <g opacity={c.tod === "night" ? 0.35 : 0.92}>
      {Array.from({ length: n }, (_, i) => {
        const speed = 0.4 + random(`cl-s${i}`) * 0.6;
        const x = ((random(`cl-x${i}`) * span + c.frame * speed) % span) + X0 - 200;
        const y = yMin + random(`cl-y${i}`) * (yMax - yMin);
        return <Cloud key={i} x={x} y={y} s={0.8 + random(`cl-k${i}`) * 0.9} fill={fill} />;
      })}
    </g>
  );
};

const Stars: React.FC<{ c: BgCtx; n?: number; yMax?: number; always?: boolean }> = ({ c, n = 60, yMax = 900, always }) => {
  if (c.tod === "day" && !always) return null;
  const base = c.tod === "dusk" && !always ? 0.35 : 1;
  return (
    <g fill="#fffbe6">
      {Array.from({ length: n }, (_, i) => {
        const tw = 0.5 + 0.5 * Math.sin(c.frame / (6 + random(`st-f${i}`) * 10) + random(`st-p${i}`) * 6.28);
        const r = 2 + random(`st-r${i}`) * 3.5;
        return <circle key={i} cx={X0 + random(`st-x${i}`) * (X1 - X0)} cy={-60 + random(`st-y${i}`) * yMax} r={r} opacity={base * (0.35 + 0.65 * tw)} />;
      })}
    </g>
  );
};

/** Moon at night, low glowing sun at dusk. Day: nothing (props provide the sun when the script wants one). */
const Celestial: React.FC<{ c: BgCtx; horizon: number }> = ({ c, horizon }) => {
  if (c.tod === "night")
    return (
      <g>
        <circle cx={250} cy={360} r={95} fill="#fff6d8" opacity={0.18} />
        <circle cx={250} cy={360} r={62} fill="#fff6d8" />
        <circle cx={275} cy={345} r={52} fill={skyColors(c.pal, c.tod)[0]} opacity={0.9} />
      </g>
    );
  if (c.tod === "dusk")
    return (
      <g>
        <circle cx={300} cy={horizon - 40} r={180} fill="#ffcf7a" opacity={0.25} />
        <circle cx={300} cy={horizon - 40} r={110} fill="#ffb347" />
      </g>
    );
  return null;
};

const GrassTufts: React.FC<{ c: BgCtx; y: number; color: string; n?: number }> = ({ c, y, color, n = 14 }) => (
  <g fill={color}>
    {Array.from({ length: n }, (_, i) => {
      const x = X0 + 60 + random(`gt-x${i}`) * (X1 - X0 - 120);
      const yy = y + random(`gt-y${i}`) * (Y_BOTTOM - y - 300);
      const sway = Math.sin(c.frame / 18 + i) * 4;
      return <path key={i} d={`M${x - 22},${yy} Q${x - 10 + sway},${yy - 40} ${x - 4},${yy} Q${x + 4 + sway},${yy - 56} ${x + 8},${yy} Q${x + 16 + sway},${yy - 36} ${x + 24},${yy} Z`} />;
    })}
  </g>
);

const PineTree: React.FC<{ x: number; y: number; s: number; fill: string; snow?: string; trunk: string }> = ({ x, y, s, fill, snow, trunk }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x={-9} y={-30} width={18} height={30} fill={trunk} />
    <polygon points="0,-200 -60,-90 -30,-90 -80,-25 80,-25 30,-90 60,-90" fill={fill} />
    {snow && <polygon points="0,-200 -26,-152 -10,-140 0,-150 12,-140 26,-152" fill={snow} />}
  </g>
);

const RoundTree: React.FC<{ x: number; y: number; s: number; fill: string; trunk: string }> = ({ x, y, s, fill, trunk }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x={-10} y={-70} width={20} height={70} fill={trunk} />
    <circle cx={0} cy={-120} r={64} fill={fill} />
    <circle cx={-34} cy={-96} r={40} fill={fill} />
    <circle cx={36} cy={-98} r={42} fill={fill} />
    <circle cx={-14} cy={-146} r={26} fill={lighten(fill, 0.18)} opacity={0.6} />
  </g>
);

// ── presets ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Meadow({ c }: { c: BgCtx }) {
  const g = c.pal.ground;
  return (
    <>
      <SkyFill c={c} />
      <Parallax depth={0.05}>
        <Stars c={c} />
        <Celestial c={c} horizon={900} />
        <Clouds c={c} />
      </Parallax>
      <Parallax depth={0.25}>
        <path d={hillPath(940, 160, 900, 0.4)} fill={c.t(lighten(mix(g, c.pal.sky, 0.35), 0.15))} />
      </Parallax>
      <Parallax depth={0.5}>
        <path d={hillPath(1060, 140, 700, 2.1)} fill={c.t(lighten(g, 0.12))} />
        <RoundTree x={120} y={1010} s={0.7} fill={c.t(darken(g, 0.2))} trunk={c.t("#7a4b2a")} />
        <RoundTree x={880} y={1000} s={0.55} fill={c.t(darken(g, 0.12))} trunk={c.t("#7a4b2a")} />
      </Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y - 40} width={X1 - X0} height={Y_BOTTOM} fill={c.t(g)} />
        <path d={hillPath(GROUND_Y - 20, 40, 1200, 1)} fill={c.t(g)} />
        <GrassTufts c={c} y={GROUND_Y + 20} color={c.t(darken(g, 0.18))} />
        {[150, 420, 760, 980].map((x, i) => (
          <g key={i} transform={`translate(${x} ${GROUND_Y + 90 + (i % 2) * 120})`}>
            <circle r={9} fill={c.t(i % 2 ? c.pal.highlight : "#ffffff")} />
            <circle r={4} fill={c.t(c.pal.accent)} />
          </g>
        ))}
      </Parallax>
    </>
  );
}

function SnowyHills({ c }: { c: BgCtx }) {
  const snow = c.t("#f3f8ff");
  const shade = c.t("#c9dbf2");
  return (
    <>
      <SkyFill c={c} />
      <Parallax depth={0.05}>
        <Stars c={c} />
        <Celestial c={c} horizon={920} />
        <Clouds c={c} n={3} />
      </Parallax>
      <Parallax depth={0.2}>
        <path d={mountainPath(980, 360, 5, "snowm")} fill={c.t(mix(shade, c.pal.sky, 0.35))} />
      </Parallax>
      <Parallax depth={0.45}>
        <path d={hillPath(1060, 150, 800, 1.2)} fill={shade} />
        {[60, 200, 330, 780, 900, 1010].map((x, i) => (
          <PineTree key={i} x={x} y={1045 - (i % 3) * 20} s={0.55 + (i % 2) * 0.15} fill={c.t("#2f6b4f")} snow={snow} trunk={c.t("#5a3b25")} />
        ))}
      </Parallax>
      <Parallax depth={0.9}>
        <path d={hillPath(GROUND_Y - 10, 50, 1300, 0.3)} fill={snow} />
        <rect x={X0} y={GROUND_Y + 30} width={X1 - X0} height={Y_BOTTOM} fill={snow} />
        {[100, 380, 640, 900].map((x, i) => (
          <ellipse key={i} cx={x} cy={GROUND_Y + 150 + (i % 2) * 140} rx={90} ry={14} fill={shade} opacity={0.7} />
        ))}
      </Parallax>
    </>
  );
}

function Mountains({ c }: { c: BgCtx }) {
  const rock = mix("#7d8aa6", c.pal.sky, 0.25);
  return (
    <>
      <SkyFill c={c} />
      <Parallax depth={0.05}>
        <Stars c={c} />
        <Celestial c={c} horizon={820} />
        <Clouds c={c} n={3} yMax={520} />
      </Parallax>
      <Parallax depth={0.15}>
        <path d={mountainPath(900, 520, 4, "mtA")} fill={c.t(lighten(rock, 0.25))} />
      </Parallax>
      <Parallax depth={0.3}>
        <g>
          <path d={mountainPath(1000, 460, 3, "mtB")} fill={c.t(rock)} />
          {/* snow caps: same range clipped to the top band */}
          <clipPath id={`${c.uid}-cap`}>
            <rect x={X0} y={0} width={X1 - X0} height={720} />
          </clipPath>
          <path d={mountainPath(1000, 460, 3, "mtB")} fill={c.t("#f4f7ff")} clipPath={`url(#${c.uid}-cap)`} />
        </g>
      </Parallax>
      <Parallax depth={0.55}>
        <path d={hillPath(1100, 120, 900, 2.4)} fill={c.t(lighten(c.pal.ground, 0.1))} />
      </Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y - 20} width={X1 - X0} height={Y_BOTTOM} fill={c.t(c.pal.ground)} />
        <path d={hillPath(GROUND_Y, 30, 1000, 0.8)} fill={c.t(c.pal.ground)} />
        {[90, 520, 960].map((x, i) => (
          <ellipse key={i} cx={x} cy={GROUND_Y + 120 + i * 60} rx={50} ry={26} fill={c.t("#8b8f99")} />
        ))}
        <GrassTufts c={c} y={GROUND_Y + 20} color={c.t(darken(c.pal.ground, 0.2))} n={10} />
      </Parallax>
    </>
  );
}

function Forest({ c }: { c: BgCtx }) {
  const g = c.pal.ground;
  return (
    <>
      <SkyFill c={c} />
      <Parallax depth={0.05}>
        <Stars c={c} />
        <Celestial c={c} horizon={800} />
        <Clouds c={c} n={2} yMax={420} />
      </Parallax>
      <Parallax depth={0.2}>
        {Array.from({ length: 11 }, (_, i) => (
          <PineTree key={i} x={X0 + i * 140} y={980} s={1 + random(`fa${i}`) * 0.4} fill={c.t(mix(darken(g, 0.35), c.pal.sky, 0.35))} trunk={c.t("#4a3424")} />
        ))}
      </Parallax>
      <Parallax depth={0.45}>
        <rect x={X0} y={1040} width={X1 - X0} height={300} fill={c.t(darken(g, 0.25))} />
        {Array.from({ length: 8 }, (_, i) => {
          const sway = Math.sin(c.frame / 30 + i) * 1.5;
          return (
            <g key={i} transform={`rotate(${sway} ${X0 + 100 + i * 190} 1100)`}>
              {i % 2 ? (
                <RoundTree x={X0 + 100 + i * 190} y={1100} s={1.3} fill={c.t(darken(g, 0.15))} trunk={c.t("#5a3b25")} />
              ) : (
                <PineTree x={X0 + 100 + i * 190} y={1100} s={1.2} fill={c.t(darken(g, 0.3))} trunk={c.t("#5a3b25")} />
              )}
            </g>
          );
        })}
      </Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y - 30} width={X1 - X0} height={Y_BOTTOM} fill={c.t(g)} />
        <path d={hillPath(GROUND_Y - 10, 30, 900, 2)} fill={c.t(g)} />
        <GrassTufts c={c} y={GROUND_Y + 20} color={c.t(darken(g, 0.2))} n={16} />
        {[180, 820].map((x, i) => (
          <g key={i} transform={`translate(${x} ${GROUND_Y + 160 + i * 80})`}>
            <rect x={-6} y={-30} width={12} height={30} fill={c.t("#f2e6d0")} />
            <ellipse cx={0} cy={-34} rx={30} ry={18} fill={c.t(c.pal.primary)} />
            <circle cx={-10} cy={-38} r={5} fill="#fff" />
            <circle cx={10} cy={-32} r={4} fill="#fff" />
          </g>
        ))}
      </Parallax>
    </>
  );
}

function City({ c }: { c: BgCtx }) {
  const lit = c.tod !== "day";
  const building = (seed: string, i: number, base: number, hMin: number, hMax: number, w: number, col: string) => {
    const h = hMin + random(`${seed}${i}`) * (hMax - hMin);
    const x = X0 + i * (w + 14);
    const rows = Math.floor(h / 70);
    return (
      <g key={i}>
        <rect x={x} y={base - h} width={w} height={h + 400} fill={col} />
        {Array.from({ length: rows }, (_, r) =>
          [0, 1, 2].map((k) => {
            const on = lit ? random(`${seed}w${i}-${r}-${k}`) > 0.45 : true;
            const flick = lit && random(`${seed}f${i}-${r}-${k}`) > 0.93 ? (Math.sin(c.frame / 4 + r) > 0 ? 1 : 0.3) : 1;
            return (
              <rect
                key={`${r}-${k}`}
                x={x + 14 + k * ((w - 28) / 3)}
                y={base - h + 24 + r * 70}
                width={(w - 28) / 3 - 12}
                height={36}
                fill={on && lit ? "#ffe08a" : lighten(col, 0.25)}
                opacity={on ? flick : 0.5}
              />
            );
          }),
        )}
      </g>
    );
  };
  return (
    <>
      <SkyFill c={c} />
      <Parallax depth={0.05}>
        <Stars c={c} n={30} yMax={600} />
        <Celestial c={c} horizon={800} />
        <Clouds c={c} n={3} yMax={480} />
      </Parallax>
      <Parallax depth={0.2}>{Array.from({ length: 11 }, (_, i) => building("cb", i, 1000, 260, 560, 130, c.t(mix("#6c7a99", c.pal.sky, 0.4))))}</Parallax>
      <Parallax depth={0.45}>{Array.from({ length: 8 }, (_, i) => building("cf", i, 1110, 200, 460, 180, c.t(mix("#3f4a66", c.pal.primary, 0.12))))}</Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y - 40} width={X1 - X0} height={60} fill={c.t("#a9adb8")} />
        <rect x={X0} y={GROUND_Y + 20} width={X1 - X0} height={Y_BOTTOM} fill={c.t("#4b4f5c")} />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={X0 + i * 200 - ((c.frame * 2) % 200)} y={GROUND_Y + 260} width={110} height={16} fill={c.t("#f2f2f2")} />
        ))}
        {[120, 860].map((x) => (
          <g key={x}>
            <rect x={x - 6} y={GROUND_Y - 330} width={12} height={300} fill={c.t("#2d3140")} />
            <circle cx={x} cy={GROUND_Y - 340} r={22} fill={lit ? "#ffe9a6" : c.t("#d9dce3")} />
            {lit && <circle cx={x} cy={GROUND_Y - 340} r={60} fill="#ffe9a6" opacity={0.25} />}
          </g>
        ))}
      </Parallax>
    </>
  );
}

function Desert({ c }: { c: BgCtx }) {
  const sand = c.t("#f0c879");
  const sandDark = c.t("#d9a55a");
  return (
    <>
      <SkyFill c={c} bottom={c.tod === "day" ? lighten("#ffd59a", 0.3) : undefined} />
      <Parallax depth={0.05}>
        <Stars c={c} />
        <Celestial c={c} horizon={960} />
        <Clouds c={c} n={1} yMax={400} />
      </Parallax>
      <Parallax depth={0.2}>
        <path d={mountainPath(980, 220, 3, "mesa")} fill={c.t("#c97f4f")} />
      </Parallax>
      <Parallax depth={0.45}>
        <path d={hillPath(1070, 130, 1100, 0.9)} fill={sandDark} />
        {[160, 900].map((x, i) => (
          <g key={i} transform={`translate(${x} ${1040 - i * 20}) scale(${0.8 + i * 0.2})`} fill={c.t("#3f8f5a")}>
            <rect x={-18} y={-180} width={36} height={180} rx={18} />
            <rect x={-70} y={-130} width={26} height={70} rx={13} />
            <rect x={-70} y={-80} width={60} height={24} rx={12} />
            <rect x={44} y={-150} width={26} height={80} rx={13} />
            <rect x={10} y={-94} width={60} height={24} rx={12} />
          </g>
        ))}
      </Parallax>
      <Parallax depth={0.9}>
        <path d={hillPath(GROUND_Y - 10, 60, 1000, 2.5)} fill={sand} />
        <rect x={X0} y={GROUND_Y + 30} width={X1 - X0} height={Y_BOTTOM} fill={sand} />
        {/* heat shimmer ripples */}
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            d={`M${X0},${GROUND_Y + 150 + i * 130} q 80 ${-14 + Math.sin(c.frame / 10 + i) * 6} 160 0 t 160 0 t 160 0 t 160 0 t 160 0 t 160 0 t 160 0 t 160 0 t 160 0`}
            stroke={sandDark}
            strokeWidth={8}
            fill="none"
            opacity={0.6}
          />
        ))}
      </Parallax>
    </>
  );
}

function Ocean({ c }: { c: BgCtx }) {
  const horizon = 980;
  const sea = c.t(mix("#1e88c8", c.pal.sky, 0.25));
  const wave = (y: number, amp: number, ph: number, col: string, op: number) => {
    const pts: string[] = [];
    for (let x = X0; x <= X1; x += 30) pts.push(`${x},${(y + amp * Math.sin(x / 70 + c.frame / 9 + ph)).toFixed(1)}`);
    return <path d={`M${X0},${Y_BOTTOM} L${pts.join(" L")} L${X1},${Y_BOTTOM} Z`} fill={col} opacity={op} />;
  };
  return (
    <>
      <SkyFill c={c} />
      <Parallax depth={0.05}>
        <Stars c={c} yMax={850} />
        <Celestial c={c} horizon={horizon} />
        <Clouds c={c} n={3} yMax={700} />
      </Parallax>
      <Parallax depth={0.3}>
        <rect x={X0} y={horizon} width={X1 - X0} height={Y_BOTTOM} fill={sea} />
        {wave(1020, 6, 0, lighten(sea, 0.15), 0.8)}
        {wave(1080, 10, 1.3, darken(sea, 0.1), 0.9)}
        <g transform={`translate(${780 + Math.sin(c.frame / 40) * 20} ${1000 + Math.sin(c.frame / 12) * 4})`}>
          <polygon points="0,0 70,0 55,22 15,22" fill={c.t("#8a5a3a")} />
          <polygon points="36,-6 36,-80 72,-12" fill={c.t("#ffffff")} />
        </g>
      </Parallax>
      <Parallax depth={0.6}>{wave(1130, 14, 2.1, sea, 1)}</Parallax>
      <Parallax depth={0.9}>
        <path d={hillPath(GROUND_Y - 25, 30, 1300, 0.5)} fill={c.t("#f2d79b")} />
        <rect x={X0} y={GROUND_Y + 10} width={X1 - X0} height={Y_BOTTOM} fill={c.t("#f2d79b")} />
        {wave(GROUND_Y - 20 + Math.sin(c.frame / 20) * 8, 6, 0.4, c.t("#ffffff"), 0.55)}
        <rect x={X0} y={GROUND_Y + 12} width={X1 - X0} height={Y_BOTTOM} fill={c.t("#f2d79b")} />
      </Parallax>
    </>
  );
}

function Underwater({ c }: { c: BgCtx }) {
  const top = c.t(mix("#36b6e8", c.pal.sky, 0.3));
  const bottom = c.t("#0b3d6b");
  return (
    <>
      <SkyFill c={c} top={top} bottom={bottom} />
      <Parallax depth={0.1}>
        {/* light rays */}
        {[0, 1, 2, 3].map((i) => (
          <polygon
            key={i}
            points={`${100 + i * 260 + Math.sin(c.frame / 40 + i) * 30},-100 ${180 + i * 260 + Math.sin(c.frame / 40 + i) * 30},-100 ${320 + i * 240},1300 ${180 + i * 240},1300`}
            fill="#ffffff"
            opacity={c.tod === "night" ? 0.03 : 0.08}
          />
        ))}
      </Parallax>
      <Parallax depth={0.3}>
        {Array.from({ length: 6 }, (_, i) => (
          <circle key={i} cx={X0 + 140 + i * 230} cy={((1300 - ((c.frame * (1.5 + i * 0.3) + i * 200) % 1400)) | 0) as number} r={8 + (i % 3) * 5} fill="none" stroke="#e6f7ff" strokeWidth={3} opacity={0.5} />
        ))}
        <path d={hillPath(1090, 90, 800, 1)} fill={c.t("#165a7d")} />
      </Parallax>
      <Parallax depth={0.9}>
        <path d={hillPath(GROUND_Y - 10, 40, 900, 2.2)} fill={c.t("#e3c98e")} />
        <rect x={X0} y={GROUND_Y + 20} width={X1 - X0} height={Y_BOTTOM} fill={c.t("#e3c98e")} />
        {[60, 230, 860, 1000].map((x, i) => {
          const sway = Math.sin(c.frame / 15 + i) * 18;
          return (
            <path
              key={i}
              d={`M${x},${GROUND_Y + 20} C${x + sway},${GROUND_Y - 120} ${x - sway},${GROUND_Y - 220} ${x + sway * 1.5},${GROUND_Y - 330}`}
              stroke={c.t(i % 2 ? "#2fa36b" : "#1f7a4f")}
              strokeWidth={22}
              strokeLinecap="round"
              fill="none"
            />
          );
        })}
        {[400, 700].map((x, i) => (
          <g key={i} fill={c.t(i ? c.pal.primary : "#ff8fa3")}>
            <circle cx={x} cy={GROUND_Y + 30} r={30} />
            <circle cx={x - 26} cy={GROUND_Y + 10} r={18} />
            <circle cx={x + 26} cy={GROUND_Y + 6} r={20} />
          </g>
        ))}
      </Parallax>
    </>
  );
}

function Space({ c }: { c: BgCtx }) {
  const hue = c.tod === "day" ? "#2b2d6e" : c.tod === "dusk" ? "#4a1f5e" : "#0f1233";
  return (
    <>
      <SkyFill c={c} top={"#05060f"} bottom={hue} />
      <Parallax depth={0.03}>
        <Stars c={c} n={110} yMax={1300} always />
      </Parallax>
      <Parallax depth={0.15}>
        <g transform={`translate(800 430) rotate(${c.frame * 0.05})`}>
          <circle r={130} fill={mix(c.pal.accent, "#000000", 0.1)} />
          <path d="M-130,10 A130,130 0 0,0 130,10 Z" fill={darken(c.pal.accent, 0.25)} opacity={0.5} />
          <ellipse rx={220} ry={46} fill="none" stroke={c.pal.highlight} strokeWidth={14} opacity={0.85} transform="rotate(-18)" />
        </g>
        <circle cx={180} cy={700} r={40} fill={c.pal.primary} opacity={0.85} />
      </Parallax>
      <Parallax depth={0.9}>
        <path d={hillPath(GROUND_Y - 10, 60, 1000, 1.6)} fill="#9aa0b4" />
        <rect x={X0} y={GROUND_Y + 30} width={X1 - X0} height={Y_BOTTOM} fill="#9aa0b4" />
        {[[140, 1290, 60], [620, 1380, 90], [930, 1250, 40], [380, 1560, 70]].map(([x, y, r], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y} rx={r} ry={r * 0.35} fill="#7d8296" />
            <ellipse cx={x} cy={y - r * 0.06} rx={r * 0.8} ry={r * 0.24} fill="#6a6f83" />
          </g>
        ))}
      </Parallax>
    </>
  );
}

function IndoorRoom({ c }: { c: BgCtx }) {
  const wall = c.t(lighten(mix(c.pal.sky, c.pal.accent, 0.15), 0.55));
  const floor = c.t("#b9824f");
  return (
    <>
      <rect x={X0} y={-200} width={X1 - X0} height={Y_BOTTOM + 200} fill={wall} />
      <Parallax depth={0.3}>
        {/* window with the time of day outside */}
        <g transform="translate(560 420)">
          <rect x={-10} y={-10} width={360} height={420} fill={c.t("#ffffff")} />
          <clipPath id={`${c.uid}-win`}>
            <rect x={10} y={10} width={320} height={380} />
          </clipPath>
          <g clipPath={`url(#${c.uid}-win)`}>
            <rect x={0} y={0} width={340} height={400} fill={skyColors(c.pal, c.tod)[0]} />
            <rect x={0} y={200} width={340} height={200} fill={skyColors(c.pal, c.tod)[1]} opacity={0.8} />
            <g transform="translate(-420 -380)">
              <Clouds c={c} n={3} yMin={460} yMax={600} />
            </g>
            {c.tod === "night" && <circle cx={250} cy={100} r={40} fill="#fff6d8" />}
            <path d={`M0,330 Q90,280 170,320 T340,300 L340,400 L0,400 Z`} fill={c.t(c.pal.ground)} />
          </g>
          <rect x={160} y={10} width={20} height={380} fill={c.t("#ffffff")} />
          <rect x={10} y={190} width={320} height={20} fill={c.t("#ffffff")} />
        </g>
        {/* picture frame + shelf */}
        <rect x={110} y={480} width={220} height={170} fill={c.t(c.pal.ink)} />
        <rect x={124} y={494} width={192} height={142} fill={c.t(c.pal.highlight)} />
        <circle cx={220} cy={565} r={40} fill={c.t(c.pal.primary)} />
        <rect x={90} y={820} width={280} height={22} fill={c.t("#8a5a34")} />
        {[120, 170, 230].map((x, i) => (
          <rect key={i} x={x} y={820 - 70 - i * 10} width={36} height={70 + i * 10} fill={c.t([c.pal.primary, c.pal.accent, "#4caf7a"][i])} />
        ))}
      </Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y - 70} width={X1 - X0} height={30} fill={c.t(darken(wall, 0.2))} />
        <rect x={X0} y={GROUND_Y - 40} width={X1 - X0} height={Y_BOTTOM} fill={floor} />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={X0 + i * 140} y1={GROUND_Y - 40} x2={X0 + i * 140 - 260} y2={Y_BOTTOM} stroke={darken(floor, 0.15)} strokeWidth={5} />
        ))}
        <ellipse cx={540} cy={GROUND_Y + 40} rx={430} ry={70} fill={c.t(c.pal.primary)} opacity={0.75} />
        {/* lamp glow (warmer/brighter at night) */}
        <g transform="translate(940 860)">
          <rect x={-6} y={0} width={12} height={GROUND_Y - 900} fill={c.t("#444")} />
          <polygon points="-60,0 60,0 36,-90 -36,-90" fill={c.t(c.pal.highlight)} />
          {c.tod !== "day" && <circle cx={0} cy={30} r={170 + Math.sin(c.frame / 8) * 6} fill="#ffe7a0" opacity={0.18} />}
        </g>
      </Parallax>
    </>
  );
}

function Lab({ c }: { c: BgCtx }) {
  const wall = c.t("#dfe8ef");
  const glow = c.tod === "day" ? 1 : 1.2;
  return (
    <>
      <rect x={X0} y={-200} width={X1 - X0} height={Y_BOTTOM + 200} fill={wall} />
      <Parallax depth={0.2}>
        {Array.from({ length: 12 }, (_, r) =>
          Array.from({ length: 10 }, (_, k) => <rect key={`${r}-${k}`} x={X0 + k * 160} y={r * 90} width={156} height={86} fill={c.t(r % 2 === k % 2 ? "#e8f0f5" : "#d5e1ea")} />),
        )}
      </Parallax>
      <Parallax depth={0.4}>
        {[100, 600].map((x, i) => (
          <g key={i} transform={`translate(${x} 470)`}>
            <rect x={-10} y={-10} width={360} height={250} rx={10} fill={c.t("#2b3442")} />
            <rect x={0} y={0} width={340} height={230} fill={c.t("#0f2b2a")} />
            <polyline
              points={Array.from({ length: 12 }, (_, k) => `${10 + k * 29},${180 - (k * 11 + Math.sin(c.frame / 6 + k + i) * 30 + 40 * random(`lab${i}${k}`))}`).join(" ")}
              stroke={i ? c.pal.highlight : "#43ff9a"}
              strokeWidth={8}
              fill="none"
              opacity={glow}
            />
          </g>
        ))}
      </Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y - 40} width={X1 - X0} height={Y_BOTTOM} fill={c.t("#b6c4cf")} />
        {Array.from({ length: 10 }, (_, i) => (
          <line key={i} x1={X0 + i * 160} y1={GROUND_Y - 40} x2={X0 + i * 160} y2={Y_BOTTOM} stroke={c.t("#a2b2be")} strokeWidth={4} />
        ))}
        {/* bench with flasks */}
        <rect x={-40} y={GROUND_Y - 260} width={400} height={30} fill={c.t("#56606e")} />
        <rect x={0} y={GROUND_Y - 230} width={24} height={190} fill={c.t("#56606e")} />
        <rect x={300} y={GROUND_Y - 230} width={24} height={190} fill={c.t("#56606e")} />
        {[[60, c.pal.primary], [150, "#43c6ff"], [240, c.pal.accent]].map(([x, col], i) => {
          const lvl = 0.5 + 0.15 * Math.sin(c.frame / 10 + i);
          return (
            <g key={i} transform={`translate(${x as number} ${GROUND_Y - 260})`}>
              <path d="M-14,-110 L-14,-70 L-46,0 L46,0 L14,-70 L14,-110 Z" fill="#ffffff" opacity={0.75} />
              <path d={`M${-46 * lvl},${-70 * lvl} L${46 * lvl},${-70 * lvl} L46,0 L-46,0 Z`} fill={col as string} />
              <circle cx={6} cy={-120 - ((c.frame * 2 + i * 20) % 50)} r={6} fill={col as string} opacity={0.6} />
            </g>
          );
        })}
      </Parallax>
    </>
  );
}

/**
 * A real maze seen from above-behind: a binary-tree maze on a 7×6 grid of the ground plane, projected with simple
 * perspective (eye height 1, ground row z=1 lands at y≈1100) and drawn far→near as extruded hedge walls.
 */
const MAZE_COLS = 7;
const MAZE_ROWS = 6;
const MAZE_WALL_H = 0.42; // in eye heights
const MAZE_K = 400; // px: ground at depth z is horizon + K/z

interface MazeWall {
  kind: "h" | "v"; // h: runs across (constant z), v: runs into the distance (constant x)
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Walls of a deterministic binary-tree maze (each cell opens north or east; the rest stay walls). */
function mazeWalls(seed: string): MazeWall[] {
  const walls: MazeWall[] = [];
  const x0 = -MAZE_COLS / 2;
  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let col = 0; col < MAZE_COLS; col++) {
      const x = x0 + col;
      const z = 1 + r;
      const lastRow = r === MAZE_ROWS - 1;
      const lastCol = col === MAZE_COLS - 1;
      const openNorth = lastCol ? true : lastRow ? false : random(`${seed}-${r}-${col}`) < 0.5;
      // the centre column near the camera stays an open corridor leading into the maze
      const corridor = col === Math.floor(MAZE_COLS / 2) && r < 2;
      if (!(openNorth || corridor) || (lastRow && !corridor && random(`${seed}-far-${col}`) < 0.6)) walls.push({ kind: "h", x0: x, x1: x + 1, z0: z + 1, z1: z + 1 });
      // no side walls flanking the near corridor either: they would poke out behind the characters
      const besideCorridor = r < 2 && Math.abs(x + 1) === 0.5;
      if ((openNorth || corridor) && !lastCol && !besideCorridor) walls.push({ kind: "v", x0: x + 1, x1: x + 1, z0: z, z1: z + 1 });
    }
  }
  return walls;
}

function Maze({ c }: { c: BgCtx }) {
  const hedge = c.t(darken(c.pal.ground, 0.15));
  const hedgeTop = c.t(lighten(c.pal.ground, 0.15));
  const hedgeSide = c.t(darken(c.pal.ground, 0.38));
  const path = c.t("#e7d3a6");
  const horizon = 700;
  const cx = 480;
  const F = MAZE_K; // horizontal px per world unit at z=1 (square ground cells)
  const P = (x: number, z: number, h = 0) => `${(cx + (x * F) / z).toFixed(1)},${(horizon + (MAZE_K * (1 - h)) / z).toFixed(1)}`;
  const walls = mazeWalls("maze");
  // painter's order: far → near; within a depth, outer walls first
  const order = [...walls].sort((p, q) => Math.max(q.z0, q.z1) - Math.max(p.z0, p.z1) || Math.abs(q.x0) - Math.abs(p.x0));
  const H = MAZE_WALL_H;
  const T = 0.09; // wall half-thickness (world units)
  return (
    <>
      <SkyFill c={c} toY={horizon + 100} />
      <Parallax depth={0.05}>
        <Stars c={c} yMax={600} />
        <Celestial c={c} horizon={horizon} />
        <Clouds c={c} n={3} yMin={200} yMax={520} />
      </Parallax>
      <Parallax depth={0.35}>
        <rect x={X0} y={horizon} width={X1 - X0} height={Y_BOTTOM} fill={path} />
        {/* faint far hedge line at the horizon */}
        <rect x={X0} y={horizon - 14} width={X1 - X0} height={20} fill={hedge} />
        {order.map((w, i) =>
          w.kind === "h" ? (
            <g key={i}>
              <polygon points={`${P(w.x0, w.z0)} ${P(w.x1, w.z0)} ${P(w.x1, w.z0, H)} ${P(w.x0, w.z0, H)}`} fill={hedge} stroke={hedgeSide} strokeWidth={2} />
              <polygon points={`${P(w.x0, w.z0 - T, H)} ${P(w.x1, w.z0 - T, H)} ${P(w.x1, w.z0 + T, H)} ${P(w.x0, w.z0 + T, H)}`} fill={hedgeTop} />
            </g>
          ) : (
            <g key={i}>
              {/* the side face that looks toward the centre is the visible one */}
              <polygon points={`${P(w.x0 + (w.x0 > 0 ? -T : T), w.z0)} ${P(w.x0 + (w.x0 > 0 ? -T : T), w.z1)} ${P(w.x0 + (w.x0 > 0 ? -T : T), w.z1, H)} ${P(w.x0 + (w.x0 > 0 ? -T : T), w.z0, H)}`} fill={hedgeSide} />
              <polygon points={`${P(w.x0 - T, w.z0, H)} ${P(w.x0 + T, w.z0, H)} ${P(w.x0 + T, w.z1, H)} ${P(w.x0 - T, w.z1, H)}`} fill={hedgeTop} />
            </g>
          ),
        )}
      </Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y - 30} width={X1 - X0} height={Y_BOTTOM} fill={path} />
        <rect x={X0} y={GROUND_Y + 170} width={X1 - X0} height={Y_BOTTOM} fill={hedge} />
        <rect x={X0} y={GROUND_Y + 130} width={X1 - X0} height={50} fill={hedgeTop} />
        {Array.from({ length: 10 }, (_, j) => (
          <circle key={j} cx={X0 + 60 + j * 150} cy={GROUND_Y + 135} r={34} fill={hedgeTop} />
        ))}
        {/* pebbles on the path */}
        {[200, 470, 760].map((x, i) => (
          <ellipse key={i} cx={x} cy={GROUND_Y + 40 + (i % 2) * 40} rx={16} ry={7} fill={c.t("#c9b283")} />
        ))}
        {/* magic glow motes hovering over the hedges */}
        {Array.from({ length: 8 }, (_, i) => {
          const tw = 0.5 + 0.5 * Math.sin(c.frame / 7 + i * 1.3);
          return <circle key={i} cx={80 + i * 125} cy={760 + (i % 3) * 120 + Math.sin(c.frame / 20 + i) * 15} r={6 + tw * 6} fill={c.pal.highlight} opacity={0.35 + 0.5 * tw} />;
        })}
      </Parallax>
    </>
  );
}

function Plain({ c }: { c: BgCtx }) {
  const bg = c.t(c.pal.sky);
  return (
    <>
      <SkyFill c={c} top={bg} bottom={c.t(lighten(c.pal.sky, 0.25))} />
      <Parallax depth={0.15}>
        {/* subtle dot texture, slowly sliding */}
        {Array.from({ length: 16 }, (_, r) =>
          Array.from({ length: 10 }, (_, k) => (
            <circle key={`${r}-${k}`} cx={X0 + k * 150 + (r % 2) * 75 + ((c.frame * 0.6) % 150)} cy={r * 130} r={7} fill={lighten(bg, 0.25)} opacity={0.5} />
          )),
        )}
      </Parallax>
      <Parallax depth={0.9}>
        <rect x={X0} y={GROUND_Y} width={X1 - X0} height={Y_BOTTOM} fill={c.t(darken(c.pal.sky, 0.12))} />
        <rect x={X0} y={GROUND_Y - 6} width={X1 - X0} height={12} fill={c.t(darken(c.pal.sky, 0.25))} />
      </Parallax>
    </>
  );
}

function renderPreset(preset: Preset, c: BgCtx): React.ReactNode {
  switch (preset) {
    case "meadow":
      return <Meadow c={c} />;
    case "snowy-hills":
      return <SnowyHills c={c} />;
    case "mountains":
      return <Mountains c={c} />;
    case "forest":
      return <Forest c={c} />;
    case "city":
      return <City c={c} />;
    case "desert":
      return <Desert c={c} />;
    case "ocean":
      return <Ocean c={c} />;
    case "underwater":
      return <Underwater c={c} />;
    case "space":
      return <Space c={c} />;
    case "indoor-room":
      return <IndoorRoom c={c} />;
    case "lab":
      return <Lab c={c} />;
    case "maze":
      return <Maze c={c} />;
    case "plain":
      return <Plain c={c} />;
    default: {
      const _x: never = preset;
      return null;
    }
  }
}

export const Background: React.FC<{ preset: Preset; timeOfDay: Tod }> = ({ preset, timeOfDay }) => {
  const { palette, style } = useTheme();
  const frame = useCurrentFrame();
  const uid = useId().replace(/:/g, "");
  const c: BgCtx = { pal: palette, tod: timeOfDay, style, frame, t: todTint(timeOfDay), uid };
  return <g>{renderPreset(preset, c)}</g>;
};
