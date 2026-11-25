// UnitGrid — bible §6.3 (+ amendments §6: fills ROW-MAJOR by default, ref3; the bible's diagonal wave stays as
// `order: "diagonal"`). A 10 × 10 grid of rounded squares on an opaque plate; `filled` of the 100 cells fill in the
// tone colour one by one, 1 f apart (row-major fills of more than 56 cells compress the stagger so the wave always
// lands within 60 f), each cell popping 0.4 → 1 over 4 f. Optional mono caption under the grid.
//
// Renderer: remotion/v2/components/UnitGrid.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const UnitGridProps = z
  .object({
    /** Cells to fill, 0–100 (= the percentage). */
    filled: z.number().int().min(0).max(100),
    /** Fill colour / initial state: accent = lime (default), danger = red + pulse, neutral = white, dim = textDim. */
    tone: Tone.default("accent"),
    /** Fill order: row-major (amendments §6, default) or the bible's diagonal wave (1 f per diagonal). */
    order: z.enum(["row", "diagonal"]).default("row"),
    /** Under the grid, mono 400 26 px textDim ("69 of 100 websites"). Its first number, when it equals `filled`,
     *  counts in step with the fill (always = the lit cells). */
    caption: z.string().min(1).max(32).optional(),
    /** W5.1 number-true scale: what ONE cell stands for (with unitLabel) → a chip "1 cell = 1 %" / "1 cell = 10k users". */
    cellValue: z.number().positive().max(1e6).optional(),
    unitLabel: z.string().min(1).max(8).optional(),
    /** W5.1 legend: a swatch in the fill colour + this label ("sites on PHP"), on the legend row with the unit chip. */
    legend: z.string().min(1).max(18).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.cellValue === undefined) !== (p.unitLabel === undefined)) ctx.addIssue({ code: "custom", path: ["cellValue"], message: "cellValue and unitLabel go together (\"1 cell = <cellValue> <unitLabel>\")" });
  });

export type UnitGridPropsT = z.output<typeof UnitGridProps>;

export const UNIT_GRID = {
  n: 10,
  defaultW: 600,
  minW: 420,
  maxW: 952,
  pad: 32,
  border: 2,
  gap: 8,
  cellRadius: 8,
  captionGap: 20,
  captionPx: 26,
  captionH: 34,
  /** Per-cell stagger (bible: 1 f) and the cap that keeps a full row-major wave ≤ 60 f. */
  stepF: 1,
  waveMaxF: 56,
  popF: 4,
  /** Delay from the entrance to an automatic fill (no countUp action on the instance). */
  autoFillAfterEnterF: 4,
} as const;

/** Rank of cell (r, c) in the fill order. Row-major: r·10 + c. Diagonal: by r + c, then r. */
const ORDER_CACHE: Partial<Record<"row" | "diagonal", { rank: number[]; byRank: number[] }>> = {};

/** rank[cellIndex] = position in the fill order; byRank[k] = cell index with rank k. Memoised. */
export function unitOrderTables(order: "row" | "diagonal"): { rank: number[]; byRank: number[] } {
  const hit = ORDER_CACHE[order];
  if (hit) return hit;
  const rank = unitOrder(order);
  const byRank = new Array<number>(rank.length);
  rank.forEach((k, i) => (byRank[k] = i));
  return (ORDER_CACHE[order] = { rank, byRank });
}

export function unitOrder(order: "row" | "diagonal"): number[] {
  const n = UNIT_GRID.n;
  const cells = Array.from({ length: n * n }, (_, i) => ({ i, r: Math.floor(i / n), c: i % n }));
  if (order === "diagonal") cells.sort((a, b) => a.r + a.c - (b.r + b.c) || a.r - b.r);
  const rank = new Array<number>(n * n);
  cells.forEach((x, k) => (rank[x.i] = k));
  return rank;
}

/** Frames after the wave start at which the cell with fill rank k pops (k < count). */
export function unitDelay(order: "row" | "diagonal", k: number, count: number): number {
  if (order === "diagonal") {
    // the k-th cell in diagonal order sits on diagonal d: 1 f per diagonal (bible wave)
    const i = unitOrderTables("diagonal").byRank[k];
    return (Math.floor(i / UNIT_GRID.n) + (i % UNIT_GRID.n)) * UNIT_GRID.stepF;
  }
  const step = count <= UNIT_GRID.waveMaxF ? UNIT_GRID.stepF : UNIT_GRID.waveMaxF / count;
  return Math.floor(k * step);
}

const cellSide = (w: number) => (w - 2 * UNIT_GRID.pad - 2 * UNIT_GRID.border - (UNIT_GRID.n - 1) * UNIT_GRID.gap) / UNIT_GRID.n;

export function unitGridLayout(w: number): { side: number; gridPx: number } {
  const side = cellSide(w);
  return { side, gridPx: side * UNIT_GRID.n + (UNIT_GRID.n - 1) * UNIT_GRID.gap };
}

/** W5.1 legend row: ONE row (unit chip, then the swatch + label), = ContainerBox LEGEND geometry (meta files cannot
 *  share runtime code). */
export const UNIT_LEGEND = { gap: 22, rowH: 40, swatch: 26, swatchGap: 10, itemGap: 28, px: 26, chipPadX: 14 } as const;

export function unitChipText(cellValue: number, unitLabel: string): string {
  const v = Number.isInteger(cellValue) ? String(cellValue) : String(Number(cellValue.toPrecision(3)));
  return `1 cell = ${v} ${unitLabel}`;
}

/** Legend items (unit chip first) with their widths; [] = no legend row. */
export function unitLegendItems(p: Pick<UnitGridPropsT, "cellValue" | "unitLabel" | "legend">): { chip: boolean; text: string; w: number }[] {
  const L = UNIT_LEGEND;
  const out: { chip: boolean; text: string; w: number }[] = [];
  if (p.cellValue !== undefined && p.unitLabel !== undefined) {
    const t = unitChipText(p.cellValue, p.unitLabel);
    out.push({ chip: true, text: t, w: Math.ceil(t.length * L.px * 0.6 + 2 * L.chipPadX + 2) });
  }
  if (p.legend) out.push({ chip: false, text: p.legend, w: Math.ceil(L.swatch + L.swatchGap + p.legend.length * L.px * 0.6) });
  return out;
}

const legendRowW = (p: Pick<UnitGridPropsT, "cellValue" | "unitLabel" | "legend">) => {
  const it = unitLegendItems(p);
  return it.reduce((a, x) => a + x.w, 0) + Math.max(0, it.length - 1) * UNIT_LEGEND.itemGap;
};

/** Vertical layout inside the plate (border excluded): caption top and legend row top; h = full footprint height. */
export function unitGridRows(p: Pick<UnitGridPropsT, "caption" | "cellValue" | "unitLabel" | "legend">, w: number): { captionY: number | null; legendY: number | null; h: number } {
  const U = UNIT_GRID;
  const { gridPx } = unitGridLayout(w);
  let y = U.pad + gridPx;
  const captionY = p.caption ? y + U.captionGap : null;
  if (captionY !== null) y = captionY + U.captionH;
  const legendY = unitLegendItems(p).length ? y + UNIT_LEGEND.gap : null;
  if (legendY !== null) y = legendY + UNIT_LEGEND.rowH;
  return { captionY, legendY, h: Math.ceil(2 * U.border + y + U.pad) };
}

export function unitGridMinWidth(p: Pick<UnitGridPropsT, "caption"> & Partial<Pick<UnitGridPropsT, "cellValue" | "unitLabel" | "legend">>): number {
  const cap = p.caption ? p.caption.length * UNIT_GRID.captionPx * 0.62 : 0;
  return Math.ceil(Math.max(UNIT_GRID.minW, Math.max(cap, legendRowW(p)) + 2 * UNIT_GRID.pad + 2 * UNIT_GRID.border));
}

export const meta = {
  name: "UnitGrid",
  version: 2,
  tier: "core",
  spec: "bible §6.3 + amendments §6 (row-major)",
  summary: "10×10 grid of rounded cells; `filled` of 100 fill in lime one by one (1 f stagger, row-major or diagonal); optional legend row (cellValue + unitLabel → \"1 cell = 1 %\", a swatch + legend label).",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: UnitGridProps,
  propsSchemaName: "UnitGridProps",
  example: { filled: 69, caption: "69 of 100 sites" },
  states: ["accent", "danger", "neutral", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: 13, does: "entrance spring, plate opaque first, cells + caption 3 f later; with no countUp action the fill wave starts 4 f after the entrance" },
    exit: { durF: 8, does: "cells + caption fade and blur over 4 f on the still-opaque plate, then the plate fades + blurs over 4 f" },
    countUp: { durF: 60, does: "fill wave: cells pop in the tone colour 1 f apart (≤ 56 f for the whole wave) + 4 f pop; empty until the first countUp" },
    state: { durF: 34, does: "tone change recolours the filled cells along the fill order (snap per cell, ≤ 30 f); a new `filled` count fills / empties the difference 1 f per cell; a tone + caption change that shrinks the count empties every old cell first (≤ 8 f, with the caption scramble), then fills the new count in the new tone (≤ 22 f)", props: ["filled", "caption"] },
    pulse: { durF: 12, does: "one glow flash of the filled cells" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
  },
  focal: true,
  footprint: (p, w) => {
    const W = Math.min(UNIT_GRID.maxW, Math.max(w ?? UNIT_GRID.defaultW, unitGridMinWidth(p)));
    return { w: W, h: unitGridRows(p, W).h };
  },
  sfx: { countUp: "chatter", state: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof UnitGridProps>;
