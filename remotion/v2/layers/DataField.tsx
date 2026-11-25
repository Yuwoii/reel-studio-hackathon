// Persistent DataField layer (amendments §3a). Lives in WORLD space inside the camera.
//
// - 8 presets (fieldPresets.ts; `certs` since W3.1), deterministic from datafield.seed via remotion random(). A seed
//   suffix "@HH:MM[:SS]" is the storyboard's time hint: the logs preset's timestamps run around that clock time.
// - Body glyphs in textFaint, or a preset's dimmer bodyAlpha (logs 0.09, W3.1); lead segments textFainter.
// - Slow drift (6 px/s; nodes/lattice static), content re-rolls 2–3 tokens every 15 f, choosing only cells inside the
//   camera viewport at that tick's first frame (whole-world re-rolls were 0/9 visible in R2). Re-rolled tokens snap.
// - Renders only the rows/nodes inside the current viewport (+ margin), evaluated per blur sub-sample.
// - Story-reactive `mark` action ("datafield" target): marks whole rows in markDanger / markAccent (level 1) over 6 f;
//   danger marks pulse 0.7↔1 × base over 20 f; state "clear" fades every mark out over 6 f.
//   props: { tone?: "danger"|"accent" (default: the beat's keywordColor), rows?: 1–8 (default 3), offsets?: int[],
//   hold?: true (keep past the beat until a "clear"; default: the mark fades out at the end of its beat) }.
import React from "react";
import { interpolate, interpolateColors, random, useCurrentFrame } from "remotion";
import type { Timeline } from "../../../src/v2/timeline";
import { cameraAt, visibleWorldRect } from "../camera";
import { clampX, dangerPulse } from "../motion";
import { color, field, font, FPS, layout, motion } from "../theme";
import type { FieldMark } from "../world";
import { fieldClock, PRESETS, rowRandom, type FieldPreset, type GridPreset, type PresetId, type Seg, type TextPreset } from "./fieldPresets";

export interface FieldGeometry {
  /** Field-space origin of row 0 / column 0. */
  ox: number;
  oy: number;
  /** Characters per text row (covers the world extent + drift). */
  cols: number;
}

export function fieldGeometry(preset: FieldPreset, extent: { x0: number; y0: number; x1: number; y1: number }, stationsMinX: number, durationF: number): FieldGeometry {
  const driftX = Math.abs(preset.scroll.x) * (durationF / FPS);
  if (preset.layout === "grid") return { ox: Math.floor(extent.x0 / preset.pitch) * preset.pitch, oy: Math.floor(extent.y0 / preset.pitch) * preset.pitch, cols: 0 };
  // ONE lead column just left of the first station (PROOF fix round: a second address column mid-frame read as noise);
  // horizontally scrolling presets start further left so the drift never uncovers an empty edge.
  const ox = preset.scroll.x < 0 ? extent.x0 : stationsMinX - 40;
  return { ox, oy: extent.y0, cols: Math.ceil((extent.x1 + driftX - ox) / preset.charW) + 2 };
}

const scrollAt = (p: FieldPreset, frame: number) => ({ x: (p.scroll.x * frame) / FPS, y: (p.scroll.y * frame) / FPS });

// ── caches (per tab; content is a pure function of the keys) ────────────────────────────────────────────────────
const rowCache = new Map<string, Seg[]>();
function baseRow(seed: string, p: TextPreset, r: number, cols: number): Seg[] {
  const key = `${seed}|${p.id}|${r}|${cols}`;
  let segs = rowCache.get(key);
  if (!segs) {
    segs = p.row(r, cols, rowRandom(seed, p.id, r), { clockMs: fieldClock(seed) });
    if (rowCache.size > 4000) rowCache.clear();
    rowCache.set(key, segs);
  }
  return segs;
}

export interface RerollPick {
  r: number;
  cell: number;
}
const rerollCache = new WeakMap<object, Map<string, RerollPick[][]>>();

/** Field-space rect seen by the camera at `frame` (stage only: the header band and footer cover the rest). */
function fieldRectAt(tl: Timeline, p: FieldPreset, frame: number, screenTop: number = layout.stage.top, screenBottom: number = layout.footer.top) {
  const c = cameraAt(tl, frame);
  const w = visibleWorldRect(c, screenTop, screenBottom, 0);
  const s = scrollAt(p, frame);
  return { x0: w.x0 - s.x, x1: w.x1 - s.x, y0: w.y0 - s.y, y1: w.y1 - s.y };
}

/** Rollable cells of row r whose field x lies inside [fx0, fx1]. */
function rollableCells(seed: string, p: FieldPreset, g: FieldGeometry, r: number, fx0: number, fx1: number): number[] {
  const out: number[] = [];
  if (p.layout === "text") {
    let col = 0;
    baseRow(seed, p, r, g.cols).forEach((s, i) => {
      const x = g.ox + col * p.charW;
      if (s.roll && x >= fx0 && x + s.text.length * p.charW <= fx1) out.push(i);
      col += s.text.length;
    });
  } else {
    const i0 = Math.ceil((fx0 - g.ox) / p.pitch);
    const i1 = Math.floor((fx1 - g.ox) / p.pitch);
    for (let i = i0; i <= i1; i++) if (p.rollGlyph || p.label?.(i, r, rowRandom(seed, p.id, 0))) out.push(i);
  }
  return out;
}

/** Re-roll picks for every tick 1..upTo (cached). Tick t happens at frame t·15, cells chosen inside that viewport. */
export function rerollPicks(tl: Timeline, seed: string, p: FieldPreset, g: FieldGeometry, upTo: number): RerollPick[][] {
  let byKey = rerollCache.get(tl);
  if (!byKey) rerollCache.set(tl, (byKey = new Map()));
  const key = `${seed}|${p.id}`;
  let ticks = byKey.get(key);
  if (!ticks) byKey.set(key, (ticks = [[]]));
  const [nMin, nMax] = field.rerollCount;
  for (let t = ticks.length; t <= upTo; t++) {
    const f = t * field.rerollEveryF;
    const rect = fieldRectAt(tl, p, f);
    const r0 = Math.ceil((rect.y0 - g.oy) / p.pitch);
    const r1 = Math.floor((rect.y1 - g.oy) / p.pitch) - 1;
    const n = nMin + Math.floor(random(`${seed}:rr:${t}:n`) * (nMax - nMin + 1));
    const picks: RerollPick[] = [];
    for (let k = 0; k < n && r1 >= r0; k++) {
      const r = r0 + Math.floor(random(`${seed}:rr:${t}:${k}:r`) * (r1 - r0 + 1));
      const cells = rollableCells(seed, p, g, r, rect.x0, rect.x1);
      if (cells.length) picks.push({ r, cell: cells[Math.floor(random(`${seed}:rr:${t}:${k}:c`) * cells.length)] });
    }
    ticks.push(picks);
  }
  return ticks;
}

/** row → (cell → tick) of the latest re-roll at or before `frame`. */
function rerollMap(tl: Timeline, seed: string, p: FieldPreset, g: FieldGeometry, frame: number): Map<number, Map<number, number>> {
  const tick = Math.floor(Math.floor(frame) / field.rerollEveryF);
  const ticks = rerollPicks(tl, seed, p, g, tick);
  const m = new Map<number, Map<number, number>>();
  for (let t = 1; t <= tick; t++) {
    for (const pk of ticks[t]) {
      let row = m.get(pk.r);
      if (!row) m.set(pk.r, (row = new Map()));
      row.set(pk.cell, t);
    }
  }
  return m;
}

// ── marks ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MarkSpan {
  tone: "danger" | "accent";
  from: number;
  /** Clear frame (fade-out start), or null. */
  to: number | null;
}

const markCache = new WeakMap<object, Map<string, Map<number, MarkSpan[]>>>();

/** Frame whose viewport a mark at `f` is aimed at: the end of a camera move in progress at f (or starting within 3 f),
 *  so a mark on a pan's keyword lands where the camera arrives, not where it leaves. */
export function markLookFrame(tl: Pick<Timeline, "cameraSegments">, f: number): number {
  for (const s of tl.cameraSegments) if (s.transition === "move" && s.startF <= f + 3 && f < s.endF) return s.endF;
  return f;
}

/** Field row → mark spans. Rows are chosen inside the focal area of the viewport the mark is aimed at. */
export function markRows(tl: Timeline, seed: string, p: FieldPreset, g: FieldGeometry, marks: readonly FieldMark[]): Map<number, MarkSpan[]> {
  let byKey = markCache.get(marks);
  if (!byKey) markCache.set(marks, (byKey = new Map()));
  const key = `${seed}|${p.id}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const rows = new Map<number, MarkSpan[]>();
  const open: { r: number; span: MarkSpan }[] = [];
  for (const m of marks) {
    if (m.clear) {
      for (const o of open) if (o.span.to === null || o.span.to > m.f) o.span.to = m.f;
      open.length = 0;
      continue;
    }
    const rect = fieldRectAt(tl, p, markLookFrame(tl, m.f), layout.focal.top, layout.focal.bottom);
    const r0 = Math.ceil((rect.y0 - g.oy) / p.pitch);
    const r1 = Math.max(r0, Math.floor((rect.y1 - g.oy) / p.pitch) - 1);
    let chosen: number[];
    if (m.offsets?.length) {
      const mid = Math.round((r0 + r1) / 2);
      chosen = m.offsets.map((o) => mid + o);
    } else {
      // spread: split the visible rows into `rows` bands and pick one row per band
      const n = Math.min(m.rows, r1 - r0 + 1);
      const band = (r1 - r0 + 1) / n;
      chosen = Array.from({ length: n }, (_, k) => r0 + Math.floor(k * band + random(`${seed}:mk:${m.seed}:${k}`) * band));
    }
    for (const r of new Set(chosen)) {
      const span: MarkSpan = { tone: m.tone, from: m.f, to: m.until };
      const list = rows.get(r) ?? [];
      list.push(span);
      rows.set(r, list);
      open.push({ r, span });
    }
  }
  byKey.set(key, rows);
  return rows;
}

/** 0..1 mark level of a span at frame f (6 f in, 6 f out), times the danger pulse. */
function markLevel(s: MarkSpan, f: number): number {
  if (f < s.from) return 0;
  const inL = interpolate(f, [s.from, s.from + motion.markF], [0, 1], clampX);
  const outL = s.to === null ? 1 : interpolate(f, [s.to, s.to + motion.markF], [1, 0], clampX);
  return inL * outL;
}

function rowStyle(spans: MarkSpan[] | undefined, f: number, base: string): { color: string; lead: string | null; opacity: number } {
  if (!spans) return { color: base, lead: null, opacity: 1 };
  let best: MarkSpan | null = null;
  let lvl = 0;
  for (const s of spans) {
    const l = markLevel(s, f);
    if (l > lvl) {
      lvl = l;
      best = s;
    }
  }
  if (!best || lvl <= 0) return { color: base, lead: null, opacity: 1 };
  const mc = best.tone === "danger" ? color.markDanger : color.markAccent;
  const c = interpolateColors(lvl, [0, 1], [base, mc]);
  const settled = f - best.from - motion.markF;
  const opacity = best.tone === "danger" && settled > 0 && (best.to === null || f < best.to) ? dangerPulse(f, best.from + motion.markF) : 1;
  return { color: c, lead: interpolateColors(lvl, [0, 1], [color.textFainter, mc]), opacity };
}

/** Base colour of a preset's body glyphs: textFaint, or white at the preset's bodyAlpha (dimmer dense presets). */
export function bodyColor(p: Pick<FieldPreset, "bodyAlpha">): string {
  return p.bodyAlpha === undefined ? color.textFaint : `rgba(255,255,255,${p.bodyAlpha})`;
}

// ── renderers ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface DataFieldProps {
  tl: Timeline;
  preset: PresetId;
  seed: string;
  geometry: FieldGeometry;
  marks: readonly FieldMark[];
}

export const DataField: React.FC<DataFieldProps> = (props) => {
  const p = PRESETS[props.preset];
  return p.layout === "text" ? <TextField {...props} p={p} /> : <GridField {...props} p={p} />;
};

const TextField: React.FC<DataFieldProps & { p: TextPreset }> = ({ tl, p, seed, geometry: g, marks }) => {
  const frame = useCurrentFrame();
  const f = Math.floor(frame);
  const rect = fieldRectAt(tl, p, frame, 0, layout.footer.top);
  const r0 = Math.floor((rect.y0 - g.oy) / p.pitch) - 1;
  const r1 = Math.ceil((rect.y1 - g.oy) / p.pitch) + 1;
  const rolled = rerollMap(tl, seed, p, g, frame);
  const marked = markRows(tl, seed, p, g, marks);
  const s = scrollAt(p, frame);
  const rows: React.ReactNode[] = [];
  for (let r = r0; r <= r1; r++) {
    const segs = baseRow(seed, p, r, g.cols);
    const over = rolled.get(r);
    const st = rowStyle(marked.get(r), f, bodyColor(p));
    // group consecutive segments by lead flag → 1–3 spans per row
    const spans: { lead: boolean; text: string }[] = [];
    segs.forEach((sg, i) => {
      const t = over?.get(i);
      const text = t !== undefined && sg.roll ? sg.roll(rowRandom(seed, p.id, r, `${t}:${i}`)) : sg.text;
      const lead = !!sg.lead;
      const last = spans[spans.length - 1];
      if (last && last.lead === lead) last.text += text;
      else spans.push({ lead, text });
    });
    rows.push(
      <div key={r} style={{ position: "absolute", left: g.ox, top: g.oy + r * p.pitch, height: p.pitch, color: st.color, opacity: st.opacity }}>
        {spans.map((sp, i) => (
          <span key={i} style={sp.lead ? { color: st.lead ?? color.textFainter } : undefined}>
            {sp.text}
          </span>
        ))}
      </div>,
    );
  }
  return (
    <div
      style={{
        position: "absolute", left: 0, top: 0, transform: `translate(${s.x}px, ${s.y}px)`,
        fontFamily: font.mono, fontWeight: 400, fontSize: p.size, lineHeight: `${p.pitch}px`, whiteSpace: "pre", fontVariantNumeric: "tabular-nums",
      }}
    >
      {rows}
    </div>
  );
};

const GridField: React.FC<DataFieldProps & { p: GridPreset }> = ({ tl, p, seed, geometry: g, marks }) => {
  const frame = useCurrentFrame();
  const f = Math.floor(frame);
  const rect = fieldRectAt(tl, p, frame, 0, layout.footer.top);
  const i0 = Math.floor((rect.x0 - g.ox) / p.pitch) - 1;
  const i1 = Math.ceil((rect.x1 - g.ox) / p.pitch) + 1;
  const j0 = Math.floor((rect.y0 - g.oy) / p.pitch) - 1;
  const j1 = Math.ceil((rect.y1 - g.oy) / p.pitch) + 1;
  const rolled = rerollMap(tl, seed, p, g, frame);
  const marked = markRows(tl, seed, p, g, marks);
  const rnd0 = rowRandom(seed, p.id, 0);
  const glyphs: React.ReactNode[] = [];
  const lines: React.ReactNode[] = [];
  const charW = p.size * 0.6;
  for (let j = j0; j <= j1; j++) {
    const st = rowStyle(marked.get(j), f, bodyColor(p));
    const over = rolled.get(j);
    for (let i = i0; i <= i1; i++) {
      const x = g.ox + i * p.pitch;
      const y = g.oy + j * p.pitch;
      const t = over?.get(i);
      const glyph = t !== undefined && p.rollGlyph ? p.rollGlyph : p.glyph;
      // a re-rolled label keeps its existence draw ("l:" keys) and only regenerates its text
      const rr = t !== undefined && !p.rollGlyph ? rowRandom(seed, p.id, 0, `${t}:${i}:${j}`) : null;
      const label = p.label?.(i, j, rr ? (k) => (k.startsWith("l:") ? rnd0(k) : rr(k)) : rnd0) ?? null;
      glyphs.push(
        <div key={`g${i}:${j}`} style={{ position: "absolute", left: x - charW / 2, top: y - p.size * 0.62, color: st.color, opacity: st.opacity }}>
          {glyph}
        </div>,
      );
      if (label)
        glyphs.push(
          <div key={`l${i}:${j}`} style={{ position: "absolute", left: x + 16, top: y + 4, color: st.lead ?? color.textFainter, opacity: st.opacity }}>
            {label}
          </div>,
        );
      if (p.linkP) {
        if (random(`${seed}:lk:r:${i}:${j}`) < p.linkP) lines.push(<line key={`r${i}:${j}`} x1={x + 8} y1={y} x2={x + p.pitch - 8} y2={y} />);
        if (random(`${seed}:lk:d:${i}:${j}`) < p.linkP) lines.push(<line key={`d${i}:${j}`} x1={x} y1={y + 8} x2={x} y2={y + p.pitch - 8} />);
      }
    }
  }
  const traces: React.ReactNode[] = [];
  if (p.traceEveryPx) {
    const step = 40;
    const drift = (field.scrollPxPerS * frame) / FPS;
    const k0 = Math.floor((rect.x0 + drift) / step) - 1;
    const k1 = Math.ceil((rect.x1 + drift) / step) + 1;
    const t0 = Math.floor(rect.y0 / p.traceEveryPx);
    const t1 = Math.ceil(rect.y1 / p.traceEveryPx);
    for (let t = t0; t <= t1; t++) {
      const base = t * p.traceEveryPx + p.pitch / 2;
      const pts: string[] = [];
      for (let k = k0; k <= k1; k++) pts.push(`${(k * step - drift).toFixed(1)},${(base + (random(`${seed}:tr:${t}:${k}`) - 0.5) * 12).toFixed(1)}`);
      traces.push(<polyline key={`t${t}`} points={pts.join(" ")} fill="none" stroke={color.textFaint} strokeWidth={1} />);
    }
  }
  return (
    <div style={{ position: "absolute", left: 0, top: 0, fontFamily: font.mono, fontWeight: 400, fontSize: p.size, lineHeight: 1, whiteSpace: "pre", fontVariantNumeric: "tabular-nums" }}>
      {lines.length || traces.length ? (
        <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
          <g stroke={color.border} strokeWidth={1}>
            {lines}
          </g>
          {traces}
        </svg>
      ) : null}
      {glyphs}
    </div>
  );
};
