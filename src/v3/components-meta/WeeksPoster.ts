// WeeksPoster — a drawn, printed life-in-weeks wall poster (2026-11-10, after rs-20261109-25f1a4: a memento-mori reel
// had only the v2 10 × 10 UnitGrid, so the shares of a life were never drawn and the critic failed every board). One
// box per week, one row per year (52 a row; a year is 52 weeks and a day or two), 90 rows by default = 4,680 boxes.
// Generic calendar grid, own work: no Wait But Why title, layout text or branding.
//
//   ┌ paper (cream, 2 tape strips) ─────────────────────────┐
//   │ TITLE                                     2,808 weeks │   title (poster's own text) · counter (= boxes drawn)
//   │ [■ sleep] [■ work] [■ screens]                         │   legend chips: one per segment (≤ 3 a row)
//   │    ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢ │   52 boxes a row, a 10 px gap every 10 rows,
//   │ 10 ▢▢▢ …                                               │   year labels every 10 rows in the left gutter
//   │  ▸ ■ you-are-here …                                    │
//   │ 1 box = 1 week                              APPROX     │
//   └────────────────────────────────────────────────────────┘
//
// Segments are SHARES of a life packed into contiguous blocks in row order (pack "life": from the first box, whole-life
// totals; "ahead": from you-are-here on), NOT the weeks they happen in; the describe line says so.
// States (cumulative; initial = props.show, drawn at frame 0 with no wave): blank → seg1 … seg6 (segment k fills in ONE
// wave of ≤ 20 f, chained after k − 1) → empty (the boxes still left light up lime, the shares step back) · dim. A jump
// of several levels chains the waves, the whole chain scaled to ≤ 20 f, so a fill started at {ref: "keyword",
// offsetF: -14} is always done at the still (keyword + 6). Going down a level clears the boxes over 8 f. Props on the
// state verb: showHere (you-are-here at `age`, the lived weeks greyed, 14 f wave), counter, counterLabel.
// One pure model (posterRanges / fillAt / livedAt / counterAt) for the renderer, describe, the anchors, lint A18 and the
// tests. Runtime imports: zod only.
import { z } from "zod";
import type { AnchorMap, AnimWindow, V3MetaDef } from "./_types.js";

export const POSTER = {
  w: 900,
  /** paper = (0, 0, w − shadow, H − shadow); the offset shadow fills the rest */
  shadow: 8,
  pad: 36,
  /** grid left edge (the year-label gutter is left of it) */
  gridX: 92,
  pitch: 14.5,
  cell: 11.5,
  gap: 3,
  decadeGap: 10,
  cols: 52,
  titleRowY: 36,
  titlePx: 52,
  counterPx: 60,
  counterLabelPx: 26,
  legendY: 116,
  legendRowH: 52,
  legendPerRow: 3,
  chipH: 44,
  legendPx: 28,
  yearPx: 30,
  scalePx: 24,
  bottom: 52,
  /** frames: one segment's wave is 12–20 f, a whole chain ≤ waveMaxF */
  waveMinF: 12,
  waveMaxF: 20,
  livedF: 14,
  emptyF: 16,
  clearF: 8,
  stepBackF: 12,
  /** the CLEAR window a full view must fit (y, screen px): past the header band's fade (218–320, ~10 % left at 300) →
   *  before the caption scrim ramps in (CaptionScrim top 1220, faint at 1240); the old 218–1400 put the title, counter
   *  and the last rows under both fades */
  viewTop: 300,
  viewBottom: 1240,
  /** full-view on-screen height (≤ the window, 6 px margin top and bottom) */
  viewH: 928,
} as const;

export const WEEK_TONES = ["ink", "red", "blue", "ochre", "teal", "plum"] as const;
export const WEEKS_LEVELS = ["blank", "seg1", "seg2", "seg3", "seg4", "seg5", "seg6", "empty"] as const;
export const WEEKS_STATES = [...WEEKS_LEVELS, "dim"] as const;
export const WEEKS_TAG_TEXT = { approx: "APPROX", illustrative: "ILLUSTRATIVE", none: "" } as const;

/** Boxes of one segment: weeks, or years × 52 rounded. */
export const segWeeks = (s: { weeks?: number; years?: number }) => s.weeks ?? Math.round((s.years ?? 0) * 52);

const WeekSegment = z
  .object({
    /** legend chip + anchor label: words the voice says */
    label: z.string().min(1).max(12),
    /** boxes to fill; give weeks OR years (years × 52, rounded) */
    weeks: z.number().int().min(1).max(5200).optional(),
    years: z.number().min(0.1).max(100).optional(),
    /** print ink; default by index: ink, red, blue, ochre, teal, plum */
    tone: z.enum(WEEK_TONES).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if ((s.weeks === undefined) === (s.years === undefined)) ctx.addIssue({ code: "custom", path: ["weeks"], message: "give weeks OR years (years × 52 = boxes), not both" });
  });

export const WeeksPosterProps = z
  .object({
    /** rows = years of the life drawn (a CHOSEN length, not a fact; describe says so). Fixes the footprint. */
    years: z.number().int().min(60).max(100).default(90),
    /** printed title, top-left (the poster's own text); none = no title */
    title: z.string().min(1).max(24).optional(),
    /** filled in order, contiguous, row-major; ≤ 6 (footprint: 1 legend row for ≤ 3, 2 rows for 4–6) */
    segments: z.array(WeekSegment).max(6).default([]),
    /** life = whole-life totals packed from box 0 ("all together, sleep is 26 years"); ahead = packed from you-are-here
     *  on ("of the weeks you have left") */
    pack: z.enum(["life", "ahead"]).default("life"),
    /** you-are-here age in years → week round(age × 52) */
    age: z.number().min(0).max(100).optional(),
    /** you-are-here marker + the lived weeks greyed (a state-verb props override fades it in with its own wave) */
    showHere: z.boolean().default(false),
    /** counter in the top band; counts in step with the boxes drawn (always = what is visible) */
    counter: z.enum(["none", "filled", "lived", "left", "empty"]).default("none"),
    counterLabel: z.string().min(1).max(18).default("weeks"),
    legend: z.boolean().default(true),
    /** state at frame 0, drawn already (no wave) */
    show: z.enum(WEEKS_LEVELS).default("blank"),
    tag: z.enum(["approx", "illustrative", "none"]).default("approx"),
  })
  .strict()
  .superRefine((p, ctx) => {
    const T = p.years * 52;
    const here = p.age === undefined ? 0 : Math.round(p.age * 52);
    const S = p.segments.reduce((a, s) => a + segWeeks(s), 0);
    if (p.age !== undefined && p.age > p.years) ctx.addIssue({ code: "custom", path: ["age"], message: `age ${p.age} is past the poster's ${p.years} years` });
    if ((p.showHere || p.pack === "ahead" || p.counter === "lived" || p.counter === "left") && p.age === undefined) ctx.addIssue({ code: "custom", path: ["age"], message: "showHere / pack ahead / counter lived|left need age" });
    const room = p.pack === "ahead" ? T - here : T;
    if (S > room) ctx.addIssue({ code: "custom", path: ["segments"], message: `segments add up to ${S} boxes; only ${room} fit (pack ${p.pack})` });
    const k = /^seg(\d)$/.exec(p.show)?.[1];
    if (k && +k > p.segments.length) ctx.addIssue({ code: "custom", path: ["show"], message: `show ${p.show} but only ${p.segments.length} segments` });
  });
export type WeeksPosterPropsT = z.output<typeof WeeksPosterProps>;

// ── pure model ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PosterSeg {
  label: string;
  tone: (typeof WEEK_TONES)[number];
  /** box range [a, b) */
  a: number;
  b: number;
  weeks: number;
}
type RangeP = Pick<WeeksPosterPropsT, "years" | "segments" | "pack" | "age">;

/** Total boxes, the you-are-here box, and each segment's contiguous range (row-major, in spoken order). */
export function posterRanges(p: RangeP): { T: number; here: number; segs: PosterSeg[] } {
  const T = p.years * 52;
  const here = p.age === undefined ? 0 : Math.min(T - 1, Math.round(p.age * 52));
  let at = p.pack === "ahead" ? here : 0;
  const segs = p.segments.map((s, i) => {
    const w = segWeeks(s);
    const a = Math.min(T, at);
    const b = Math.min(T, at + w);
    at = b;
    return { label: s.label, tone: s.tone ?? WEEK_TONES[i % WEEK_TONES.length], a, b, weeks: b - a };
  });
  return { T, here, segs };
}

/** The boxes "you still choose": life = after the shares (and after you-are-here when it is shown), ahead = after
 *  you-are-here + the shares. [a, b), possibly empty. */
export function emptyRange(p: RangeP & Pick<WeeksPosterPropsT, "showHere">): { a: number; b: number } {
  const r = posterRanges(p);
  const sEnd = r.segs.length ? r.segs[r.segs.length - 1].b : p.pack === "ahead" ? r.here : 0;
  const a = p.pack === "ahead" ? sEnd : Math.max(sEnd, p.showHere && p.age !== undefined ? r.here : 0);
  return { a: Math.min(r.T, a), b: r.T };
}

/** One segment's own fill length (frames): bigger shares take a little longer, 12–20 f. */
export const waveF = (weeks: number) => Math.max(POSTER.waveMinF, Math.min(POSTER.waveMaxF, 10 + Math.round(2 * Math.log2(1 + weeks / 52))));

const ease = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};

/** Level of a state name for n segments: blank 0, segK K (capped at n), empty n + 1; null = dim / unknown. */
export function levelOf(state: string | undefined, n: number): number | null {
  if (state === "blank") return 0;
  if (state === "empty") return n + 1;
  const k = /^seg(\d)$/.exec(state ?? "")?.[1];
  return k ? Math.min(+k, n) : null;
}

export interface PosterEvent {
  f: number;
  do: string;
  state?: string;
  props?: Record<string, unknown>;
}
interface Wave {
  start: number;
  dur: number;
  /** cleared from this frame (8 f) */
  clear: number;
  /** frame of the state event that started this wave's chain */
  eventF: number;
  /** the chain waited for an earlier fill that ran until this frame (> eventF), else undefined */
  queuedTo?: number;
}
export interface PosterFill {
  /** 0..1 per segment (the share of its boxes drawn) */
  seg: number[];
  /** 0..1: the empty-box highlight */
  empty: number;
  /** frame the empty highlight started (step-back of the shares), null = not in empty (and its clear is over) */
  emptyF: number | null;
  /** frame the empty highlight started clearing (state went down from empty), null = not clearing */
  emptyClear: number | null;
  /** the level reached by the latest state (dim keeps it) */
  level: number;
  dim: boolean;
}

/** Waves of every segment + the empty highlight from the initial level and the state events (shared by fillAt and
 *  animWindows). A jump of several levels chains its waves back to back, the whole chain scaled to ≤ waveMaxF. */
function posterWaves(p: RangeP, initial: string, events: readonly PosterEvent[]): { segs: Wave[][]; empty: Wave[]; final: { level: number; dim: boolean }; dimF: number[] } {
  const r = posterRanges(p);
  const n = r.segs.length;
  const segs: Wave[][] = r.segs.map(() => []);
  const empty: Wave[] = [];
  let level = levelOf(initial, n) ?? 0;
  for (let k = 0; k < Math.min(level, n); k++) segs[k].push({ start: -1e6, dur: 1, clear: Infinity, eventF: -1e6 });
  if (level === n + 1) empty.push({ start: -1e6, dur: 1, clear: Infinity, eventF: -1e6 });
  let dim = false;
  const dimF: number[] = [];
  /** the end frame of the newest running wave (a new segment never starts before the one before it is full) */
  let busyTo = -1e6;
  for (const e of events) {
    if (e.do !== "state" || !e.state) continue;
    if (e.state === "dim") {
      if (!dim) dimF.push(e.f);
      dim = true;
      continue;
    }
    const L = levelOf(e.state, n);
    if (L === null) continue;
    dim = false;
    if (L > level) {
      const parts: { kind: "seg" | "empty"; k: number; dur: number }[] = [];
      for (let k = level; k < Math.min(L, n); k++) parts.push({ kind: "seg", k, dur: waveF(r.segs[k].weeks) });
      if (L === n + 1) parts.push({ kind: "empty", k: -1, dur: POSTER.emptyF });
      const total = parts.reduce((a, x) => a + x.dur, 0);
      const scale = total > POSTER.waveMaxF ? POSTER.waveMaxF / total : 1;
      let t = Math.max(e.f, busyTo);
      const queuedTo = busyTo > e.f ? busyTo : undefined;
      for (const x of parts) {
        const w: Wave = { start: t, dur: Math.max(1, x.dur * scale), clear: Infinity, eventF: e.f, ...(queuedTo !== undefined ? { queuedTo } : {}) };
        if (x.kind === "seg") segs[x.k].push(w);
        else empty.push(w);
        t += w.dur;
      }
      busyTo = t;
    } else if (L < level) {
      for (let k = L; k < Math.min(level, n); k++) {
        const w = segs[k][segs[k].length - 1];
        if (w && w.clear === Infinity) w.clear = e.f;
      }
      if (level === n + 1) {
        const w = empty[empty.length - 1];
        if (w && w.clear === Infinity) w.clear = e.f;
      }
    }
    level = L;
  }
  return { segs, empty, final: { level, dim }, dimF };
}

const waveProg = (ws: readonly Wave[], frame: number) => {
  const w = [...ws].reverse().find((x) => x.start <= frame);
  if (!w) return 0;
  const on = ease((frame - w.start) / w.dur);
  return frame >= w.clear ? on * (1 - ease((frame - w.clear) / POSTER.clearF)) : on;
};

/** Fill state at `frame` from the initial state + the instance's state events (frame order). */
export function fillAt(p: RangeP, initial: string, events: readonly PosterEvent[], frame: number): PosterFill {
  const upTo = events.filter((e) => e.f <= frame);
  const W = posterWaves(p, initial, upTo);
  const ew = [...W.empty].reverse().find((x) => x.start <= frame);
  const live = !!ew && frame < ew.clear + POSTER.clearF;
  return {
    seg: W.segs.map((ws) => waveProg(ws, frame)),
    empty: waveProg(W.empty, frame),
    emptyF: live ? ew!.start : null,
    emptyClear: live && frame >= ew!.clear ? ew!.clear : null,
    level: W.final.level,
    dim: W.final.dim,
  };
}

/** 0..1: how far the shares step back behind the empty highlight (in over stepBackF from its start; back out over clearF,
 *  in step with the highlight, when the state goes down from empty: no one-frame pop). */
export function stepBackAt(fill: Pick<PosterFill, "emptyF" | "emptyClear">, frame: number): number {
  if (fill.emptyF === null) return 0;
  const on = Math.min(1, Math.max(0, (frame - fill.emptyF) / POSTER.stepBackF));
  return fill.emptyClear === null ? on : on * (1 - ease((frame - fill.emptyClear) / POSTER.clearF));
}

/** Lived-weeks progress 0..1: showHere switched on by a props override waves in from that frame (14 f); on from the
 *  base props = drawn from frame 0. `showHere` = the props in force at the frame (the renderer's p.showHere). */
export function livedAt(base: Pick<WeeksPosterPropsT, "showHere">, events: readonly PosterEvent[], frame: number, showHere: boolean): number {
  if (!showHere) return 0;
  let on = base.showHere ? -1e6 : Infinity;
  let cur = base.showHere;
  for (const e of events) {
    if (e.f > frame) break;
    if (e.do !== "state" || !e.props || typeof e.props.showHere !== "boolean") continue;
    if (e.props.showHere && !cur) on = e.f;
    cur = e.props.showHere;
  }
  return Number.isFinite(on) ? ease((frame - on) / POSTER.livedF) : 1;
}

/** Boxes drawn per segment / lived / empty highlight at a fill (the renderer draws exactly these counts). */
export function drawnCounts(p: RangeP & Pick<WeeksPosterPropsT, "showHere">, fill: Pick<PosterFill, "seg" | "empty">, lived: number): { seg: number[]; lived: number; empty: number } {
  const r = posterRanges(p);
  const e = emptyRange(p);
  return { seg: r.segs.map((s, k) => Math.round((fill.seg[k] ?? 0) * s.weeks)), lived: p.age === undefined ? 0 : Math.round(r.here * lived), empty: Math.round(fill.empty * (e.b - e.a)) };
}

/** Counter value (an integer, always what is visible): filled = boxes of the shares drawn, lived = lived boxes greyed,
 *  left = boxes after the lived ones, empty = boxes not taken by a drawn share or a lived week (counts DOWN). */
export function counterAt(p: WeeksPosterPropsT, fill: Pick<PosterFill, "seg" | "empty">, lived: number): number {
  const r = posterRanges(p);
  const d = drawnCounts(p, fill, lived);
  if (p.counter === "filled") return d.seg.reduce((a, x) => a + x, 0);
  if (p.counter === "lived") return d.lived;
  if (p.counter === "left") return r.T - d.lived;
  if (p.counter === "empty") {
    const iv = r.segs.map((s, k) => [s.a, s.a + d.seg[k]] as const).filter(([a, b]) => b > a);
    if (d.lived > 0) iv.push([0, d.lived]);
    iv.sort((x, y) => x[0] - y[0]);
    let covered = 0, end = -1;
    for (const [a, b] of iv) {
      if (b <= end) continue;
      covered += b - Math.max(a, end);
      end = b;
    }
    return r.T - covered;
  }
  return 0;
}

/** The fill / lived waves an instance runs (lint A18: never still running at a beat's still frame). */
export function animWindowsOf(p: WeeksPosterPropsT, initial: string, events: readonly PosterEvent[]): AnimWindow[] {
  const W = posterWaves(p, initial, events);
  const r = posterRanges(p);
  const out: AnimWindow[] = [];
  const win = (w: Wave, what: string): AnimWindow => ({ from: w.start, to: w.start + w.dur, what, eventF: w.eventF, ...(w.queuedTo !== undefined ? { queuedTo: w.queuedTo } : {}) });
  W.segs.forEach((ws, k) => ws.forEach((w) => w.start > -1e5 && out.push(win(w, `${r.segs[k].label} fill (seg${k + 1})`))));
  W.empty.forEach((w) => w.start > -1e5 && out.push(win(w, "empty-box highlight")));
  let cur = p.showHere;
  for (const e of events) {
    if (e.do !== "state" || !e.props || typeof e.props.showHere !== "boolean") continue;
    if (e.props.showHere && !cur) out.push({ from: e.f, to: e.f + POSTER.livedF, what: "you-are-here + lived weeks", eventF: e.f });
    cur = e.props.showHere;
  }
  return out.sort((a, b) => a.from - b.from);
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const legendRows = (p: Pick<WeeksPosterPropsT, "segments">) => Math.max(1, Math.ceil(p.segments.length / POSTER.legendPerRow));
export const gridY = (p: Pick<WeeksPosterPropsT, "segments">) => POSTER.legendY + POSTER.legendRowH * legendRows(p) + 16;
export const gridH = (years: number) => years * POSTER.pitch - POSTER.gap + (Math.ceil(years / 10) - 1) * POSTER.decadeGap;
export const gridW = POSTER.cols * POSTER.pitch - POSTER.gap;
export const posterH = (p: Pick<WeeksPosterPropsT, "segments" | "years">) => gridY(p) + gridH(p.years) + POSTER.bottom;

/** Top-left of box i (footprint px). */
export function cellXY(i: number, gy: number): { x: number; y: number } {
  const row = Math.floor(i / POSTER.cols);
  const col = i % POSTER.cols;
  return { x: POSTER.gridX + col * POSTER.pitch, y: gy + row * POSTER.pitch + Math.floor(row / 10) * POSTER.decadeGap };
}
export const rowY = (row: number, gy: number) => gy + row * POSTER.pitch + Math.floor(row / 10) * POSTER.decadeGap;

/** Box (footprint px) around the boxes [a, b): one row → that run; several rows → full grid width over those rows. */
export function rangeBox(a: number, b: number, gy: number): { x0: number; y0: number; x1: number; y1: number } {
  const ra = Math.floor(a / POSTER.cols), rb = Math.floor((Math.max(a + 1, b) - 1) / POSTER.cols);
  if (ra === rb) {
    const p0 = cellXY(a, gy), p1 = cellXY(Math.max(a + 1, b) - 1, gy);
    return { x0: p0.x, y0: p0.y, x1: p1.x + POSTER.cell, y1: p0.y + POSTER.cell };
  }
  return { x0: POSTER.gridX, y0: rowY(ra, gy), x1: POSTER.gridX + gridW, y1: rowY(rb, gy) + POSTER.cell };
}

/** Top band: the counter (mono digits + label, right-aligned) and the title (sans, shrunk to the room the counter
 *  leaves). Widths are estimates from the glyph advance (mono 0.6 em, Inter semibold ≈ 0.56 em). */
export function topBand(p: Pick<WeeksPosterPropsT, "title" | "counter" | "counterLabel" | "years">): { right: number; counterW: number; digitsW: number; titlePx: number; titleW: number } {
  const right = POSTER.w - POSTER.shadow - POSTER.pad;
  const digits = fmtInt(p.years * 52).length;
  const digitsW = p.counter === "none" ? 0 : digits * 0.6 * POSTER.counterPx;
  const counterW = p.counter === "none" ? 0 : digitsW + 14 + p.counterLabel.length * 0.6 * POSTER.counterLabelPx;
  const room = right - POSTER.pad - (counterW ? counterW + 24 : 0);
  const len = p.title?.length ?? 0;
  const titlePx = len ? Math.min(POSTER.titlePx, room / (len * 0.56)) : POSTER.titlePx;
  return { right, counterW, digitsW, titlePx, titleW: len * 0.56 * titlePx };
}

/** Camera landing that frames the whole poster above the captions: camera on poster#fit at this fill. */
export function posterFit(p: Pick<WeeksPosterPropsT, "segments" | "years">): { y: number; scale: number; fill: number } {
  const H = posterH(p);
  // the camera never zooms out past 0.6 (lower.ts zoomForFillLocal min): a 90-year poster then spans ~971 px around the
  // window's middle (y ≈ 285–1255) — the paper edge grazes both fades, the title / counter / grid stay clear
  const scale = Math.max(0.6, POSTER.viewH / H);
  const screenMid = (POSTER.viewTop + POSTER.viewBottom) / 2;
  // the camera puts its target at screen y 855; the poster's centre must sit at the window's middle (809)
  return { y: H / 2 + (855 - screenMid) / scale, scale, fill: Math.round(((scale * POSTER.w) / 952) * 1000) / 1000 };
}

/** Thousands with commas ("4,680"). */
export const fmtInt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const yrs = (w: number) => {
  const y = w / 52;
  return y >= 10 ? `${Math.round(y)}` : `${Math.round(y * 10) / 10}`;
};
const pct = (x: number) => `${Math.round(x * 100)} %`;

export const meta: V3MetaDef<typeof WeeksPosterProps> = {
  name: "WeeksPoster",
  version: 1,
  tier: "p0",
  spec: "2026-11-10 concept-topic device (rs-20261109-25f1a4 memento mori: shares of a life filled, you-are-here, the boxes left)",
  summary:
    "Printed life-in-weeks wall poster: one box per week, 52 a row, one row per year (default 90 = 4,680 boxes). segments = shares of a life (label + years or weeks) packed into contiguous blocks in spoken order; state seg1, seg2 … fills exactly that share in ONE wave (≤ 20 f); props showHere drops you-are-here at age and greys the lived weeks; state empty lights up the boxes still left; counter counts the boxes drawn. Anchors seg1 … segN exist once that share is filled.",
  families: ["data"],
  propsSchema: WeeksPosterProps,
  propsSchemaName: "WeeksPosterProps",
  example: { age: 30, showHere: true, segments: [{ label: "sleep", years: 26 }, { label: "work", years: 10 }], counter: "empty" },
  states: [...WEEKS_STATES],
  initialState: (p) => p.show,
  verbs: {
    enter: { durF: 12, does: "the poster rises in (the `show` state already drawn)" },
    exit: { durF: 8, does: "fades out" },
    state: {
      durF: POSTER.waveMaxF,
      does: "blank (every box empty) · seg1 … seg6 (the next share fills its boxes in one wave, ≤ 20 f; a jump chains the shares before it, the whole chain ≤ 20 f) · empty (the boxes still left light up lime, the shares step back) · dim; going down a level clears boxes in 8 f; props showHere:true drops you-are-here and greys the lived weeks (14 f)",
      props: ["showHere", "counter", "counterLabel"],
    },
    focus: { durF: 10, does: "ring flash around the newest filled share (or the empty boxes in state empty)" },
    pulse: { durF: 10, does: "a ping ring on you-are-here" },
  },
  focal: true,
  footprint: (p) => ({ w: POSTER.w, h: posterH(p) }),
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["weeks-poster"],
  anchors: (p, _size, _ctx, state): AnchorMap => {
    const H = posterH(p);
    const gy = gridY(p);
    const gh = gridH(p.years);
    const r = posterRanges(p);
    const n = r.segs.length;
    // dim keeps the level it was dimmed at, which the state name alone does not tell: no segK anchor is claimed while dim
    const lv = levelOf(state ?? p.show, n);
    const level = lv === null ? 0 : lv;
    const fit = posterFit(p);
    const out: AnchorMap = {
      poster: { x: (POSTER.w - POSTER.shadow) / 2, y: (H - POSTER.shadow) / 2, r: H / 2, label: "the life-in-weeks poster", physical: `a printed poster: every week of a ${p.years}-year life as one box` },
      fit: { x: POSTER.w / 2, y: fit.y, r: POSTER.w / 2, label: "the whole poster", physical: `camera landing that frames the whole poster above the captions (fill ${fit.fill})` },
      grid: { x: POSTER.gridX + gridW / 2, y: gy + gh / 2, r: gh / 2, box: { x0: POSTER.gridX, y0: gy, x1: POSTER.gridX + gridW, y1: gy + gh }, label: "the grid of weeks", physical: `every week of a ${p.years}-year life, one box each (${fmtInt(r.T)})` },
    };
    const tb = topBand(p);
    if (p.title) out.title = { x: POSTER.pad + tb.titleW / 2, y: POSTER.titleRowY + 26, r: tb.titleW / 2, box: { x0: POSTER.pad, y0: POSTER.titleRowY - 6, x1: POSTER.pad + tb.titleW, y1: POSTER.titleRowY + 60 }, edge: true, label: p.title, physical: "the poster's printed title" };
    r.segs.forEach((s, k) => {
      if (k + 1 > level || s.b <= s.a) return;
      const b = rangeBox(s.a, s.b, gy);
      out[`seg${k + 1}`] = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, r: Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2, box: b, label: s.label, physical: `${s.label}: ${fmtInt(s.weeks)} boxes = ${yrs(s.weeks)} years, packed together ${p.pack === "ahead" ? "after you-are-here" : "from the first box"}` };
    });
    if (p.age !== undefined && p.showHere) {
      const c = cellXY(r.here, gy);
      out.here = { x: c.x + POSTER.cell / 2, y: c.y + POSTER.cell / 2, r: 18, label: "you are here", physical: `the week you are in at age ${p.age}: box ${fmtInt(r.here + 1)}` };
      if (r.here > 0) {
        const b = rangeBox(0, r.here, gy);
        out.lived = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, r: Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2, box: b, label: "the weeks already lived", physical: `${fmtInt(r.here)} weeks already lived, greyed` };
      }
    }
    const e = emptyRange(p);
    if (e.b > e.a) {
      const b = rangeBox(e.a, e.b, gy);
      out.empty = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, r: Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2, box: b, label: "the boxes still empty", physical: `${fmtInt(e.b - e.a)} boxes still empty` };
    }
    for (let a = 10; a < p.years; a += 10) {
      const y = rowY(a, gy) + POSTER.cell / 2;
      out[`age${a}`] = { x: POSTER.gridX + 8, y, r: 22, label: `age ${a}`, physical: `the row of weeks you live at ${a}` };
    }
    if (p.counter !== "none") out.counter = { x: tb.right - tb.counterW / 2, y: POSTER.titleRowY + 26, r: tb.counterW / 2, box: { x0: tb.right - tb.counterW, y0: POSTER.titleRowY - 6, x1: tb.right, y1: POSTER.titleRowY + 60 }, edge: true, label: p.counterLabel, physical: "the poster's counter: the number of boxes it names, in step with the boxes drawn" };
    if (p.legend && n) {
      const y0 = POSTER.legendY, y1 = POSTER.legendY + POSTER.legendRowH * legendRows(p) - (POSTER.legendRowH - POSTER.chipH);
      out.legend = { x: (POSTER.w - POSTER.shadow) / 2, y: (y0 + y1) / 2, r: (POSTER.w - POSTER.shadow) / 2 - POSTER.pad, box: { x0: POSTER.pad, y0, x1: POSTER.w - POSTER.shadow - POSTER.pad, y1 }, edge: true, label: "the legend", physical: "one colour chip per share, with its name" };
    }
    return out;
  },
  content: (p) => ({ x: 0, y: 0, w: POSTER.w - POSTER.shadow, h: posterH(p) - POSTER.shadow }),
  continuous: () => false,
  animWindows: (p, initial, events) => animWindowsOf(p, initial, events),
  stateIssue: (p, state) => {
    const k = /^seg(\d)$/.exec(state)?.[1];
    return k && +k > p.segments.length ? `state ${state}: this WeeksPoster has only ${p.segments.length} segment${p.segments.length === 1 ? "" : "s"} (add the share to segments, or state seg${p.segments.length || 1})` : null;
  },
  whenToUse: { text: "a line about how many weeks a life has, how much of it goes to sleep / work / screens, or the weeks you have left", words: ["week", "lifetime", "memento", "mortal"] },
  describe: (state, p) => {
    const r = posterRanges(p);
    const n = r.segs.length;
    // dim keeps the level it was dimmed at, which the state name alone does not tell: no share is listed while dim
    const dim = state === "dim";
    const lv = levelOf(state, n);
    const level = lv === null ? 0 : lv;
    const tag = p.tag === "none" ? "" : ` [${WEEKS_TAG_TEXT[p.tag]}]`;
    const parts = [`WeeksPoster printed poster${tag}: a ${p.years}-year life (a chosen length) as ${p.years} rows × 52 boxes (1 box = 1 week, ${fmtInt(r.T)}; 52 a row, a year is 52 weeks and a day or two)`];
    if (p.title) parts.push(`title "${p.title}"`);
    if (p.age !== undefined && p.showHere) parts.push(`you-are-here at age ${p.age}, ${fmtInt(r.here)} lived boxes greyed`);
    const shown = r.segs.slice(0, Math.min(level, n));
    if (shown.length)
      parts.push(`packed together ${p.pack === "ahead" ? "after you-are-here" : "from the first box"}, NOT when they happen: ${shown.map((s) => `${s.label} ${fmtInt(s.weeks)} (${yrs(s.weeks)} y, ${pct(s.weeks / r.T)}) ${s.tone}`).join(", ")}`);
    else if (!dim) parts.push("every box empty");
    const e = emptyRange(p);
    if (state === "empty" && e.b > e.a) parts.push(`empty: ${fmtInt(e.b - e.a)} boxes still empty${p.showHere && p.age !== undefined ? " after you-are-here" : ""}, highlighted lime, the shares step back`);
    if (dim) parts.push("the poster is dimmed (the shares stay as they were before the dim)");
    if (p.counter !== "none" && !dim) {
      const fill = { seg: r.segs.map((_, k) => (k < level ? 1 : 0)), empty: state === "empty" ? 1 : 0 };
      parts.push(`counter "${p.counterLabel}" ${fmtInt(counterAt(p, fill, p.showHere ? 1 : 0))}${p.counter === "empty" ? " (counts down as each share fills)" : ""}`);
    }
    return parts.join("; ");
  },
};
