// OverlayLayer (ADR-002 §4.3): screen-space overlays bound to a named part of a real object — AnchorRing, LabelPill,
// Spotlight, Glow, Trace. Drawn AFTER the world and INSIDE the motion-blur wrapper; per (sub-)frame the bound part's
// world point (+ its host's travel offset) goes through the SAME camera (src/v2/timeline cameraAt) and the SAME
// projection the lints use (src/v3/project worldToScreen), so a 3 px ring stays 3 px at a 3.2× zoom and sits on the
// part in every frame the lints judge. An overlay is hidden while its host is not live (before enter / after exit).
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { Timeline } from "../../src/v2/timeline";
import { overlayAnchorAt, type ResolvedTravel, type ScreenOverlay } from "../../src/v3/lower";
import { worldToScreen } from "../../src/v3/project";
import { prepareInstance, renderPropsAt } from "../v2/components/contract";
import { cameraAt } from "../v2/camera";
import { enterExitStyle } from "../v2/motion";
import type { InstanceTrack } from "../v2/world";
import { componentForV3, exitDurFV3 } from "./library";

export interface OverlayLayerProps {
  overlays: readonly ScreenOverlay[];
  /** tracks of the overlays AND of the world instances (host liveness) */
  tracks: Map<string, InstanceTrack>;
  travels: readonly ResolvedTravel[];
  tl: Timeline;
}

const live = (t: InstanceTrack | undefined, f: number, exitDur = 8) => !t || ((t.enterF === null || f >= t.enterF) && (t.exitF === null || f < t.exitF + exitDur));

const One: React.FC<{ o: ScreenOverlay; track: InstanceTrack; host: InstanceTrack | undefined; travels: readonly ResolvedTravel[]; tl: Timeline }> = ({ o, track, host, travels, tl }) => {
  const frame = useCurrentFrame();
  const comp = componentForV3(o.component);
  const prep = useMemo(() => (comp ? prepareInstance(comp.meta, o.props, track.events) : null), [comp, o.props, track.events]);
  if (!comp || !prep || !prep.ok) return null;
  const f = Math.floor(frame);
  if (!live(host, f)) return null;
  const self = comp.meta.enterExit === "self";
  let style: React.CSSProperties = {};
  if (self) {
    if ((track.enterF !== null && f < track.enterF) || (track.exitF !== null && f >= track.exitF + exitDurFV3(o.component))) return null;
  } else {
    const { visible, ...rest } = enterExitStyle(frame, track.enterF, track.exitF);
    if (!visible) return null;
    style = rest;
  }
  const rp = renderPropsAt(comp.meta, prep, { id: o.id, frame, track, widthOverride: undefined, tl });
  const size = rp.size;
  const own = comp.meta.anchor ? comp.meta.anchor(prep.base, undefined) : { x: size.w / 2, y: size.h / 2 };
  const c = cameraAt(tl, frame);
  const s = worldToScreen(c, overlayAnchorAt(o, travels, frame));
  const R = comp.Render as React.FC<typeof rp>;
  return (
    <div style={{ position: "absolute", left: s.x + o.dx - own.x, top: s.y + o.dy - own.y, width: size.w, height: size.h, ...style }}>
      <R {...rp} />
    </div>
  );
};

export const OverlayLayer: React.FC<OverlayLayerProps> = ({ overlays, tracks, travels, tl }) => {
  const order = [...overlays].map((o, i) => ({ o, i })).sort((a, b) => a.o.z - b.o.z || a.i - b.i);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {order.map(({ o }) => (
        <One key={o.id} o={o} track={tracks.get(o.id)!} host={tracks.get(o.to.instance)} travels={travels} tl={tl} />
      ))}
    </AbsoluteFill>
  );
};
