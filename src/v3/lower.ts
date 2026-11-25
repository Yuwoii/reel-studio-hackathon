// lowerToV21 (ADR-002 §4.3): storyboard v3.0 → the v2.1 shape resolveTimeline / the v2 layers already understand.
//
//   - every {instance, anchor} (camera targets, camera0, world binds, travel waypoints, screen overlays) → world px,
//     from the v3 meta's anchors(props, size, {asset}, state) (devices: code; Plate: the manifest's plate-normalised
//     anchors; Model3D: projected xyz), with the props/state in force at that beat;
//   - world-bound instances become plain v2 instances (their own anchor point — meta.anchor, else the box centre — on
//     the bound part + (dx, dy));
//   - screen-bound overlays leave the world → `screenOverlays` for remotion/v3/OverlayLayer.tsx (they keep their pixel
//     size under a 3.2× zoom); their actions stay on the beats, so resolveTimeline still resolves their frames;
//   - `travel` → `travels` (resolved to frames after resolveTimeline by resolveTravels; the World offsets the prop);
//   - camera `snap` → pushOut with durF 8–14 (W4 adds a true snap bezier; W3a probe: ≥ 14 f keeps small text clean);
//     anchor targets with `fill` get their zoom from the part's radius;
//   - `datafield: "none"` → a v2 preset ("hex") + `datafieldNone` (ExplainerV3 then draws no field);
//   - library-set props: Plate {asset "id@v", aspect from the manifest, edge "card" for captures}, Model3D {asset},
//     Glow {target, onPhoto} (W3a hand-off);
//   - KEPT for the v2 timeline (W2): board `leadMs`, beat `pauseAfterMs` (absent stays absent → v2 timing);
//   - realness (A7/A8/L7v3) from the component META + asset manifest only (`real`); `locked` only gates the stage fill;
//   - travel `via` points may carry a world-px (dx, dy) offset from their part;
//   - stripped: schema→"v2.1", origin, assets, shots, assetRequests, act, rate, claims, terms, bind, asset, locked.
// An upgraded v2.1 board (upgradeV21) lowers back to itself, byte for byte after canonical JSON (ADR-002 §9; the
// anti-example round-trip test).
//
// NO runtime imports: the lib (metas, footprints, manifests) is injected, so the same module runs in the container
// (src/v3/lints.ts v3Lib()) and in the Remotion bundle (remotion/v3/library.ts).

import type { AnchorRefT, BeatV3T, CameraTargetV3T, InstanceV3T, StoryboardV3T } from "../schema/storyboard.v3.js";
import type { AtT, Storyboard } from "../schema/storyboard.v2.js";
import type { AnchorAsset, AnchorPx, AnyV3Meta } from "./components-meta/_types.js";
import type { Timeline, TimelineBeat } from "../v2/timeline.js";
import type { Pt, Rect } from "./project.js";

/** = project.ts zoomForFill (copied: runtime imports would break the Remotion bundle; a test keeps them equal). */
export function zoomForFillLocal(rWorld: number, fill: number, min = 0.6, max = 4): number {
  if (!(rWorld > 0)) return max;
  return Math.max(min, Math.min(max, (fill * 952) / (2 * rWorld)));
}

/** The slice of an asset manifest the lowering needs (structural; container and bundle pass the generated index). */
export type LowerAsset = AnchorAsset & { kind?: string; component?: string; caveats?: readonly string[] };

export interface LowerLib {
  /** v3 component meta (undefined for v2 components). */
  v3meta(component: string): AnyV3Meta | undefined;
  /** Props-aware UNSCALED footprint of any library component (v2 or v3), null when unknown / props invalid. */
  size(component: string, props: Record<string, unknown>, w: number | undefined): { w: number; h: number } | null;
  /** The component's own anchor point (meta.anchor), unscaled footprint px; null = its box centre. */
  ownAnchor(component: string, props: Record<string, unknown>, w: number | undefined): Pt | null;
  /** Manifest by id (+ version). */
  asset(id: string, version?: number): LowerAsset | undefined;
  /** Every manifest (realness: is a device component an analogy prop?). Optional for hand-built test libs. */
  assets?(): readonly LowerAsset[];
}

/** v3kind of the real objects (locked: never moved / rescaled by the v2 stage fill). */
export const LOCKED_KINDS = new Set(["device", "plate", "model3d"]);
/** An asset manifest caveat starting like this marks a drawn ANALOGY prop (the sealed letter, the company building):
 *  locked like a device, but not a "real object" for A7 / A8 / L7v3 (W3b fix round; W3a manifests carry the caveat). */
export const ANALOGY_CAVEAT = /^an analogy object\b/i;
export const SNAP = { dflt: 14, min: 8, max: 14 } as const;
/** Default travel duration (frames) when an action gives none. */
export const TRAVEL_DUR_F = 40;

export interface ScreenOverlay {
  id: string;
  component: string;
  /** bound part */
  to: AnchorRefT;
  /** world point of the bound part (static: the bound instance's travel offset is added per frame) */
  at: Pt;
  /** radius of the bound part, world px */
  r?: number;
  dx: number;
  dy: number;
  /** parsed raw props + library-set props (Glow target/onPhoto) */
  props: Record<string, unknown>;
  z: number;
}

export interface Travel {
  instance: string;
  beatIndex: number;
  at: AtT;
  durF: number;
  /** world points of the instance's own anchor: [start, …via] */
  pts: Pt[];
}

export interface ResolvedTravel extends Travel {
  startF: number;
  endF: number;
}

export interface LowerIssue {
  path: string;
  message: string;
}

/** World geometry of every v3 instance (lowered position; screen overlays have none). */
export interface PlacedInstance {
  id: string;
  component: string;
  box: Rect;
  scale: number;
  kind?: string;
  asset?: LowerAsset;
}

export interface Lowered {
  /** structurally v2.1 (zoom may exceed 2.2, components may be v3 ids: not re-zod-parsed) */
  board: Storyboard;
  screenOverlays: ScreenOverlay[];
  travels: Travel[];
  /** "instance#anchor" → world point (every reference the board makes) */
  anchorPoints: Record<string, Pt & { r?: number; label?: string }>;
  placed: Record<string, PlacedInstance>;
  /** never moved by the v2 stage fill: real-object kinds + any authored `locked: true` (renderer: stage fill gate) */
  locked: string[];
  /** REAL objects (A7 / A8 / L7v3): v3kind device / plate / model3d from the META, minus analogy props (asset caveat
   *  "an analogy object"). Never from the authored `locked` flag. */
  real: string[];
  /** bound parts whose position changes with a later state/props change of their host (the lowering resolves a bind
   *  once, so the bound instance would not follow: lint A5 errors on these) */
  drift: { id: string; to: AnchorRefT; beat: string; px: number }[];
  datafieldNone: boolean;
  issues: LowerIssue[];
}

type Inst = InstanceV3T;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Props + state of an instance as of beat `bi` (base props, then every earlier/same-beat `state` action, in order). */
export function propsStateAt(sb: StoryboardV3T, inst: Inst, meta: AnyV3Meta | undefined, bi: number): { props: Record<string, unknown>; state?: string } {
  let props: Record<string, unknown> = { ...(inst.props ?? {}) };
  let state: string | undefined;
  const allowed = new Set(meta?.verbs.state?.props ?? []);
  for (let k = 0; k <= bi && k < sb.beats.length; k++) {
    for (const a of sb.beats[k].actions) {
      if (a.target !== inst.id || a.do !== "state") continue;
      if (a.state) state = a.state;
      if (a.props) for (const [key, v] of Object.entries(a.props)) if (allowed.has(key)) props = { ...props, [key]: v };
    }
  }
  return { props, state };
}

export function lowerToV21(sb: StoryboardV3T, lib: LowerLib): Lowered {
  const issues: LowerIssue[] = [];
  const inst = new Map(sb.world.map((i) => [i.id, i]));
  const pins = new Map(sb.assets.map((a) => [a.id, a.version]));
  const assetOf = (i: Inst): LowerAsset | undefined => (i.asset ? lib.asset(i.asset, pins.get(i.asset)) : undefined);
  const anchorPoints: Lowered["anchorPoints"] = {};
  const placed: Record<string, PlacedInstance> = {};

  /** library-set props (Plate / Model3D / Glow), applied before footprints and anchors are computed */
  const libProps = (i: Inst, raw: Record<string, unknown>): Record<string, unknown> => {
    const a = assetOf(i);
    if ((i.component === "Plate" || i.component === "Model3D") && i.asset) {
      const out: Record<string, unknown> = { ...raw, asset: `${i.asset}@${pins.get(i.asset) ?? a?.version ?? 1}` };
      if (i.component === "Plate") {
        if (a?.file?.w && a.file.h) out.aspect = a.file.h / a.file.w;
        else if (!a) issues.push({ path: `world.${i.id}.asset`, message: `asset ${i.asset} is not in the registry` });
        if (out.edge === undefined && a?.kind === "capture") out.edge = "card";
      }
      return out;
    }
    if (i.component === "Glow" && i.bind) {
      const host = inst.get(i.bind.to.instance);
      return { ...raw, target: raw.target ?? i.bind.to.anchor, onPhoto: raw.onPhoto ?? host?.component === "Plate" };
    }
    return raw;
  };

  const placing = new Set<string>();
  /** World box of an instance (bound ones placed on their anchor). Memoised in `placed`. */
  const place = (id: string): PlacedInstance | null => {
    if (placed[id]) return placed[id];
    const i = inst.get(id);
    if (!i) return null;
    if (placing.has(id)) {
      issues.push({ path: `world.${id}.bind`, message: `bind cycle at ${id}` });
      return null;
    }
    placing.add(id);
    const meta = lib.v3meta(i.component);
    const props = libProps(i, i.props ?? {});
    const scale = i.scale ?? 1;
    const fp = lib.size(i.component, props, i.w);
    if (!fp && meta) issues.push({ path: `world.${id}.props`, message: `${i.component} "${id}": unknown footprint (props do not parse?)` });
    const size = fp ?? { w: i.w ?? 600, h: 160 };
    let x = i.x ?? 0;
    let y = i.y ?? 0;
    if (i.bind) {
      const p = resolve(i.bind.to, -1, `world.${id}.bind`);
      const own = lib.ownAnchor(i.component, props, i.w) ?? { x: size.w / 2, y: size.h / 2 };
      if (i.bind.space === "world") {
        x = p.x + i.bind.dx - own.x * scale;
        y = p.y + i.bind.dy - own.y * scale;
      } else {
        x = p.x;
        y = p.y;
      }
    }
    const out: PlacedInstance = { id, component: i.component, box: { x, y, w: size.w * scale, h: size.h * scale }, scale, kind: meta?.v3kind, asset: assetOf(i) };
    placing.delete(id);
    placed[id] = out;
    return out;
  };

  /** World point of a part, with the props/state in force at beat `bi` (-1 = the base props). */
  function resolve(r: AnchorRefT, bi: number, path: string): Pt & { r?: number; label?: string } {
    const i = inst.get(r.instance);
    const key = `${r.instance}#${r.anchor}`;
    if (!i) {
      issues.push({ path, message: `unknown instance ${r.instance}` });
      return { x: 0, y: 0 };
    }
    const meta = lib.v3meta(i.component);
    const box = place(i.id);
    if (!meta || !box) {
      issues.push({ path, message: `${i.component} "${i.id}" has no named anchors (only v3 real objects and overlays do)` });
      return box ? { x: box.box.x + box.box.w / 2, y: box.box.y + box.box.h / 2 } : { x: 0, y: 0 };
    }
    const ps = propsStateAt(sb, i, meta, bi);
    const parsed = meta.propsSchema.safeParse(libProps(i, ps.props));
    if (!parsed.success) {
      issues.push({ path, message: `${i.component} "${i.id}": props do not parse (${parsed.error.issues.map((q: { path: PropertyKey[]; message: string }) => `${q.path.map(String).join(".")}: ${q.message}`).join("; ")})` });
      return { x: box.box.x + box.box.w / 2, y: box.box.y + box.box.h / 2 };
    }
    const p = parsed.data as Record<string, unknown>;
    const size = meta.footprint(p, i.w);
    const a: AnchorPx | undefined = meta.anchors(p, size, box.asset ? { asset: box.asset } : undefined, ps.state)[r.anchor];
    if (!a) {
      const names = Object.keys(meta.anchors(p, size, box.asset ? { asset: box.asset } : undefined, ps.state));
      issues.push({ path, message: `${i.component} "${i.id}" has no anchor "${r.anchor}"${ps.state ? ` in state ${ps.state}` : ""} (has: ${names.join(", ")})` });
      return { x: box.box.x + box.box.w / 2, y: box.box.y + box.box.h / 2 };
    }
    const pt = { x: box.box.x + a.x * box.scale, y: box.box.y + a.y * box.scale, ...(a.r !== undefined ? { r: a.r * box.scale } : {}), label: a.label };
    if (!anchorPoints[key] || bi < 0) anchorPoints[key] = pt;
    return pt;
  }

  const target = (t: CameraTargetV3T, bi: number, path: string): { target: { station: string } | { instance: string } | { x: number; y: number }; zoom?: number } => {
    if (!("anchor" in t)) return { target: t };
    const p = resolve(t, bi, path);
    return { target: { x: p.x, y: p.y }, ...(t.fill !== undefined && p.r ? { zoom: zoomForFillLocal(p.r, t.fill) } : {}) };
  };

  // ── world ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const screenOverlays: ScreenOverlay[] = [];
  const world: Storyboard["world"] = [];
  const locked: string[] = [];
  const real: string[] = [];
  const analogyComponents = new Set((lib.assets?.() ?? []).filter((a) => a.component && a.caveats?.some((c) => ANALOGY_CAVEAT.test(c))).map((a) => a.component!));
  const isAnalogy = (i: Inst): boolean => {
    const a = assetOf(i);
    if (a) return !!a.caveats?.some((c) => ANALOGY_CAVEAT.test(c));
    return analogyComponents.has(i.component);
  };
  const firstEnterBeat = (id: string) => sb.beats.findIndex((b) => b.actions.some((a) => a.target === id && a.do === "enter"));
  for (const i of sb.world) {
    const meta = lib.v3meta(i.component);
    const realKind = meta ? LOCKED_KINDS.has(meta.v3kind) : false;
    if (i.locked || realKind) locked.push(i.id);
    if (realKind && !isAnalogy(i)) real.push(i.id);
    if (i.bind?.space === "screen") {
      const p = resolve(i.bind.to, Math.max(-1, firstEnterBeat(i.id)), `world.${i.id}.bind`);
      screenOverlays.push({ id: i.id, component: i.component, to: i.bind.to, at: { x: p.x, y: p.y }, ...(p.r !== undefined ? { r: p.r } : {}), dx: i.bind.dx, dy: i.bind.dy, props: libProps(i, i.props ?? {}), z: i.z ?? 1 });
      continue;
    }
    const pl = place(i.id);
    const { bind: _b, asset: _a, locked: _l, ...rest } = i;
    const props = libProps(i, i.props ?? {});
    world.push({ ...rest, x: pl ? pl.box.x : (i.x ?? 0), y: pl ? pl.box.y : (i.y ?? 0), ...(props !== i.props ? { props } : {}) } as Storyboard["world"][number]);
  }

  // ── beats ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const travels: Travel[] = [];
  /** last travel end per instance (chained travels start where the previous one ended) */
  const travelEnd = new Map<string, Pt>();
  const ownPoint = (id: string): Pt => {
    const pl = place(id);
    const i = inst.get(id)!;
    if (!pl) return { x: i.x ?? 0, y: i.y ?? 0 };
    const own = lib.ownAnchor(i.component, libProps(i, i.props ?? {}), i.w);
    return own ? { x: pl.box.x + own.x * pl.scale, y: pl.box.y + own.y * pl.scale } : { x: pl.box.x + pl.box.w / 2, y: pl.box.y + pl.box.h / 2 };
  };
  const beats = sb.beats.map((b: BeatV3T, bi) => {
    const { act: _a, rate: _r, claims: _c, terms: _t, ...rest } = b;
    const camera = b.camera.map((c, j) => {
      const t = target(c.target, bi, `beats.${bi}.camera.${j}.target`);
      const snap = c.ease === "snap";
      const out: Record<string, unknown> = { ...c, target: t.target, ...(t.zoom !== undefined ? { zoom: t.zoom } : {}) };
      if (snap) {
        out.ease = "pushOut";
        out.durF = Math.max(SNAP.min, Math.min(SNAP.max, c.durF ?? SNAP.dflt));
      }
      return out;
    });
    const actions = b.actions.filter((a, j) => {
      if (a.do !== "travel") return true;
      if (!inst.has(a.target)) return false;
      const start = travelEnd.get(a.target) ?? ownPoint(a.target);
      const pts = [start, ...(a.via ?? []).map((v, m) => {
        const p = resolve(v, bi, `beats.${bi}.actions.${j}.via.${m}`);
        return { x: p.x + (v.dx ?? 0), y: p.y + (v.dy ?? 0) };
      })];
      travels.push({ instance: a.target, beatIndex: bi, at: a.at, durF: a.durF ?? TRAVEL_DUR_F, pts });
      travelEnd.set(a.target, pts[pts.length - 1]);
      return false;
    }).map(({ via: _v, durF: _d, ...a }) => a);
    return { ...rest, camera, actions };
  }) as unknown as Storyboard["beats"];

  const { origin: _o, assets: _as, shots: _sh, assetRequests: _ar, ...top } = sb;
  const datafieldNone = sb.datafield.preset === "none";
  const camera0 = sb.camera0
    ? (() => {
        const t = target(sb.camera0.target, 0, "camera0.target");
        return { ...sb.camera0, target: t.target, ...(t.zoom !== undefined ? { zoom: t.zoom } : {}) };
      })()
    : undefined;
  const board = {
    ...top,
    schema: "v2.1",
    datafield: datafieldNone ? { preset: "hex", seed: sb.datafield.seed } : sb.datafield,
    world,
    beats,
    ...(camera0 ? { camera0 } : {}),
  } as unknown as Storyboard;
  if (!camera0) delete (board as { camera0?: unknown }).camera0;

  // drift: a bind is resolved once (world binds: base props; screen overlays: their first enter beat). If the host's
  // state/props change later moves that part, the bound instance would stay at the old point — report it.
  const drift: Lowered["drift"] = [];
  const snapshot = { ...anchorPoints };
  for (const i of sb.world) {
    if (!i.bind) continue;
    const host = inst.get(i.bind.to.instance);
    if (!host || !lib.v3meta(host.component)) continue;
    const b0 = i.bind.space === "screen" ? Math.max(-1, firstEnterBeat(i.id)) : -1;
    const ref = resolve(i.bind.to, b0, `world.${i.id}.bind`);
    sb.beats.forEach((b, bi) => {
      if (bi <= b0 || !b.actions.some((a) => a.target === host.id && a.do === "state")) return;
      const p = resolve(i.bind!.to, bi, `world.${i.id}.bind`);
      const px = Math.hypot(p.x - ref.x, p.y - ref.y);
      if (px > 2 && !drift.some((d) => d.id === i.id)) drift.push({ id: i.id, to: i.bind!.to, beat: b.id, px });
    });
  }
  for (const k of Object.keys(anchorPoints)) if (!(k in snapshot)) delete anchorPoints[k];
  Object.assign(anchorPoints, snapshot);
  return { board, screenOverlays, travels, anchorPoints, placed, locked, real, drift, datafieldNone, issues };
}

// ── travel (after resolveTimeline) ─────────────────────────────────────────────────────────────────────────────

/** = src/v2/timeline.ts resolveAt (pure copy so this module stays import-free; a test keeps them equal). */
export function resolveAtLocal(beat: Pick<TimelineBeat, "keywordF" | "firstWordF" | "lastWordEndF" | "words">, at: AtT): number {
  const ref = (r: "keyword" | "phraseStart" | "phraseEnd") => (r === "keyword" ? beat.keywordF : r === "phraseStart" ? beat.firstWordF : beat.lastWordEndF);
  if (typeof at === "string") return ref(at);
  if ("word" in at) return beat.words[at.word]?.startF ?? beat.lastWordEndF;
  return Math.max(0, ref(at.ref) + at.offsetF);
}

export function resolveTravels(travels: readonly Travel[], tl: Pick<Timeline, "beats">): ResolvedTravel[] {
  return travels.map((t) => {
    const b = tl.beats[t.beatIndex];
    const startF = b ? resolveAtLocal(b, t.at) : 0;
    return { ...t, startF, endF: startF + t.durF };
  });
}

/** ease-in-out (cubic): the prop leaves and lands softly, like the bible camera ease. */
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Point along a polyline at arc-length share s ∈ [0, 1]. */
export function alongPath(pts: readonly Pt[], s: number): Pt {
  if (pts.length === 1 || s <= 0) return pts[0];
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = seg.reduce((a, b) => a + b, 0);
  if (total <= 0 || s >= 1) return pts[pts.length - 1];
  let d = s * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? Math.min(1, d / seg[i]) : 1;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    d -= seg[i];
  }
  return pts[pts.length - 1];
}

/** Offset of an instance from its lowered position at a (fractional) frame: the sum of its travels so far. */
export function travelOffset(travels: readonly ResolvedTravel[], instance: string, frame: number): Pt {
  const own = travels.filter((t) => t.instance === instance).sort((a, b) => a.startF - b.startF);
  if (!own.length) return { x: 0, y: 0 };
  const origin = own[0].pts[0];
  let cur = origin;
  for (const t of own) {
    if (frame < t.startF) break;
    const k = t.durF > 0 ? Math.min(1, (frame - t.startF) / t.durF) : 1;
    cur = alongPath(t.pts, easeInOut(k));
  }
  return { x: cur.x - origin.x, y: cur.y - origin.y };
}

/** Peak screen speed of a travel at zoom z (px/f), for the speed lint. */
export function travelPeakPxPerF(t: Pick<Travel, "pts" | "durF">, zoom: number): number {
  let v = 0;
  for (let f = 0; f < t.durF; f++) {
    const a = alongPath(t.pts, easeInOut(f / t.durF));
    const b = alongPath(t.pts, easeInOut((f + 1) / t.durF));
    v = Math.max(v, Math.hypot(b.x - a.x, b.y - a.y) * zoom);
  }
  return v;
}

/** The world point of every screen overlay's bound part at a frame (its host's travel added). */
export function overlayAnchorAt(o: ScreenOverlay, travels: readonly ResolvedTravel[], frame: number): Pt {
  const d = travelOffset(travels, o.to.instance, frame);
  return { x: o.at.x + d.x, y: o.at.y + d.y };
}

export { isObj };

// ── lib builders (shared by the container and the bundle; the caller passes its own module objects) ──────────────

/** Minimal footprint-lookup entry shape (= src/v2/components-meta/_lookup.ts LookupEntry, structurally). */
export interface LookupLike {
  footprint: { w: number; h: number } | null;
  focal: boolean;
  verbs?: readonly string[];
  states?: readonly string[];
  sizeFor?: (props: Record<string, unknown>, w: number | undefined) => { w: number; h: number } | null;
  anchorFor?: (props: Record<string, unknown>, w: number | undefined) => Pt | null;
}

/** Registry-style entries for the v3 metas (feed them to buildFootprintLookup together with the metas). */
export function v3RegistryEntries(metas: Readonly<Record<string, AnyV3Meta>>): Record<string, LookupLike> {
  const out: Record<string, LookupLike> = {};
  for (const [id, m] of Object.entries(metas)) out[id] = { footprint: null, focal: m.focal, verbs: Object.keys(m.verbs), states: m.states };
  return out;
}

/** The LowerLib over a merged (v2 + v3) footprint lookup, the v3 metas and the asset index. */
export function makeLowerLib(lookup: Readonly<Record<string, LookupLike>>, metas: Readonly<Record<string, AnyV3Meta>>, assets: readonly LowerAsset[]): LowerLib {
  return {
    v3meta: (c) => metas[c],
    size: (c, props, w) => {
      const e = lookup[c];
      if (!e) return null;
      const s = e.sizeFor ? e.sizeFor(props, w) : null;
      if (s) return s;
      if (!e.footprint) return null;
      return w !== undefined ? { w, h: (e.footprint.h * w) / e.footprint.w } : e.footprint;
    },
    ownAnchor: (c, props, w) => lookup[c]?.anchorFor?.(props, w) ?? null,
    asset: (id, version) => assets.find((a) => a.id === id && (version === undefined || a.version === version)),
    assets: () => assets,
  };
}
