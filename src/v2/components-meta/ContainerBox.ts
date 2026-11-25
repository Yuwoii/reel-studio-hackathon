// ContainerBox — bible §6.5 ProcessBox, generalised (R7 "generalisations" #1, amendments §6: embeds the Meter look).
//
//   ┌──────────────────────────────────────┐
//   │ checkout-api                  PID 1  │   title sans 600 44 px · tag mono 400 26 px textDim
//   │ one container · one cgroup           │   subtitle mono 400 26 px textDim, tracking 0.02em
//   │ ▢ ▢ ▢ ▢ ▢                            │   5×4 memory cells, 64 px tall, 12 px gap, row-major:
//   │ ▢ ▢ ▢ ▢ ▢                            │     empty (bgRaised2) · filled (grey; dim red markDanger, pulsing, when full)
//   │ ▢ ▢ ▢ ▢ ▢                            │     freed (2 px dashed outline) · danger (attacker red) · accent
//   │ ▢ ▢ ▢ ▢ ▢                            │
//   │ memory                 179Mi / 512Mi │   meter row mono 26 px: label (state text) · used / limit (limitLabel)
//   │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░ │   bar: track bgRaised2 24 px radius.pill, fill tweens 12 f
//   └──────────────────────────────────────┘   radius.card, opaque plate (bgRaised / dangerSurface when full)
//
// The bar is drawn by the ContainerBox itself (same spec as N-6 Meter: text → accent → danger + pulse), so this packet
// has no runtime dependency on the Meter component. States double as the memory story (the OOMKilled pilot uses
// cgroup → reclaim → full → killed → freed); a state implies a fill unless `value` says otherwise.
// Renderer: remotion/v2/components/ContainerBox.tsx.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

// = storyboard Tone (redeclared: meta files may not import relative runtime modules).
const Tone = z.enum(["accent", "danger", "neutral", "dim"]);
/** One memory cell. "filled" = in use (grey, red when the box is full); "danger" = attacker-controlled; "freed" = dashed. */
export const CellKind = z.enum(["empty", "filled", "freed", "danger", "accent"]);
export type CellKindT = z.output<typeof CellKind>;

export const ContainerBoxProps = z
  .object({
    /** Sans 600 44 px, white. */
    title: z.string().min(1).max(24),
    /** Mono 400 26 px, textDim (bible: "one process, many visitors"). */
    subtitle: z.string().min(1).max(34).optional(),
    /** Small mono tag top-right, textDim ("PID 1", "pod", "node-3"). */
    tag: z.string().min(1).max(10).optional(),
    /** Meter row, left (normal states). */
    meterLabel: z.string().min(1).max(18).default("memory"),
    /** Meter row, left, in the `full` state (bible: OUT OF MEMORY). */
    fullLabel: z.string().min(1).max(18).default("OUT OF MEMORY"),
    /** Meter row, left, in the `killed` state. */
    killedLabel: z.string().min(1).max(18).default("KILLED"),
    /**
     * Meter row, right (tabular). "498Mi / 512Mi" = an explicit used count (rolls with the bar on a change, clamped at
     * the limit); "memory.max 512Mi" = the limit only (the row then reads "<used>Mi / 512Mi" off the bar). Any other
     * text is shown as is (scrambles 8 f on a change). The bar's right end = this limit. An explicit "used / max"
     * readout SETS the fill (used / max; it overrides `value`), so counter, bar and cells always agree.
     */
    limitLabel: z.string().min(1).max(20).optional(),
    /** Fill 0..1 of the bar (and of the cells, row-major). Omitted = implied by the state (see STATE_FILL). Ignored when
   *  limitLabel is an explicit "used / max" readout (that readout is the fill). */
    value: z.number().min(0).max(1).optional(),
    /** Explicit 5×4 cell map (row-major, ≤ 20; missing cells follow `value`). */
    cells: z.array(CellKind).max(20).optional(),
    /** Initial state: neutral (grey fill), accent (lime fill: "the thing"), danger (= full), dim. */
    tone: Tone.default("neutral"),
    /** W5.1 number-true scale: what ONE cell stands for (with unitLabel) → a legend chip "1 cell = 200 MB". */
    cellValue: z.number().positive().max(1e6).optional(),
    unitLabel: z.string().min(1).max(6).optional(),
    /** W5.1 per-kind legend under the bar: a swatch drawn exactly like that cell kind + its label ("heap", "off-heap"). */
    legend: z.array(z.object({ kind: CellKind.exclude(["empty"]), label: z.string().min(1).max(14) }).strict()).max(4).optional(),
    /**
     * W5.1 FR1 named cell groups: cells (0–19, row-major) that belong to one named category, each drawn in its tone
     * with its own look (solid / hatched / outline) and one legend swatch with its label — so "tmpfs", "kernel" and
     * "stacks" are three different-looking reds, each readable off the legend. A group paints its cells over `cells` /
     * the fill. Declare every group in the base props (cells [] until it fills); state / mark / countUp props may then
     * change a group's cells (same labels, same order). Max 4; no two groups share tone + style; no cell in two groups.
     */
    groups: z.array(z.object({ label: z.string().min(1).max(14), cells: z.array(z.number().int().min(0).max(19)).max(20), tone: z.enum(["danger", "accent", "used"]).default("danger"), style: z.enum(["solid", "hatched", "outline"]).default("solid") }).strict()).max(4).optional(),
    /**
     * W5.1 FR1 over the limit: how far usage went PAST memory.max, as a fraction of the limit (0.1 = 10 % over). The bar
     * then draws the limit wall inside the track (at 1 / (1 + over)) with a hatched danger segment spilling past it, and
     * an explicit "used / max" readout may exceed max. For the climax of the OOM family ("crossed the limit").
     */
    over: z.number().min(0).max(0.5).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.cellValue === undefined) !== (p.unitLabel === undefined)) ctx.addIssue({ code: "custom", path: ["cellValue"], message: "cellValue and unitLabel go together (\"1 cell = <cellValue> <unitLabel>\")" });
    const looks = new Set<string>();
    const owner = new Map<number, string>();
    for (const g of p.groups ?? []) {
      const look = `${g.tone}/${g.style}`;
      if (looks.has(look)) ctx.addIssue({ code: "custom", path: ["groups"], message: `groups: two groups drawn ${look} cannot be told apart — give "${g.label}" another style (solid / hatched / outline) or tone` });
      looks.add(look);
      for (const c of g.cells) {
        if (owner.has(c)) ctx.addIssue({ code: "custom", path: ["groups"], message: `groups: cell ${c} is in "${owner.get(c)}" and "${g.label}"` });
        owner.set(c, g.label);
      }
    }
  });

export type ContainerBoxPropsT = z.output<typeof ContainerBoxProps>;

// ── W5.1 legend row (shared with UnitGrid's) ──────────────────────────────────────────────────────────────────

/** Legend row geometry: swatch + mono 26 label per item, a bordered unit chip, rows wrap inside the inner width. */
export const LEGEND = { gap: 22, rowH: 40, rowGap: 10, swatch: 26, swatchGap: 10, itemGap: 28, px: 26, chipPadX: 14 } as const;

export interface LegendItem {
  /** Cell kind of the swatch (null = the unit chip). */
  kind: string | null;
  text: string;
  w: number;
  /** Group swatch (W5.1 FR1): the group's index in props.groups (its tone + style is the swatch). */
  group?: number;
}

/** Byte-ish unit tails a limitLabel may carry, and the next smaller unit for cells under 1 ("4GB" / 20 → 200 MB). */
const SMALLER: Record<string, [string, number]> = { G: ["M", 1000], GB: ["MB", 1000], Gi: ["Mi", 1024], GiB: ["MiB", 1024], M: ["K", 1000], MB: ["KB", 1000], Mi: ["Ki", 1024], MiB: ["KiB", 1024], T: ["G", 1000], TB: ["GB", 1000], Ti: ["Gi", 1024] };

/**
 * The unit chip a limitLabel implies (W5.1 FR1: the OOM director hand-built 6–7 legend pills instead): one cell = limit
 * / 20, in the label's unit or the next smaller one when that is under 1 ("memory.max 4GB" → "1 cell = 200 MB",
 * "1024Mi" → "1 cell = ~51 Mi"). null when the label has no number + unit.
 */
export function autoUnitChip(limitLabel: string | undefined, cells = 20): string | null {
  const r = parseLimit(limitLabel);
  const unit = r?.tail.trim();
  if (!r || !unit || r.max <= 0) return null;
  let v = r.max / cells;
  let u = unit;
  if (v < 1 && SMALLER[u]) {
    v *= SMALLER[u][1];
    u = SMALLER[u][0];
  }
  const shown = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `1 cell = ${Math.abs(shown - v) < 1e-9 ? "" : "~"}${shown} ${u}`;
}

/** "1 cell = 200 MB" (integer-trimmed numbers). */
export function unitChipText(cellValue: number, unitLabel: string): string {
  const v = Number.isInteger(cellValue) ? String(cellValue) : String(Number(cellValue.toPrecision(3)));
  return `1 cell = ${v} ${unitLabel}`;
}

/** Legend items in drawing order: the unit chip first (explicit cellValue + unitLabel, else the limitLabel's), then one
 *  swatch per legend entry, then one per cell group. */
export function legendItems(p: { cellValue?: number; unitLabel?: string; legend?: readonly { kind: string; label: string }[]; limitLabel?: string; groups?: readonly { label: string }[]; cells?: readonly string[] }): LegendItem[] {
  const L = LEGEND;
  const out: LegendItem[] = [];
  // the automatic chip (W5.1 FR1): a box whose cells carry meaning (painted cells, groups or a legend) and whose
  // limitLabel has a number + unit ("memory.max 4GB" → "1 cell = 200 MB"); a plain fill box keeps its look
  const painted = !!(p.cells?.length || p.groups?.length || p.legend?.length);
  const chip = p.cellValue !== undefined && p.unitLabel !== undefined ? unitChipText(p.cellValue, p.unitLabel) : painted ? autoUnitChip(p.limitLabel) : null;
  if (chip) out.push({ kind: null, text: chip, w: Math.ceil(chip.length * L.px * 0.6 + 2 * L.chipPadX + 2) });
  for (const e of p.legend ?? []) out.push({ kind: e.kind, text: e.label, w: Math.ceil(L.swatch + L.swatchGap + e.label.length * L.px * 0.6) });
  (p.groups ?? []).forEach((g, i) => out.push({ kind: null, group: i, text: g.label, w: Math.ceil(L.swatch + L.swatchGap + g.label.length * L.px * 0.6) }));
  return out;
}

/** Items per row (greedy wrap at innerW). */
export function legendRows(items: readonly LegendItem[], innerW: number): LegendItem[][] {
  const rows: LegendItem[][] = [];
  let cur: LegendItem[] = [];
  let used = 0;
  for (const it of items) {
    const need = cur.length ? used + LEGEND.itemGap + it.w : it.w;
    if (cur.length && need > innerW) {
      rows.push(cur);
      cur = [it];
      used = it.w;
    } else {
      cur.push(it);
      used = need;
    }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** Height the legend adds below its anchor row (0 = no legend). */
export function legendHeight(rows: number): number {
  return rows ? LEGEND.gap + rows * LEGEND.rowH + (rows - 1) * LEGEND.rowGap : 0;
}

export const CONTAINER_BOX_STATES = ["neutral", "accent", "cgroup", "reclaim", "full", "killed", "freed", "dim"] as const;
export type ContainerBoxState = (typeof CONTAINER_BOX_STATES)[number];

/** Implied fill per state when `value` is absent (full is always 1, freed always 0, killed drains to 0). */
export const STATE_FILL: Record<ContainerBoxState, number> = {
  neutral: 0.35, accent: 0.35, cgroup: 0.35, reclaim: 0.9, full: 1, killed: 1, freed: 0, dim: 0.35,
};

// ── W7 v3: one source of truth — when cells are drawn, the cells ARE the bar ──────────────────────────────────

/** Cell kind a named group paints (group tone → kind). */
export const GROUP_CELL_KIND: Record<"danger" | "accent" | "used", CellKindT> = { danger: "danger", accent: "accent", used: "filled" };

/**
 * The 20 cells as drawn for these props in a held (settled) state, or null when the box has no explicit cells and no
 * groups (a plain fill box: `value` / the readout / STATE_FILL decide the bar). Cells past a short `cells` map follow
 * `fallbackFill` (the legacy rule: "missing cells follow value"); groups paint over both. Pure.
 */
export function boxCellMap(p: Pick<ContainerBoxPropsT, "cells" | "groups">, fallbackFill: number): CellKindT[] | null {
  if (!p.cells?.length && !p.groups?.some((g) => g.cells.length)) return null;
  const n = Math.round(Math.min(1, Math.max(0, fallbackFill)) * BOX_CELL_COUNT);
  const out: CellKindT[] = Array.from({ length: BOX_CELL_COUNT }, (_, i) => p.cells?.[i] ?? (i < n ? "filled" : "empty"));
  const owner = new Set<number>();
  for (const g of p.groups ?? []) for (const c of g.cells) if (c >= 0 && c < BOX_CELL_COUNT && !owner.has(c)) {
    owner.add(c);
    out[c] = GROUP_CELL_KIND[g.tone];
  }
  return out;
}

export const BOX_CELL_COUNT = 20;
const isUsed = (k: CellKindT) => k !== "empty" && k !== "freed";

/** The fill the props imply BEFORE cells are considered (v2 rule: an explicit "used / max" readout, else value, else
 *  the state's STATE_FILL). */
export function legacyFill(state: ContainerBoxState, p: Pick<ContainerBoxPropsT, "value" | "limitLabel">): number {
  const r = parseLimit(p.limitLabel);
  if (r && r.used !== null && r.max > 0) return Math.min(1, Math.max(0, r.used / r.max));
  return p.value ?? STATE_FILL[state];
}

/**
 * THE bar fill of a ContainerBox in a held state (W7 v3, spec §6.2): full / killed = 1 (all-red bar), freed = 0;
 * otherwise, when cells or groups are drawn, used cells / 20 (cells ∉ {empty, freed}) — `value` is then ignored, so
 * the bar can never disagree with the cells; else the v2 rule (legacyFill). The renderer (fillFor), the digest
 * (boxReadout), the mirror events (mirrorMeterEvents) and the lints all call this.
 */
export function boxFill(state: ContainerBoxState, p: Pick<ContainerBoxPropsT, "value" | "limitLabel" | "cells" | "groups">): number {
  if (state === "full" || state === "killed") return 1;
  if (state === "freed") return 0;
  const map = boxCellMap(p, legacyFill(state, p));
  return map ? map.filter(isUsed).length / BOX_CELL_COUNT : legacyFill(state, p);
}

/** Segmented bar runs (W7 v3): used cells grouped in the fixed order danger | accent | filled, as shares of the bar
 *  (5 red + 14 grey cells → [danger 0.25, filled 0.7]). [] = no cell map (one solid fill). */
export function barSegments(p: Pick<ContainerBoxPropsT, "value" | "limitLabel" | "cells" | "groups">, state: ContainerBoxState): { kind: "danger" | "accent" | "filled"; share: number }[] {
  if (state === "full" || state === "killed" || state === "freed" || state === "dim") return [];
  const map = boxCellMap(p, legacyFill(state, p));
  if (!map) return [];
  const out: { kind: "danger" | "accent" | "filled"; share: number }[] = [];
  for (const kind of ["danger", "accent", "filled"] as const) {
    const n = map.filter((k) => k === kind).length;
    if (n) out.push({ kind, share: n / BOX_CELL_COUNT });
  }
  return out;
}

/**
 * Value |authored − derived| above one cell: `value` is ignored because the cells decide the bar (L1 warning hook:
 * "value ignored: the cells decide the bar"). null = no conflict.
 */
export function ignoredValue(state: ContainerBoxState, p: Pick<ContainerBoxPropsT, "value" | "limitLabel" | "cells" | "groups">): { authored: number; drawn: number } | null {
  if (p.value === undefined || !boxCellMap(p, legacyFill(state, p))) return null;
  const drawn = boxFill(state, p);
  return Math.abs(p.value - drawn) > 1 / BOX_CELL_COUNT + 1e-9 ? { authored: p.value, drawn } : null;
}

// ── W7: Instance.mirrors — a Meter that shows a ContainerBox's quantity takes its value FROM the box ──────────────

/** A box action as the mirror needs it (= TrackEvent / resolved action shape). */
export interface MirrorSourceEvent {
  f: number;
  do: string;
  state?: string;
  props?: Record<string, unknown>;
}
export interface MirrorEvent {
  f: number;
  do: "state";
  state: "ok" | "full" | "empty";
  props: { value: number };
}

/** Keys each ContainerBox verb may override (= meta.verbs[*].props; repeated here so this helper has no meta cycle). */
const BOX_OVERRIDE_KEYS: Record<string, readonly string[]> = {
  state: ["value", "cells", "limitLabel", "subtitle", "meterLabel", "groups", "over"],
  countUp: ["value", "limitLabel", "over", "groups"],
  mark: ["cells", "groups"],
};

/**
 * Synthetic Meter `state` events that make a mirrored Meter follow a ContainerBox (spec §6.2 (ii)). Walks the box's
 * actions in frame order (base props + accepted overrides, the box's initial state) and emits, at EVERY frame the box's
 * held fill changes, `{ f, do: "state", state, props: { value } }` — state "full" when the box is full / killed (then
 * "empty" when the killed drain starts), "ok" otherwise. Plus the base value at frame 0 as `base`. The Meter tweens
 * 12 f, the same as the box's bar, so both move together. Pure; the timeline integration appends these to the mirror's
 * track (the World builds tracks from tl.events), so renderer, digest and lints see one value.
 */
export function mirrorMeterEvents(baseProps: Record<string, unknown>, initialState: string, events: readonly MirrorSourceEvent[]): { base: number; events: MirrorEvent[] } {
  const parsed = ContainerBoxProps.safeParse(baseProps);
  if (!parsed.success) return { base: 0, events: [] };
  let props: ContainerBoxPropsT = parsed.data;
  const asSt = (s: string): ContainerBoxState => ((CONTAINER_BOX_STATES as readonly string[]).includes(s) ? (s as ContainerBoxState) : "neutral");
  let st = asSt(initialState);
  const base = boxFill(st, props);
  let last = base;
  let lastState: MirrorEvent["state"] = st === "full" || st === "killed" ? "full" : "ok";
  const out: MirrorEvent[] = [];
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.f - b.e.f || a.i - b.i).map((x) => x.e);
  for (const e of sorted) {
    const keys = BOX_OVERRIDE_KEYS[e.do];
    if (e.props && keys) {
      const ok = Object.keys(e.props).every((k) => keys.includes(k));
      const r = ok ? ContainerBoxProps.safeParse({ ...props, ...e.props }) : null;
      if (r?.success) props = r.data;
    }
    if (e.do === "state" && e.state && (CONTAINER_BOX_STATES as readonly string[]).includes(e.state)) st = e.state as ContainerBoxState;
    if (e.do !== "state" && e.do !== "countUp" && e.do !== "mark") continue;
    const v = boxFill(st, props);
    const ms: MirrorEvent["state"] = st === "full" || st === "killed" ? "full" : "ok";
    if (Math.abs(v - last) > 1e-9 || ms !== lastState) {
      out.push({ f: e.f, do: "state", state: ms, props: { value: v } });
      last = v;
      lastState = ms;
    }
    if (st === "killed") {
      // the box's bar drains 8 f after the state change; the Meter empties with it
      out.push({ f: e.f + CONTAINER_BOX.drainDelayF, do: "state", state: "empty", props: { value: 0 } });
      last = 0;
      lastState = "empty";
    }
  }
  return { base, events: out };
}

/** Layout constants shared by footprint() and the Render (the footprint must stay honest). */
export const CONTAINER_BOX = {
  defaultW: 560,
  minW: 440,
  maxW: 952,
  pad: 36,
  titlePx: 44,
  titleLh: 52,
  subPx: 26,
  subLh: 34,
  subGap: 6,
  gridGap: 28, // above the grid
  cols: 5,
  rows: 4,
  cellH: 64,
  cellGap: 12,
  cellRadius: 10,
  meterGap: 26, // grid → meter row
  meterPx: 26,
  meterLh: 34,
  barGap: 12,
  barH: 24,
  /** The limit wall tick overhangs the track by this much above AND below (centred on the bar). */
  wallOverhang: 4,
  border: 2,
  tagGap: 24,
  /** Bar / cell tween after a value or state change (N-6: 12 f). */
  tweenF: 12,
  /** killed: the bar drains (and cells turn freed) over this many frames, starting 8 f after the state change. */
  drainDelayF: 8,
  drainF: 20,
} as const;

/** Vertical layout for these props (y of each row inside the box); `w` = the box width (legend wrapping). */
export function containerBoxLayout(p: Pick<ContainerBoxPropsT, "subtitle"> & Partial<Pick<ContainerBoxPropsT, "cellValue" | "unitLabel" | "legend" | "limitLabel" | "groups" | "cells">>, w: number = CONTAINER_BOX.defaultW) {
  const C = CONTAINER_BOX;
  const titleY = C.pad;
  const subY = titleY + C.titleLh + C.subGap;
  const gridY = (p.subtitle ? subY + C.subLh : titleY + C.titleLh) + C.gridGap;
  const gridH = C.rows * C.cellH + (C.rows - 1) * C.cellGap;
  const meterY = gridY + gridH + C.meterGap;
  const barY = meterY + C.meterLh + C.barGap;
  const legend = legendRows(legendItems(p), w - 2 * C.pad);
  const legendY = barY + C.barH + LEGEND.gap;
  const h = barY + C.barH + legendHeight(legend.length) + C.pad;
  return { titleY, subY, gridY, gridH, meterY, barY, legendY, legend, h };
}

/**
 * A limitLabel the meter row can count (W2.1): "310Mi / 512Mi" (explicit used / max) or "memory.max 512Mi" / "512Mi"
 * (limit only: the used count is read off the bar). The row always shows `${used}${mid}${max}${tail}`
 * ("179Mi / 512Mi"), from the first settled frame on, and the used count never exceeds `max`. null = a plain label.
 */
export interface LimitReadout {
  /** Explicit used count, null = follow the bar. */
  used: number | null;
  max: number;
  /** Text between the used count and max ("Mi / "). */
  mid: string;
  /** Text after max ("Mi"). */
  tail: string;
}

const READOUT_RE = /^(\d+)(\s?[A-Za-z]*\s*\/\s*)(\d+)(\s?[A-Za-z]*)$/;
const LIMIT_RE = /^(?:.*\s)?(\d+)(\s?[A-Za-z]+)$/;

export function parseLimit(label: string | undefined): LimitReadout | null {
  if (label === undefined) return null;
  const r = READOUT_RE.exec(label);
  if (r) return { used: Number(r[1]), max: Number(r[3]), mid: r[2], tail: r[4] };
  const l = LIMIT_RE.exec(label);
  if (l) return { used: null, max: Number(l[1]), mid: `${l[2]} / `, tail: l[2] };
  return null;
}

/** Number text without float noise ("0.75", "400", "1.25"). */
const numText = (x: number) => String(Number(x.toFixed(3)));

/**
 * W6: the meter row's used count + separator ("400 MB / ", "0.4 Gi / ", "179Mi / ") when the count is READ OFF THE BAR
 * (a limit-only label, or the killed drain). W5.1 oom: "limit 1 Gi" floored the used count to whole limit units, so
 * the row read "0 Gi / 1 Gi" over 8 lit cells and "1 Gi / 1 Gi" at 55 %. Now, in order:
 *   - cellValue + unitLabel set → lit cells × cellValue in the cell unit ("400 MB / 1 Gi"; = the "1 cell = 50 MB"
 *     chip × the cells the bar lights, so chip, cells and readout always agree);
 *   - a small limit (max < 10) → one decimal, floored ("0.4 Gi / 1 Gi"; never shows the limit before the bar hits it);
 *   - else the floored whole count ("179Mi / 512Mi").
 * An explicit "used / max" readout keeps its own unit while the killed drain empties it (whole counts, as before).
 * `fill` = the bar fill 0..1 (barFill / fillFor).
 */
export function limitLead(r: LimitReadout, fill: number, p: Partial<Pick<ContainerBoxPropsT, "cellValue" | "unitLabel">>): string {
  const f = Math.min(1, Math.max(0, fill));
  if (r.used === null && p.cellValue !== undefined && p.unitLabel !== undefined) {
    const cells = CONTAINER_BOX.cols * CONTAINER_BOX.rows;
    return `${numText(Math.round(f * cells - 1e-9) * p.cellValue)} ${p.unitLabel} / `;
  }
  if (r.used === null && r.max < 10) return `${(Math.floor(r.max * f * 10 + 1e-9) / 10).toFixed(1)}${r.mid}`;
  return `${Math.floor(r.max * f + 1e-9)}${r.mid}`;
}

/** Widest text the meter row's right side can show for this limitLabel (a readout's used count ≤ max digits; a
 *  limit-only count in the cell unit or with one decimal, W6). */
export function limitTextLen(label: string | undefined, p: Partial<Pick<ContainerBoxPropsT, "cellValue" | "unitLabel">> = {}): number {
  if (label === undefined) return 0;
  const r = parseLimit(label);
  if (!r) return label.length;
  const maxText = `${r.max}${r.tail}`;
  return Math.max(label.length, String(r.max).length + r.mid.length + maxText.length, limitLead(r, 1, p).length + maxText.length);
}

/** Conservative text widths (Inter 600 ≈ 0.62 em, JetBrains Mono = 0.6 em). */
export function containerBoxMinWidth(p: ContainerBoxPropsT): number {
  const C = CONTAINER_BOX;
  const mono = (s: string | undefined, px: number) => (s ? s.length * px * 0.6 : 0);
  const titleRow = p.title.length * C.titlePx * 0.62 + (p.tag ? C.tagGap + mono(p.tag, C.subPx) : 0);
  const subRow = mono(p.subtitle, C.subPx) * 1.04; // + 0.02em tracking
  const left = Math.max(p.meterLabel.length, p.fullLabel.length, p.killedLabel.length);
  const meterRow = left * C.meterPx * 0.6 + (p.limitLabel ? C.tagGap + limitTextLen(p.limitLabel, p) * C.meterPx * 0.6 : 0);
  const legendItem = Math.max(0, ...legendItems(p).map((i) => i.w));
  return Math.ceil(2 * C.pad + Math.max(titleRow, subRow, meterRow, legendItem));
}

export function containerBoxWidth(p: ContainerBoxPropsT, w: number | undefined): number {
  return Math.min(CONTAINER_BOX.maxW, Math.max(w ?? CONTAINER_BOX.defaultW, CONTAINER_BOX.minW, containerBoxMinWidth(p)));
}

export const meta = {
  name: "ContainerBox",
  version: 3,
  tier: "core",
  spec: "bible §6.5 (ProcessBox → ContainerBox, amendments §6, R7 generalisation #1)",
  summary: "Tall process/container card: title + mono subtitle, 5×4 memory cells and a memory bar that fills (with cells / groups the bar IS the cells: used / 20, segmented danger | accent | grey in the cells' colours; `value` is then ignored), goes red and pulses when full, then drains when killed; legend row (unit chip, swatch per kind / named group); groups draw cells solid/hatched/outline; `over` spills past the limit.",
  families: ["systems", "security", "outage", "data"],
  propsSchema: ContainerBoxProps,
  propsSchemaName: "ContainerBoxProps",
  example: { title: "checkout-api", subtitle: "one container · one cgroup", limitLabel: "memory.max 512Mi" },
  states: CONTAINER_BOX_STATES,
  initialState: (p) => (p.tone === "danger" ? "full" : p.tone),
  verbs: {
    enter: { durF: 13, does: "plate-first entrance (plateFade): spring y 24→0, scale 0.97→1; the plate is opaque before the cells and text fade in" },
    exit: { durF: 8, does: "content-first exit (plateFade): cells and text fade + blur 4 f on the opaque plate, then the plate 4 f" },
    state: {
      durF: 12,
      does: "neutral/accent: grey/lime fill · cgroup: the limit wall (2 px lime tick centred on the bar end + lime limitLabel until a countUp gives it a value) · reclaim: fill 0.9 (or the readout's used / max), cells flicker dashed as the kernel reclaims (still counted as used) · full: red border + dangerSurface, bar red and pulsing 0.7↔1 (used cells dimmed red), OUT OF MEMORY · killed: KILLED, bar drains (the used count with it) and cells turn dashed (freed) one by one · freed: all used cells dashed, bar 0 · dim: grey fill, title + labels textDim. Fill and used count tween 12 f on one ease; labels snap",
      props: ["value", "cells", "limitLabel", "subtitle", "meterLabel", "groups", "over"],
    },
    countUp: { durF: 12, does: "tween the bar (and the row-major cells, one per frame) to a new value; a \"used / max\" limitLabel counts with the bar on the same 12 f ease (never past max, unless `over` is set: then up to max × (1 + over)); props.over grows the hatched over-limit segment past the wall on the same ease", props: ["value", "limitLabel", "over", "groups"] },
    mark: { durF: 12, does: "flash the limit wall (bar end tick + limitLabel glow), or repaint cells when props.cells / props.groups is given (a group's newly added cells pop in its look)", props: ["cells", "groups"] },
    pulse: { durF: 12, does: "one inset glow flash in the state colour" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    glitch: { durF: 4, does: "4 f red/white tinted-copy glitch with slice displacement (counts toward the 0–3 budget)" },
  },
  focal: true,
  footprint: (p, w) => ({
    w: containerBoxWidth(p, w),
    h: containerBoxLayout(p, containerBoxWidth(p, w)).h,
  }),
  sfx: { state: "thud", countUp: "chatter", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof ContainerBoxProps>;
