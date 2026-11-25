// v2 camera (amendments §4). The maths lives in src/v2/timeline.ts so that "lint frame N = rendered frame N": the
// linter, the blur-window builder and this renderer all evaluate the SAME cameraAt(). This module only adds the
// screen transform. Ease set (timeline EASE_BEZIER): bible bezier(0.65,0,0.35,1) 12–20 f, longPan
// bezier(0.45,0,0.55,1) ≥22 f, pushOut ease-out, enter (components only), linear (tracks only). Zoom interpolates in
// log space, every hold drifts +2 % zoom (camera.holdDriftZoom), and a `shake` key adds the Stamp shake (±6 px, 3 f).
//
// Extensionless import on purpose: Remotion's webpack cannot resolve NodeNext ".js" specifiers.
import { cameraAt as timelineCameraAt, CAM_ANCHOR, EASE_BEZIER, type CamState, type Timeline } from "../../src/v2/timeline";
import { camera as cam, layout } from "./theme";

export { EASE_BEZIER, type CamState };

type CamTimeline = Pick<Timeline, "camera0" | "cameraSegments" | "durationF">;

/** Camera state at a (possibly fractional, inside motion blur) frame. */
export function cameraAt(tl: CamTimeline, frame: number): CamState & { moving: boolean } {
  return timelineCameraAt(tl, frame);
}

/** The anchor the camera target lands on must be the theme's stage centre; fail loudly if the two ever drift. */
if (CAM_ANCHOR.x !== layout.stage.cx || CAM_ANCHOR.y !== layout.stage.cy) {
  throw new Error(`camera anchor mismatch: timeline ${CAM_ANCHOR.x},${CAM_ANCHOR.y} vs theme ${layout.stage.cx},${layout.stage.cy}`);
}

/** CSS transform (transform-origin 0 0) that puts world point (x, y) at the stage centre at zoom z. */
export function cameraTransform(c: CamState): string {
  return `translate(${layout.stage.cx}px, ${layout.stage.cy}px) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
}

/** Optional 3D tilt (0–25°) around the stage centre; empty when flat. No will-change / translateZ (amendments §4). */
export function tiltTransform(c: CamState): string | undefined {
  const t = Math.max(0, Math.min(cam.maxTiltX, c.tiltX));
  return t > 0.01 ? `perspective(1600px) rotateX(${t}deg)` : undefined;
}

/** Visible world rectangle for state c (screen y from `top` to `bottom`), plus a margin in screen px. */
export function visibleWorldRect(c: CamState, top: number = 0, bottom: number = layout.footer.top, margin: number = 40): { x0: number; x1: number; y0: number; y1: number } {
  const tiltPad = c.tiltX > 0.01 ? 1 + c.tiltX / 50 : 1; // a tilted plane shows more of the far edge
  const z = c.zoom;
  return {
    x0: c.x - ((layout.stage.cx + margin) * tiltPad) / z,
    x1: c.x + ((1080 - layout.stage.cx + margin) * tiltPad) / z,
    y0: c.y - ((layout.stage.cy - top + margin) * tiltPad) / z,
    y1: c.y + ((bottom - layout.stage.cy + margin) * tiltPad) / z,
  };
}
