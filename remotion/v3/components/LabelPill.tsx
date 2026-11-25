// LabelPill renderer (meta: src/v3/components-meta/LabelPill.ts).
import React from "react";
import { interpolate } from "remotion";
import { LabelPillProps, meta, pillGeom, type LabelPillPropsT } from "../../../src/v3/components-meta/LabelPill";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, drawOn, enterProgress } from "../../v2/motion";
import { color, font, radius, type } from "../../v2/theme";

void LabelPillProps;

const Render: React.FC<RenderProps<LabelPillPropsT>> = ({ props: p, frame, enterF, exitF, size }) => {
  const e0 = enterF ?? -30;
  if (frame < e0) return null;
  const out = exitF !== null ? interpolate(frame, [exitF, exitF + 8], [1, 0], clampX) : 1;
  if (out <= 0) return null;
  const g = pillGeom(p);
  const lead = drawOn(frame, e0, 10);
  const e = enterProgress(frame, e0 + 4);
  const P = g.pill;
  const nx = Math.min(Math.max(g.ax, P.x), P.x + P.w);
  const ny = Math.min(Math.max(g.ay, P.y), P.y + P.h);
  const tone = p.tone === "accent" ? color.accent : color.text;
  const S = g.S;
  const big = p.size !== "md";
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, opacity: out }}>
      <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={size.w} height={size.h}>
        <line x1={g.ax} y1={g.ay} x2={g.ax + (nx - g.ax) * lead} y2={g.ay + (ny - g.ay) * lead} stroke={big ? color.textDim : color.borderStrong} strokeWidth={S.lead} />
        <circle cx={g.ax} cy={g.ay} r={S.dot} fill={tone} />
      </svg>
      <div style={{ position: "absolute", left: P.x, top: P.y, width: P.w, height: P.h, boxSizing: "border-box", background: big ? color.bgRaised2 : color.bgRaised, border: `${S.border}px solid ${big ? (p.tone === "accent" ? color.accent : color.textDim) : color.borderStrong}`, borderRadius: radius.pill, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.mono, fontWeight: type.pill.weight, fontSize: S.px, color: tone, whiteSpace: "pre", opacity: e, transform: `translateY(${(1 - e) * 12}px) scale(${0.97 + 0.03 * e})` }}>{p.text}</div>
    </div>
  );
};

export const LabelPill = defineComponent({ ...meta, Render });
