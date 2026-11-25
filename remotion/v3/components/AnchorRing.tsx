// AnchorRing renderer (meta: src/v3/components-meta/AnchorRing.ts).
import React from "react";
import { interpolate } from "remotion";
import { AnchorRingProps, meta, RING, type AnchorRingPropsT } from "../../../src/v3/components-meta/AnchorRing";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, drawOn } from "../../v2/motion";
import { color } from "../../v2/theme";

void AnchorRingProps;
const TONE = { accent: color.accent, danger: color.danger, neutral: color.text } as const;

const Render: React.FC<RenderProps<AnchorRingPropsT>> = ({ props: p, frame, enterF, exitF, size }) => {
  const e = enterF ?? -RING.drawF;
  if (frame < e) return null;
  const prog = drawOn(frame, e, RING.drawF);
  const out = exitF !== null ? interpolate(frame, [exitF, exitF + 8], [1, 0], clampX) : 1;
  if (out <= 0) return null;
  const c = size.w / 2;
  const ph = p.pulse && frame >= e + RING.drawF ? 0.5 + 0.5 * Math.cos(((frame - e - RING.drawF) / RING.periodF) * 2 * Math.PI) : 1;
  const C = 2 * Math.PI * p.r;
  const halo = p.r + 6 + 8 * (1 - ph);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: out }} width={size.w} height={size.h}>
      {p.pulse ? <circle cx={c} cy={c} r={halo} fill="none" stroke={TONE[p.tone]} strokeOpacity={0.3} strokeWidth={2} opacity={prog >= 1 ? 0.3 + 0.7 * (1 - ph) : 0} /> : null}
      <circle cx={c} cy={c} r={p.r} fill="none" stroke={TONE[p.tone]} strokeWidth={RING.stroke} strokeLinecap="round" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - prog)} transform={`rotate(-90 ${c} ${c})`} />
    </svg>
  );
};

export const AnchorRing = defineComponent({ ...meta, Render });
