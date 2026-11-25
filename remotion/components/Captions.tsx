// Captions: word-by-word or 2–4-word chunks timed from audio[i].words, aligned onto the EXACT narration tokens
// (captionAlign.ts). The beat's keyWord is drawn in palette.highlight. Big, bold, thick ink stroke, centred on
// the safe zone's horizontal centre inside the captions band (above the 350 px bottom inset).

import React, { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { BeatAudio, Config } from "../../src/schema/index.js";
import { alignCaptionTokens, chunkTokens, matchesKeyWord, type TimedToken } from "../captionAlign";
import { BANDS, SAFE_CX, TEXT_BOX } from "../safeZone";
import { cssFont, useTheme } from "../styles";
import { charWidthEm, fitFontSize, wrapIndices } from "../textFit";

/** Captions box: symmetric around the safe-zone centre, inside TEXT_BOX. */
export const CAPTION_BOX = (() => {
  const half = Math.min(SAFE_CX - TEXT_BOX.left, TEXT_BOX.right - SAFE_CX);
  return { left: SAFE_CX - half, width: half * 2, top: BANDS.captions.top, height: BANDS.captions.bottom - BANDS.captions.top };
})();

/**
 * Thick outline as a ring of text-shadows (round joins). -webkit-text-stroke at this width draws miter spikes
 * on letters like "A"/"N". Pixel style uses a square ring of hard offsets plus a drop shadow so it reads blocky.
 */
export function outlineShadow(r: number, color: string, pixel: boolean): string {
  const out: string[] = [];
  if (pixel) {
    const step = Math.max(2, Math.round(r / 3));
    for (let dx = -r; dx <= r; dx += step) for (let dy = -r; dy <= r; dy += step) out.push(`${dx}px ${dy}px 0 ${color}`);
    out.push(`${r + 4}px ${r + 4}px 0 ${color}`);
  } else {
    for (const k of [1, 0.55]) for (let a = 0; a < 360; a += 22.5) out.push(`${(Math.cos((a * Math.PI) / 180) * r * k).toFixed(1)}px ${(Math.sin((a * Math.PI) / 180) * r * k).toFixed(1)}px 0 ${color}`);
    out.push(`0 ${r + 2}px 14px rgba(0,0,0,0.45)`);
  }
  return out.join(", ");
}

export interface CaptionState {
  tokens: TimedToken[];
  chunk: TimedToken[];
  chunkStartMs: number;
  activeIndex: number; // index into chunk
}

/** Which chunk/word is on screen at `ms`. Exported for tests. */
export function captionStateAt(tokens: TimedToken[], mode: Config["captions"]["mode"], chunkSize: number, ms: number): CaptionState | null {
  if (!tokens.length) return null;
  const groups = mode === "word" ? tokens.map((t) => [t]) : chunkTokens(tokens, chunkSize);
  let gi = -1;
  for (let i = 0; i < groups.length; i++) if (groups[i][0].startMs <= ms) gi = i;
  if (gi < 0) {
    // before the first word: show the first chunk from ~150 ms early so captions don't lag the voice
    if (groups[0][0].startMs - ms > 150) return null;
    gi = 0;
  }
  const chunk = groups[gi];
  let ai = 0;
  chunk.forEach((t, i) => {
    if (t.startMs <= ms) ai = i;
  });
  return { tokens, chunk, chunkStartMs: chunk[0].startMs, activeIndex: ai };
}

export const Captions: React.FC<{ narration: string; audio: BeatAudio; keyWord?: string; mode: Config["captions"]["mode"]; chunkSize: number }> = ({
  narration,
  audio,
  keyWord,
  mode,
  chunkSize,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette, style } = useTheme();
  const tokens = useMemo(() => alignCaptionTokens(narration, audio.words ?? [], audio.durationSec * 1000), [narration, audio]);
  const ms = (frame / fps) * 1000;
  const st = captionStateAt(tokens, mode, Math.min(4, Math.max(2, chunkSize)), ms);
  if (!st) return null;

  const words = st.chunk.map((t) => (style.captions.uppercase ? t.text.toUpperCase() : t.text));
  const base = mode === "word" ? style.captions.wordFontSize : style.captions.fontSize;
  const font = style.displayFont.family;
  const innerW = CAPTION_BOX.width - style.captions.strokeWidth * 2;
  const size = fitFontSize(words, font, base, innerW, mode === "word" ? 1 : 2, 0.5, style.captions.uppercase);
  // explicit lines (nowrap) so the stroke and fill layers can never wrap differently
  const lines = wrapIndices(words, Math.max(1, Math.floor(innerW / (size * charWidthEm(font) * (style.captions.uppercase ? 1.1 : 1)))));
  const sinceChunk = frame - Math.floor((st.chunkStartMs / 1000) * fps);
  const pop = interpolate(sinceChunk, [0, 4], [0.86, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pixel = !!style.pixelSize;

  const line = (layer: "stroke" | "fill") => (
    <div
      style={{
        fontFamily: cssFont(font),
        fontWeight: style.displayFont.weight,
        fontSize: size,
        lineHeight: style.captions.lineHeight,
        letterSpacing: style.captions.letterSpacing,
        wordSpacing: "0.12em",
        textAlign: "center",
        color: layer === "stroke" ? palette.ink : "#ffffff",
        textShadow: layer === "stroke" ? outlineShadow(style.captions.strokeWidth / 2, palette.ink, pixel) : undefined,
        ...(layer === "fill" ? { position: "absolute" as const, inset: 0 } : {}),
      }}
    >
      {lines.map((ln, li) => (
        <div key={li} style={{ whiteSpace: "nowrap" }}>
          {ln.map((i, k) => {
            const key = matchesKeyWord(st.chunk[i].text, keyWord);
            const active = i === st.activeIndex;
            return (
              <React.Fragment key={i}>
                <span
                  style={{
                    display: "inline-block",
                    color: layer === "fill" ? (key ? palette.highlight : "#ffffff") : undefined,
                    transform: active && mode === "chunk" ? "scale(1.08)" : undefined,
                    transformOrigin: "center bottom",
                  }}
                >
                  {words[i]}
                </span>
                {k < ln.length - 1 ? " " : null}
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        left: CAPTION_BOX.left,
        top: CAPTION_BOX.top,
        width: CAPTION_BOX.width,
        height: CAPTION_BOX.height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", transform: `scale(${pop})` }}>
        {line("stroke")}
        {line("fill")}
      </div>
    </div>
  );
};
