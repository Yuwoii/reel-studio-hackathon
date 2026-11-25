// React primitives shared by library components (W2 contract). Pure functions of the frame passed in; colours only
// from theme tokens. The maths lives in ../motion.ts; these only draw it.
import React from "react";
import { evolve, glitchAt } from "../motion";
import { color, font, type ColorToken } from "../theme";
import { useBlurSampleSuffix } from "../WeightedMotionBlur";

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** "#RRGGBB" token → feColorMatrix "r g b" in 0..1 (tokens only; rgba tokens are not used as glitch tints). */
function tokenRgb01(token: ColorToken): [number, number, number] {
  const hex = color[token];
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`glitch tint token ${token} must be an opaque hex token`);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** Tint tokens a glitch may use for its channel copies (opaque hex tokens only). */
export type GlitchTint = "danger" | "text" | "accent";

/** Clip rectangle for a glitch (box-local px; defaults = the whole w × h box) with a corner radius. */
export interface GlitchClip {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  /** Uniform extra inset on every side (e.g. the plate's border width), applied after x / y / w / h. */
  inset?: number;
}

/** CSS clip-path for a GlitchClip inside a w × h box. Exported for tests. */
export function glitchClipPath(clip: GlitchClip, w: number, h: number): string {
  const i = clip.inset ?? 0;
  const x = (clip.x ?? 0) + i;
  const y = (clip.y ?? 0) + i;
  const cw = (clip.w ?? w - (clip.x ?? 0)) - 2 * i;
  const ch = (clip.h ?? h - (clip.y ?? 0)) - 2 * i;
  const r = Math.max(0, (clip.r ?? 0) - i);
  return `inset(${y}px ${w - x - cw}px ${h - y - ch}px ${x}px${r > 0 ? ` round ${r}px` : ""})`;
}

/**
 * Plate-mode glitch look (W2.1 r2, review: tinted PLATE copies made hard pale / red slabs past the rounded edge and
 * stacked the whole card to a muddy pink-brown). In plate mode only the CONTENT is glitched: the plate is drawn once,
 * untouched, and the channel copies are danger / accent silhouettes of the content at low alpha (never a light copy).
 */
export const PLATE_GLITCH = { tints: ["danger", "accent"] as const, copyOpacity: 0.35 } as const;

/**
 * 4-frame glitch around `children` (amendments §7): two silhouettes tinted with FIXED tokens offset ±8 px, six
 * horizontal slices of the original displaced by seeded ±24 px (about half of them), and an opacity flicker. Outside
 * its window it renders `plate` + `children` untouched. `at` = glitch start frame (see activeGlitch()).
 *
 * Two modes:
 * - legacy (no `plate`): `children` is the whole card; copies are danger / text tinted at 0.6. `clip` confines them.
 * - plate mode (`plate` given, W2.1 r2): `plate` renders once, unchanged, under the content; only `children` (the
 *   content layer, transparent background) is copied / sliced, inside `clip` (the plate's rounded inner rect), with
 *   PLATE_GLITCH tints. The plate surface never changes colour during the fx and nothing leaves its rounded edge.
 * `w` / `h` omitted (fluid, plate mode only): the box is sized by `children` in flow (a hidden sizer copy holds the
 * size during the window); the clip is `clip.inset` on every side with `clip.r`, so callers need not know their width.
 */
export const Glitch: React.FC<{
  frame: number; at: number | undefined; seed: string; w?: number; h?: number; clip?: GlitchClip; plate?: React.ReactNode;
  tints?: readonly [GlitchTint, GlitchTint]; copyOpacity?: number; children: React.ReactNode;
}> = ({ frame, at, seed, w, h, clip, plate, tints, copyOpacity, children }) => {
  const g = glitchAt(frame, at, seed);
  const plateMode = plate !== undefined;
  const fluid = w === undefined || h === undefined;
  if (!g) {
    return plateMode ? (
      <>
        {plate}
        {children}
      </>
    ) : (
      <>{children}</>
    );
  }
  const id = `glx-${sanitize(seed)}`;
  const size: React.CSSProperties = fluid ? { right: 0, bottom: 0 } : { width: w, height: h };
  const layer = (style: React.CSSProperties, key: string) => (
    <div key={key} style={{ position: "absolute", left: 0, top: 0, ...size, ...style }}>
      {children}
    </div>
  );
  const used: readonly [GlitchTint, GlitchTint] = tints ?? (plateMode ? PLATE_GLITCH.tints : ["danger", "text"]);
  const alpha = copyOpacity ?? (plateMode ? PLATE_GLITCH.copyOpacity : undefined);
  const sliceH = 100 / 6;
  let clipPath: string | undefined;
  if (clip && !fluid) clipPath = glitchClipPath(clip, w as number, h as number);
  else if (clip) {
    const i = clip.inset ?? 0;
    const r = Math.max(0, (clip.r ?? 0) - i);
    clipPath = `inset(${i}px${r > 0 ? ` round ${r}px` : ""})`;
  }
  const fx = (
    <div style={{ position: plateMode && !fluid ? "absolute" : "relative", left: 0, top: 0, ...(fluid ? {} : { width: w, height: h }), clipPath }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        {used.map((t) => {
          const [r, gg, b] = tokenRgb01(t);
          return (
            <filter key={t} id={`${id}-${t}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={`0 0 0 0 ${r}  0 0 0 0 ${gg}  0 0 0 0 ${b}  0 0 0 1 0`} />
            </filter>
          );
        })}
      </svg>
      {fluid ? (
        <div aria-hidden style={{ visibility: "hidden" }}>
          {children}
        </div>
      ) : null}
      {g.copies.map((c, k) => layer({ transform: `translateX(${c.dx}px)`, opacity: alpha ?? c.opacity, filter: `url(#${id}-${used[k % 2]})` }, `c${k}`))}
      {Array.from({ length: 6 }, (_, k) => {
        const top = k * sliceH;
        const s = g.slices.find((x) => Math.abs(x.top - top) < 0.01);
        return layer({ clipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - sliceH)}% 0)`, transform: s ? `translateX(${s.dx}px)` : undefined, opacity: g.opacity }, `s${k}`);
      })}
    </div>
  );
  if (plateMode) {
    return fluid ? (
      <>
        {plate}
        {fx}
      </>
    ) : (
      <div style={{ position: "relative", width: w, height: h }}>
        {plate}
        {fx}
      </div>
    );
  }
  return fx;
};

/**
 * Draw-on stroke for use inside an <svg> (R2 §7 recipe): evolvePath drives a mask, so the visible path can keep its
 * own dash pattern. `progress` from drawOn(). The mask id carries the motion-blur sub-sample index: each sub-sample
 * has its own progress, and `url(#id)` would otherwise resolve every copy to sample 0's mask.
 */
export const DrawPath: React.FC<{ d: string; progress: number; id: string; stroke: ColorToken; strokeWidth: number; dash?: string; maskWidth?: number }> = ({ d, progress, id, stroke, strokeWidth, dash, maskWidth }) => {
  const sample = useBlurSampleSuffix();
  if (progress <= 0) return null;
  const mid = `draw-${sanitize(id)}${sample}`;
  if (!dash) {
    const ev = evolve(progress, d);
    return <path d={d} fill="none" stroke={color[stroke]} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
  }
  const ev = evolve(progress, d);
  return (
    <>
      <mask id={mid} maskUnits="userSpaceOnUse">
        <path d={d} fill="none" stroke={color.text /* mask luminance = 1 */} strokeWidth={maskWidth ?? strokeWidth * 4} strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
      </mask>
      <path d={d} fill="none" stroke={color[stroke]} strokeWidth={strokeWidth} strokeDasharray={dash} mask={`url(#${mid})`} />
    </>
  );
};

/** Terminal caret block (bible §6.8), sized to a mono line of `px`. */
export const Caret: React.FC<{ on: boolean; px: number; token?: ColorToken }> = ({ on, px, token = "text" }) => (
  <span style={{ display: "inline-block", width: Math.round(px * 0.6), height: Math.round(px * 1.1), verticalAlign: Math.round(-px * 0.18), marginLeft: 2, background: color[token], opacity: on ? 1 : 0 }} />
);

/** Mono text style helper (tabular digits always: count-ups and scrambles never jitter in width). */
export const monoText = (px: number, weight = 500, token: ColorToken = "text"): React.CSSProperties => ({
  fontFamily: font.mono, fontWeight: weight, fontSize: px, color: color[token], fontVariantNumeric: "tabular-nums", whiteSpace: "pre",
});
