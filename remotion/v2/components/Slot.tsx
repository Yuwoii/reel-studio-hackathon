// The library slot: id → component lookup, props parsing, the per-frame RenderProps, and the PlaceholderCard fallback
// for ids that have no shipped component (planned registry entries) or whose props fail their schema.
// Used by the World (Explainer) and the V2Gallery, so a component renders identically in both.
import React, { useMemo } from "react";
import { useCurrentFrame } from "remotion";
import { buildFootprintLookup, type LookupEntry } from "../../../src/v2/components-meta/_lookup";
import type { FootprintLookup } from "../../../src/v2/timeline";
import { COMPONENTS } from "../registry.gen";
import { prepareInstance, renderPropsAt, type LibraryComponent } from "./contract";
import { LIBRARY } from "./index";
import { PlaceholderCard } from "./PlaceholderCard";
import type { SlotProps } from "./types";

export function componentFor(id: string): LibraryComponent | undefined {
  return LIBRARY[id];
}

/** Registry data + shipped metas: props-aware footprints for resolveTimeline / instanceTracks / worldExtent. */
export const LIBRARY_LOOKUP: FootprintLookup = buildFootprintLookup(COMPONENTS as unknown as Record<string, LookupEntry>, Object.fromEntries(Object.entries(LIBRARY).map(([k, c]) => [k, c.meta])));

/** "self" components animate their own enter/exit; the World then only culls them. */
export function ownsEnterExit(id: string): boolean {
  return LIBRARY[id]?.meta.enterExit === "self";
}

/** Frames after exitF until the component is gone (8 f shared exit, or the component's own exit). */
export function exitDurF(id: string): number {
  return LIBRARY[id]?.meta.verbs.exit.durF ?? 8;
}

const warned = new Set<string>();

export const Slot: React.FC<SlotProps> = (p) => {
  const frame = useCurrentFrame();
  const comp = componentFor(p.inst.component);
  const prep = useMemo(() => (comp ? prepareInstance(comp.meta, p.inst.props, p.track.events, p.inst.w) : null), [comp, p.inst.props, p.track.events, p.inst.w]);
  if (!comp || !prep) return <PlaceholderCard {...p} />;
  if (!prep.ok) {
    const k = `${p.inst.id}:${prep.error}`;
    if (!warned.has(k)) {
      warned.add(k);
      console.warn(`[library] ${p.inst.component} "${p.inst.id}": props rejected (${prep.error}) — rendering PlaceholderCard`);
    }
    return <PlaceholderCard {...p} />;
  }
  const rp = renderPropsAt(comp.meta, prep, { id: p.inst.id, frame, track: p.track, widthOverride: p.inst.w, tl: p.tl, figure: p.inst.figure });
  const R = comp.Render as React.FC<typeof rp>;
  return <R {...rp} />;
};
