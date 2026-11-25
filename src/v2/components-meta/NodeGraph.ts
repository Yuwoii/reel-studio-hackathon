// NodeGraph — R7 N-2 (families security, outage, network, systems, data). Renderer: remotion/v2/components/NodeGraph.tsx.
//
//   Nodes: 120×120 bgRaised rounded squares (radius.pill 16) or 72 px circles (leaf / external node) with an optional
//   mono 22 inner tag (else a 14 px inner dot), 2 px border, mono 26 label beneath (≤ 8 nodes). Edges: ONE solid 3 px
//   token stroke (idle borderStrong over a bg underlay ≤ 2 px wider; lit edges the bare token stroke, no casing) between
//   node side ports, docked ON the node border at both ends (W2.1 r2: they stopped 8 px short and looked like they
//   floated) and ≥ 14 px clear of label plates; edges that share a node side fan out to separate ports. Node state ok /
//   degraded / danger (R7 "down": danger border + opaque dangerSurface + pulse) / accent (R7 "highlight": accent
//   border). Edge state idle (borderStrong) / active (accent) / broken (danger, dashed). Nodes stagger in by 3 f,
//   then edges draw on over 12 f. A packet dot (accent) travels an edge path on `mark` (R7 N-3: 10–14 f per hop,
//   bezier in/out HOP_EASE; the SHORTEST duration whose peak stays ≤ PACKET_PEAK_PX_PER_F, see hopFrames); on a
//   broken edge it stops at the midpoint, turns danger and fades.
//   Labels sit on bgRaised plates; edges leave a node at its node+label outline (≥ 12 px clear of the label plate).
//
// Node positions are CONTENT (the graph's own layout, 0..1 of the plot area), not the instance position.
import { z } from "zod";
import type { ComponentMetaDef, DrawnShape } from "./_types.js";

const NodeId = z.string().regex(/^[a-z0-9-]{1,16}$/, "node id: 1–16 chars of a-z 0-9 -");
/** W5.1: `hidden` = not drawn yet / any more. A node turning visible enters (spring) on that frame; its edges draw on
 *  once both ends are visible (and the edge itself is not hidden), so ONE persistent graph can grow per beat. */
export const NODE_STATES = ["ok", "degraded", "danger", "accent", "hidden"] as const;
export const EDGE_STATES = ["idle", "active", "broken", "hidden"] as const;
const NodeState = z.enum(NODE_STATES);
const EdgeState = z.enum(EDGE_STATES);
const EdgeKey = z.string().regex(/^[a-z0-9-]{1,16}>[a-z0-9-]{1,16}$/, 'edge key: "from>to"');
/** "a>b" or a multi-hop path "a>b>c" (≤ 4 hops). */
const PacketPath = z.string().regex(/^[a-z0-9-]{1,16}(>[a-z0-9-]{1,16}){1,4}$/, 'packet: "from>to" or "a>b>c" (≤ 4 hops)');

const GraphNode = z
  .object({
    id: NodeId,
    /** Mono 26 px beneath the node. */
    label: z.string().min(1).max(14),
    /** Centre in the plot area, 0 (left/top) .. 1 (right/bottom). */
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    shape: z.enum(["square", "dot"]).default("square"),
    /** Optional short mono tag inside the node (square: mono 30, dot: mono 22; e.g. "AS1", "db"). */
    inner: z.string().min(1).max(4).optional(),
    state: NodeState.default("ok"),
  })
  .strict();

const GraphEdge = z
  .object({
    from: NodeId,
    to: NodeId,
    state: EdgeState.default("idle"),
    /** W5.1 FR1: optional short word drawn at the edge's midpoint (mono 22 on a plate, the edge's tone): "preferred",
     *  "cross-sign" — so an edge-state change carries a word. Shown while the edge is drawn. */
    label: z.string().min(1).max(12).optional(),
  })
  .strict();

export const NodeGraphProps = z
  .object({
    nodes: z.array(GraphNode).min(2).max(8),
    edges: z.array(GraphEdge).max(12).default([]),
    /** Plot proportions: wide 900×560, square 900×800, tall 900×1040 (at the default width). */
    aspect: z.enum(["wide", "square", "tall"]).default("wide"),
    /** State overrides by node id (cumulative map: each `state` action replaces the previous map). */
    nodeStates: z.record(NodeId, NodeState).optional(),
    /** State overrides by edge key "from>to" (same rule). */
    edgeStates: z.record(EdgeKey, EdgeState).optional(),
    /** Packet route for a `mark` action ("lb>api>db"); each mark launches one packet. */
    packet: PacketPath.optional(),
    /** drawOn only (W5.1): the edges this drawOn (re)draws ("a>b", either direction). Listed edges stay undrawn until
     *  their first such drawOn; edges no drawOn lists draw after the enter as usual. Omitted = every edge (legacy). */
    drawEdges: z.array(EdgeKey).min(1).max(12).optional(),
    /** W5.1 drawn layout, SET BY THE LIBRARY's stage-fill pass (timeline.ts fitWorld) after checking it against the
     *  reel's camera — directors leave it out. k = node / label scale cap (fewer nodes → bigger); stretch "y" / "xy" =
     *  draw the nodes' y (and x) range across the whole canvas. Without "xy" the graph keeps its spec content WIDTH:
     *  node centres move inward as the blocks grow; spread = how far the stretch goes (1 = the whole canvas). Omitted =
     *  the spec layout (k 1, no stretch). */
    layout: z.object({ k: z.number().min(1).max(1.6), stretch: z.enum(["none", "y", "xy"]), spread: z.number().min(0).max(1).default(1) }).strict().optional(),
    /** W5.1 FR1 reveal, SET BY THE LIBRARY's stage-fill pass (timeline.ts revealFrames) — directors leave it out: node id
     *  → the reel frame the node first shows (the word that names it). Before it the node is hidden (its edges with it);
     *  on it the node enters like a `hidden` → visible state change. Only on graphs that use no `hidden` / drawEdges. */
    reveal: z.record(NodeId, z.number().int().min(0)).optional(),
    /** W7.3 canvas height, SET BY THE LIBRARY's stage-fill pass (timeline.ts fitWorld height step) — directors leave it
     *  out: a taller plot than the aspect's (node y positions are shares of the plot, so rows spread apart) when the
     *  graph is the only focal subject. */
    canvasH: z.number().int().min(300).max(1100).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const n of p.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: `duplicate node id "${n.id}"`, path: ["nodes"] });
      ids.add(n.id);
    }
    for (const e of p.edges) if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) ctx.addIssue({ code: "custom", message: `edge ${e.from}>${e.to}: unknown node or self-loop`, path: ["edges"] });
    for (const k of Object.keys(p.nodeStates ?? {})) if (!ids.has(k)) ctx.addIssue({ code: "custom", message: `nodeStates: unknown node "${k}"`, path: ["nodeStates"] });
    for (const k of Object.keys(p.edgeStates ?? {})) {
      const [a, b] = k.split(">");
      if (!p.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))) ctx.addIssue({ code: "custom", message: `edgeStates: no edge "${k}"`, path: ["edgeStates"] });
    }
    if (p.packet) for (const id of p.packet.split(">")) if (!ids.has(id)) ctx.addIssue({ code: "custom", message: `packet: unknown node "${id}"`, path: ["packet"] });
    for (const k of Object.keys(p.reveal ?? {})) if (!ids.has(k)) ctx.addIssue({ code: "custom", message: `reveal: unknown node "${k}"`, path: ["reveal"] });
    for (const k of p.drawEdges ?? []) {
      const [a, b] = k.split(">");
      if (!p.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))) ctx.addIssue({ code: "custom", message: `drawEdges: no edge "${k}"`, path: ["drawEdges"] });
    }
  });

export type NodeGraphPropsT = z.output<typeof NodeGraphProps>;

export const NODE_GRAPH = {
  defaultW: 900,
  minW: 560,
  maxW: 952,
  h: { wide: 560, square: 800, tall: 1040 },
  node: 120,
  /** W2.1 r2: 72 px (44 still read as a lesser, unexplained node among 120 px boxes), inner tag mono 22 or a 14 px dot. */
  dot: 72,
  dotInner: 14,
  dotInnerPx: 22,
  radius: 16, // = theme radius.pill
  border: 2,
  /** W2.1: one solid 3 px stroke (was 2 px over an 18 px blurred bg casing, which read as a two-line "tube"). */
  edgeW: 3,
  /** bg underlay under idle / dim edges only: edgeW + this (≤ 2 px wider, review W2 r3). */
  edgeUnderlay: 2,
  /** Edge end distance outside the node outline: 0 = docked on the border (the node square covers the round cap). */
  edgeGap: 0,
  /** Fan-out: edges sharing a square's side leave from separate ports ≤ portMax px off the side midpoint (the side's
   *  straight part is ±44 px), ≥ portGap px apart when there is room. */
  portMax: 36,
  portGap: 24,
  /** Label plate: bgRaised, 8 px side padding; edge ends keep ≥ 14 px clear of it (≥ 12, and a packet dot
   *  (r 11 + stroke) sitting on an edge end stays off the plate). */
  labelPadX: 8,
  labelClear: 14,
  /** Mono 26 advance (JetBrains Mono 0.6 em). */
  charW: 15.6,
  labelPx: 26,
  labelGap: 12,
  labelLineH: 32,
  innerPx: 30,
  /** Horizontal inset of node centres: half of the widest label (14 mono chars ≈ 218 px) + margin. */
  padX: 130,
  padTop: 8,
  padBottom: 8,
  packetR: 11,
  /** R7 N-3: one hop per 10–14 f with bezier in/out (HOP_EASE); stretched past 14 only for very long edges. */
  hopF: [10, 14],
  staggerF: 3,
  edgeDrawF: 12,
  edgeStaggerF: 3,
  edgeStaggerMaxF: 9,
  brokenDash: "12 10",
  /** W5.1 held route: a hop the packet finished stays lit (accent, edgeW + heldExtraW) until the instance's next state /
   *  mark event; a broken hop holds a danger half-line + a red X (two strokes, ±xHalf px) at its midpoint. */
  heldExtraW: 2,
  heldOpacity: 0.9,
  heldFadeF: 6,
  xHalf: 13,
  xStroke: 5,
  /** W5.1 hidden → visible: a revealed node enters on the state frame; its edges draw on revealDelayF later. */
  revealDelayF: 6,
  hideF: 6,
} as const;

/** Footprint (canvas) of a graph at instance width w: width clamped to minW..maxW, height by aspect. */
export function nodeGraphSize(p: Pick<NodeGraphPropsT, "aspect"> & { canvasH?: number }, w: number | undefined): { w: number; h: number } {
  const W = Math.min(NODE_GRAPH.maxW, Math.max(NODE_GRAPH.minW, w ?? NODE_GRAPH.defaultW));
  return { w: W, h: Math.max(NODE_GRAPH.h[p.aspect], p.canvasH ?? 0) };
}

// ── W5.1 node scale: fewer nodes → bigger nodes and labels inside the same canvas ─────────────────────────────

/** Scaled node / label metrics (k = 1: the NODE_GRAPH spec sizes, bit for bit). Fonts are whole px. */
export interface GraphMetrics {
  k: number;
  node: number;
  dot: number;
  dotInner: number;
  dotInnerPx: number;
  innerPx: number;
  radius: number;
  border: number;
  labelPx: number;
  charW: number;
  labelLineH: number;
  labelGap: number;
  labelPadX: number;
  packetR: number;
  portMax: number;
  portGap: number;
  edgeW: number;
  /** Horizontal inset of node centres: max(NODE_GRAPH.padX, the widest node block's half width). */
  padX: number;
  /** Node-coordinate stretch: the nodes' x / y range [x0, x1] / [y0, y1] is drawn as 0..1 (identity at k = 1 spec). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Keep-width mode: the spec centre-x range [sc0, sc1] is drawn as [cx0, cx1] (component px); NaN = padX insets. */
  cx0: number;
  cx1: number;
  sc0: number;
  sc1: number;
}

/** Node-scale caps by node count (≤ 3 nodes → 1.6 …): a sparse graph draws big, a dense one stays at the spec size. */
export const NODE_SCALE_CAP: readonly (readonly [number, number])[] = [
  [3, 1.6],
  [5, 1.4],
  [6, 1.25],
  [8, 1.1],
];
/** Gap kept between two node blocks (square + label plate) and the shortest drawn edge, when choosing k. */
export const NODE_SCALE_GAP = 16;
export const NODE_SCALE_MIN_EDGE = 24;

function blockHalf(m: Pick<GraphMetrics, "node" | "dot" | "charW" | "labelPadX">, n: { shape?: "square" | "dot"; label: string }): number {
  const size = n.shape === "dot" ? m.dot : m.node;
  return Math.max(size / 2, (n.label.length * m.charW) / 2 + m.labelPadX);
}

/** The nodes' coordinate range per axis (a single value → [0, 1], i.e. no stretch on that axis). */
export function nodeSpan(nodes: readonly { x: number; y: number }[]): { x0: number; x1: number; y0: number; y1: number } {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const ax = xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  const ay = ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1];
  return { x0: ax[1] - ax[0] > 1e-6 ? ax[0] : 0, x1: ax[1] - ax[0] > 1e-6 ? ax[1] : 1, y0: ay[1] - ay[0] > 1e-6 ? ay[0] : 0, y1: ay[1] - ay[0] > 1e-6 ? ay[1] : 1 };
}

export function scaledMetrics(k: number, nodes: readonly { shape?: "square" | "dot"; label: string; x?: number; y?: number }[] = [], stretch: "none" | "y" | "xy" = "none", keepX?: { x0: number; x1: number; c0: number; c1: number }, spread = 1): GraphMetrics {
  const G = NODE_GRAPH;
  const R = (v: number) => Math.round(v * k);
  const labelPx = R(G.labelPx);
  const base = {
    k, node: R(G.node), dot: R(G.dot), dotInner: R(G.dotInner), dotInnerPx: R(G.dotInnerPx), innerPx: R(G.innerPx), radius: R(G.radius),
    border: k >= 1.3 ? 3 : G.border, labelPx, charW: k === 1 ? G.charW : labelPx * 0.6, labelLineH: R(G.labelLineH), labelGap: R(G.labelGap),
    labelPadX: R(G.labelPadX), packetR: R(G.packetR), portMax: G.portMax * k, portGap: G.portGap * k, edgeW: k >= 1.3 ? 4 : G.edgeW,
  };
  const full = nodeSpan(nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 })));
  // spread t: the drawn range [x0, x1] moves from the full 0..1 (t = 0, no stretch) to the nodes' own range (t = 1)
  const t = Math.max(0, Math.min(1, spread));
  const sp = { x0: full.x0 * t, x1: 1 - (1 - full.x1) * t, y0: full.y0 * t, y1: 1 - (1 - full.y1) * t };
  const span = { x0: stretch === "xy" ? sp.x0 : 0, x1: stretch === "xy" ? sp.x1 : 1, y0: stretch !== "none" ? sp.y0 : 0, y1: stretch !== "none" ? sp.y1 : 1 };
  const halfMax = Math.max(0, ...nodes.map((n) => blockHalf(base, n)));
  // keep the spec content width: the blocks at both ends stay inside [keepX.x0, keepX.x1] (centres move inward)
  const cx = keepX && stretch !== "xy" ? { cx0: keepX.x0 + halfMax, cx1: keepX.x1 - halfMax, sc0: keepX.c0, sc1: keepX.c1 } : { cx0: NaN, cx1: NaN, sc0: NaN, sc1: NaN };
  return { ...base, padX: Math.max(G.padX, halfMax), ...span, ...cx };
}

/** The spec metrics (k = 1): what every caller that passes no metrics gets (lints, director tools, catalogue). */
export const GRAPH_M1: GraphMetrics = scaledMetrics(1);

/** Node centre in component px for size (w, h); `m` = the metrics the graph is drawn with (default: k = 1). */
export function nodeCentre(n: { x: number; y: number }, w: number, h: number, m: GraphMetrics = GRAPH_M1): { x: number; y: number } {
  const G = NODE_GRAPH;
  const top = G.padTop + m.node / 2;
  const bottom = h - G.padBottom - m.labelLineH - m.labelGap - m.node / 2;
  const nx = (n.x - m.x0) / (m.x1 - m.x0);
  const ny = (n.y - m.y0) / (m.y1 - m.y0);
  if (Number.isFinite(m.cx0)) {
    // keep-width: the spec centre x (padX + x·(w − 2 padX)) range [sc0, sc1] maps onto [cx0, cx1]
    const sx = G.padX + n.x * (w - 2 * G.padX);
    const x = m.sc1 - m.sc0 < 1e-6 ? (m.cx0 + m.cx1) / 2 : m.cx0 + ((sx - m.sc0) / (m.sc1 - m.sc0)) * (m.cx1 - m.cx0);
    return { x, y: top + ny * (bottom - top) };
  }
  return { x: m.padX + nx * (w - 2 * m.padX), y: top + ny * (bottom - top) };
}

const metricsCache = new WeakMap<object, Map<string, GraphMetrics>>();

/**
 * The metrics a graph is DRAWN with (W5.1). No props.layout = the spec layout (k 1, the director's coordinates). With
 * props.layout (set by the stage-fill pass): the nodes' x / y range optionally stretched to the whole canvas
 * (nodeSpan), and the largest node scale k ≤ min(layout.k, NODE_SCALE_CAP by node count), in 0.02 steps, for
 * which every node block (square + label plate) stays inside the canvas with ≥ NODE_SCALE_GAP px between blocks and
 * every edge keeps ≥ NODE_SCALE_MIN_EDGE px of drawn length; k = 1 when nothing larger fits (the spec layout, unchanged).
 * Memoised per props object and size. Renderer, flight model, contentBox and activeRegion use it.
 */
export function graphMetrics(props: Pick<NodeGraphPropsT, "nodes" | "edges"> & { layout?: { k: number; stretch: "none" | "y" | "xy"; spread?: number } }, w: number, h: number): GraphMetrics {
  if (!props.layout) return props.nodes.length ? scaledMetrics(1, props.nodes) : GRAPH_M1;
  let byKey = metricsCache.get(props);
  const key = `${w}x${h}`;
  const hit = byKey?.get(key);
  if (hit) return hit;
  const out = layoutMetrics(props, w, h, props.layout.k, props.layout.stretch, props.layout.spread ?? 1);
  if (!byKey) metricsCache.set(props, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

/** Node-count cap of k (NODE_SCALE_CAP). */
export function nodeScaleCap(nodes: number): number {
  return (NODE_SCALE_CAP.find(([max]) => nodes <= max) ?? NODE_SCALE_CAP[NODE_SCALE_CAP.length - 1])[1];
}

/** The largest k ≤ min(kMax, node-count cap), in 0.02 steps, whose layout fits (graphFits); k = 1 otherwise. */
export function layoutMetrics(props: Pick<NodeGraphPropsT, "nodes" | "edges">, w: number, h: number, kMax: number, stretch: "none" | "y" | "xy", spread = 1): GraphMetrics {
  const cap = Math.min(kMax, nodeScaleCap(props.nodes.length));
  // the spec content's x-range (what the graph keeps unless it stretches x)
  const spec = scaledMetrics(1, props.nodes);
  const keep = specContentX(props, w, h, spec);
  let out = scaledMetrics(1, props.nodes, stretch, keep, spread);
  if (stretch !== "none" && !graphFits(props, w, h, out)) out = spec;
  for (let k = Math.round(cap * 100) / 100; k > 1 + 1e-9; k = Math.round((k - 0.02) * 100) / 100) {
    const m = scaledMetrics(k, props.nodes, stretch, keep, spread);
    if (graphFits(props, w, h, m)) {
      out = m;
      break;
    }
  }
  return out;
}

/** x-range of the drawn blocks under metrics m. */
function specContentX(props: Pick<NodeGraphPropsT, "nodes">, w: number, h: number, m: GraphMetrics): { x0: number; x1: number; c0: number; c1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let c0 = Infinity;
  let c1 = -Infinity;
  for (const n of props.nodes) {
    const c = nodeCentre(n, w, h, m);
    const half = blockHalf(m, n);
    x0 = Math.min(x0, c.x - half);
    x1 = Math.max(x1, c.x + half);
    c0 = Math.min(c0, c.x);
    c1 = Math.max(c1, c.x);
  }
  return { x0, x1, c0, c1 };
}

/** Does a graph laid out with metrics m keep its blocks apart and inside the canvas, with every edge long enough? */
export function graphFits(props: Pick<NodeGraphPropsT, "nodes" | "edges">, w: number, h: number, m: GraphMetrics): boolean {
  const G = NODE_GRAPH;
  if ((Number.isFinite(m.cx0) ? m.cx1 < m.cx0 : w - 2 * m.padX < 0) || h - G.padBottom - m.labelLineH - m.labelGap - m.node / 2 < G.padTop + m.node / 2) return false;
  const blocks = props.nodes.map((nd) => {
    const c = nodeCentre(nd, w, h, m);
    const half = blockHalf(m, nd);
    const size = nd.shape === "dot" ? m.dot : m.node;
    return { x0: c.x - half, x1: c.x + half, y0: c.y - size / 2, y1: c.y + size / 2 + m.labelGap + m.labelLineH };
  });
  for (const b of blocks) if (b.x0 < -0.5 || b.x1 > w + 0.5 || b.y0 < -0.5 || b.y1 > h + 0.5) return false;
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.x0 < b.x1 + NODE_SCALE_GAP && b.x0 < a.x1 + NODE_SCALE_GAP && a.y0 < b.y1 + NODE_SCALE_GAP && b.y0 < a.y1 + NODE_SCALE_GAP) return false;
    }
  return edgeSegments(props, w, h, m).every((sg) => sg.len >= NODE_SCALE_MIN_EDGE);
}

/**
 * Per-hop ease (R7 N-3 "bezier in/out per hop"): bezier(.6, 0, .4, 1). W2.1 r2: NOT the bible (.65, 0, .35, 1) any
 * more — the bible's 2.86× peak forced a 504 px hop to 12–13 f at the speed cap, and under the binding 1 px / cap 32
 * blur rule (ADR-001 §7 W2) every frame of a hop below 64 px/f is an uncapped (expensive) blur frame. This ease peaks
 * at HOP_EASE_PEAK ≈ 2.5× the mean, so the same hop fits in R7's 10 f; it is visually a hair softer than the bible.
 */
export const HOP_EASE = [0.6, 0, 0.4, 1] as const;

/** Cubic bezier ease (x1, 0, x2, 1)-style timing function, pure (meta files may only import zod). */
export function bezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (u: number) => 3 * x1 * u * (1 - u) * (1 - u) + 3 * x2 * u * u * (1 - u) + u * u * u;
  const by = (u: number) => 3 * y1 * u * (1 - u) * (1 - u) + 3 * y2 * u * u * (1 - u) + u * u * u;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < t) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

/** The packet's per-hop ease (renderer and flight model use this same function). */
export const hopEase = bezierEase(...HOP_EASE);

/** Peak slope of HOP_EASE (instantaneous speed / mean speed), measured on a 4000-step grid and rounded up. */
export const HOP_EASE_PEAK = (() => {
  let m = 0;
  for (let k = 0; k < 4000; k++) m = Math.max(m, (hopEase((k + 1) / 4000) - hopEase(k / 4000)) * 4000);
  return Math.ceil(m * 1000) / 1000;
})();
/** Declared packet speed cap (= meta.flight.peakPxPerF), world px per frame — the library's flight peak (RequestPill
 *  flies at ≤ 130 px/f too). Instantaneous, not per-frame: the dot never moves faster than this inside a frame. */
export const PACKET_PEAK_PX_PER_F = 130;

/**
 * Frames for one hop of `len` px: the SHORTEST duration in R7 N-3's 10–14 f window whose instantaneous peak
 * (len × HOP_EASE_PEAK / hop) stays ≤ PACKET_PEAK_PX_PER_F, stretched past 14 f only for edges over ~730 px. Shortest,
 * because under the binding 1 px blur rule a hop's blur cost falls with its duration (more of its frames sit at the
 * 32-sample cap; W2.1 r2 L18 major). Edges up to ~520 px hop in 10 f.
 */
export function hopFrames(len: number): number {
  return Math.max(NODE_GRAPH.hopF[0], Math.ceil((len * HOP_EASE_PEAK) / PACKET_PEAK_PX_PER_F - 1e-9));
}

/** Longest possible edge: corner to corner of the tallest plot at the widest width (centre to centre, untrimmed). */
export const MAX_EDGE_PX = (() => {
  const G = NODE_GRAPH;
  const a = nodeCentre({ x: 0, y: 0 }, G.maxW, G.h.tall);
  const b = nodeCentre({ x: 1, y: 1 }, G.maxW, G.h.tall);
  return Math.hypot(b.x - a.x, b.y - a.y);
})();
/** Longest hop and the longest packet flight (4 hops): the mark verb's / flight's declared duration. */
export const MAX_HOP_F = hopFrames(MAX_EDGE_PX);
export const MAX_PACKET_F = 4 * MAX_HOP_F;

// ── edge geometry (shared by the renderer and flightFor, so the packet the timeline models = the packet drawn) ──

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
}

/** Obstacle around a node centre: the node outline (+ edgeGap) and its label plate (+ labelClear), centre-relative. */
export interface NodeOutline {
  /** square half-size or dot radius, already grown by edgeGap */
  half: number;
  sq: boolean;
  /** label plate rect grown by labelClear (centre-relative) */
  label: { x0: number; x1: number; y0: number; y1: number };
}

export function nodeOutline(n: { shape: "square" | "dot"; label: string }, m: GraphMetrics = GRAPH_M1): NodeOutline {
  const G = NODE_GRAPH;
  const size = n.shape === "square" ? m.node : m.dot;
  const hw = (n.label.length * m.charW) / 2 + m.labelPadX + G.labelClear;
  const top = size / 2 + m.labelGap;
  return { half: size / 2 + G.edgeGap, sq: n.shape === "square", label: { x0: -hw, x1: hw, y0: top - G.labelClear, y1: top + m.labelLineH + G.labelClear } };
}

/** Ray (from the centre, unit direction ux,uy) exit distance from a centre-relative rect; null when it misses. */
function rectSpan(ux: number, uy: number, r: { x0: number; x1: number; y0: number; y1: number }): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [u, lo, hi] of [[ux, r.x0, r.x1], [uy, r.y0, r.y1]] as const) {
    if (Math.abs(u) < 1e-9) {
      if (lo > 0 || hi < 0) return null;
      continue;
    }
    const a = lo / u;
    const b = hi / u;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 > Math.max(0, t0) ? [t0, t1] : null;
}

/** Distance along the ray at which it has left both the node outline and (if it crosses it at all) its label plate. */
export function exitDistance(o: NodeOutline, ux: number, uy: number): number {
  const t = o.sq ? o.half / Math.max(Math.abs(ux), Math.abs(uy)) : o.half;
  const s = rectSpan(ux, uy, o.label);
  return s ? Math.max(t, s[1]) : t;
}

/** Straight segment between two node centres, clipped to each node's outline + label plate. */
function clipped(a: { x: number; y: number }, b: { x: number; y: number }, oa: NodeOutline, ob: NodeOutline): Seg {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const ca = exitDistance(oa, ux, uy);
  const cb = exitDistance(ob, -ux, -uy);
  const len = Math.max(0, L - ca - cb);
  const ax = a.x + ux * ca;
  const ay = a.y + uy * ca;
  return { ax, ay, bx: ax + ux * len, by: ay + uy * len, len };
}

type Side = "L" | "R" | "T" | "B" | "dot";

/** Which side of a square an edge towards (dx, dy) leaves from: left/right unless the edge is steep, then the top, or
 *  the bottom BELOW its label plate. */
function sideOf(o: NodeOutline, dx: number, dy: number): Side {
  if (!o.sq) return "dot";
  if (Math.abs(dx) >= 0.5 * Math.abs(dy)) return dx < 0 ? "L" : "R";
  return dy < 0 ? "T" : "B";
}

/** Port on a side, `off` px along it (y for L/R, x for T/B); a dot's outline on the line to (dx, dy). Centre-relative. */
function attach(o: NodeOutline, side: Side, dx: number, dy: number, off = 0): { x: number; y: number } {
  if (side === "dot") {
    const L = Math.hypot(dx, dy) || 1;
    return { x: (dx / L) * o.half, y: (dy / L) * o.half };
  }
  if (side === "L" || side === "R") return { x: (side === "L" ? -1 : 1) * o.half, y: off };
  return side === "T" ? { x: off, y: -o.half } : { x: off, y: o.label.y1 };
}

/** Does segment s cross the node outline or its label plate (both grown, centre-relative)? Exact (slab clipping, W2.1
 *  r2: the old 24-point sampling could miss a plate corner by ~1 px), with a 0.5 px tolerance on each rect. */
function segHitsNode(o: NodeOutline, c: { x: number; y: number }, s: Seg): boolean {
  const rects = [o.label, ...(o.sq ? [{ x0: -o.half, x1: o.half, y0: -o.half, y1: o.half }] : [])];
  const ax = s.ax - c.x;
  const ay = s.ay - c.y;
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  for (const r of rects) {
    let t0 = 0;
    let t1 = 1;
    let miss = false;
    for (const [p0, d, lo, hi] of [[ax, dx, r.x0 + 0.5, r.x1 - 0.5], [ay, dy, r.y0 + 0.5, r.y1 - 0.5]] as const) {
      if (Math.abs(d) < 1e-9) {
        if (p0 <= lo || p0 >= hi) miss = true;
        continue;
      }
      const ta = (lo - p0) / d;
      const tb = (hi - p0) / d;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (!miss && t1 - t0 > 1e-6) return true;
  }
  return false;
}

interface End {
  a: { x: number; y: number };
  b: { x: number; y: number };
  oa: NodeOutline;
  ob: NodeOutline;
}

/** Port-to-port segment, or null when it is unusable (runs backwards or through either node / label plate). */
function portSeg(e: End, pa: { x: number; y: number }, pb: { x: number; y: number }): Seg | null {
  const s: Seg = { ax: e.a.x + pa.x, ay: e.a.y + pa.y, bx: e.b.x + pb.x, by: e.b.y + pb.y, len: 0 };
  s.len = Math.hypot(s.bx - s.ax, s.by - s.ay);
  const backwards = (s.bx - s.ax) * (e.b.x - e.a.x) + (s.by - s.ay) * (e.b.y - e.a.y) <= 0;
  return backwards || segHitsNode(e.oa, e.a, s) || segHitsNode(e.ob, e.b, s) ? null : s;
}

/**
 * Edge segment between two nodes: side port to side port (so it never starts at a corner next to the label); when
 * that line would cross either node or its label plate, the centre line clipped at node + label instead. `offA` /
 * `offB` move the ports along their sides (fan-out).
 */
export function trimmedSeg(a: { x: number; y: number }, b: { x: number; y: number }, oa: NodeOutline, ob: NodeOutline, offA = 0, offB = 0): Seg {
  const e: End = { a, b, oa, ob };
  const pa = attach(oa, sideOf(oa, b.x - a.x, b.y - a.y), b.x - a.x, b.y - a.y, offA);
  const pb = attach(ob, sideOf(ob, a.x - b.x, a.y - b.y), a.x - b.x, a.y - b.y, offB);
  return portSeg(e, pa, pb) ?? clipped(a, b, oa, ob);
}

/**
 * Every edge's segment (index = props.edges index) for a plot of w × h. Edges that leave a square node through the
 * SAME side get separate ports (review W2 r3: api→db and api→redis forked from one point into a "Z/<" junction):
 * each port is offset along the side by the edge's slope (portMax · clamp(slope, ±1)), then pushed ≥ portGap apart
 * (or spread evenly when the side is crowded) within ±portMax; a port whose segment would cut its own node or label
 * plate is pulled back towards the midpoint until it clears (the other ports on that side move away instead). A
 * near-straight edge whose far end is alone on its side gets the same offset there too, so it stays straight.
 */
export function edgeSegments(props: Pick<NodeGraphPropsT, "nodes" | "edges">, w: number, h: number, m: GraphMetrics = GRAPH_M1): Seg[] {
  const G = { portGap: m.portGap, portMax: m.portMax };
  const centre = new Map(props.nodes.map((n) => [n.id, nodeCentre(n, w, h, m)]));
  const outline = new Map(props.nodes.map((n) => [n.id, nodeOutline(n, m)]));
  // ends: [edge index, 0 = from / 1 = to]
  const off = props.edges.map(() => [0, 0]);
  const groups = new Map<string, { i: number; end: 0 | 1; slope: number }[]>();
  props.edges.forEach((e, i) => {
    for (const end of [0, 1] as const) {
      const me = end === 0 ? e.from : e.to;
      const other = end === 0 ? e.to : e.from;
      const c = centre.get(me)!;
      const t = centre.get(other)!;
      const o = outline.get(me)!;
      const dx = t.x - c.x;
      const dy = t.y - c.y;
      const side = sideOf(o, dx, dy);
      if (side === "dot") continue;
      const slope = side === "L" || side === "R" ? dy / (Math.abs(dx) || 1e-9) : dx / (Math.abs(dy) || 1e-9);
      const k = `${me}:${side}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ i, end, slope });
    }
  });
  const segOf = (i: number, oa: number, ob: number): Seg | null => {
    const e = props.edges[i];
    const ends: End = { a: centre.get(e.from)!, b: centre.get(e.to)!, oa: outline.get(e.from)!, ob: outline.get(e.to)! };
    const pa = attach(ends.oa, sideOf(ends.oa, ends.b.x - ends.a.x, ends.b.y - ends.a.y), ends.b.x - ends.a.x, ends.b.y - ends.a.y, oa);
    const pb = attach(ends.ob, sideOf(ends.ob, ends.a.x - ends.b.x, ends.a.y - ends.b.y), ends.a.x - ends.b.x, ends.a.y - ends.b.y, ob);
    return portSeg(ends, pa, pb);
  };
  const single = (id: string, i: number, end: 0 | 1) => {
    for (const [k, g] of groups) if (k.startsWith(`${id}:`) && g.some((x) => x.i === i && x.end === end)) return g.length === 1;
    return false;
  };
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((p, q) => p.slope - q.slope || p.i - q.i);
    const n = g.length;
    const gap = Math.min(G.portGap, (2 * G.portMax) / (n - 1));
    const o = g.map((x) => G.portMax * Math.max(-1, Math.min(1, x.slope)));
    const spread = () => {
      for (let j = 1; j < n; j++) o[j] = Math.max(o[j], o[j - 1] + gap);
      if (o[n - 1] > G.portMax) {
        const d = o[n - 1] - G.portMax;
        for (let j = 0; j < n; j++) o[j] -= d;
      }
      if (o[0] < -G.portMax - 1e-9) for (let j = 0; j < n; j++) o[j] = -G.portMax + gap * j;
    };
    spread();
    // pull ports whose segment cuts a node / label back towards the midpoint; neighbours give way on the other side
    for (let j = 0; j < n; j++) {
      const at = (v: number) => {
        const x = g[j];
        const [oa, ob] = off[x.i];
        return x.end === 0 ? segOf(x.i, v, ob) : segOf(x.i, oa, v);
      };
      let v = o[j];
      while (Math.abs(v) > 0 && !at(v)) v = Math.sign(v) * Math.max(0, Math.abs(v) - 2);
      if (v !== o[j]) {
        o[j] = v;
        // keep ≥ gap from the neighbours by moving THEM (away from v), within ±portMax
        for (let q = j + 1; q < n; q++) o[q] = Math.min(G.portMax, Math.max(o[q], o[q - 1] + gap));
        for (let q = j - 1; q >= 0; q--) o[q] = Math.max(-G.portMax, Math.min(o[q], o[q + 1] - gap));
      }
    }
    g.forEach((x, j) => (off[x.i][x.end] = o[j]));
  }
  // near-straight edges keep straight: mirror a port offset on a far end that is alone on its side
  props.edges.forEach((e, i) => {
    const [oa, ob] = off[i];
    const a = centre.get(e.from)!;
    const b = centre.get(e.to)!;
    const horiz = Math.abs(b.y - a.y) < 1 && Math.abs(b.x - a.x) > 0;
    const vert = Math.abs(b.x - a.x) < 1 && Math.abs(b.y - a.y) > 0;
    if (!horiz && !vert) return;
    if (oa !== 0 && ob === 0 && single(e.to, i, 1) && segOf(i, oa, oa)) off[i][1] = oa;
    else if (ob !== 0 && oa === 0 && single(e.from, i, 0) && segOf(i, ob, ob)) off[i][0] = ob;
  });
  return props.edges.map((e, i) => {
    const s = segOf(i, off[i][0], off[i][1]);
    return s ?? trimmedSeg(centre.get(e.from)!, centre.get(e.to)!, outline.get(e.from)!, outline.get(e.to)!);
  });
}

// ── packet flight (props-aware; review W2 r3 major: a 1-hop mark was modelled as a 108 f flight at 120 px/f) ──────

/** Effective state of edge a–b (either direction) under the props' edgeStates override map; non-edges are idle. */
export function edgeStateOf(props: Pick<NodeGraphPropsT, "edges" | "edgeStates">, a: string, b: string): (typeof EDGE_STATES)[number] {
  const e = props.edges.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
  if (!e) return "idle";
  const o = props.edgeStates ?? {};
  return o[`${e.from}>${e.to}`] ?? o[`${e.to}>${e.from}`] ?? e.state;
}

export interface PacketHop {
  from: string;
  to: string;
  /** segment the dot travels (from → to) */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  len: number;
  /** hopFrames(len) */
  hopF: number;
  /** broken edge: the dot stops at the midpoint after round(hopF / 2) frames (and the route ends there) */
  broken: boolean;
}

/** The hops a packet takes along `route` (node ids), on the plot's edge segments; stops at the first broken edge. */
export function packetHops(props: Pick<NodeGraphPropsT, "nodes" | "edges" | "edgeStates"> & Partial<Pick<NodeGraphPropsT, "nodeStates">>, w: number, h: number, route: readonly string[], segs: readonly Seg[] = edgeSegments(props, w, h), brokenAt?: (from: string, to: string, hopIndex: number) => boolean, m: GraphMetrics = GRAPH_M1, hiddenAt?: (from: string, to: string, hopIndex: number) => boolean): PacketHop[] {
  const out: PacketHop[] = [];
  const byId = new Map(props.nodes.map((n) => [n.id, n]));
  // W5.1 FR1: a route ends before the first hop whose node or edge is hidden at launch (no dot / held line over empty
  // canvas); default = the hidden states in the props in force (base + nodeStates / edgeStates overrides)
  const hidden = hiddenAt ?? ((a: string, b: string) => nodeStateOf(props, a) === "hidden" || nodeStateOf(props, b) === "hidden" || (props.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)) && edgeStateOf(props, a, b) === "hidden"));
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    if (!byId.has(a) || !byId.has(b)) break;
    if (hidden(a, b, i)) break;
    const ei = props.edges.findIndex((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    const s = ei >= 0 ? segs[ei] : trimmedSeg(nodeCentre(byId.get(a)!, w, h, m), nodeCentre(byId.get(b)!, w, h, m), nodeOutline(byId.get(a)!, m), nodeOutline(byId.get(b)!, m));
    const rev = ei >= 0 && props.edges[ei].from !== a;
    const [sx, sy, tx, ty] = rev ? [s.bx, s.by, s.ax, s.ay] : [s.ax, s.ay, s.bx, s.by];
    const broken = brokenAt ? brokenAt(a, b, i) : edgeStateOf(props, a, b) === "broken";
    out.push({ from: a, to: b, sx, sy, tx, ty, len: s.len, hopF: hopFrames(s.len), broken });
    if (broken) break;
  }
  return out;
}

/**
 * Own speed of the packet dot, world px/f (unscaled), for frame k → k+1 after the mark: each hop eases (hopEase) over
 * hopFrames(len) — a broken hop over round(hopF / 2) to the midpoint, after which the dot only fades. [] = no flight
 * (no packet in force, or a route that does not resolve). The route and every hop's broken flag come from the props in
 * force at the mark frame; the renderer fixes them at launch from the same props (W2.1 r2), so a state change during
 * the flight changes neither the drawn packet nor the model.
 */
export function packetFlight(props: NodeGraphPropsT, w: number | undefined): number[] {
  if (!props.packet) return [];
  const { w: W, h: H } = nodeGraphSize(props, w);
  // the drawn geometry (W5.1 node scale): the modelled flight is the rendered one
  const m = graphMetrics(props, W, H);
  const hops = packetHops(props, W, H, props.packet.split(">"), edgeSegments(props, W, H, m), undefined, m);
  const v: number[] = [];
  for (const hp of hops) {
    const dur = hp.broken ? Math.round(hp.hopF / 2) : hp.hopF;
    const dist = hp.broken ? hp.len / 2 : hp.len;
    for (let k = 0; k < dur; k++) v.push(dist * (hopEase((k + 1) / dur) - hopEase(k / dur)));
  }
  return v;
}

// ── W5.1 evolution helpers (pure; shared by the renderer, the timeline's camera helper and the tests) ─────────────

/** Effective node state under the props' nodeStates override map. */
export function nodeStateOf(props: Pick<NodeGraphPropsT, "nodes"> & Partial<Pick<NodeGraphPropsT, "nodeStates">>, id: string): (typeof NODE_STATES)[number] {
  const n = props.nodes.find((x) => x.id === id);
  return props.nodeStates?.[id] ?? n?.state ?? "ok";
}

/**
 * The "active region" of a graph (component px, unscaled): the box around every node that is lit (accent / danger /
 * degraded) or touches a lit edge (active / broken), node squares and label plates included. null = nothing is lit.
 * Camera helper input (timeline.ts graphFocus): push in on what the beat is about, not on the whole canvas.
 */
export function activeRegion(props: NodeGraphPropsT, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const G = graphMetrics(props, w, h);
  const lit = new Set<string>();
  for (const n of props.nodes) {
    const st = nodeStateOf(props, n.id);
    if (st === "accent" || st === "danger" || st === "degraded") lit.add(n.id);
  }
  for (const e of props.edges) {
    const st = edgeStateOf(props, e.from, e.to);
    if ((st === "active" || st === "broken") && nodeStateOf(props, e.from) !== "hidden" && nodeStateOf(props, e.to) !== "hidden") {
      lit.add(e.from);
      lit.add(e.to);
    }
  }
  if (!lit.size) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of props.nodes) {
    if (!lit.has(n.id)) continue;
    const c = nodeCentre(n, w, h, G);
    const size = n.shape === "square" ? G.node : G.dot;
    const half = Math.max(size / 2, (n.label.length * G.charW) / 2 + G.labelPadX);
    x0 = Math.min(x0, c.x - half);
    x1 = Math.max(x1, c.x + half);
    y0 = Math.min(y0, c.y - size / 2);
    y1 = Math.max(y1, c.y + size / 2 + G.labelGap + G.labelLineH);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Frame until which the route of a packet launched at `markF` stays drawn (held, W5.1): the instance's next state or
 * mark event after the mark, else its exit, else never (Infinity). `events` in frame order.
 */
export function heldUntil(events: readonly { f: number; do: string }[], markF: number, exitF: number | null): number {
  for (const e of events) if (e.f > markF && (e.do === "state" || e.do === "mark")) return e.f;
  return exitF ?? Infinity;
}

/** What the graph draws (component px): the box around EVERY node square / dot and its label plate (hidden ones too:
 *  the box is static for the instance's life). The stage-fill pass sizes the graph by this, not by its canvas. */
export function graphContentBox(props: Pick<NodeGraphPropsT, "nodes" | "edges">, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const G = graphMetrics(props, w, h);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of edgeLabelBoxes(props, w, h)) {
    x0 = Math.min(x0, b.x);
    x1 = Math.max(x1, b.x + b.w);
    y0 = Math.min(y0, b.y);
    y1 = Math.max(y1, b.y + b.h);
  }
  for (const n of props.nodes) {
    const c = nodeCentre(n, w, h, G);
    const size = n.shape === "square" ? G.node : G.dot;
    const half = Math.max(size / 2, (n.label.length * G.charW) / 2 + G.labelPadX);
    x0 = Math.min(x0, c.x - half);
    x1 = Math.max(x1, c.x + half);
    y0 = Math.min(y0, c.y - size / 2);
    y1 = Math.max(y1, c.y + size / 2 + G.labelGap + G.labelLineH);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * W5.1 active-region camera helper: the camera key that frames what is LIT on this graph instance (activeRegion), for
 * a storyboard `{ target: { x, y }, zoom }` key. inst = the instance's world origin + scale; w = Instance.w. The zoom
 * fills ≤ fillW × fillH screen px with the region (≥ minZoom, ≤ 2.2 = the camera's range); null = nothing lit.
 */
export function graphFocus(inst: { x: number; y: number; scale?: number; w?: number }, props: NodeGraphPropsT, opts: { fillW?: number; fillH?: number; minZoom?: number } = {}): { x: number; y: number; zoom: number } | null {
  const { w, h } = nodeGraphSize(props, inst.w);
  const r = activeRegion(props, w, h);
  if (!r) return null;
  const s = inst.scale ?? 1;
  const fillW = opts.fillW ?? 760;
  const fillH = opts.fillH ?? 700;
  const zoom = Math.min(2.2, Math.max(opts.minZoom ?? 1, Math.min(fillW / (r.w * s), fillH / (r.h * s))));
  return { x: inst.x + (r.x + r.w / 2) * s, y: inst.y + (r.y + r.h / 2) * s, zoom: Math.round(zoom * 100) / 100 };
}

// ── W5.1 FR1: edge labels, failing paths, honest inner tags, drawn shape ─────────────────────────────────────────

/** Edge label plate: mono 22 px on a bgRaised plate centred on the segment midpoint (scaled with the node scale k). */
export const EDGE_LABEL = { px: 22, lh: 30, padX: 8 } as const;

/** Drawn edge-label plates (component px), index-aligned with the labelled edges; empty when no edge has a label. A
 *  plate sits on the segment midpoint, or — when it would cover a node square or label plate (short edges) — slides
 *  sideways along the edge normal (±0.8, ±1.6, ±2.4 plate heights) to the first clear spot. */
export function edgeLabelBoxes(props: Pick<NodeGraphPropsT, "nodes" | "edges">, w: number, h: number, m: GraphMetrics = graphMetrics(props, w, h)): { i: number; x: number; y: number; w: number; h: number; text: string }[] {
  if (!props.edges.some((e) => (e as { label?: string }).label)) return [];
  const segs = edgeSegments(props, w, h, m);
  const k = m.k;
  const PAD = 4;
  const obstacles = props.nodes.flatMap((n) => {
    const c = nodeCentre(n, w, h, m);
    const size = n.shape === "dot" ? m.dot : m.node;
    const pw = n.label.length * m.charW + 2 * m.labelPadX;
    return [
      { x: c.x - size / 2 - PAD, y: c.y - size / 2 - PAD, w: size + 2 * PAD, h: size + 2 * PAD },
      { x: c.x - pw / 2 - PAD, y: c.y + size / 2 + m.labelGap - PAD, w: pw + 2 * PAD, h: m.labelLineH + 2 * PAD },
    ];
  });
  const hits = (b: { x: number; y: number; w: number; h: number }) => obstacles.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  const out: { i: number; x: number; y: number; w: number; h: number; text: string }[] = [];
  props.edges.forEach((e, i) => {
    const t = (e as { label?: string }).label;
    if (!t) return;
    const s = segs[i];
    const bw = Math.ceil(t.length * Math.round(EDGE_LABEL.px * k) * 0.6 + 2 * EDGE_LABEL.padX * k);
    const bh = Math.round(EDGE_LABEL.lh * k);
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
    const nx = -(s.by - s.ay) / len;
    const ny = (s.bx - s.ax) / len;
    const at = (o: number) => ({ x: (s.ax + s.bx) / 2 + nx * o * bh - bw / 2, y: (s.ay + s.by) / 2 + ny * o * bh - bh / 2, w: bw, h: bh });
    const pick = [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4].map(at).find((b) => !hits(b) && b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h) ?? at(0);
    out.push({ i, ...pick, text: t });
  });
  return out;
}

/**
 * Edges drawn "active" that lead into a failure (W5.1 FR1, evergreen-tls b05–b13: the chain OpenSSL 1.0.2 picked ended
 * in the red DST node, drawn lime = "this path is good"). An active edge FAILS when it touches a `danger` node, or when
 * one of its ends is a pass-through node (not danger) whose every other lit edge fails — a `broken` edge always counts
 * as failed there — so the whole chosen path into the failure turns red, while a path that also continues to a healthy
 * node stays lime. Returns the failing ACTIVE edges, keys "from>to" (canonical).
 */
export function failingEdges(edges: readonly { from: string; to: string }[], nodeState: (id: string) => string, edgeState: (key: string) => string): Set<string> {
  const key = (e: { from: string; to: string }) => `${e.from}>${e.to}`;
  const shown = (e: { from: string; to: string }) => nodeState(e.from) !== "hidden" && nodeState(e.to) !== "hidden";
  const lit = edges.filter((e) => shown(e) && (edgeState(key(e)) === "active" || edgeState(key(e)) === "broken"));
  const active = lit.filter((e) => edgeState(key(e)) === "active");
  const failed = new Set(lit.filter((e) => edgeState(key(e)) === "broken" || nodeState(e.from) === "danger" || nodeState(e.to) === "danger").map(key));
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of active) {
      if (failed.has(key(e))) continue;
      for (const x of [e.from, e.to]) {
        const others = lit.filter((o) => o !== e && (o.from === x || o.to === x));
        if (others.length && others.every((o) => failed.has(key(o)))) {
          failed.add(key(e));
          grew = true;
          break;
        }
      }
    }
  }
  return new Set(active.map(key).filter((k) => failed.has(k)));
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Is `inner` an abbreviation of `label`: its letters / digits appear in the label in order ("CHN" ⊂ "chain")? An
 *  inner without letters or digits (a glyph) always passes. */
export function innerIsAbbrev(inner: string, label: string): boolean {
  const a = alnum(inner);
  if (!a) return true;
  const b = alnum(label);
  let j = 0;
  for (const c of b) if (c === a[j]) j++;
  return j === a.length;
}

/** The label's leading acronym ("ISRG Root X1" → "ISRG", "DST Root X3" → "DST"): a first word of 2–4 capitals / digits
 *  followed by more words. null otherwise. */
export function labelAcronym(label: string): string | null {
  const m = /^([A-Z][A-Z0-9]{1,3})\s+\S/.exec(label.trim());
  return m ? m[1] : null;
}

/**
 * The inner tag the node DRAWS (W5.1 FR1, evergreen-tls: "SELF" in ISRG Root X1, "CA" in DST Root X3 named a second
 * concept): the director's inner when it abbreviates the label, else the label's leading acronym (the label beneath
 * carries the meaning, the big central text repeats it), else the director's inner as given.
 */
export function drawnInner(n: { label: string; inner?: string }): string | undefined {
  if (n.inner && innerIsAbbrev(n.inner, n.label)) return n.inner;
  // a label with its own acronym draws that; a role tag on a label without one ("kv" on redis) stays
  return labelAcronym(n.label) ?? n.inner;
}

/** What the graph draws, footprint-relative: one part per node block (square / dot + label plate, as L23 measures),
 *  edge-label plates, node squares + plates and edge segments (L33's callout geometry). Drawn metrics (props.layout). */
export function graphShape(props: NodeGraphPropsT, w: number | undefined): DrawnShape {
  const { w: W, h: H } = nodeGraphSize(props, w);
  const G = graphMetrics(props, W, H);
  const nodes = props.nodes.map((n) => {
    const c = nodeCentre(n, W, H, G);
    const size = n.shape === "dot" ? G.dot : G.node;
    const plateW = n.label.length * G.charW + 2 * G.labelPadX;
    return { id: n.id, label: n.label, c, size, plateW, box: { x: c.x - size / 2, y: c.y - size / 2, w: size, h: size }, plate: { x: c.x - plateW / 2, y: c.y + size / 2 + G.labelGap, w: plateW, h: G.labelLineH } };
  });
  const parts = nodes.map((n) => {
    const half = Math.max(n.size, n.plateW) / 2;
    return { part: `node:${n.id}`, x: n.c.x - half, y: n.c.y - n.size / 2, w: 2 * half, h: n.size + G.labelGap + G.labelLineH };
  });
  for (const b of edgeLabelBoxes(props, W, H, G)) parts.push({ part: `edge:${props.edges[b.i].from}>${props.edges[b.i].to}`, x: b.x, y: b.y, w: b.w, h: b.h });
  const segs = edgeSegments(props, W, H, G);
  return {
    parts,
    nodes: nodes.map((n) => ({ id: n.id, label: n.label, box: n.box, plate: n.plate })),
    edges: props.edges.map((e, i) => ({ key: `${e.from}>${e.to}`, ax: segs[i].ax, ay: segs[i].ay, bx: segs[i].bx, by: segs[i].by })),
  };
}

/** Frames from enter until the last edge has drawn (n nodes, e edges). */

export function nodeGraphEnterF(nodes: number, edges: number): number {
  const G = NODE_GRAPH;
  const nodesDone = G.staggerF * Math.max(0, nodes - 1) + 6;
  const edgeSpread = edges > 1 ? Math.min(G.edgeStaggerMaxF, G.edgeStaggerF * (edges - 1)) : 0;
  return nodesDone + (edges ? edgeSpread + G.edgeDrawF : 12);
}

export const meta = {
  name: "NodeGraph",
  version: 4,
  tier: "p0",
  spec: "R7 N-2",
  summary: "≤8 labelled nodes + edges: nodes stagger in, edges draw on; node ok/degraded/danger/accent/hidden, edge idle/active/broken/hidden (hidden → shown = enters / draws on that beat); active into danger draws red; edge label = a word mid-edge; packet dot travels a route and leaves it lit (broken hop: red X) until the next state.",
  families: ["security", "outage", "network", "systems", "data"],
  propsSchema: NodeGraphProps,
  propsSchemaName: "NodeGraphProps",
  example: {
    nodes: [
      { id: "lb", label: "load balancer", x: 0, y: 0.5 },
      { id: "api", label: "checkout-api", x: 0.5, y: 0.5 },
      { id: "db", label: "postgres", x: 1, y: 0.5 },
    ],
    edges: [
      { from: "lb", to: "api" },
      { from: "api", to: "db" },
    ],
  },
  states: ["live", "dim"],
  verbs: {
    enter: { durF: nodeGraphEnterF(8, 12), does: "nodes stagger in 3 f apart (entrance spring; each plate opaque before its tag / label, +3 f), then edges draw on over 12 f (3 f apart, ≤ 9 f spread)" },
    exit: { durF: 8, does: "content first: tags, labels, edges and packets fade + blur 4 f on the opaque node / label plates, then the plates go (4 f); the field scrim holds until the plates are nearly gone" },
    state: { durF: NODE_GRAPH.revealDelayF + NODE_GRAPH.edgeDrawF, does: "live/dim; nodeStates / edgeStates overrides cross-fade 6 f (text snaps); a node turning danger squashes and then pulses 0.7↔1 / 20 f. `hidden` (node or edge) = not drawn: a hidden node set visible ENTERS on this frame (spring) and its edges draw on 6 f later (an edge shows only when both ends and the edge itself are not hidden); set hidden again it fades out (node 8 f, edges 6 f) — one persistent graph grows node by node, beat by beat. An `active` edge that leads into a `danger` node (touches it, or runs through a node whose only other active edges do) is drawn danger, not accent: the chosen path into the failure reads red", props: ["nodeStates", "edgeStates"] },
    drawOn: { durF: 21, does: "edges (re)draw on from this frame (12 f each, 3 f apart); props.drawEdges [\"a>b\", …] = only those edges (they stay undrawn until it; the others draw after the enter); without drawEdges every edge waits for it instead of drawing after the enter", props: ["drawEdges"] },
    mark: { durF: MAX_PACKET_F, does: "launch a packet dot along the packet in force (props.packet, or this mark's override; none → no packet, no blur; the route ends before a node / edge hidden at launch) — 10 f per hop (longer only for edges over ~520 px, so the peak stays ≤ 130 px/f), bezier in/out per hop; the arrival node squashes. Every finished hop STAYS lit (accent line) until the next state / mark on the graph; a broken edge (state at launch) stops the dot at the midpoint: danger half-line + a red X held the same way. durF is the 4-hop upper bound; blur/L21 use the real route", props: ["packet"] },
    pulse: { durF: 12, does: "glow flash around every danger / accent node" },
    glitch: { durF: 4, does: "4 f glitch of the danger nodes only (all nodes when none is danger): fixed danger / text tinted copies ±8 px + a slice band inside the node square; counts toward the 0–3 budget" },
  },
  focal: true,
  footprint: (p, w) => nodeGraphSize(p, w),
  // Declared UPPER BOUND (4 hops of the longest edge; peak holds by construction, hopFrames). World px, so the screen
  // speed scales with the camera zoom. The timeline models each mark with flightFor (the real route) instead, blurred
  // under the binding 1 px / cap 32 rule like every other flight (no per-flight sample spacing).
  flight: { verbs: ["mark"], durF: MAX_PACKET_F, peakPxPerF: PACKET_PEAK_PX_PER_F },
  flightFor: (p, w) => packetFlight(p, w),
  relayout: (p, w) => {
    const { w: W, h: H } = nodeGraphSize(p, w);
    const m = graphMetrics(p, W, H);
    return p.nodes.map((n) => ({ from: nodeCentre(n, W, H), to: nodeCentre(n, W, H, m), k: m.k, r: (n.shape === "square" ? NODE_GRAPH.node : NODE_GRAPH.dot) / 2 }));
  },
  contentBox: (p, w) => {
    const { w: W, h: H } = nodeGraphSize(p, w);
    return graphContentBox(p, W, H);
  },
  shape: (p, w) => graphShape(p, w),
  sfx: { mark: "whoosh", state: "tick", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof NodeGraphProps>;
