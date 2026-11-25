// Screen-fixed subtitle card (amendments §5, D1 #8).
//
// - One display phrase (≤5 words, one line) at a time, from resolveTimeline().displayPhrases.
// - Active-word tracking (W7.3): upcoming words textUpcoming (45 %), spoken words textSpoken (80 %), the word being
//   spoken full WHITE and bold (a 1.1 px white stroke: heavier ink without changing the line's width, so the phrase
//   never reflows). Colour is reserved for the ONE semantic keyword per beat in keywordColor: upcoming it looks like
//   any upcoming word; from its onset on it keeps keywordColor (bold while it is the active word). So a caption never
//   shows two coloured words at once (W7.2 pilots: a lime active word next to the lime keyword). style "keyword" =
//   bible-strict variant without the active-word emphasis.
// - Swap: a same-frame hard hand-off. On the swap frame the new phrase is fully in and the old phrase is gone (no
//   ghost). W2 history: round 1 had a 0.3 / −4 px out-fade, then a one-frame 0.1 / −8 px ghost — still legible at 1×
//   in the f442 still (the ghost kept its lime keyword, so "healthy" stood out over "Exit codes above 128 mean").
//   So no frame ever shows two phrases on top of each other, and the box is never empty. Width snaps on grow; on
//   shrink it springs (d200) from the swap frame. swapState() is the pure, unit-tested schedule.
// - Box: radius.box, captionBg + 1 px border + backdrop blur 12 px, padding 28×36, max width 886, bottom-left at
//   x 64, bottom edge y 1520 (40 px above the hairline). Exported footprint: captionCardBox() (L3: never over focal).
import React from "react";
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import type { DisplayPhrase, Timeline, TimelineWord } from "../../../src/v2/timeline";
import { measureText } from "../fonts";
import { caption as cap, color, font, FPS, layout, radius, type } from "../theme";

const LINE_H = type.caption.size * type.caption.lineHeight; // 57.5
/** Card height: one line + vertical padding (box-sizing border-box, 1 px border inside the padding). */
export const CAPTION_CARD_H = Math.ceil(LINE_H + 2 * layout.caption.padY); // 114 → top y = 1406
export const CAPTION_CARD_TOP = layout.caption.bottom - CAPTION_CARD_H;
const CSS_FONT = `${type.caption.weight} ${type.caption.size}px Inter`;
/** Hold a phrase-final word "active" this many frames past its end (no next word to hand over to). */
const LAST_WORD_HOLD_F = 4;

export type CaptionStyle = "activeWordKeyword" | "keyword";

/** Card footprint in screen px for a phrase text width (L3: focal elements must stay clear of it). */
export function captionCardBox(textWidthPx: number): { x: number; y: number; w: number; h: number } {
  const w = Math.min(layout.caption.maxW, Math.ceil(textWidthPx) + 2 * layout.caption.padX + 2 + 6);
  return { x: layout.caption.left, y: CAPTION_CARD_TOP, w, h: CAPTION_CARD_H };
}

function phraseWidth(d: DisplayPhrase, ready: boolean): number {
  return (ready ? measureText(d.text, CSS_FONT) : null) ?? d.widthPx;
}

/** Index of the display phrase on screen at frame f (the first one from frame 0). */
export function phraseIndexAt(phrases: readonly DisplayPhrase[], f: number): number {
  let cur = 0;
  for (let i = 1; i < phrases.length; i++) if (f >= phrases[i].showF) cur = i;
  return cur;
}

/** Old-phrase ghost per swap frame k (opacity, y offset px); gone from k = OUT_GHOST.length on. Empty since W2
 *  round 2: the swap is a clean same-frame hand-off (amendments §5). Any entry must be drawn in one neutral tone. */
export const OUT_GHOST: readonly { opacity: number; dy: number }[] = [];
/** An overlapping phrase at or below this opacity reads as a ghost, not as text (swap invariant, tested). Kept well
 *  under the upcoming-word level (textUpcoming = 45 % white): the new phrase is mostly upcoming words on the swap. */
export const GHOST_MAX_OPACITY = 0.12;

/** Swap schedule at k = frames since the new phrase's showF (pure; unit-tested). */
export function swapState(k: number, hasPrev: boolean): { inO: number; outO: number; outDy: number; widthHold: boolean } {
  if (!hasPrev || k < 0) return { inO: 1, outO: 0, outDy: 0, widthHold: false };
  const g = OUT_GHOST[k];
  return g ? { inO: 1, outO: g.opacity, outDy: g.dy, widthHold: true } : { inO: 1, outO: 0, outDy: -cap.outRisePx, widthHold: false };
}

export type WordTone = "upcoming" | "spoken" | "active" | "keyword";

/** Colour role of one word at frame f (pure; unit-tested). */
export function wordTone(words: readonly TimelineWord[], g: number, f: number, style: CaptionStyle): WordTone {
  const w = words[g];
  if (f < w.startF) return "upcoming";
  if (w.isKeyword) return "keyword";
  if (style === "keyword") return "spoken";
  const next = words[g + 1];
  const sameBeat = next && next.beatIndex === w.beatIndex;
  const active = sameBeat ? f < next.startF : f < w.endF + LAST_WORD_HOLD_F;
  return active ? "active" : "spoken";
}

/** Drawn look of one word (pure; unit-tested): colour token, stroke (px, same colour) and whether it is emphasised.
 *  Only the keyword is ever coloured; the active word is white + bold. */
export function wordLook(tone: WordTone, keywordColor: "accent" | "danger" | undefined, activeNow: boolean): { color: "textUpcoming" | "textSpoken" | "text" | "accent" | "danger"; strokePx: number } {
  const bold = activeNow ? ACTIVE_STROKE_PX : 0;
  if (tone === "upcoming") return { color: "textUpcoming", strokePx: 0 };
  if (tone === "keyword") return { color: keywordColor === "danger" ? "danger" : "accent", strokePx: bold };
  if (tone === "active") return { color: "text", strokePx: ACTIVE_STROKE_PX };
  return { color: "textSpoken", strokePx: 0 };
}
/** Faux-bold stroke of the active word (px). */
export const ACTIVE_STROKE_PX = 1.1;

/** Is word g the word being spoken at f (keywords included; same rule as wordTone's active). */
export function isActiveWord(words: readonly TimelineWord[], g: number, f: number): boolean {
  const w = words[g];
  if (f < w.startF) return false;
  const next = words[g + 1];
  return next && next.beatIndex === w.beatIndex ? f < next.startF : f < w.endF + LAST_WORD_HOLD_F;
}

const PhraseText: React.FC<{ tl: Timeline; d: DisplayPhrase; f: number; style: CaptionStyle; opacity: number; dy: number; ghost?: boolean }> = ({ tl, d, f, style, opacity, dy, ghost }) => {
  const spans: React.ReactNode[] = [];
  for (let g = d.firstWord; g <= d.lastWord; g++) {
    const tone = wordTone(tl.words, g, f, style);
    const look = wordLook(tone, d.keywordColor === "danger" ? "danger" : "accent", style !== "keyword" && isActiveWord(tl.words, g, f));
    const c = ghost ? color.textDim : color[look.color];
    const stroke = !ghost && look.strokePx > 0 ? { WebkitTextStroke: `${look.strokePx}px ${c}`, paintOrder: "stroke fill" as const } : null;
    spans.push(
      <span key={g} style={{ color: c, ...stroke }}>
        {tl.words[g].text}
        {g < d.lastWord ? " " : ""}
      </span>,
    );
  }
  return (
    <div
      style={{
        position: "absolute", left: layout.caption.padX, top: layout.caption.padY - 1, height: LINE_H, opacity, transform: dy ? `translateY(${dy}px)` : undefined,
        fontFamily: font.sans, fontWeight: type.caption.weight, fontSize: type.caption.size, lineHeight: `${LINE_H}px`, whiteSpace: "pre",
      }}
    >
      {spans}
    </div>
  );
};

export const SubtitleCard: React.FC<{ tl: Timeline; style: CaptionStyle; ready: boolean }> = ({ tl, style, ready }) => {
  const frame = useCurrentFrame();
  const f = Math.floor(frame);
  const ph = tl.displayPhrases;
  if (!ph.length) return null;
  const cur = phraseIndexAt(ph, f);
  const d = ph[cur];
  const prev = cur > 0 ? ph[cur - 1] : null;
  const k = f - d.showF;
  const sw = swapState(k, prev !== null);

  const wNew = captionCardBox(phraseWidth(d, ready)).w;
  const wOld = prev ? captionCardBox(phraseWidth(prev, ready)).w : wNew;
  let w = wNew;
  if (prev && wNew < wOld) {
    // shrink: hold the old width while any ghost is visible (none now), then spring (damping 200). Grow snaps.
    const k0 = OUT_GHOST.length;
    const s = k < k0 ? 0 : spring({ frame: k - k0, fps: FPS, config: { damping: cap.shrinkSpringDamping, stiffness: 260, mass: 0.6 } });
    w = wOld + (wNew - wOld) * s;
  }
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute", left: layout.caption.left, top: CAPTION_CARD_TOP, width: w, height: CAPTION_CARD_H, boxSizing: "border-box",
          borderRadius: radius.box, overflow: "hidden", background: color.captionBg, border: `1px solid ${color.border}`,
          backdropFilter: `blur(${layout.caption.backdropBlurPx}px)`, WebkitBackdropFilter: `blur(${layout.caption.backdropBlurPx}px)`,
        }}
      >
        {prev && sw.outO > 0 ? <PhraseText tl={tl} d={prev} f={f} style={style} opacity={sw.outO} dy={sw.outDy} ghost /> : null}
        <PhraseText tl={tl} d={d} f={f} style={style} opacity={sw.inO} dy={0} />
      </div>
    </AbsoluteFill>
  );
};
