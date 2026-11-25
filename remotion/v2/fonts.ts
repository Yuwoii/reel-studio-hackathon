// v2 house fonts: the local OFL variable TTFs in public/fonts (Inter 4.001, JetBrains Mono 2.211; provenance in
// assets/LICENSES.md), served from the Lambda site's own bucket via staticFile(). Never @remotion/google-fonts.
//
// - ensureV2Fonts(): registers both FontFaces once per tab through @remotion/fonts loadFont() (which wraps itself in
//   delayRender), then verifies document.fonts really holds the weights we render with.
// - useV2Fonts(): composition-level hook. Holds its own delayRender handle until the fonts are verified, then re-renders
//   (ready=true) so canvas text measurement (SubtitleCard) uses the real face. A font that fails to load cancels the
//   render: a fallback face would silently change every width and the look.
// - findBadGlyphs(): L19 render-side guard. Every on-screen string must stay on the glyph allow-list (theme.glyphAllowed);
//   the bundled fonts were cmap-checked for exactly that set (W0, fontTools).

import { loadFont } from "@remotion/fonts";
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import { fontFiles, glyphAllowed } from "./theme";

export const FAMILY = { sans: "Inter", mono: "JetBrains Mono" } as const;

/** Weights the v2 layers and components render with (variable fonts cover the full axis). */
const CHECKS = [`400 30px "${FAMILY.mono}"`, `500 22px "${FAMILY.mono}"`, `600 220px "${FAMILY.mono}"`, `600 46px "${FAMILY.sans}"`, `700 44px "${FAMILY.sans}"`];

let loading: Promise<void> | null = null;

export function ensureV2Fonts(): Promise<void> {
  if (loading) return loading;
  loading = Promise.all([
    loadFont({ family: FAMILY.sans, url: staticFile(fontFiles.sans), weight: "100 900", format: "truetype" }),
    loadFont({ family: FAMILY.mono, url: staticFile(fontFiles.mono), weight: "100 800", format: "truetype" }),
  ]).then(async () => {
    if (typeof document === "undefined" || !document.fonts) return;
    await Promise.all(CHECKS.map((f) => document.fonts.load(f)));
    const missing = CHECKS.filter((f) => !document.fonts.check(f));
    if (missing.length) throw new Error(`v2 fonts not available after load: ${missing.join(", ")}`);
  });
  return loading;
}

/** true once the local fonts are loaded and verified. Blocks the frame (delayRender) until then. */
export function useV2Fonts(): boolean {
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("v2 local fonts", { timeoutInMilliseconds: 25_000 }));
  useEffect(() => {
    let alive = true;
    ensureV2Fonts()
      .then(() => {
        if (!alive) return;
        setReady(true);
        continueRender(handle);
      })
      .catch((e: unknown) => cancelRender(e instanceof Error ? e : new Error(String(e))));
    return () => {
      alive = false;
    };
  }, [handle]);
  return ready;
}

export interface BadGlyph {
  where: string;
  text: string;
  char: string;
  codePoint: string;
}

/** L19: every code point of every string must be on the allow-list. Returns the offenders (empty = ok). */
export function findBadGlyphs(strings: ReadonlyArray<{ where: string; text: string }>): BadGlyph[] {
  const bad: BadGlyph[] = [];
  for (const { where, text } of strings) {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (!glyphAllowed(cp)) bad.push({ where, text, char: ch, codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}` });
    }
  }
  return bad;
}

/** Every string value inside an arbitrary props object (component props are free-form until W2's propsSchema). */
export function collectStrings(value: unknown, where: string, out: { where: string; text: string }[] = []): { where: string; text: string }[] {
  if (typeof value === "string") out.push({ where, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${where}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collectStrings(v, `${where}.${k}`, out);
  return out;
}

// ── text measurement (canvas, real face once useV2Fonts() is ready) ────────────────────────────────────────────

let ctx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

/** Width of `text` in px for a CSS font shorthand, or null when no canvas is available. */
export function measureText(text: string, cssFont: string): number | null {
  const key = `${cssFont}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return null;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.font = cssFont;
  const w = ctx.measureText(text).width;
  widthCache.set(key, w);
  return w;
}
