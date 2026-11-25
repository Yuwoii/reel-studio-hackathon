// Model3D — a live 3D model from the asset registry (D1 #1: only clear-origin CC0 models, e.g. the Innerscene watch;
// rendered per reel with --gl=swangle on Lambda). The camera is data: the model turns by `yaw` / `pitch` (degrees, three
// Euler XYZ) about its manifest pivot; the camera sits at (0, 0, dist) m looking at the origin with vertical `fov`.
// anchors(props, size, {asset}) projects the manifest's xyz (pivot-space metres) with projectAnchor() below — a pure
// function with no three.js dependency that equals three's Vector3.project for this camera (test/v3-w3a-*), so lints,
// digest and overlays agree with the render. W3b may move projectAnchor to src/v3/project.ts (ADR §4.5).
// state "measuring": the added LED discs glow (steady + fast shimmer — never at heart rate).
import { z } from "zod";
import type { AnchorCtx, AnchorMap, V3MetaDef } from "./_types.js";

export const Model3DProps = z
  .object({
    asset: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){0,5}@\d{1,3}$/),
    yaw: z.number().min(-360).max(360).default(150),
    pitch: z.number().min(-80).max(80).default(15),
    dist: z.number().min(0.03).max(2).default(0.1),
    fov: z.number().min(10).max(90).default(40),
    canvasScale: z.union([z.literal(0.5), z.literal(0.75), z.literal(1)]).default(0.5),
    w: z.number().int().min(200).max(2160).default(1080),
    /** show the model's strap (the manifest's hideNodes): a watch without its strap reads as a black coaster (W3a
     *  review). false = case only, for close-ups on the sensor window after the watch was established. */
    band: z.boolean().default(true),
  })
  .strict()
  // measured on the W3a golden Model3D-b: seen straight from the back, the closed strap loop lies between the camera
  // and the case back and hides the sensor window — turn ≥ 15° / tilt ≥ 12° or take the strap off (band: false)
  .refine((p) => !(p.band && Math.abs((((p.yaw % 360) + 360) % 360) - 180) < 15 && Math.abs(p.pitch) < 12), {
    message: "Model3D: with the strap on, a straight back view (yaw ≈ 180°, |pitch| < 12°) shows the strap loop covering the sensor window — turn/tilt the watch or set band: false",
    path: ["band"],
  });
export type Model3DPropsT = z.output<typeof Model3DProps>;

const rad = (d: number) => (d * Math.PI) / 180;

/** Pivot-space point → footprint px for this camera (equals three: Euler XYZ rotation, then PerspectiveCamera.project). */
export function projectAnchor(cam: Pick<Model3DPropsT, "yaw" | "pitch" | "dist" | "fov">, xyz: readonly [number, number, number], size: { w: number; h: number }): { x: number; y: number; depth: number; pxPerM: number } {
  const [x, y, z0] = xyz;
  // R = Rx(pitch) · Ry(yaw)
  const cy = Math.cos(rad(cam.yaw)), sy = Math.sin(rad(cam.yaw));
  const cx = Math.cos(rad(cam.pitch)), sx = Math.sin(rad(cam.pitch));
  const x1 = cy * x + sy * z0;
  const y1 = y;
  const z1 = -sy * x + cy * z0;
  const x2 = x1;
  const y2 = cx * y1 - sx * z1;
  const z2 = sx * y1 + cx * z1;
  const zc = z2 - cam.dist; // camera at +dist looking down −Z
  const f = 1 / Math.tan(rad(cam.fov) / 2);
  const aspect = size.w / size.h;
  const ndcX = ((f / aspect) * x2) / -zc;
  const ndcY = (f * y2) / -zc;
  return { x: ((ndcX + 1) / 2) * size.w, y: ((1 - ndcY) / 2) * size.h, depth: -zc, pxPerM: (f / -zc) * (size.h / 2) };
}

export function modelAnchors(p: Model3DPropsT, size: { w: number; h: number }, ctx?: AnchorCtx): AnchorMap {
  const out: AnchorMap = {};
  for (const [k, a] of Object.entries(ctx?.asset?.anchors ?? {})) {
    if (!a.xyz) continue;
    const q = projectAnchor(p, a.xyz as [number, number, number], size);
    out[k] = { x: q.x, y: q.y, r: a.r !== undefined ? a.r * q.pxPerM : undefined, label: a.label, physical: a.physical };
  }
  return out;
}

export const meta: V3MetaDef<typeof Model3DProps> = {
  name: "Model3D",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §4.5; D1 #1 (b, swangle)",
  summary: "Live 3D model (clear-origin CC0) turned by yaw/pitch; anchors projected from model metres; LEDs can glow.",
  families: ["science", "systems"],
  propsSchema: Model3DProps,
  propsSchemaName: "Model3DProps",
  example: { asset: "watch-generic-3d@1", yaw: 150, pitch: 15 },
  states: ["idle", "measuring"],
  verbs: {
    enter: { durF: 12, does: "model fades in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 8, does: "idle ↔ measuring (LED discs glow steadily, fast shimmer)", props: ["yaw", "pitch", "dist"] },
  },
  focal: true,
  footprint: (p) => ({ w: p.w, h: Math.round((p.w * 16) / 9) }),
  sfx: { enter: "whoosh" },
  v3kind: "model3d",
  anchors: (p, size, ctx) => modelAnchors(p, size, ctx),
  describe: (state, p) => `MODEL3D[${p.asset}] yaw${Math.round(p.yaw)} pitch${Math.round(p.pitch)}${p.band ? " with strap" : " case only"} ${state === "measuring" ? "leds=steady glow (fast shimmer, not heart rate)" : "leds=off"}`,
};
