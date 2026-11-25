// Renderer-free component metadata contract (ADR-001 §5, W2). Every library component has ONE metadata file here,
// src/v2/components-meta/<Name>.ts, exporting `meta` (everything except the React Render). The container (director
// tools, lints, scripts/v2/gen-registry.ts) imports these files; the Remotion bundle imports them too (through
// remotion/v2/components/<Name>.tsx), so they must stay bundle-safe:
//
//   - runtime imports: ONLY the `zod` package. No `remotion`, no `@remotion/*`, no React, and no relative runtime
//     imports (Remotion's webpack cannot resolve this repo's NodeNext ".js" specifiers). `import type` is fine.
//   - propsSchema is a strict zod object of CONTENT + Tone only (strings, numbers, enums). Colours are never props:
//     a component maps Tone / states to theme tokens itself (amendments §2, L2).
//
// This file has no runtime code at all (types only), so meta files `import type` from "./_types.js".

import type { z } from "zod";

/** Storyboard action verbs (= ACTION_VERBS in src/schema/storyboard.v2.ts; the generator checks they match). */
export type Verb = "enter" | "exit" | "state" | "focus" | "pulse" | "scramble" | "drawOn" | "countUp" | "mark" | "glitch";
/** R7 topic families (= storyboard `family`). */
export type Family = "security" | "outage" | "network" | "systems" | "science" | "data";
/** Synthesised SFX types (= SFX_TYPES). */
export type SfxType = "tick" | "whoosh" | "glitch" | "thud" | "chatter" | "silenceHole";
/** Library tier (ADR §5): bible §6 core, the Figure escape hatch, or an R7 addition by priority. */
export type ComponentTier = "core" | "figure" | "p0" | "p1" | "p2" | "p3";

export interface VerbSpec {
  /**
   * Frames from the action's anchor frame until the verb's animation has fully settled (frame-anchored timing). Used
   * by L20 (frame 0 / cover settled), the review-still picker (keywordF + 6 must be past durF for "settled" checks)
   * and the README tables. 0 = instantaneous.
   */
  durF: number;
  /** One line: what the verb does on THIS component (shown to the director). */
  does: string;
  /** Action `props` this verb accepts (keys of propsSchema), e.g. a state change that also swaps the status text. */
  props?: readonly string[];
}

export interface FlightSpec {
  /** Verbs during which the component moves itself through world space (e.g. RequestPill "enter" = fly in). */
  verbs: readonly Verb[];
  /** Duration of the flight in frames from the verb's anchor (L21: on screen ≥ 8 f). */
  durF: number;
  /** Peak own speed in world px/f (feeds the blur-window speed; ≤ 150 px/f screen after zoom, L9). */
  peakPxPerF: number;
  /**
   * NOT APPROVED — do not set (W2.1 r2). A round-1 proposal for a per-flight sub-sample spacing (3 px for the NodeGraph
   * packet) that contradicts ADR-001 §7 "W2 (binding)": 1 px spacing, cap 32, flights included. resolveTimeline
   * ignores it (every flight is blurred at BLUR_PX_PER_SAMPLE) and test/v2-components-c.test.ts asserts no shipped
   * meta sets it. Kept only so _lookup.ts flightForMeta still type-checks; remove both once that file drops it, or
   * revive it through an ADR-001 §7 addendum backed by a blur probe.
   */
  samplePx?: number;
}

/**
 * Everything about a component except its Render. `S` is the zod props schema (a strict z.object).
 * Footprints are UNSCALED world px; the slot applies `inst.scale`, the lints/camera apply the camera transform.
 */
export interface ComponentMetaDef<S extends z.ZodObject = z.ZodObject> {
  /** PascalCase id = file name = Instance.component value. */
  name: string;
  /** Integer, bumped on every visual/behaviour change of this component (part of a supervised library release). */
  version: number;
  tier: ComponentTier;
  /** Where the visual spec comes from, e.g. "bible §6.1", "R7 N-1". */
  spec: string;
  /** One line for the director's catalogue. */
  summary: string;
  families: readonly Family[];
  propsSchema: S;
  /** Name of the exported schema constant (shown in the registry / director catalogue). */
  propsSchemaName: string;
  /** A minimal valid props object (zod INPUT). Drives the generated static footprint and the contract tests. */
  example: z.input<S>;
  /**
   * Named states accepted by `do: "state"` (first = default). A state change always animates (bible §6). Empty =
   * the component has no `state` verb.
   */
  states: readonly string[];
  /** Initial state from the props (default: states[0]). */
  initialState?: (props: z.output<S>) => string;
  /** Verbs this component implements, with their frame-anchored timing. `enter` and `exit` are always present. */
  verbs: Partial<Record<Verb, VerbSpec>> & { enter: VerbSpec; exit: VerbSpec };
  /** Counts toward the ≤ 3 focal budget (L4) unless the instance overrides it. Focal elements sit on opaque plates. */
  focal: boolean;
  /**
   * Unscaled layout box for these props at instance width `w` (undefined = the component's default width). Must be
   * honest: the Render never draws outside it (L3 safe zone and L4 overlap are computed from it). Pure.
   */
  footprint: (props: z.output<S>, w: number | undefined) => { w: number; h: number };
  /**
   * Optional (W5.1): the part of the footprint that actually draws for these props, unscaled, relative to the
   * footprint's top-left (NodeGraph: the node squares + label plates, not the empty canvas around them). The stage-fill
   * pass (timeline.ts fitWorld) sizes and clears by it. Default = the whole footprint. Pure.
   */
  contentBox?: (props: z.output<S>, w: number | undefined) => { x: number; y: number; w: number; h: number };
  /**
   * Optional (W5.1): points the component draws somewhere else than the spec layout puts them (NodeGraph: node centres
   * after the canvas stretch + node scale k), unscaled, footprint-relative. `from` = the spec point (what the director's
   * tools compute), `to` = where it is drawn, `k` = the local size factor there, `r` = the spec radius of the thing at
   * that point. A Callout whose dot sits on such a thing follows it (timeline.ts followAnchors). Pure.
   */
  relayout?: (props: z.output<S>, w: number | undefined) => readonly { from: { x: number; y: number }; to: { x: number; y: number }; k: number; r: number }[];
  /** Optional (W5.1): the point this component pins to the world (Callout: its dot), unscaled, footprint-relative. A
   *  pinned component follows what it points at when the library re-lays that out (relayout). Pure. */
  anchor?: (props: z.output<S>, w: number | undefined) => { x: number; y: number };
  /** Optional (W5.1 FR1): what the component DRAWS for these props, unscaled, footprint-relative — the parts the L23
   *  caption / hairline checks measure one by one (NodeGraph: one block per node), and the geometry L33 tests a Callout
   *  against (graph node squares, label plates, edge segments; a Callout's dot, leader and plate). The stage-fill pass
   *  (timeline.ts fitWorld) checks every candidate on these, so a fit can never make a part or a callout worse. Pure. */
  shape?: (props: z.output<S>, w: number | undefined) => DrawnShape;
  /** Present when the component moves itself through the world (blur windows, L21). The declared UPPER BOUND. */
  flight?: FlightSpec;
  /**
   * Optional props-aware flight (W2.1): the own speed (world px/f, unscaled; index k = anchor + k → anchor + k + 1)
   * of ONE flight-verb action, given the props in force at the action's frame (base props + accepted overrides, the
   * action's own included) and the instance `w`. [] = this action does not fly (e.g. NodeGraph `mark` without a
   * packet). When present, resolveTimeline's blur windows and L21 use it instead of `flight`'s static durF/peak; every
   * value must stay ≤ flight.peakPxPerF and the length ≤ flight.durF. Pure.
   */
  flightFor?: (props: z.output<S>, w: number | undefined) => readonly number[];
  /** Suggested SFX per verb (the director may place these; the mixer never adds them on its own). */
  sfx: Partial<Record<Verb, SfxType>>;
  /**
   * "wrapper" (default): the World slot applies the shared entrance spring and 8 f exit (amendments §7).
   * "self": the Render animates its own enter/exit (e.g. Callout: dot pops, line draws, label fades); the slot only
   * culls it before enterF and after exitF + verbs.exit.durF.
   */
  enterExit?: "wrapper" | "self";
}

/** The erased form every consumer (generator, lints, slot) works with. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponentMeta = ComponentMetaDef<any>;

/** Drawn geometry of one instance (meta.shape), unscaled, footprint-relative. */
export interface DrawnShape {
  /** Parts measured one by one ("node:<id>" for a graph node block; "" = the whole drawn box). */
  parts: { part: string; x: number; y: number; w: number; h: number }[];
  /** NodeGraph: node squares / dots and their label plates. */
  nodes?: { id: string; label: string; box: { x: number; y: number; w: number; h: number }; plate: { x: number; y: number; w: number; h: number } }[];
  /** NodeGraph: drawn edge segments ("from>to"). */
  edges?: { key: string; ax: number; ay: number; bx: number; by: number }[];
  /** Callout: dot centre, leader polyline and label plate. */
  dot?: { x: number; y: number };
  points?: { x: number; y: number }[];
  pill?: { x: number; y: number; w: number; h: number };
}
