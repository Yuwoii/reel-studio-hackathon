// W3a snap blur probe (ADR-002 §5 L9, §10 W3a exit "40-frame snap blur probe shows no doubled glyphs"): the browser
// window with the S highlighted, snap-zoomed onto the S and pulled back (camera math: snapCamAt in
// src/v3/components-meta/_gallery.ts), each frame wrapped in v2's WeightedMotionBlur with blurSamples(fastest visible
// point) — the same sizing the v2 blur windows use. Never in a reel.
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { prepareInstance, renderPropsAt, type TrackEvent } from "../../../v2/components/contract";
import { useV2Fonts } from "../../../v2/fonts";
import { blurSamples, color, vignetteCss } from "../../../v2/theme";
import { WeightedMotionBlur } from "../../../v2/WeightedMotionBlur";
import { galleryXf, type SnapKey, snapCamAt, snapSpeedPx } from "../../../../src/v3/components-meta/_gallery";
import type { AnyV3Meta } from "../../../../src/v3/components-meta/_types";
import { V3_COMPONENTS, type V3ComponentId } from "../index";

export const SNAP_PROBE_ID = "V3W3aSnapProbe";

export interface SnapProbeInput {
  component: string;
  props: Record<string, unknown>;
  /** anchor names → keys use the anchor point as focus ("" = footprint centre) */
  keys: { f: number; zoom: number; focus: string }[];
}

const CamLayer: React.FC<{ input: SnapProbeInput; keys: SnapKey[]; size: { w: number; h: number } }> = ({ input, keys, size }) => {
  const frame = useCurrentFrame(); // fractional inside each blur sub-sample (Freeze)
  const comp = V3_COMPONENTS[input.component as V3ComponentId];
  const events: TrackEvent[] = useMemo(() => [], []);
  const prep = useMemo(() => prepareInstance(comp.meta, input.props, events), [comp, input.props, events]);
  if (!prep.ok) throw new Error(`snap probe: ${prep.error}`);
  const rp = renderPropsAt(comp.meta, prep, { id: "snap", frame: Math.floor(frame), track: { events, enterF: null, exitF: null }, widthOverride: undefined, tl: null });
  const R = comp.Render as React.FC<typeof rp>;
  const xf = galleryXf(size, "stage", snapCamAt(keys, frame));
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, transformOrigin: "0 0", transform: `translate(${xf.tx}px, ${xf.ty}px) scale(${xf.k})` }}>
      <R {...rp} />
    </div>
  );
};

export const V3SnapProbe: React.FC<SnapProbeInput> = (input) => {
  useV2Fonts();
  const frame = useCurrentFrame();
  const m = V3_COMPONENTS[input.component as V3ComponentId]?.meta as unknown as AnyV3Meta;
  const props = m.propsSchema.parse(input.props) as Record<string, unknown>;
  const size = m.footprint(props, undefined);
  const anchors = m.anchors(props, size);
  const keys: SnapKey[] = input.keys.map((k) => ({ f: k.f, zoom: k.zoom, focus: k.focus ? { x: anchors[k.focus].x, y: anchors[k.focus].y } : { x: size.w / 2, y: size.h / 2 } }));
  const n = blurSamples(snapSpeedPx(keys, size, frame - 1)); // motion over the shutter (frame − 1 → frame)
  return (
    <AbsoluteFill style={{ background: color.bg, overflow: "hidden" }}>
      <WeightedMotionBlur samples={n}>
        <AbsoluteFill style={{ background: color.bg }}>
          <CamLayer input={input} keys={keys} size={size} />
        </AbsoluteFill>
      </WeightedMotionBlur>
      <AbsoluteFill style={{ background: vignetteCss, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
