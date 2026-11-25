// (b) 3D server rack: Grab3D "Server rack" (CC0, light variant), recoloured to the dark UI. LED materials blink by a
// deterministic hash of (floor(f/6), material index); the door swings −100° about its hinge (glTF Y) at 90–110.
import React from "react";
import { Easing, random, useCurrentFrame } from "remotion";
import { camera as camTok } from "../../v2/theme";
import { mat3d } from "../theme";
import { aim, centreOf, GlbCanvas, project, THREE, useGlb, useLights, usePerspective } from "./GlbStage";

const URL_RACK = new URL("../assets/server-rack-light.glb", import.meta.url).href;
const EB = Easing.bezier(...camTok.ease.bible);
const EL = Easing.bezier(...camTok.ease.longPan);
const seg = (f: number, a: number, b: number, long = false) => (long ? EL : EB)(Math.min(1, Math.max(0, (f - a) / (b - a))));

const LED_LEVEL: Record<string, number> = { "server-rack_led_mint_x": 0.6, "server-rack_led_sky_x": 0.4, "server-rack_led_butter_x": 0.25 };

function configure(scene: THREE.Group): THREE.Group {
  const body = new THREE.MeshStandardMaterial({ color: mat3d.rackBody, roughness: 0.6, metalness: 0.3 });
  const door = new THREE.MeshStandardMaterial({ color: mat3d.rackDoor, roughness: 0.55, metalness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: mat3d.rackGlass, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false });
  let ledIdx = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const next = mats.map((mm) => {
      const n = mm.name;
      if (n.startsWith("server-rack_body")) return body;
      if (n.startsWith("server-rack_door_glass")) return glass;
      if (n.startsWith("server-rack_door")) return door;
      if (n in LED_LEVEL) {
        const led = new THREE.MeshStandardMaterial({ color: "#000000", emissive: mat3d.accent, emissiveIntensity: LED_LEVEL[n], roughness: 0.4 });
        led.name = n;
        led.userData = { base: LED_LEVEL[n], idx: ledIdx++ };
        return led;
      }
      return mm;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
  });
  return scene;
}

/** Segment-local frame lf 0..149. */
export const RackScene: React.FC<{ from: number; canvasScale: number; antialias: boolean; onAnchors?: (a: Record<string, { x: number; y: number }>) => React.ReactNode }> = ({ from, canvasScale, antialias, onAnchors }) => {
  const lf = useCurrentFrame() - from;
  const root = useGlb(URL_RACK, configure);
  const cam = usePerspective(35);
  const lights = useLights(1.3, [{ pos: [-3, 2, -2], intensity: 2.5 }, { pos: [2.5, 2.5, 3.5], intensity: 2.2 }], mat3d.hemiSky, mat3d.hemiGround);
  // orbit: azimuth 0.35 → 0.12, elevation 0.10 → 0.06, distance 5.2 → 3.4, target y 1.0 → 1.25 (upper part)
  const t = seg(lf, 0, 90, true);
  const az = 0.35 + (0.12 - 0.35) * t;
  const el = 0.1 + (0.06 - 0.1) * t;
  const d = 5.2 + (3.4 - 5.2) * t;
  const ty = 1.0 + (1.25 - 1.0) * t;
  aim(cam, { x: d * Math.sin(az) * Math.cos(el), y: ty + d * Math.sin(el), z: d * Math.cos(az) * Math.cos(el) }, { x: 0, y: ty, z: 0 });
  const anchors: Record<string, { x: number; y: number }> = {};
  if (root) {
    const doorNode = root.getObjectByName("server-rack_door");
    if (doorNode) doorNode.rotation.y = (-100 * Math.PI / 180) * seg(lf, 90, 110);
    const step = Math.floor((lf + from) / 6);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
        const u = mm.userData as { base?: number; idx?: number };
        if (u.base === undefined) continue;
        const on = random(`rack-led-${step}-${u.idx}`) > 0.3;
        (mm as THREE.MeshStandardMaterial).emissiveIntensity = on ? u.base * 2.2 : u.base * 0.35;
      }
    });
    root.updateMatrixWorld(true);
    // status-light column near the top unit (LED mesh spans y 0.16–1.76 at z ≈ 0.41)
    anchors.leds = project(cam, new THREE.Vector3(0.04, 1.55, 0.41));
    if (doorNode) anchors.door = project(cam, centreOf(doorNode));
    anchors.top = project(cam, new THREE.Vector3(0, 1.9, 0.5));
  }
  return (
    <>
      <GlbCanvas root={root} cam={cam} canvasScale={canvasScale} antialias={antialias} lights={lights} />
      {root && onAnchors ? onAnchors(anchors) : null}
    </>
  );
};
