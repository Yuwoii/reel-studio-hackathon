// P2 — the watch underside in three styles on the same beat: A illustration (0–99) | B 3D flip (100–199) |
// D treated photo (200–299). Hard cuts between segments. Every segment ends on the watch back with pulsing green.
import React from "react";
import { Easing, useCurrentFrame } from "remotion";
import { useV2Fonts } from "../v2/fonts";
import { camera as camTok, color } from "../v2/theme";
import watchPhoto from "./assets/watch-back-photo.jpg";
import { camAt, type CamKey, hold, toScreen, worldTransform } from "./camera";
import { WatchBack, WB, wbPx } from "./devices/WatchBack";
import { FooterNote, LabelPill, OptionTag, type Pt, Stage } from "./overlays";
import { Plate, plateAnchor, plateCam, type PlateDef } from "./plate";
import { heartPulse, ledGreen } from "./theme";
import { WatchScene } from "./three/WatchScene";

export type P2Props = {
  canvasScale: number;
  antialias: boolean;
  /** false = render the photo segment WITHOUT the brand mask (Gate D1 #2 comparison still). */
  brandMask: boolean;
};
export const P2_DEFAULTS: P2Props = { canvasScale: 0.5, antialias: true, brandMask: true };

const ease = Easing.bezier(...camTok.ease.bible);

// ── Segment A ──
const ka0: CamKey = { f: 0, zoom: 0.9, cx: WB.w / 2, cy: WB.h / 2 };
const ka50: CamKey = { f: 50, zoom: 1.8, cx: WB.w / 2, cy: WB.h / 2 };
const KEYS_A: CamKey[] = [ka0, hold(ka0, 30), ka50, hold(ka50, 99)];

const SegA: React.FC<{ frame: number }> = ({ frame }) => {
  const cam = camAt(KEYS_A, frame);
  const rot = -12 * (1 - ease(Math.min(1, frame / 30)));
  const s = (p: Pt) => toScreen(cam, p.x, p.y);
  return (
    <Stage overlay={<>
      <LabelPill at={s(wbPx("led_r"))} text="green light" offset={{ x: 150, y: -380 }} frame={frame} enterF={55} accent />
      <LabelPill at={s(wbPx("pd_right"))} text="sensor" offset={{ x: 120, y: 360 }} frame={frame} enterF={70} />
      <OptionTag text="A · ILLUSTRATION" />
    </>}>
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: worldTransform(cam) }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: WB.w, height: WB.h, transform: `perspective(1600px) rotateY(${rot}deg)`, transformOrigin: "50% 50%" }}>
          <WatchBack frame={frame} pulseFrom={40} />
        </div>
      </div>
    </Stage>
  );
};

// ── Segment B ──
const Halo: React.FC<{ at: Pt; r: number; level: number }> = ({ at, r, level }) => (
  <div style={{ position: "absolute", left: at.x - r, top: at.y - r, width: 2 * r, height: 2 * r, borderRadius: r,
    background: `radial-gradient(circle, ${ledGreen(0.5 * level)} 0%, ${ledGreen(0.15 * level)} 40%, ${ledGreen(0)} 70%)` }} />
);

const SegB: React.FC<{ frame: number; p: P2Props }> = ({ frame, p }) => (
  <Stage overlay={<OptionTag text="B · 3D" />}>
    <WatchScene from={100} canvasScale={p.canvasScale} antialias={p.antialias} onAnchors={(a) => {
      const lf = frame - 100;
      const level = heartPulse(lf, 50);
      return (
        <>
          {lf >= 50 && a.led_0 ? <Halo at={a.led_0} r={110} level={level} /> : null}
          {lf >= 50 && a.led_1 ? <Halo at={a.led_1} r={110} level={level} /> : null}
          {a.led_1 ? <LabelPill at={a.led_1} text="green light" offset={{ x: 120, y: -420 }} frame={frame} enterF={172} accent /> : null}
        </>
      );
    }} />
  </Stage>
);

// ── Segment C ──
const PLATE: PlateDef = { src: watchPhoto, pw: 1410, ph: 1410 };
// Re-verified on the treated 1620² plate with a 5 % drawgrid (2026-10-29): disc centre (0.50, 0.455); lenses at
// top (0.50, 0.385), left (0.38, 0.455), right (0.62, 0.455), bottom (0.50, 0.53); engraved ring r ≈ 0.235–0.28.
export const WATCH_PHOTO_ANCHORS = {
  disc: { x: 0.5, y: 0.455, r: 0.26 },
  lens_top: { x: 0.5, y: 0.385 },
  lens_left: { x: 0.38, y: 0.455 },
  lens_right: { x: 0.62, y: 0.455 },
  lens_bottom: { x: 0.5, y: 0.53 },
  logo: { x: 0.28, y: 0.31 },
} as const;
const MASK = { inner: 0.215, outer: 0.3 } as const;
const kc0: CamKey = { f: 200, zoom: 1.0, cx: 0.5 * PLATE.pw, cy: 0.455 * PLATE.ph };
const kc1: CamKey = { f: 260, zoom: 1.3, cx: 0.5 * PLATE.pw, cy: 0.455 * PLATE.ph, ease: "longPan" };
const KEYS_C: CamKey[] = [kc0, kc1, hold(kc1, 299)];

const SegC: React.FC<{ frame: number; p: P2Props }> = ({ frame, p }) => {
  const cam = plateCam(PLATE, KEYS_C, frame);
  const d = WATCH_PHOTO_ANCHORS.disc;
  const cx = d.x * PLATE.pw;
  const cy = d.y * PLATE.ph;
  const ri = MASK.inner * PLATE.pw;
  const ro = MASK.outer * PLATE.pw;
  const level = heartPulse(frame, 225);
  const gr = 0.12 * PLATE.pw;
  return (
    <Stage overlay={<>
      <LabelPill at={plateAnchor(PLATE, cam, WATCH_PHOTO_ANCHORS.lens_right)} text="light + sensors" offset={{ x: 60, y: 470 }} frame={frame} enterF={240} accent />
      <OptionTag text="D · PHOTO" />
      <FooterNote text="Photo: Fletcher, CC BY 4.0, modified" />
      {!p.brandMask ? <FooterNote text="(unmasked: brand marks visible)" line={1} /> : null}
    </>}>
      <Plate def={PLATE} cam={cam}>
        {p.brandMask ? (
          <div style={{ position: "absolute", left: cx - ro, top: cy - ro, width: 2 * ro, height: 2 * ro, opacity: 0.92,
            background: `radial-gradient(circle closest-side, transparent ${((ri - 6) / ro) * 100}%, ${color.bg} ${(ri / ro) * 100}%, ${color.bg} 97%, transparent 100%)` }} />
        ) : null}
        {frame >= 225 ? (
          <div style={{ position: "absolute", left: cx - gr * 2, top: cy - gr * 2, width: gr * 4, height: gr * 4,
            background: `radial-gradient(circle closest-side, ${ledGreen(0.42 * level)} 0%, ${ledGreen(0.16 * level)} 45%, ${ledGreen(0)} 100%)` }} />
        ) : null}
      </Plate>
    </Stage>
  );
};

export const ProofP2: React.FC<P2Props> = (props) => {
  useV2Fonts();
  const frame = useCurrentFrame();
  const p = { ...P2_DEFAULTS, ...props };
  if (frame < 100) return <SegA frame={frame} />;
  if (frame < 200) return <SegB frame={frame} p={p} />;
  return <SegC frame={frame} p={p} />;
};
