// P3 — server rack: B 3D recoloured rack (0–149) | D treated photo aisle (150–299). Also the GL-mode still test
// (PROOF-SPEC says frame 150, but that is the first photo frame here; the still matrix uses frame 120: door open, hold).
import React from "react";
import { useCurrentFrame } from "remotion";
import { useV2Fonts } from "../v2/fonts";
import rackAisle from "./assets/rack-aisle-dark.jpg";
import { type CamKey, hold } from "./camera";
import { AnchorRing, FooterNote, LabelPill, OptionTag, Stage } from "./overlays";
import { Plate, plateAnchor, plateCam, type PlateDef } from "./plate";
import { RackScene } from "./three/RackScene";

export type P3Props = {
  canvasScale: number;
  antialias: boolean;
};
export const P3_DEFAULTS: P3Props = { canvasScale: 0.5, antialias: true };

const PLATE: PlateDef = { src: rackAisle, pw: 1080, ph: 1920 };
// Re-verified on the treated 1620×2880 plate with a 10 % drawgrid (2026-10-29).
export const RACK_PHOTO_ANCHORS = {
  rack_front: { x: 0.8, y: 0.5 },
  handle: { x: 0.81, y: 0.48 },
  aisle_end: { x: 0.12, y: 0.45 },
  leds: { x: 0.88, y: 0.72 },
} as const;
const kd0: CamKey = { f: 150, zoom: 1.0, cx: 0.55 * PLATE.pw, cy: 0.5 * PLATE.ph };
const kd1: CamKey = { f: 240, zoom: 1.3, cx: 0.8 * PLATE.pw, cy: 0.52 * PLATE.ph, ease: "longPan" };
const KEYS_D: CamKey[] = [kd0, kd1, hold(kd1, 299)];

export const ProofP3: React.FC<P3Props> = (props) => {
  useV2Fonts();
  const frame = useCurrentFrame();
  const p = { ...P3_DEFAULTS, ...props };
  if (frame < 150) {
    return (
      <Stage overlay={<OptionTag text="B · 3D" />}>
        <RackScene from={0} canvasScale={p.canvasScale} antialias={p.antialias} onAnchors={(a) => (
          <>
            {a.leds ? <LabelPill at={a.leds} text="status lights" offset={{ x: 200, y: -260 }} frame={frame} enterF={60} accent /> : null}
            {a.door ? <AnchorRing at={a.door} r={120} frame={frame} enterF={78} exitF={104} /> : null}
          </>
        )} />
      </Stage>
    );
  }
  const cam = plateCam(PLATE, KEYS_D, frame);
  const A = (k: keyof typeof RACK_PHOTO_ANCHORS) => plateAnchor(PLATE, cam, RACK_PHOTO_ANCHORS[k]);
  return (
    <Stage overlay={<>
      <LabelPill at={A("handle")} text="a server rack" offset={{ x: -330, y: -260 }} frame={frame} enterF={200} accent />
      <AnchorRing at={A("leds")} r={70} frame={frame} enterF={245} />
      <OptionTag text="D · PHOTO" />
      <FooterNote text="Photo: Brett Sayles, Pexels licence, treated" />
    </>}>
      <Plate def={PLATE} cam={cam} />
    </Stage>
  );
};
