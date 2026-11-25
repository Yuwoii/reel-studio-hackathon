// Screen-fixed header (amendments §3b) on the solid top band (§1: 0–218 solid bg, 218–320 fade to transparent).
//
// Left: 12 px dot + "ROOT CAUSE · " (textDim) + codename (accent), text from x = 86, centred at y ≈ 184.
// Right: textDim label right-aligned at x = 960 in EVENT / SPEC / CLOCK form (never the publish date); every change
// scrambles over 8 f (discrete per frame; letters roll through letters only, digits never roll: headerScramble).
// The dot is story-reactive (dim → danger in failure, accent ≤ 1 s on the
// resolution) and pulses 0.6↔1 with a 1.2 s period. A header `pulse` action kicks the dot and codename once.
import React from "react";
import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from "remotion";
import { clampX, flash, latest, scramble } from "../motion";
import { color, font, FPS, header as hdr, layout, motion, type } from "../theme";
import type { HeaderDotT, HeaderTrack } from "../world";

const DOT: Record<HeaderDotT, string> = { dim: color.textDim, danger: color.danger, accent: color.accent };
const TEXT_H = 28; // 22 px mono, line box centred on headerCenterY

/** Band opacity stops over solidTo → fadeTo: 1 − smoothstep, so the fade starts with zero slope at 218 px (a linear
 *  ramp starts with a visible kink that read as a razor-edge mask line on pans). Tokens only: color-mix of bg. */
const BAND_STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => {
  const a = 1 - t * t * (3 - 2 * t);
  const y = layout.headerBand.solidTo + t * (layout.headerBand.fadeTo - layout.headerBand.solidTo);
  return `color-mix(in srgb, ${color.bg} ${(a * 100).toFixed(1)}%, transparent) ${y.toFixed(1)}px`;
});

/** The solid header band + eased fade. Rendered ABOVE the World (it covers world content scrolling under the header). */
export const HeaderBand: React.FC = () => (
  <div
    style={{
      position: "absolute", left: 0, top: 0, width: "100%", height: layout.headerBand.fadeTo,
      background: `linear-gradient(${color.bg} 0px, ${BAND_STOPS.join(", ")})`,
    }}
  />
);

/**
 * Right-label decode (W2.1): motion.ts `scramble`, right-aligned (so " · STEP n/4" lines up), unchanged glyphs hold
 * (an in-place re-scramble, from === to, rolls every letter), letters roll within their case class, and digits never
 * roll (`holdDigits`: the "STEP n/4" numerator steps old → new once, never a random "STEP 7/4", r3 f1697).
 */
export function headerScramble(from: string, to: string, frame: number, start: number, durF: number, seed: string): string {
  return scramble(from, to, frame, start, durF, seed, { align: "right", keepSame: true, holdDigits: true });
}

export const HeaderBar: React.FC<{ series: string; codename: string; track: HeaderTrack }> = ({ series, codename, track }) => {
  const frame = useCurrentFrame();
  const f = Math.floor(frame);
  // right label: scramble from the previous label into the current one
  const cur = latest(track.right, f)!;
  const idx = track.right.indexOf(cur);
  const prev = idx > 0 ? track.right[idx - 1].text : cur.text;
  let right = idx > 0 ? headerScramble(prev, cur.text, f, cur.f, motion.scrambleF[1], `hdr:${idx}`) : cur.text;
  // a header `scramble` action re-scrambles the current label in place
  const rs = latest(track.scrambles.map((x) => ({ f: x })), f);
  if (rs && rs.f > cur.f && f < rs.f + motion.scrambleF[1]) right = headerScramble(cur.text, cur.text, f, rs.f, motion.scrambleF[1], `hdr:s${rs.f}`);
  // dot: colour crossfades over 4 f; opacity pulse 0.6↔1, period 1.2 s
  const d = latest(track.dot, f)!;
  const di = track.dot.indexOf(d);
  const dPrev = di > 0 ? track.dot[di - 1].dot : d.dot;
  const dotColor = dPrev === d.dot ? DOT[d.dot] : interpolateColors(interpolate(f, [d.f, d.f + 4], [0, 1], clampX), [0, 1], [DOT[dPrev], DOT[d.dot]]);
  const [lo, hi] = hdr.pulse;
  const pulse = lo + (hi - lo) * (0.5 + 0.5 * Math.cos((frame / (hdr.pulsePeriodS * FPS)) * 2 * Math.PI));
  const kickAt = latest(track.pulses.map((x) => ({ f: x })), f)?.f;
  const kick = flash(frame, kickAt, 5);
  const top = layout.headerCenterY - TEXT_H / 2;
  const text: React.CSSProperties = {
    position: "absolute", top, height: TEXT_H, lineHeight: `${TEXT_H}px`, fontFamily: font.mono, fontWeight: type.header.weight, fontSize: type.header.size,
    letterSpacing: type.header.tracking, textTransform: "uppercase", whiteSpace: "pre", color: color.textDim,
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <HeaderBand />
      <div
        style={{
          position: "absolute", left: layout.margin, top: layout.headerCenterY - hdr.dotPx / 2, width: hdr.dotPx, height: hdr.dotPx, borderRadius: hdr.dotPx / 2,
          background: dotColor, opacity: Math.min(1, pulse + kick), transform: kick > 0 ? `scale(${1 + 0.6 * kick})` : undefined,
        }}
      />
      <div style={{ ...text, left: layout.headerLeftTextX }}>
        {series} · <span style={{ color: color.accent, textShadow: kick > 0 ? `0 0 ${Math.round(16 * kick)}px ${color.markAccent}` : undefined }}>{codename}</span>
      </div>
      <div style={{ ...text, right: 1080 - layout.rightSafeX, textAlign: "right" }}>{right}</div>
    </AbsoluteFill>
  );
};
