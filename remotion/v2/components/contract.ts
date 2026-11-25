// W2 component contract (ADR-001 §5): defineComponent({ ...meta, Render }).
//
//   meta    src/v2/components-meta/<Name>.ts — renderer-free (zod only): name, version, families, propsSchema
//           (content + Tone only), states, verbs (frame-anchored timing), focal, footprint(props, w), flight?, sfx.
//   Render  remotion/v2/components/<Name>.tsx — a PURE function of RenderProps (no hooks that read time other than
//           what the slot passes; randomness only via remotion random(seed); discrete values on `f`).
//
// The slot (Slot.tsx) does the plumbing for every component, identically in the Explainer and the V2Gallery:
//   - parses inst.props with propsSchema (defaults filled; invalid props → PlaceholderCard + a console warning),
//   - folds action `props` overrides into a props timeline (only the keys the verb's VerbSpec.props allows),
//   - resolves the named state at the frame, and the latest frame of every verb,
//   - applies the shared entrance/exit (unless meta.enterExit === "self") and inst.scale around the Render.
//
// No runtime imports from src/ here other than the import-free _lookup helpers (bundle-safe, extensionless).
import type React from "react";
import type { z } from "zod";
import { initialStateOf, propsAt, propsTimeline, stateAt, type PropsTimeline, type StateAt, type TrackEvent } from "../../../src/v2/components-meta/_lookup";
import type { AnyComponentMeta, ComponentMetaDef, Verb } from "../../../src/v2/components-meta/_types";
import type { FigNodeT } from "../../../src/schema/storyboard.v2";
import type { Timeline } from "../../../src/v2/timeline";
import type { InstanceTrack } from "../world";

export type { AnyComponentMeta, ComponentMetaDef, StateAt, TrackEvent, Verb };

export interface RenderProps<P = Record<string, unknown>> {
  /** Instance id (use it in random() seeds: `${id}:…`). */
  id: string;
  /** Props in force at this frame (base props + every accepted action override so far), schema defaults filled. */
  props: P;
  /** Props before the latest override (= props when nothing changed yet): scramble from prev.x to props.x. */
  prev: P;
  /** Frame of the latest props override (null = base props). */
  changeF: number | null;
  /** The instance's base props (parsed). */
  base: P;
  /** Fractional frame (motion-blur sub-samples) — use for continuous motion. */
  frame: number;
  /** Math.floor(frame) — use for every discrete value (digits, typed characters, scramble glyphs, glitch frames). */
  f: number;
  /** Unscaled layout box = meta.footprint(props, inst.w); draw inside it, never outside. */
  size: { w: number; h: number };
  /** Named state at f (initial state from meta.initialState / states[0]). */
  state: StateAt;
  /** All resolved actions on this instance in frame order. */
  events: readonly TrackEvent[];
  /** Latest frame ≤ f of `verb` (undefined = not happened yet). */
  last: (verb: Verb) => number | undefined;
  /** First enter / exit frame (null = always in / never exits). Only needed by enterExit: "self" components. */
  enterF: number | null;
  exitF: number | null;
  /** The resolved reel timeline (a synthetic empty one in the V2Gallery; null in unit tests). Components must not
   *  depend on it for their look — everything a component shows comes from props, state and verbs. */
  tl: Timeline | null;
  /** Figure only: the instance's `figure` nodes (Instance.figure in the storyboard); undefined elsewhere. */
  figure?: readonly FigNodeT[];
}

export interface LibraryComponent<S extends z.ZodObject = z.ZodObject> {
  meta: ComponentMetaDef<S>;
  Render: React.FC<RenderProps<z.output<S>>>;
}

/** The one way to declare a library component: `export const X = defineComponent({ ...meta, Render })`. */
export function defineComponent<S extends z.ZodObject>(def: ComponentMetaDef<S> & { Render: React.FC<RenderProps<z.output<S>>> }): LibraryComponent<S> {
  const { Render, ...meta } = def;
  return { meta: meta as ComponentMetaDef<S>, Render };
}

/** Latest event frame of `verb` at or before f (events sorted by frame). */
export function lastEvent(events: readonly TrackEvent[], verb: Verb, f: number): number | undefined {
  let hit: number | undefined;
  for (const e of events) {
    if (e.f > f) break;
    if (e.do === verb) hit = e.f;
  }
  return hit;
}

export interface Prepared {
  ok: true;
  base: Record<string, unknown>;
  pt: PropsTimeline;
  initial: string;
}

/** Parse + fold an instance once (the slot memoises it). */
export function prepareInstance(meta: AnyComponentMeta, rawProps: unknown, events: readonly TrackEvent[], w?: number): Prepared | { ok: false; error: string } {
  const r = meta.propsSchema.safeParse(rawProps ?? {});
  if (!r.success) return { ok: false, error: r.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".") || "(props)"}: ${i.message}`).join("; ") };
  const base = r.data as Record<string, unknown>;
  return { ok: true, base, pt: propsTimeline(meta, base, events, w), initial: initialStateOf(meta, base) };
}

/** RenderProps for one frame (pure; the slot and the tests call it). */
export function renderPropsAt(meta: AnyComponentMeta, prep: Prepared, args: { id: string; frame: number; track: Pick<InstanceTrack, "events" | "enterF" | "exitF">; widthOverride: number | undefined; tl: Timeline | null; figure?: readonly FigNodeT[] }): RenderProps {
  const f = Math.floor(args.frame);
  const step = propsAt(prep.pt, f);
  const events = args.track.events;
  return {
    id: args.id,
    props: step.props,
    prev: step.prev,
    changeF: step.cause ? step.f : null,
    base: prep.base,
    frame: args.frame,
    f,
    // size follows the BASE props: the box (lints, camera, culling) is fixed for the instance's life
    size: meta.footprint(prep.base, args.widthOverride),
    state: stateAt(meta, prep.initial, events, f),
    events,
    last: (verb) => lastEvent(events, verb, f),
    enterF: args.track.enterF,
    exitF: args.track.exitF,
    tl: args.tl,
    ...(args.figure ? { figure: args.figure } : {}),
  };
}
