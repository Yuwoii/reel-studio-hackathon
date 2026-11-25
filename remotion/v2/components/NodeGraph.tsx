// NodeGraph renderer (R7 N-2). Meta: src/v2/components-meta/NodeGraph.ts.
//
//   [lb]────────[api]────────[db]        nodes 120 px squares (radius.pill) or 72 px dots (inner tag / dot), mono 26
//                                        labels beneath on bgRaised plates; edges clipped at the node + label outline
//                                        (side ports, fanned out when edges share a side; geometry in the meta)
//    load balancer  checkout-api  postgres
//
// Self-animated enter: nodes stagger in 3 f apart (entrance spring), then edges draw on (12 f, 3 f apart, ≤ 9 f
// spread). Node look per state — ok: borderStrong / bgRaised · degraded: dashed danger border · danger: danger border
// + opaque dangerSurface, danger label, pulse 0.7↔1 / 20 f once settled, squash on the change · accent: accent border.
// Graph state dim: everything de-emphasised. Plate colours cross-fade 6 f; text colours snap. Edges: ONE solid 3 px
// token stroke — idle borderStrong (dim: border) over a sharp bg underlay 2 px wider; active accent / broken danger
// dashed (evolvePath through a mask) are the bare token stroke, no casing. `mark` launches a packet dot along the
// packet in force at the mark frame (props.packet or the mark's override; none → no packet);
// on a broken edge it stops at the midpoint, turns danger and fades out (8 f). Glitch (node going down): TokenGlitch —
// fixed danger / text tinted copies ±8 px behind the node block + a slice band kept inside the 120 px node square.
// Texture-clear zone: every node square / label plate sits on a soft bg halo, and ONE feathered bg scrim (VEIL_OP, a
// separable gradient mask: no filter, no stepped layers, no rim) dims the DataField across the graph box to ~1/3, so
// field glyphs neither compete with the labels nor get cut hard by the plates.
// Plates (W2.1 r2, plateFade per node, staggered): a node square and its label plate are opaque before the node's
// inner tag / label text show (+3 f). Exit: inner tags, labels, edges and packets fade + blur over the first 4 f on
// opaque plates; then the plates + halos go (4 f); the scrim holds at full strength until the plates are nearly gone
// (VEIL_OUT_F) — no frame shows field rows through a translucent node.
// Edges dock on the node border (edgeGap 0; the node square is drawn over the round cap), both ends alike.
// Packets: the route AND each hop's broken flag are fixed at launch from the props in force at the mark frame — the
// same rule the timeline's flight model (meta packetFlight) uses, so a mid-flight edgeStates change can never send the
// drawn packet past where the blur model stops.
// W5.1 evolution: `hidden` node / edge states (a node shown later enters on that frame, its edges draw on once both ends
// are visible; hidden again → 8 f fade); drawOn props.drawEdges draws only the listed edges; a packet leaves its route
// lit behind it (accent, edgeW + 2) until the graph's next state / mark event, and a broken hop ends in a held danger
// half-line + red X at the midpoint (no fade) — the hop is still visible on the next beat's still.
// W5.1 FR1: props.reveal (set by the stage-fill pass) keeps a node hidden until the word that names it, then it enters
// like a hidden → visible change; a packet route ends before a node / edge that is hidden at launch; an active edge
// that leads into a danger node (meta failingEdges) is drawn in danger, not lime; edge labels sit on a plate at the
// edge midpoint in the edge's tone; the inner tag is drawn only when it abbreviates the label (meta drawnInner).
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { propsAt, propsTimeline } from "../../../src/v2/components-meta/_lookup";
import { drawnInner, EDGE_LABEL, EDGE_STATES, edgeLabelBoxes, edgeSegments, failingEdges, graphMetrics, heldUntil, hopEase, meta, NODE_GRAPH, NODE_STATES, nodeCentre, packetHops, type NodeGraphPropsT } from "../../../src/v2/components-meta/NodeGraph";
import { activeGlitch, clampX, drawOn, enterProgress, exitOpacity, flash, pulse, squash, stateMix } from "../motion";
import { color, font, motion, type ColorToken } from "../theme";
import { defineComponent, type RenderProps, type TrackEvent } from "./contract";
import { plateFade } from "./plateFade";
import { DrawPath } from "./primitives";
import { TokenGlitch } from "./TokenGlitch";

type NodeState = (typeof NODE_STATES)[number];
type EdgeState = (typeof EDGE_STATES)[number];
const G = NODE_GRAPH;
/** Texture-clear zone: solid bg out to CLEAR_SOLID px around node squares / label plates, fading out by CLEAR_SOLID +
 *  CLEAR_SOFT (box-shadow spread + blur). */
const CLEAR_SOLID = 8;
const CLEAR_SOFT = 18;
const halo = `0 0 ${CLEAR_SOFT}px ${CLEAR_SOLID}px ${color.bg}`;
/** Field scrim (review W2.1 r1: the blurred-rect veil read as a stepped double card with a rim, and left the field
 *  legible): ONE bg layer at VEIL_OP (field shows at ~1/3) whose alpha ramps 0 → 1 over VEIL_FEATHER px from every
 *  box edge (two linear-gradient masks intersected) — fully inside the footprint, no filter, no edge band. */
export const VEIL_OP = 0.68;
export const VEIL_FEATHER = 72;
/** Scrim exit: holds at full strength until this many frames into the exit, then fades out by exit + 8. */
export const VEIL_OUT_F = 5;

interface NodeLook {
  border: ColorToken;
  surface: ColorToken;
  label: ColorToken;
  inner: ColorToken;
  dashed: boolean;
  glow: ColorToken | null;
}

const NODE_LOOK: Record<Exclude<NodeState, "hidden"> | "dim", NodeLook> = {
  ok: { border: "borderStrong", surface: "bgRaised", label: "text", inner: "text", dashed: false, glow: null },
  degraded: { border: "danger", surface: "bgRaised", label: "text", inner: "textDim", dashed: true, glow: null },
  danger: { border: "danger", surface: "dangerSurface", label: "danger", inner: "danger", dashed: false, glow: "markDanger" },
  accent: { border: "accent", surface: "bgRaised", label: "text", inner: "accent", dashed: false, glow: "markAccent" },
  dim: { border: "border", surface: "bgRaised", label: "textDim", inner: "textDim", dashed: false, glow: null },
};

const EDGE_TOKEN: Record<EdgeState | "dim", ColorToken> = { idle: "borderStrong", active: "accent", broken: "danger", hidden: "borderStrong", dim: "border" };
/** Opaque lit edge tokens: drawn bare (no underlay). */
const LIT: ReadonlySet<ColorToken> = new Set<ColorToken>(["accent", "danger"]);

export interface StateChange<S> {
  f: number;
  state: S;
  prev: S;
}

/**
 * Per-key state history from the base states and the `state` actions' override maps (each map replaces the previous
 * one; effective = override ?? base). Edge keys match either direction. Unknown values are ignored.
 */
export function stateHistory<S extends string>(base: Record<string, S>, events: readonly TrackEvent[], prop: "nodeStates" | "edgeStates", allowed: readonly string[], canon: (k: string) => string | null, initial: Record<string, S> = {}): Map<string, StateChange<S>[]> {
  const out = new Map<string, StateChange<S>[]>(Object.keys(base).map((k) => [k, []]));
  // W5.1: the instance's own override map (props.nodeStates / edgeStates) is in force from the start (the meta's flight
  // model and the lints always read it); the first `state` action's map replaces it, like any later one
  const cur: Record<string, S> = { ...base, ...initial };
  for (const e of events) {
    if (e.do !== "state") continue;
    const raw = e.props?.[prop];
    if (!raw || typeof raw !== "object") continue;
    const over: Record<string, S> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const c = canon(k);
      if (c && typeof v === "string" && allowed.includes(v)) over[c] = v as S;
    }
    for (const k of Object.keys(base)) {
      const next = over[k] ?? base[k];
      if (next !== cur[k]) {
        out.get(k)!.push({ f: e.f, state: next, prev: cur[k] });
        cur[k] = next;
      }
    }
  }
  return out;
}

function stateAtF<S>(hist: readonly StateChange<S>[] | undefined, base: S, f: number): { state: S; prev: S; f: number | null } {
  let hit: StateChange<S> | undefined;
  for (const h of hist ?? []) {
    if (h.f <= f) hit = h;
    else break;
  }
  return hit ? { state: hit.state, prev: hit.prev, f: hit.f } : { state: base, prev: base, f: null };
}

/** A visible window of a node / edge: from = reveal frame (null = with the graph's own enter), to = hide frame. */
export interface VisWindow {
  from: number | null;
  to: number | null;
}

/** Visible windows from the base state + the state history (`hidden` = not drawn). */
export function visWindows<S extends string>(base: S, hist: readonly StateChange<S>[] | undefined): VisWindow[] {
  const out: VisWindow[] = [];
  let open: VisWindow | null = base === "hidden" ? null : { from: null, to: null };
  for (const h of hist ?? []) {
    const vis = h.state !== "hidden";
    if (vis && !open) open = { from: h.f, to: null };
    else if (!vis && open) {
      open.to = h.f;
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

/** Windows under a library reveal frame r (props.reveal): nothing before r, a window open at r starts there. */
export function revealWindows(ws: readonly VisWindow[], r: number | undefined): VisWindow[] {
  if (r === undefined) return [...ws];
  return ws.filter((w) => w.to === null || w.to > r).map((w) => ({ from: w.from === null ? r : Math.max(w.from, r), to: w.to }));
}

/** The window in force at frame f: the last one that started at or before f (it may already be closing). */
export function windowAt(ws: readonly VisWindow[], f: number): VisWindow | null {
  let hit: VisWindow | null = null;
  for (const w of ws) if (w.from === null || w.from <= f) hit = w;
  return hit;
}

const minN = (...xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.min(...v) : null;
};

const mix = (t: number, a: ColorToken, b: ColorToken) => (t >= 1 || a === b ? color[b] : interpolateColors(t, [0, 1], [color[a], color[b]]));

const r2 = (x: number) => Math.round(x * 100) / 100;
/** plateFade style with the opacity rounded (and dropped once it is ≈ 1). */
const tidy = <T extends React.CSSProperties & { opacity: number }>(st: T): React.CSSProperties => ({ ...st, opacity: st.opacity >= 0.999 ? undefined : r2(st.opacity) });
const segD = (s: { ax: number; ay: number; bx: number; by: number }, rev = false) => (rev ? `M ${r2(s.bx)} ${r2(s.by)} L ${r2(s.ax)} ${r2(s.ay)}` : `M ${r2(s.ax)} ${r2(s.ay)} L ${r2(s.bx)} ${r2(s.by)}`);
export const edgeKey = (a: string, b: string) => `${a}>${b}`;

const Render: React.FC<RenderProps<NodeGraphPropsT>> = (p) => {
  const { w, h } = p.size;
  const props = p.base; // layout + base states never change; overrides come in through the state history
  const nodes = props.nodes;
  const edges = props.edges;
  const ids = new Set(nodes.map((n) => n.id));
  // W5.1: the drawn metrics (node scale k: fewer nodes → bigger nodes / labels, inside the same canvas)
  const m = graphMetrics(props, w, h);
  const centre = new Map(nodes.map((n) => [n.id, nodeCentre(n, w, h, m)]));
  const edgeIndex = new Map<string, number>();
  edges.forEach((e, i) => {
    edgeIndex.set(edgeKey(e.from, e.to), i);
    edgeIndex.set(edgeKey(e.to, e.from), i);
  });
  const canonEdge = (k: string) => {
    const i = edgeIndex.get(k);
    return i === undefined ? null : edgeKey(edges[i].from, edges[i].to);
  };
  const nodeInit = Object.fromEntries(Object.entries(props.nodeStates ?? {}).filter(([k]) => ids.has(k))) as Record<string, NodeState>;
  const edgeInit: Record<string, EdgeState> = {};
  for (const [k, v] of Object.entries(props.edgeStates ?? {})) {
    const c = canonEdge(k);
    if (c) edgeInit[c] = v;
  }
  const n0 = (n: { id: string; state: NodeState }): NodeState => nodeInit[n.id] ?? n.state;
  const e0 = (e: { from: string; to: string; state: EdgeState }): EdgeState => edgeInit[edgeKey(e.from, e.to)] ?? e.state;
  const nodeHist = stateHistory<NodeState>(Object.fromEntries(nodes.map((n) => [n.id, n.state])), p.events, "nodeStates", NODE_STATES, (k) => (ids.has(k) ? k : null), nodeInit);
  const edgeHist = stateHistory<EdgeState>(Object.fromEntries(edges.map((e) => [edgeKey(e.from, e.to), e.state])), p.events, "edgeStates", EDGE_STATES, canonEdge, edgeInit);
  const dim = p.state.name === "dim";
  const dimT = stateMix(p.frame, p.state.f);
  const wasDim = p.state.prev === "dim";
  const segs = edgeSegments(props, w, h, m);
  // the packet in force at each mark = the slot's props folding (base props.packet, then accepted overrides)
  const pt = propsTimeline(meta, props as unknown as Record<string, unknown>, p.events, w);

  // ── timing ──
  const enterF = p.enterF;
  const nodesDone = G.staggerF * Math.max(0, nodes.length - 1) + 6;
  const edgeStep = edges.length > 1 ? Math.min(G.edgeStaggerF, G.edgeStaggerMaxF / (edges.length - 1)) : 0;
  // drawOn events that (re)draw edge i: those without drawEdges (every edge, legacy) and those listing it (by list index)
  const drawOns = p.events.filter((e) => e.do === "drawOn");
  const drawsOf = (i: number) => {
    const k = edgeKey(edges[i].from, edges[i].to);
    const out: { f: number; step: number }[] = [];
    for (const e of drawOns) {
      const list = e.props?.drawEdges;
      if (!Array.isArray(list)) out.push({ f: e.f, step: edgeStep * i });
      else {
        const j = list.findIndex((x) => typeof x === "string" && canonEdge(x) === k);
        if (j >= 0) out.push({ f: e.f, step: edgeStep * j });
      }
    }
    return out;
  };
  const edgeProgress = (i: number) => {
    const mine = drawsOf(i);
    if (mine.length) {
      const last = mine.filter((d) => d.f <= p.f).pop();
      return last === undefined ? 0 : drawOn(p.frame, last.f + last.step, G.edgeDrawF);
    }
    if (enterF === null) return 1;
    return drawOn(p.frame, enterF + nodesDone + edgeStep * i, G.edgeDrawF);
  };
  // graph-level exit split: edges + packets are content (out first); node plates per node below
  const gfade = plateFade(p.frame, null, p.exitF);
  const nodeEnterF = (i: number) => (enterF === null ? null : enterF + G.staggerF * i);
  // W5.1 visible windows (hidden states): per node and per edge (edge's own state ∧ both ends)
  const reveal = props.reveal ?? {};
  const nodeWins = new Map(nodes.map((n) => [n.id, revealWindows(visWindows<NodeState>(n0(n), nodeHist.get(n.id)), reveal[n.id])]));
  const edgeWins = new Map(edges.map((e) => [edgeKey(e.from, e.to), visWindows<EdgeState>(e0(e), edgeHist.get(edgeKey(e.from, e.to)))]));
  /** Node i's enter / exit frames at f (null = not drawn at all at f). */
  const nodeSpan = (i: number): { enterAt: number | null; exitAt: number | null } | null => {
    const w = windowAt(nodeWins.get(nodes[i].id) ?? [], p.f);
    if (!w) return null;
    return { enterAt: w.from ?? nodeEnterF(i), exitAt: minN(w.to, p.exitF) };
  };
  /** Edge i at f: draw progress × hide fade (null = not drawn). A reveal draws on from the reveal frame (+6 f when a
   *  node reveal was the last of the three to open, so the node has popped in first). */
  const edgeVis = (i: number): { prog: number; op: number } | null => {
    const e = edges[i];
    const we = windowAt(edgeWins.get(edgeKey(e.from, e.to)) ?? [], p.f);
    const wa = windowAt(nodeWins.get(e.from) ?? [], p.f);
    const wb = windowAt(nodeWins.get(e.to) ?? [], p.f);
    if (!we || !wa || !wb) return null;
    const starts: [number, number][] = [];
    if (we.from !== null) starts.push([we.from, 0]);
    if (wa.from !== null) starts.push([wa.from, G.revealDelayF]);
    if (wb.from !== null) starts.push([wb.from, G.revealDelayF]);
    const end = minN(we.to, wa.to, wb.to);
    const op = end === null || p.frame < end ? 1 : 1 - interpolate(p.frame, [end, end + G.hideF], [0, 1], clampX);
    if (op <= 0.001) return null;
    if (!starts.length) return { prog: edgeProgress(i), op };
    const [at, delay] = starts.reduce((a, b) => (b[0] + b[1] > a[0] + a[1] ? b : a));
    return { prog: drawOn(p.frame, at + delay, G.edgeDrawF), op };
  };

  /** Is a node / edge drawn (not hidden, not revealed later) at discrete frame f? */
  const shownAt = (ws: readonly VisWindow[] | undefined, f: number) => {
    const w = windowAt(ws ?? [], f);
    return !!w && (w.to === null || f < w.to);
  };
  const nodeShown = (id: string, f: number) => shownAt(nodeWins.get(id), f);
  // active edges that lead into a danger node are drawn danger (evaluated on the discrete frame)
  const failing = failingEdges(
    edges,
    (id) => (nodeShown(id, p.f) ? stateAtF(nodeHist.get(id), n0(nodes.find((n) => n.id === id)!), p.f).state : "hidden"),
    (k) => {
      const e = edges[edgeIndex.get(k)!];
      return shownAt(edgeWins.get(k), p.f) ? stateAtF(edgeHist.get(k), e0(e), p.f).state : "hidden";
    },
  );

  // ── packets ──
  const arrivals: { node: string; f: number }[] = [];
  const packets: React.ReactNode[] = [];
  const held: React.ReactNode[] = [];
  p.events.forEach((e, k) => {
    if (e.do !== "mark") return;
    const pk = propsAt(pt, e.f).props.packet;
    if (typeof pk !== "string") return;
    // route geometry AND broken flags from the meta, with the edge states in force at the mark frame (= packetFlight,
    // the timeline's blur model): the drawn packet is exactly the modelled one
    const route = packetHops(props, w, h, pk.split(">"), segs, (a, b) => {
      const ei = edgeIndex.get(edgeKey(a, b));
      return ei !== undefined && stateAtF(edgeHist.get(edgeKey(edges[ei].from, edges[ei].to)), e0(edges[ei]), e.f).state === "broken";
    }, m, (a, b) => {
      // W5.1 FR1: no hop over a node / edge that is not drawn at launch
      const ei = edgeIndex.get(edgeKey(a, b));
      return !nodeShown(a, e.f) || !nodeShown(b, e.f) || (ei !== undefined && !shownAt(edgeWins.get(edgeKey(edges[ei].from, edges[ei].to)), e.f));
    });
    const hops: (typeof route[number] & { start: number })[] = [];
    let at = e.f;
    for (const hp of route) {
      hops.push({ ...hp, start: at });
      at += hp.hopF;
    }
    // held route (W5.1): every hop the dot has covered stays lit until the graph's next state / mark event
    const until = heldUntil(p.events, e.f, p.exitF);
    const heldOp = p.frame < until ? G.heldOpacity : G.heldOpacity * (1 - interpolate(p.frame, [until, until + G.heldFadeF], [0, 1], clampX));
    hops.forEach((hp, i) => {
      const t0 = hp.start;
      const dur = hp.broken ? Math.round(hp.hopF / 2) : hp.hopF;
      const u = p.frame < t0 ? 0 : hopEase(Math.min(1, (p.frame - t0) / dur)) * (hp.broken ? 0.5 : 1);
      const px = hp.sx + (hp.tx - hp.sx) * u;
      const py = hp.sy + (hp.ty - hp.sy) * u;
      const stopped = hp.broken && p.frame >= t0 + dur;
      if (p.frame >= t0 && heldOp > 0.001) {
        held.push(
          <line key={`hl${k}-${i}`} x1={r2(hp.sx)} y1={r2(hp.sy)} x2={r2(px)} y2={r2(py)} stroke={color[stopped ? "danger" : "accent"]} strokeWidth={m.edgeW + G.heldExtraW} strokeLinecap="round" opacity={r2(heldOp)} />,
        );
        if (stopped) {
          // the red X where the packet died: pops 1.4 → 1 over 4 f, held with the route (never fades on its own)
          const pop = 1 + 0.4 * (1 - interpolate(p.frame, [t0 + dur, t0 + dur + 4], [0, 1], clampX));
          const a = G.xHalf * pop * m.k;
          const xs = [[-a, -a, a, a], [-a, a, a, -a]];
          held.push(
            <g key={`hx${k}-${i}`} opacity={r2(heldOp / G.heldOpacity)}>
              {xs.map(([x1, y1, x2, y2], j) => <line key={`u${j}`} x1={r2(px + x1)} y1={r2(py + y1)} x2={r2(px + x2)} y2={r2(py + y2)} stroke={color.bg} strokeWidth={G.xStroke + 4} strokeLinecap="round" />)}
              {xs.map(([x1, y1, x2, y2], j) => <line key={`x${j}`} x1={r2(px + x1)} y1={r2(py + y1)} x2={r2(px + x2)} y2={r2(py + y2)} stroke={color.danger} strokeWidth={G.xStroke} strokeLinecap="round" />)}
            </g>,
          );
        }
      }
      if (p.frame >= t0 && p.frame < t0 + dur) {
        packets.push(<circle key={`pk${k}-${i}`} cx={r2(px)} cy={r2(py)} r={m.packetR} fill={color.accent} stroke={color.bg} strokeWidth={3} />);
      }
      if (!hp.broken && i + 1 === hops.length) arrivals.push({ node: hp.to, f: t0 + hp.hopF });
    });
  });

  // ── edges ──
  const edgeEls = edges.map((e, i) => {
    const ev = edgeVis(i);
    if (!ev) return null;
    const prog = ev.prog;
    if (prog <= 0) return null;
    const k = edgeKey(e.from, e.to);
    const st = stateAtF(edgeHist.get(k), e0(e), p.f);
    const t = stateMix(p.frame, st.f);
    const d = segD(segs[i]);
    const look = (s: EdgeState, d: boolean) => ({ tok: d ? EDGE_TOKEN.dim : s === "active" && failing.has(k) ? ("danger" as ColorToken) : EDGE_TOKEN[s], broken: s === "broken" });
    // a hidden edge only shows while it fades out: keep the look it had (never a "hidden" colour)
    if (st.state === "hidden") st.state = st.prev === "hidden" ? "idle" : st.prev;
    if (st.prev === "hidden") st.prev = st.state;
    const to = look(st.state, dim);
    let from = to;
    let tt = 1;
    if (st.f !== null && t < 1) {
      from = look(st.prev, dim);
      tt = t;
    } else if (p.state.f !== null && dimT < 1) {
      from = look(st.state, wasDim);
      tt = dimT;
    }
    // idle / dim edges (translucent border tokens) sit on a sharp bg underlay ≤ 2 px wider, so the field never shows
    // through the stroke; lit edges (accent / danger, opaque) are the bare token stroke — never a casing or halo
    const layer = (l: { tok: ColorToken; broken: boolean }, op: number, tag: string) =>
      op <= 0.001 ? null : (
        <g key={tag} opacity={op < 1 ? r2(op) : undefined}>
          {LIT.has(l.tok) ? null : <DrawPath d={d} progress={prog} id={`${p.id}-e${i}-${tag}-u`} stroke="bg" strokeWidth={m.edgeW + G.edgeUnderlay} />}
          <DrawPath d={d} progress={prog} id={`${p.id}-e${i}-${tag}`} stroke={l.tok} strokeWidth={m.edgeW} dash={l.broken ? G.brokenDash : undefined} maskWidth={m.edgeW * 6} />
        </g>
      );
    return (
      <g key={k} opacity={ev.op < 1 ? r2(ev.op) : undefined}>
        {tt < 1 ? layer(from, 1 - tt, "was") : null}
        {layer(to, tt, "now")}
      </g>
    );
  });

  // ── edge labels (W5.1 FR1): a plate at the midpoint, in the edge's tone, while the edge is drawn ──
  const labelEls = edgeLabelBoxes(props, w, h, m).map((b) => {
    const e = edges[b.i];
    const ev = edgeVis(b.i);
    if (!ev) return null;
    const op = ev.op * interpolate(ev.prog, [0.5, 1], [0, 1], clampX) * gfade.content.opacity;
    if (op <= 0.001) return null;
    const k = edgeKey(e.from, e.to);
    const st = stateAtF(edgeHist.get(k), e0(e), p.f).state;
    const tok: ColorToken = dim ? "textDim" : st === "broken" || (st === "active" && failing.has(k)) ? "danger" : st === "active" ? "accent" : "textDim";
    return (
      <div key={`el${k}`} style={{ position: "absolute", left: r2(b.x), top: r2(b.y), width: b.w, height: b.h, boxSizing: "border-box", borderRadius: 6, background: color.bgRaised, border: `1px solid ${color[tok === "textDim" ? "border" : tok]}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.mono, fontWeight: 500, fontSize: Math.round(EDGE_LABEL.px * m.k), lineHeight: `${b.h - 2}px`, color: color[tok], whiteSpace: "pre", opacity: op < 0.999 ? r2(op) : undefined }}>
        {b.text}
      </div>
    );
  });

  // ── nodes ──
  const glitchFrames = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  const gAt = activeGlitch(glitchFrames, p.frame);
  const glow = flash(p.frame, p.last("pulse"), 5);
  const anyDangerAtGlitch = gAt !== undefined && nodes.some((n) => stateAtF(nodeHist.get(n.id), n0(n), gAt).state === "danger");
  const nodeEls = nodes.map((n, i) => {
    const span = nodeSpan(i);
    if (!span) return null;
    const nf = plateFade(p.frame, span.enterAt, span.exitAt);
    if (!nf.visible) return null;
    const eRaw = enterProgress(p.frame, span.enterAt);
    const e = eRaw >= 0.999 ? 1 : eRaw;
    const st = { ...stateAtF(nodeHist.get(n.id), n0(n), p.f) };
    // hidden is a visibility, not a look: a node revealed / fading out keeps its last visible look ("ok" by default)
    if (st.state === "hidden") st.state = st.prev === "hidden" ? "ok" : st.prev;
    if (st.prev === "hidden") {
      st.prev = st.state;
      st.f = null;
    }
    const t = stateMix(p.frame, st.f);
    const lookNow = dim ? NODE_LOOK.dim : NODE_LOOK[st.state as Exclude<NodeState, "hidden">];
    const lookWas = st.f !== null && t < 1 ? NODE_LOOK[st.prev as Exclude<NodeState, "hidden">] : p.state.f !== null && dimT < 1 ? (wasDim ? NODE_LOOK.dim : NODE_LOOK[st.state as Exclude<NodeState, "hidden">]) : lookNow;
    const tt = st.f !== null && t < 1 ? t : p.state.f !== null && dimT < 1 ? dimT : 1;
    const c = centre.get(n.id)!;
    const size = n.shape === "square" ? m.node : m.dot;
    const inner = drawnInner(n);
    const blockW = 2 * m.padX;
    const blockH = size + m.labelGap + m.labelLineH;
    const settledDanger = st.state === "danger" && !dim;
    const pulseFrom = st.f === null ? 0 : st.f + motion.scrambleF[1];
    const borderOp = settledDanger && p.frame >= pulseFrom ? pulse(p.frame, pulseFrom) : 1;
    const turnedDanger = st.state === "danger" && st.f !== null ? st.f : undefined;
    const arrive = arrivals.filter((a) => a.node === n.id && a.f <= p.frame).map((a) => a.f).pop();
    const sq = Math.min(squash(p.frame, turnedDanger), squash(p.frame, arrive));
    const scale = (motion.enterScale + (1 - motion.enterScale) * e) * sq;
    const glowTok = lookNow.glow;
    const ring = glow > 0 && glowTok && !dim ? `0 0 0 ${r2(6 * glow)}px ${color[glowTok]}` : undefined;
    const sqBox: React.CSSProperties = { position: "absolute", left: (blockW - size) / 2, top: 0, width: size, height: size, boxSizing: "border-box", borderRadius: n.shape === "square" ? m.radius : size / 2 };
    const labelRow: React.CSSProperties = { position: "absolute", left: 0, top: size + m.labelGap, width: blockW, height: m.labelLineH, display: "flex", justifyContent: "center" };
    const labelSpan: React.CSSProperties = { display: "block", height: m.labelLineH, padding: `0 ${m.labelPadX}px`, borderRadius: 6, fontFamily: font.mono, fontWeight: 500, fontSize: m.labelPx, lineHeight: `${m.labelLineH}px`, whiteSpace: "pre" };
    const block = (
      <div style={{ position: "absolute", left: 0, top: 0, width: blockW, height: blockH }}>
        {/* plates: opaque before the texts show, last to go (plateFade) */}
        <div style={{ position: "absolute", left: 0, top: 0, width: blockW, height: blockH, ...tidy(nf.plate) }}>
          <div
            style={{
              ...sqBox,
              border: `${m.border}px ${lookNow.dashed && tt >= 0.5 ? "dashed" : lookWas.dashed && tt < 0.5 ? "dashed" : "solid"} ${mix(tt, lookWas.border, lookNow.border)}`,
              background: mix(tt, lookWas.surface, lookNow.surface),
              boxShadow: ring,
            }}
          />
          {settledDanger && borderOp < 1 ? (
            // the pulse dims the danger border only (the plate stays opaque)
            <div style={{ ...sqBox, border: `${m.border}px solid ${color.dangerSurface}`, opacity: 1 - borderOp }} />
          ) : null}
          <div style={labelRow}>
            <span style={{ ...labelSpan, background: color.bgRaised, color: "transparent" }}>{n.label}</span>
          </div>
        </div>
        {/* content: inner tag / dot mark + label text */}
        <div style={{ position: "absolute", left: 0, top: 0, width: blockW, height: blockH, ...tidy(nf.content) }}>
          <div style={{ ...sqBox, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {inner ? (
              <span style={{ fontFamily: font.mono, fontWeight: 600, fontSize: n.shape === "square" ? m.innerPx : m.dotInnerPx, color: color[lookNow.inner], opacity: borderOp, whiteSpace: "pre" }}>{inner}</span>
            ) : n.shape === "dot" ? (
              // leaf / external node without a tag: a subtle inner dot in the border token (state colour)
              <div style={{ width: m.dotInner, height: m.dotInner, borderRadius: m.dotInner / 2, background: mix(tt, lookWas.border, lookNow.border), opacity: borderOp }} />
            ) : null}
          </div>
          <div style={labelRow}>
            <span style={{ ...labelSpan, color: color[lookNow.label] }}>{n.label}</span>
          </div>
        </div>
      </div>
    );
    const glitchThis = gAt !== undefined && (!anyDangerAtGlitch || stateAtF(nodeHist.get(n.id), n0(n), gAt).state === "danger");
    return (
      <div
        key={n.id}
        style={{
          position: "absolute", left: c.x - blockW / 2, top: c.y - size / 2, width: blockW, height: blockH,
          transform: `translateY(${r2((1 - e) * motion.enterY)}px) scale(${r2(scale * 10000) / 10000})`,
          transformOrigin: `50% ${size / 2}px`,
        }}
      >
        {glitchThis ? (
          <TokenGlitch frame={p.frame} at={gAt} seed={`${p.id}:${n.id}:glitch`} w={blockW} h={blockH} area={{ x: (blockW - size) / 2, y: 0, w: size, h: size }}>
            {block}
          </TokenGlitch>
        ) : (
          block
        )}
      </div>
    );
  });

  // the scrim comes in with the first node's plate and holds (full strength) until the plates are nearly gone
  // the scrim follows the graph's own enter (a first node that is hidden at the start must not delay it)
  const veilIn = plateFade(p.frame, enterF, null).plate.opacity;
  const veilOut = p.exitF === null ? 1 : exitOpacity(interpolate(p.frame, [p.exitF + VEIL_OUT_F, p.exitF + motion.exitF], [0, 1], clampX));
  const veilOp = VEIL_OP * veilIn * veilOut;
  // texture-clear halos UNDER the edges (so they never fade an edge end): node square + label plate, with the plate
  const haloEls = nodes.map((n, i) => {
    const span = nodeSpan(i);
    if (!span) return null;
    const op = plateFade(p.frame, span.enterAt, span.exitAt).plate.opacity;
    if (op <= 0.001) return null;
    const c = centre.get(n.id)!;
    const size = n.shape === "square" ? m.node : m.dot;
    const lw = n.label.length * m.charW + 2 * m.labelPadX;
    const top = c.y + size / 2 + m.labelGap;
    const box = (x: number, y: number, bw: number, bh: number, rad: number, tag: string) => (
      <div key={`${n.id}-${tag}`} style={{ position: "absolute", left: r2(x), top: r2(y), width: r2(bw), height: r2(bh), borderRadius: rad, background: color.bg, boxShadow: halo, opacity: op < 0.999 ? r2(op) : undefined }} />
    );
    return (
      <React.Fragment key={`h${n.id}`}>
        {box(c.x - size / 2, c.y - size / 2, size, size, n.shape === "square" ? m.radius : size / 2, "sq")}
        {box(c.x - lw / 2, top, lw, m.labelLineH, 6, "lbl")}
      </React.Fragment>
    );
  });
  // alpha masks (the stop colour only carries alpha): any opaque token
  const ramp = (dir: string, len: number) => `linear-gradient(${dir}, transparent 0px, ${color.bg} ${Math.min(VEIL_FEATHER, len / 2)}px, ${color.bg} calc(100% - ${Math.min(VEIL_FEATHER, len / 2)}px), transparent 100%)`;
  const mask = `${ramp("to right", w)}, ${ramp("to bottom", h)}`;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      {veilOp > 0.001 ? (
        <div
          data-veil
          aria-hidden
          style={{ position: "absolute", left: 0, top: 0, width: w, height: h, background: color.bg, opacity: r2(veilOp), maskImage: mask, WebkitMaskImage: mask, maskComposite: "intersect", WebkitMaskComposite: "source-in" }}
        />
      ) : null}
      {haloEls}
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, ...tidy(gfade.content) }}>
        {edgeEls}
        {held}
        {packets}
      </svg>
      {nodeEls}
      {labelEls}
    </div>
  );
};

export const NodeGraph = defineComponent({ ...meta, Render });
