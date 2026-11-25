// Meter renderer (R7 N-6). Meta: src/v2/components-meta/Meter.ts.
//
// Row: label (mono 500 28, textDim → danger when full) left, value (mono 500 28 tabular, text → danger) right.
// Track: bgRaised2, 24 px, radius.pill; fill in the tone colour (neutral text / accent / danger / dim textDim).
// Limit: 2 px textDim tick from 6 px above to 6 px below the track + mono 400 26 textDim label under it.
// Fill level = a chain of 12 f bible-bezier tweens, one per countUp / state action (countUp always starts from 0;
// state targets: ok → value, full → 1, empty → 0). W5.1: numeric valueLabel + limitLabel ("2GB" / "limit 4GB") derive
// the fill (meta derivedFill) in every state, full included, so the bar never contradicts its own numbers. The % number reads the level on the floored frame (no ghosting).
// Full (state, or level ≥ limit < 1) → danger fill pulsing 0.7↔1 / 20 f. Colours snap (no lime → red fade).
// Plate (W2 fix, round 2): the whole footprint is a raised card (bgRaised, 1 px border, radius.box — like the other
// plated cards, so its edge reads as a surface, not a mask seam cutting field glyphs) and the content sits
// METER.platePad inside it, so the data field never shows through under the texts. A limit tick that falls under the
// value text pushes the value left so it ends ≥ METER.tickClear px before the tick.
// enterExit "self" (plateFade, W2.1): the plate is opaque before the label/track/value appear, and on exit they fade +
// blur first on the still-opaque plate, so field rows never read through behind the track. Scrambles are
// class-preserving and change-only.
import React from "react";
import { interpolate } from "remotion";
import { derivedFill, meta, METER, type MeterPropsT } from "../../../src/v2/components-meta/Meter";
import { clampX, easeBible, flash, pulse, scramble } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";

const FILL: Record<string, ColorToken> = { neutral: "text", accent: "accent", danger: "danger", dim: "textDim" };

interface Seg {
  f: number;
  from: number;
  to: number;
}

const evalSeg = (s: Seg, frame: number) => s.from + (s.to - s.from) * easeBible(interpolate(frame, [s.f, s.f + METER.tweenF], [0, 1], clampX));

/** Fill level 0..1 at `frame` (pure; exported for tests). */
export function meterLevel(p: RenderProps<MeterPropsT>, frame: number): number {
  const hasCount = p.events.some((e) => e.do === "countUp");
  // W5.1: numeric labels decide the fill (derivedFill); `value` only when they are not comparable numbers
  const labels = { valueLabel: p.base.valueLabel, limitLabel: p.base.limitLabel, limit: p.base.limit };
  let value = derivedFill(labels) ?? p.base.value;
  let state = "ok";
  const target = () => (state === "empty" ? 0 : state === "full" ? (derivedFill(labels) ?? 1) : value);
  let seg: Seg = { f: 0, from: hasCount ? 0 : value, to: hasCount ? 0 : value };
  for (const e of p.events) {
    if (e.f > frame) break;
    if (e.do !== "countUp" && e.do !== "state") continue;
    if (e.do === "state") {
      const v = e.props?.value;
      if (typeof e.props?.valueLabel === "string") labels.valueLabel = e.props.valueLabel;
      if (typeof e.props?.limitLabel === "string") labels.limitLabel = e.props.limitLabel;
      if (typeof v === "number" && v >= 0 && v <= 1) value = v;
      value = derivedFill(labels) ?? value;
      if (e.state && meta.states.includes(e.state)) state = e.state;
    }
    seg = { f: e.f, from: e.do === "countUp" ? 0 : evalSeg(seg, e.f), to: target() };
  }
  return Math.max(0, Math.min(1, evalSeg(seg, frame)));
}

function swap(p: RenderProps<MeterPropsT>, cur: string, old: string, at: number | null, key: string): string {
  if (at !== null && cur !== old && p.f < at + METER.scrambleF) return scramble(old, cur, p.f, at, METER.scrambleF, `${p.id}:${key}:${at}`, { changedOnly: true });
  return cur;
}

const Render: React.FC<RenderProps<MeterPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const pad = METER.platePad;
  const w = p.size.w - 2 * pad;
  const level = meterLevel(p, p.frame);
  const levelF = meterLevel(p, p.f);
  const full = p.state.name === "full" || (p.props.limit < 1 && levelF >= p.props.limit - 1e-9);
  const fullFrom = p.state.name === "full" && p.state.f !== null ? p.state.f + METER.tweenF : 0;
  const fillOpacity = full && p.frame >= fullFrom ? pulse(p.frame, fullFrom) : 1;
  const tone: ColorToken = full ? "danger" : (FILL[p.props.tone] ?? "text");
  const glow = flash(p.frame, p.last("pulse"), 5);
  // texts: label (→ fullLabel in the full state), value (% of the floored level, or valueLabel)
  const stF = p.state.f;
  const inFull = p.state.name === "full" && p.props.fullLabel !== undefined;
  const wasFull = p.state.prev === "full" && p.props.fullLabel !== undefined;
  let label = p.props.label;
  if (inFull) label = swap(p, p.props.fullLabel!, p.prev.label, stF, "full");
  else if (wasFull) label = swap(p, p.props.label, p.props.fullLabel!, stF, "unfull");
  else label = swap(p, p.props.label, p.prev.label, p.changeF, "label");
  const value = p.props.valueLabel !== undefined ? swap(p, p.props.valueLabel, p.prev.valueLabel ?? p.props.valueLabel, p.changeF, "value") : `${Math.round(levelF * 100)}%`;
  const limitLabel = p.base.limitLabel !== undefined ? swap(p, p.props.limitLabel ?? "", p.prev.limitLabel ?? "", p.changeF, "limit") : undefined;
  const trackY = METER.rowH + METER.rowGap;
  const limitX = Math.round(p.props.limit * w);
  const mono = (px: number, weight: number, token: ColorToken): React.CSSProperties => ({
    fontFamily: font.mono, fontWeight: weight, fontSize: px, color: color[token], whiteSpace: "pre", fontVariantNumeric: "tabular-nums",
  });
  const showTick = p.base.limitLabel !== undefined || p.props.limit < 1;
  // keep the value clear of a limit tick that falls under it (limit 1 → the tick sits at the right edge)
  const tickL = Math.min(w - METER.tickW, Math.max(0, limitX - METER.tickW / 2));
  const valueW = value.length * METER.labelPx * 0.6;
  const valueRight = showTick && tickL + METER.tickW + METER.tickClear > w - valueW - METER.tickClear ? Math.max(0, w - tickL + METER.tickClear) : 0;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: p.size.w, height: p.size.h, ...fade.group }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: p.size.w, height: p.size.h, boxSizing: "border-box", borderRadius: radius.box, background: color.bgRaised, border: `1px solid ${color.border}`, ...fade.plate }} />
    <div style={{ position: "absolute", left: pad, top: pad, width: w, height: p.size.h - 2 * pad, ...fade.content }}>
      <div style={{ position: "absolute", left: 0, right: valueRight, top: 0, height: METER.rowH, lineHeight: `${METER.rowH}px`, display: "flex", justifyContent: "space-between", gap: METER.gapLR }}>
        <span style={mono(METER.labelPx, 500, full ? "danger" : "textDim")}>{label}</span>
        <span style={mono(METER.labelPx, 500, full ? "danger" : "text")}>{value}</span>
      </div>
      <div style={{ position: "absolute", left: 0, top: trackY, width: w, height: METER.trackH, borderRadius: radius.pill, background: color.bgRaised2, overflow: "hidden" }}>
        {level > 0.0005 ? (
          <div
            style={{
              position: "absolute", left: 0, top: 0, width: level * w, height: METER.trackH, borderRadius: radius.pill, background: color[tone], opacity: fillOpacity,
              boxShadow: glow > 0 ? `inset 0 0 ${Math.round(16 * glow)}px ${color.text}` : undefined,
            }}
          />
        ) : null}
      </div>
      {showTick ? (
        <div style={{ position: "absolute", left: tickL, top: trackY - METER.tickOver, width: METER.tickW, height: METER.trackH + 2 * METER.tickOver, background: color.textDim }} />
      ) : null}
      {limitLabel !== undefined ? (
        <div
          style={{
            position: "absolute", top: trackY + METER.trackH + METER.tickOver + METER.limitGap, height: METER.limitRowH, lineHeight: `${METER.limitRowH}px`,
            ...(p.props.limit > 0.5 ? { right: Math.max(0, w - limitX) } : { left: limitX }), ...mono(METER.limitPx, 400, "textDim"),
          }}
        >
          {limitLabel}
        </div>
      ) : null}
    </div>
    </div>
  );
};

export const Meter = defineComponent({ ...meta, Render });
