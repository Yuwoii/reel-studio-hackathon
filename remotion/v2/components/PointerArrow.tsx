// PointerArrow renderer (bible §6.7). Meta: src/v2/components-meta/PointerArrow.ts.
//
// The dashed line draws on through an evolvePath mask (<DrawPath dash>, R2 §7) so the dash pattern stays stable while
// it grows; the head (an open chevron, solid) fades in over the last 15 % of the draw. enterExit "self": the World
// culls the arrow before its enter frame and after exit + 8 f.
// W2.1 fix B r2: the dashed line + head keep the group exit (opacity 1 → 0, blur 0 → 8 px over 8 f), but the label
// pill is plate-first / content-first (plateFade): on enter its plate is opaque before the text shows, on exit the
// text fades + blurs on the opaque plate (0–4 f) and the plate goes last (4–8 f). A label change masks rolling digits.
import React from "react";
import { interpolate } from "remotion";
import { meta, POINTER_ARROW as A, pointerGeometry, type PointerArrowPropsT } from "../../../src/v2/components-meta/PointerArrow";
import { clampX, drawOn, exitProgress } from "../motion";
import { color, font, motion, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { DrawPath } from "./primitives";
import { scrambleRuns, ScrambleText, type ScrambleRun } from "./scrambleMask";

const TONE: Record<string, { line: ColorToken; label: ColorToken }> = {
  danger: { line: "danger", label: "danger" },
  neutral: { line: "textDim", label: "textDim" },
  accent: { line: "accent", label: "accent" },
  dim: { line: "borderStrong", label: "textDim" },
};

const SCRAMBLE_F = motion.scrambleF[1];

function labelRuns(p: RenderProps<PointerArrowPropsT>): ScrambleRun[] {
  const cur = p.props.label;
  const old = p.prev.label;
  if (p.changeF !== null && old !== cur && p.f < p.changeF + SCRAMBLE_F) return scrambleRuns(old, cur, p.f, p.changeF, SCRAMBLE_F, `${p.id}:label:${p.changeF}`);
  return [{ text: cur, masked: false }];
}

const Render: React.FC<RenderProps<PointerArrowPropsT>> = (p) => {
  const look = TONE[p.state.name] ?? TONE.danger;
  const { w, h } = p.size;
  const g = pointerGeometry(p.base, p.size);
  // the latest of enter / drawOn restarts the draw (no enter at all = drawn from frame 0)
  const drawF = Math.max(p.enterF ?? -Infinity, p.last("drawOn") ?? -Infinity);
  const progress = Number.isFinite(drawF) ? drawOn(p.frame, drawF, A.drawF) : 1;
  const headOp = interpolate(progress, [0.85, 1], [0, 1], clampX);
  const labelOp = p.enterF === null ? 1 : interpolate(p.frame, [p.enterF + A.labelDelayF, p.enterF + A.labelDelayF + A.labelFadeF], [0, 1], clampX);
  const x = exitProgress(p.frame, p.exitF);
  // label pill: plate leads the text on enter (opaque at half the fade), and plateFade's content-first exit
  const out = plateFade(p.frame, null, p.exitF);
  const plateOp = Math.min(1, 2 * labelOp) * out.plate.opacity;
  const textOp = Math.max(0, 2 * labelOp - 1) * out.content.opacity;
  // open chevron at the tip: two legs at ±30° from the reversed direction
  const back = { x: -g.dirV.x, y: -g.dirV.y };
  const rot = (v: { x: number; y: number }, a: number) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const l1 = rot(back, Math.PI / 6);
  const l2 = rot(back, -Math.PI / 6);
  const head = `M ${g.tip.x + l1.x * A.head} ${g.tip.y + l1.y * A.head} L ${g.tip.x} ${g.tip.y} L ${g.tip.x + l2.x * A.head} ${g.tip.y + l2.y * A.head}`;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: 1 - x, filter: x > 0 ? `blur(${x * motion.exitBlurPx}px)` : undefined }}>
        {/* knockout halo: a solid bg stroke drawn on with the line, so the dashes never cross field glyphs */}
        <DrawPath d={g.d} progress={progress} id={`${p.id}-halo`} stroke="bg" strokeWidth={A.haloW} />
        {headOp > 0 ? <path d={head} fill="none" stroke={color.bg} strokeWidth={A.haloW} strokeLinecap="round" strokeLinejoin="round" opacity={headOp} /> : null}
        <DrawPath d={g.d} progress={progress} id={`${p.id}-ptr`} stroke={look.line} strokeWidth={A.stroke} dash={A.dash} />
        {headOp > 0 ? <path d={head} fill="none" stroke={color[look.line]} strokeWidth={A.stroke} strokeLinecap="round" strokeLinejoin="round" opacity={headOp} /> : null}
      </svg>
      <div
        style={{
          position: "absolute", left: g.label.x, top: g.label.y, width: g.label.w, height: g.label.h,
          fontFamily: font.mono, fontWeight: 500, fontSize: A.labelPx, lineHeight: `${A.labelLh}px`, color: color[look.label], whiteSpace: "pre",
          textAlign: p.base.dir === "left" ? "right" : "left",
        }}
      >
        <span
          style={{
            display: "inline-block", boxSizing: "border-box", height: A.labelLh, padding: `0 ${A.labelPadX}px`, lineHeight: `${A.labelLh - 2 * A.labelBorder}px`,
            background: color.bgRaised, border: `${A.labelBorder}px solid ${color.border}`, borderRadius: A.labelRadius,
            opacity: plateOp, filter: out.plate.filter,
          }}
        >
          {/* the text's opacity multiplies the plate's, which is 1 for the whole text fade (content-first) */}
          <span style={{ opacity: textOp, filter: out.content.filter }}>
            <ScrambleText runs={labelRuns(p)} />
          </span>
        </span>
      </div>
    </div>
  );
};

export const PointerArrow = defineComponent({ ...meta, Render });
