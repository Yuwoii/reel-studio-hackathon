// v3 library slot: = remotion/v2/components/Slot.tsx with the v3 components (W3a) looked up first. Same props parsing,
// per-frame RenderProps and PlaceholderCard fallback, so a v2 component renders identically under ExplainerV3.
import React, { useMemo } from "react";
import { useCurrentFrame } from "remotion";
import { prepareInstance, renderPropsAt } from "../v2/components/contract";
import { PlaceholderCard } from "../v2/components/PlaceholderCard";
import type { SlotProps } from "../v2/components/types";
import { componentForV3 } from "./library";

const warned = new Set<string>();

export const SlotV3: React.FC<SlotProps> = (p) => {
  const frame = useCurrentFrame();
  const comp = componentForV3(p.inst.component);
  const prep = useMemo(() => (comp ? prepareInstance(comp.meta, p.inst.props, p.track.events, p.inst.w) : null), [comp, p.inst.props, p.track.events, p.inst.w]);
  if (!comp || !prep) return <PlaceholderCard {...p} />;
  if (!prep.ok) {
    const k = `${p.inst.id}:${prep.error}`;
    if (!warned.has(k)) {
      warned.add(k);
      console.warn(`[library v3] ${p.inst.component} "${p.inst.id}": props rejected (${prep.error}) — rendering PlaceholderCard`);
    }
    return <PlaceholderCard {...p} />;
  }
  const rp = renderPropsAt(comp.meta, prep, { id: p.inst.id, frame, track: p.track, widthOverride: p.inst.w, tl: p.tl, figure: p.inst.figure });
  const R = comp.Render as React.FC<typeof rp>;
  return <R {...rp} />;
};
