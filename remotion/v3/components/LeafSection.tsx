// LeafSection renderer (meta: src/v3/components-meta/LeafSection.ts). One <svg>, all vector. Every flow reads the
// meta's one model (simAt: pore, night, carbon dioxide inside, cam store, sugar, c4 pump, water), so what moves is what
// describe says. Particles are pure functions of the frame (slot i, period T): no state, motion-blur safe.
// Outside air → under skin + guard cells (the pore) → inside (spongy cells + air spaces / the c4 rings) → tall cells
// (c3 / cam, with the cam store) → top skin + cuticle → flows (CO₂ in, water out, 4-carbon handoff, sugar) → sky badge
// → night tint → ping / focus rings.
import React from "react";
import { interpolate } from "remotion";
import { guardOffset, LEAF, meta, palisadeCells, poreHalf, ringCells, simAt, type LeafSectionPropsT } from "../../../src/v3/components-meta/LeafSection";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color } from "../../v2/theme";
import { plant } from "./tokens";

const frac = (x: number) => x - Math.floor(x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 0 → 1 → 0 over a particle's life (fade in over the first `a`, out over the last `a`). */
const life = (u: number, a = 0.12) => clamp01(Math.min(u / a, (1 - u) / a));

/** A carbon dioxide molecule: dark carbon between two red oxygens. */
export function Co2({ x, y, s = 1, a = 1, rot = 0 }: { x: number; y: number; s?: number; a?: number; rot?: number }) {
  if (a <= 0.01) return null;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} opacity={a}>
      <circle cx={-15} cy={0} r={8} fill={plant.oxygen} />
      <circle cx={15} cy={0} r={8} fill={plant.oxygen} />
      <circle cx={0} cy={0} r={10} fill={plant.carbon} stroke={plant.carbonEdge} strokeWidth={2} />
    </g>
  );
}
function Drop({ x, y, a, s = 1 }: { x: number; y: number; a: number; s?: number }) {
  if (a <= 0.01) return null;
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M 0 -14 C 6 -5 10 0 10 5 A 10 10 0 0 1 -10 5 C -10 0 -6 -5 0 -14 Z" fill={plant.water} opacity={a} />;
}
function Hex({ x, y, r, a }: { x: number; y: number; r: number; a: number }) {
  if (a <= 0.01) return null;
  const pts = Array.from({ length: 6 }, (_, k) => {
    const t = (k / 6) * Math.PI * 2 + Math.PI / 6;
    return `${(x + r * Math.cos(t)).toFixed(1)},${(y + r * Math.sin(t)).toFixed(1)}`;
  }).join(" ");
  return <polygon points={pts} fill="none" stroke={plant.sugar} strokeWidth={4} strokeLinejoin="round" opacity={a} />;
}

/** spots in the air spaces where the carbon dioxide inside sits (jitters a little) */
const INSIDE = [[160, 570], [290, 600], [420, 590], [560, 585], [690, 575], [210, 720], [330, 735], [600, 728], [740, 712]] as const;
const C4_INSIDE = [[150, 180], [750, 180], [120, 740], [780, 740], [450, 120], [300, 770], [600, 770], [110, 460], [790, 460]] as const;

const Render: React.FC<RenderProps<LeafSectionPropsT>> = ({ props: p, base, frame, events, last, id }) => {
  const W = LEAF.w;
  const s = simAt({ pathway: p.pathway, start: base.start, heat: p.heat }, events, frame);
  const g = (n: string) => `leaf-${n}-${id}`;
  const c4 = p.pathway === "c4";
  const cells = palisadeCells();
  const inner = c4 ? ringCells("inner") : [];
  const outer = c4 ? ringCells("outer") : [];
  const ping = last("pulse");
  const pingT = ping === undefined ? 1 : interpolate(frame, [ping, ping + 10], [0, 1], clampX);
  const ring = flash(frame, last("focus"), 8);
  const [u0, u1] = LEAF.underSkin;
  const [t0, t1] = LEAF.topSkin;
  const P = LEAF.pore;
  const go = guardOffset(s.pore);
  const ph = poreHalf(s.pore);

  // ── carbon dioxide coming in: outside → pore → air pocket → a cell ──
  const N = 9, T = 96;
  const co2In: React.ReactNode[] = [];
  for (let i = 0; i < N; i++) {
    const u = frac((frame + (i * T) / N) / T);
    const sx = 130 + ((i * 37) % 9) * 34;
    let x: number, y: number;
    // target: c3/cam the bottom of a tall cell, c4 an outer cell
    const tgt = c4 ? outer[(i * 5) % outer.length] : { x: cells[(i * 3) % cells.length].x + LEAF.palisade.cw / 2, y: LEAF.palisade.y1 - 20 };
    if (u < 0.55) {
      const k = u / 0.55;
      x = lerp(sx, P.x - 4, k * k);
      y = lerp(LEAF.air[1] - 30, P.y + 24, k);
    } else if (u < 0.7) {
      const k = (u - 0.55) / 0.15;
      x = lerp(P.x - 4, LEAF.airPocket.x, k);
      y = lerp(P.y + 24, LEAF.airPocket.y, k);
    } else {
      const k = (u - 0.7) / 0.3;
      x = lerp(LEAF.airPocket.x, tgt.x, k);
      y = lerp(LEAF.airPocket.y, tgt.y, k);
    }
    // it only gets through while the pore is open: outside it fades with the pore, inside it is absorbed at the end
    const a = s.pore * life(u, 0.1);
    co2In.push(<Co2 key={i} x={x} y={y} s={0.9} a={a} rot={(i * 41 + frame * 1.5) % 360} />);
  }

  // ── carbon dioxide inside (air spaces): as many molecules as there is CO₂ inside ──
  const spots = c4 ? C4_INSIDE : INSIDE;
  const insideMol = spots.map(([x, y], k) => {
    const a = clamp01(s.co2 * spots.length - k);
    return <Co2 key={k} x={x + 6 * Math.sin(frame / 17 + k)} y={y + 5 * Math.cos(frame / 13 + k * 2)} s={0.7} a={a * 0.9} rot={(k * 53 + frame) % 360} />;
  });

  // ── water vapour going out: pore → outside ──
  const NW = 8, TW = 84;
  const water: React.ReactNode[] = [];
  for (let i = 0; i < NW; i++) {
    const u = frac((frame + (i * TW) / NW + 17) / TW);
    const ex = 500 + ((i * 53) % 8) * 40;
    const x = lerp(P.x + 6, ex, Math.sqrt(u));
    const y = lerp(P.y + 22, LEAF.air[1] - 26, u);
    // hot air: every slot runs; mild / night: only some
    const on = clamp01(s.water * NW - i * 0.95);
    water.push(<Drop key={i} x={x} y={y} a={on * life(u, 0.12)} s={0.9 + 0.2 * ((i * 7) % 3)} />);
  }

  // ── c4: the handoff, outer cell → inner ring (orange 4-carbon acid) ──
  const handoff: React.ReactNode[] = [];
  if (c4 && s.pump > 0.01) {
    outer.forEach((o, j) => {
      const u = frac((frame + j * 9) / 54);
      const tgt = inner.reduce((b, c) => (Math.hypot(c.x - o.x, c.y - o.y) < Math.hypot(b.x - o.x, b.y - o.y) ? c : b), inner[0]);
      const x = lerp(o.x, tgt.x, u), y = lerp(o.y, tgt.y, u);
      handoff.push(<rect key={j} x={x - 11} y={y - 7} width={22} height={14} rx={7} fill={plant.acid4} opacity={s.pump * life(u, 0.15)} />);
    });
  }

  // ── sugar: hexagons popping up where the sugar is made ──
  const sugarAt = c4 ? inner.map((c) => ({ x: c.x, y: c.y })) : cells.map((c) => ({ x: c.x + c.w / 2, y: c.y + c.h * 0.42 }));
  const sugar = sugarAt.map((c, k) => {
    const u = frac((frame + k * 13) / 66);
    const a = s.sugar * life(u, 0.2);
    return <Hex key={k} x={c.x} y={c.y - 26 * u} r={c4 ? 13 : 15} a={a} />;
  });

  // night tint over everything drawn, sky badge
  const night = s.night;
  const sunA = 1 - night;
  const S = LEAF.sky;
  return (
    <svg width={W} height={LEAF.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <linearGradient id={g("air")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={plant.daySky} stopOpacity={0.55 * sunA + 0.25} />
          <stop offset="1" stopColor={plant.daySky} stopOpacity={0.05} />
        </linearGradient>
        <clipPath id={g("slab")}>
          <rect x={0} y={LEAF.cuticle} width={W} height={u1 - LEAF.cuticle} rx={36} />
        </clipPath>
      </defs>

      {/* outside air under the leaf */}
      <rect x={0} y={u1 - 10} width={W} height={LEAF.air[1] - u1 + 10} rx={28} fill={`url(#${g("air")})`} />

      {/* the slab: inside colour, cells, skins (clipped to the cut shape) */}
      <g clipPath={`url(#${g("slab")})`}>
        <rect x={0} y={LEAF.cuticle} width={W} height={u1 - LEAF.cuticle} fill={plant.airSpace} />
        {c4 ? (
          <g>
            {/* filler cells between the rings and the skins */}
            {LEAF.spongy.map(([x, y, rx, ry], k) => (k % 3 === 0 ? <ellipse key={k} cx={x < 450 ? x - 40 : x + 40} cy={y < 600 ? 230 : 700} rx={rx * 0.8} ry={ry * 0.8} fill={plant.spongy} stroke={plant.cellWall} strokeOpacity={0.35} strokeWidth={2} /> : null))}
            {outer.map((c, k) => (
              <circle key={k} cx={c.x} cy={c.y} r={c.r} fill={plant.cell} stroke={plant.cellWall} strokeWidth={3} />
            ))}
            {inner.map((c, k) => (
              <circle key={k} cx={c.x} cy={c.y} r={c.r} fill={plant.leafDeep} stroke={plant.cellWall} strokeWidth={4} />
            ))}
            {/* the inner ring is rich in carbon dioxide while the pump runs: a warm glow */}
            {inner.map((c, k) => (
              <circle key={`gl${k}`} cx={c.x} cy={c.y} r={c.r - 6} fill={plant.acid4} opacity={0.22 * s.pump} />
            ))}
            <circle cx={LEAF.c4.cx} cy={LEAF.c4.cy} r={LEAF.c4.vein} fill={plant.vein} stroke={plant.veinEdge} strokeWidth={4} />
            <circle cx={LEAF.c4.cx} cy={LEAF.c4.cy} r={LEAF.c4.vein * 0.45} fill="none" stroke={plant.veinEdge} strokeWidth={3} />
          </g>
        ) : (
          <g>
            {LEAF.spongy.map(([x, y, rx, ry], k) => (
              <ellipse key={k} cx={x} cy={y} rx={rx} ry={ry} fill={plant.spongy} stroke={plant.cellWall} strokeOpacity={0.5} strokeWidth={2.5} />
            ))}
            <circle cx={LEAF.vein.x} cy={LEAF.vein.y} r={LEAF.vein.r} fill={plant.vein} stroke={plant.veinEdge} strokeWidth={4} />
            <circle cx={LEAF.vein.x} cy={LEAF.vein.y} r={LEAF.vein.r * 0.45} fill="none" stroke={plant.veinEdge} strokeWidth={3} />
            {cells.map((c, k) => (
              <g key={k}>
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={38} fill={plant.cell} stroke={plant.cellWall} strokeWidth={3} />
                {/* chloroplasts */}
                {[0.22, 0.5, 0.78].map((t, j) => (
                  <ellipse key={j} cx={c.x + (j % 2 ? 0.62 : 0.38) * c.w} cy={c.y + t * c.h} rx={12} ry={8} fill={plant.leafHi} opacity={0.8} />
                ))}
                {/* cam: the night store, purple acid filling the cell from the bottom */}
                {p.pathway === "cam" && s.store > 0.005 ? (
                  <rect x={c.x + 12} y={c.y + c.h - 14 - s.store * (c.h - 40)} width={c.w - 24} height={s.store * (c.h - 40)} rx={22} fill={plant.store} opacity={0.82} />
                ) : null}
              </g>
            ))}
          </g>
        )}
        {/* air pocket just inside the pore */}
        <circle cx={LEAF.airPocket.x} cy={c4 ? LEAF.underSkin[0] - 8 : LEAF.airPocket.y} r={c4 ? 22 : LEAF.airPocket.r} fill={plant.airSpace} />
        {insideMol}
        {/* skins */}
        <rect x={0} y={t0} width={W} height={t1 - t0} fill={plant.skin} />
        <rect x={0} y={LEAF.cuticle} width={W} height={t0 - LEAF.cuticle} fill={plant.cuticle} />
        <rect x={0} y={u0} width={W} height={u1 - u0} fill={plant.skin} />
        {Array.from({ length: 9 }, (_, k) => (
          <line key={k} x1={k * 100 + 50} x2={k * 100 + 50} y1={t0} y2={t1} stroke={plant.leafDeep} strokeWidth={2} opacity={0.5} />
        ))}
        {Array.from({ length: 9 }, (_, k) => (k === 4 ? null : <line key={k} x1={k * 100 + 50} x2={k * 100 + 50} y1={u0} y2={u1} stroke={plant.leafDeep} strokeWidth={2} opacity={0.5} />))}
        {/* the pore: a slit through the under skin, two guard cells either side */}
        <rect x={P.x - ph} y={u0 - 2} width={ph * 2} height={u1 - u0 + 4} fill={plant.airSpace} />
        {[-1, 1].map((side) => (
          <g key={side}>
            <ellipse cx={P.x + side * go} cy={P.y} rx={32} ry={22} fill={plant.guard} stroke={plant.guardEdge} strokeWidth={3} />
            <ellipse cx={P.x + side * (go - 12)} cy={P.y} rx={6} ry={12} fill={plant.leafDeep} opacity={0.6} />
          </g>
        ))}
      </g>
      <rect x={0} y={LEAF.cuticle} width={W} height={u1 - LEAF.cuticle} rx={36} fill="none" stroke={plant.cellWall} strokeOpacity={0.45} strokeWidth={3} />

      {/* flows */}
      {handoff}
      {sugar}
      {co2In}
      {water}

      {/* night: the whole picture darkens a little */}
      {night > 0.01 ? <rect x={0} y={LEAF.cuticle} width={W} height={LEAF.air[1] - LEAF.cuticle} rx={36} fill={plant.nightSky} opacity={0.32 * night} /> : null}

      {/* sky badge */}
      {p.sky ? (
        <g>
          <circle cx={S.x} cy={S.y} r={S.r + 16} fill={night > 0.5 ? plant.nightSky : plant.daySky} stroke={color.borderStrong} strokeWidth={2} />
          <g opacity={sunA}>
            <circle cx={S.x} cy={S.y} r={S.r * 0.62} fill={plant.sun} />
            {Array.from({ length: 8 }, (_, k) => {
              const a = (k / 8) * Math.PI * 2 + frame / 90;
              return <line key={k} x1={S.x + Math.cos(a) * S.r * 0.8} y1={S.y + Math.sin(a) * S.r * 0.8} x2={S.x + Math.cos(a) * S.r * 1.05} y2={S.y + Math.sin(a) * S.r * 1.05} stroke={plant.sun} strokeWidth={4} strokeLinecap="round" />;
            })}
          </g>
          <g opacity={night}>
            <circle cx={S.x} cy={S.y} r={S.r * 0.7} fill={plant.moon} />
            <circle cx={S.x + 10} cy={S.y - 7} r={S.r * 0.6} fill={plant.nightSky} />
          </g>
        </g>
      ) : null}

      {pingT < 1 ? <circle cx={P.x} cy={P.y} r={30 + 50 * pingT} fill="none" stroke={color.accent} strokeWidth={4} opacity={1 - pingT} /> : null}
      {ring > 0.01 ? (
        c4 ? (
          <circle cx={LEAF.c4.cx} cy={LEAF.c4.cy} r={LEAF.c4.innerR + LEAF.c4.innerCell + 10} fill="none" stroke={color.accent} strokeWidth={5} opacity={ring} />
        ) : (
          <rect x={LEAF.palisade.x0 - 10} y={LEAF.palisade.y0 - 10} width={W - 2 * LEAF.palisade.x0 + 20} height={LEAF.palisade.y1 - LEAF.palisade.y0 + 20} rx={44} fill="none" stroke={color.accent} strokeWidth={5} opacity={ring} />
        )
      ) : null}
    </svg>
  );
};

export const LeafSection = defineComponent({ ...meta, Render });
