// Transitions (every TRANSITIONS entry). The OUT half plays over the last 0.3 s of a beat and ends fully
// covered/peaked; the IN half (driven by the previous beat's transitionOut) reveals the next beat over 0.25 s,
// so the cut between <Sequence>s is hidden. "cut" = nothing.

import React from "react";
import { Easing, interpolate } from "remotion";
import type { Scene } from "../../src/schema/index.js";
import { useTheme } from "../styles";

type Kind = Scene["transitionOut"];

export const OUT_FRAMES = 9; // 0.3 s @ 30 fps
export const IN_FRAMES = 8;

export interface TransitionLook {
  /** CSS transform for the scene layer (text stays put). */
  scene?: string;
  overlay?: React.ReactNode;
}

/**
 * p: 0..1 progress of this half. phase "out": 0 = untouched → 1 = fully covered/peaked.
 * phase "in": 0 = fully covered (continues the previous beat's out) → 1 = clear.
 */
export function useTransitionLook(kind: Kind, phase: "out" | "in", p: number): TransitionLook {
  const { palette } = useTheme();
  const cover = phase === "out" ? Easing.in(Easing.cubic)(p) : 1 - Easing.out(Easing.cubic)(p);
  if (cover <= 0.001) return {}; // idle: draw nothing (an off-screen panel's border would peek in at the edge)
  switch (kind) {
    case "cut":
      return {};
    case "flash":
      return { overlay: <div style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: cover }} /> };
    case "zoom-punch": {
      const scale = phase === "out" ? 1 + 0.35 * cover : 1 + 0.18 * cover;
      return { scene: `scale(${scale})`, overlay: <div style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: 0.55 * cover }} /> };
    }
    case "slide": {
      // panel slides in from the right on the way out, keeps travelling left on the way in
      const x = phase === "out" ? 1080 * (1 - cover) : -1080 * (1 - cover);
      const shift = phase === "out" ? -160 * cover : 160 * cover;
      return {
        scene: `translateX(${shift}px)`,
        overlay: (
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 1080, transform: `translateX(${x}px)`, background: palette.primary, borderLeft: `18px solid ${palette.ink}`, borderRight: `18px solid ${palette.ink}`, boxSizing: "content-box", marginLeft: -18 }} />
        ),
      };
    }
    case "wipe": {
      // diagonal edge sweeping left → right: covers on the way out, the trailing edge keeps going to reveal
      const e = -400 + 1480 * (phase === "out" ? cover : 1 - cover); // edge x at the bottom; top is e + 300
      const pts = phase === "out" ? `-200,0 ${e + 300},0 ${e},1920 -200,1920` : `${e + 300},0 1300,0 1300,1920 ${e},1920`;
      return {
        overlay: (
          <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
            <polygon points={pts} fill={palette.accent} stroke={palette.ink} strokeWidth={22} />
          </svg>
        ),
      };
    }
    default: {
      const _x: never = kind;
      return {};
    }
  }
}

export function outProgress(frame: number, durationInFrames: number): number {
  return interpolate(frame, [durationInFrames - OUT_FRAMES, durationInFrames - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}
export function inProgress(frame: number): number {
  return interpolate(frame, [0, IN_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}
