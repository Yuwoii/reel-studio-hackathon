// Pure layout math shared by the W3a golden-still gallery (remotion/v3/components/_gallery) and the host-side ring
// measurement (research/v3/W3a/tools): footprint px → screen px for one standalone component. No runtime imports.

import type { AnchorCtx, AnchorMap, AnyV3Meta } from "./_types.js";
//
//   fit "stage": the footprint (× scale) is fitted into the v2 stage band (x 64–1016, y 230–1480) and centred on the
//                camera anchor (540, 855). fit "full": 1:1 on the 1080×1920 frame, box centred on (540, 960).
//   cam.zoom about cam.focus (footprint px; default = box centre) — the focus lands on the anchor point.

export interface GalleryCam {
  zoom: number;
  focus?: { x: number; y: number };
}
export interface GalleryXf {
  /** screen = p × k + t */
  k: number;
  tx: number;
  ty: number;
}

export function galleryXf(size: { w: number; h: number }, fit: "stage" | "full", cam: GalleryCam = { zoom: 1 }): GalleryXf {
  const base = fit === "full" ? 1 : Math.min(952 / size.w, 1250 / size.h, 1.6);
  const C = fit === "full" ? { x: 540, y: 960 } : { x: 540, y: 855 };
  const F = cam.focus ?? { x: size.w / 2, y: size.h / 2 };
  const k = base * cam.zoom;
  return { k, tx: C.x - F.x * k, ty: C.y - F.y * k };
}

export const toScreen = (xf: GalleryXf, p: { x: number; y: number }) => ({ x: p.x * xf.k + xf.tx, y: p.y * xf.k + xf.ty });


/** One gallery layer: a component with props, laid out (fit/zoom/focus anchor) — or, for an overlay, bound to an anchor
 *  of the layer below (its meta.anchor point lands on that anchor's screen point, 1:1 screen px). */
export interface GalleryLayer {
  component: string;
  props: Record<string, unknown>;
  events?: { f: number; do: string; state?: string; props?: Record<string, unknown> }[];
  fit?: "stage" | "full";
  zoom?: number;
  focus?: string;
}
export interface GalleryInput {
  layer: GalleryLayer;
  /** overlay goldens: the real object under the overlay */
  base?: GalleryLayer;
  bindTo?: string;
  probe?: boolean;
  title?: string;
}

export interface PlacedLayer {
  props: Record<string, unknown>;
  size: { w: number; h: number };
  xf: GalleryXf;
  anchors: AnchorMap;
  /** screen px of every anchor */
  screen: Record<string, { x: number; y: number; r?: number }>;
}

/** Pure placement shared by the Remotion gallery and the host-side ring measurement. */
export function placeLayer(meta: AnyV3Meta, l: GalleryLayer, ctx: AnchorCtx | undefined, bound?: { x: number; y: number }): PlacedLayer {
  const props = meta.propsSchema.parse(l.props) as Record<string, unknown>;
  const size = meta.footprint(props, undefined);
  // gallery convention: a still is taken after every event settled, so the state is the LAST state event's
  const state = [...(l.events ?? [])].reverse().find((e) => e.do === "state")?.state;
  const anchors = meta.anchors(props, size, ctx, state);
  let xf: GalleryXf;
  if (bound) {
    const a = meta.anchor ? meta.anchor(props, undefined) : { x: size.w / 2, y: size.h / 2 };
    xf = { k: 1, tx: bound.x - a.x, ty: bound.y - a.y };
  } else {
    const f = l.focus ? anchors[l.focus] : undefined;
    if (l.focus && !f) throw new Error(`gallery: ${meta.name} has no anchor ${l.focus}`);
    xf = galleryXf(size, l.fit ?? "stage", { zoom: l.zoom ?? 1, focus: f ? { x: f.x, y: f.y } : undefined });
  }
  const screen: PlacedLayer["screen"] = {};
  for (const [k, a] of Object.entries(anchors)) screen[k] = { ...toScreen(xf, a), ...(a.r !== undefined ? { r: a.r * xf.k } : {}) };
  return { props, size, xf, anchors, screen };
}

// ── W3a snap blur probe (ADR-002 §5 L9 / §10 W3a exit): a 40-frame camera move on a real object ─────────────────────
// The hook's snap zoom onto the S of https (zoom 1 → 3.2 in 10 f, pushOut ease-out) then the pull-back (3.2 → 1.2 in
// 12 f), with v2's tent-weighted motion blur sized per frame by the fastest visible point (theme blurSamples). Zoom
// interpolates in log space and the focus point linearly, like the v2 camera (src/v2/timeline.ts cameraAt).

export interface SnapKey {
  f: number;
  zoom: number;
  /** footprint px the camera centres on (lands on the stage anchor 540, 855) */
  focus: { x: number; y: number };
}
export const SNAP_PROBE_F = 40;
/** pushOut = timeline EASE_BEZIER.pushOut (0.33, 1, 0.68, 1) — the ease W3b's `snap` maps to until W4 adds a true snap. */
export const SNAP_EASE = [0.33, 1, 0.68, 1] as const;

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (bx(m) < x) lo = m;
      else hi = m;
    }
    return by((lo + hi) / 2);
  };
}
const snapEase = cubicBezier(...SNAP_EASE);

/** Camera at a (fractional) frame for keys [hold … move … hold]: moves between consecutive keys whose f differ. */
export function snapCamAt(keys: readonly SnapKey[], frame: number): GalleryCam & { focus: { x: number; y: number } } {
  if (frame <= keys[0].f) return { zoom: keys[0].zoom, focus: keys[0].focus };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (frame <= b.f) {
      const t = b.f === a.f ? 1 : snapEase((frame - a.f) / (b.f - a.f));
      return { zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * t), focus: { x: a.focus.x + (b.focus.x - a.focus.x) * t, y: a.focus.y + (b.focus.y - a.focus.y) * t } };
    }
  }
  const z = keys[keys.length - 1];
  return { zoom: z.zoom, focus: z.focus };
}

/** Fastest on-screen displacement (px per frame) of a 9×9 grid over the footprint between frame and frame + 1,
 *  counting only points visible on the 1080×1920 frame at either end. */
export function snapSpeedPx(keys: readonly SnapKey[], size: { w: number; h: number }, frame: number): number {
  const xa = galleryXf(size, "stage", snapCamAt(keys, frame)), xb = galleryXf(size, "stage", snapCamAt(keys, frame + 1));
  let v = 0;
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++) {
      const p = { x: (i / 8) * size.w, y: (j / 8) * size.h };
      const a = toScreen(xa, p), b = toScreen(xb, p);
      const vis = (q: { x: number; y: number }) => q.x >= 0 && q.x <= 1080 && q.y >= 0 && q.y <= 1920;
      if (vis(a) || vis(b)) v = Math.max(v, Math.hypot(b.x - a.x, b.y - a.y));
    }
  return v;
}
