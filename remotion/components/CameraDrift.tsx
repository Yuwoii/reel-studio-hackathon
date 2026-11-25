// Slow camera drift + subtle push-in. Provides the camera offset via context so Background can parallax its
// layers (far layers move less than near ones).

import React, { createContext, useContext } from "react";
import { useCurrentFrame } from "remotion";
import type { Scene } from "../../src/schema/index.js";
import { CAM_ORIGIN_X, CAM_ORIGIN_Y } from "../safeZone";

export interface Camera {
  x: number;
  y: number;
  scale: number;
  /** Worst case over the whole beat (largest scale, full drift amplitude) — for keeping things in frame. */
  maxScale: number;
  amp: number;
}

const CameraContext = createContext<Camera>({ x: 0, y: 0, scale: 1, maxScale: 1, amp: 0 });
export const useCameraOffset = () => useContext(CameraContext);

function driftParams(drift: Scene["camera"]["drift"]): { amp: number; push: number } {
  switch (drift) {
    case "none":
      return { amp: 0, push: 0 };
    case "slow":
      return { amp: 14, push: 0.03 };
    case "medium":
      return { amp: 30, push: 0.06 };
    default: {
      const _x: never = drift;
      return { amp: 0, push: 0 };
    }
  }
}

export function computeCamera(frame: number, durationInFrames: number, drift: Scene["camera"]["drift"], zoom: number, seed: number): Camera {
  const { amp, push } = driftParams(drift);
  const t = Math.min(1, frame / Math.max(1, durationInFrames));
  const ph = seed * 1.7;
  const x = amp * Math.sin(frame / 55 + ph);
  const y = amp * 0.5 * Math.cos(frame / 70 + ph);
  // overscale so the drifting frame never reveals an edge
  const cover = 1 + (2 * amp + 8) / 1080;
  const base = Math.max(1, zoom) * cover;
  return { x, y, scale: base * (1 + push * t), maxScale: base * (1 + push), amp };
}

export const CameraDrift: React.FC<{ drift: Scene["camera"]["drift"]; zoom: number; durationInFrames: number; seed: number; children: React.ReactNode }> = ({
  drift,
  zoom,
  durationInFrames,
  seed,
  children,
}) => {
  const frame = useCurrentFrame();
  const cam = computeCamera(frame, durationInFrames, drift, zoom, seed);
  return (
    <CameraContext.Provider value={cam}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${CAM_ORIGIN_X}px ${CAM_ORIGIN_Y}px`,
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
        }}
      >
        {children}
      </div>
    </CameraContext.Provider>
  );
};

/** Parallax layer: depth 0 = infinitely far (stays put on screen), 1 = moves with the camera. */
export const Parallax: React.FC<{ depth: number; children: React.ReactNode }> = ({ depth, children }) => {
  const cam = useCameraOffset();
  const k = 1 - depth;
  return <g transform={`translate(${(-cam.x * k).toFixed(2)} ${(-cam.y * k).toFixed(2)})`}>{children}</g>;
};
