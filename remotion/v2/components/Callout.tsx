// Callout renderer (R7 N-1). Meta: src/v2/components-meta/Callout.ts.
//
// enterExit "self": the World culls the callout before its enter frame and after exit + 8 f; the dot pop (on a bg halo
// ring), the leader draw-on (evolvePath, solid 2 px textDim over a bg knockout stroke — no mask needed) and the label fade are all drawn here.
// W2.1 fix B r2: the label pill is plate-first / content-first — on enter its plate is opaque before the text shows,
// on exit the text fades + blurs on the opaque plate (plateFade timing) and the plate goes last, so field rows never
// read through the plate behind legible text. danger colours the leader and the pill border (dangerSurface plate),
// like RequestPill / SourceTag / PointerArrow. A text change masks rolling digits (never a false number on a still).
import React from "react";
import { interpolate } from "remotion";
import { CALLOUT as C, calloutGeometry, calloutPillW, meta, type CalloutGeometry, type CalloutPropsT } from "../../../src/v2/components-meta/Callout";
import { clampX, drawOn, easeBible, pulse } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { DrawPath } from "./primitives";
import { scrambleRuns, ScrambleText, type ScrambleRun } from "./scrambleMask";

const DOT: Record<string, ColorToken> = { neutral: "textDim", accent: "accent", danger: "danger", dim: "textDim" };
/** Leader stroke + pill border / surface per state (danger matches the RequestPill / SourceTag danger look). */
const PILL: Record<string, { leader: ColorToken; border: ColorToken; surface: ColorToken; text: ColorToken }> = {
  neutral: { leader: "textDim", border: "border", surface: "bgRaised", text: "text" },
  accent: { leader: "textDim", border: "border", surface: "bgRaised", text: "text" },
  danger: { leader: "danger", border: "danger", surface: "dangerSurface", text: "text" },
  dim: { leader: "textDim", border: "border", surface: "bgRaised", text: "textDim" },
};
const SCRAMBLE_F = motion.scrambleF[1];

function labelRuns(p: RenderProps<CalloutPropsT>): ScrambleRun[] {
  const cur = p.props.text;
  const old = p.prev.text;
  if (p.changeF !== null && old !== cur && p.f < p.changeF + SCRAMBLE_F) return scrambleRuns(old, cur, p.f, p.changeF, SCRAMBLE_F, `${p.id}:text:${p.changeF}`);
  return [{ text: cur, masked: false }];
}

const ramp = (frame: number, a: number, d: number) => interpolate(frame, [a, a + d], [0, 1], clampX);

/**
 * Entrance / exit progress of the parts (1 = fully shown). `plate` / `text` = the label pill's plate and its text:
 * the plate leads on enter (opaque at half the label fade, then the text), and on exit plateFade's content-first
 * timing holds the plate at 1 while the text fades (exit 0–4), then fades the plate (4–8). `label` = `plate`.
 * The leader retracts 3–7 and the dot shrinks 5–8. Pure; exported for the tests.
 */
export function calloutParts(frame: number, enterF: number | null, exitF: number | null, redrawF: number | undefined) {
  let dot = enterF === null ? 1 : easeBible(ramp(frame, enterF, C.dotF));
  let line = enterF === null ? 1 : drawOn(frame, enterF + C.lineDelayF, C.lineF);
  const labelIn = enterF === null ? 1 : ramp(frame, enterF + C.labelDelayF, C.labelF);
  const out = plateFade(frame, null, exitF);
  const plate = Math.min(1, 2 * labelIn) * out.plate.opacity;
  const text = Math.max(0, 2 * labelIn - 1) * out.content.opacity;
  let redraw = false;
  if (redrawF !== undefined && (enterF === null || redrawF > enterF)) {
    const r = drawOn(frame, redrawF, C.lineF);
    redraw = line >= 1 && r < 1;
    line = Math.min(line, r);
  }
  if (exitF !== null && frame >= exitF) {
    // reverse in 8 f: label text 0–4 then its plate 4–8 (plateFade), leader 3–7, dot 5–8
    line = Math.min(line, 1 - easeBible(ramp(frame, exitF + 3, 4)));
    dot = Math.min(dot, 1 - easeBible(ramp(frame, exitF + 5, 3)));
  }
  return { dot, line, label: plate, plate, text, plateFilter: out.plate.filter, textFilter: out.content.filter, redraw: redraw && (exitF === null || frame < exitF) };
}

/**
 * The label pill at `frame`: sized from the CURRENT text (springing from the old width over the scramble, never
 * wider than the box's base pill) and anchored on the leader end, so the leader always ends on the pill edge.
 */
export function calloutPill(p: Pick<RenderProps<CalloutPropsT>, "base" | "props" | "prev" | "changeF" | "frame">, g: CalloutGeometry = calloutGeometry(p.base)) {
  const maxW = g.pill.w;
  const to = Math.min(maxW, calloutPillW(p.props.text));
  const from = Math.min(maxW, calloutPillW(p.prev.text));
  const k = p.changeF === null ? 1 : easeBible(interpolate(p.frame, [p.changeF, p.changeF + SCRAMBLE_F], [0, 1], clampX));
  const w = from + (to - from) * k;
  const end = g.points[g.points.length - 1];
  // the leader meets the pill's near edge: left edge for labels right of the dot, right edge for labels left of it
  const leftOfDot = end.x < g.dot.x;
  return { x: leftOfDot ? end.x - w : end.x, y: g.pill.y, w, h: g.pill.h };
}

const Render: React.FC<RenderProps<CalloutPropsT>> = (p) => {
  const g = calloutGeometry(p.base);
  const pill = calloutPill(p, g);
  const tone = DOT[p.state.name] ?? DOT.neutral;
  const look = PILL[p.state.name] ?? PILL.neutral;
  const parts = calloutParts(p.frame, p.enterF, p.exitF, p.last("drawOn"));
  const settled = p.enterF === null ? 0 : p.enterF + C.dotF;
  const dotOp = p.state.name === "danger" && p.frame >= settled ? pulse(p.frame, settled) : 1;
  const ringF = p.last("pulse");
  const ringT = ringF === undefined ? 1 : Math.min(1, Math.max(0, (p.frame - ringF) / 12));
  const d = g.points.map((q, i) => `${i ? "L" : "M"} ${q.x} ${q.y}`).join(" ");
  const { w, h } = p.size;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0 }}>
        {/* a redraw keeps a faint copy of the settled leader, so the label is never visibly cut off from its dot */}
        {/* bg knockout under the leader (with the settled copy during a redraw), so the line never runs through glyphs */}
        {parts.redraw ? <path d={d} fill="none" stroke={color.bg} strokeWidth={C.knockW} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {parts.redraw ? <path d={d} fill="none" stroke={color.border} strokeWidth={C.line} /> : null}
        {!parts.redraw ? <DrawPath d={d} progress={parts.line} id={`${p.id}-knock`} stroke="bg" strokeWidth={C.knockW} /> : null}
        <DrawPath d={d} progress={parts.line} id={`${p.id}-leader`} stroke={look.leader} strokeWidth={C.line} />
        {ringT < 1 ? <circle cx={g.dot.x} cy={g.dot.y} r={C.dot / 2 + (C.ringR - C.dot / 2) * easeBible(ringT)} fill="none" stroke={color[tone]} strokeWidth={2} opacity={0.6 * (1 - ringT) * parts.dot} /> : null}
        {parts.dot > 0 ? <circle cx={g.dot.x} cy={g.dot.y} r={(C.dot / 2 + C.dotHalo) * parts.dot} fill={color.bg} /> : null}
        {parts.dot > 0 ? <circle cx={g.dot.x} cy={g.dot.y} r={(C.dot / 2) * parts.dot} fill={color[tone]} opacity={dotOp} /> : null}
      </svg>
      {parts.plate > 0 ? (
        <div
          style={{
            position: "absolute", left: pill.x, top: pill.y, width: pill.w, height: pill.h, boxSizing: "border-box", opacity: parts.plate, filter: parts.plateFilter,
            borderRadius: radius.pill, border: `${C.border}px solid ${color[look.border]}`, background: color[look.surface],
          }}
        />
      ) : null}
      {parts.plate > 0 ? (
        <div
          style={{
            position: "absolute", left: pill.x, top: pill.y, width: pill.w, height: pill.h, boxSizing: "border-box", opacity: parts.text, filter: parts.textFilter,
            borderRadius: radius.pill, padding: `0 ${C.padX + C.border}px`, display: "flex", alignItems: "center", overflow: "hidden", whiteSpace: "pre",
            fontFamily: font.mono, fontWeight: 500, fontSize: C.px, lineHeight: `${C.lh}px`, color: color[look.text], fontVariantNumeric: "tabular-nums",
          }}
        >
          <ScrambleText runs={labelRuns(p)} />
        </div>
      ) : null}
    </div>
  );
};

export const Callout = defineComponent({ ...meta, Render });
