// Container-side view of the component library: the generated registry data (registry.gen.ts) joined with the
// shipped renderer-free metas (components-meta/index.ts). Never imported by remotion/ (NodeNext ".js" imports); the
// bundle builds the same lookup in remotion/v2/components/Slot.tsx from the same pure helper.

import { META } from "./components-meta/index.js";
import { buildFootprintLookup, parseProps, propsTimeline, type LookupEntry, type ParseResult, type TrackEvent } from "./components-meta/_lookup.js";
import type { AnyComponentMeta } from "./components-meta/_types.js";
import { COMPONENTS } from "./registry.gen.js";
import type { FootprintLookup } from "./timeline.js";

export { META };

/** Props-aware footprint lookup (default `lib` for lints and resolveTimeline in the container). */
export const LIBRARY_LOOKUP: FootprintLookup = buildFootprintLookup(COMPONENTS as unknown as Record<string, LookupEntry>, META as Record<string, AnyComponentMeta>);

export function metaFor(component: string): AnyComponentMeta | undefined {
  return (META as Record<string, AnyComponentMeta>)[component];
}

/** Parse an instance's props with its component's propsSchema; undefined for planned components (no schema yet). */
export function parseInstanceProps(component: string, raw: unknown): ParseResult | undefined {
  const m = metaFor(component);
  return m ? parseProps(m, raw) : undefined;
}

/** Action `props` overrides an instance's component would drop (L1). */
export function rejectedOverrides(component: string, base: Record<string, unknown>, events: readonly TrackEvent[], w?: number): { event: TrackEvent; reason: string }[] {
  const m = metaFor(component);
  return m ? propsTimeline(m, base, events, w).rejected : [];
}
