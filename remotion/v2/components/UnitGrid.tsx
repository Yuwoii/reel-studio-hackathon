// UnitGrid renderer (bible §6.3 + amendments §6). Meta: src/v2/components-meta/UnitGrid.ts.
//
// Opaque bgRaised plate (radius.card, 2 px border) holding 10 × 10 cells: empty = bgRaised2 + 1 px border; filled =
// the state colour, popping 0.4 → 1 over 4 f when its turn in the wave comes (row-major or diagonal, 1 f apart).
// Wave start: the latest countUp (empty before the first one), else 4 f after the entrance. A `filled` override
// fills / empties the difference 1 f per cell (≤ 30 f). A tone change recolours filled cells along the fill order
// (colour snaps per cell — never a lime → red fade). Danger cells pulse on the danger rhythm (20 f) but with a 0.85
// floor (not 0.7): 84 cells dimmed together read as a different, muddy colour, so the fill stays recognisably danger.
// Caption: the first number in it that equals `filled` (or the previous `filled`) counts in step with the grid, padded
// to a fixed digit count. It reads ONE per-frame count (shownCount): the lit cells, or — while a state change that
// also swaps the caption is in flight — the lit cells already in the new state's colour, so "N of 100 OOMKilled"
// always equals the red cells on screen (W2.1 fix; text and data never disagree). A state + caption change that also
// shrinks the count clears the old cells first, then fills the new ones (UNIT_RESET, W2.1 r2).
// enterExit "self" (plateFade): plate opaque before the cells/caption appear; on exit they fade first.
import React from "react";
import { interpolate } from "remotion";
import { meta, UNIT_GRID, UNIT_LEGEND, unitDelay, unitGridLayout, unitGridRows, unitLegendItems, unitOrderTables, type UnitGridPropsT } from "../../../src/v2/components-meta/UnitGrid";
import { clampX, easeBible, flash, pulse, scramble } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";

const FILL: Record<string, ColorToken> = { accent: "accent", danger: "danger", neutral: "text", dim: "textDim" };
const GLOW: Record<string, ColorToken> = { accent: "markAccent", danger: "markDanger", neutral: "borderStrong", dim: "border" };

/** Change-wave step: 1 f per cell, compressed so a change of `n` cells lands within 30 f. */
const changeDelay = (j: number, n: number, budgetF = 30) => Math.floor(j * Math.min(1, budgetF / Math.max(1, n)));

/**
 * Clear-then-fill (W2.1 r2, review: "9 of 100 after the fix" over 53 still-red cells): when a state + caption change
 * also SHRINKS the count, every old-state cell empties first (reverse fill order, within clearF = the 8 f caption scramble), then the new count
 * fills in the new colour (1 f per cell, ≤ fillF) — every frame shows only the state the caption names.
 */
export const UNIT_RESET = { clearF: 8, fillF: 22 } as const;

export interface CellLook {
  on: boolean;
  scale: number;
  token: ColorToken;
}

/** Look of the cell with fill rank k at this frame (pure; exported for tests). */
export function unitCell(p: RenderProps<UnitGridPropsT>, k: number): CellLook {
  const { order } = p.props;
  const N = p.props.filled;
  const P = p.prev.filled;
  const cus = p.events.filter((e) => e.do === "countUp");
  const lc = p.last("countUp");
  const wave = cus.length ? (lc ?? Number.POSITIVE_INFINITY) : p.enterF === null ? Number.NEGATIVE_INFINITY : p.enterF + UNIT_GRID.autoFillAfterEnterF;
  const fr = p.frame;
  let onAt = Number.POSITIVE_INFINITY;
  let offAt = Number.POSITIVE_INFINITY;
  const cf = p.changeF;
  const st = p.state;
  if (cf !== null && N < P && captionFollowsState(p)) {
    const before = k < P ? wave + unitDelay(order, k, P) : Number.POSITIVE_INFINITY;
    const off = cf + Math.floor(((P - 1 - k) * UNIT_RESET.clearF) / P);
    const reOn = k < N ? cf + UNIT_RESET.clearF + changeDelay(k, N, UNIT_RESET.fillF) : Number.POSITIVE_INFINITY;
    const refilled = p.f >= reOn;
    const on = refilled || (p.f >= before && p.f < off);
    const from = refilled ? reOn : before;
    const scale = on && Number.isFinite(from) ? interpolate(fr, [from, from + UNIT_GRID.popF], [0.4, 1], { ...clampX, easing: easeBible }) : 1;
    return { on, scale, token: FILL[refilled ? st.name : (st.prev ?? st.name)] ?? "accent" };
  }
  if (cf === null || P === N) {
    if (k < N) onAt = wave + unitDelay(order, k, N);
  } else if (N > P) {
    if (k < P) onAt = wave + unitDelay(order, k, N);
    else if (k < N) onAt = Math.max(cf + changeDelay(k - P, N - P), wave + unitDelay(order, k, N));
  } else {
    if (k < N) onAt = wave + unitDelay(order, k, P);
    else if (k < P) {
      onAt = wave + unitDelay(order, k, P);
      offAt = cf + changeDelay(P - 1 - k, P - N);
    }
  }
  const on = p.f >= onAt && p.f < offAt;
  const scale = on && Number.isFinite(onAt) ? interpolate(fr, [onAt, onAt + UNIT_GRID.popF], [0.4, 1], { ...clampX, easing: easeBible }) : 1;
  // recolour along the fill order after a state change
  const recolourAt = st.f === null ? Number.NEGATIVE_INFINITY : st.f + changeDelay(k, N);
  const name = Math.floor(fr) >= recolourAt || !st.prev ? st.name : st.prev;
  return { on, scale, token: FILL[name] ?? "accent" };
}

/** Cells lit at this frame (Math.floor-stepped: unitCell's on/off is decided on p.f). */
export function litCount(p: RenderProps<UnitGridPropsT>): number {
  let c = 0;
  for (let k = 0; k < UNIT_GRID.n * UNIT_GRID.n; k++) if (unitCell(p, k).on) c++;
  return c;
}

/**
 * True while the caption describes a NEW state: the latest action changed the state AND the caption together (the
 * "84 of 100 OOMKilled" kind). The caption's number then counts the cells already showing the new state's colour.
 */
function captionFollowsState(p: RenderProps<UnitGridPropsT>): boolean {
  const st = p.state;
  return st.f !== null && st.prev !== null && st.prev !== st.name && p.changeF === st.f && (p.prev.caption ?? "") !== (p.props.caption ?? "");
}

/**
 * The ONE per-frame count the caption shows (W2.1 fix: label and grid agree on every frame). Normally the lit cells;
 * while a state + caption change is in flight, the lit cells that have already recoloured to the new state (so
 * "N of 100 OOMKilled" = the red cells you can count). Both are read from unitCell() on the floored frame.
 */
export function shownCount(p: RenderProps<UnitGridPropsT>): number {
  if (!captionFollowsState(p)) return litCount(p);
  const tok = FILL[p.state.name] ?? "accent";
  let c = 0;
  for (let k = 0; k < UNIT_GRID.n * UNIT_GRID.n; k++) {
    const x = unitCell(p, k);
    if (x.on && x.token === tok) c++;
  }
  return c;
}

/** `text` with its count (the first standalone integer equal to one of `counts`) replaced by `live`, padded to `digits`. */
export function liveCaption(text: string, counts: readonly number[], live: number, digits: number): string {
  const m = /(^|[^\d.,])(\d{1,3})(?!\d|[.,]\d)/.exec(text);
  if (!m || !counts.includes(Number(m[2]))) return text;
  const at = m.index + m[1].length;
  return `${text.slice(0, at)}${String(live).padStart(digits, " ")}${text.slice(at + m[2].length)}`;
}

/** Caption text at this frame (exported for tests). */
export function captionText(p: RenderProps<UnitGridPropsT>): string {
  const live = shownCount(p);
  const N = p.props.filled;
  const P = p.prev.filled;
  const digits = String(Math.max(N, P)).length;
  const cur = liveCaption(p.props.caption ?? "", [N], live, digits);
  const old = liveCaption(p.prev.caption ?? "", [P], live, digits);
  if (p.changeF !== null && (p.prev.caption ?? "") !== (p.props.caption ?? "") && p.f < p.changeF + 8) return scramble(old, cur, p.f, p.changeF, 8, `${p.id}:caption:${p.changeF}`, { changedOnly: true });
  return cur;
}

const Render: React.FC<RenderProps<UnitGridPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const { w, h } = p.size;
  const { side } = unitGridLayout(w);
  const { captionY, legendY } = unitGridRows(p.base, w);
  const { rank } = unitOrderTables(p.props.order);
  const settled = p.state.f === null ? 0 : p.state.f + 34;
  // pulse() is 0.7↔1; remap to 0.85↔1 so the danger fill never reads as maroon at the trough
  const pulseOp = p.state.name === "danger" && p.frame >= settled ? 1 - (1 - pulse(p.frame, settled)) * 0.5 : 1;
  const glow = flash(p.frame, p.last("pulse"), 5);
  const kick = flash(p.frame, p.last("focus"), 4);
  const glowToken = GLOW[p.state.name] ?? "markAccent";
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < UNIT_GRID.n * UNIT_GRID.n; i++) {
    const r = Math.floor(i / UNIT_GRID.n);
    const c = i % UNIT_GRID.n;
    const cl = unitCell(p, rank[i]);
    const x = UNIT_GRID.pad + c * (side + UNIT_GRID.gap);
    const y = UNIT_GRID.pad + r * (side + UNIT_GRID.gap);
    cells.push(
      <div key={i} style={{ position: "absolute", left: x, top: y, width: side, height: side, boxSizing: "border-box", borderRadius: UNIT_GRID.cellRadius, background: color.bgRaised2, border: `1px solid ${color.border}` }}>
        {cl.on ? (
          <div
            style={{
              position: "absolute", left: -1, top: -1, width: side, height: side, borderRadius: UNIT_GRID.cellRadius, background: color[cl.token],
              opacity: cl.token === "danger" ? pulseOp : 1, transform: cl.scale < 1 ? `scale(${cl.scale})` : undefined,
              boxShadow: glow > 0 ? `0 0 ${Math.round(UNIT_GRID.gap * glow)}px ${color[glowToken]}` : undefined,
            }}
          />
        ) : null}
      </div>,
    );
  }
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
        <div
          style={{
            position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box", borderRadius: radius.card,
            border: `${UNIT_GRID.border}px solid ${color.borderStrong}`, background: color.bgRaised, ...fade.plate,
          }}
        />
        <div style={{ position: "absolute", left: UNIT_GRID.border, top: UNIT_GRID.border, width: w - 2 * UNIT_GRID.border, height: h - 2 * UNIT_GRID.border, ...fade.content }}>
          {cells}
          {legendY !== null ? (
            <div style={{ position: "absolute", left: UNIT_GRID.pad, right: UNIT_GRID.pad, top: legendY, height: UNIT_LEGEND.rowH, display: "flex", alignItems: "center", gap: UNIT_LEGEND.itemGap, fontFamily: font.mono, fontWeight: 400, fontSize: UNIT_LEGEND.px, whiteSpace: "pre" }}>
              {unitLegendItems(p.base).map((it, j) =>
                it.chip ? (
                  <span key={j} style={{ height: UNIT_LEGEND.rowH - 4, lineHeight: `${UNIT_LEGEND.rowH - 6}px`, padding: `0 ${UNIT_LEGEND.chipPadX}px`, boxSizing: "border-box", borderRadius: radius.pill, border: `1px solid ${color.borderStrong}`, color: color.text, fontVariantNumeric: "tabular-nums" }}>{it.text}</span>
                ) : (
                  <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: UNIT_LEGEND.swatchGap, color: color.textDim }}>
                    <span style={{ width: UNIT_LEGEND.swatch, height: UNIT_LEGEND.swatch, borderRadius: 6, background: color[FILL[p.state.name] ?? "accent"] }} />
                    {it.text}
                  </span>
                ),
              )}
            </div>
          ) : null}
          {p.base.caption ? (
            <div
              style={{
                position: "absolute", left: UNIT_GRID.pad, right: UNIT_GRID.pad, top: captionY ?? 0, height: UNIT_GRID.captionH, lineHeight: `${UNIT_GRID.captionH}px`,
                fontFamily: font.mono, fontWeight: 400, fontSize: UNIT_GRID.captionPx, letterSpacing: "0.02em", color: color.textDim, whiteSpace: "pre", fontVariantNumeric: "tabular-nums",
              }}
            >
              {captionText(p)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const UnitGrid = defineComponent({ ...meta, Render });
