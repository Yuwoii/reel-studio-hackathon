// (b) 3D wrapper for the v3lab proofs. Loads a GLB (bundled as a webpack asset) under delayRender, hands the caller a
// THREE.Group to configure once, and renders it in a <ThreeCanvas> whose camera and scene state are mutated in the
// React render body as a PURE FUNCTION OF THE FRAME (no useFrame; ThreeCanvas advances once per frame after commit).
// The canvas renders at `canvasScale` × 1080×1920 internally and is CSS-scaled up to the full frame.
// Anchors = glTF node names (or our own added meshes), projected to screen px each frame with the same camera.
import { ThreeCanvas } from "@remotion/three";
import React, { useEffect, useMemo, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const cache = new Map<string, Promise<THREE.Group>>();

function loadGlb(url: string): Promise<THREE.Group> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = new GLTFLoader().loadAsync(url).then((g) => g.scene);
  cache.set(url, p);
  return p;
}

/** Loads the GLB once per tab (60 s delayRender budget: GLB fetch + parse on Lambda), returns a configured root. */
export function useGlb(url: string, configure: (scene: THREE.Group) => THREE.Group): THREE.Group | null {
  const [root, setRoot] = useState<THREE.Group | null>(null);
  const [handle] = useState(() => delayRender(`GLB ${url}`, { timeoutInMilliseconds: 60_000, retries: 1 }));
  useEffect(() => {
    let alive = true;
    loadGlb(url)
      .then((scene) => {
        if (!alive) return;
        const r = configure(scene.clone(true));
        r.updateMatrixWorld(true);
        setRoot(r);
        continueRender(handle);
      })
      .catch((e: unknown) => cancelRender(e instanceof Error ? e : new Error(String(e))));
    return () => {
      alive = false;
    };
    // configure is a module-level function in every caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, handle]);
  return root;
}

export function usePerspective(fov: number): THREE.PerspectiveCamera {
  return useMemo(() => {
    const c = new THREE.PerspectiveCamera(fov, 1080 / 1920, 0.01, 100);
    (c as THREE.PerspectiveCamera & { manual?: boolean }).manual = true;
    return c;
  }, [fov]);
}

/** Point the camera (pure function of the frame; call in the render body). */
export function aim(cam: THREE.PerspectiveCamera, pos: THREE.Vector3Like, target: THREE.Vector3Like): void {
  cam.position.set(pos.x, pos.y, pos.z);
  cam.up.set(0, 1, 0);
  cam.lookAt(target.x, target.y, target.z);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}

/** World point → screen px of the full 1080×1920 frame. */
export function project(cam: THREE.PerspectiveCamera, p: THREE.Vector3): { x: number; y: number } {
  const v = p.clone().project(cam);
  return { x: (v.x + 1) * 540, y: (1 - v.y) * 960 };
}

/** World-space bbox centre of a named node (or any object). */
export function centreOf(obj: THREE.Object3D): THREE.Vector3 {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
}

export const GlbCanvas: React.FC<{
  root: THREE.Group | null;
  cam: THREE.PerspectiveCamera;
  canvasScale: number;
  antialias: boolean;
  lights: THREE.Object3D[];
}> = ({ root, cam, canvasScale, antialias, lights }) => {
  const w = Math.round(1080 * canvasScale);
  const h = Math.round(1920 * canvasScale);
  // Mounted only once the GLB is in: ThreeCanvas advances on create and on frame change, not on later scene edits,
  // so a scene added after the first advance would miss the captured frame (measured: blank still on Lambda).
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transformOrigin: "0 0", transform: `scale(${1 / canvasScale})` }}>
      {root ? <ThreeCanvas width={w} height={h} dpr={1} camera={cam} gl={{ antialias, preserveDrawingBuffer: true, alpha: true, powerPreference: "high-performance" }} style={{ background: "transparent" }}>
        {lights.map((l, i) => <primitive key={i} object={l} />)}
        <primitive object={root} />
      </ThreeCanvas> : null}
    </div>
  );
};

/** Lights built once per scene (hemisphere + directionals at fixed world positions). */
export function useLights(hemi: number, dirs: { pos: [number, number, number]; intensity: number }[], sky: string, ground: string): THREE.Object3D[] {
  return useMemo(() => {
    const out: THREE.Object3D[] = [new THREE.HemisphereLight(sky, ground, hemi)];
    for (const d of dirs) {
      const l = new THREE.DirectionalLight(sky, d.intensity);
      l.position.set(...d.pos);
      out.push(l);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export { THREE };
