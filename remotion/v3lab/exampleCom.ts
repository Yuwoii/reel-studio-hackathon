// (c) example.com capture data, from research/v3/R3/candidates/captures/example-com-1200x700.{png,json}
// (captured 2026-10-29T09:35:29Z with research/v3/R3/tools/capture-page.cjs, device scale 2 → 2400×1400 px).
// The plate assets/example-com.png = crop x 648..1752, y 140..728 of the 2400×1400 capture (x 0.27–0.73,
// y 0.10–0.52: above the tofu CJK line at y ≈ 0.54), padded 40 px on top and to 1104×1306 (the page-area aspect
// 960:1136) with the page's own background. Anchors below are re-normalised into WINDOW px (BrowserWindow, 960 wide).
import { WIN } from "./devices/BrowserWindow";

export const TLS = {
  protocol: "TLS 1.3",
  issuer: "Cloudflare TLS Issuing ECC CA 3",
  subjectName: "example.com",
  validFrom: "2026-09-26", // 1790462951
  validTo: "2026-12-25", // 1798239395
  chainLen: 4,
} as const;

const SRC = { w: 2400, h: 1400 } as const;
const CROP = { x: 648, y: 140, padTop: 40, w: 1104 } as const;
const S = WIN.w / CROP.w;

/** Capture-normalised (0..1 of the 2400×1400 source) point → window px. */
export function capToWin(nx: number, ny: number): { x: number; y: number } {
  return { x: (nx * SRC.w - CROP.x) * S, y: (ny * SRC.h - CROP.y + CROP.padTop) * S + WIN.pageTop };
}

// Capture JSON bboxes (normalised to the 1200×700 CSS viewport = the 2400×1400 png).
const P = { x: 0.3267, y: 0.2729, w: 0.3467, h: 0.1462 };
const SVG = { x: 0.4817, y: 0.1871, w: 0.0367, h: 0.0629 };
export const PAGE_ANCHORS = {
  p: capToWin(P.x + P.w / 2, P.y + P.h / 2),
  pBox: { tl: capToWin(P.x, P.y), br: capToWin(P.x + P.w, P.y + P.h) },
  svg: capToWin(SVG.x + SVG.w / 2, SVG.y + SVG.h / 2),
} as const;
