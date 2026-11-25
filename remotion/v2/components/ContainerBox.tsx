// ContainerBox renderer (bible §6.5 ProcessBox generalised; amendments §6). Meta: src/v2/components-meta/ContainerBox.ts.
//
// Pure function of RenderProps. Continuous values (bar width, plate cross-fade) use `frame`; every discrete value
// (cells shown, reclaim flicker, label scrambles) uses `f`, so motion-blur sub-samples agree.
// The memory bar is self-contained (N-6 Meter look: track bgRaised2 24 px, radius.pill; fill text → accent → danger
// + pulse), so the component does not depend on the Meter packet.
// W2.1: the "used / max" readout and the bar share ONE eased progress (tweenProgress): the used count is the same
// 12 f bible ease as the fill, floored and clamped at max (a cgroup's memory.max cannot be exceeded), and it starts on
// the change frame itself, i.e. with the OUT OF MEMORY label flip. enterExit "self" (plateFade): the plate is opaque
// before the cells and text fade in; on exit they fade + blur first while the plate stays opaque.
// W2.1 fix B r2: counter, bar and cells read ONE value in every state — an explicit "used / max" limitLabel sets the
// fill (used / max, overriding `value`), and reclaim's blinking dashed cells still count as used, so the readout, the
// bar width and the lit + reclaimed cell count agree within one cell. The glitch is clipped to the rounded plate.
// W5.1 FR1: named cell groups paint their cells in their tone + style (solid / hatched / outline) with one legend
// swatch each; the unit chip comes from the limitLabel when cellValue / unitLabel are absent (meta legendItems); `over`
// moves the limit wall inside the track (1 / (1 + over)) and spills a hatched danger segment past it, and lets an
// explicit "used / max" readout count past max (up to max × (1 + over)).
// W7 v3 (one source of truth): with cells / groups the bar fill is used cells / 20 (meta boxFill; `value` ignored) and
// the bar is SEGMENTED in the cells' own looks, danger | accent | grey (meta barSegments), so 5 red + 14 grey cells read
// as a bar that is 25 % red then 70 % grey. full / killed keep the all-red pulsing bar.
import React from "react";
import { interpolateColors, random } from "remotion";
import {
  barSegments,
  boxCellMap,
  boxFill,
  legacyFill,
  CONTAINER_BOX as C,
  containerBoxLayout,
  LEGEND,
  limitLead,
  meta,
  parseLimit,
  type CellKindT,
  type ContainerBoxPropsT,
  type ContainerBoxState,
} from "../../../src/v2/components-meta/ContainerBox";
import { activeGlitch, easeBible, flash, pulse, stateMix } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { plateFade } from "./plateFade";
import { defineComponent, type AnyComponentMeta, type RenderProps, type TrackEvent } from "./contract";
import { initialStateOf, propsAt, propsTimeline, stateAt, type PropsTimeline } from "../../../src/v2/components-meta/_lookup";
import { Glitch } from "./primitives";
import { scrambleRuns, ScrambleText, type ScrambleRun } from "./scrambleMask";

interface Look {
  border: ColorToken;
  surface: ColorToken;
  title: ColorToken;
  meter: ColorToken;
  limit: ColorToken;
  glow: ColorToken;
}

const LOOK: Record<ContainerBoxState, Look> = {
  neutral: { border: "borderStrong", surface: "bgRaised", title: "text", meter: "textDim", limit: "textDim", glow: "markAccent" },
  accent: { border: "accent", surface: "bgRaised", title: "text", meter: "textDim", limit: "textDim", glow: "markAccent" },
  cgroup: { border: "borderStrong", surface: "bgRaised", title: "text", meter: "textDim", limit: "accent", glow: "markAccent" },
  reclaim: { border: "borderStrong", surface: "bgRaised", title: "text", meter: "text", limit: "textDim", glow: "markDanger" },
  full: { border: "danger", surface: "dangerSurface", title: "text", meter: "danger", limit: "danger", glow: "markDanger" },
  killed: { border: "danger", surface: "bgRaised", title: "text", meter: "danger", limit: "textDim", glow: "markDanger" },
  freed: { border: "border", surface: "bgRaised", title: "text", meter: "textDim", limit: "textDim", glow: "markAccent" },
  dim: { border: "border", surface: "bgRaised", title: "textDim", meter: "textDim", limit: "textDim", glow: "markAccent" },
};

const SCRAMBLE_F = motion.scrambleF[1];
/** Opacity of a neutral used cell's textDim fill (W5.1: reads as "in use", clearly apart from an empty cell). */
export const USED_OP = 0.6;
const CELLS = C.cols * C.rows;
const asState = (s: string | null | undefined): ContainerBoxState => (s && s in LOOK ? (s as ContainerBoxState) : "neutral");

/** lime ↔ red never cross-fades (it would pass through orange): snap those, fade everything else. */
function mixed(t: number, from: ColorToken, to: ColorToken): string {
  const clash = (from === "accent" && to === "danger") || (from === "danger" && to === "accent");
  return t >= 1 || from === to || clash ? color[to] : interpolateColors(t, [0, 1], [color[from], color[to]]);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Target fill for a state. An explicit "used / max" limitLabel IS the fill (used / max, clamped to 1): the readout and
 * the bar can never disagree in a held state ("498Mi / 512Mi" over a 90 % bar). Otherwise `value`, else STATE_FILL.
 */
export function fillFor(state: ContainerBoxState, props: Pick<ContainerBoxPropsT, "value" | "limitLabel" | "cells" | "groups">): number {
  // W7 v3: the meta's boxFill — with cells / groups drawn, the cells ARE the bar (value ignored)
  return boxFill(state, props);
}

/** The part of RenderProps the bar depends on (so earlier frames can be reconstructed from the event list). */
export type FillProps = Pick<RenderProps<ContainerBoxPropsT>, "state" | "changeF" | "props" | "prev" | "events" | "base">;

const ptCache = new WeakMap<object, { events: readonly TrackEvent[]; pt: PropsTimeline; initial: string }>();

/** State + props in force at discrete frame f (same folding as the slot: _lookup propsTimeline / stateAt). */
function fillPropsAt(p: FillProps, f: number): FillProps {
  const any = meta as unknown as AnyComponentMeta;
  const base = p.base as unknown as Record<string, unknown>;
  let c = ptCache.get(base);
  if (!c || c.events !== p.events) {
    c = { events: p.events, pt: propsTimeline(any, base, p.events), initial: initialStateOf(any, base) };
    ptCache.set(base, c);
  }
  const step = propsAt(c.pt, f);
  return {
    state: stateAt(any, c.initial, p.events, f),
    changeF: step.cause ? step.f : null,
    props: step.props as unknown as ContainerBoxPropsT,
    prev: step.prev as unknown as ContainerBoxPropsT,
    events: p.events,
    base: p.base,
  };
}

/**
 * Bar fill at `frame` (continuous; pass Math.floor(frame) for the discrete cell count). A tween always starts from
 * the bar's ACTUAL value at the change frame (the previous configuration evaluated at that frame, including a killed
 * drain), so leaving `killed` never flashes a full bar.
 */
/** Start frame of the latest tween (state or props change) in force, null = base configuration. */
function tweenAt(p: FillProps): number | null {
  const sf = p.state.f;
  const cf = p.changeF;
  return sf === null ? cf : cf === null ? sf : Math.max(sf, cf);
}

/** THE eased progress (0..1) of the latest change at `frame`: drives both the bar fill and the used count. */
export function tweenProgress(p: FillProps, frame: number): number {
  const at = tweenAt(p);
  return at === null ? 1 : easeBible(clamp01((frame - at) / C.tweenF));
}

export function barFill(p: FillProps, frame: number): number {
  const st = asState(p.state.name);
  const sf = p.state.f;
  const at = tweenAt(p);
  const target = fillFor(st, p.props);
  let v = target;
  if (at !== null) {
    const from = barFill(fillPropsAt(p, at - 1), at);
    v = from + (target - from) * tweenProgress(p, frame);
  }
  if (st === "killed" && sf !== null) v *= 1 - easeBible(clamp01((frame - (sf + C.drainDelayF)) / C.drainF));
  return v;
}

const GROUP_KIND: Record<"danger" | "accent" | "used", CellKindT> = { danger: "danger", accent: "accent", used: "filled" };

/** Group index per cell at f (-1 = none): the groups in force (props at f); none while killed / freed drain the box. */
export function cellGroups(p: Pick<RenderProps<ContainerBoxPropsT>, "props" | "state">): number[] {
  const out = new Array<number>(CELLS).fill(-1);
  const st = asState(p.state.name);
  if (st === "killed" || st === "freed") return out;
  (p.props.groups ?? []).forEach((g, gi) => {
    for (const c of g.cells) if (c >= 0 && c < CELLS && out[c] < 0) out[c] = gi;
  });
  return out;
}

/** Cell kinds at f (discrete). */
export function cellKinds(p: RenderProps<ContainerBoxPropsT>): CellKindT[] {
  const st = asState(p.state.name);
  const n = Math.round(barFill(p, p.f) * CELLS);
  const explicit = p.props.cells;
  // W7 v3: past a short cell map the cells follow the authored fill (value / readout / STATE_FILL), NOT the derived bar
  // (that would feed the bar back into the cells); the bar = these cells (boxFill), so cells and bar always agree
  const map = explicit?.length && st !== "killed" && st !== "freed" ? boxCellMap({ cells: explicit }, legacyFill(st, p.props)) : null;
  const out: CellKindT[] = [];
  for (let i = 0; i < CELLS; i++) {
    const given = explicit?.[i];
    let k: CellKindT = given ?? (map ? map[i] : i < n ? "filled" : "empty");
    if (st === "killed") {
      // drained cells turn freed (dashed) one by one from the end; the rest stay as they were
      const used = given ? given !== "empty" : true;
      if (i >= n && used) k = "freed";
    } else if (st === "freed") {
      const used = given ? given !== "empty" : i < Math.round(fillFor(asState(p.state.prev), p.prev) * CELLS) || p.state.prev === null;
      k = used ? "freed" : "empty";
    } else if (st === "reclaim" && k === "filled" && p.state.f !== null && p.f >= p.state.f + C.tweenF) {
      // the kernel tries to reclaim pages: a few used cells blink to freed for 6 f windows (seeded, discrete); they are
      // still inside the used count (i < n), so lit + dashed cells = the readout and the bar
      const win = Math.floor((p.f - p.state.f) / 6);
      if (random(`${p.id}:reclaim:${win}:${i}`) < 0.14) k = "freed";
    }
    out.push(k);
  }
  const groups = cellGroups(p);
  groups.forEach((gi, i) => {
    if (gi >= 0) out[i] = GROUP_KIND[p.props.groups![gi].tone];
  });
  return out;
}

function meterText(p: RenderProps<ContainerBoxPropsT>, st: ContainerBoxState): string {
  if (st === "full") return p.props.fullLabel;
  if (st === "killed") return p.props.killedLabel;
  return p.props.meterLabel;
}

/**
 * The used count the readout shows at discrete frame f (null = limitLabel is not a "used / max" readout). Explicit
 * values roll from what was on screen at the change frame to the new value on the bar's own ease; a limit-only label
 * and the killed drain read the count off the bar. Always Math.floor of a value clamped to [0, max].
 */
export function usedAt(p: FillProps, f: number): number | null {
  const r = parseLimit(p.props.limitLabel);
  if (!r) return null;
  const top = r.max * (1 + (p.props.over ?? 0));
  const clampU = (v: number) => Math.floor(Math.min(top, Math.max(0, v)) + 1e-9);
  const st = asState(p.state.name);
  if (r.used === null || st === "killed") return clampU(r.max * barFill(p, f));
  const to = Math.min(r.used, top);
  const at = tweenAt(p);
  if (at === null || f >= at + C.tweenF) return clampU(to);
  const prev = fillPropsAt(p, at - 1);
  const from = usedAt(prev, at) ?? r.max * barFill(prev, at);
  return clampU(from + (to - from) * tweenProgress(p, f));
}

/**
 * W6: the readout's used text at discrete frame f ("400 MB / ", "0.4 Gi / ", "179Mi / "; null = a plain label). A
 * count read off the bar (limit-only label, killed drain) goes through the meta's limitLead (cell unit / one decimal
 * for a small limit, so "limit 1 Gi" never reads "0 Gi / 1 Gi" over lit cells); an explicit count rolls (usedAt).
 */
export function usedLeadAt(p: FillProps, f: number): string | null {
  const r = parseLimit(p.props.limitLabel);
  if (!r) return null;
  if (r.used === null || asState(p.state.name) === "killed") return limitLead(r, barFill(p, f), p.props);
  return `${usedAt(p, f)}${r.mid}`;
}

interface LimitParts {
  /** Used count + separator ("179Mi / "), empty for a plain label. */
  lead: string;
  /** The limit ("512Mi"), or the whole plain label (as scramble runs: rolling digits masked). */
  limit: ScrambleRun[];
}

function limitParts(p: RenderProps<ContainerBoxPropsT>): LimitParts | undefined {
  const cur = p.props.limitLabel;
  if (cur === undefined) return undefined;
  const r = parseLimit(cur);
  const lead = usedLeadAt(p, p.f);
  if (r && lead !== null) return { lead, limit: [{ text: `${r.max}${r.tail}`, masked: false }] };
  // a plain label: an override scrambles in over 8 f (from what was on screen)
  const old = p.prev.limitLabel;
  if (p.changeF !== null && old !== undefined && old !== cur && p.f < p.changeF + SCRAMBLE_F) return { lead: "", limit: scrambleRuns(old, cur, p.f, p.changeF, SCRAMBLE_F, `${p.id}:limit:${p.changeF}`) };
  return { lead: "", limit: [{ text: cur, masked: false }] };
}

const Render: React.FC<RenderProps<ContainerBoxPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const st = asState(p.state.name);
  const look = LOOK[st];
  const from = p.state.prev ? LOOK[asState(p.state.prev)] : look;
  const t = stateMix(p.frame, p.state.f);
  const { w, h } = p.size;
  const L = containerBoxLayout(p.base, w);
  const innerW = w - 2 * C.pad;
  const cellW = (innerW - (C.cols - 1) * C.cellGap) / C.cols;

  // full: bar + filled cells pulse 0.7↔1 / 20 f once the tween has landed (initial full: from frame 0)
  const pulseFrom = p.state.f === null ? 0 : p.state.f + C.tweenF;
  const throb = st === "full" && p.frame >= pulseFrom ? pulse(p.frame, pulseFrom) : 1;
  const fill = barFill(p, p.frame);
  const fillToken: ColorToken = st === "full" || st === "killed" ? "danger" : st === "freed" || st === "dim" ? "textDim" : st === "accent" || p.base.tone === "accent" ? "accent" : "text";
  const usedCell: { bg: ColorToken; op: number } =
    // full / killed: used cells stay a dimmed red (markDanger); full danger is kept for the bar, border and label (ref3).
    // W5.1: neutral used cells are textDim at 0.6 (was borderStrong 0.16: W5 oom critic — "heap cells read as empty")
    st === "full" ? { bg: "markDanger", op: throb } : st === "killed" ? { bg: "markDanger", op: 1 } : fillToken === "accent" ? { bg: "markAccent", op: 1 } : { bg: "textDim", op: USED_OP };

  const glow = flash(p.frame, p.last("pulse"), 5);
  const kick = flash(p.frame, p.last("focus"), 4);
  const markF = p.last("mark");
  const wallFlash = flash(p.frame, markF, 5);
  const wallIn = st === "cgroup" ? stateMix(p.frame, p.state.f) : 0;
  const wall = Math.max(wallIn, wallFlash);
  // the limit label is lime only while it names the wall itself (cgroup before any new value, or a wall flash);
  // once it reads a value ("310Mi / 512Mi") it is plain tabular text next to the white fill (N-6)
  const freshWall = st === "cgroup" && (p.changeF === null || (p.state.f !== null && p.changeF <= p.state.f));
  const limitToken: ColorToken = wallFlash > 0.2 || freshWall ? "accent" : look.limit === "accent" ? "textDim" : look.limit;

  const kinds = cellKinds(p);
  const groupOf = cellGroups(p);
  const groups = p.props.groups ?? p.base.groups ?? [];
  /** A group's look: its tone's cell, solid / hatched (diagonal stripes + border) / outline (border only). */
  const groupLook = (gi: number): React.CSSProperties => {
    const g = groups[gi] ?? p.base.groups?.[gi];
    if (!g) return {};
    const tok: ColorToken = g.tone === "danger" ? "danger" : g.tone === "accent" ? "accent" : "textDim";
    if (g.style === "hatched") return { background: `repeating-linear-gradient(45deg, ${color[tok]} 0px, ${color[tok]} 6px, transparent 6px, transparent 12px)`, border: `2px solid ${color[tok]}` };
    if (g.style === "outline") return { background: color.bgRaised2, border: `3px solid ${color[tok]}` };
    return { background: color[tok], opacity: tok === "textDim" ? USED_OP : 1 };
  };
  /** The look of one cell kind (cells and legend swatches share it, so the legend IS the cell). */
  const cellLook = (k: CellKindT): React.CSSProperties => {
    switch (k) {
      case "empty":
        return { background: color.bgRaised2, border: `1px solid ${color.border}` };
      case "freed":
        return { border: `2px dashed ${color.borderStrong}` };
      case "danger":
        return { background: color.danger, opacity: st === "full" ? throb : 1 };
      case "accent":
        return { background: color.accent };
      default:
        return { background: color[usedCell.bg], opacity: usedCell.op };
    }
  };
  const cell = (k: CellKindT, i: number) => {
    const col = i % C.cols;
    const row = Math.floor(i / C.cols);
    const base: React.CSSProperties = {
      position: "absolute", left: C.pad + col * (cellW + C.cellGap), top: L.gridY + row * (C.cellH + C.cellGap), width: cellW, height: C.cellH,
      boxSizing: "border-box", borderRadius: C.cellRadius,
    };
    return <div key={i} style={{ ...base, ...(groupOf[i] >= 0 ? groupLook(groupOf[i]) : cellLook(k)) }} />;
  };
  // W5.1 legend row(s): "1 cell = 200 MB" chip + one swatch per legend entry
  const legendEls = L.legend.map((row, r) => (
    <div key={`lg${r}`} style={{ position: "absolute", left: C.pad - C.border, top: L.legendY + r * (LEGEND.rowH + LEGEND.rowGap) - C.border, width: innerW, height: LEGEND.rowH, display: "flex", alignItems: "center", gap: LEGEND.itemGap, fontFamily: font.mono, fontWeight: 400, fontSize: LEGEND.px, whiteSpace: "pre" }}>
      {row.map((it, j) =>
        it.group !== undefined ? (
          <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: LEGEND.swatchGap, color: color.textDim, opacity: groupOf.includes(it.group) ? 1 : 0.45 }}>
            <span style={{ width: LEGEND.swatch, height: LEGEND.swatch, boxSizing: "border-box", borderRadius: 6, ...groupLook(it.group) }} />
            {it.text}
          </span>
        ) : it.kind === null ? (
          <span key={j} style={{ height: LEGEND.rowH - 4, lineHeight: `${LEGEND.rowH - 6}px`, padding: `0 ${LEGEND.chipPadX}px`, boxSizing: "border-box", borderRadius: radius.pill, border: `1px solid ${color.borderStrong}`, color: color.text, fontVariantNumeric: "tabular-nums" }}>{it.text}</span>
        ) : (
          <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: LEGEND.swatchGap, color: color.textDim }}>
            <span style={{ width: LEGEND.swatch, height: LEGEND.swatch, boxSizing: "border-box", borderRadius: 6, ...cellLook(it.kind as CellKindT) }} />
            {it.text}
          </span>
        ),
      )}
    </div>
  ));

  const limit = limitParts(p);
  // W7 v3: the bar in the cells' own looks (danger | accent | grey), drawn left to right up to the (tweening) fill
  const segments = barSegments(p.props, st);
  const segLook = (k: "danger" | "accent" | "filled"): React.CSSProperties =>
    k === "danger" ? { background: color.danger } : k === "accent" ? { background: color.accent } : { background: color[usedCell.bg], opacity: usedCell.op };
  const barW = innerW;
  // over the limit: the wall sits at 1 / (1 + over) of the track, the spill past it grows on the change's ease
  const overTo = p.props.over ?? 0;
  const overFrom = p.prev.over ?? 0;
  const overNow = overFrom + (overTo - overFrom) * (p.changeF === null ? 1 : tweenProgress(p, p.frame));
  const overMax = Math.max(overTo, overFrom);
  const wallX = overMax > 0 ? barW / (1 + overMax) : barW;
  const box = (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
      {/* the opaque plate (surface + border + glow); its opacity only drops once the content is gone (plateFade) */}
      <div
        style={{
          position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box", borderRadius: radius.card,
          border: `${C.border}px solid ${mixed(t, from.border, look.border)}`, background: mixed(t, from.surface, look.surface),
          boxShadow: glow > 0 ? `inset 0 0 ${Math.round(40 * glow)}px ${color[look.glow]}` : undefined,
          ...fade.plate,
        }}
      />
      {/* content layer = the plate's padding box, so the rows keep their border-offset coordinates */}
      <div style={{ position: "absolute", left: C.border, top: C.border, width: w - 2 * C.border, height: h - 2 * C.border, ...fade.content }}>
      {/* title row (absolute children are positioned against the padding box: offset the border) */}
      <div style={{ position: "absolute", left: C.pad - C.border, top: L.titleY - C.border, width: innerW, height: C.titleLh, display: "flex", alignItems: "center", justifyContent: "space-between", gap: C.tagGap }}>
        <span style={{ fontFamily: font.sans, fontWeight: 600, fontSize: C.titlePx, lineHeight: `${C.titleLh}px`, color: color[look.title], whiteSpace: "pre" }}>{p.props.title}</span>
        {p.props.tag ? <span style={{ fontFamily: font.mono, fontWeight: 400, fontSize: C.subPx, color: color.textDim, whiteSpace: "pre", letterSpacing: "0.02em" }}>{p.props.tag}</span> : null}
      </div>
      {p.base.subtitle ? (
        <div style={{ position: "absolute", left: C.pad - C.border, top: L.subY - C.border, width: innerW, height: C.subLh, fontFamily: font.mono, fontWeight: 400, fontSize: C.subPx, lineHeight: `${C.subLh}px`, letterSpacing: "0.02em", color: color.textDim, whiteSpace: "pre", overflow: "hidden" }}>
          {p.props.subtitle ?? p.base.subtitle}
        </div>
      ) : null}
      <div style={{ position: "absolute", left: -C.border, top: -C.border, width: w, height: h }}>{kinds.map(cell)}</div>
      <div style={{ position: "absolute", left: C.pad - C.border, top: L.meterY - C.border, width: innerW, height: C.meterLh, display: "flex", alignItems: "center", justifyContent: "space-between", gap: C.tagGap, fontFamily: font.mono, fontSize: C.meterPx, lineHeight: `${C.meterLh}px`, whiteSpace: "pre" }}>
        <span style={{ fontWeight: 500, color: color[look.meter], letterSpacing: "0.02em" }}>{meterText(p, st)}</span>
        {limit !== undefined ? (
          <span style={{ fontWeight: 400, color: color[look.limit === "accent" ? "textDim" : look.limit], fontVariantNumeric: "tabular-nums" }}>
            {limit.lead}
            <span style={{ color: color[limitToken], fontVariantNumeric: "tabular-nums" }}><ScrambleText runs={limit.limit} /></span>
          </span>
        ) : null}
      </div>
      {/* bar: track + fill (+ the limit wall at its right end) */}
      <div style={{ position: "absolute", left: C.pad - C.border, top: L.barY - C.border, width: barW, height: C.barH, borderRadius: radius.pill, background: color.bgRaised2, overflow: "hidden" }}>
        {segments.length ? (
          <div data-segments style={{ position: "relative", width: wallX * clamp01(fill), height: C.barH, borderRadius: radius.pill, overflow: "hidden", display: "flex" }}>
            {segments.map((sg, k) => (
              <div key={k} style={{ flex: "none", width: wallX * sg.share, height: C.barH, ...segLook(sg.kind) }} />
            ))}
          </div>
        ) : (
          <div style={{ width: wallX * clamp01(fill), height: C.barH, borderRadius: radius.pill, background: color[fillToken], opacity: st === "full" ? throb : 1 }} />
        )}
        {overNow > 0.001 ? (
          <div data-over style={{ position: "absolute", left: wallX, top: 0, width: Math.min(barW - wallX, wallX * overNow), height: C.barH, background: `repeating-linear-gradient(45deg, ${color.danger} 0px, ${color.danger} 6px, ${color.dangerSurface} 6px, ${color.dangerSurface} 12px)` }} />
        ) : null}
      </div>
      {legendEls}
      {wall > 0 || overMax > 0 ? (
        <div
          style={{
            position: "absolute", left: C.pad - C.border + wallX - 1, top: L.barY - C.border - C.wallOverhang, width: 2, height: C.barH + 2 * C.wallOverhang, background: color[overMax > 0 ? "text" : "accent"], opacity: overMax > 0 ? 1 : wall,
            boxShadow: wallFlash > 0 ? `0 0 ${Math.round(14 * wallFlash)}px ${color.markAccent}` : undefined,
          }}
        />
      ) : null}
      </div>
    </div>
  );
  const glitches = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <Glitch frame={p.frame} at={activeGlitch(glitches, p.frame)} seed={`${p.id}:glitch`} w={w} h={h} clip={{ r: radius.card }}>
        {box}
      </Glitch>
    </div>
  );
};

export const ContainerBox = defineComponent({ ...meta, Render });
