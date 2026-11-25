// v3lab plate camera: a pure function of the frame. Keyframes in WORLD px of the shot's content box (a plate or a
// device component laid out at world (0,0)); the camera puts world point (cx, cy) at the stage anchor
// (layout.stage.cx, layout.stage.cy) with uniform scale `zoom`.
import { Easing } from "remotion";
import { camera, layout } from "../v2/theme";

export type Ease = "bible" | "longPan" | "linear";
export interface CamKey {
  f: number;
  zoom: number;
  cx: number;
  cy: number;
  /** Easing of the move that ENDS at this key (ignored on the first key). */
  ease?: Ease;
}
export interface Cam {
  zoom: number;
  cx: number;
  cy: number;
}

const EASE = {
  bible: Easing.bezier(...camera.ease.bible),
  longPan: Easing.bezier(...camera.ease.longPan),
  linear: (t: number) => t,
} as const;

export function camAt(keys: readonly CamKey[], frame: number): Cam {
  if (frame <= keys[0].f) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (frame <= b.f) {
      const t = EASE[b.ease ?? "bible"]((frame - a.f) / Math.max(1, b.f - a.f));
      return { zoom: a.zoom + (b.zoom - a.zoom) * t, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
    }
  }
  return keys[keys.length - 1];
}

/** Hold helper: a key `durF` after k with +holdDriftZoom (2 %) zoom, linear. */
export function hold(k: CamKey, toF: number): CamKey {
  return { f: toF, zoom: k.zoom * (1 + camera.holdDriftZoom), cx: k.cx, cy: k.cy, ease: "linear" };
}

/** World px → screen px. */
export function toScreen(c: Cam, x: number, y: number): { x: number; y: number } {
  return { x: (x - c.cx) * c.zoom + layout.stage.cx, y: (y - c.cy) * c.zoom + layout.stage.cy };
}

/** CSS transform for a world-space layer whose box starts at world (0,0) (transform-origin 0 0). */
export function worldTransform(c: Cam): string {
  return `translate(${layout.stage.cx - c.cx * c.zoom}px, ${layout.stage.cy - c.cy * c.zoom}px) scale(${c.zoom})`;
}

/** Clamp a camera so a plate of size pw×ph (world px) still covers the stage at that zoom (no empty edges). */
export function clampToPlate(c: Cam, pw: number, ph: number): Cam {
  const hw = layout.stage.cx / c.zoom;
  const hTop = (layout.stage.cy - layout.stage.top) / c.zoom;
  const hBot = (layout.stage.bottom - layout.stage.cy) / c.zoom;
  const cx = Math.min(Math.max(c.cx, hw), pw - hw);
  const cy = Math.min(Math.max(c.cy, hTop), ph - hBot);
  return { zoom: c.zoom, cx, cy };
}
