// "flat" — flat vector: smooth shapes, soft shadows, bold heavy sans (Montserrat Black).

import type { StyleDef } from "./types";

export const flat: StyleDef = {
  id: "flat",
  palette: {
    sky: "#7cc6f2",
    ground: "#5cbf6b",
    primary: "#ff7a45",
    accent: "#7b5cff",
    highlight: "#ffd60a",
    ink: "#1d1b2e",
  },
  displayFont: { family: "Montserrat", weight: 900 },
  labelFont: { family: "Montserrat", weight: 800 },
  captions: { fontSize: 84, wordFontSize: 120, strokeWidth: 16, lineHeight: 1.1, letterSpacing: -1, uppercase: false },
  title: { fontSize: 72, uppercase: true },
  outline: 0,
  shadow: "soft",
  pixelSize: 0,
  skyBands: 0,
  texture: "grain",
  panelRadius: 28,
};
