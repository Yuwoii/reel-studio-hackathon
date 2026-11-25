// v3 projections (ADR-002 §4.3, §4.5): ONE set of pure functions shared by the lowering, the lints, the digest and the
// Remotion OverlayLayer, so "lint frame N = rendered frame N" holds for anchors and screen overlays too.
//
//   world ↔ screen   the v2 camera puts its target at the stage anchor (540, 855) at `zoom` (transform-origin top-left;
//                    src/v2/timeline.ts toScreen / remotion/v2/camera.ts cameraTransform). Tilt is ignored here (v3 real
//                    objects never tilt; lint L9v3 refuses tiltX > 0 on boards with real objects or anchor targets).
//   3D               a model3d anchor (xyz metres) → footprint px for a data camera (yaw/pitch/dist/fov). Same maths as
//                    src/v3/components-meta/Model3D.ts projectAnchor (tested equal), which matches three's
//                    Vector3.project to 1e-6 px (W3a).
//
// NO runtime imports (bundle-safe under Remotion's webpack and NodeNext): import from remotion/ extensionless.

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Cam {
  x: number;
  y: number;
  zoom: number;
}

/** = src/v2/timeline.ts CAM_ANCHOR (= theme layout.stage cx/cy); a test keeps them equal. */
export const STAGE_ANCHOR: Readonly<Pt> = { x: 540, y: 855 };
export const FRAME = { w: 1080, h: 1920 } as const;
/** The v2 stage band (bible §1) as a screen rect: x 64–1016, y 150–1560 (header band to the hairline). */
export const STAGE_RECT: Readonly<Rect> = { x: 64, y: 150, w: 952, h: 1410 };
/** Safe zone for screen overlays (lint A5): x 64–1016, below the header band (218), above the caption card's bottom. */
export const OVERLAY_SAFE = { x0: 64, x1: 1016, y0: 218, y1: 1520, textRight: 960 } as const;

export const worldToScreen = (c: Cam, p: Pt): Pt => ({ x: (p.x - c.x) * c.zoom + STAGE_ANCHOR.x, y: (p.y - c.y) * c.zoom + STAGE_ANCHOR.y });
export const screenToWorld = (c: Cam, p: Pt): Pt => ({ x: (p.x - STAGE_ANCHOR.x) / c.zoom + c.x, y: (p.y - STAGE_ANCHOR.y) / c.zoom + c.y });
export const rectToScreen = (c: Cam, r: Rect): Rect => {
  const a = worldToScreen(c, r);
  return { x: a.x, y: a.y, w: r.w * c.zoom, h: r.h * c.zoom };
};
/** The whole 1080×1920 frame (or a screen rect) in world coordinates under camera c. */
export function screenRectToWorld(c: Cam, s: Rect = { x: 0, y: 0, w: FRAME.w, h: FRAME.h }): Rect {
  const a = screenToWorld(c, s);
  return { x: a.x, y: a.y, w: s.w / c.zoom, h: s.h / c.zoom };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
export const area = (r: Rect | null): number => (r ? r.w * r.h : 0);

/** Share of the stage band a world box covers on screen under camera c (A7: ≥ 0.25 for the first concrete image). */
export function stageCover(c: Cam, box: Rect): number {
  return area(intersect(rectToScreen(c, box), STAGE_RECT)) / area(STAGE_RECT);
}

/** Share of a world box that is on the 1080×1920 frame (0 = off screen). */
export function onScreenShare(c: Cam, box: Rect): number {
  const s = rectToScreen(c, box);
  return area(s) > 0 ? area(intersect(s, { x: 0, y: 0, w: FRAME.w, h: FRAME.h })) / area(s) : 0;
}

/** Screen point of a screen-space overlay's own anchor: the bound part's world point under the camera + (dx, dy). */
export function overlayScreenPoint(c: Cam, anchorWorld: Pt, d: { dx: number; dy: number }, travel: Pt = { x: 0, y: 0 }): Pt {
  const s = worldToScreen(c, { x: anchorWorld.x + travel.x, y: anchorWorld.y + travel.y });
  return { x: s.x + d.dx, y: s.y + d.dy };
}

/** Zoom that makes a part of radius r (world px) span `fill` of the stage width, clamped to the v3 camera range. */
export function zoomForFill(rWorld: number, fill: number, min = 0.6, max = 4): number {
  if (!(rWorld > 0)) return max;
  return Math.max(min, Math.min(max, (fill * STAGE_RECT.w) / (2 * rWorld)));
}

// ── 3D ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Cam3D {
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
}
const rad = (d: number) => (d * Math.PI) / 180;

/** Pivot-space point (metres) → footprint px (Euler XYZ = Rx(pitch)·Ry(yaw), camera at +dist looking down −Z). */
export function projectAnchor(cam: Cam3D, xyz: readonly [number, number, number], size: { w: number; h: number }): { x: number; y: number; depth: number; pxPerM: number } {
  const [x, y, z0] = xyz;
  const cy = Math.cos(rad(cam.yaw)), sy = Math.sin(rad(cam.yaw));
  const cx = Math.cos(rad(cam.pitch)), sx = Math.sin(rad(cam.pitch));
  const x1 = cy * x + sy * z0;
  const z1 = -sy * x + cy * z0;
  const y2 = cx * y - sx * z1;
  const z2 = sx * y + cx * z1;
  const zc = z2 - cam.dist;
  const f = 1 / Math.tan(rad(cam.fov) / 2);
  const aspect = size.w / size.h;
  const ndcX = ((f / aspect) * x1) / -zc;
  const ndcY = (f * y2) / -zc;
  return { x: ((ndcX + 1) / 2) * size.w, y: ((1 - ndcY) / 2) * size.h, depth: -zc, pxPerM: (f / -zc) * (size.h / 2) };
}
