// v3 component metadata contract (ADR-002 §2.1, §6.1, W3a). A v3 meta IS a v2 ComponentMetaDef (so the v2 slot,
// timeline, footprints and lints work unchanged on lowered boards) plus two v3 functions every component exposes:
//
//   anchors(props, size, ctx?, state?)  named PARTS of the drawn object in UNSCALED footprint px (same frame as footprint()).
//                               Plate / Model3D need the asset manifest (ctx.asset) — photo anchors are plate-normalised,
//                               3D anchors are model metres projected by the meta's own pure camera.
//   describe(state, props)      one line of what the component SHOWS and how it BEHAVES (digest + physics judge read
//                               it: "animated behaviour is a claim", R1 §8.6).
//
// Same bundle-safety rules as v2 metas: runtime imports of `zod` only, `import type` for everything else.

import type { z } from "zod";
import type { ComponentMetaDef } from "../../v2/components-meta/_types.js";

/** One named part, footprint px (unscaled). `r` = radius of the part for rings / zoom framing. */
export interface AnchorPx {
  x: number;
  y: number;
  r?: number;
  label: string;
  physical: string;
  /** Group anchor (e.g. "the four status LEDs"): the centre may fall BETWEEN parts — overlays must use `r` (a ring of
   *  radius r encloses every member), never a small ring at the centre. The members are listed as their own anchors. */
  group?: readonly string[];
  /** The part's drawn extent (UNSCALED footprint px, x0..x1 / y0..y1) when a circle of radius r misdescribes it (a
   *  wide address bar, a callout with its caption). Lint A14 measures parts by this box (default: the r circle's box). */
  box?: { x0: number; y0: number; x1: number; y1: number };
  /** A part that must never be sliced by the frame edge (text, a readout, an inset callout): lint A14 blocks a settled
   *  frame that shows part of it. */
  edge?: boolean;
}
export type AnchorMap = Record<string, AnchorPx>;

/** The slice of an asset manifest a meta needs (structural, so metas never import the manifest module at runtime). */
export interface AnchorAsset {
  id: string;
  version: number;
  anchors: Record<string, { label: string; physical: string; at?: { x: number; y: number }; xyz?: readonly [number, number, number] | [number, number, number]; r?: number; box?: { x0: number; y0: number; x1: number; y1: number } }>;
  file?: { w?: number; h?: number };
}
export interface AnchorCtx {
  asset?: AnchorAsset;
}

/** device = drawn real object; plate = photo/capture; overlay = screen-space annotation bound to an anchor; model3d. */
export type V3Kind = "device" | "plate" | "overlay" | "model3d";

export interface V3MetaDef<S extends z.ZodObject = z.ZodObject> extends ComponentMetaDef<S> {
  v3kind: V3Kind;
  /** Device asset ids (assets/visual/<id>) this component draws. */
  assetIds?: readonly string[];
  /** `state` (the component's current state name, when known): parts that are not visible in that state (the
   *  Envelope's note while sealed) are left out, so nothing can be aimed at empty space. */
  anchors: (props: z.output<S>, size: { w: number; h: number }, ctx?: AnchorCtx, state?: string) => AnchorMap;
  describe: (state: string, props: z.output<S>) => string;
  /** The drawn OBJECT's extent (UNSCALED footprint px) when the footprint carries empty room or context around it
   *  (the headphone cup in a 760 px cutaway). Lint A16 (too small) measures this; default: the whole footprint. */
  content?: (props: z.output<S>, size: { w: number; h: number }, state?: string) => { x: number; y: number; w: number; h: number };
  /** True while the component moves on its own every frame (vessels beating, waves scrolling). Lint A15 (static)
   *  counts that as change only when the component is ≥ A_LIMITS.staticAnimMinShare of the frame width on screen. */
  continuous?: (props: z.output<S>, state?: string) => boolean;
  /** Mechanism components: when a line calls for this picture. `words` = lower-case stems matched against a
   *  mechanism line's words (lint A17 warns when the line matches and the beat does not show the component). */
  whenToUse?: { text: string; words: readonly string[] };
  /** Components that animate a state change over many frames (WeeksPoster fills): the animation windows its state
   *  events run, in frames, from the BASE props + initial state + the instance's events (frame order). Lint A18 blocks
   *  any window still running at a beat's settled still frame, whichever beat it started in. */
  animWindows?: (props: z.output<S>, initial: string, events: readonly { f: number; do: string; state?: string; props?: Record<string, unknown> }[]) => AnimWindow[];
  /** A state name that is valid for the component but not for these props (WeeksPoster seg5 with 3 segments): the
   *  reason, or null. Lint L1 blocks it. */
  stateIssue?: (props: z.output<S>, state: string) => string | null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyV3Meta = V3MetaDef<any>;

/** One animation window of a component (lint A18). eventF = the state event that started it; queuedTo = the earlier
 *  fill it waited for (the event came while that one still ran, so the window starts later than its event). */
export interface AnimWindow {
  from: number;
  to: number;
  what: string;
  eventF?: number;
  queuedTo?: number;
}
