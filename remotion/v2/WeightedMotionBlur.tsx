// Tent-weighted camera motion blur (ADR-001 §2.7, PROOF §R8b). Same sub-sample times and composite as
// @remotion/motion-blur 4.0.534 CameraMotionBlur — Freeze at f + 1 − shutter·(k+1)/N for k = 0..N−1, stacked with
// mix-blend-mode plus-lighter inside an isolated group — but sample k gets weight ∝ min(k+1, N−k) instead of 1/N.
//
// Why: a box shutter turns each stroke into a plateau with two hard ends one smear-length apart; when that length is
// close to a glyph advance the ends read as a second copy of the text ("137" → "1557"). The tent has no hard ends, so
// the smear fades out instead of doubling (measured on Lambda, research/r8/ghost).
//
// Velocity-adaptive use (amendments §4, W2): the composition asks samplesAt(timeline, frame) — 0 outside move/flight
// windows and below 6 px/f (render the world once, no wrapper), else clamp(ceil(v·shutter/360 / 1 px), 8, 32), where
// v is the fastest visible stage point incl. zoom and element motion (src/v2/timeline.ts cameraDisplacementPx).
// Children must step discrete values on Math.floor(frame) so every sub-sample agrees.
//
// 1/255 renormalisation (W2): Chrome stores each layer's opacity as an 8-bit alpha, so float weights that sum to 1
// round to bytes that sum to 248–254 and a tent frame came out 0.2–0.8 grey levels darker than an unblurred one.
// tentWeights() therefore returns k/255 values whose bytes sum to exactly 255 (largest-remainder rounding, every
// sample ≥ 1/255, still symmetric).
import React from "react";
import { AbsoluteFill, Freeze, useCurrentFrame } from "remotion";
import { blur } from "./theme";

/**
 * Index of the motion-blur sub-sample being rendered (null outside a blur window). SVG `url(#id)` resolves to the
 * FIRST element with that id in the document, so a def whose content depends on the fractional frame (a DrawPath
 * mask's draw-on progress) must suffix its id with this, or every sub-sample would reuse sample 0's def.
 */
export const BlurSampleContext = React.createContext<number | null>(null);

/** id suffix for frame-dependent SVG defs ("" outside a blur window). */
export function useBlurSampleSuffix(): string {
  const k = React.useContext(BlurSampleContext);
  return k === null ? "" : `-s${k}`;
}

/** Tent weights as integer alpha bytes summing to exactly 255 (symmetric, each ≥ 1). Exported for tests. */
export function tentBytes(n: number): number[] {
  const k = Math.max(1, Math.min(255, Math.round(n)));
  const raw = Array.from({ length: k }, (_, i) => Math.min(i + 1, k - i));
  const sum = raw.reduce((a, b) => a + b, 0);
  const exact = raw.map((w) => (w * 255) / sum);
  const bytes = exact.map((x) => Math.max(1, Math.floor(x)));
  // Hand out the remaining bytes symmetrically, largest remainder first (pairs i / k−1−i get the same treatment;
  // the middle sample of an odd count takes a single byte).
  let left = 255 - bytes.reduce((a, b) => a + b, 0);
  // the ≥ 1 floor can overshoot for long tents: take bytes back from the centre outwards
  for (let i = Math.floor((k - 1) / 2); left < 0 && i >= 0; i--) {
    const j = k - 1 - i;
    const give = i === j ? 1 : 2;
    if (bytes[i] > 1) {
      bytes[i]--;
      if (i !== j) bytes[j]--;
      left += give;
    }
  }
  const order = Array.from({ length: Math.ceil(k / 2) }, (_, i) => i).sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])) || b - a);
  for (let pass = 0; left > 0 && pass < 255; pass++) {
    for (const i of order) {
      const j = k - 1 - i;
      const need = i === j ? 1 : 2;
      if (left >= need) {
        bytes[i]++;
        if (i !== j) bytes[j]++;
        left -= need;
      }
      if (left === 0) break;
    }
    if (left === 1 && k % 2 === 0) {
      // even count, one byte left: give it to one of the two centre samples (asymmetry ≤ 1/255)
      bytes[k / 2]++;
      left = 0;
    }
  }
  return bytes;
}

/** Tent weights for n samples as k/255 values summing to exactly 1 in 8-bit alpha. Exported for tests. */
export function tentWeights(n: number): number[] {
  return tentBytes(n).map((b) => b / 255);
}

/**
 * W0 (v3 ADR-002 §10, R6): sub-samples per OUTPUT frame when one output frame spans `span` author frames (1 at 30 fps,
 * 0.5 at 60 fps): the screen speed per output frame scales with span, so n = max(8, ceil(n30 · span)) whenever the
 * author frame blurs; span 1 returns n30 unchanged. Mirrors src/v2/lints.ts outputBlurSamples (L18; parity test).
 */
export function samplesForSpan(n30: number, span: number): number {
  return span === 1 || n30 <= 1 ? n30 : Math.max(blur.minSamples, Math.ceil(n30 * span));
}

/** Sub-sample frame offsets (relative to the current frame) for n samples at a shutter angle. */
export function sampleOffsets(n: number, shutterAngle: number = blur.shutterAngle): number[] {
  const k = Math.max(1, Math.round(n));
  const sf = shutterAngle / 360;
  return Array.from({ length: k }, (_, i) => 1 - sf * ((i + 1) / k));
}

/** `span` (W0): author frames covered by one OUTPUT frame — 1 at 30 fps (the v2 behaviour), 0.5 at 60 fps, so the
 *  180° shutter covers half an author frame. Sub-sample k freezes at f + span·(1 − shutter·(k+1)/N). */
export const WeightedMotionBlur: React.FC<{ children: React.ReactNode; samples: number; shutterAngle?: number; span?: number }> = ({ children, samples, shutterAngle = blur.shutterAngle, span = 1 }) => {
  const frame = useCurrentFrame();
  if (samples <= 1) return <>{children}</>;
  const weights = tentWeights(samples);
  const offsets = sampleOffsets(samples, shutterAngle);
  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {weights.map((w, k) => (
        <AbsoluteFill key={k} style={{ mixBlendMode: "plus-lighter", filter: `opacity(${w})` }}>
          <BlurSampleContext.Provider value={k}>
            <Freeze frame={span === 1 ? frame + offsets[k] : frame + span * offsets[k]}>{children}</Freeze>
          </BlurSampleContext.Provider>
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};
