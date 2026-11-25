// (b) 3D watch: Innerscene "Square smartwatch" (CC0). Band hidden, materials overridden to opaque standard PBR (no
// transmission/clearcoat), 2 emissive green LEDs + 4 dark photodiode discs added on the sensor window's −Z face in the
// same normalised layout as WatchBack. The WATCH rotates (lights stay put, so the back is lit when it faces us).
import React from "react";
import { Easing, useCurrentFrame } from "remotion";
import { camera as camTok } from "../../v2/theme";
import { heartPulse, LED_GREEN_HEX, mat3d } from "../theme";
import { aim, GlbCanvas, project, THREE, useGlb, useLights, usePerspective } from "./GlbStage";

const URL_WATCH = new URL("../assets/square-smartwatch.glb", import.meta.url).href;
const ease = Easing.bezier(...camTok.ease.bible);
const seg = (f: number, a: number, b: number) => ease(Math.min(1, Math.max(0, (f - a) / (b - a))));

const HIDE = (n: string) => n.startsWith("Band,") || n.startsWith("Strap_keepers") || n.startsWith("Tang_buckle");
// Case centre in the GLB (root translation y 0.031, case z 0.0013..0.009).
const C = new THREE.Vector3(0, 0.031, 0.005);
const R_WIN = 0.0068;
const LEDS = [{ x: -0.18, y: 0 }, { x: 0.18, y: 0 }]; // × R_WIN, from WatchBack led_l/led_r
const PDS = [{ x: 0, y: 0.4 }, { x: -0.47, y: -0.07 }, { x: 0.47, y: -0.07 }, { x: 0, y: -0.47 }];

function configure(scene: THREE.Group): THREE.Group {
  // no environment map (PMREM is too slow in SwiftShader), so a high metalness renders near-black: keep it low
  const metal = new THREE.MeshStandardMaterial({ color: mat3d.watchMetal, roughness: 0.45, metalness: 0.35 });
  const back = new THREE.MeshStandardMaterial({ color: mat3d.watchBack, roughness: 0.35, metalness: 0.1 });
  const glass = new THREE.MeshStandardMaterial({ color: mat3d.watchSensorDark, roughness: 0.15, metalness: 0.2 });
  scene.traverse((o) => {
    if (HIDE(o.name)) o.visible = false;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = /Optical_sensor_window/.test(o.name) ? glass : /Polycarbonate_back|Display_panel|Cover_glass/.test(o.name) ? back : metal;
  });
  const win = scene.getObjectByName("Optical_sensor_window");
  if (!win) throw new Error("GLB: Optical_sensor_window node missing");
  const disc = (r: number, mat: THREE.Material, x: number, y: number, name: string) => {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 48), mat);
    mesh.position.set(x * R_WIN, y * R_WIN, -0.00035);
    mesh.rotation.y = Math.PI; // face −Z
    mesh.name = name;
    win.add(mesh);
    return mesh;
  };
  LEDS.forEach((p, i) => disc(0.13 * R_WIN, new THREE.MeshStandardMaterial({ color: "#000000", emissive: LED_GREEN_HEX, emissiveIntensity: 0, roughness: 0.3 }), p.x, p.y, `led_${i}`));
  PDS.forEach((p, i) => disc(0.14 * R_WIN, new THREE.MeshStandardMaterial({ color: mat3d.watchPhotodiode, roughness: 0.2, metalness: 0.3 }), p.x, p.y, `pd_${i}`));
  // pivot: put the case centre at the origin so the watch flips about its own centre
  const pivot = new THREE.Group();
  scene.position.set(-C.x, -C.y, -C.z);
  pivot.add(scene);
  return pivot;
}

/** Segment-local frame lf 0..99: 0–50 flip 180° about Y, 50–70 dolly 0.12 → 0.085 m, pulse from 50. */
export const WatchScene: React.FC<{ from: number; canvasScale: number; antialias: boolean; onAnchors?: (a: Record<string, { x: number; y: number }>) => React.ReactNode }> = ({ from, canvasScale, antialias, onAnchors }) => {
  const lf = useCurrentFrame() - from;
  const root = useGlb(URL_WATCH, configure);
  const cam = usePerspective(40);
  const lights = useLights(1.2, [{ pos: [2, 3, 4], intensity: 1.5 }], mat3d.hemiSky, mat3d.hemiGround);
  const dist = 0.12 + (0.085 - 0.12) * seg(lf, 50, 70);
  aim(cam, { x: 0, y: 0, z: dist }, { x: 0, y: 0, z: 0 });
  const anchors: Record<string, { x: number; y: number }> = {};
  if (root) {
    root.rotation.set(0.12 * (1 - seg(lf, 0, 50)), Math.PI * seg(lf, 0, 50), 0);
    const level = heartPulse(lf, 50);
    root.traverse((o) => {
      if (o.name.startsWith("led_")) ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + 1.4 * level;
    });
    root.updateMatrixWorld(true);
    for (const n of ["led_0", "led_1", "Optical_sensor_window"]) {
      const o = root.getObjectByName(n);
      if (o) anchors[n] = project(cam, o.getWorldPosition(new THREE.Vector3()));
    }
  }
  return (
    <>
      <GlbCanvas root={root} cam={cam} canvasScale={canvasScale} antialias={antialias} lights={lights} />
      {root && onAnchors ? onAnchors(anchors) : null}
    </>
  );
};
