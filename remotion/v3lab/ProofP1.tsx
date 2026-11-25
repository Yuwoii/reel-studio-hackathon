// P1 — (a) in-house BrowserWindow: hook pause, push to the URL bar, zoom to the lock, certificate popover.
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { clampX, enterProgress } from "../v2/motion";
import { useV2Fonts } from "../v2/fonts";
import { camAt, type CamKey, hold, toScreen, worldTransform } from "./camera";
import { BrowserWindow, WIN, winAnchors } from "./devices/BrowserWindow";
import { TLS } from "./exampleCom";
import { AnchorRing, LabelPill, OptionTag, Stage } from "./overlays";

const A = winAnchors("example.com");
const k0: CamKey = { f: 0, zoom: 0.88, cx: WIN.w / 2, cy: WIN.h / 2 };
const k65: CamKey = { f: 65, zoom: 1.6, cx: A.urlbar.x, cy: A.urlbar.y + 120 };
const k113: CamKey = { f: 113, zoom: 3.6, cx: A.lock.x + 80, cy: A.lock.y };
const k170: CamKey = { f: 170, zoom: 1.35, cx: 428, cy: 385 };
export const P1_KEYS: CamKey[] = [
  k0, hold(k0, 45), k65, hold(k65, 95), k113, hold(k113, 150), k170, hold(k170, 270),
  { f: 299, zoom: 1.0, cx: WIN.w / 2, cy: 520, ease: "bible" },
];

export const CERT = { protocol: TLS.protocol, subject: TLS.subjectName, issuer: TLS.issuer, validTo: TLS.validTo };

export const ProofP1: React.FC = () => {
  useV2Fonts();
  const frame = useCurrentFrame();
  const cam = camAt(P1_KEYS, frame);
  const e = enterProgress(frame, 0);
  const lockAccent = interpolate(frame, [105, 111], [0, 1], clampX);
  const s = (p: { x: number; y: number }) => toScreen(cam, p.x, p.y);
  return (
    <Stage overlay={<>
      <AnchorRing at={s(A.scheme)} r={150} frame={frame} enterF={70} exitF={95} />
      <AnchorRing at={s(A.lock)} r={98} frame={frame} enterF={118} exitF={150} />
      <LabelPill at={s(A.protocolRow)} text="the lock = this" offset={{ x: 60, y: 500 }} frame={frame} enterF={215} accent />
      <OptionTag text="A · ILLUSTRATION" />
    </>}>
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: worldTransform(cam) }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: WIN.h, opacity: e, transform: `scale(${0.97 + 0.03 * e})`, transformOrigin: "50% 50%" }}>
          <BrowserWindow frame={frame} host="example.com" lockAccent={lockAccent} popover={{ openF: 158, rowsF: 175, cert: CERT }} />
        </div>
      </div>
    </Stage>
  );
};
