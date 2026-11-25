// A visual style = default 6-role palette + fonts + rendering/texture rules. config.palette overrides roles.

import type { Palette } from "../../src/schema/index.js";

export interface StyleDef {
  id: "flat" | "pixel";
  palette: Palette;
  /** Font for captions / on-screen text / HUD values. */
  displayFont: { family: string; weight: number };
  /** Font for small HUD labels. */
  labelFont: { family: string; weight: number };
  captions: { fontSize: number; wordFontSize: number; strokeWidth: number; lineHeight: number; letterSpacing: number; uppercase: boolean };
  title: { fontSize: number; uppercase: boolean };
  /** Outline width (px at 1080p) for scene shapes. */
  outline: number;
  /** Soft drop shadows under characters/props (flat) vs hard offset shadows (pixel). */
  shadow: "soft" | "hard";
  /** Pixel art: scene layer is pixelated to this grid size (px). 0 = smooth vector. */
  pixelSize: number;
  /** Sky gradient: smooth (flat) or quantised bands (pixel). */
  skyBands: number;
  /** Texture overlay on top of the scene (under text). */
  texture: "grain" | "scanlines" | "none";
  /** Corner radius for UI panels (HUD, title banner). */
  panelRadius: number;
}
