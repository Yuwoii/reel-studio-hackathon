// KineticWord renderer (bible §6.13). Meta: src/v2/components-meta/KineticWord.ts. enterExit "self".
//
// Opaque bgRaised plate (radius.card, 1 px borderStrong edge) hugging the MEASURED wrapped text (centred, equal
// padding both sides); Inter 700 at the layout size
// (≤ 112 px), white, the accent word in accent (or danger). plateFade (W2.1): the plate is opaque before any word
// shows; words rise in 3 f apart from contentDelayF after the entrance (shared spring, y 24 → 0, opacity), the accent
// word last with a 1 → 1.04 kick as it lands. Exit: the words fade + blur 4 f on the opaque plate, then the plate 4 f.
// Glitch (W2.1 r2): content-only danger / accent copies clipped inside the plate; the plate is never copied or tinted.
import React from "react";
import { accentIndex, KINETIC, kineticLayout, meta, words, type KineticWordPropsT } from "../../../src/v2/components-meta/KineticWord";
import { activeGlitch, flash, stagger, staggerEnter } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { PLATE_FADE, plateFade } from "./plateFade";
import { Glitch } from "./primitives";

const HIGHLIGHT: Record<string, ColorToken> = { accent: "accent", danger: "danger", neutral: "text", dim: "textDim" };

/** Entrance rank of word i: every other word in reading order, the accent word last. */
export function wordRank(i: number, accent: number): number {
  if (i === accent) return Number.MAX_SAFE_INTEGER;
  return i < accent ? i : i - 1;
}

const Render: React.FC<RenderProps<KineticWordPropsT>> = (p) => {
  const { w, h } = p.size;
  const ws = words(p.props.text);
  const L = kineticLayout(p.props.text, w);
  const acc = accentIndex(p.props);
  const accRank = ws.length - 1;
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  // words start once the plate is opaque (plateFade's content delay)
  const wordsF = p.enterF === null ? null : p.enterF + PLATE_FADE.contentDelayF;
  const land = wordsF === null ? undefined : stagger(accRank, wordsF, KINETIC.staggerF) + 8;
  const kick = Math.max(flash(p.frame, land, KINETIC.kickF), flash(p.frame, p.last("focus"), 4));
  const glitches = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  const word = (i: number) => {
    const rank = Math.min(wordRank(i, acc), accRank);
    const e = staggerEnter(p.frame, wordsF, rank, KINETIC.staggerF);
    const isAcc = i === acc;
    const token: ColorToken = isAcc ? (HIGHLIGHT[p.props.tone] ?? "accent") : "text";
    const s = isAcc && kick > 0 ? 1 + 0.04 * kick : 1;
    return (
      <span
        key={i}
        style={{
          display: "inline-block", color: color[token], opacity: e,
          transform: `translateY(${(1 - e) * motion.enterY}px)${s !== 1 ? ` scale(${s})` : ""}`, transformOrigin: "50% 60%",
        }}
      >
        {ws[i]}
      </span>
    );
  };
  // The plate hugs the MEASURED text (W2.1 r2): a flex item whose width is the browser's max-content of the pre-wrapped
  // lines + 2 × (padX + border), centred in the footprint (the footprint's estimate stays conservative). Same padding
  // left and right; the wrap itself is still kineticLayout's (lines are white-space: pre, so nothing re-wraps).
  const plate = (
    <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, boxSizing: "border-box", borderRadius: radius.card, border: `${KINETIC.border}px solid ${color.borderStrong}`, background: color.bgRaised, ...fade.plate }} />
  );
  const content = (
    <div style={{ boxSizing: "border-box", height: h, padding: `${KINETIC.padY + KINETIC.border}px ${KINETIC.padX + KINETIC.border}px`, ...fade.content }}>
      {L.lines.map((line, li) => (
        <div key={li} style={{ height: L.lineH, lineHeight: `${L.lineH}px`, fontFamily: font.sans, fontWeight: KINETIC.weight, fontSize: L.px, letterSpacing: `${KINETIC.trackEm}em`, whiteSpace: "pre" }}>
          {line.map((i, k) => (
            <React.Fragment key={i}>
              {k > 0 ? " " : null}
              {word(i)}
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, display: "flex", justifyContent: "center", ...fade.group }}>
      <div data-kinetic-plate="1" style={{ position: "relative", height: h, minWidth: Math.min(KINETIC.minW, w), maxWidth: w, flex: "0 0 auto" }}>
        <Glitch frame={p.frame} at={activeGlitch(glitches, p.frame)} seed={`${p.id}:glitch`} clip={{ r: radius.card, inset: KINETIC.border }} plate={plate}>
          {content}
        </Glitch>
      </div>
    </div>
  );
};

export const KineticWord = defineComponent({ ...meta, Render });
