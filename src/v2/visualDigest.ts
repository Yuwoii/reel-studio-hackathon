// W5 packet V: the visual-state digest. Per beat, a compact text line of what is ON SCREEN at the beat's review frame
// (keyword + 6, pushed past a camera move: lints.settledFrame), derived only from resolveTimeline + the component
// registry. Pure, deterministic, $0, no rendering.
//
// Why (W3.3 carry-over): the whole-reel mechanism judge reads script text only, so it passed reels whose storyboards
// draw a different story (evergreen-oom r2 b19: a Meter "pod cgroup" FULL at the 1 Gi tick reading "400 MB"; the DNS
// res>auth edge drawn "broken"). The digest is that missing second input, and the base the storyboard lints use for
// label-vs-state conflicts (L37), composition (L39–L42) and digest monotony (L43).
//
// One line per beat, ≤ DIGEST_MAX_CHARS (focal items first; pills / quotes after, collapsed to "+N pills" when the
// line is full):
//   b19 climax @1644 z0.95@sd | Kinetic kw red "tmpfs, kernel, sockets" · Meter lim2 FULL "pod cgroup" 400 MB/1 Gi
// Tones read as colours: danger = red, accent = lime, neutral = grey. NodeGraph lists only non-default states
// (nodes ≠ ok, edges ≠ idle; the `full` line also lists "drawn idle" edges); ContainerBox lists cells by kind; Terminal the shown line count + the last shown line.

import { metaFor, parseInstanceProps, LIBRARY_LOOKUP } from "./library.js";
import { contentParts, projectBox } from "./lints.js";
import { boxFill, CONTAINER_BOX_STATES, legacyFill, limitLead, parseLimit, type ContainerBoxPropsT, type ContainerBoxState } from "./components-meta/ContainerBox.js";
import { beatDirection, cyclesCapped, drawnTraceTone, flippedTraces, phaseText, sampledMax, sumFlatness, TAG_TEXT, traceCycles, traceDashed, tracePeaks, traceResidual, type SignalTracePropsT } from "./components-meta/SignalTrace.js";
import { divertShare, probeLight, rayTone, returnStrength, STACK_TAG_TEXT, type LayerStackPropsT } from "./components-meta/LayerStack.js";
import { deltaText, gridLevels, readoutText, ZOOM_RINGS, zoomCrossing, zoomRingsLeft, type SensorGridPropsT } from "./components-meta/SensorGrid.js";
import { edgeStateOf, failingEdges, meta as NODE_GRAPH_META, nodeStateOf, packetHops, type NodeGraphPropsT } from "./components-meta/NodeGraph.js";
import { derivedFill } from "./components-meta/Meter.js";
import { formatValue, heroText } from "./components-meta/HeroStat.js";
import { parseStoryboard, type InstanceT, type Storyboard, type WordsFileT } from "../schema/storyboard.v2.js";
import { cameraAt, fitStoryboard, fitWorld, resolveTimeline, tightenHugs, type Box, type CamState, type FootprintLookup, type Timeline, type TimelineBeat } from "./timeline.js";

/** Soft cap of one beat's digest line (the brief: ≤ ~120 chars / beat; ids and quantities are never abbreviated). */
export const DIGEST_MAX_CHARS = 120;
/** Strings shown in a digest are cut to this many characters (+ "…"). */
export const DIGEST_TEXT_CHARS = 22;
/** Cells of a ContainerBox grid (5×4). */
export const BOX_CELLS = 20;

/** Review frame of a beat: keywordF + 6 (ADR stills), pushed to the end of any camera move it falls in. */
export function settledFrame(tl: Pick<Timeline, "durationF" | "cameraSegments">, beat: Pick<TimelineBeat, "keywordF">): number {
  let f = Math.min(tl.durationF - 1, beat.keywordF + 6);
  for (const s of tl.cameraSegments) if (s.transition === "move" && f >= s.startF && f < s.endF) f = Math.min(tl.durationF - 1, s.endF);
  return f;
}

/** Visibility window of every instance: first `enter` → `exit` (+8 f). No enter action = on screen from frame 0. */
export function visibility(sb: Pick<Storyboard, "world">, tl: Pick<Timeline, "events" | "durationF">): Map<string, { from: number; to: number }> {
  const m = new Map<string, { from: number; to: number }>();
  for (const inst of sb.world) m.set(inst.id, { from: 0, to: tl.durationF });
  const entered = new Set<string>();
  for (const e of tl.events) {
    if (e.kind !== "action") continue;
    const v = m.get(e.target);
    if (!v) continue;
    if (e.do === "enter" && !entered.has(e.target)) {
      entered.add(e.target);
      v.from = e.frame;
    } else if (e.do === "exit") v.to = Math.min(v.to, e.frame + 8);
  }
  return m;
}

/** W5.1: the board as the library DRAWS it — the stage-fill pass (timeline.ts fitStoryboard, run by the Explainer's
 *  buildScene) may enlarge / re-centre the focal subject and set NodeGraph props.layout. Pass the director's own board
 *  and the timeline of the FITTED board (LintReport.timeline): W7.2 fitStoryboard first re-aims the camera holds
 *  (frameCamera, after shrinking hug-width card footprints: tightenHugs), and fitWorld runs over that camera, so the
 *  world is fitted here over `tl`'s camera exactly as the render does. Fitting a fitted board again is not defined. */
export function drawnBoard(sb: Storyboard, tl: Timeline, lib: FootprintLookup = LIBRARY_LOOKUP): Storyboard {
  const t = tightenHugs(sb, tl, lib);
  const f = fitWorld(t, tl, lib);
  return f.fits.length ? { ...t, world: f.world } : t;
}

/** One instance as it looks at a frame. */
export interface OnScreen {
  inst: InstanceT;
  focal: boolean;
  /** Named state in force (last `state` action, else the component's initial state); null = no states. */
  state: string | null;
  /** Props in force: base props + every action override up to the frame, parsed with the schema defaults when they
   *  parse (raw merge otherwise). */
  props: Record<string, unknown>;
  /** Screen box of what it draws (union of its content parts, camera incl. tilt). */
  screen: Box;
  /** A `mark` on it fired in this beat up to the frame (packet / highlight in flight). */
  markNow: boolean;
}
export interface BeatSnapshot {
  beat: TimelineBeat;
  frame: number;
  cam: CamState;
  /** "0.92@sd": zoom @ the station (or instance) under the camera target. */
  camAt: string;
  items: OnScreen[];
}

const STAGE_Y0 = 218; // header band bottom (lints.HEADER_BAND_BOTTOM)
const STAGE_Y1 = 1560; // footer hairline (lints.HAIRLINE_Y)
const STAGE_W = 1080;
const onStage = (b: Box) => b.x < STAGE_W && b.x + b.w > 0 && b.y < STAGE_Y1 && b.y + b.h > STAGE_Y0;

/** Props in force on an instance at frame f (raw merge of every action's props override up to f). */
export function rawPropsAt(tl: Pick<Timeline, "events">, inst: Pick<InstanceT, "id" | "props">, f: number): Record<string, unknown> {
  let props: Record<string, unknown> = { ...(inst.props ?? {}) };
  for (const e of tl.events) if (e.kind === "action" && e.target === inst.id && e.frame <= f && e.props) props = { ...props, ...e.props };
  return props;
}

/** State in force at frame f: the last `state` action's state name, else the component's initial state. */
export function stateAt(tl: Pick<Timeline, "events">, inst: Pick<InstanceT, "id" | "component" | "props">, f: number): string | null {
  let s: string | undefined;
  for (const e of tl.events) if (e.kind === "action" && e.target === inst.id && e.frame <= f && e.do === "state" && e.state) s = e.state;
  if (s) return s;
  const m = metaFor(inst.component);
  if (!m || !m.states.length) return null;
  const pr = parseInstanceProps(inst.component, inst.props);
  return (pr?.ok && m.initialState ? m.initialState(pr.value) : m.states[0]) ?? null;
}

function camLabel(sb: Pick<Storyboard, "stations" | "world">, cam: CamState): string {
  const z = Math.round(cam.zoom * 100) / 100;
  const st = sb.stations.find((s) => cam.x >= s.x && cam.x <= s.x + s.w && cam.y >= s.y && cam.y <= s.y + s.h);
  return `${z}@${st ? st.id : `${Math.round(cam.x)},${Math.round(cam.y)}`}`;
}

/** W5.1: a NodeGraph node before its library reveal frame (props.reveal, set by fitWorld) is not drawn yet — the
 *  snapshot shows it hidden, as the renderer does. */
function revealedAt(inst: InstanceT, raw: Record<string, unknown>, frame: number): Record<string, unknown> {
  const reveal = inst.component === "NodeGraph" ? (raw.reveal as Record<string, number> | undefined) : undefined;
  const later = Object.entries(reveal ?? {}).filter(([, r]) => frame < r).map(([id]) => id);
  if (!later.length) return raw;
  const nodeStates = { ...((raw.nodeStates as Record<string, string> | undefined) ?? {}) };
  for (const id of later) nodeStates[id] = "hidden";
  return { ...raw, nodeStates };
}

/** What is on screen at each beat's review frame (non-CTA and CTA alike), from the timeline + registry. */
/** `frameOf` (W6): snapshot each beat at another frame than its settled keyword still (the critic's beat-end still). */
export function beatSnapshots(sb: Storyboard, tl: Timeline, lib: FootprintLookup = LIBRARY_LOOKUP, frameOf: (beat: TimelineBeat) => number = (b) => settledFrame(tl, b)): BeatSnapshot[] {
  const vis = visibility(sb, tl);
  const exitAt = new Map<string, number>();
  for (const e of tl.events) if (e.kind === "action" && e.do === "exit" && !exitAt.has(e.target)) exitAt.set(e.target, e.frame);
  const parts = new Map(sb.world.map((inst) => [inst.id, contentParts(inst, lib).map((p) => p.box)]));
  return tl.beats.map((beat) => {
    const frame = frameOf(beat);
    const cam = cameraAt(tl, frame);
    const items: OnScreen[] = [];
    for (const inst of sb.world) {
      const v = vis.get(inst.id)!;
      const ex = exitAt.get(inst.id);
      if (frame < v.from || frame >= v.to || (ex !== undefined && frame >= ex)) continue;
      const boxes = (parts.get(inst.id) ?? []).map((b) => projectBox(b, cam));
      if (!boxes.length) continue;
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const screen = { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
      if (!onStage(screen)) continue;
      const raw = revealedAt(inst, rawPropsAt(tl, inst, frame), frame);
      const pr = parseInstanceProps(inst.component, raw);
      const markNow = tl.events.some((e) => e.kind === "action" && e.target === inst.id && e.do === "mark" && e.beatId === beat.id && e.frame <= frame);
      items.push({ inst, focal: inst.focal ?? lib[inst.component]?.focal ?? true, state: stateAt(tl, inst, frame), props: pr?.ok ? pr.value : raw, screen, markNow });
    }
    return { beat, frame, cam, camAt: camLabel(sb, cam), items };
  });
}

/** Frames of each hop of the packet in force (a broken hop: round(hopF / 2), and the route ends there); [] = no packet.
 *  The same hops as NodeGraph packetFlight (kept here: the component library — and so LIBRARY_HASH — is unchanged). */
export function packetHopDurations(props: NodeGraphPropsT, w: number | undefined): number[] {
  if (!props.packet) return [];
  const { w: W, h: H } = NODE_GRAPH_META.footprint(props, w);
  return packetHops(props, W, H, props.packet.split(">")).map((hp) => (hp.broken ? Math.round(hp.hopF / 2) : hp.hopF));
}

/** A NodeGraph `mark` with a packet in force (base props + every override up to the mark, its own included). */
export interface PacketMark {
  target: string;
  route: string;
  /** The mark frame, the frame the packet is mid-way along its LAST hop, and the frame the flight ends. */
  startF: number;
  midF: number;
  endF: number;
}

/** Packet marks of the timeline (needs the storyboard world: props + width). W5 integration: a still shot after the
 *  flight never shows the packet (w5/r1 b06, b19), so the critic asked to "animate a packet" that was there. */
export function packetMarks(timeline: Pick<Timeline, "events">, world: readonly InstanceT[]): Array<PacketMark & { beatIndex: number }> {
  const inst = new Map(world.map((i) => [i.id, i]));
  const out: Array<PacketMark & { beatIndex: number }> = [];
  for (const e of timeline.events) {
    if (e.kind !== "action" || e.do !== "mark") continue;
    const i = inst.get(e.target);
    if (!i || i.component !== "NodeGraph") continue;
    const pr = parseInstanceProps("NodeGraph", rawPropsAt(timeline, i, e.frame));
    if (!pr?.ok) continue;
    const props = pr.value as NodeGraphPropsT;
    const hops = packetHopDurations(props, i.w);
    if (!hops.length || !props.packet) continue;
    const before = hops.slice(0, -1).reduce((n, d) => n + d, 0);
    const last = hops[hops.length - 1];
    out.push({ target: i.id, route: props.packet, startF: e.frame, midF: e.frame + before + Math.floor(last / 2), endF: e.frame + before + last, beatIndex: e.beatIndex });
  }
  return out;
}

// ── per-component readouts (shared with the L37 label-vs-state lint) ─────────────────────────────────────────────

const TONE_WORD: Record<string, string> = { danger: "red", accent: "lime", neutral: "grey", dim: "dim", ok: "ok", degraded: "amber", active: "on", broken: "broken", idle: "idle", filled: "grey", freed: "freed", empty: "empty" };
export const toneWord = (t: unknown) => (typeof t === "string" ? (TONE_WORD[t] ?? t) : "");
const cut = (s: string, n = DIGEST_TEXT_CHARS) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const q = (s: unknown) => `"${cut(String(s ?? ""))}"`;

/** Meter: the fill level the bar settles at (state full → 1, empty → 0, else value) and the right-hand readout. */
export function meterReadout(state: string | null, p: Record<string, unknown>): { level: number; limit: number; readout: string; label: string } {
  const value = typeof p.value === "number" ? p.value : 0;
  const limit = typeof p.limit === "number" ? p.limit : 1;
  // W5.1 (Meter v3): numeric valueLabel + limitLabel in one unit decide the fill in every state but empty
  const derived = derivedFill({ valueLabel: typeof p.valueLabel === "string" ? p.valueLabel : undefined, limitLabel: typeof p.limitLabel === "string" ? p.limitLabel : undefined, limit });
  const level = state === "empty" ? 0 : derived ?? (state === "full" ? 1 : value);
  const readout = typeof p.valueLabel === "string" ? p.valueLabel : `${Math.round(level * 100)}%`;
  const label = state === "full" && typeof p.fullLabel === "string" ? p.fullLabel : String(p.label ?? "");
  return { level, limit, readout, label };
}

/** ContainerBox: the bar fill (= remotion ContainerBox fillFor = meta boxFill), the meter-row texts and the cell tally. */
export function boxReadout(state: string | null, p: Record<string, unknown>): { fill: number; left: string; right: string | null; cells: Record<string, number> | null; usedCells: number | null } {
  const st = (CONTAINER_BOX_STATES as readonly string[]).includes(state ?? "") ? (state as ContainerBoxState) : "neutral";
  const lim = parseLimit(typeof p.limitLabel === "string" ? p.limitLabel : undefined);
  // W7 v3: the meta's boxFill (= the renderer's fillFor): with cells / groups the cells ARE the bar
  const fill = boxFill(st, p as Partial<ContainerBoxPropsT> as ContainerBoxPropsT);
  const left = st === "full" ? String(p.fullLabel ?? "OUT OF MEMORY") : st === "killed" ? String(p.killedLabel ?? "KILLED") : String(p.meterLabel ?? "memory");
  let right: string | null = null;
  // W6: the same text the renderer draws (meta limitLead: cell unit / one decimal for a small limit)
  if (lim) right = lim.used !== null && st !== "full" && st !== "killed" ? `${Math.min(lim.used, lim.max)}${lim.mid}${lim.max}${lim.tail}` : `${limitLead(lim, fill, { cellValue: typeof p.cellValue === "number" ? p.cellValue : undefined, unitLabel: typeof p.unitLabel === "string" ? p.unitLabel : undefined })}${lim.max}${lim.tail}`;
  else if (typeof p.limitLabel === "string") right = p.limitLabel;
  // W7 v3: cells past a short map follow the AUTHORED fill (value / readout / STATE_FILL), as the renderer draws them
  const kinds = boxCellKinds(st === "full" || st === "killed" || st === "freed" ? fill : legacyFill(st, p as Partial<ContainerBoxPropsT> as ContainerBoxPropsT), p);
  if (!kinds) return { fill, left, right, cells: null, usedCells: null };
  const cells: Record<string, number> = {};
  let used = 0;
  for (const k of kinds) {
    cells[k] = (cells[k] ?? 0) + 1;
    if (k !== "empty" && k !== "freed") used++;
  }
  return { fill, left, right, cells, usedCells: used };
}

/** The 20 cell kinds of a ContainerBox with an explicit cell map (row-major; cells past the map follow the fill, as the
 *  renderer draws them); null = no `cells` prop (the cells are a plain fill). `fill` = boxReadout().fill. */
export function boxCellKinds(fill: number, p: Record<string, unknown>): string[] | null {
  const given = Array.isArray(p.cells) ? (p.cells as unknown[]).map(String) : null;
  if (!given) return null;
  const n = Math.round(fill * BOX_CELLS);
  return Array.from({ length: BOX_CELLS }, (_, i) => given[i] ?? (i < n ? "filled" : "empty"));
}

/** W5.1 number-true scale of a ContainerBox / UnitGrid: the "1 cell = 200 MB" chip text (cellValue + unitLabel), or null. */
export function cellScaleText(p: Record<string, unknown>): string | null {
  return typeof p.cellValue === "number" && typeof p.unitLabel === "string" ? `1 cell = ${Number.isInteger(p.cellValue) ? p.cellValue : Number(p.cellValue.toPrecision(3))} ${p.unitLabel}` : null;
}

/** NodeGraph: non-default node states and edge states ("user=red", "res>auth=broken"). */
export function graphStates(p: Record<string, unknown>): { nodes: string[]; edges: string[]; idle: string[] } | null {
  const pr = parseInstanceProps("NodeGraph", p);
  if (!pr?.ok) return null;
  const g = pr.value as NodeGraphPropsT;
  const nodes: string[] = [];
  const hidden = new Set<string>();
  for (const n of g.nodes) {
    const s = String(nodeStateOf(g, n.id));
    if (s === "hidden") hidden.add(n.id);
    if (s !== "ok") nodes.push(`${n.id}=${toneWord(s)}`);
  }
  const edges: string[] = [];
  const idle: string[] = []; // W5 fr2: an idle edge is still DRAWN — it claims the link exists now
  // W5.1: an active edge on a path into a danger node is DRAWN red (NodeGraph failingEdges), not lime
  const failing = failingEdges(g.edges, (id) => String(nodeStateOf(g, id)), (k) => { const [a, b] = k.split(">"); return String(edgeStateOf(g, a, b)); });
  for (const e of g.edges) {
    // W5.1: an edge is drawn only when it and both its ends are not hidden (a hidden one claims nothing)
    if (hidden.has(e.from) || hidden.has(e.to)) continue;
    const s = String(edgeStateOf(g, e.from, e.to));
    if (s === "hidden") continue;
    if (s !== "idle") edges.push(`${e.from}>${e.to}=${failing.has(`${e.from}>${e.to}`) ? "red" : toneWord(s)}`);
    else idle.push(`${e.from}>${e.to}`);
  }
  return { nodes, edges, idle };
}

/** ["n3=red", "n1=lime", "n4=red"] → "red n3,n4 lime n1" (first-seen tone order). */
function groupStates(xs: readonly string[]): string {
  const by = new Map<string, string[]>();
  for (const x of xs) {
    const i = x.lastIndexOf("=");
    const tone = x.slice(i + 1);
    (by.get(tone) ?? by.set(tone, []).get(tone)!).push(x.slice(0, i));
  }
  return [...by].map(([t, ids]) => `${t} ${ids.join(",")}`).join(" ");
}

/** Compact text of one on-screen item. */
export function digestItem(o: Pick<OnScreen, "inst" | "state" | "props" | "markNow">): string {
  return itemText(o, {});
}

/** W5 fr2: the full form — a NodeGraph also lists its idle ("drawn idle a>b") edges. */
export function digestItemFull(o: Pick<OnScreen, "inst" | "state" | "props" | "markNow">): string {
  return itemText(o, { idle: true });
}

function itemText(o: Pick<OnScreen, "inst" | "state" | "props" | "markNow">, opt: { idle?: boolean }): string {
  const { inst, state, props: p } = o;
  const id = inst.id;
  const tone = toneWord(state ?? p.tone);
  switch (inst.component) {
    case "Meter": {
      const m = meterReadout(state, p);
      const lim = typeof p.limitLabel === "string" ? `/${p.limitLabel}` : "";
      return `Meter ${id} ${state === "full" ? "FULL" : state === "empty" ? "EMPTY" : `${Math.round(m.level * 100)}%`} ${q(m.label)} ${m.readout}${lim}`;
    }
    case "ContainerBox": {
      const b = boxReadout(state, p);
      const cells = b.cells ? ` cells ${Object.entries(b.cells).filter(([k]) => k !== "empty").map(([k, n]) => `${n}${toneWord(k)}`).join("/")}` : "";
      const left = b.left === "memory" ? "" : ` ${q(b.left)}`; // the default meter label says nothing
      const scale = cellScaleText(p);
      return `Box ${id} ${state === "full" || state === "killed" ? state.toUpperCase() : state ?? ""} ${Math.round(b.fill * 100)}%${left}${b.right ? ` ${b.right}` : ""}${cells}${scale ? ` [${scale}]` : ""}`;
    }
    case "HeroStat": {
      const v = heroText(p as { prefix?: string; suffix?: string }, formatValue((p.value as number | string) ?? "", typeof p.decimals === "number" ? p.decimals : 0));
      return `Hero ${id} ${tone} ${p.label ? `${q(p.label)} ` : ""}${v}${p.tag ? ` [${cut(String(p.tag))}]` : ""}`;
    }
    case "NodeGraph": {
      const g = graphStates(p);
      if (!g) return `Graph ${id} ${state ?? ""}`;
      const pk = o.markNow && typeof p.packet === "string" ? ` +packet ${p.packet}` : "";
      return `Graph ${id}${state && state !== "live" ? ` ${state}` : ""} ${groupStates(g.nodes) || "all ok"}${g.edges.length ? `; ${groupStates(g.edges)}` : ""}${opt.idle && g.idle.length ? `; drawn idle ${g.idle.join(",")}` : ""}${pk}`;
    }
    case "Terminal": {
      const lines = Array.isArray(p.lines) ? (p.lines as { text?: string }[]) : [];
      const shown = typeof p.shown === "number" ? Math.min(p.shown, lines.length) : lines.length;
      const last = shown > 0 ? lines[shown - 1]?.text : "";
      return `Term ${id} ${tone} ${shown}/${lines.length}${last ? ` ${q(last)}` : ""}`;
    }
    case "StatusCard":
      return `Card ${id} ${tone} ${q(`${p.label ?? ""}: ${p.status ?? ""}`)}`;
    case "KineticWord":
      return `Kinetic ${id} ${tone} ${q(p.text)}`;
    case "Timeline":
      return `Timeline ${id} ${tone}${p.label ? ` ${q(p.label)}` : ""}${p.pill ? ` [${cut(String(p.pill))}]` : ""}`;
    case "VersionPills":
      return `Pills ${id} ${tone} [${(Array.isArray(p.items) ? p.items : []).map((x) => cut(String(x), 12)).join(",")}]`;
    case "VersusBadges": {
      // W5.1 fr1: each side's tone (oom b15: the critic read "CG" lime / "NODE" grey off the still, the digest said "even")
      const [lt, rt] = versusTones(state, p);
      return `Versus ${id} ${state ?? ""} ${q(p.leftBadge)}/${lt}|${q(p.rightBadge)}/${rt}`;
    }
    case "UnitGrid": {
      const scale = cellScaleText(p);
      return `Grid ${id} ${tone} ${typeof p.filled === "number" ? p.filled : ""}/100${scale ? ` [${scale}]` : ""}`;
    }
    case "SourceTag":
      return p.variant === "quote" ? `quote ${q(p.text)}` : p.variant === "stack" ? `stack ${tone} [${(Array.isArray(p.items) ? p.items : []).map((x) => cut(String(x), 12)).join(",")}]` : `pill ${q(p.text)}/${tone}`;
    case "Callout":
      return `callout ${q(p.text)}/${tone}`;
    case "SignalTrace":
      return traceDigest(id, state, p);
    case "LayerStack":
      return stackDigest(id, state, p, o.markNow);
    case "SensorGrid":
      return gridDigest(id, state, p);
    default:
      return `${inst.component} ${id}${state ? ` ${state}` : ""}`;
  }
}

// ── W5.1: the text each item DRAWS (narration ⇄ on-screen text pairs for the critic's X1 / S1 / S10) ─────────────
// W5 r2 event-recent b12: the Terminal printed "flag name was not nil" in red under "The SDK missed validating that a
// flag's name was not nil" — the on-screen fragment inverts the cause. No checker compared drawn strings with the
// narration; the critic now gets every beat's phrase next to every string drawn at its review frame, with its tone.

export interface DrawnText {
  id: string;
  /** "term", "pill", "stack", "hero", … (short component tag). */
  what: string;
  text: string;
  /** Colour word the text is drawn in: red / lime / grey / dim / white. */
  tone: string;
}

const LINE_TONE: Record<string, string> = { bad: "red", ok: "lime", cmd: "grey", dim: "dim", out: "white" };

/** VersusBadges side tones as drawn: state "left" / "right" dims the losing side (colours only). */
function versusTones(state: string | null, p: Record<string, unknown>): [string, string] {
  const lt = toneWord(p.leftTone ?? "accent") || "lime";
  const rt = toneWord(p.rightTone ?? "danger") || "red";
  return state === "left" ? [lt, "dim"] : state === "right" ? ["dim", rt] : [lt, rt];
}

/** Every string an on-screen item draws at its current state / props (the critic's pairs; deterministic order). */
export function drawnTexts(o: Pick<OnScreen, "inst" | "state" | "props">): DrawnText[] {
  const { inst, state, props: p } = o;
  const id = inst.id;
  const tone = toneWord(state ?? p.tone) || "grey";
  const out: DrawnText[] = [];
  const push = (what: string, text: unknown, t = tone) => {
    if (typeof text === "string" && text.trim()) out.push({ id, what, text: text.trim(), tone: t });
    else if (typeof text === "number") out.push({ id, what, text: String(text), tone: t });
  };
  switch (inst.component) {
    case "Terminal": {
      const lines = Array.isArray(p.lines) ? (p.lines as { text?: string; kind?: string }[]) : [];
      const shown = typeof p.shown === "number" ? Math.min(p.shown, lines.length) : lines.length;
      push("term title", p.title, "grey");
      for (const l of lines.slice(0, shown)) push("term", l.text, LINE_TONE[l.kind ?? "out"] ?? "white");
      break;
    }
    case "SourceTag":
      if (p.variant === "stack") {
        const items = Array.isArray(p.items) ? (p.items as unknown[]).map(String) : [];
        items.forEach((t, i) => push(i === p.highlight ? "stack (highlight)" : "stack", t, i === p.highlight ? "lime" : tone));
      } else push(p.variant === "quote" ? "quote" : "pill", p.text);
      break;
    case "HeroStat":
      push("hero", heroText(p as { prefix?: string; suffix?: string }, formatValue((p.value as number | string) ?? "", typeof p.decimals === "number" ? p.decimals : 0)));
      push("hero label", p.label, "grey");
      push("hero caption", p.caption, "grey");
      push("hero tag", p.tag, "grey");
      break;
    case "Meter": {
      const m = meterReadout(state, p);
      push("meter label", m.label, state === "full" ? "red" : "grey");
      push("meter value", m.readout, state === "full" ? "red" : "white");
      push("meter limit", p.limitLabel, "grey");
      break;
    }
    case "ContainerBox": {
      const b = boxReadout(state, p);
      push("box title", p.title, "white");
      push("box subtitle", p.subtitle, "grey");
      push("box meter", b.left, state === "full" || state === "killed" ? "red" : "grey");
      push("box readout", b.right, "grey");
      push("box scale", cellScaleText(p), "grey");
      for (const l of Array.isArray(p.legend) ? (p.legend as { kind?: string; label?: string }[]) : []) push("box legend", l.label, toneWord(l.kind === "filled" ? "neutral" : l.kind));
      // W5.1 fr1: named cell groups (P-L) — legendItems draws one swatch + label per declared group, in the group's tone
      for (const g of Array.isArray(p.groups) ? (p.groups as { label?: string; tone?: string }[]) : []) push("box group", g.label, toneWord(g.tone === "used" ? "neutral" : (g.tone ?? "danger")));
      break;
    }
    case "UnitGrid":
      push("grid caption", p.caption, "grey");
      push("grid scale", cellScaleText(p), "grey");
      push("grid legend", p.legend);
      break;
    case "StatusCard":
      push("card", `${p.label ?? ""}: ${p.status ?? ""}`);
      break;
    case "KineticWord":
      push("kinetic", p.text);
      break;
    case "Callout":
      push("callout", p.text);
      break;
    case "Timeline": {
      push("timeline label", p.label);
      push("timeline pill", p.pill);
      const ticks = Array.isArray(p.ticks) ? (p.ticks as unknown[]).map(String) : [];
      if (ticks.length) push("timeline ticks", ticks.join(" → "), "grey");
      break;
    }
    case "VersionPills":
      (Array.isArray(p.items) ? (p.items as unknown[]).map(String) : []).forEach((t, i) => push(i === p.highlight ? "pills (highlight)" : "pills", t));
      break;
    case "VersusBadges": {
      const [lt, rt] = versusTones(state, p);
      push("versus left", `${p.leftBadge ?? ""}${p.leftLabel ? ` ${p.leftLabel}` : ""}`, lt);
      push("versus right", `${p.rightBadge ?? ""}${p.rightLabel ? ` ${p.rightLabel}` : ""}`, rt);
      break;
    }
    case "NodeGraph": {
      // node labels of the lit / failing nodes (an "ok" node claims nothing) — hidden nodes are not drawn
      const pr = parseInstanceProps("NodeGraph", p);
      if (pr?.ok) {
        const g = pr.value as NodeGraphPropsT;
        for (const n of g.nodes) {
          const st = nodeStateOf(g, n.id);
          if (st !== "ok" && st !== "hidden") push("node", n.label, toneWord(st));
        }
      }
      break;
    }
    case "Stamp":
      push("stamp", p.text);
      break;
    case "SignalTrace": {
      const pr = parseInstanceProps("SignalTrace", p);
      if (!pr?.ok) break;
      const t = pr.value as SignalTracePropsT;
      const dim = state === "dim";
      push("trace title", t.title, dim ? "dim" : "white");
      if (t.rate) push("trace rate", t.rate, dim ? "dim" : toneWord(t.tone === "neutral" ? "neutral" : t.tone) === "grey" ? "white" : toneWord(t.tone));
      t.traces.forEach((x, i) => push("trace legend", x.label, dim ? "dim" : toneWord(drawnTraceTone(t, i, state))));
      if (t.combine === "sum" && state === "summed") push("trace sum", t.sumLabel, dim ? "dim" : toneWord(t.sumTone));
      if (state !== "summed") push("trace phase", phaseText(t) ?? undefined, dim ? "dim" : "white");
      push("trace threshold", t.thresholdLabel, "grey");
      push("trace span", t.span, "grey");
      if (t.tag !== "none") push("trace tag", TAG_TEXT[t.tag], "grey");
      break;
    }
    case "LayerStack": {
      const pr = parseInstanceProps("LayerStack", p);
      if (!pr?.ok) break;
      const l = pr.value as LayerStackPropsT;
      const dim = state === "dim";
      push("stack title", l.title, dim ? "dim" : "white");
      for (const x of l.layers) push(x.id === l.active ? "layer (active)" : "layer", `${x.label}${x.sub ? ` · ${x.sub}` : ""}`, dim ? "dim" : x.id === l.active ? toneWord(l.activeTone) : "white");
      for (const x of l.probes) push("probe", x.label, "grey");
      if (state === "lit" || state === "flow") l.rays.forEach((r, i) => push("ray", r.label, dim ? "dim" : toneWord(rayTone(l, i))));
      if (state === "flow") for (const f of l.flows) push("flow", f.label, dim ? "dim" : toneWord(f.tone));
      if (l.tag !== "none") push("stack tag", STACK_TAG_TEXT[l.tag], "grey");
      break;
    }
    case "SensorGrid": {
      const pr = parseInstanceProps("SensorGrid", p);
      if (!pr?.ok) break;
      const g = pr.value as SensorGridPropsT;
      const dim = state === "dim";
      push("grid title", g.title, dim ? "dim" : "white");
      push("grid rows", g.rowLabel, "grey");
      push("grid cols", g.colLabel, "grey");
      if (g.measure === "delta") push("grid legend", "delta capacitance 0 -> -9", dim ? "dim" : "white");
      if (state !== "idle") for (const t of g.touches) push("touch", t.label, dim ? "dim" : toneWord(t.tone));
      if (state === "located") {
        const gl = gridLevels(g);
        const tones = new Set(gl.clusters.map((c) => c.tone));
        push("grid readout", readoutText(g), dim ? "dim" : tones.size === 1 ? (g.measure === "delta" && gl.clusters[0].tone === "accent" ? "white" : toneWord(gl.clusters[0].tone)) : "white");
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// ── W7: the new physical components in the digest ─────────────────────────────────────────────────────────────

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num1 = (x: number) => String(Math.round(x * 10) / 10);

/** SignalTrace: state, the DRAWN cycle count (rate × span, L53), per-trace shape/tone, sampling / sum truth. */
function traceDigest(id: string, state: string | null, raw: Record<string, unknown>): string {
  const pr = parseInstanceProps("SignalTrace", raw);
  if (!pr?.ok) return `Trace ${id} ${state ?? ""}`;
  const p = pr.value as SignalTracePropsT;
  // W7.2: a pulse-type trace says which way each beat is DRAWN (the physics judge checks "returned light" dips)
  const dir = (t: SignalTracePropsT["traces"][number]) => {
    const d = beatDirection(t);
    return d ? ` beats=${d === "dip" ? "dips" : "peaks"}` : "";
  };
  const traces = p.traces.map((t, i) => `${t.label ? q(t.label) : t.id}=${t.shape}${t.invert ? " inv" : ""}${dir(t)}/${toneWord(drawnTraceTone(p, i, state))}${traceDashed(p, i) ? " dashed" : ""}`).join(",");
  const cyc = `${num1(traceCycles(p, 0))} cyc${cyclesCapped(p) ? " (capped)" : ""}`;
  const extra: string[] = [];
  if (p.rate) extra.push(`rate ${p.rate}`);
  if (p.span) extra.push(`over ${p.span}`);
  if (p.peaks) extra.push(`${tracePeaks(p).length} peaks${p.highlight !== undefined ? ` ring#${p.highlight}` : ""}`);
  if (state === "sampled" && p.samples) extra.push(`${p.samples} samples see ${pct(sampledMax(p))} of peak`);
  if (state === "summed" && p.combine === "sum") {
    // W7.3: an imperfect anti-phase twin leaves a small residual wiggle — never "FLAT" unless residual 0 (total)
    const fl = sumFlatness(p);
    const res = traceResidual(p);
    const what = fl < 1e-3 ? "FLAT (total cancellation)" : res > 0 ? `small RESIDUAL ${pct(res)} of the noise (not flat)` : `max ${num1(fl)}`;
    extra.push(`sum ${what}/${toneWord(p.sumTone)}`);
  }
  if (p.window) extra.push(`window ${pct(p.window.from)}-${pct(p.window.to)}/${toneWord(p.window.tone)}`);
  if (p.threshold !== undefined) extra.push(`threshold ${num1(p.threshold)}`);
  const ph = state === "summed" ? null : phaseText(p);
  if (ph) extra.push(`phase arc ${q(ph)}`);
  return `Trace ${id} ${state ?? "raw"} ${q(p.title)} [${traces}] ${cyc}${extra.length ? ` ${extra.join(" ")}` : ""}`;
}

/** LayerStack: layers (active marked), rays with returned strength, flows; pulse = swell beat. */
function stackDigest(id: string, state: string | null, raw: Record<string, unknown>, markNow: boolean): string {
  const pr = parseInstanceProps("LayerStack", raw);
  if (!pr?.ok) return `Stack ${id} ${state ?? ""}`;
  const p = pr.value as LayerStackPropsT;
  const layers = p.layers.map((l) => `${l.id === p.active ? "*" : ""}${l.label}${l.swell ? "~" : ""}`).join("/");
  const parts = [`Stack ${id} ${state ?? "idle"} [${cut(layers, 60)}]`];
  if (p.active) parts.push(`active ${p.active}/${toneWord(p.activeTone)}`);
  // W7.2: the DRAWN return strength (a held swell = more absorbed = a weaker, thinner return)
  if (p.swelled) parts.push("swelled (more absorbed)");
  const sw = p.swelled ? 1 : 0;
  const lights = p.probes.map((x) => [x.id, probeLight(x)] as const).filter(([, c]) => c);
  if (lights.length) parts.push(`light ${lights.map(([id, c]) => `${id}=${c}`).join(",")}`);
  if ((state === "lit" || state === "flow") && p.rays.length)
    parts.push(`rays ${p.rays.map((r, i) => `${r.from}>${r.depth}>${r.to} return ${pct(returnStrength(r.strength, sw))}/${toneWord(rayTone(p, i))}${divertShare(r) > 0 ? ` PARTIAL: ${r.divert} takes ${pct(divertShare(r))}` : ""}`).join(",")}`);
  if (state === "flow" && p.flows.length) parts.push(`flows ${p.flows.map((f) => `${f.from}>${f.to} ${q(f.label)}/${toneWord(f.tone)}${markNow ? " moving" : ""}`).join(",")}`);
  return parts.join(" ");
}

/** SensorGrid: state, touches, the computed peak level and the located centroid / readout (L55). */
function gridDigest(id: string, state: string | null, raw: Record<string, unknown>): string {
  const pr = parseInstanceProps("SensorGrid", raw);
  if (!pr?.ok) return `Sensor ${id} ${state ?? ""}`;
  const p = pr.value as SensorGridPropsT;
  const g = gridLevels(p);
  const head = `Sensor ${id} ${state ?? "idle"} ${p.cols}x${p.rows}`;
  if (state === "zoom") {
    // W7.2 close-up of one crossing: its own level / drop and how many of its field rings the touch took away
    const z = zoomCrossing(p);
    const v = g.levels[z.row - 1]?.[z.col - 1] ?? 0;
    const val = p.measure === "delta" ? `DROP ${deltaText(v).replace("\u2212", "-")}` : `level ${v}/9`;
    return `${head} close-up crossing col ${z.col} row ${z.row}: ${val}, field rings ${zoomRingsLeft(v)}/${ZOOM_RINGS}${v > 0 && p.touches.length ? " finger on it" : ""}`;
  }
  if (state === "idle" || !p.touches.length) return `${head} no touch${p.measure === "delta" ? " (all at baseline)" : ""}${p.field ? " field rings" : ""}`;
  const touches = p.touches.map((t) => `${t.label ? q(t.label) : t.size}/${toneWord(t.tone)}`).join(",");
  const loc = state === "located" ? ` located ${g.clusters.map((c) => `col ${c.col.toFixed(1)} row ${c.row.toFixed(1)}/${toneWord(c.tone)}`).join(",") || "nothing ≥ threshold"}${p.readout ? ` readout ${q(readoutText(p))}` : ""}` : "";
  const field = p.field ? " field rings (fade under touch)" : "";
  if (p.measure === "delta") return `${head} delta ${p.touches.length} touch [${touches}] DROP ${deltaText(g.max).replace("\u2212", "-")} (touched nodes dark vs grey baseline) thr ${p.threshold}${loc}${field}`;
  return `${head} ${p.touches.length} touch [${touches}] peak ${g.max}/9 thr ${p.threshold}${loc}${field}`;
}

// ── W7: drawn tones (L50 colour polarity input, spec §6.1) ──────────────────────────────────────────────────────

/** One accent / danger mark an item DRAWS at its state: `what` names the text or part ("text:SIGKILL", "trace:noise"). */
export interface DrawnTone {
  id: string;
  what: string;
  tone: "accent" | "danger";
}

const POLAR: Record<string, "accent" | "danger" | undefined> = { lime: "accent", red: "danger", accent: "accent", danger: "danger" };

/**
 * Every accent / danger mark an on-screen item draws (texts via drawnTexts, plus the coloured PARTS that carry no text:
 * cells, bar segments, graph nodes, traces, rays, touches). Pure; the L50 polarity lint (integration) compares these
 * with the keyword colour and the instance's role. Grey / dim / white marks are not listed.
 */
export function drawnTones(o: Pick<OnScreen, "inst" | "state" | "props">): DrawnTone[] {
  const { inst, state, props: p } = o;
  const id = inst.id;
  const out: DrawnTone[] = [];
  const add = (what: string, tone: string | undefined) => {
    const t = tone ? POLAR[tone] : undefined;
    if (t && !out.some((x) => x.what === what && x.tone === t)) out.push({ id, what, tone: t });
  };
  for (const t of drawnTexts(o)) add(`text:${t.text}`, t.tone);
  switch (inst.component) {
    case "HeroStat":
    case "StatusCard":
    case "UnitGrid":
    case "Timeline":
    case "KineticWord":
      add("tone", state ?? (p.tone as string | undefined));
      break;
    case "Meter":
      if (state === "full") add("bar", "danger");
      else add("bar", p.tone as string | undefined);
      break;
    case "ContainerBox": {
      if (state === "full" || state === "killed") add("bar", "danger");
      if (state === "accent") add("border", "accent");
      const cells = Array.isArray(p.cells) ? (p.cells as unknown[]).map(String) : [];
      if (cells.includes("danger")) add("cells", "danger");
      if (cells.includes("accent")) add("cells", "accent");
      for (const g of Array.isArray(p.groups) ? (p.groups as { label?: string; tone?: string }[]) : []) if (g.tone !== "used") add(`group:${g.label ?? ""}`, g.tone ?? "danger");
      break;
    }
    case "NodeGraph": {
      const g = graphStates(p);
      for (const x of [...(g?.nodes ?? []), ...(g?.edges ?? [])]) {
        const i = x.lastIndexOf("=");
        add(`node:${x.slice(0, i)}`, x.slice(i + 1));
      }
      break;
    }
    case "SignalTrace": {
      const pr = parseInstanceProps("SignalTrace", p);
      if (!pr?.ok || state === "dim") break;
      const t = pr.value as SignalTracePropsT;
      t.traces.forEach((x, i) => add(`trace:${x.id}`, drawnTraceTone(t, i, state)));
      if (state === "summed" && t.combine === "sum") add("sum", t.sumTone);
      if (t.window) add("window", t.window.tone);
      if (t.highlight !== undefined) add(`peak:${t.highlight}`, "accent");
      break;
    }
    case "LayerStack": {
      const pr = parseInstanceProps("LayerStack", p);
      if (!pr?.ok || state === "dim") break;
      const l = pr.value as LayerStackPropsT;
      if (l.active) add(`layer:${l.active}`, l.activeTone);
      if (state === "lit" || state === "flow") l.rays.forEach((_r, i) => add(`ray:${i}`, rayTone(l, i)));
      if (state === "flow") l.flows.forEach((f, i) => add(`flow:${i}`, f.tone));
      break;
    }
    case "SensorGrid": {
      const pr = parseInstanceProps("SensorGrid", p);
      if (!pr?.ok || state === "dim" || state === "idle") break;
      (pr.value as SensorGridPropsT).touches.forEach((t, i) => add(`touch:${i}`, t.tone));
      break;
    }
    default:
      break;
  }
  return out;
}

// ── W7.1 lint helpers: what a W7 subject SHOWS beyond its tones (for the integration step's keyword checks) ─────────

/** One semantic cue an item draws at its state: a capacitance DROP (SensorGrid delta), a phase arc ("180°"), a field
 *  overlay weakened under a touch. `text` = the drawn number / label. */
export interface DrawnCue {
  id: string;
  /** W7.3: + partial (a LayerStack ray diverted into a layer / contact), residual (a summed anti-phase pair that is not
   *  flat), flip (a trace mirrored on this beat), dims / brightens (a LayerStack return weaker / stronger than on the
   *  beat before). flip / dims / brightens are TRANSITION cues (transitionCues), the rest hold while drawn. */
  cue: "drop" | "phase" | "field" | "partial" | "residual" | "flip" | "dims" | "brightens";
  text: string;
}

/**
 * Cues for keyword ⇄ picture checks (S1 / S6, spec §6.1): a phrase saying "drops / weakens / reduces" lands on a
 * SensorGrid in measure delta (cue drop, never a lime fill); "180 degrees / out of phase / opposite" on a SignalTrace
 * phase arc (cue phase); "field" on a SensorGrid field overlay (cue field). Pure; [] when nothing applies.
 */
export function drawnCues(o: Pick<OnScreen, "inst" | "state" | "props">): DrawnCue[] {
  const { inst, state, props: p } = o;
  const out: DrawnCue[] = [];
  if (state === "dim") return out;
  if (inst.component === "SensorGrid") {
    const pr = parseInstanceProps("SensorGrid", p);
    if (!pr?.ok) return out;
    const g = pr.value as SensorGridPropsT;
    const touched = state !== "idle" && g.touches.length > 0;
    const max = touched ? gridLevels(g).max : 0;
    if (g.measure === "delta" && max > 0) out.push({ id: inst.id, cue: "drop", text: deltaText(max).replace("\u2212", "-") });
    if (g.field) out.push({ id: inst.id, cue: "field", text: max > 0 ? "weakened under touch" : "full" });
  } else if (inst.component === "SignalTrace") {
    const pr = parseInstanceProps("SignalTrace", p);
    if (!pr?.ok) return out;
    const t = pr.value as SignalTracePropsT;
    if (state === "summed") {
      const r = traceResidual(t);
      if (t.combine === "sum" && r > 0) out.push({ id: inst.id, cue: "residual", text: `${pct(r)} left` });
      return out;
    }
    const ph = phaseText(t);
    if (ph) out.push({ id: inst.id, cue: "phase", text: ph });
  } else if (inst.component === "LayerStack") {
    const pr = parseInstanceProps("LayerStack", p);
    if (!pr?.ok || (state !== "lit" && state !== "flow")) return out;
    for (const r of (pr.value as LayerStackPropsT).rays) if (divertShare(r) > 0) out.push({ id: inst.id, cue: "partial", text: `${r.divert} takes ${pct(divertShare(r))}` });
  }
  return out;
}

/**
 * W7.3 transition cues of a beat: what CHANGED on a focal W7 subject between the beat before's review frame and this
 * beat's — a SignalTrace trace whose invert toggled (flip), a LayerStack return that got weaker (dims) / stronger
 * (brightens) by ≥ 5 points (rays override or held swell). Pure, from two snapshots of the same board.
 */
export function transitionCues(prev: Pick<OnScreen, "inst" | "state" | "props"> | null, now: Pick<OnScreen, "inst" | "state" | "props">): DrawnCue[] {
  const out: DrawnCue[] = [];
  if (!prev || now.state === "dim" || prev.inst.id !== now.inst.id) return out;
  const id = now.inst.id;
  if (now.inst.component === "SignalTrace") {
    const a = parseInstanceProps("SignalTrace", prev.props);
    const b = parseInstanceProps("SignalTrace", now.props);
    if (!a?.ok || !b?.ok) return out;
    const B = b.value as SignalTracePropsT;
    for (const i of flippedTraces(a.value as SignalTracePropsT, B)) out.push({ id, cue: "flip", text: `${B.traces[i].label ?? B.traces[i].id} mirrored` });
  } else if (now.inst.component === "LayerStack") {
    const a = parseInstanceProps("LayerStack", prev.props);
    const b = parseInstanceProps("LayerStack", now.props);
    if (!a?.ok || !b?.ok) return out;
    const A = a.value as LayerStackPropsT;
    const B = b.value as LayerStackPropsT;
    const lit = (st: string | null) => st === "lit" || st === "flow";
    if (!lit(now.state) || !lit(prev.state)) return out;
    B.rays.forEach((r, i) => {
      const o = A.rays[i];
      if (!o || o.from !== r.from || o.to !== r.to) return;
      const was = returnStrength(o.strength, A.swelled ? 1 : 0);
      const is = returnStrength(r.strength, B.swelled ? 1 : 0);
      if (is < was - 0.05) out.push({ id, cue: "dims", text: `return ${pct(was)} -> ${pct(is)}` });
      else if (is > was + 0.05) out.push({ id, cue: "brightens", text: `return ${pct(was)} -> ${pct(is)}` });
    });
  }
  return out;
}

/** W7.3 key-step check input (story.outline's key step): on beat `beatId`, which focal subjects changed their drawn
 *  state against the beat before (visualStates.changed — a camera move or a moving carrier is not a change) and the cues
 *  that change carries (state cues of the changed items + transition cues). ok = at least one focal subject changed.
 *  null = no such beat. Pass the drawn (stage-fitted) board, like visualDigest. */
export interface KeyStepChange {
  beatId: string;
  ok: boolean;
  changed: string[];
  cues: DrawnCue[];
  /** digestItemFull text of each changed focal item, before (null = new on screen) and now. */
  before: Record<string, string | null>;
  now: Record<string, string>;
}
/** How an instance looked just before frame f (props + state in force at f − 1, whether or not it was on screen):
 *  the "before" of a transition, so a flip right after an entrance, or a dim after the stack was off screen, counts. */
export function lookBefore(tl: Pick<Timeline, "events">, inst: InstanceT, f: number): Pick<OnScreen, "inst" | "state" | "props"> {
  const raw = rawPropsAt(tl, inst, f - 1);
  const pr = parseInstanceProps(inst.component, raw);
  return { inst, state: stateAt(tl, inst, f - 1), props: pr?.ok ? pr.value : raw };
}

export function keyStepChange(sb: Storyboard, tl: Timeline, beatId: string, lib: FootprintLookup = LIBRARY_LOOKUP): KeyStepChange | null {
  const snaps = beatSnapshots(sb, tl, lib);
  const k = snaps.findIndex((x) => x.beat.id === beatId);
  if (k < 0) return null;
  const states = visualStates(sb, tl, lib);
  const st = states[k];
  const beat = snaps[k].beat;
  const cues: DrawnCue[] = [];
  const before: Record<string, string | null> = {};
  const now: Record<string, string> = {};
  for (const o of snaps[k].items) {
    if (!o.focal || !st.changed.includes(o.inst.id)) continue;
    cues.push(...drawnCues(o), ...transitionCues(lookBefore(tl, o.inst, beat.startF), o));
    before[o.inst.id] = k > 0 ? (states[k - 1].focal[o.inst.id] ?? null) : null;
    now[o.inst.id] = st.focal[o.inst.id];
  }
  return { beatId, ok: st.changed.length > 0, changed: st.changed, cues, before, now };
}

// ── W7.2 visual-change cues (input of the director-side visual-change / stations lint) ──────────────────────────
//
// Per beat, WHAT the focal subjects draw (a canonical key: state, props in force, tones — not position or size) and
// which of them changed against the previous beat; the composition (which focal subjects make up the picture, a
// SensorGrid close-up counting as its own picture); the camera framing; and the verbs that MOVE a focal subject in
// the beat without changing its drawn state (pulse / mark / drawOn / focus). Pure, from the same snapshots as the
// digest (pass the drawn = stage-fitted board, like visualDigest).

export interface BeatVisualState {
  beatId: string;
  part: string;
  frame: number;
  /** Focal instance id → canonical drawn-state key (digestItemFull text: state, values, tones). */
  focal: Record<string, string>;
  /** Sorted focal ids ("+" joined); a SensorGrid in state zoom adds ":closeup" (its own picture). "" = no focal. */
  composition: string;
  /** Camera framing: station (or rounded point) and zoom in 0.05 steps, e.g. "s2 z1.10". */
  camera: string;
  /** Focal ids that are new on screen or draw a different state than on the previous beat. */
  changed: string[];
  /** Verbs fired on a focal subject during this beat up to its review frame (motion without a state change). */
  motion: string[];
  /** Nothing changed against the previous beat: same composition, no focal changed, same camera framing. */
  same: boolean;
}

export function visualStates(sb: Storyboard, tl: Timeline, lib: FootprintLookup = LIBRARY_LOOKUP): BeatVisualState[] {
  const out: BeatVisualState[] = [];
  let prev: BeatVisualState | null = null;
  for (const s of beatSnapshots(sb, tl, lib)) {
    const focalItems = s.items.filter((o) => o.focal);
    const focal: Record<string, string> = {};
    for (const o of focalItems) focal[o.inst.id] = digestItemFull(o).replace(/\s+/g, " ").trim();
    const composition = focalItems
      .map((o) => `${o.inst.id}${o.inst.component === "SensorGrid" && o.state === "zoom" ? ":closeup" : ""}`)
      .sort()
      .join("+");
    // zoom in 0.05 steps: the slow hold drift (HOLD_DRIFT) is not a reframing
    const camera = `${s.camAt.replace(/^[\d.]+@/, "")} z${(Math.round(s.cam.zoom * 20) / 20).toFixed(2)}`;
    const changed = Object.keys(focal).filter((id) => !prev || prev.focal[id] !== focal[id]);
    const ids = new Set(Object.keys(focal));
    const motion = [
      ...new Set(
        tl.events
          .filter((e) => e.kind === "action" && e.beatId === s.beat.id && e.frame <= s.frame && ids.has(e.target) && ["pulse", "mark", "drawOn", "focus"].includes(e.do))
          .map((e) => (e.kind === "action" ? `${e.target}.${e.do}` : "")),
      ),
    ];
    const cur: BeatVisualState = { beatId: s.beat.id, part: s.beat.part, frame: s.frame, focal, composition, camera, changed, motion, same: !!prev && prev.composition === composition && changed.length === 0 && prev.camera === camera };
    out.push(cur);
    prev = cur;
  }
  return out;
}

/** Distinct focal compositions ("stations") a reel shows over its non-CTA beats (a W7.2 reel wants ≥ 3). */
export function compositionCount(states: readonly Pick<BeatVisualState, "composition" | "part">[]): number {
  return new Set(states.filter((x) => x.part !== "cta" && x.composition).map((x) => x.composition)).size;
}

/** Runs of consecutive beats that draw the same picture (same: true chained), as beat id lists of length ≥ 2. */
export function sameRuns(states: readonly Pick<BeatVisualState, "beatId" | "same">[]): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  states.forEach((x, i) => {
    if (x.same && i > 0) {
      if (!run.length) run = [states[i - 1].beatId];
      run.push(x.beatId);
    } else {
      if (run.length) runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

/** Per beat: the phrase and every string drawn at its review frame (the critic's narration ⇄ on-screen pairs). */
export interface TextPair {
  beatId: string;
  phrase: string;
  texts: DrawnText[];
}
export function textPairs(sb: Storyboard, tl: Timeline, lib: FootprintLookup = LIBRARY_LOOKUP): TextPair[] {
  return beatSnapshots(sb, tl, lib).map((s) => ({ beatId: s.beat.id, phrase: sb.beats[s.beat.index]?.phrase ?? "", texts: s.items.flatMap((o) => drawnTexts(o)) }));
}

/** One line per beat: `b12 SAYS "The SDK missed …" | DRAWN term/red "fatal error" · term/red "flag name was not nil"`. */
export function formatTextPair(t: TextPair, maxChars = 600): string {
  const drawn = t.texts.map((x) => `${x.what.replace(/ /g, "-")}:${x.id}/${x.tone} "${x.text.length > 80 ? `${x.text.slice(0, 79)}…` : x.text}"`).join(" · ");
  const line = `${t.beatId} SAYS ${JSON.stringify(t.phrase)} | DRAWN ${drawn || "(no text)"}`;
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}

export interface DigestItem {
  id: string;
  component: string;
  focal: boolean;
  state: string | null;
  text: string;
}
export interface BeatDigest {
  beatId: string;
  part: string;
  frame: number;
  camAt: string;
  items: DigestItem[];
  /** One line, ≤ DIGEST_MAX_CHARS (focal items are never dropped, so a crowded beat may run longer). */
  text: string;
  /** The same line with every item in full (for consumers with a larger budget). */
  full: string;
  /** W5 integration: packet marks that START in this beat — "packet g1 wrk>db, transient (f512–f534)". A packet dot
   *  exists only while it flies, so a still may miss it; this line says it is there (the critic reads it). */
  packets: string[];
}

/** Short form of a non-focal item when the line is nearly full: the text cut to 12 characters ("pill" dropped). */
function shortItem(text: string): string {
  const m = /^(?:pill|callout) "([^"]*)"\/(\S+)$/.exec(text);
  if (m) return `"${cut(m[1], 12)}"/${m[2]}`;
  const qm = /^quote "([^"]*)"$/.exec(text);
  return qm ? `quote "${cut(qm[1], 12)}"` : text;
}

/** Focal items first; then the rest, each in full or short form while the line stays ≤ DIGEST_MAX_CHARS; the remainder
 *  collapses to "+N more". Focal items are never dropped (a line with many focal items may run past the soft cap). */
function fitLine(head: string, focal: string[], rest: string[]): string {
  let line = `${head} | ${focal.join(" · ") || "(no focal)"}`;
  let left = 0;
  rest.forEach((r, i) => {
    const room = i === rest.length - 1 ? DIGEST_MAX_CHARS : DIGEST_MAX_CHARS - " · +N more".length; // keep room for the tally
    const fit = [r, shortItem(r)].find((x) => `${line} · ${x}`.length <= room);
    if (fit && !left) line = `${line} · ${fit}`;
    else left++;
  });
  return left ? `${line} · +${left} more` : line;
}

/** Per-beat visual digest from a parsed storyboard and its timeline. Deterministic: world order, fixed formats. */
export function visualDigest(sb: Storyboard, tl: Timeline, lib: FootprintLookup = LIBRARY_LOOKUP): BeatDigest[] {
  const enterF = new Map<string, number>();
  for (const e of tl.events) if (e.kind === "action" && e.do === "enter" && !enterF.has(e.target)) enterF.set(e.target, e.frame);
  const marks = packetMarks(tl, sb.world);
  return beatSnapshots(sb, tl, lib).map((s, bi) => {
    const items = s.items.map((o) => ({ id: o.inst.id, component: o.inst.component, focal: o.focal, state: o.state, text: digestItem(o).replace(/\s+/g, " ").trim() }));
    // W5 fr2: the FULL line (critic) also lists idle edges — an idle edge is drawn, so it claims the link exists now
    const fullText = new Map(s.items.map((o) => [o.inst.id, digestItemFull(o).replace(/\s+/g, " ").trim()]));
    const head = `${s.beat.id} ${s.beat.part} @${s.frame} z${s.camAt}`;
    const focal = items.filter((i) => i.focal).map((i) => i.text);
    // the newest non-focal items first (this beat's pill / quote), world order on ties
    const restItems = items.filter((i) => !i.focal).map((i, k) => ({ i, f: enterF.get(i.id) ?? -1, k })).sort((a, b) => b.f - a.f || a.k - b.k).map((x) => x.i);
    const rest = restItems.map((i) => i.text);
    const full = (i: DigestItem) => fullText.get(i.id) ?? i.text;
    const packets = marks.filter((m) => m.beatIndex === bi).map((m) => `packet ${m.target} ${m.route}, transient (f${m.startF}–f${m.endF})`);
    return { beatId: s.beat.id, part: s.beat.part, frame: s.frame, camAt: s.camAt, items, text: fitLine(head, focal, rest), full: [`${head} | ${items.filter((i) => i.focal).map(full).join(" · ") || "(no focal)"}`, ...restItems.map(full)].join(" · "), packets };
  });
}

/** Convenience for callers that hold raw JSON (the mechanism judge input, scripts): parse + resolve + digest. null =
 *  the storyboard does not parse. */
export function digestStoryboard(input: unknown, words: WordsFileT | null | undefined, lib: FootprintLookup = LIBRARY_LOOKUP): BeatDigest[] | null {
  const p = parseStoryboard(input);
  if (!p.ok || !p.value) return null;
  // W5.1: digest what renders (the stage-fitted board; the camera path is the director's)
  const sb = fitStoryboard(p.value, words, lib).sb;
  return visualDigest(sb, resolveTimeline(sb, words, lib), lib);
}

/** Alias under the name packet M's mechanism judge documents (buildVisualDigest(storyboard, words, registry)). */
export const buildVisualDigest = digestStoryboard;

/** The digest as prompt text: one line per beat. */
export function formatVisualDigest(d: readonly BeatDigest[]): string {
  return d.map((x) => x.text).join("\n");
}
