// Timeline renderer (bible §6.4 + R7 N-15 ClockAxis scale). Meta: src/v2/components-meta/Timeline.ts.
//
// Opaque bgRaised plate (radius.card, 2 px borderStrong). Top row: bar label (tone colour) left, lime pill (accent /
// accentInk, radius.pill, mono 500 30) right-aligned to the bar end (or to the inner edge when that would crowd the
// label); ≥ 12 px between the pill and the cursor hairline below it. Bar: 20 px, radius 10, tone colour, centred ON
// the axis line (one track; event dots at its ends are its caps); grows on drawOn over 16 f with the bible bezier
// (empty before the first drawOn when the instance has one; full otherwise). With a clock bracket the plate reserves
// the bracket row from the first frame (W2.1 r2: no mid-life height jump; bottom padding = top padding = padY).
// enterExit "self" (plateFade): plate opaque before the content; on exit the content fades first.
// Axis: 2 px borderStrong line, ticks to just under the bar, mono 400 26 textDim labels, each centred on its tick (clock: the unit is a
// separate textDim label after the last tick). Clock scale: duration bracket (2 px textDim strokes, drawn with the
// bar), cursor hairline (2 px, textDim until the accent state, then accent), event dots (16 px, all the same size, 3 px
// bgRaised ring) that pop 0.4 → 1 over 4 f once the bar front reaches them. Danger bars pulse 0.7↔1 / 20 f once grown.
// Colours snap on a state change (no lime → red fade). A resolve to accent recolours bar, cursor and pill only: the
// label (the failure's name) turns white, and marks keep their own tones.
import React from "react";
import { interpolate } from "remotion";
import { axisUnit, hasBracket, meta, pillWidth, TIMELINE, tickLabels, timelineLayout, type TimelineLayout, type TimelinePropsT } from "../../../src/v2/components-meta/Timeline";
import { clampX, drawOn, easeBible, enterProgress, flash, pulse, scramble } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { DrawPath } from "./primitives";

const TONE: Record<string, ColorToken> = { danger: "danger", accent: "accent", neutral: "text", dim: "textDim" };
const GLOW: Record<string, ColorToken> = { danger: "markDanger", accent: "markAccent", neutral: "borderStrong", dim: "border" };
const SCR = 8;

/** 0..1 bar growth: 0 before the first drawOn (if any), then the latest drawOn over 16 f; 1 without drawOn. */
export function barProgress(p: RenderProps<TimelinePropsT>): number {
  const draws = p.events.filter((e) => e.do === "drawOn");
  if (!draws.length) return 1;
  const ld = p.last("drawOn");
  return ld === undefined ? 0 : drawOn(p.frame, ld, TIMELINE.drawF);
}

/** A numeric prop that eases from prev → props over 12 f after an override (at `frame`, default the current one). */
function moved(p: RenderProps<TimelinePropsT>, cur: number, old: number, frame: number = p.frame): number {
  if (p.changeF === null || cur === old) return cur;
  const t = easeBible(interpolate(frame, [p.changeF, p.changeF + TIMELINE.moveF], [0, 1], clampX));
  return old + (cur - old) * t;
}

/** x of the bar front at integer frame g (same maths as the render, evaluated at g). */
function frontAt(p: RenderProps<TimelinePropsT>, L: TimelineLayout, g: number): number {
  const n = p.props.ticks.length;
  const ld = p.events.filter((e) => e.do === "drawOn" && e.f <= g).reduce<number | undefined>((a, e) => (a === undefined || e.f > a ? e.f : a), undefined);
  const prog = ld === undefined ? 0 : drawOn(g, ld, TIMELINE.drawF);
  const xa = L.x(p.props.from);
  return xa + (L.x(moved(p, p.props.to ?? n - 1, p.prev.to ?? n - 1, g)) - xa) * prog;
}

/** 0..1 scale of the event dot at x `mx`: pops 0.4 → 1 over 4 f from the first frame the bar front reaches it. */
export function markScale(p: RenderProps<TimelinePropsT>, L: TimelineLayout, mx: number): number {
  const first = p.events.find((e) => e.do === "drawOn");
  if (!first) return 1;
  for (let g = first.f; g <= p.f; g++) {
    if (frontAt(p, L, g) >= mx - 0.5) return interpolate(p.frame, [g, g + TIMELINE.markPopF], [0.4, 1], { ...clampX, easing: easeBible });
  }
  return 0;
}

function text(p: RenderProps<TimelinePropsT>, key: "label" | "pill" | "duration"): string {
  const cur = p.props[key] ?? "";
  const old = p.prev[key] ?? "";
  if (p.changeF !== null && old !== cur && p.f < p.changeF + SCR) return scramble(old, cur, p.f, p.changeF, SCR, `${p.id}:${key}:${p.changeF}`, { changedOnly: true });
  return cur;
}

const Render: React.FC<RenderProps<TimelinePropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const { w, h } = p.size;
  const L = timelineLayout(p.base, w);
  const n = p.props.ticks.length;
  const tone = TONE[p.state.name] ?? "danger";
  const prog = barProgress(p);
  const to = moved(p, p.props.to ?? n - 1, p.prev.to ?? n - 1);
  const xa = L.x(p.props.from);
  const xEnd = L.x(to);
  const front = xa + (xEnd - xa) * prog;
  const ld = p.last("drawOn");
  const hasDraw = p.events.some((e) => e.do === "drawOn");
  const grownAt = hasDraw ? (ld === undefined ? Number.POSITIVE_INFINITY : ld + TIMELINE.drawF) : (p.enterF ?? 0);
  const settle = Math.max(grownAt, p.state.f === null ? 0 : p.state.f + SCR);
  const barOpacity = p.state.name === "danger" && p.frame >= settle ? pulse(p.frame, settle) : 1;
  const glow = flash(p.frame, p.last("pulse"), 5);
  const kick = flash(p.frame, p.last("focus"), 4);
  const labels = tickLabels(p.props);
  const unit = axisUnit(p.props);
  const lastLabelW = labels[labels.length - 1].length * TIMELINE.tickPx * 0.6;
  // the failure's name never reads in the success colour: white once an instance that started elsewhere resolves to accent
  const labelTone: ColorToken = p.state.name === "accent" && p.base.tone !== "accent" ? "text" : tone;
  // pill: drops in (y −24 → 0, spring) 4 f after the bar lands; right edge on the bar end, never over the label
  const pillText = p.base.pill ? text(p, "pill") : "";
  const pillW = p.base.pill ? pillWidth(p.props.pill ?? p.base.pill) : 0;
  const labelRight = TIMELINE.padX + (p.base.label ? (p.props.label ?? "").length * TIMELINE.labelPx * 0.6 : 0);
  // at the bar end when there is room; when the bar end would crowd the pill against the label, it right-aligns to the
  // card's inner edge instead (W2.1: never jammed 24 px after the label)
  const pillMax = L.innerW - TIMELINE.padX - pillW;
  // (mode decided on the target bar end, so a moving `to` never flips the pill between the two anchors mid-tween)
  const atBarEnd = L.x(p.props.to ?? n - 1) - pillW >= labelRight + TIMELINE.pillGap;
  const pillLeft = atBarEnd ? Math.min(pillMax, Math.max(labelRight + TIMELINE.pillGap, xEnd - pillW)) : pillMax;
  // without a drawOn the pill is simply part of the card (the slot's entrance animates it)
  const pe = !hasDraw ? 1 : ld === undefined ? 0 : enterProgress(p.frame, ld + TIMELINE.drawF + TIMELINE.pillDelayF);
  // clock cursor
  const cursorOld = p.prev.cursor;
  const cursorCur = p.props.cursor;
  const cursorX = cursorCur === undefined ? null : L.x(cursorOld === undefined ? cursorCur : moved(p, cursorCur, cursorOld));
  const cursorOpacity = cursorCur === undefined ? 0 : cursorOld === undefined && p.changeF !== null ? interpolate(p.frame, [p.changeF, p.changeF + 6], [0, 1], clampX) : 1;
  // bracket under the bar span (clock)
  const bracket = hasBracket(p.base);
  const durText = bracket ? text(p, "duration") : "";
  const durW = (p.props.duration ?? "").length * TIMELINE.tickPx * 0.6;
  const bx1 = xa;
  const bx2 = L.x(p.props.to ?? n - 1);
  const bcx = Math.min(L.innerW - TIMELINE.padX - durW / 2, Math.max(TIMELINE.padX + durW / 2, (bx1 + bx2) / 2));
  const bMid = L.bracketY + TIMELINE.bracketH / 2;
  const bTop = L.bracketY + 4;
  const gapL = Math.max(bx1, bcx - durW / 2 - 12);
  const gapR = Math.min(bx2, bcx + durW / 2 + 12);
  // W2.1 r2: the bracket row is reserved from the first frame (the footprint already holds it), so the plate never
  // grows mid-life and the bottom padding under the bracket stays padY (= the top padding) while it draws.
  const plateH = h;
  const bracketD = `M ${bx1} ${bTop} L ${bx1} ${bMid} L ${gapL} ${bMid} M ${gapR} ${bMid} L ${bx2} ${bMid} L ${bx2} ${bTop}`;
  const mono = (px: number, weight: number, token: ColorToken): React.CSSProperties => ({
    fontFamily: font.mono, fontWeight: weight, fontSize: px, color: color[token], whiteSpace: "pre", fontVariantNumeric: "tabular-nums",
  });
  const svgH = h - 2 * TIMELINE.border;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
        <div
          style={{
            position: "absolute", left: 0, top: 0, width: w, height: plateH, boxSizing: "border-box", borderRadius: radius.card,
            border: `${TIMELINE.border}px solid ${color.borderStrong}`, background: color.bgRaised, ...fade.plate,
          }}
        />
        <div style={{ position: "absolute", left: TIMELINE.border, top: TIMELINE.border, width: L.innerW, height: svgH, ...fade.content }}>
          {p.base.label ? (
            <div style={{ position: "absolute", left: TIMELINE.padX, top: L.topY, height: TIMELINE.topRowH, lineHeight: `${TIMELINE.topRowH}px`, ...mono(TIMELINE.labelPx, 500, labelTone) }}>{text(p, "label")}</div>
          ) : null}
          {p.base.pill && pe > 0.001 ? (
            <div
              style={{
                position: "absolute", left: pillLeft, top: L.topY, width: pillW, height: TIMELINE.topRowH, boxSizing: "border-box", borderRadius: radius.pill,
                background: color.accent, border: `1px solid ${color.accent}`, display: "flex", alignItems: "center", justifyContent: "center",
                opacity: pe, transform: `translateY(${-24 * (1 - pe)}px)`, ...mono(TIMELINE.pillPx, 500, "accentInk"),
              }}
            >
              {pillText}
            </div>
          ) : null}
          <svg width={L.innerW} height={svgH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <line x1={L.x0} x2={L.x1} y1={L.axisY + 1} y2={L.axisY + 1} stroke={color.borderStrong} strokeWidth={TIMELINE.axisPx} />
            {labels.map((_, i) => (
              <line key={i} x1={L.x(i)} x2={L.x(i)} y1={L.axisY} y2={L.tickY2} stroke={color.borderStrong} strokeWidth={2} />
            ))}
            {bracket ? <DrawPath d={bracketD} progress={prog} id={`${p.id}:bracket`} stroke="textDim" strokeWidth={2} /> : null}
          </svg>
          {front - xa > 0.5 ? (
            <div
              style={{
                position: "absolute", left: xa, top: L.barY, width: front - xa, height: TIMELINE.barH, borderRadius: TIMELINE.barH / 2, background: color[tone], opacity: barOpacity,
                boxShadow: glow > 0 ? `0 0 ${Math.round(18 * glow)}px ${color[GLOW[p.state.name] ?? "markDanger"]}` : undefined,
              }}
            />
          ) : null}
          <svg width={L.innerW} height={svgH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {cursorX !== null && cursorOpacity > 0 ? (
              <line data-cursor="1" x1={cursorX} x2={cursorX} y1={L.barY - TIMELINE.cursorOver} y2={L.tickY2} stroke={color[p.state.name === "accent" ? "accent" : "textDim"]} strokeWidth={2} opacity={cursorOpacity} />
            ) : null}
            {p.props.marks.map((m, i) => {
              const mx = L.x(m.at);
              const inBar = mx >= xa - 0.5 && mx <= xEnd + 0.5;
              const s = !inBar || !hasDraw ? 1 : markScale(p, L, mx);
              // r = fill radius + half the ring, so the visible dot is markPx wide at s = 1 for every tone
              return s > 0 ? <circle key={`m${i}`} cx={mx} cy={L.axisY + 1} r={(TIMELINE.markPx / 2 + TIMELINE.markRing / 2) * s} fill={color[TONE[m.tone] ?? "text"]} stroke={color.bgRaised} strokeWidth={TIMELINE.markRing * s} /> : null;
            })}
          </svg>
          {labels.map((l, i) => (
            <div key={`t${i}`} style={{ position: "absolute", left: L.x(i) - 200, width: 400, top: L.tickLabelY, height: TIMELINE.tickRowH, lineHeight: `${TIMELINE.tickRowH}px`, textAlign: "center", ...mono(TIMELINE.tickPx, 400, "textDim") }}>
              {l}
            </div>
          ))}
          {unit !== null ? (
            <div style={{ position: "absolute", left: L.x(labels.length - 1) + lastLabelW / 2 + TIMELINE.unitGap, top: L.tickLabelY, height: TIMELINE.tickRowH, lineHeight: `${TIMELINE.tickRowH}px`, ...mono(TIMELINE.tickPx, 400, "textDim") }}>
              {unit}
            </div>
          ) : null}
          {bracket ? (
            <div style={{ position: "absolute", left: bcx - 200, width: 400, top: L.bracketY, height: TIMELINE.bracketH, lineHeight: `${TIMELINE.bracketH}px`, textAlign: "center", opacity: Math.max(0, Math.min(1, (prog - 0.6) / 0.4)), ...mono(TIMELINE.tickPx, 400, "text") }}>
              {durText}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const Timeline = defineComponent({ ...meta, Render });
