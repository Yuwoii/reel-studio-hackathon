// VersionPills — bible §6.10. A wrapped row of pills (`PHP 8.5.12`, `PHP 8.4.27`, …), mono 500 30 px, radius.pill,
// that pop in with a 3 f stagger (enterExit "self": each pill springs scale 0.9 → 1; its opaque plate reaches full
// opacity before its text fades in, so field glyphs never show through the text; the group exits with the shared
// 8 f exit: texts fade + blur over 4 f on still-opaque pills, then the pills). Tone accent (default) = lime filled
// pills with accentInk text when there are ≤ 2 pills; with more, accent = OUTLINE pills (bgRaised + accent border +
// accent text) and only the `highlight` pill ("the fix") is solid lime (W2 fix round 2: four solid lime pills were a
// lime block heavier than any ref3 frame); danger = dangerSurface + danger border/text; neutral = bgRaised +
// borderStrong + white; dim = bgRaised + border + textDim.
// Layout is computed here: every pill has the width of the widest one (JetBrains Mono 0.6 em advance), laid out as a
// balanced grid (4 → 2 × 2, 5 → 3 + 2 with the short last row centred). The footprint is exactly the content box, so
// the instance x centres the block (`w` is only the wrap limit).
//
// Renderer: remotion/v2/components/VersionPills.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const VersionPillsProps = z
  .object({
    /** 1–8 pill texts in reading order ("PHP 8.5.12", "openssl 3.0.15", "1.29.3"). */
    items: z.array(z.string().min(1).max(16)).min(1).max(8),
    /** Initial state: accent = lime (bible, "patched versions"; outline when > 2 pills); danger = affected versions. */
    tone: Tone.default("accent"),
    /** Index of the one pill that is "the fix": solid lime in the accent state even when the others are outlined. */
    highlight: z.number().int().min(0).max(7).optional(),
  })
  .strict()
  .refine((p) => p.highlight === undefined || p.highlight < p.items.length, { message: "highlight must index one of the items", path: ["highlight"] });

export type VersionPillsPropsT = z.output<typeof VersionPillsProps>;

export const VERSION_PILLS = {
  defaultW: 860,
  maxW: 952,
  px: 30, // type.pill (28–32)
  padX: 24,
  lineH: 36,
  padY: 14,
  border: 1,
  gapX: 16,
  gapY: 16,
  staggerF: 3,
  popFrom: 0.9,
  /** Entrance progress at which the plate is fully opaque; the text fades in over the rest. */
  plateBy: 0.5,
  /** Up to this many pills the accent state is solid lime; more pills are outlined (except `highlight`). */
  solidMax: 2,
} as const;

export const pillH = VERSION_PILLS.lineH + 2 * VERSION_PILLS.padY + 2 * VERSION_PILLS.border;
export const versionPillW = (text: string) => Math.ceil(text.length * VERSION_PILLS.px * 0.6 + 2 * VERSION_PILLS.padX + 2 * VERSION_PILLS.border);

export interface PillBox {
  x: number;
  y: number;
  w: number;
}

/** Accent look of pill i: solid lime fill for ≤ 2 pills or the highlighted pill, outline otherwise. */
export function accentSolid(p: Pick<VersionPillsPropsT, "items" | "highlight">, i: number): boolean {
  return p.items.length <= VERSION_PILLS.solidMax || p.highlight === i;
}

/** Equal-width pills in a balanced grid that fits w (idempotent: laying out again at the returned w gives the same grid). */
export function versionPillsLayout(items: readonly string[], w: number): { boxes: PillBox[]; rows: number; cols: number; w: number } {
  const n = items.length;
  const pw = Math.max(...items.map(versionPillW));
  const fit = Math.max(1, Math.min(n, Math.floor((w + VERSION_PILLS.gapX) / (pw + VERSION_PILLS.gapX))));
  const rows = Math.ceil(n / fit);
  const cols = Math.ceil(n / rows);
  const W = cols * pw + (cols - 1) * VERSION_PILLS.gapX;
  const boxes: PillBox[] = items.map((_, i) => {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * pw + (inRow - 1) * VERSION_PILLS.gapX;
    return { x: (W - rowW) / 2 + (i % cols) * (pw + VERSION_PILLS.gapX), y: r * (pillH + VERSION_PILLS.gapY), w: pw };
  });
  return { boxes, rows, cols, w: W };
}

export const meta = {
  name: "VersionPills",
  version: 1,
  tier: "core",
  spec: "bible §6.10",
  summary: "Balanced grid of equal-width mono pills (lime filled by default) that pop in with a 3 f stagger; tone recolours in a wave.",
  families: ["security", "outage", "network", "systems", "data"],
  propsSchema: VersionPillsProps,
  propsSchemaName: "VersionPillsProps",
  example: { items: ["PHP 8.5.12", "PHP 8.4.27", "PHP 8.3.26"] },
  states: ["accent", "danger", "neutral", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: 34, does: "pills pop in 3 f apart (spring scale 0.9 → 1, plate opaque first, then text; 8 pills settle by ≈ f34)" },
    exit: { durF: 8, does: "texts fade + blur over 4 f on the still-opaque pills, then the pills fade + blur over 4 f" },
    state: { durF: 30, does: "tone change sweeps the pills left → right 3 f apart (colours snap per pill; danger text then pulses 0.7↔1 / 20 f; accent with > 2 pills = outline, `highlight` solid)" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    pulse: { durF: 12, does: "one glow flash of every pill" },
  },
  focal: false,
  footprint: (p, w) => {
    const limit = Math.min(VERSION_PILLS.maxW, Math.max(w ?? VERSION_PILLS.defaultW, ...p.items.map(versionPillW)));
    const L = versionPillsLayout(p.items, limit);
    return { w: L.w, h: L.rows * pillH + (L.rows - 1) * VERSION_PILLS.gapY };
  },
  sfx: { enter: "tick", state: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof VersionPillsProps>;
