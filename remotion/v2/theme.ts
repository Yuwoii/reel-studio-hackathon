// ROOT CAUSE v2 design tokens. Source: research/STYLE_BIBLE_V2_AMENDMENTS.md §T. No hex outside this file.
export const color = {
  bg: "#131313", bgRaised: "#1A1A1A", bgRaised2: "#202020",
  border: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.16)",
  text: "#FFFFFF", /* was #EDEDED */ textDim: "#8A8A8A",
  textUpcoming: "rgba(255,255,255,0.45)", // captions: words not yet spoken
  textSpoken: "rgba(255,255,255,0.80)",   // W7.3 captions: words already spoken (active word = text + bold)
  textFaint: "rgba(255,255,255,0.15)",    // data-field glyphs (was 0.10)
  textFainter: "rgba(255,255,255,0.07)",  // field lead column + inline field labels
  accent: "#D4F84A", accentInk: "#131313", danger: "#F5485C",
  dangerBg: "rgba(245,72,92,0.10)",       // overlay only, always over bgRaised
  dangerSurface: "#301F21",               // dangerBg pre-composited over bgRaised (opaque)
  markDanger: "rgba(245,72,92,0.35)", markAccent: "rgba(212,248,74,0.30)", // DataField mark, level 1
  captionBg: "rgba(26,26,26,0.92)",       // bgRaised at 92 %
  hairline: "rgba(212,248,74,0.25)", footerTop: "#141414", footerBottom: "#0E0E0E", vignette: "rgba(0,0,0,0.35)",
} as const;
export type ColorToken = keyof typeof color;
export const font = { sans: "Inter, sans-serif", mono: "'JetBrains Mono', monospace" } as const;
export const fontFiles = { sans: "fonts/Inter-Variable.ttf", mono: "fonts/JetBrainsMono-Variable.ttf" } as const;
/** L19: printable ASCII, Latin-1 (incl. · µ), plus → ● — … ≥. ONE list for theme, lints and the render guard. */
export { GLYPH_EXTRA, glyphAllowed } from "../../src/v2/glyphs";
export const type = {
  hero: { family: "mono", weight: 600, size: 220, tracking: "-0.03em" }, cardTitle: { family: "sans", weight: 600, size: 44 },
  cardSub: { family: "mono", weight: 400, size: 26, tracking: "0.02em" }, pill: { family: "mono", weight: 500, size: 30 }, // 28–32
  caption: { family: "sans", weight: 600, size: 46, lineHeight: 1.25 }, header: { family: "mono", weight: 500, size: 22, tracking: "0.08em" },
  field: { family: "mono", weight: 400, size: 30 }, fieldLog: { family: "mono", weight: 400, size: 26 }, minText: 26,
} as const;
export const radius = { card: 28, pill: 16, box: 22 } as const;
export const W = 1080, H = 1920, FPS = 30;
export const layout = {
  margin: 64, rightSafeX: 960, contentRightX: 1016,
  stage: { top: 150, bottom: 1560, cx: 540, cy: 855 },  // cy = camera screen anchor
  headerBand: { solidTo: 218, fadeTo: 320 }, headerTextTop: 170, headerCenterY: 184, headerLeftTextX: 86, focal: { top: 218, bottom: 1400 },
  caption: { left: 64, bottom: 1520, maxW: 886, padX: 36, padY: 28, backdropBlurPx: 12 },
  hairlineY: 1560, footer: { top: 1560, bottom: 1920 },
} as const;
export const header = { series: "ROOT CAUSE", dotPx: 12, dotGapPx: 10, pulsePeriodS: 1.2, pulse: [0.6, 1],
  maxLeftChars: 30, maxRightChars: 24, accentDotMaxS: 1, maxEventChanges: 4 } as const;
export const motion = {
  enter: { damping: 200, stiffness: 180, mass: 0.6 }, enterY: 24, enterScale: 0.97, exitF: 8, exitBlurPx: 8,
  staggerF: [3, 4], scrambleF: [6, 8], dangerPulseF: 20, dangerPulse: [0.7, 1], markF: 6, flightMinOnscreenF: 8,
  impact: { scale: [1, 0.96, 1], f: 6 }, stamp: { rotateDeg: -4, scaleFrom: 1.4, f: 6, shakePx: 6, shakeF: 3 },
  glitch: { maxPerReel: 3, f: 4, offsetPx: 8 } /* red/white tints; budget shared with shake */, keywordToleranceF: 3, maxChangeGapF: 90 } as const;
export const camera = {
  ease: { bible: [0.65, 0, 0.35, 1], longPan: [0.45, 0, 0.55, 1] } as const,
  bibleF: [12, 20], longPanMinF: 22, longPanMinPx: 900, baseZoom: 0.88, zoom: [0.6, 2.2], zoomStep: [1.2, 1.35],
  holdDriftZoom: 0.02, maxTiltX: 25, peakScreenPxPerF: 150, zoomLeverPx: 1100, maxHardCuts: 2, cutOnsetToleranceF: 4 } as const;
export const blur = { window: "tent", shutterAngle: 180, minPxPerF: 6, spacingPx: 1, minSamples: 8, maxSamples: 32 } as const;
/** Sub-samples for a frame whose fastest screen motion is v px/f (0 = no blur, render once). */
export const blurSamples = (v: number): number =>
  v < blur.minPxPerF ? 0
    : Math.max(blur.minSamples, Math.min(blur.maxSamples, Math.ceil((v * blur.shutterAngle) / 360 / blur.spacingPx)));
export const caption = { maxWords: 5, swapF: 3, outRisePx: 8, shrinkSpringDamping: 200 } as const;
export const field = { scrollPxPerS: 6, rerollEveryF: 15, rerollCount: [2, 3],
  presets: ["hex", "logs", "process", "nodes", "lattice", "matrix", "book"] } as const;
export const vignetteCss = `radial-gradient(ellipse 75% 60% at 50% 45%, rgba(0,0,0,0) 50%, ${color.vignette} 100%)`;
