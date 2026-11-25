// SensorGrid renderer (W7 spec §4.3). Meta: src/v2/components-meta/SensorGrid.ts.
//
// Opaque bgRaised plate → optional title → column label ("sense columns →") → the electrode matrix: drive rows and
// sense columns as 2 px borderStrong lines, a rounded node on bgRaised2 at every crossing; a node's level fills it in
// the touch tone (opacity steps; `values` prints the digit, ink-on-lime when the fill is strong) → rotated row label
// → readout chip + honesty tag. Scan = the active drive row's line in accent + its nodes outlined (discrete 6 f steps,
// no continuous motion). Levels come only from gridLevels() (number truth, L55). Colours snap; tokens only.
// enterExit "self" (plateFade).
import React from "react";
import { interpolate } from "remotion";
import { DELTA_LEGEND, DELTA_ROW, deltaText, GRID_TAG_TEXT, gridLevels, gridPoint, meta, nodeCentre, readoutText, SENSOR_GRID, sensorGridLayout, touchSigma, ZOOM_RINGS, zoomCrossing, zoomRingsLeft, type GridLayout, type SensorGridPropsT } from "../../../src/v2/components-meta/SensorGrid";
import { clampX, drawOn, easeBible, flash, scramble } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";

const G = SENSOR_GRID;
const TONE: Record<string, ColorToken> = { accent: "accent", danger: "danger", neutral: "text", dim: "textDim" };
const r1 = (x: number) => Math.round(x * 10) / 10;
/** Delta mode: the grey baseline fill of an untouched crossing, and how far a full drop (9) takes it down. */
const BASE_OP = 0.55;
const DROP_K = 0.92;
/** W7.2 delta: a full drop also shrinks the node's fill to this share of its size (the drop reads at phone size). */
const DROP_SHRINK = 0.42;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Scan row lit at frame f (null = none): the scan state loops; a mark runs one sweep. */
export function scanRow(p: Pick<RenderProps<SensorGridPropsT>, "state" | "last" | "props" | "f">): number | null {
  const m = p.last("mark");
  if (m !== undefined && p.f - m < G.scanStepF * p.props.rows) return Math.floor((p.f - m) / G.scanStepF);
  if (p.state.name === "scan") return Math.floor((p.f - (p.state.f ?? 0)) / G.scanStepF) % p.props.rows;
  return null;
}

/** Level of every node at frame (tweened 12 f after a touches change; scan reveals rows as it passes). */
export function levelsAt(p: RenderProps<SensorGridPropsT>): number[][] {
  const st = p.state.name;
  const P = p.props;
  if (st === "idle" || !P.touches.length) return Array.from({ length: P.rows }, () => new Array<number>(P.cols).fill(0));
  const cur = gridLevels(P).levels;
  const touchesChanged = p.changeF !== null && p.prev.touches !== P.touches;
  const prev = touchesChanged ? gridLevels(p.prev).levels : null;
  // the bump grows in when it first appears (state change into touch / scan / located from idle)
  const since = touchesChanged ? p.changeF! : p.state.prev === "idle" || p.state.prev === null ? p.state.f : null;
  const k = since === null ? 1 : easeBible(clamp01((p.f - since) / G.tweenF));
  const out = cur.map((row, r) => row.map((v, c) => {
    const from = prev ? prev[r][c] : since !== null ? 0 : v;
    return from + (v - from) * k;
  }));
  if (st === "scan") {
    const at = p.state.f ?? 0;
    const passed = Math.floor((p.f - at) / G.scanStepF); // rows fully scanned so far (first loop)
    return out.map((row, r) => (r <= passed ? row : row.map(() => 0)));
  }
  return out;
}

/** W7.2: a finger / palm touch that is not a danger (false) touch is drawn as a fingertip seen from above — the pad's
 *  rounded tip at the touch point and the finger running down off the grid — a flat 3 px outline with a faint tint, so
 *  the dropped nodes under it stay readable. A water drop (danger) or a small touch keeps the ring. */
export const isFinger = (t: Pick<SensorGridPropsT["touches"][number], "size" | "tone">) => t.size !== "small" && t.tone !== "danger";

/** Fingertip half-width: the ring radius snapped to an odd number of half pitches, so the outline runs in the gaps
 *  between node columns (never through a digit) and spans the nodes the bump reaches. */
export const fingerRadius = (rad: number, pitch: number) => (Math.max(0, Math.round(rad / pitch - 0.5)) + 0.5) * pitch;

/** Open fingertip outline: up the left side, over the rounded tip (centred on the touch point), down the right side to
 *  `bottom` (the grid's lower edge). */
export function fingerPath(x: number, y: number, r: number, bottom: number): string {
  const yb = Math.max(bottom, y + r);
  return `M ${r1(x - r)} ${r1(yb)} L ${r1(x - r)} ${r1(y)} A ${r1(r)} ${r1(r * 1.1)} 0 0 1 ${r1(x + r)} ${r1(y)} L ${r1(x + r)} ${r1(yb)}`;
}

const FingerGlyph: React.FC<{ x: number; y: number; r: number; bottom: number; tok: ColorToken; op: number }> = ({ x, y, r, bottom, tok, op }) => {
  if (op <= 0.001) return null;
  const d = fingerPath(x, y, r, bottom);
  return (
    <g opacity={r1(op * 100) / 100}>
      <path d={`${d} Z`} fill={color[tok]} opacity={0.08} />
      <path d={d} fill="none" stroke={color[tok]} strokeWidth={3} strokeLinejoin="round" />
    </g>
  );
};

/** Zoom progress 0..1: in over 14 f on entering `zoom`, out over 10 f on leaving it. */
export function zoomProgress(p: Pick<RenderProps<SensorGridPropsT>, "state" | "frame">): number {
  const at = p.state.f ?? 0;
  if (p.state.name === "zoom") return p.state.f === null ? 1 : easeBible(clamp01((p.frame - at) / 14));
  if (p.state.prev === "zoom" && p.state.f !== null) return 1 - easeBible(clamp01((p.frame - at) / 10));
  return 0;
}

/** The close-up of one crossing (state zoom), drawn over the grid area: its drive row and sense column as thick
 *  lines, the crossing's node large with its level / drop, ZOOM_RINGS dashed field rings — a touch takes the outer
 *  ones away (zoomRingsLeft) — and the fingertip when a touch reaches the crossing. */
const ZoomView: React.FC<{ p: RenderProps<SensorGridPropsT>; lay: GridLayout; level: number; zc: { col: number; row: number }; on: number }> = ({ p, lay, level, zc, on }) => {
  const P = p.props;
  const dim = p.state.name === "dim";
  const delta = P.measure === "delta";
  const gw = P.cols * lay.pitch;
  const gh = P.rows * lay.pitch;
  const cx = lay.gridX + gw / 2;
  const cy = lay.gridY + gh / 2;
  const S0 = Math.min(gw, gh);
  const N = Math.round(S0 * 0.26);
  const left = zoomRingsLeft(level);
  const shown = Math.round(level);
  const fillOp = delta ? BASE_OP * (1 - (DROP_K * level) / 9) : level > 0.05 ? Math.min(1, 0.1 + (0.9 * level) / 9) : 0;
  const t0 = P.touches.find(isFinger) ?? P.touches[0];
  const tok: ColorToken = dim ? "textDim" : TONE[t0?.tone ?? "accent"] ?? "accent";
  const fillTok: ColorToken = delta ? (dim ? "textDim" : "text") : tok;
  const digit = delta ? deltaText(shown) : String(shown);
  const digitTok: ColorToken = dim ? "textDim" : delta ? (shown > 0 ? "text" : "accentInk") : fillOp >= 0.62 ? "accentInk" : "text";
  const inset = 4 + (delta ? Math.round(((N - 8) * DROP_SHRINK * level) / 18) : 0);
  const small: React.CSSProperties = { fontFamily: font.mono, fontWeight: 500, fontSize: G.smallPx, color: color[dim ? "textDim" : "text"], whiteSpace: "pre", background: color.bgRaised, padding: "2px 10px", borderRadius: 8 };
  const finger = level > 0.5 && t0 && isFinger(t0);
  const sc = 0.85 + 0.15 * on;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: p.size.w, height: p.size.h, opacity: on, transform: `scale(${r1(sc * 1000) / 1000})`, transformOrigin: `${r1(cx)}px ${r1(cy)}px` }}>
      <svg width={p.size.w} height={p.size.h} style={{ position: "absolute", left: 0, top: 0 }}>
        <line x1={r1(lay.gridX)} x2={r1(lay.gridX + gw)} y1={r1(cy)} y2={r1(cy)} stroke={color[dim ? "border" : "textDim"]} strokeWidth={8} strokeLinecap="round" />
        <line x1={r1(cx)} x2={r1(cx)} y1={r1(lay.gridY)} y2={r1(lay.gridY + gh)} stroke={color[dim ? "border" : "textDim"]} strokeWidth={8} strokeLinecap="round" />
        {Array.from({ length: ZOOM_RINGS }, (_, k) => (
          <circle key={k} cx={r1(cx)} cy={r1(cy)} r={r1(N * 0.78 + k * N * 0.42)} fill="none" stroke={color[dim ? "textDim" : "text"]} strokeWidth={3} strokeDasharray="8 8" opacity={k < left ? 0.75 : 0.1} />
        ))}
      </svg>
      <div style={{ position: "absolute", left: r1(cx - N / 2), top: r1(cy - N / 2), width: N, height: N, boxSizing: "border-box", borderRadius: 16, background: color.bgRaised2, border: `2px ${delta && shown > 0 ? "dashed" : "solid"} ${color[delta && shown > 0 ? "textDim" : "borderStrong"]}` }}>
        {fillOp > 0.004 ? <div style={{ position: "absolute", inset, borderRadius: 10, background: color[fillTok], opacity: r1(fillOp * 100) / 100 }} /> : null}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.mono, fontWeight: 500, fontSize: Math.round(N * 0.34), fontVariantNumeric: "tabular-nums", color: color[digitTok] }}>{digit}</div>
      </div>
      {finger ? (
        <svg width={p.size.w} height={p.size.h} style={{ position: "absolute", left: 0, top: 0 }}>
          <FingerGlyph x={cx + N * 0.95} y={cy - N * 0.1} r={N * 0.6} bottom={lay.gridY + gh} tok={tok} op={1} />
        </svg>
      ) : null}
      <div style={{ position: "absolute", left: r1(lay.gridX + 8), top: r1(cy - 52), display: "flex" }}>
        <span style={small}>{`${P.rowLabel ?? "drive"} row ${zc.row}`}</span>
      </div>
      <div style={{ position: "absolute", left: r1(cx + 18), top: r1(lay.gridY + 8), display: "flex" }}>
        <span style={small}>{`${P.colLabel ?? "sense"} col ${zc.col}`}</span>
      </div>
    </div>
  );
};

const Render: React.FC<RenderProps<SensorGridPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const { w, h } = p.size;
  const P = p.props;
  const lay = sensorGridLayout(p.base, w);
  const st = p.state.name;
  const dim = st === "dim";
  const kick = flash(p.frame, p.last("focus"), 4);
  const ringPulse = flash(p.frame, p.last("pulse"), 5);
  const lv = levelsAt(p);
  const delta = P.measure === "delta";
  const gl = gridLevels(P);
  const scan = scanRow(p);
  const located = st === "located";
  const locF = located ? (p.state.f ?? 0) : 0;
  const cross = located ? drawOn(p.frame, locF + 6, 10) : 0;
  const chipIn = located ? interpolate(p.frame, [locF + 12, locF + 18], [0, 1], { ...clampX, easing: easeBible }) : 0;
  const scr = p.last("scramble");
  const gridW = P.cols * lay.pitch;
  const gridH = P.rows * lay.pitch;
  const nodeIn = (c: number, r: number) => (p.enterF === null ? 1 : interpolate(p.frame, [p.enterF + 3 + (c + r) * G.enterDiagF, p.enterF + 9 + (c + r) * G.enterDiagF], [0, 1], clampX));

  // outline set + tone per cluster (located)
  const outlined = new Map<string, ColorToken>();
  if (located) for (const cl of gl.clusters) for (const [c, r] of cl.nodes) outlined.set(`${c},${r}`, dim ? "textDim" : TONE[cl.tone] ?? "accent");
  // tone of the nearest touch per node (fill colour)
  const toneAt = (c: number, r: number): ColorToken => {
    if (dim) return "textDim";
    let best = P.touches[0];
    let bd = Infinity;
    for (const t of P.touches) {
      const d = (c + 0.5 - t.x * P.cols) ** 2 + (r + 0.5 - t.y * P.rows) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return TONE[best?.tone ?? "accent"] ?? "accent";
  };

  // W7.2 zoom: the grid magnifies ×3 about the crossing and fades (clipped to the grid area) while the close-up fades in
  const zc = zoomCrossing(P);
  const zoomOn = zoomProgress(p);
  const zq = nodeCentre(lay, zc.col - 1, zc.row - 1);
  // the clip sits on an UNSCALED wrapper (a clip-path on the scaled element would scale with it)
  const zoomClip: React.CSSProperties = zoomOn > 0.001 ? { clipPath: `inset(${r1(lay.gridY)}px ${r1(w - lay.gridX - gridW)}px ${r1(h - lay.gridY - gridH)}px ${r1(lay.gridX)}px)` } : {};
  const zoomGrid: React.CSSProperties = zoomOn > 0.001 ? { transform: `scale(${1 + 2 * zoomOn})`, transformOrigin: `${r1(zq.x)}px ${r1(zq.y)}px`, opacity: 1 - zoomOn } : {};
  const lines: React.ReactNode[] = [];
  for (let r = 0; r < P.rows; r++) {
    const y = lay.gridY + (r + 0.5) * lay.pitch;
    const on = scan === r && !dim;
    lines.push(<line key={`r${r}`} x1={r1(lay.gridX + lay.pitch * 0.12)} x2={r1(lay.gridX + gridW - lay.pitch * 0.12)} y1={r1(y)} y2={r1(y)} stroke={color[on ? "accent" : "borderStrong"]} strokeWidth={on ? G.scanLineW : G.lineW} strokeLinecap="round" />);
  }
  for (let c = 0; c < P.cols; c++) {
    const x = lay.gridX + (c + 0.5) * lay.pitch;
    lines.push(<line key={`c${c}`} x1={r1(x)} x2={r1(x)} y1={r1(lay.gridY + lay.pitch * 0.12)} y2={r1(lay.gridY + gridH - lay.pitch * 0.12)} stroke={color.borderStrong} strokeWidth={G.lineW} strokeLinecap="round" />);
  }

  const nodes: React.ReactNode[] = [];
  for (let r = 0; r < P.rows; r++) {
    for (let c = 0; c < P.cols; c++) {
      const q = nodeCentre(lay, c, r);
      const v = lv[r]?.[c] ?? 0;
      const shown = Math.round(v);
      const tok = toneAt(c, r);
      // level: a touch fills brighter in its tone · delta (W7.1): a grey baseline the touch takes AWAY (dark = drop),
      // never a bright lime fill for a decrease
      const fillOp = delta ? BASE_OP * (1 - (DROP_K * v) / 9) : v > 0.05 ? Math.min(1, 0.1 + (0.9 * v) / 9) : 0;
      const fillTok: ColorToken = delta ? (dim ? "textDim" : "text") : tok;
      const ol = outlined.get(`${c},${r}`);
      const scanOn = scan === r && !dim;
      const strong = !delta && fillOp >= 0.62 && (tok === "accent" || tok === "text");
      const e = nodeIn(c, r);
      let digit = delta ? deltaText(shown) : String(shown);
      if (scr !== undefined && p.f < scr + 8 && P.show === "values") digit = scramble(digit, digit, p.f, scr, 8, `${p.id}:v:${c},${r}:${scr}`);
      // delta digits: a drop prints in the touch's colour only for a danger (false) touch; an accent touch's drop is
      // white text on the dark node (the ring / crosshair / readout carry the answer colour)
      const digitTok: ColorToken = dim ? "textDim" : delta ? (shown > 0 ? (tok === "danger" ? "danger" : "text") : "accentInk") : strong ? "accentInk" : shown > 0 ? "text" : "textDim";
      const dropEdge = delta && shown > 0 && !ol && !scanOn;
      nodes.push(
        <div key={`${c},${r}`} style={{ position: "absolute", left: r1(q.x - lay.node / 2), top: r1(q.y - lay.node / 2), width: lay.node, height: lay.node, boxSizing: "border-box", borderRadius: 12, background: color.bgRaised2, border: `${ol ? 3 : scanOn ? 2 : 1}px ${dropEdge ? "dashed" : "solid"} ${color[ol ?? (scanOn ? "accent" : dropEdge ? "textDim" : "borderStrong")]}`, opacity: e }}>
          {fillOp > 0.004 ? <div style={{ position: "absolute", inset: (ol ? 3 : 2) + (delta ? Math.round(((lay.node - 6) * DROP_SHRINK * v) / 18) : 0), borderRadius: 8, background: color[fillTok], opacity: r1(fillOp * 100) / 100 }} /> : null}
          {P.show === "values" ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.mono, fontWeight: 500, fontSize: digit.length > 1 ? G.valuePx - 2 : G.valuePx, fontVariantNumeric: "tabular-nums", color: color[digitTok] }}>{digit}</div>
          ) : null}
        </div>,
      );
    }
  }

  // touch rings (touch / located; scan once the bump is visible)
  const rings: React.ReactNode[] = [];
  if (st !== "idle" && P.touches.length) {
    const since = p.state.prev === "idle" || p.state.prev === null ? (p.state.f ?? 0) : (p.changeF ?? 0);
    // once located, the touch ring steps back (0.35): the outlined nodes + locator lines are the answer
    const settle = located ? interpolate(p.frame, [locF, locF + 8], [1, 0.35], clampX) : 1;
    const rin = st === "scan" ? 0 : interpolate(p.frame, [since, since + 10], [0, 1], { ...clampX, easing: easeBible }) * settle;
    P.touches.forEach((t, i) => {
      const q = gridPoint(lay, P, t.x, t.y);
      const rad = touchSigma(t, P.cols, P.rows) * lay.pitch * 1.25 * (1 + 0.12 * ringPulse);
      const tok: ColorToken = dim ? "textDim" : TONE[t.tone] ?? "accent";
      if (isFinger(t)) rings.push(<FingerGlyph key={`t${i}`} x={q.x} y={q.y} r={fingerRadius(rad, lay.pitch)} bottom={lay.gridY + gridH + lay.pitch * 0.25} tok={tok} op={rin} />);
      else rings.push(<circle key={`t${i}`} cx={r1(q.x)} cy={r1(q.y)} r={r1(rad)} fill="none" stroke={color[tok]} strokeWidth={2} strokeDasharray={t.tone === "danger" ? "10 8" : undefined} opacity={rin} />);
    });
  }
  // W7.1 field overlay: one dashed ring per crossing (the drive → sense field), fading where the touch takes it
  const fieldRings: React.ReactNode[] = [];
  if (P.field) {
    const fin = p.changeF !== null && !p.prev.field ? interpolate(p.frame, [p.changeF, p.changeF + 10], [0, 1], clampX) : 1;
    for (let r = 0; r < P.rows; r++) {
      for (let c = 0; c < P.cols; c++) {
        const q = nodeCentre(lay, c, r);
        const v = lv[r]?.[c] ?? 0;
        const op = fin * nodeIn(c, r) * 0.85 * (1 - v / 9);
        if (op < 0.03) continue;
        fieldRings.push(<circle key={`f${c},${r}`} cx={r1(q.x)} cy={r1(q.y)} r={r1(lay.node / 2 + 7)} fill="none" stroke={color[dim ? "textDim" : "textDim"]} strokeWidth={2} strokeDasharray="4 5" opacity={r1(op * 100) / 100} />);
      }
    }
  }
  const ringLabels = st !== "idle" && st !== "scan" && lay.legendY === null
    ? P.touches.map((t, i) => {
        if (!t.label) return null;
        const q = gridPoint(lay, P, t.x, t.y);
        const rad = touchSigma(t, P.cols, P.rows) * lay.pitch * 1.25;
        const tok: ColorToken = dim ? "textDim" : TONE[t.tone] ?? "accent";
        const lw = t.label.length * G.smallPx * 0.6 + 24;
        const lx = Math.min(lay.gridX + gridW - lw, Math.max(lay.gridX, q.x + rad * 0.7));
        const ly = Math.max(lay.gridY - 4, q.y - rad - 46);
        return (
          <div key={`tl${i}`} style={{ position: "absolute", left: r1(lx), top: r1(ly), height: 40, display: "flex", alignItems: "center" }}>
            <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: G.smallPx, color: color[tok], background: color.bgRaised, border: `1px solid ${color[tok === "text" ? "borderStrong" : tok]}`, borderRadius: 8, padding: "2px 10px", whiteSpace: "pre" }}>{t.label}</span>
          </div>
        );
      })
    : null;

  // centroid: full-length locator lines UNDER the nodes (visible in the gaps: "col x, row y"); nothing is drawn over a
  // digit
  const crossLines: React.ReactNode[] = [];
  const crossRings: React.ReactNode[] = [];
  if (located && cross > 0) {
    gl.clusters.forEach((cl, i) => {
      const x = lay.gridX + (cl.col - 0.5) * lay.pitch;
      const y = lay.gridY + (cl.row - 0.5) * lay.pitch;
      const tok: ColorToken = dim ? "textDim" : TONE[cl.tone] ?? "accent";
      const x0 = x - (x - lay.gridX) * cross;
      const x1 = x + (lay.gridX + gridW - x) * cross;
      const y0 = y - (y - lay.gridY) * cross;
      const y1 = y + (lay.gridY + gridH - y) * cross;
      crossLines.push(
        <g key={`x${i}`}>
          <line x1={r1(x0)} x2={r1(x1)} y1={r1(y)} y2={r1(y)} stroke={color[tok]} strokeWidth={3} strokeLinecap="round" />
          <line x1={r1(x)} x2={r1(x)} y1={r1(y0)} y2={r1(y1)} stroke={color[tok]} strokeWidth={3} strokeLinecap="round" />
        </g>,
      );
      // the crossing itself sits UNDER the nodes; a small dot marks it only when it falls in a gap between nodes
      const inNode = Math.abs(cl.col - Math.round(cl.col)) < (lay.node / lay.pitch) / 2 && Math.abs(cl.row - Math.round(cl.row)) < (lay.node / lay.pitch) / 2;
      if (!inNode) crossRings.push(<circle key={`o${i}`} cx={r1(x)} cy={r1(y)} r={7} fill={color[tok]} stroke={color.bgRaised} strokeWidth={3} opacity={cross} />);
    });
  }

  const small: React.CSSProperties = { fontFamily: font.mono, fontWeight: 400, fontSize: G.smallPx, color: color.textDim, whiteSpace: "pre" };
  const legendOn = st !== "idle" && st !== "scan" ? interpolate(p.frame, [(p.state.f ?? 0), (p.state.f ?? 0) + 8], [0, 1], clampX) : 0;
  const legendEl = lay.legendY !== null ? (
    <div style={{ position: "absolute", left: lay.gridX, top: lay.legendY, height: 40, display: "flex", alignItems: "center", gap: 28, opacity: st === "idle" || st === "scan" ? 0 : p.state.prev === "idle" || p.state.prev === null || p.state.prev === "scan" ? legendOn : 1 }}>
      {P.touches.map((t, i) => {
        if (!t.label) return null;
        const tok: ColorToken = dim ? "textDim" : TONE[t.tone] ?? "accent";
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <svg width={26} height={26}><circle cx={13} cy={13} r={11} fill="none" stroke={color[tok]} strokeWidth={2} strokeDasharray={t.tone === "danger" ? "5 4" : undefined} /></svg>
            <span style={{ ...small, color: color[tok], fontWeight: 500 }}>{t.label}</span>
          </span>
        );
      })}
    </div>
  ) : null;
  // W7.1 delta / field legend: "Δ capacitance  [0] → [−9]" (baseline → full drop, drawn like the nodes) · "field"
  const mini = (op: number, text: string, dashed: boolean) => (
    <span style={{ position: "relative", width: DELTA_ROW.mini, height: DELTA_ROW.mini, boxSizing: "border-box", borderRadius: 10, background: color.bgRaised2, border: `1px ${dashed ? "dashed" : "solid"} ${color[dashed ? "textDim" : "borderStrong"]}`, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ position: "absolute", inset: 2, borderRadius: 7, background: color[dim ? "textDim" : "text"], opacity: op }} />
      <span style={{ position: "relative", fontFamily: font.mono, fontWeight: 500, fontSize: 26, color: color[dim ? "textDim" : dashed ? "text" : "accentInk"], fontVariantNumeric: "tabular-nums" }}>{text}</span>
    </span>
  );
  const deltaEl = lay.deltaY !== null ? (
    <div style={{ position: "absolute", left: lay.gridX, top: lay.deltaY, height: DELTA_ROW.mini, display: "flex", alignItems: "center", gap: DELTA_ROW.gap }}>
      {P.measure === "delta" ? (
        <>
          <span style={{ ...small, color: color[dim ? "textDim" : "text"], fontWeight: 500 }}>{DELTA_LEGEND}</span>
          {mini(BASE_OP, "0", false)}
          <span style={{ ...small, width: DELTA_ROW.arrow, textAlign: "center" }}>→</span>
          {mini(BASE_OP * (1 - DROP_K), deltaText(9), true)}
        </>
      ) : null}
      {P.field ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: P.measure === "delta" ? 24 : 0 }}>
          <svg width={30} height={30}><circle cx={15} cy={15} r={12} fill="none" stroke={color.textDim} strokeWidth={2} strokeDasharray="4 5" /></svg>
          <span style={small}>field</span>
        </span>
      ) : null}
    </div>
  ) : null;
  const rt = readoutText(P);
  // one cluster: its tone; several in different tones (finger + water drop): neutral — the chip only counts
  const tones = new Set(gl.clusters.map((c) => c.tone));
  // delta mode: the chip states a DROP — white, unless the touch is a danger (false) touch
  const chipTok: ColorToken = dim ? "textDim" : tones.size === 1 ? (delta && gl.clusters[0].tone === "accent" ? "text" : (TONE[gl.clusters[0].tone] ?? "accent")) : "text";
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box", borderRadius: radius.card, border: `${G.border}px solid ${color.borderStrong}`, background: color.bgRaised, ...fade.plate }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.content }}>
          {lay.titleY !== null && P.title ? <div style={{ position: "absolute", left: G.pad, top: lay.titleY, height: G.titleLh, lineHeight: `${G.titleLh}px`, fontFamily: font.sans, fontWeight: 600, fontSize: G.titlePx, color: color[dim ? "textDim" : "text"], whiteSpace: "pre" }}>{P.title}</div> : null}
          {lay.headerY !== null && P.colLabel ? (
            <div style={{ position: "absolute", left: lay.gridX, top: lay.headerY, width: gridW, height: G.headerH - 8, display: "flex", alignItems: "center", justifyContent: "center", ...small }}>{`${P.colLabel} →`}</div>
          ) : null}
          {P.rowLabel ? (
            <div style={{ position: "absolute", left: G.pad + 4, top: lay.gridY + gridH / 2, width: 0, height: 0 }}>
              <div style={{ position: "absolute", left: 0, top: 0, transform: "translate(-50%, -50%) rotate(-90deg)", transformOrigin: "50% 50%", ...small, marginLeft: 17 }}>{`${P.rowLabel} →`}</div>
            </div>
          ) : null}
          <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...zoomClip }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...zoomGrid }}>
            <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
              {lines}
              {crossLines}
            </svg>
            <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>{fieldRings}</svg>
            {nodes}
            <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
              {rings}
              {crossRings}
            </svg>
            {ringLabels}
          </div>
          </div>
          {zoomOn > 0.001 ? <ZoomView p={p} lay={lay} level={lv[zc.row - 1]?.[zc.col - 1] ?? 0} zc={zc} on={zoomOn} /> : null}
          {legendEl}
          {deltaEl}
          {lay.bottomY !== null ? (
            <>
              {rt !== null && chipIn > 0 ? (
                <div style={{ position: "absolute", left: G.pad, top: lay.bottomY, height: G.chipH, display: "flex", alignItems: "center", opacity: chipIn, transform: `scale(${0.9 + 0.1 * chipIn})`, transformOrigin: "0% 50%" }}>
                  <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: G.chipPx, color: color[chipTok], height: G.chipH, lineHeight: `${G.chipH - 4}px`, padding: "0 18px", boxSizing: "border-box", border: `2px solid ${color[chipTok === "text" ? "borderStrong" : chipTok]}`, borderRadius: radius.pill, whiteSpace: "pre", fontVariantNumeric: "tabular-nums" }}>{rt}</span>
                </div>
              ) : null}
              {P.tag !== "none" ? (
                <div style={{ position: "absolute", right: G.pad, top: lay.bottomY, height: G.chipH, display: "flex", alignItems: "center" }}>
                  <span style={{ ...small, height: 36, lineHeight: "34px", padding: "0 12px", boxSizing: "border-box", border: `1px solid ${color.border}`, borderRadius: radius.pill, letterSpacing: "0.04em" }}>{GRID_TAG_TEXT[P.tag]}</span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const SensorGrid = defineComponent({ ...meta, Render });
