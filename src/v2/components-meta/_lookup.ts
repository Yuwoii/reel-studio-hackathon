// Pure helpers shared by the container (lints, director tools) and the Remotion slot. NO runtime imports at all
// (only `import type`), so it is safe in Remotion's webpack and under NodeNext. From remotion/, import extensionless.

import type { AnyComponentMeta, DrawnShape, Verb } from "./_types.js";

export type { DrawnShape };

export interface Size {
  w: number;
  h: number;
}
/** Props-aware footprint used by instanceBox(): null when the raw props do not parse (fall back to the static one). */
export type SizeFor = (props: Record<string, unknown>, w: number | undefined) => Size | null;

/** Props-aware flight of one action (meta.flightFor over the props in force at its frame); null = unknown (fall back
 *  to the static meta.flight), [] = no flight. `events` = the instance's actions in frame order. */
export type FlightFor = (raw: Record<string, unknown>, w: number | undefined, events: readonly TrackEvent[], at: TrackEvent) => { speeds: readonly number[]; samplePx: number } | null;

/** Props-aware drawn region inside the footprint (meta.contentBox), unscaled, footprint-relative; null = unknown. */
export type ContentFor = (props: Record<string, unknown>, w: number | undefined) => (Size & { x: number; y: number }) | null;

/** Spec → drawn points of an instance (meta.relayout), unscaled, footprint-relative; null = props do not parse. */
export type RelayoutFor = (props: Record<string, unknown>, w: number | undefined) => readonly { from: { x: number; y: number }; to: { x: number; y: number }; k: number; r: number }[] | null;

export interface LookupEntry {
  footprint: Size | null;
  focal: boolean;
  verbs?: readonly string[];
  states?: readonly string[];
  /** W7.1: the props a `state` action may override (meta verbs.state.props; "final" recalls only these). */
  stateProps?: readonly string[];
  sizeFor?: SizeFor;
  flightFor?: FlightFor;
  contentFor?: ContentFor;
  relayoutFor?: RelayoutFor;
  /** meta.anchor over raw props (null = props do not parse). */
  anchorFor?: (props: Record<string, unknown>, w: number | undefined) => { x: number; y: number } | null;
  /** meta.shape over raw props (null = props do not parse). */
  shapeFor?: (props: Record<string, unknown>, w: number | undefined) => DrawnShape | null;
}

export type ParseResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

const parseCache = new WeakMap<object, WeakMap<object, ParseResult>>();

/** Parse raw instance props with the component's propsSchema (defaults filled). Memoised per (meta, props object). */
export function parseProps(meta: AnyComponentMeta, raw: unknown): ParseResult {
  const key = raw !== null && typeof raw === "object" ? (raw as object) : null;
  let m = parseCache.get(meta);
  if (key && m?.has(key)) return m.get(key)!;
  const r = meta.propsSchema.safeParse(raw ?? {});
  const out: ParseResult = r.success
    ? { ok: true, value: r.data as Record<string, unknown> }
    : { ok: false, error: r.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".") || "(props)"}: ${i.message}`).join("; ") };
  if (key) {
    if (!m) parseCache.set(meta, (m = new WeakMap()));
    m.set(key, out);
  }
  return out;
}

export function sizeForMeta(meta: AnyComponentMeta): SizeFor {
  return (raw, w) => {
    const p = parseProps(meta, raw);
    return p.ok ? meta.footprint(p.value, w) : null;
  };
}

export function contentForMeta(meta: AnyComponentMeta): ContentFor | undefined {
  const cb = meta.contentBox;
  if (!cb) return undefined;
  return (raw, w) => {
    const p = parseProps(meta, raw);
    return p.ok ? cb(p.value, w) : null;
  };
}

export function relayoutForMeta(meta: AnyComponentMeta): RelayoutFor | undefined {
  const rl = meta.relayout;
  if (!rl) return undefined;
  return (raw, w) => {
    const p = parseProps(meta, raw);
    return p.ok ? rl(p.value, w) : null;
  };
}

export function flightForMeta(meta: AnyComponentMeta): FlightFor | undefined {
  const ff = meta.flightFor;
  if (!ff) return undefined;
  return (raw, w, events, at) => {
    const p = parseProps(meta, raw);
    if (!p.ok) return null;
    return { speeds: ff(propsAt(propsTimeline(meta, p.value, events, w), at.f).props, w), samplePx: meta.flight?.samplePx ?? 1 };
  };
}

/** Generated registry data + shipped metas → the FootprintLookup that resolveTimeline / lints / the World use. */
export function buildFootprintLookup(registry: Readonly<Record<string, LookupEntry>>, metas: Readonly<Record<string, AnyComponentMeta>>): Record<string, LookupEntry> {
  const out: Record<string, LookupEntry> = {};
  for (const [id, e] of Object.entries(registry)) {
    const meta = metas[id];
    const flightFor = meta ? flightForMeta(meta) : undefined;
    const contentFor = meta ? contentForMeta(meta) : undefined;
    const relayoutFor = meta ? relayoutForMeta(meta) : undefined;
    const anchor = meta?.anchor;
    const anchorFor = meta && anchor ? (raw: Record<string, unknown>, w: number | undefined) => {
      const pp = parseProps(meta, raw);
      return pp.ok ? anchor(pp.value, w) : null;
    } : undefined;
    const shape = meta?.shape;
    const shapeFor = meta && shape ? (raw: Record<string, unknown>, w: number | undefined) => {
      const pp = parseProps(meta, raw);
      return pp.ok ? shape(pp.value, w) : null;
    } : undefined;
    const stateProps = meta?.verbs.state?.props;
    out[id] = meta ? { ...e, ...(stateProps ? { stateProps } : {}), sizeFor: sizeForMeta(meta), ...(flightFor ? { flightFor } : {}), ...(contentFor ? { contentFor } : {}), ...(relayoutFor ? { relayoutFor } : {}), ...(anchorFor ? { anchorFor } : {}), ...(shapeFor ? { shapeFor } : {}) } : { ...e };
  }
  return out;
}

// ── props over time ────────────────────────────────────────────────────────────────────────────────────────────

/** A resolved action on one instance (from resolveTimeline events, or a gallery fixture timeline). */
export interface TrackEvent {
  f: number;
  do: Verb;
  state?: string;
  props?: Record<string, unknown>;
}

export interface PropsStep {
  /** First frame these props apply (0 = the instance's base props). */
  f: number;
  props: Record<string, unknown>;
  /** Props in force before this step (= props for the base step). */
  prev: Record<string, unknown>;
  /** The event that caused the step (undefined for the base step). */
  cause?: TrackEvent;
}

export interface PropsTimeline {
  steps: PropsStep[];
  /** Overrides that were dropped (key not accepted by the verb, or the merged props failed the schema). */
  rejected: { event: TrackEvent; reason: string }[];
}

/**
 * Apply action `props` overrides in frame order. A verb may only override the keys its VerbSpec lists in `props`;
 * the merged object must still pass propsSchema, and it must still FIT the instance box — the box is
 * meta.footprint(base, w) for the instance's whole life (L3/L4, culling and camera targets use it), so an override
 * whose footprint(props, w) is wider or taller than that box is dropped too (W2 fix: "the footprint must be
 * honest"). Dropped overrides are reported; the lints turn them into L1 errors. `w` = the instance's `w` (undefined =
 * the component default). Pure; the slot memoises it per instance.
 */
export function propsTimeline(meta: AnyComponentMeta, base: Record<string, unknown>, events: readonly TrackEvent[], w?: number): PropsTimeline {
  const steps: PropsStep[] = [{ f: 0, props: base, prev: base }];
  const box = meta.footprint(base, w);
  const rejected: PropsTimeline["rejected"] = [];
  const sorted = [...events].sort((a, b) => a.f - b.f);
  for (const e of sorted) {
    if (!e.props || !Object.keys(e.props).length) continue;
    const allowed = new Set(meta.verbs[e.do]?.props ?? []);
    const bad = Object.keys(e.props).filter((k) => !allowed.has(k));
    if (bad.length) {
      rejected.push({ event: e, reason: `${meta.name} "${e.do}" does not accept props ${bad.join(", ")}${allowed.size ? ` (accepts ${[...allowed].join(", ")})` : ""}` });
      continue;
    }
    const cur = steps[steps.length - 1].props;
    const r = meta.propsSchema.safeParse({ ...cur, ...e.props });
    if (!r.success) {
      rejected.push({ event: e, reason: `${meta.name} "${e.do}" props: ${r.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}` });
      continue;
    }
    const fp = meta.footprint(r.data as Record<string, unknown>, w);
    if (fp.w > box.w + 0.5 || fp.h > box.h + 0.5) {
      const dim = (s: Size) => `${Math.round(s.w)}×${Math.round(s.h)}`;
      rejected.push({ event: e, reason: `${meta.name} "${e.do}" props grow the box ${dim(box)} → ${dim(fp)} (the box is fixed from the base props): widen the instance w${fp.h > box.h + 0.5 ? " / shorten the text" : ""} so every state fits` });
      continue;
    }
    steps.push({ f: e.f, props: r.data as Record<string, unknown>, prev: cur, cause: e });
  }
  return { steps, rejected };
}

/** The props step in force at frame f (f = Math.floor(frame)). */
export function propsAt(pt: PropsTimeline, f: number): PropsStep {
  let hit = pt.steps[0];
  for (const s of pt.steps) {
    if (s.f <= f) hit = s;
    else break;
  }
  return hit;
}

// ── states over time ───────────────────────────────────────────────────────────────────────────────────────────

export interface StateAt {
  name: string;
  /** Frame the state was entered (null = initial state, in force from the start). */
  f: number | null;
  /** State before the latest change (null for the initial state). */
  prev: string | null;
}

/** The named state at frame f. Unknown state names are ignored here (L1 reports them). */
export function stateAt(meta: AnyComponentMeta, initial: string, events: readonly TrackEvent[], f: number): StateAt {
  let cur: StateAt = { name: initial, f: null, prev: null };
  for (const e of events) {
    if (e.f > f) break;
    if (e.do !== "state" || !e.state || !meta.states.includes(e.state)) continue;
    cur = { name: e.state, f: e.f, prev: cur.name };
  }
  return cur;
}

export function initialStateOf(meta: AnyComponentMeta, props: Record<string, unknown>): string {
  const s = meta.initialState ? meta.initialState(props) : meta.states[0];
  return s ?? "default";
}
