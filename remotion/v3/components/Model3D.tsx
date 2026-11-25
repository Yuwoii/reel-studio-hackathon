// Model3D renderer (meta: src/v3/components-meta/Model3D.ts). Staging comes from the asset manifest: `model.pivot`
// (rotate about the object's own centre), `model.hideNodes` (name prefixes, e.g. the band for underside shots), and
// discs we ADD for the manifest anchors named led.* / sensor.* (the CC0 watch's sensor window is a plain disc —
// caveat in the manifest). Materials are overridden to opaque low-metal PBR (no transmission/clearcoat/PMREM: R3 §2).
import React, { useCallback } from "react";
import { meta, type Model3DPropsT } from "../../../src/v3/components-meta/Model3D";
import { assetByRef } from "../../../src/v3/assets.gen";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { ASSET_URLS } from "../assetUrls.gen";
import { ledLevel } from "./ppg";
import { GlbCanvas, aim, THREE, useGlb, useLights, usePerspective } from "./three/GlbStage";
import { LED_GREEN_HEX, mat3d } from "./tokens";

const DISC_R = { led: 0.00088, sensor: 0.00095 } as const;

const Render: React.FC<RenderProps<Model3DPropsT>> = ({ props: p, frame, state, size }) => {
  const asset = assetByRef(p.asset);
  const url = ASSET_URLS[p.asset];
  const configure = useCallback(
    (scene: THREE.Group): THREE.Group => {
      const m = asset?.model;
      const hide = p.band ? [] : (m?.hideNodes ?? []);
      const strap = new THREE.MeshStandardMaterial({ color: mat3d.watchStrap, roughness: 0.75, metalness: 0 });
      const metal = new THREE.MeshStandardMaterial({ color: mat3d.watchMetal, roughness: 0.45, metalness: 0.35 });
      const back = new THREE.MeshStandardMaterial({ color: mat3d.watchBack, roughness: 0.35, metalness: 0.1 });
      const glass = new THREE.MeshStandardMaterial({ color: mat3d.watchSensorDark, roughness: 0.15, metalness: 0.2 });
      scene.traverse((o) => {
        if (hide.some((h) => o.name.startsWith(h))) o.visible = false;
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const isStrap = (m?.hideNodes ?? []).some((h) => o.name.startsWith(h));
        mesh.material = isStrap ? strap : /sensor/i.test(o.name) ? glass : /back|display|glass/i.test(o.name) ? back : metal;
      });
      const pivot = new THREE.Group();
      const pv = m?.pivot ?? [0, 0, 0];
      scene.position.set(-pv[0], -pv[1], -pv[2]);
      pivot.add(scene);
      for (const [name, a] of Object.entries(asset?.anchors ?? {})) {
        if (!a.xyz || !/^(led|sensor)\./.test(name)) continue;
        const isLed = name.startsWith("led.");
        const mat = isLed
          ? new THREE.MeshStandardMaterial({ color: "#000000", emissive: LED_GREEN_HEX, emissiveIntensity: 0, roughness: 0.3 })
          : new THREE.MeshStandardMaterial({ color: mat3d.watchPhotodiode, roughness: 0.2, metalness: 0.3 });
        const disc = new THREE.Mesh(new THREE.CircleGeometry(isLed ? DISC_R.led : DISC_R.sensor, 48), mat);
        disc.position.set(a.xyz[0], a.xyz[1], a.xyz[2]);
        disc.rotation.y = Math.PI; // face −Z (the back)
        disc.name = name;
        pivot.add(disc);
      }
      return pivot;
    },
    [asset, p.band],
  );
  const root = useGlb(url ?? "", `${p.asset}:${p.band}`, configure);
  const cam = usePerspective(p.fov, size.w / size.h);
  const lights = useLights(mat3d.hemiSky, mat3d.hemiGround, mat3d.rim);
  aim(cam, p.dist);
  if (root) {
    root.rotation.set((p.pitch * Math.PI) / 180, (p.yaw * Math.PI) / 180, 0);
    const level = state.name === "measuring" ? ledLevel(frame) : 0;
    root.traverse((o) => {
      if (o.name.startsWith("led.")) ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + 1.5 * level;
    });
    root.updateMatrixWorld(true);
  }
  if (!url || !asset) throw new Error(`Model3D: asset ${p.asset} is not in the shipped registry (policy-refused or missing)`);
  return <GlbCanvas root={root} cam={cam} w={size.w} h={size.h} canvasScale={p.canvasScale} lights={lights} />;
};

export const Model3D = defineComponent({ ...meta, Render });
