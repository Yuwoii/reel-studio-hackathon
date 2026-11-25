// Padlock renderer (meta: src/v3/components-meta/Padlock.ts). `PadlockGlyph` is shared with LockBox.
import React from "react";
import { interpolate } from "remotion";
import { meta, padlockBox, padlockGeom, PL, type PadlockPropsT } from "../../../src/v3/components-meta/Padlock";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color } from "../../v2/theme";

export interface PadlockGlyphProps {
  s: number;
  cx: number;
  cy: number;
  /** 0 = shut, 1 = fully open (lifted + swung out). */
  open: number;
  tone: "accent" | "neutral";
  /** 0 = no key; 1 = key fully in. (Not `key`: React reserves it.) */
  keyIn?: number;
  /** 0..1 quarter turn of the key. */
  turn?: number;
  /** 0..1 flash on the click. */
  click?: number;
}

/** A padlock whose body centre is (cx, cy). Shut = tone (accent: lime body, dark keyhole); open = ALWAYS neutral. */
export const PadlockGlyph: React.FC<PadlockGlyphProps> = ({ s, cx, cy, open, tone, keyIn = 0, turn = 0, click = 0 }) => {
  const g = padlockGeom(s, cx, cy);
  const lit = tone === "accent" && open < 0.5;
  const body = lit ? color.accent : color.bgRaised2;
  const ink = lit ? color.accentInk : color.text;
  const stroke = lit ? color.accent : color.text;
  const lift = interpolate(open, [0, 0.6], [0, g.lift], clampX);
  const swing = interpolate(open, [0.5, 1], [0, -38], clampX);
  const sw = g.shT;
  const legL = cx - g.shW / 2, legR = cx + g.shW / 2;
  const topY = g.bodyTop - g.shH;
  const arc = `M ${legL} ${g.bodyTop + sw} L ${legL} ${topY + g.shW / 2} A ${g.shW / 2} ${g.shW / 2} 0 0 1 ${legR} ${topY + g.shW / 2} L ${legR} ${g.bodyTop + sw}`;
  const kh = g.keyhole;
  return (
    <g>
      {click > 0.02 ? <circle cx={cx} cy={cy - s * 0.1} r={s * (0.55 + 0.25 * (1 - click))} fill="none" stroke={stroke} strokeWidth={Math.max(2, s * 0.02)} opacity={0.5 * click} /> : null}
      <g transform={`translate(0 ${-lift}) rotate(${swing} ${legR} ${g.bodyTop})`}>
        <path d={arc} fill="none" stroke={lit ? color.accent : color.textDim} strokeWidth={sw} strokeLinecap="round" />
        <path d={arc} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={Math.max(1.5, sw * 0.18)} strokeLinecap="round" transform={`translate(${-sw * 0.18} 0)`} />
      </g>
      <rect x={g.bodyX} y={g.bodyTop} width={g.bw} height={g.bh} rx={s * 0.1} fill={body} stroke={stroke} strokeWidth={Math.max(2, s * 0.025)} />
      <rect x={g.bodyX + s * 0.06} y={g.bodyTop + s * 0.035} width={g.bw - s * 0.12} height={Math.max(1.5, s * 0.02)} rx={1} fill={lit ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.18)"} />
      {keyIn > 0 ? (
        <g opacity={keyIn} transform={`rotate(${90 * turn} ${kh.x} ${kh.y})`}>
          <rect x={kh.x - s * 0.035} y={kh.y - s * 0.02} width={s * 0.07} height={s * 0.2} rx={s * 0.02} fill={color.text} />
          <circle cx={kh.x} cy={kh.y + s * 0.26} r={s * 0.1} fill={color.text} stroke={color.bg} strokeWidth={Math.max(1.5, s * 0.015)} />
          <circle cx={kh.x} cy={kh.y + s * 0.26} r={s * 0.04} fill={color.bg} />
        </g>
      ) : (
        <>
          <circle cx={kh.x} cy={kh.y} r={kh.r} fill={ink} />
          <path d={`M ${kh.x - kh.r * 0.55} ${kh.y + kh.r * 0.4} L ${kh.x + kh.r * 0.55} ${kh.y + kh.r * 0.4} L ${kh.x + kh.r * 0.3} ${kh.y + kh.r * 2.6} L ${kh.x - kh.r * 0.3} ${kh.y + kh.r * 2.6} Z`} fill={ink} />
        </>
      )}
    </g>
  );
};

const Render: React.FC<RenderProps<PadlockPropsT>> = ({ props: p, frame, state, last, size }) => {
  const b = padlockBox(p.w);
  const sf = state.f;
  const t = sf === null ? 1 : interpolate(frame, [sf, sf + PL.stateF], [0, 1], clampX);
  const open = state.name === "open" ? t : 1 - t;
  const lp = last("pulse");
  const turn = lp === undefined ? 0 : interpolate(frame, [lp, lp + PL.turnF], [0, 1], clampX);
  const click = state.name === "locked" && sf !== null ? flash(frame, sf + PL.stateF, 6) : 0;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={size.w} height={size.h}>
      <PadlockGlyph s={p.w} cx={b.cx} cy={b.cy} open={open} tone={p.tone} keyIn={p.key ? 1 : 0} turn={turn} click={click} />
    </svg>
  );
};

export const Padlock = defineComponent({ ...meta, Render });
