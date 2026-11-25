// RequestPill renderer (bible §6.6). Meta: src/v2/components-meta/RequestPill.ts.
//
// enterExit "self": the World culls the pill before its enter frame and after exit + 8 f; everything in between is
// drawn here. The flight offset is continuous (it is sampled per motion-blur sub-frame, so the tent shutter smears
// it); text, scramble glyphs and colours are discrete on `f`. The pill is opaque for the whole flight; the exit is
// content-first (plateFade, W2.1): the text and blocks fade + blur 4 f on the opaque plate, then the plate 4 f.
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { meta, REQUEST_PILL as R, requestPillWidth, type RequestPillPropsT } from "../../../src/v2/components-meta/RequestPill";
import { clampX, easeBible, flash, squash, stateMix } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { runsText, scrambleRuns, ScrambleText, type ScrambleRun } from "./scrambleMask";

interface Look {
  border: ColorToken;
  surface: ColorToken;
  text: ColorToken;
  blocks: ColorToken;
  glow: ColorToken;
}

const LOOK: Record<string, Look> = {
  neutral: { border: "borderStrong", surface: "bgRaised2", text: "text", blocks: "text", glow: "markAccent" },
  danger: { border: "danger", surface: "dangerSurface", text: "text", blocks: "danger", glow: "markDanger" },
  accent: { border: "accent", surface: "bgRaised2", text: "text", blocks: "accent", glow: "markAccent" },
  dim: { border: "border", surface: "bgRaised2", text: "textDim", blocks: "textDim", glow: "markAccent" },
};

const SCRAMBLE_F = motion.scrambleF[1];

function mixed(t: number, from: ColorToken, to: ColorToken): string {
  const clash = (from === "accent" && to === "danger") || (from === "danger" && to === "accent");
  return t >= 1 || from === to || clash ? color[to] : interpolateColors(t, [0, 1], [color[from], color[to]]);
}

/** World offset (px) of the pill from its landing spot at `frame` (continuous). 0 once landed / without an enter. */
export function flightOffset(from: RequestPillPropsT["from"], frame: number, enterF: number | null): { dx: number; dy: number } {
  if (enterF === null) return { dx: 0, dy: 0 };
  const t = Math.min(1, Math.max(0, (frame - enterF) / R.flightF));
  const d = (1 - easeBible(t)) * R.distancePx;
  switch (from) {
    case "left":
      return { dx: -d, dy: 0 };
    case "right":
      return { dx: d, dy: 0 };
    case "top":
      return { dx: 0, dy: -d };
    default:
      return { dx: 0, dy: d };
  }
}

/** Squash pivots on the edge that hits (the leading edge of the flight). */
const ORIGIN: Record<RequestPillPropsT["from"], string> = { left: "100% 50%", right: "0% 50%", top: "50% 100%", bottom: "50% 0%" };

/** The morph: change-only, class-preserving roll (motion.ts scramble via scrambleMask), rolling digits masked. */
export function pillRuns(p: Pick<RenderProps<RequestPillPropsT>, "props" | "prev" | "changeF" | "f" | "id">): ScrambleRun[] {
  const cur = p.props.text;
  const old = p.prev.text;
  if (p.changeF !== null && old !== cur && p.f < p.changeF + SCRAMBLE_F) return scrambleRuns(old, cur, p.f, p.changeF, SCRAMBLE_F, `${p.id}:text:${p.changeF}`);
  return [{ text: cur, masked: false }];
}

/** Pill width at `frame`: springs (bible ease, 8 f) from the old text/blocks width to the new one, ≤ the box. */
export function pillWidthAt(p: Pick<RenderProps<RequestPillPropsT>, "props" | "prev" | "changeF" | "frame" | "size">): number {
  const to = Math.min(p.size.w, requestPillWidth(p.props));
  if (p.changeF === null) return to;
  const from = Math.min(p.size.w, requestPillWidth(p.prev));
  const k = easeBible(interpolate(p.frame, [p.changeF, p.changeF + SCRAMBLE_F], [0, 1], clampX));
  return from + (to - from) * k;
}

const Render: React.FC<RenderProps<RequestPillPropsT>> = (p) => {
  const look = LOOK[p.state.name] ?? LOOK.neutral;
  const from = p.state.prev ? (LOOK[p.state.prev] ?? look) : look;
  const t = stateMix(p.frame, p.state.f);
  const { dx, dy } = flightOffset(p.base.from, p.frame, p.enterF);
  const landF = p.enterF === null ? undefined : p.enterF + R.flightF;
  const focusF = p.last("focus");
  // impact squash on landing, or a focus re-squash in place (whichever is latest)
  const sq = Math.min(squash(p.frame, landF), squash(p.frame, focusF));
  const fade = plateFade(p.frame, null, p.exitF);
  if (!fade.visible) return null;
  const glow = flash(p.frame, p.last("pulse"), 5);
  const { w, h } = p.size;
  const blocks = p.props.blocks;
  // the pill is centred in its (base-sized) box and springs to the width of its current text + blocks
  const runs = pillRuns(p);
  const text = runsText(runs);
  const pw = Math.max(pillWidthAt(p), Math.min(w, requestPillWidth({ text, blocks })));
  return (
    <div
      style={{
        position: "absolute", left: (w - pw) / 2, top: 0, width: pw, height: h,
        transform: `translate(${dx}px, ${dy}px)${sq !== 1 ? ` scale(${sq})` : ""}`, transformOrigin: ORIGIN[p.base.from],
      }}
    >
      <div
        style={{
          position: "absolute", left: 0, top: 0, width: pw, height: h, boxSizing: "border-box",
          borderRadius: radius.pill, border: `${R.border}px solid ${mixed(t, from.border, look.border)}`, background: mixed(t, from.surface, look.surface),
          boxShadow: glow > 0 ? `inset 0 0 ${Math.round(24 * glow)}px ${color[look.glow]}` : undefined,
          ...fade.plate,
        }}
      />
      <div style={{ position: "absolute", left: 0, top: 0, width: pw, height: h, boxSizing: "border-box", overflow: "hidden", borderRadius: radius.pill, padding: `0 ${R.padX + R.border}px`, display: "flex", alignItems: "center", gap: R.blocksGap, ...fade.content }}>
      <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: R.px, lineHeight: `${R.lh}px`, color: color[look.text], whiteSpace: "pre", fontVariantNumeric: "tabular-nums" }}><ScrambleText runs={runs} /></span>
      {blocks > 0 ? (
        <span style={{ display: "flex", gap: R.blockGap, alignItems: "center" }}>
          {Array.from({ length: blocks }, (_, i) => (
            <span key={i} style={{ display: "block", width: R.blockW, height: R.blockH, borderRadius: 2, background: color[look.blocks] }} />
          ))}
        </span>
      ) : null}
      </div>
    </div>
  );
};

export const RequestPill = defineComponent({ ...meta, Render });
