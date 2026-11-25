// <Plate>: a pre-treated photo / capture laid out at world (0,0) with size pw×ph (world px), moved by a keyframed
// camera (camera.ts) that is clamped so the plate always covers the stage. Anchors are plate-normalised {x, y}.
// No CSS filter, no @remotion/effects: all treatment is baked into the asset on the host.
import React from "react";
import { Img } from "remotion";
import { type Cam, camAt, type CamKey, clampToPlate, toScreen, worldTransform } from "./camera";

export interface PlateDef {
  src: string;
  pw: number;
  ph: number;
}

export function plateCam(def: PlateDef, keys: readonly CamKey[], frame: number): Cam {
  return clampToPlate(camAt(keys, frame), def.pw, def.ph);
}

export function plateAnchor(def: PlateDef, cam: Cam, a: { x: number; y: number }): { x: number; y: number } {
  return toScreen(cam, a.x * def.pw, a.y * def.ph);
}

export const Plate: React.FC<{ def: PlateDef; cam: Cam; children?: React.ReactNode }> = ({ def, cam, children }) => (
  <div style={{ position: "absolute", left: 0, top: 0, width: def.pw, height: def.ph, transformOrigin: "0 0", transform: worldTransform(cam) }}>
    <Img src={def.src} style={{ position: "absolute", left: 0, top: 0, width: def.pw, height: def.ph }} />
    {children}
  </div>
);
