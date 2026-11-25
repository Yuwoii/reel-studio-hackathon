// Area-bounded glitch for packet-C components (Figure, NodeGraph). Pure function of the frame; colours from tokens only.
//
// Amendments §7 / R7 N-2: 4 f, FIXED red/white tinted copies (tokens danger / text, via feColorMatrix) offset ±8 / 6 /
// 4 px (the shared glitchAt() offsets) BEHIND the untouched content, plus 1–2 slice bands: a horizontal strip of the
// content copied and displaced by a seeded ±(10–20) px, clipped to `area` (NodeGraph passes the 120 px node square, so
// the slice never leaves the node box). The base copy keeps its colours and position, so labels stay readable; only
// the tinted silhouettes peek out on either side (an RGB-split look, not a smear).
import React from "react";
import { random } from "remotion";
import { glitchAt } from "../motion";
import { color, type ColorToken } from "../theme";

export const GLITCH_TINT_TOKENS = ["danger", "text"] as const satisfies readonly ColorToken[];

export interface GlitchSliceBand {
  /** band rect (component px), always inside the glitch area */
  y: number;
  h: number;
  /** horizontal displacement of the band's content */
  dx: number;
}

export interface TokenGlitchFrame {
  i: number;
  copies: { dx: number; tint: (typeof GLITCH_TINT_TOKENS)[number]; opacity: number }[];
  bands: GlitchSliceBand[];
  area: { x: number; y: number; w: number; h: number };
  opacity: number;
}

/** "#RRGGBB" token → feColorMatrix r g b (0..1). Tint tokens are opaque hex tokens. */
function rgb01(token: ColorToken): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color[token]);
  if (!m) throw new Error(`glitch tint token ${token} must be an opaque hex token`);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** Glitch geometry at `frame` (null outside the 4-frame window). Bands stay inside `area` (default the whole box). */
export function tokenGlitchAt(frame: number, at: number | undefined, seed: string, w: number, h: number, area?: { x: number; y: number; w: number; h: number }): TokenGlitchFrame | null {
  const g = glitchAt(frame, at, seed);
  if (!g) return null;
  const A = area ?? { x: 0, y: 0, w, h };
  const bands: GlitchSliceBand[] = [];
  for (let k = 0; k < 2; k++) {
    const r = (tag: string) => random(`${seed}:tg${g.i}:${k}:${tag}`);
    if (k > 0 && r("on") < 0.5) continue;
    const bh = Math.round(A.h * [0.12, 0.18, 0.24][Math.floor(r("h") * 3)]);
    const y = A.y + Math.round(r("y") * Math.max(0, A.h - bh));
    const mag = 10 + Math.round(r("m") * 10);
    bands.push({ y, h: bh, dx: r("s") < 0.5 ? -mag : mag });
  }
  return { i: g.i, copies: g.copies.map((c) => ({ dx: c.dx, tint: c.tint, opacity: c.opacity })), bands, area: A, opacity: g.opacity };
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Tint tokens a caller may use for the channel split (opaque hex tokens). */
export type GlitchTint = "danger" | "text" | "accent";

/**
 * `tints` (W2.1, Figure): replace the shared danger / text pair (e.g. danger / accent, so a light card gets no white
 * fringe). `clip`: clip copies and bands to the w × h box (a card's glitch never pokes past its border).
 */
export const TokenGlitch: React.FC<{ frame: number; at: number | undefined; seed: string; w: number; h: number; area?: { x: number; y: number; w: number; h: number }; tints?: readonly [GlitchTint, GlitchTint]; clip?: boolean; children: React.ReactNode }> = ({ frame, at, seed, w, h, area, tints, clip, children }) => {
  const g0 = tokenGlitchAt(frame, at, seed, w, h, area);
  if (!g0) return <>{children}</>;
  const g = tints ? { ...g0, copies: g0.copies.map((c, k) => ({ ...c, tint: tints[k % 2] })) } : g0;
  const id = `tglx-${sanitize(seed)}`;
  const A = g.area;
  const used: readonly GlitchTint[] = tints ?? GLITCH_TINT_TOKENS;
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: clip ? "hidden" : undefined }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        {used.map((t) => {
          const [r, gg, b] = rgb01(t);
          return (
            <filter key={t} id={`${id}-${t}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={`0 0 0 0 ${r}  0 0 0 0 ${gg}  0 0 0 0 ${b}  0 0 0 1 0`} />
            </filter>
          );
        })}
      </svg>
      {g.copies.map((c, k) => (
        <div key={`c${k}`} data-glitch-tint={c.tint} style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `translateX(${c.dx}px)`, opacity: c.opacity, filter: `url(#${id}-${c.tint})` }}>
          {children}
        </div>
      ))}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, opacity: g.opacity < 1 ? g.opacity : undefined }}>{children}</div>
      {g.bands.map((s, k) => (
        <div key={`s${k}`} data-glitch-slice={k} style={{ position: "absolute", left: A.x, top: s.y, width: A.w, height: s.h, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: -A.x, top: -s.y, width: w, height: h, transform: `translateX(${s.dx}px)` }}>{children}</div>
        </div>
      ))}
    </div>
  );
};
