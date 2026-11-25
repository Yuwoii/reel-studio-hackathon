// LayerStack renderer (W7 spec §4.2). Meta: src/v2/components-meta/LayerStack.ts.
//
// Opaque bgRaised plate (radius.card, 2 px borderStrong) → optional title → probe pads on the stack edge → the layer
// bands (flat token patterns per kind; labels on a plate in the band's own surface colour so a pattern never runs under
// text) → rays (3 px; inbound + scatter full, return leg at `strength`, a faint wide underlay so light reads as light)
// → flows (arrow + label plate; ≤ 3 carrier dots that move only during `mark`, 4 px/f) → NOT TO SCALE tag.
// Every coordinate comes from the meta's pure stackLayout / rayGeometry / flowGeometry. Layers slide in 3 f apart.
// Colours snap (lime ↔ red never fades); tokens only. enterExit "self" (plateFade).
import React from "react";
import { divertGeometry, divertShare, flowGeometry, LAYER_STACK, lightTone, meta, probeAt, probeLight, rayGeometry, rayTone, returnStrength, returnWidth, STACK_TAG_TEXT, stackLayout, swellCurve, type LayerDefT, type LayerStackPropsT } from "../../../src/v2/components-meta/LayerStack";
import { drawOn, easeBible, flash, staggerEnter, stateMix } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { DrawPath } from "./primitives";

const L = LAYER_STACK;
const TONE: Record<string, ColorToken> = { accent: "accent", danger: "danger", neutral: "text", dim: "textDim" };
const UNDER: Record<string, ColorToken> = { accent: "markAccent", danger: "markDanger", neutral: "border", dim: "border" };
const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const SURFACE: Record<LayerDefT["kind"], ColorToken> = { solid: "bgRaised2", grid: "bgRaised2", tissue: "bgRaised2", conductor: "bgRaised2", liquid: "bgRaised2", gap: "bg" };
/** Kinds whose pattern would run under a label (only these get a label plate). */
const PATTERNED = new Set<LayerDefT["kind"]>(["grid", "tissue", "liquid"]);
const path = (pts: { x: number; y: number }[]) => pts.map((q, i) => `${i ? "L" : "M"} ${r1(q.x)} ${r1(q.y)}`).join(" ");

/** Swell 0..1 at frame: the latest pulse, or the held `swelled` state (tweened 12 f on change). */
export function swellAt(p: Pick<RenderProps<LayerStackPropsT>, "last" | "props" | "prev" | "changeF">, frame: number): number {
  const at = p.last("pulse");
  const beat = at === undefined ? 0 : swellCurve(frame - at);
  const to = p.props.swelled ? 1 : 0;
  const from = p.prev.swelled ? 1 : 0;
  const k = p.changeF === null || from === to ? 1 : easeBible(clamp01((frame - p.changeF) / 12));
  return Math.max(beat, from + (to - from) * k);
}

/** Ray visibility 0..1 and draw progress per ray at frame. */
export function rayReveal(p: Pick<RenderProps<LayerStackPropsT>, "state" | "last" | "props">, frame: number): { on: number; prog: number[] } {
  const st = p.state.name;
  const d = p.last("drawOn");
  const drawnAfterState = d !== undefined && (p.state.f === null || d >= p.state.f);
  const shown = st === "lit" || st === "flow" || (drawnAfterState && st !== "idle" && st !== "focus") || (drawnAfterState && p.state.f === null);
  if (!shown) return { on: 0, prog: p.props.rays.map(() => 0) };
  if (d !== undefined && (p.state.f === null || d >= p.state.f - 0)) return { on: 1, prog: p.props.rays.map((_, i) => drawOn(frame, d + i * L.rayStaggerF, L.drawF)) };
  return { on: stateMix(frame, p.state.f), prog: p.props.rays.map(() => 1) };
}

/** Return strength of ray i at frame (tweens 12 f after a rays override; dims with the swell). */
function strengthAt(p: RenderProps<LayerStackPropsT>, i: number, swell: number): number {
  const to = p.props.rays[i]?.strength ?? 1;
  const from = p.prev.rays[i]?.strength ?? to;
  const k = p.changeF === null || from === to ? 1 : easeBible(clamp01((p.frame - p.changeF) / 12));
  return returnStrength(from + (to - from) * k, swell);
}

/** W7.3 ghost of a lowered return: the old strength and its fade 0..1 (1 on the change frame → 0 after ghostF), null =
 *  no drop in force. Swelled state counts (a held swell weakens the return the same way). */
export function dropGhost(p: Pick<RenderProps<LayerStackPropsT>, "props" | "prev" | "changeF" | "frame">, i: number): { from: number; fade: number } | null {
  if (p.changeF === null) return null;
  const r = p.props.rays[i];
  const o = p.prev.rays[i];
  if (!r || !o || o.from !== r.from || o.to !== r.to) return null;
  const was = returnStrength(o.strength, p.prev.swelled ? 1 : 0);
  const now = returnStrength(r.strength, p.props.swelled ? 1 : 0);
  if (!(was > now + 0.05)) return null;
  const dt = p.frame - p.changeF;
  if (dt < 0 || dt > L.ghostF) return null;
  return { from: was, fade: 1 - easeBible(clamp01((dt - 12) / (L.ghostF - 12))) };
}

function Patterns({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-grid`} width={24} height={24} patternUnits="userSpaceOnUse">
        <rect x={10} y={0} width={3} height={24} fill={color.borderStrong} />
      </pattern>
      <pattern id={`${id}-tissue`} width={24} height={24} patternUnits="userSpaceOnUse">
        <circle cx={4} cy={5} r={1.6} fill={color.textFaint} />
        <circle cx={16} cy={9} r={1.6} fill={color.textFaint} />
        <circle cx={9} cy={17} r={1.6} fill={color.textFaint} />
        <circle cx={21} cy={21} r={1.6} fill={color.textFaint} />
      </pattern>
      <pattern id={`${id}-liquid`} width={40} height={14} patternUnits="userSpaceOnUse">
        <rect x={0} y={6} width={40} height={2} fill={color.textFaint} />
      </pattern>
    </defs>
  );
}

const Render: React.FC<RenderProps<LayerStackPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const { w, h } = p.size;
  const P = p.props;
  const st = p.state.name;
  const dim = st === "dim";
  const swell = swellAt(p, p.frame);
  const lay = stackLayout(P, w, swell);
  const kick = flash(p.frame, p.last("focus"), 4);
  const sid = p.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const layerIn = (i: number) => (p.enterF === null ? 1 : staggerEnter(p.frame, p.enterF + 3, i, 3));
  // active highlight fades in over 6 f from the frame it was set
  const activeSince = P.active === undefined ? null : p.changeF !== null && p.prev.active !== P.active ? p.changeF : p.state.f;
  const act = P.active !== undefined && !dim ? stateMix(p.frame, activeSince) : 0;
  const actTok: ColorToken = TONE[P.activeTone] ?? "accent";

  // ── layers ──
  const bands: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  P.layers.forEach((l, i) => {
    const g = lay.layers[i];
    const e = layerIn(i);
    const isAct = l.id === P.active;
    const op = (P.active !== undefined && !isAct ? 1 - 0.4 * act : 1) * e;
    const dx = -24 * (1 - e);
    const surf = SURFACE[l.kind];
    bands.push(
      <g key={l.id} opacity={r1(op * 100) / 100} transform={dx ? `translate(${r1(dx)} 0)` : undefined}>
        <rect x={lay.stackX} y={r1(g.y)} width={lay.stackW} height={r1(g.h)} fill={color[surf]} />
        {l.kind === "conductor" ? <rect x={lay.stackX} y={r1(g.y)} width={lay.stackW} height={r1(g.h)} fill={color.textFainter} /> : null}
        {l.kind === "grid" || l.kind === "tissue" || l.kind === "liquid" ? <rect x={lay.stackX} y={r1(g.y)} width={lay.stackW} height={r1(g.h)} fill={`url(#${sid}-${l.kind})`} /> : null}
        {i > 0 ? <line x1={lay.stackX} x2={lay.stackX + lay.stackW} y1={r1(g.y)} y2={r1(g.y)} stroke={color.borderStrong} strokeWidth={l.kind === "conductor" || P.layers[i - 1].kind === "conductor" ? 2 : 1} /> : null}
      </g>,
    );
    const thin = l.size === "thin";
    const labTok: ColorToken = dim ? "textDim" : isAct && act > 0.5 ? actTok : "text";
    const plate = PATTERNED.has(l.kind) ? color[SURFACE[l.kind]] : undefined;
    labels.push(
      <div key={l.id} style={{ position: "absolute", left: lay.stackX + L.labelInset + dx, top: thin ? g.y + (g.h - 40) / 2 : g.y + 12, opacity: op, display: "flex", flexDirection: thin ? "row" : "column", alignItems: thin ? "center" : "flex-start", gap: thin ? 18 : 2 }}>
        <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: L.labelPx, lineHeight: "36px", color: color[labTok], whiteSpace: "pre", background: plate, padding: "2px 10px", marginLeft: -10, borderRadius: 8 }}>{l.label}</span>
        {l.sub ? <span style={{ fontFamily: font.mono, fontWeight: 400, fontSize: L.subPx, lineHeight: "32px", color: color.textDim, whiteSpace: "pre", background: plate, padding: "0 10px", marginLeft: thin ? 0 : -10, borderRadius: 8 }}>{l.sub}</span> : null}
      </div>,
    );
  });
  const actRect = P.active !== undefined && act > 0 ? lay.layers.find((g) => g.id === P.active) : undefined;

  // ── rays ──
  const rv = rayReveal(p, p.frame);
  const rays: React.ReactNode[] = [];
  const rayLabels: React.ReactNode[] = [];
  if (rv.on > 0) {
    const branches = divertGeometry(P, w, swell);
    rayGeometry(P, w, swell).forEach((r, i) => {
      const def = P.rays[i];
      if (!r.points.length) return;
      const tok: ColorToken = dim ? "textDim" : (TONE[rayTone(P, i)] ?? "text");
      const s = strengthAt(p, i, swell);
      const inbound = r.points.slice(0, r.points.length - 1);
      const back = r.points.slice(r.points.length - 2);
      const pr = rv.prog[i];
      const p1 = clamp01(pr / 0.72);
      const p2 = clamp01((pr - 0.72) / 0.28);
      rays.push(
        <g key={`r${i}`} opacity={rv.on} strokeLinejoin="round">
          <g opacity={0.9}>
            <DrawPath d={path(inbound)} progress={p1} id={`${sid}-ru${i}`} stroke={UNDER[def.tone] ?? "border"} strokeWidth={11} />
          </g>
          <DrawPath d={path(inbound)} progress={p1} id={`${sid}-ri${i}`} stroke={tok} strokeWidth={L.rayW} />
          <g opacity={r1(s * 100) / 100}>
            <DrawPath d={path(back)} progress={p2} id={`${sid}-rb${i}`} stroke={tok} strokeWidth={returnWidth(s)} />
          </g>
          {p2 >= 1 ? <polygon points={arrowHead(back[0], back[1], 14)} fill={color[tok]} opacity={r1(s * 100) / 100} /> : null}
          {p1 >= 0.3 ? <polygon points={arrowHead(r.points[0], r.points[1], 14, 0.55)} fill={color[tok]} /> : null}
          {(() => {
            // W7.3 ghost: the return as it WAS, dashed + faint, fading — a still right after "absorbs / dims" shows the loss
            const g = dim ? null : dropGhost(p, i);
            if (!g || p2 < 1) return null;
            return (
              <g opacity={r1(0.55 * g.fade * 100) / 100}>
                <path d={path(back)} fill="none" stroke={color.textDim} strokeWidth={returnWidth(g.from)} strokeDasharray="10 8" strokeLinecap="round" />
              </g>
            );
          })()}
          {(() => {
            // W7.3 partial ray: the lost share branches off the scatter path into the divert target (12 f draw)
            const br = branches[i];
            const share = divertShare(def);
            if (!br || share <= 0.02 || p1 < 1) return null;
            const since = p.changeF !== null && p.prev.rays[i]?.divert !== def.divert ? p.changeF : (p.state.f ?? 0);
            // drawn in 6 f so the review still at keyword + 6 already shows the whole branch
            const k = drawOn(p.frame, since, L.divertDrawF);
            if (k <= 0) return null;
            const end = { x: br.a.x + (br.b.x - br.a.x) * k, y: br.a.y + (br.b.y - br.a.y) * k };
            const bw = Math.max(L.divertMinW, returnWidth(share));
            return (
              <g>
                <circle cx={r1(br.a.x)} cy={r1(br.a.y)} r={r1(bw / 2 + 3)} fill={color[tok]} />
                <line x1={r1(br.a.x)} y1={r1(br.a.y)} x2={r1(end.x)} y2={r1(end.y)} stroke={color[tok]} strokeWidth={bw} strokeLinecap="round" opacity={0.95} />
                {k >= 1 ? <polygon points={arrowHead(br.a, br.b, 22)} fill={color[tok]} /> : null}
              </g>
            );
          })()}
        </g>,
      );
      if (def.divertLabel && branches[i] && !dim) {
        // at the arrow tip (inside the layer that takes the field), right of the branch: never over the arrowhead
        const br = branches[i]!;
        const m = { x: br.b.x, y: br.b.y };
        rayLabels.push(
          <div key={`dl${i}`} style={{ position: "absolute", left: m.x + 24, top: m.y - 20, height: 40, display: "flex", alignItems: "center", opacity: rv.on }}>
            <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: L.subPx, color: color[tok], background: color.bgRaised, border: `1px solid ${color.border}`, borderRadius: 8, padding: "2px 10px", whiteSpace: "pre" }}>{def.divertLabel}</span>
          </div>,
        );
      }
      if (def.label && p2 >= 1) {
        const m = { x: (back[0].x + back[1].x) / 2, y: (back[0].y + back[1].y) / 2 };
        rayLabels.push(
          <div key={`rl${i}`} style={{ position: "absolute", left: m.x + 22, top: m.y - 20, height: 40, display: "flex", alignItems: "center", opacity: rv.on }}>
            <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: L.subPx, color: color[tok], background: color.bgRaised, border: `1px solid ${color.border}`, borderRadius: 8, padding: "2px 10px", whiteSpace: "pre", fontVariantNumeric: "tabular-nums" }}>{def.label}</span>
          </div>,
        );
      }
    });
  }

  // ── flows ──
  const flowOn = st === "flow" ? stateMix(p.frame, p.state.f) : 0;
  const flows: React.ReactNode[] = [];
  const flowLabels: React.ReactNode[] = [];
  if (flowOn > 0) {
    const m = p.last("mark");
    flowGeometry(P, w, swell).forEach((g, i) => {
      const def = P.flows[i];
      const tok: ColorToken = dim ? "textDim" : (TONE[def.tone] ?? "accent");
      const dir = Math.sign(g.y1 - g.y0) || 1;
      const len = Math.abs(g.y1 - g.y0);
      const end = g.y1 - dir * 4;
      const moving = m !== undefined && p.frame - m <= L.markF;
      const spacing = len / L.carriers;
      const off = moving ? ((p.frame - (m as number)) * L.carrierPxPerF) % spacing : spacing * 0.5;
      flows.push(
        <g key={`f${i}`} opacity={flowOn}>
          <line x1={r1(g.x)} x2={r1(g.x)} y1={r1(g.y0)} y2={r1(end - dir * 12)} stroke={color[tok]} strokeWidth={3} strokeDasharray="10 8" />
          <polygon points={arrowHead({ x: g.x, y: g.y0 }, { x: g.x, y: end }, 18)} fill={color[tok]} />
          {Array.from({ length: L.carriers }, (_, k) => {
            const y = g.y0 + dir * (off + k * spacing);
            if (dir * (y - (end - dir * 14)) > 0) return null;
            return <circle key={k} cx={r1(g.x)} cy={r1(y)} r={L.carrierR} fill={color[tok]} stroke={color.bgRaised2} strokeWidth={2} />;
          })}
        </g>,
      );
      flowLabels.push(
        <div key={`fl${i}`} style={{ position: "absolute", left: g.x + L.flowPlateGap, top: (g.y0 + g.y1) / 2 - 20, height: 40, display: "flex", alignItems: "center", opacity: flowOn }}>
          <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: L.subPx, color: color[tok], background: color.bgRaised, border: `1px solid ${color.border}`, borderRadius: 8, padding: "2px 10px", whiteSpace: "pre" }}>{def.label}</span>
        </div>,
      );
    });
  }

  // ── probes ──
  const probes: React.ReactNode[] = [];
  const probeLabels: React.ReactNode[] = [];
  const firstIn = layerIn(0);
  const lastIn = layerIn(P.layers.length - 1);
  P.probes.forEach((q) => {
    const c = probeAt(q, lay);
    const e = q.side === "top" ? firstIn : lastIn;
    const top = q.side === "top" ? c.y - L.probeH : c.y;
    const rayI = P.rays.findIndex((r) => r.from === q.id || r.to === q.id || (r.divert === q.id && divertShare(r) > 0.02));
    const ray = rayI >= 0 ? P.rays[rayI] : undefined;
    // a contact pad (finger, coil) lights with the flow that reaches its side of the stack (or the ray it takes from)
    const flowTone = q.role === "contact" && flowOn > 0 && !dim ? P.flows[0]?.tone : undefined;
    const lit = (rv.on > 0 && !!ray && !dim) || !!flowTone;
    // W7.3: an emitter's dot draws in its LIGHT colour (a GREEN LED is lime even when its ray is grey)
    const light = lightTone(probeLight(q));
    const tok: ColorToken = flowTone ? (TONE[flowTone] ?? "accent") : lit ? (TONE[light ?? rayTone(P, rayI)] ?? "text") : "textDim";
    const glow = lit && q.role === "emitter" ? rv.on : 0;
    probes.push(
      <g key={q.id} opacity={e}>
        <rect x={r1(c.x - L.probeW / 2)} y={r1(top)} width={L.probeW} height={L.probeH} rx={10} fill={color.bgRaised2} stroke={color[flowTone ? tok : "borderStrong"]} strokeWidth={2} />
        {q.role === "emitter" ? (
          <>
            {glow > 0 ? <circle cx={r1(c.x)} cy={r1(top + L.probeH / 2)} r={16} fill={color[UNDER[light ?? rayTone(P, rayI)] ?? "border"]} opacity={glow} /> : null}
            <circle cx={r1(c.x)} cy={r1(top + L.probeH / 2)} r={9} fill={color[tok]} />
          </>
        ) : q.role === "detector" ? (
          <rect x={r1(c.x - 11)} y={r1(top + L.probeH / 2 - 11)} width={22} height={22} fill="none" stroke={color[tok]} strokeWidth={2} />
        ) : (
          <rect x={r1(c.x - 30)} y={r1(top + L.probeH / 2 - 4)} width={60} height={8} rx={4} fill={color[flowTone || lit ? tok : "textDim"]} />
        )}
      </g>,
    );
    const ly = q.side === "top" ? top - 8 - L.probeLabelH : top + L.probeH + 8;
    const lw = q.label.length * L.subPx * 0.6;
    const lx = Math.min(w - L.pad - lw, Math.max(L.pad, c.x - lw / 2));
    probeLabels.push(
      <div key={q.id} style={{ position: "absolute", left: r1(lx), top: r1(ly), height: L.probeLabelH, lineHeight: `${L.probeLabelH}px`, fontFamily: font.mono, fontWeight: 400, fontSize: L.subPx, color: color[lit ? "text" : "textDim"], whiteSpace: "pre", opacity: e }}>{q.label}</div>,
    );
  });

  const stackH = lay.stackBottom - lay.stackTop;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box", borderRadius: radius.card, border: `${L.border}px solid ${color.borderStrong}`, background: color.bgRaised, ...fade.plate }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.content }}>
          {lay.titleY !== null && P.title ? (
            <div style={{ position: "absolute", left: L.pad, top: lay.titleY, height: L.titleLh, lineHeight: `${L.titleLh}px`, fontFamily: font.sans, fontWeight: 600, fontSize: L.titlePx, color: color[dim ? "textDim" : "text"], whiteSpace: "pre" }}>{P.title}</div>
          ) : null}
          <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
            <Patterns id={sid} />
            <defs>
              <clipPath id={`${sid}-stack`}>
                <rect x={lay.stackX} y={lay.stackTop} width={lay.stackW} height={stackH} rx={L.stackRadius} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${sid}-stack)`}>{bands}</g>
            <rect x={lay.stackX + 0.5} y={lay.stackTop + 0.5} width={lay.stackW - 1} height={stackH - 1} rx={L.stackRadius} fill="none" stroke={color.borderStrong} strokeWidth={1} opacity={firstIn} />
            {actRect ? <rect x={lay.stackX + 1} y={r1(actRect.y + 1)} width={lay.stackW - 2} height={r1(actRect.h - 2)} rx={6} fill="none" stroke={color[actTok]} strokeWidth={2} opacity={act} /> : null}
            {rays}
            {flows}
            {probes}
          </svg>
          {labels}
          {rayLabels}
          {flowLabels}
          {probeLabels}
          {lay.tagY !== null ? (
            <div style={{ position: "absolute", left: L.pad, top: lay.tagY, height: L.rowH, display: "flex", alignItems: "center" }}>
              <span style={{ fontFamily: font.mono, fontWeight: 400, fontSize: L.subPx, color: color.textDim, height: L.rowH - 4, lineHeight: `${L.rowH - 6}px`, padding: "0 12px", boxSizing: "border-box", border: `1px solid ${color.border}`, borderRadius: radius.pill, letterSpacing: "0.04em", whiteSpace: "pre" }}>{STACK_TAG_TEXT[P.tag]}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/** Filled arrowhead (triangle points) at fraction `at` of segment a → b, pointing along it. */
export function arrowHead(a: { x: number; y: number }, b: { x: number; y: number }, size: number, at = 1): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tip = { x: a.x + dx * at + ux * (at < 1 ? size / 2 : 0), y: a.y + dy * at + uy * (at < 1 ? size / 2 : 0) };
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const hw = size * 0.55;
  return `${r1(tip.x)},${r1(tip.y)} ${r1(bx - uy * hw)},${r1(by + ux * hw)} ${r1(bx + uy * hw)},${r1(by - ux * hw)}`;
}

export const LayerStack = defineComponent({ ...meta, Render });
