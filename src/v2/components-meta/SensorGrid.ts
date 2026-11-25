// SensorGrid — W7 (spec research/notes/W7-library-spec.md §4.3, R7 N-19 MatrixGrid generalised into a sensor field).
// The top view of a capacitive touch panel (drive rows × sense columns), a fingerprint sensor, photosites, a keyboard
// matrix. Node levels are COMPUTED from the touches (gridLevels), never typed, so the drawn bump, the threshold outline,
// the centroid crosshair and the `auto` readout are one number set (L55).
//
//          sense columns →                   column label (mono 26 textDim)
//   d  ┼──■──■──■──■──■──■──■──┼             drive rows / sense columns = 2 px lines; nodes = rounded squares
//   r  ┼──■──■──▣──▣──■──■──■──┼             on bgRaised2 at every crossing; level → fill in the touch tone
//   i  ┼──■──▣──█──▣──■──■──■──┼             (opacity steps), `values` prints the digit; a touch = 2 px ring
//   v  ┼──■──■──▣──▣──■──■──■──┼             located: threshold outline, centroid crosshair, readout chip
//   [ col 3.6 · row 3.4 ]          ILLUSTRATIVE
//
// States: idle · scan (a drive row lights in turn, 6 f per row; with touches the levels appear row by row as the scan
// passes) · touch (levels tween 12 f) · located (outline → crosshair → readout) · dim. Discrete row steps: no
// continuous motion, no blur window. Renderer: remotion/v2/components/SensorGrid.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef, DrawnShape } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);
const Tag = z.enum(["illustrative", "notToScale", "simulated", "none"]);

export const TouchDef = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    size: z.enum(["small", "finger", "palm"]).default("finger"),
    /** danger = an unwanted touch (water drop, palm). */
    tone: Tone.default("accent"),
    label: z.string().min(1).max(14).optional(),
  })
  .strict();
export type TouchDefT = z.output<typeof TouchDef>;

export const SensorGridProps = z
  .object({
    title: z.string().min(1).max(28).optional(),
    cols: z.number().int().min(4).max(10).default(8),
    rows: z.number().int().min(4).max(10).default(8),
    rowLabel: z.string().min(1).max(12).optional(),
    colLabel: z.string().min(1).max(16).optional(),
    /** Touches in grid space 0..1. Node levels are computed: round(9·exp(−d²/2σ²)), σ by size. */
    touches: z.array(TouchDef).max(2).default([]),
    show: z.enum(["level", "values"]).default("level"),
    /** W7.1 what a node shows. "level" (default): signal strength, a touch fills nodes brighter. "delta": a mutual-
     *  capacitance panel — every crossing starts at a grey baseline and a touch DROPS it: touched nodes go dark, `values`
     *  prints "−8", a legend row reads "Δ capacitance  0 → −9" and the auto readout leads with the drop. Use delta when
     *  the narration says the capacitance / field drops. Base props only (it decides the legend row). */
    measure: z.enum(["level", "delta"]).default("level"),
    /** W7.1 field overlay: a dashed ring around every crossing (the drive → sense field) that fades where the finger
     *  takes it away. */
    field: z.boolean().default(false),
    /** Nodes with level ≥ threshold are outlined in `located`; the centroid is their level-weighted mean. */
    threshold: z.number().int().min(1).max(9).default(5),
    /** Readout chip in `located`: "auto" prints the computed centroid ("col 5.2 · row 3.1", grid units). */
    readout: z.union([z.literal("auto"), z.string().min(1).max(20)]).optional(),
    /** W7.2 state `zoom`: the crossing to magnify (1-based col / row). Unset: the node under the first touch. */
    zoomAt: z.object({ col: z.number().int().min(1).max(10), row: z.number().int().min(1).max(10) }).strict().optional(),
    tag: Tag.default("illustrative"),
  })
  .strict();

export type SensorGridPropsT = z.output<typeof SensorGridProps>;

export const SENSOR_GRID = {
  defaultW: 860,
  minW: 600,
  maxW: 952,
  pad: 36,
  border: 2,
  titlePx: 44,
  titleLh: 52,
  titleGap: 16,
  headerH: 48,
  gutter: 52,
  pitchMax: 88,
  nodeK: 0.73,
  lineW: 2,
  scanLineW: 5,
  smallPx: 26,
  valuePx: 28,
  bottomGap: 24,
  chipH: 48,
  chipPx: 28,
  /** σ in units of the grid's larger side (spec: small 0.06, finger 0.10, palm 0.22). */
  sigma: { small: 0.06, finger: 0.1, palm: 0.22 },
  scanStepF: 6,
  tweenF: 12,
  enterDiagF: 1,
} as const;

const G = SENSOR_GRID;
const mono = (chars: number, px: number) => chars * px * 0.6;

export const GRID_TAG_TEXT: Record<z.output<typeof Tag>, string> = { illustrative: "ILLUSTRATIVE", notToScale: "NOT TO SCALE", simulated: "SIMULATED", none: "" };

// ── number truth (L55): ONE function for levels, outline, centroid and readout ───────────────────────────────────

export interface GridCluster {
  /** Level-weighted centroid, 1-based node units ("col 5.2"). */
  col: number;
  row: number;
  /** Nodes ≥ threshold in this cluster, as [c, r] (0-based). */
  nodes: [number, number][];
  /** Tone of the touch closest to the centroid. */
  tone: "accent" | "danger" | "neutral" | "dim";
  /** Index of that touch. */
  touch: number;
}

export interface GridLevels {
  /** levels[r][c], 0..9. */
  levels: number[][];
  clusters: GridCluster[];
  /** Strongest level and the readout text `auto` prints. */
  max: number;
  auto: string;
}

/** σ of a touch in node units. */
export const touchSigma = (t: Pick<TouchDefT, "size">, cols: number, rows: number) => G.sigma[t.size] * Math.max(cols, rows);

/** Node levels, threshold clusters (4-connected) and their centroids. Pure; renderer, digest and lints share it. */
export function gridLevels(p: Pick<SensorGridPropsT, "cols" | "rows" | "touches" | "threshold">): GridLevels {
  const { cols, rows } = p;
  const levels: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (const t of p.touches) {
        const s = touchSigma(t, cols, rows);
        const dx = c + 0.5 - t.x * cols;
        const dy = r + 0.5 - t.y * rows;
        v = Math.max(v, 9 * Math.exp(-(dx * dx + dy * dy) / (2 * s * s)));
      }
      row.push(Math.round(v));
    }
    levels.push(row);
  }
  const seen = new Set<string>();
  const clusters: GridCluster[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (levels[r][c] < p.threshold || seen.has(`${c},${r}`)) continue;
      const nodes: [number, number][] = [];
      const stack: [number, number][] = [[c, r]];
      seen.add(`${c},${r}`);
      while (stack.length) {
        const [x, y] = stack.pop()!;
        nodes.push([x, y]);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]) {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(`${nx},${ny}`) || levels[ny][nx] < p.threshold) continue;
          seen.add(`${nx},${ny}`);
          stack.push([nx, ny]);
        }
      }
      nodes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      let sw = 0;
      let sx = 0;
      let sy = 0;
      for (const [x, y] of nodes) {
        const wgt = levels[y][x];
        sw += wgt;
        sx += wgt * (x + 1);
        sy += wgt * (y + 1);
      }
      const col = sx / sw;
      const row = sy / sw;
      let best = 0;
      let bd = Infinity;
      p.touches.forEach((t, i) => {
        const d = (t.x * cols + 0.5 - col) ** 2 + (t.y * rows + 0.5 - row) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      clusters.push({ col, row, nodes, tone: p.touches[best]?.tone ?? "accent", touch: best });
    }
  }
  const max = Math.max(0, ...levels.flat());
  const auto = clusters.length === 0 ? "no touch" : clusters.length === 1 ? `col ${clusters[0].col.toFixed(1)} · row ${clusters[0].row.toFixed(1)}` : `${clusters.length} touches found`;
  return { levels, clusters, max, auto };
}

/** The crossing state `zoom` magnifies (1-based): zoomAt, else the node nearest the first touch, else the centre. */
export function zoomCrossing(p: Pick<SensorGridPropsT, "cols" | "rows" | "touches" | "zoomAt">): { col: number; row: number } {
  const clampN = (v: number, n: number) => Math.min(n, Math.max(1, v));
  if (p.zoomAt) return { col: clampN(p.zoomAt.col, p.cols), row: clampN(p.zoomAt.row, p.rows) };
  const t = p.touches[0];
  if (t) return { col: clampN(Math.floor(t.x * p.cols) + 1, p.cols), row: clampN(Math.floor(t.y * p.rows) + 1, p.rows) };
  return { col: Math.ceil(p.cols / 2), row: Math.ceil(p.rows / 2) };
}

/** Close-up field rings drawn around the zoomed crossing, and how many of them a touch on it takes away (level 9 →
 *  all but one): the digest and the renderer share it. */
export const ZOOM_RINGS = 3;
export function zoomRingsLeft(level: number): number {
  return ZOOM_RINGS - Math.floor(((ZOOM_RINGS - 1) * Math.min(9, Math.max(0, level))) / 9 + 1e-9);
}

/** A drop of `level` printed as a signed delta ("0", "−8"; U+2212, covered by both v2 fonts). */
export const deltaText = (level: number) => (Math.round(level) <= 0 ? "0" : `\u2212${Math.round(level)}`);
/** The delta legend's label (library text; the fonts carry Δ, director strings still may not: L19). */
export const DELTA_LEGEND = "\u0394 capacitance";

/** Node deltas (≤ 0) of a delta-mode grid: −level. Same numbers as gridLevels (one source of truth, L55). */
export function gridDeltas(p: Pick<SensorGridPropsT, "cols" | "rows" | "touches" | "threshold">): number[][] {
  return gridLevels(p).levels.map((row) => row.map((v) => (v === 0 ? 0 : -v)));
}

/** auto readout: level mode "col 5.2 · row 3.1"; delta mode "−8 at col 5.2 · row 3.1" (the drop leads). */
function autoText(p: Pick<SensorGridPropsT, "cols" | "rows" | "touches" | "threshold" | "measure">): string {
  const g = gridLevels(p);
  if (p.measure !== "delta" || g.clusters.length !== 1) return g.auto;
  return `${deltaText(g.max)} at ${g.auto}`;
}

/** The readout text drawn in `located` (null = no chip). */
export const readoutText = (p: Pick<SensorGridPropsT, "readout" | "cols" | "rows" | "touches" | "threshold"> & { measure?: SensorGridPropsT["measure"] }) =>
  p.readout === undefined ? null : p.readout === "auto" ? autoText({ ...p, measure: p.measure ?? "level" }) : p.readout;

// ── layout ───────────────────────────────────────────────────────────────────────────────────────────────────────

const tagW = (tag: SensorGridPropsT["tag"]) => (tag === "none" ? 0 : Math.ceil(mono(GRID_TAG_TEXT[tag].length, G.smallPx) + 2 * 12 + 2));
const chipW = (text: string | null) => (text ? Math.ceil(mono(text.length, G.chipPx) + 2 * 18 + 4) : 0);
/** Widest readout chip: a typed one, or the longest auto text ("col 10.0 · row 10.0"). */
const widestChip = (p: SensorGridPropsT) => (p.readout === undefined ? 0 : chipW(p.readout === "auto" ? (p.measure === "delta" ? "-9 at col 10.0 · row 10.0" : "col 10.0 · row 10.0") : p.readout));
/** Delta legend row width: label + two mini nodes + the arrow; field entry when the base has the overlay. */
export const DELTA_ROW = { mini: 44, gap: 16, arrow: 34 } as const;
export function deltaRowW(p: Pick<SensorGridPropsT, "measure" | "field">): number {
  let w = 0;
  if (p.measure === "delta") w += mono(DELTA_LEGEND.length, G.smallPx) + DELTA_ROW.gap + 2 * DELTA_ROW.mini + 2 * DELTA_ROW.gap + DELTA_ROW.arrow;
  if (p.field) w += (w ? 40 : 0) + 30 + 10 + mono(5, G.smallPx);
  return Math.ceil(w);
}

export function sensorGridMinWidth(p: SensorGridPropsT): number {
  const gut = p.rowLabel ? G.gutter : 0;
  const grid = gut + p.cols * 64;
  const bottom = widestChip(p) + 24 + tagW(p.tag);
  const title = p.title ? p.title.length * G.titlePx * 0.62 : 0;
  const head = p.colLabel ? mono(p.colLabel.length + 2, G.smallPx) : 0;
  return Math.ceil(Math.max(G.minW, grid, bottom, title, head, deltaRowW(p)) + 2 * G.pad);
}

export function sensorGridWidth(p: SensorGridPropsT, w: number | undefined): number {
  return Math.min(G.maxW, Math.max(w ?? G.defaultW, sensorGridMinWidth(p)));
}

export interface GridLayout {
  w: number;
  h: number;
  titleY: number | null;
  headerY: number | null;
  gridX: number;
  gridY: number;
  pitch: number;
  node: number;
  bottomY: number | null;
  /** Touch-label legend row (values mode: labels never sit on the digits), null = labels pin to their rings. */
  legendY: number | null;
  /** W7.1 delta / field legend row ("Δ capacitance  [0] → [−9]", "field"), null = none. */
  deltaY: number | null;
}

/** Labels go to a legend row under the grid when the digits are shown (base props decide the box). */
export const labelsInLegend = (p: Pick<SensorGridPropsT, "show" | "touches">) => p.show === "values" && p.touches.some((t) => t.label);

export function sensorGridLayout(p: SensorGridPropsT, w: number): GridLayout {
  const gut = p.rowLabel ? G.gutter : 0;
  const avail = w - 2 * G.pad - gut;
  const pitch = Math.min(G.pitchMax, avail / p.cols);
  const node = Math.round(pitch * G.nodeK);
  let y = G.pad;
  const titleY = p.title ? y : null;
  if (p.title) y += G.titleLh + G.titleGap;
  const headerY = p.colLabel ? y : null;
  if (p.colLabel) y += G.headerH;
  const gridX = G.pad + gut + (avail - p.cols * pitch) / 2;
  const gridY = y;
  y += p.rows * pitch;
  const legendY = labelsInLegend(p) ? y + G.bottomGap : null;
  if (legendY !== null) y += G.bottomGap + 40;
  const deltaY = p.measure === "delta" || p.field ? y + G.bottomGap : null;
  if (deltaY !== null) y += G.bottomGap + DELTA_ROW.mini;
  const bottom = p.readout !== undefined || p.tag !== "none";
  const bottomY = bottom ? y + G.bottomGap : null;
  if (bottom) y += G.bottomGap + G.chipH;
  return { w, h: Math.ceil(y + G.pad), titleY, headerY, gridX, gridY, pitch, node, bottomY, legendY, deltaY };
}

/** Centre of node (c, r) and the world point of a touch (footprint-relative). */
export const nodeCentre = (lay: GridLayout, c: number, r: number) => ({ x: lay.gridX + (c + 0.5) * lay.pitch, y: lay.gridY + (r + 0.5) * lay.pitch });
export const gridPoint = (lay: GridLayout, p: Pick<SensorGridPropsT, "cols" | "rows">, x: number, y: number) => ({ x: lay.gridX + x * p.cols * lay.pitch, y: lay.gridY + y * p.rows * lay.pitch });

export const meta = {
  name: "SensorGrid",
  version: 2,
  tier: "p0",
  spec: "W7 library spec §4.3 (R7 N-19 MatrixGrid → sensor field)",
  summary: "Electrode matrix (drive rows × sense columns, a node per crossing): scan (rows light in turn), touch (COMPUTED bump of levels 0–9 per touch, a fingertip outline), located (threshold outline → centroid crosshair → readout \"col 5.2 · row 3.1\"), zoom (close-up of ONE crossing: its field rings, its drop); measure \"delta\" = capacitance DROPS (touched nodes go dark and shrink, −8); field = dashed ring per crossing, fading under the finger; danger touch = false touch (water drop); final = last live state (CTA).",
  families: ["science", "data", "systems"],
  propsSchema: SensorGridProps,
  propsSchemaName: "SensorGridProps",
  example: { rowLabel: "drive", colLabel: "sense", touches: [{ x: 0.42, y: 0.4 }], measure: "delta", readout: "auto" },
  states: ["idle", "scan", "touch", "located", "zoom", "dim", "final"],
  verbs: {
    enter: { durF: 34, does: "plate-first entrance (plateFade), then the nodes fade in on a diagonal wave (1 f per diagonal)" },
    exit: { durF: 8, does: "content fades + blurs 4 f on the opaque plate, then the plate 4 f" },
    state: {
      durF: 24,
      does: "idle: grid, all levels 0 · scan: a drive row lights in turn (6 f per row, looping); with touches each row shows its levels once the scan has passed it · touch: the bump appears (levels tween 12 f, digits step with them) · located: nodes ≥ threshold outlined (0 f), the centroid crosshair draws (6 f), the readout chip pops (12 f) · zoom: the grid magnifies into ONE crossing (14 f): its drive row and sense column, its field rings (a touch takes them away) and its level / drop, large · dim: all textDim · final (CTA): back to the last live (non idle / dim) state with its props, so 'Follow' lands on the climax picture",
      props: ["touches", "show", "threshold", "readout", "rowLabel", "colLabel", "field", "zoomAt"],
    },
    mark: { durF: 60, does: "one full scan sweep (6 f per drive row) in any state" },
    pulse: { durF: 12, does: "the touch rings pulse once" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    scramble: { durF: 8, does: "the level digits re-roll to their current values (show values)" },
  },
  focal: true,
  footprint: (p, w) => {
    const W = sensorGridWidth(p, w);
    return { w: W, h: sensorGridLayout(p, W).h };
  },
  shape: (p, w): DrawnShape => {
    const W = sensorGridWidth(p, w);
    const lay = sensorGridLayout(p, W);
    const parts: DrawnShape["parts"] = [{ part: "", x: 0, y: 0, w: W, h: lay.h }];
    for (let r = 0; r < p.rows; r++) {
      parts.push({ part: `row:${r}`, x: lay.gridX, y: lay.gridY + r * lay.pitch, w: p.cols * lay.pitch, h: lay.pitch });
      for (let c = 0; c < p.cols; c++) {
        const q = nodeCentre(lay, c, r);
        parts.push({ part: `node:${c},${r}`, x: q.x - lay.node / 2, y: q.y - lay.node / 2, w: lay.node, h: lay.node });
      }
    }
    p.touches.forEach((t, i) => {
      const q = gridPoint(lay, p, t.x, t.y);
      const s = touchSigma(t, p.cols, p.rows) * lay.pitch * 1.4;
      parts.push({ part: `touch:${i}`, x: q.x - s, y: q.y - s, w: 2 * s, h: 2 * s });
    });
    const g = gridLevels(p);
    if (g.clusters[0]) {
      const q = { x: lay.gridX + (g.clusters[0].col - 0.5) * lay.pitch, y: lay.gridY + (g.clusters[0].row - 0.5) * lay.pitch };
      parts.push({ part: "centroid", x: q.x - lay.pitch, y: q.y - lay.pitch, w: 2 * lay.pitch, h: 2 * lay.pitch });
    }
    return { parts };
  },
  sfx: { mark: "chatter", state: "tick", scramble: "chatter" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof SensorGridProps>;
