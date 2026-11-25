// "pixel" — pixel art: the scene layer is pixelated to a 9 px grid (SVG filter, see components/PixelLayer.tsx),
// banded skies, hard shadows, scanlines, PICO-8-like palette and the Press Start 2P pixel font.

import type { StyleDef } from "./types";

export const pixel: StyleDef = {
  id: "pixel",
  palette: {
    sky: "#29adff",
    ground: "#00a85a",
    primary: "#ff004d",
    accent: "#ffa300",
    highlight: "#ffec27",
    ink: "#0b0b1a",
  },
  displayFont: { family: "Press Start 2P", weight: 400 },
  labelFont: { family: "Press Start 2P", weight: 400 },
  captions: { fontSize: 50, wordFontSize: 72, strokeWidth: 10, lineHeight: 1.45, letterSpacing: 2, uppercase: true },
  title: { fontSize: 46, uppercase: true },
  outline: 6,
  shadow: "hard",
  pixelSize: 9,
  skyBands: 7,
  texture: "scanlines",
  panelRadius: 0,
};
