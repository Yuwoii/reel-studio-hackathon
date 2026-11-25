// On-screen text: the beat's 2–5 punchy words as a sticker banner in the title band (under the HUD). Pops in
// within the first 0.5 s of every beat so the hook text is readable well before 2 s.

import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { readableOn } from "../color";
import { BANDS, SAFE_CX, TEXT_BOX } from "../safeZone";
import { cssFont, useTheme } from "../styles";
import { fitFontSize, wrapLines, charWidthEm } from "../textFit";

export const TITLE_BOX = (() => {
  const half = Math.min(SAFE_CX - TEXT_BOX.left, TEXT_BOX.right - SAFE_CX);
  return { left: SAFE_CX - half, width: half * 2, top: BANDS.title.top, height: BANDS.title.bottom - BANDS.title.top };
})();

export const OnScreenText: React.FC<{ text: string; beatIndex: number }> = ({ text, beatIndex }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette, style } = useTheme();
  if (!text.trim()) return null;
  const shown = style.title.uppercase ? text.toUpperCase() : text;
  const words = shown.trim().split(/\s+/);
  const padX = style.pixelSize ? 26 : 34;
  const font = style.displayFont.family;
  const innerW = TITLE_BOX.width - padX * 2 - 20;
  const em = charWidthEm(font) * (style.title.uppercase && !style.pixelSize ? 1.1 : 1);
  const lh = style.pixelSize ? 1.35 : 1.05;
  const chrome = 36 + 12 + 10; // vertical padding + border + drop shadow
  // pixel art stays axis-aligned (a rotated pixel font looks jaggy); flat gets a small sticker tilt
  const tiltDeg = style.pixelSize ? 0 : 1.6;
  const sinT = Math.sin((tiltDeg * Math.PI) / 180);
  // rotated bounding-box height = h·cos + w·sin — fit THAT into the band so corners never poke into HUD/stage
  const boxH = (sz: number, ls: string[][]) => {
    const w = Math.min(TITLE_BOX.width - 20, Math.max(...ls.map((l) => l.join(" ").length)) * sz * em + padX * 2 + 12);
    return ls.length * sz * lh + chrome + w * sinT;
  };
  let size = fitFontSize(words, font, style.title.fontSize, innerW, 2, 0.5, style.title.uppercase);
  let lines = wrapLines(words, Math.floor(innerW / (size * em)));
  // also fit the band's height (HUD above, stage below)
  while (size > 24 && boxH(size, lines) > TITLE_BOX.height - 8) {
    size -= 2;
    lines = wrapLines(words, Math.floor(innerW / (size * em)));
  }
  // pop: starts at frame 2, settles by ~12 frames (0.4 s)
  const s = spring({ frame: frame - 2, fps, config: { damping: 11, stiffness: 190, mass: 0.7 } });
  const tilt = (beatIndex % 2 ? 1 : -1) * tiltDeg;
  const bg = beatIndex % 2 ? palette.primary : palette.accent;
  const fg = readableOn(bg);
  const pixel = !!style.pixelSize;
  return (
    <div
      style={{
        position: "absolute",
        left: TITLE_BOX.left,
        top: TITLE_BOX.top,
        width: TITLE_BOX.width,
        height: TITLE_BOX.height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      }}
    >
      <div
        style={{
          transform: `scale(${s}) rotate(${tilt * s}deg)`,
          opacity: Math.min(1, s * 2),
          background: bg,
          color: fg,
          fontFamily: cssFont(font),
          fontWeight: style.displayFont.weight,
          fontSize: size,
          lineHeight: lh,
          textAlign: "center",
          padding: pixel ? `18px ${padX}px` : `16px ${padX}px 18px`,
          borderRadius: style.panelRadius,
          border: `${pixel ? 6 : 6}px solid ${palette.ink}`,
          boxShadow: pixel ? `8px 8px 0 ${palette.ink}` : `0 10px 0 ${palette.ink}`,
          maxWidth: TITLE_BOX.width - 20,
          boxSizing: "border-box",
        }}
      >
        {lines.map((l, i) => (
          <div key={i} style={{ whiteSpace: "nowrap" }}>
            {l.join(" ")}
          </div>
        ))}
      </div>
    </div>
  );
};
