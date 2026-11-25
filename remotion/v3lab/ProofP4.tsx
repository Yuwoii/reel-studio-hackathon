// P4 — (c) real page capture (example.com, Playwright on the host) framed in the drawn generic chrome of P1, with the
// real TLS values from the same capture in the certificate popover.
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { clampX, enterProgress } from "../v2/motion";
import { useV2Fonts } from "../v2/fonts";
import exampleComPng from "./assets/example-com.png";
import { camAt, type CamKey, hold, toScreen, worldTransform } from "./camera";
import { BrowserWindow, WIN, winAnchors } from "./devices/BrowserWindow";
import { PAGE_ANCHORS } from "./exampleCom";
import { AnchorRing, FooterNote, LabelPill, OptionTag, Stage } from "./overlays";
import { CERT } from "./ProofP1";

const A = winAnchors("example.com");
const k0: CamKey = { f: 0, zoom: 0.88, cx: WIN.w / 2, cy: WIN.h / 2 };
const k60: CamKey = { f: 60, zoom: 1.5, cx: PAGE_ANCHORS.p.x, cy: PAGE_ANCHORS.p.y - 60 };
const k120: CamKey = { f: 120, zoom: 3.0, cx: A.lock.x + 90, cy: A.lock.y };
const k190: CamKey = { f: 190, zoom: 1.3, cx: 428, cy: 385 };
export const P4_KEYS: CamKey[] = [k0, hold(k0, 40), k60, hold(k60, 100), k120, hold(k120, 170), k190, hold(k190, 299)];

export const ProofP4: React.FC = () => {
  useV2Fonts();
  const frame = useCurrentFrame();
  const cam = camAt(P4_KEYS, frame);
  const e = enterProgress(frame, 0);
  const lockAccent = interpolate(frame, [125, 131], [0, 1], clampX);
  const s = (p: { x: number; y: number }) => toScreen(cam, p.x, p.y);
  const pTop = { x: PAGE_ANCHORS.p.x, y: PAGE_ANCHORS.pBox.br.y + 20 };
  return (
    <Stage overlay={<>
      <AnchorRing at={s(PAGE_ANCHORS.svg)} r={70} frame={frame} enterF={62} exitF={100} />
      <LabelPill at={s(pTop)} text="a real web page" offset={{ x: 0, y: 330 }} frame={frame} enterF={66} exitF={100} />
      <AnchorRing at={s(A.lock)} r={90} frame={frame} enterF={124} exitF={170} />
      <OptionTag text="C · REAL PAGE + DRAWN CHROME" />
      <FooterNote text="example.com · IANA documentation domain" />
      <FooterNote text="page: Playwright capture 2026-10-29" line={1} />
    </>}>
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: worldTransform(cam) }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: WIN.h, opacity: e, transform: `scale(${0.97 + 0.03 * e})`, transformOrigin: "50% 50%" }}>
          <BrowserWindow frame={frame} host="example.com" path="/" lockAccent={lockAccent} pageSrc={exampleComPng} popover={{ openF: 178, rowsF: 190, cert: CERT }} />
        </div>
      </div>
    </Stage>
  );
};
