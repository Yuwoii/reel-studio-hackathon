// Plate-first entrance / content-first exit for opaque-plate components (W2 fix round 2, group A).
//
// The shared wrapper fades a card and its content with ONE group opacity, so for 3–5 frames per transition the plate
// is translucent while saturated content (a lime number, red cells) stays strong: field rows read sharply through the
// plate under the focal element ("every focal element sits on an opaque plate" breaks). This splits the two:
//
//   enter  group: shared spring (y 24 → 0, scale 0.97 → 1). Plate opacity reaches 1 at spring progress 0.5 (≈ 3 f);
//          the content runs the same spring 3 f later, so it only ever appears over an opaque plate.
//   exit   (8 f total, = the shared exit length) content fades (1 − x)² + blurs 0 → 8 px over the first 4 f while the
//          plate stays at alpha 1; then the (now empty) plate fades + blurs over the last 4 f.
//
// Components using it declare enterExit "self" (the World then only culls them). Pure functions of the frame.
import type React from "react";
import { clampX, enterProgress, exitOpacity } from "../motion";
import { motion } from "../theme";
import { interpolate } from "remotion";

export const PLATE_FADE = {
  /** Spring progress at which the plate is fully opaque. */
  plateBy: 0.5,
  /** Content spring starts this many frames after the plate's. */
  contentDelayF: 3,
  /** Exit: content fades over the first half, the plate over the second (motion.exitF = 8). */
  contentOutF: 4,
} as const;

export interface PlateFade {
  /** false = nothing to draw this frame (before the entrance / after the exit). */
  visible: boolean;
  /** Transform for the whole instance (entrance spring). */
  group: React.CSSProperties;
  /** Opacity / blur of the plate (surface + border). */
  plate: React.CSSProperties & { opacity: number };
  /** Opacity / blur of everything drawn on the plate. */
  content: React.CSSProperties & { opacity: number };
}

export function plateFade(frame: number, enterF: number | null, exitF: number | null): PlateFade {
  const e = enterProgress(frame, enterF);
  const ec = enterF === null ? 1 : enterProgress(frame, enterF + PLATE_FADE.contentDelayF);
  const half = PLATE_FADE.contentOutF;
  const xc = exitF === null ? 0 : interpolate(frame, [exitF, exitF + half], [0, 1], clampX);
  const xp = exitF === null ? 0 : interpolate(frame, [exitF + half, exitF + motion.exitF], [0, 1], clampX);
  const plateOpacity = Math.min(1, e / PLATE_FADE.plateBy) * exitOpacity(xp);
  const contentOpacity = ec * exitOpacity(xc);
  const plate: PlateFade["plate"] = { opacity: plateOpacity };
  if (xp > 0) plate.filter = `blur(${xp * motion.exitBlurPx}px)`;
  const content: PlateFade["content"] = { opacity: contentOpacity };
  if (xc > 0) content.filter = `blur(${xc * motion.exitBlurPx}px)`;
  const group: React.CSSProperties = e < 1 ? { transform: `translateY(${(1 - e) * motion.enterY}px) scale(${motion.enterScale + (1 - motion.enterScale) * e})`, transformOrigin: "50% 50%" } : {};
  return { visible: plateOpacity > 0.001, group, plate, content };
}
