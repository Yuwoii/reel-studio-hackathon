// LockBox renderer (meta: src/v3/components-meta/LockBox.ts). Three layers so the card can sit INSIDE the box:
// back wall (svg) → card (html, <Img> holds the frame until the photo loaded) → front, label, lid, padlock (svg).
// The open lock is always neutral (PadlockGlyph); no danger colour anywhere.
import React from "react";
import { interpolate } from "remotion";
import { LB, labelText, lockBoxGeom, meta, type LockBoxPropsT } from "../../../src/v3/components-meta/LockBox";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash, squash } from "../../v2/motion";
import { color, font } from "../../v2/theme";
import { PadlockGlyph } from "./Padlock";
import { PhotoFace } from "./PhotoCard";

const ramp = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], clampX);

/** Settled-or-animating parts per state. lock 1 = shut, lid 1 = closed, cardIn 1 = inside, xray 1 = see-through. */
function parts(name: string, sf: number | null, frame: number, prev: string | null = null) {
  const t = (a: number, b: number) => (sf === null ? 1 : ramp(frame, sf + a, sf + b));
  switch (name) {
    case "locked":
      // back from the x-ray (S2 r1): the box never re-opens — the lock stays shut, only the see-through fades out
      if (prev === "peek" || prev === "locked") return { lock: 1, lid: 1, cardIn: 1, xray: 1 - t(0, LB.peekF), turn: 0, clickAt: undefined };
      return { lock: t(14, 20), lid: t(6, 14), cardIn: t(0, 10), xray: 0, turn: 0, clickAt: sf === null ? undefined : sf + 20 };
    case "peek":
      return { lock: 1, lid: 1, cardIn: 1, xray: t(0, LB.peekF), turn: 0, clickAt: undefined };
    case "unlocked":
      return { lock: 1 - t(4, 10), lid: 1 - t(8, 16), cardIn: 1 - t(12, LB.unlockF), xray: 0, turn: t(0, 6), clickAt: undefined };
    default: // open
      return { lock: 0, lid: 0, cardIn: 0, xray: 0, turn: 0, clickAt: undefined };
  }
}

const Render: React.FC<RenderProps<LockBoxPropsT>> = ({ props: p, frame, f, state, last, size, id }) => {
  const g = lockBoxGeom(p.w);
  const s = parts(state.name, state.f, frame, state.prev);
  const bump = squash(frame, last("pulse"));
  const click = s.clickAt === undefined ? 0 : flash(frame, s.clickAt, 6);
  const B = g.body, Ld = g.lid;
  // card: out (above the box) ↔ in (low inside, hidden by the front); scales a bit smaller going in
  const cx = interpolate(s.cardIn, [0, 1], [g.cardOut.x, g.cardIn.x]);
  const cy = interpolate(s.cardIn, [0, 1], [g.cardOut.y, g.cardIn.y]);
  const cs = g.cardS * interpolate(s.cardIn, [0, 1], [1, 0.86]);
  // lid: closed = a slab across the top (front layer); opening = it flips up and stands BEHIND the box (back layer),
  // drawn as a taller panel rising from the back edge (foreshortened hinge, stays inside the footprint)
  const lidH = interpolate(s.lid, [0, 1], [p.w * 0.36, Ld.h]);
  const lidBehind = s.lid < 0.5;
  const lidEl = (
    <g>
      <rect x={Ld.x} y={B.y + 0.02 * p.w - lidH} width={Ld.w} height={lidH} rx={p.w * 0.03} fill={lidBehind ? "#26272a" : "#323336"} stroke={color.text} strokeWidth={3} />
      <rect x={Ld.x + 12} y={B.y + 0.02 * p.w - lidH + 4} width={Ld.w - 24} height={3} rx={1.5} fill="rgba(255,255,255,0.22)" />
      {lidBehind ? null : <rect x={g.lock.cx - p.w * 0.035} y={Ld.y + Ld.h - 2} width={p.w * 0.07} height={p.w * 0.07} rx={p.w * 0.015} fill="none" stroke={color.textDim} strokeWidth={Math.max(3, p.w * 0.012)} />}
    </g>
  );
  const frontO = 1 - 0.78 * s.xray;
  let seed = 0;
  for (const c of id) seed = (seed * 31 + c.charCodeAt(0)) % 997;
  const txt = labelText(p.address);
  const lfs = Math.min(g.label.h * 0.5, (g.label.w * 0.88) / (txt.length * 0.6));
  const svgAbs: React.CSSProperties = { position: "absolute", left: 0, top: 0, overflow: "visible" };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, transform: `scale(${bump})`, transformOrigin: `50% ${(B.y + B.h) / size.h * 100}%` }}>
      {/* back wall + inner shadow */}
      <svg style={svgAbs} width={size.w} height={size.h}>
        {lidBehind ? lidEl : null}
        <rect x={B.x} y={B.y} width={B.w} height={B.h} rx={p.w * 0.04} fill={color.bg} stroke={color.borderStrong} strokeWidth={3} />
        <rect x={B.x + 10} y={B.y + 8} width={B.w - 20} height={p.w * 0.06} rx={6} fill="rgba(0,0,0,0.45)" />
      </svg>
      {/* the card (hidden behind the front once inside; in peek the x-ray shows it scrambled instead) */}
      {s.xray < 1 && !(state.name === "locked" && (state.prev === "peek" || state.prev === "locked")) ? (
        <div style={{ position: "absolute", left: cx - cs / 2, top: cy - cs / 2, width: cs, height: cs }}>
          <PhotoFace photo={p.photo} s={cs} scramble={0} f={f} seed={seed + 1} />
        </div>
      ) : null}
      {/* front */}
      <svg style={svgAbs} width={size.w} height={size.h}>
        <defs>
          <linearGradient id={`lb-front-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2c2d30" />
            <stop offset="100%" stopColor="#1b1b1d" />
          </linearGradient>
        </defs>
        <g opacity={frontO}>
          <rect x={B.x} y={B.y} width={B.w} height={B.h} rx={p.w * 0.04} fill={`url(#lb-front-${id})`} stroke={color.text} strokeWidth={3} />
          {/* tape seam down the front */}
          <rect x={B.x + B.w * 0.36} y={B.y} width={B.w * 0.1} height={B.h * 0.66} fill="rgba(255,255,255,0.05)" />
        </g>
        {s.xray > 0 ? <rect x={B.x} y={B.y} width={B.w} height={B.h} rx={p.w * 0.04} fill="none" stroke={color.textDim} strokeWidth={3} strokeDasharray="14 10" opacity={s.xray} /> : null}
        {/* address label: always crisp */}
        <rect x={g.label.x} y={g.label.y} width={g.label.w} height={g.label.h} rx={g.label.h * 0.18} fill={color.text} />
        <text x={g.label.x + g.label.w / 2} y={g.label.y + g.label.h / 2} dominantBaseline="central" textAnchor="middle" fontFamily={font.mono} fontWeight={600} fontSize={lfs} fill={color.accentInk}>
          {txt}
        </text>
        {lidBehind ? null : lidEl}
      </svg>
      {/* x-ray contents: the card as scrambled characters */}
      {s.xray > 0 ? (
        <div style={{ position: "absolute", left: g.xray.x - g.xray.s / 2, top: g.xray.y - g.xray.s / 2, width: g.xray.s, height: g.xray.s, opacity: s.xray }}>
          <PhotoFace photo={p.photo} s={g.xray.s} scramble={1} f={f} seed={seed + 1} />
        </div>
      ) : null}
      <svg style={svgAbs} width={size.w} height={size.h}>
        <PadlockGlyph s={g.lock.s} cx={g.lock.cx} cy={g.lock.cy} open={1 - s.lock} tone={p.lockTone} keyIn={p.key ? 1 : 0} turn={s.turn} click={click} />
      </svg>
    </div>
  );
};

export const LockBox = defineComponent({ ...meta, Render });
