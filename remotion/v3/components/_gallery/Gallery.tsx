// W3a golden-still gallery: ONE v3 component (optionally an overlay bound to an anchor of a real object below it) on the
// v2 dark stage, with magenta probe rings at every anchor's screen point (probe: true). Used only for the Lambda golden
// stills and the ring-centring measurement (research/v3/W3a/tools/goldens.ts); never in a reel. Placement math is the
// pure placeLayer() in src/v3/components-meta/_gallery.ts, which the host measurement uses too.
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { prepareInstance, renderPropsAt, type TrackEvent } from "../../../v2/components/contract";
import { useV2Fonts } from "../../../v2/fonts";
import { color, font, layout, vignetteCss } from "../../../v2/theme";
import { assetByRef } from "../../../../src/v3/assets.gen";
import { type GalleryInput, type GalleryLayer, placeLayer, type PlacedLayer } from "../../../../src/v3/components-meta/_gallery";
import type { AnchorCtx, AnyV3Meta } from "../../../../src/v3/components-meta/_types";
import { V3_COMPONENTS, type V3ComponentId } from "../index";
import { PROBE } from "../tokens";

export const GALLERY_V3_ID = "V3W3aGallery";
export const GALLERY_V3_DURATION = 120;

function ctxFor(l: GalleryLayer): AnchorCtx | undefined {
  const ref = typeof l.props.asset === "string" ? l.props.asset : undefined;
  const a = ref ? assetByRef(ref) : undefined;
  return a ? { asset: a } : undefined;
}

const Layer: React.FC<{ l: GalleryLayer; placed: PlacedLayer; frame: number; id: string }> = ({ l, placed, frame, id }) => {
  const comp = V3_COMPONENTS[l.component as V3ComponentId];
  const events = (l.events ?? []) as TrackEvent[];
  const prep = useMemo(() => prepareInstance(comp.meta, l.props, events), [comp, l.props, events]);
  if (!prep.ok) throw new Error(`gallery ${l.component}: ${prep.error}`);
  const enter = events.find((e) => e.do === "enter")?.f ?? null;
  const exit = events.find((e) => e.do === "exit")?.f ?? null;
  const rp = renderPropsAt(comp.meta, prep, { id, frame, track: { events, enterF: enter, exitF: exit }, widthOverride: undefined, tl: null });
  const R = comp.Render as React.FC<typeof rp>;
  const { xf, size } = placed;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, transformOrigin: "0 0", transform: `translate(${xf.tx}px, ${xf.ty}px) scale(${xf.k})` }}>
      <R {...rp} />
    </div>
  );
};

const Probes: React.FC<{ pts: Record<string, { x: number; y: number }> }> = ({ pts }) => (
  <svg style={{ position: "absolute", left: 0, top: 0 }} width={1080} height={1920}>
    {Object.entries(pts).map(([k, p]) => <circle key={k} cx={p.x} cy={p.y} r={14} fill="none" stroke={PROBE} strokeWidth={3} />)}
  </svg>
);

export const V3Gallery: React.FC<GalleryInput> = (input) => {
  useV2Fonts();
  const frame = useCurrentFrame();
  const metaOf = (l: GalleryLayer) => V3_COMPONENTS[l.component as V3ComponentId]?.meta as unknown as AnyV3Meta | undefined;
  const bm = input.base ? metaOf(input.base) : undefined;
  const m = metaOf(input.layer);
  if (!m || (input.base && !bm)) throw new Error(`gallery: unknown component ${input.layer.component} / ${input.base?.component}`);
  const base = input.base && bm ? placeLayer(bm, input.base, ctxFor(input.base)) : null;
  const bound = base && input.bindTo ? base.screen[input.bindTo] : undefined;
  if (base && input.bindTo && !bound) throw new Error(`gallery: base has no anchor ${input.bindTo}`);
  const top = placeLayer(m, input.layer, ctxFor(input.layer), bound);
  const probes = input.probe ? (base ? { ...Object.fromEntries(Object.entries(base.screen).map(([k, v]) => [`base:${k}`, v])) } : top.screen) : {};
  return (
    <AbsoluteFill style={{ background: color.bg, overflow: "hidden" }}>
      {base && input.base ? <Layer l={input.base} placed={base} frame={frame} id="base" /> : null}
      <Layer l={input.layer} placed={top} frame={frame} id="main" />
      <AbsoluteFill style={{ background: vignetteCss, pointerEvents: "none" }} />
      {input.probe ? <Probes pts={probes} /> : null}
      {input.title ? (
        <div style={{ position: "absolute", left: layout.margin, top: 64, fontFamily: font.mono, fontSize: 26, color: color.textDim, whiteSpace: "pre" }}>{input.title}</div>
      ) : null}
    </AbsoluteFill>
  );
};
