// KineticWord — bible §6.13 (+ amendments §9 rule 7: the ≤ 6-word climax line, used once per reel). A huge
// Inter 700 statement (112 px, −0.02em, line-height 1.08) on an opaque bgRaised plate that hugs the wrapped text
// (W2.1; instance w = the max wrap width); the last word (or
// `accentWord`) is lime (or red with tone danger). Words rise in 3 f apart (enterExit "self"; shared spring per word),
// the accent word last with a 1 → 1.04 → 1 kick on landing. Text is laid out at its final size: when the longest
// word would not fit the line, the size steps down (layout-time, never a transform) so nothing ever overflows.
//
// Renderer: remotion/v2/components/KineticWord.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const KineticWordProps = z
  .object({
    /** The climax line, ≤ 6 words ("update today.", "find the leak."). */
    text: z.string().min(1).max(40),
    /** The highlighted word (default: the last word). Must be one of the words, exactly as written. */
    accentWord: z.string().min(1).max(20).optional(),
    /** Highlight colour: accent = lime (bible), danger = red for a failure thesis; neutral/dim = no highlight. */
    tone: Tone.default("accent"),
  })
  .strict()
  .refine((p) => words(p.text).length >= 1 && words(p.text).length <= 6, { message: "1–6 words", path: ["text"] })
  .refine((p) => p.accentWord === undefined || words(p.text).includes(p.accentWord), { message: "accentWord must be one of the words of text", path: ["accentWord"] });

export type KineticWordPropsT = z.output<typeof KineticWordProps>;

export const KINETIC = {
  defaultW: 900,
  minW: 360,
  maxW: 952,
  px: 112,
  minPx: 72,
  weight: 700,
  trackEm: -0.02,
  lineH: 1.08,
  padX: 44,
  padY: 36,
  border: 1,
  staggerF: 3,
  kickF: 4,
} as const;

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Conservative Inter 700 advances in em (caps / digits / lowercase / space / punctuation). */
function charEm(ch: string): number {
  if (ch === " ") return 0.28;
  if (/[A-Z]/.test(ch)) return 0.74;
  if (/[0-9]/.test(ch)) return 0.64;
  if (/[mwMW]/.test(ch)) return 0.9;
  if (/[a-z]/.test(ch)) return 0.6;
  return 0.36;
}

export function textWidth(s: string, px: number): number {
  let em = 0;
  for (const ch of s) em += charEm(ch) + KINETIC.trackEm;
  return em * px;
}

export interface KineticLayout {
  px: number;
  /** Word indices per line. */
  lines: number[][];
  lineH: number;
}

/** Greedy wrap within the inner width; the size steps down by 4 px until the longest word fits a line. */
export function kineticLayout(text: string, w: number): KineticLayout {
  const ws = words(text);
  const inner = w - 2 * KINETIC.padX - 2 * KINETIC.border;
  let px: number = KINETIC.px;
  while (px > KINETIC.minPx && Math.max(...ws.map((x) => textWidth(x, px))) > inner) px -= 4;
  const lines: number[][] = [];
  let cur: number[] = [];
  let curW = 0;
  const space = textWidth(" ", px);
  ws.forEach((wd, i) => {
    const ww = textWidth(wd, px);
    if (cur.length && curW + space + ww > inner) {
      lines.push(cur);
      cur = [];
      curW = 0;
    }
    curW += (cur.length ? space : 0) + ww;
    cur.push(i);
  });
  if (cur.length) lines.push(cur);
  return { px, lines, lineH: Math.ceil(px * KINETIC.lineH) };
}

/** Index of the highlighted word. */
export function accentIndex(p: Pick<KineticWordPropsT, "text" | "accentWord">): number {
  const ws = words(p.text);
  if (p.accentWord === undefined) return ws.length - 1;
  const i = ws.lastIndexOf(p.accentWord);
  return i < 0 ? ws.length - 1 : i;
}

/**
 * Plate width (W2.1: hugs the text). The instance w (default 900) is the MAX width the text wraps in; the plate then
 * shrinks to the widest wrapped line + 2 × padX + border (never below minW). Re-laying out at the hugged width gives
 * the same lines and size (every line fits, and no break can merge in a narrower box).
 */
export function kineticWidth(p: Pick<KineticWordPropsT, "text">, w: number | undefined): number {
  const chrome = 2 * KINETIC.padX + 2 * KINETIC.border;
  const maxW = Math.min(KINETIC.maxW, Math.max(KINETIC.minW, w ?? KINETIC.defaultW));
  const ws = words(p.text);
  const L = kineticLayout(p.text, maxW);
  const lineW = Math.max(...L.lines.map((line) => textWidth(line.map((i) => ws[i]).join(" "), L.px)));
  return Math.min(maxW, Math.max(KINETIC.minW, Math.ceil(lineW + chrome + 2)));
}

export const meta = {
  name: "KineticWord",
  version: 2,
  tier: "core",
  spec: "bible §6.13 + amendments §9 (climax, once per reel)",
  summary: "Huge Inter 700 climax line (≤ 6 words) on a plate; words rise 3 f apart, the last word lime.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: KineticWordProps,
  propsSchemaName: "KineticWordProps",
  example: { text: "update today." },
  states: [],
  verbs: {
    enter: { durF: 34, does: "entrance spring, plate opaque first; words rise 3 f apart from 3 f later (spring, y 24 → 0, opacity); the accent word lands last with a 4 f kick (6 words settle by ≈ f34)" },
    exit: { durF: 8, does: "words fade + blur over 4 f on the still-opaque plate, then the plate fades + blurs over 4 f" },
    focus: { durF: 10, does: "kick on the accent word: scale 1 → 1.04 → 1" },
    glitch: { durF: 4, does: "4 f red/white tinted-copy glitch with slice displacement (counts toward the 0–3 budget)" },
  },
  focal: true,
  footprint: (p, w) => {
    const W = kineticWidth(p, w);
    const L = kineticLayout(p.text, W);
    return { w: W, h: L.lines.length * L.lineH + 2 * KINETIC.padY + 2 * KINETIC.border };
  },
  sfx: { enter: "whoosh", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof KineticWordProps>;
