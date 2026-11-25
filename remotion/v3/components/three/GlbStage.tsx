// GLB staging for Model3D (promoted from remotion/v3lab/three/GlbStage.tsx, R3 proof P2/P3 on Lambda with
// --gl=swangle). Loads a GLB under delayRender, hands back a configured root, and renders it in a <ThreeCanvas> whose
// camera is mutated in the render body as a pure function of the frame. The canvas is mounted only once the GLB is in
// (R3 bug: a scene added after ThreeCanvas's first advance missed the captured frame). Types: the hand-written three
// shim (remotion/v3lab/three/three-shim.d.ts, ambient) until @types/three is pinned. It stays in v3lab on purpose: a
// second ambient copy under remotion/v3 would declare the same module twice (duplicate identifiers); whoever deletes
// remotion/v3lab moves it to remotion/v3/three/ in the same change (or pins @types/three).
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

/** Loads the GLB once per tab (60 s delayRender budget), returns `configure(clone)`. */
export function useGlb(url: string, key: string, configure: (scene: THREE.Group) => THREE.Group): THREE.Group | null {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, handle]);
  return root;
}

export function usePerspective(fov: number, aspect: number): THREE.PerspectiveCamera {
  return useMemo(() => {
    const c = new THREE.PerspectiveCamera(fov, aspect, 0.005, 100);
    (c as THREE.PerspectiveCamera & { manual?: boolean }).manual = true;
    return c;
  }, [fov, aspect]);
}

export function aim(cam: THREE.PerspectiveCamera, dist: number): void {
  cam.position.set(0, 0, dist);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}

export function useLights(sky: string, ground: string, rim?: string): THREE.Object3D[] {
  return useMemo(() => {
    const out: THREE.Object3D[] = [new THREE.HemisphereLight(sky, ground, 1.2)];
    const front = new THREE.DirectionalLight(sky, 1.5);
    front.position.set(2, 3, 4);
    const back = new THREE.DirectionalLight(sky, 0.6);
    back.position.set(-2, 1, -4);
    out.push(front, back);
    if (rim) {
      // two rim lights from behind/above-left and behind/below-right: a bright edge on the silhouette
      const r1 = new THREE.DirectionalLight(rim, 3.2);
      r1.position.set(-3, 2.5, -2.5);
      const r2 = new THREE.DirectionalLight(rim, 2.0);
      r2.position.set(3, -1.5, -2.5);
      out.push(r1, r2);
    }
    return out;
  }, [sky, ground, rim]);
}

export const GlbCanvas: React.FC<{ root: THREE.Group | null; cam: THREE.PerspectiveCamera; w: number; h: number; canvasScale: number; lights: THREE.Object3D[] }> = ({ root, cam, w, h, canvasScale, lights }) => {
  const cw = Math.round(w * canvasScale);
  const ch = Math.round(h * canvasScale);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: cw, height: ch, transformOrigin: "0 0", transform: `scale(${1 / canvasScale})` }}>
      {root ? (
        <ThreeCanvas width={cw} height={ch} dpr={1} camera={cam} gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true, powerPreference: "high-performance" }} style={{ background: "transparent" }}>
          {lights.map((l, i) => <primitive key={i} object={l} />)}
          <primitive object={root} />
        </ThreeCanvas>
      ) : null}
    </div>
  );
};

export { THREE };
