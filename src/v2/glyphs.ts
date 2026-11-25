// L19 glyph allow-list + the list of every string a storyboard can put on screen. ONE definition shared by the
// render-free lint (src/v2/lints.ts), the theme (remotion/v2/theme.ts re-exports it) and the render-side guard
// (remotion/v2/Explainer.tsx buildScene → remotion/v2/fonts.ts findBadGlyphs), so lint and render never disagree.
//
// Bundle-safe like timeline.ts: NO runtime imports (type-only), import it extensionless from remotion/.
// The two bundled fonts (Inter 4.001, JetBrains Mono 2.211) were cmap-checked for exactly this set (W0, fontTools).

import type { Storyboard } from "../schema/storyboard.v2.js";

/** Allowed beyond printable ASCII (U+0020–007E) and Latin-1 (U+00A0–00FF, incl. · µ é): → ● — … ≥. */
export const GLYPH_EXTRA = ["→", "●", "—", "…", "≥"] as const;

const EXTRA_CP = new Set<number>(GLYPH_EXTRA.map((g) => g.codePointAt(0)!));

/** true when the code point is on the font allow-list. */
export const glyphAllowed = (cp: number): boolean => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || EXTRA_CP.has(cp);

export interface ScreenString {
  where: string;
  text: string;
  beatId?: string;
}

function collect(value: unknown, where: string, out: ScreenString[], beatId?: string): void {
  if (typeof value === "string") out.push(beatId ? { where, text: value, beatId } : { where, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${where}[${i}]`, out, beatId));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collect(v, `${where}.${k}`, out, beatId);
}

type FigLike = { geom?: { text?: string }; children?: FigLike[] };
function figureTexts(nodes: readonly FigLike[] | undefined, where: string, out: ScreenString[]): void {
  (nodes ?? []).forEach((n, i) => {
    if (typeof n.geom?.text === "string") out.push({ where: `${where}[${i}].text`, text: n.geom.text });
    figureTexts(n.children, `${where}[${i}].children`, out);
  });
}

/**
 * Every string the Explainer can render: series, codename, header labels, phrases, instance props, Figure node text
 * and action props (state changes that swap a label, e.g. StatusCard status). Works on raw or parsed storyboards.
 */
export function onScreenStrings(sb: Pick<Storyboard, "series" | "codename" | "headerRight" | "beats" | "world">): ScreenString[] {
  const out: ScreenString[] = [
    { where: "series", text: sb.series },
    { where: "codename", text: sb.codename },
    { where: "headerRight", text: sb.headerRight },
  ];
  for (const b of sb.beats ?? []) {
    out.push({ where: `${b.id}.phrase`, text: b.phrase, beatId: b.id });
    if (b.header?.right) out.push({ where: `${b.id}.header.right`, text: b.header.right, beatId: b.id });
    (b.actions ?? []).forEach((a, i) => collect(a.props, `${b.id}.actions[${i}](${a.target}).props`, out, b.id));
  }
  for (const inst of sb.world ?? []) {
    collect(inst.props, `${inst.id}.props`, out);
    figureTexts(inst.figure as FigLike[] | undefined, `${inst.id}.figure`, out);
  }
  return out;
}

export interface BadGlyph {
  where: string;
  text: string;
  char: string;
  codePoint: string;
  beatId?: string;
}

/** Off-allow-list code points in `strings` (empty = ok). */
export function findBadGlyphs(strings: readonly ScreenString[]): BadGlyph[] {
  const bad: BadGlyph[] = [];
  for (const { where, text, beatId } of strings) {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (!glyphAllowed(cp)) bad.push({ where, text, char: ch, codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`, ...(beatId ? { beatId } : {}) });
    }
  }
  return bad;
}
