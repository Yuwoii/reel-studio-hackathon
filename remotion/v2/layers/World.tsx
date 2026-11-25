// <World> + <Camera> (amendments §4): ONE world in absolute world px under one keyframed camera. Everything here is
// evaluated per motion-blur sub-sample (useCurrentFrame is fractional inside WeightedMotionBlur's Freeze).
// Instances are culled when invisible (before enter / after exit) or outside the viewport, which keeps blurred frames
// cheap; the data field renders only its visible rows itself. Each instance renders through the library Slot
// (components/Slot.tsx): the shipped component for its id, or PlaceholderCard for planned ids.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { Storyboard } from "../../../src/schema/storyboard.v2";
import type { Timeline } from "../../../src/v2/timeline";
import { cameraAt, cameraTransform, tiltTransform, visibleWorldRect } from "../camera";
import { exitDurF, ownsEnterExit, Slot } from "../components/Slot";
import { enterExitStyle } from "../motion";
import { layout } from "../theme";
import type { FieldMark, InstanceTrack } from "../world";
import { DataField, type FieldGeometry } from "./DataField";
import type { PresetId } from "./fieldPresets";

export interface WorldProps {
  sb: Storyboard;
  tl: Timeline;
  tracks: Map<string, InstanceTrack>;
  field: { preset: PresetId; seed: string; geometry: FieldGeometry; marks: readonly FieldMark[] };
}

const Instances: React.FC<WorldProps & { view: { x0: number; x1: number; y0: number; y1: number } }> = ({ sb, tl, tracks, view }) => {
  const frame = useCurrentFrame();
  const order = sb.world.map((inst, i) => ({ inst, i })).sort((a, b) => a.inst.z - b.inst.z || a.i - b.i);
  return (
    <>
      {order.map(({ inst }) => {
        const track = tracks.get(inst.id)!;
        const box = track.box ?? { x: inst.x, y: inst.y, w: (inst.w ?? 600) * inst.scale, h: 160 * inst.scale };
        if (box.x > view.x1 || box.x + box.w < view.x0 || box.y > view.y1 || box.y + box.h < view.y0) return null;
        // shared entrance/exit around the slot, unless the component animates its own (meta.enterExit "self")
        let style: React.CSSProperties = {};
        if (ownsEnterExit(inst.component)) {
          const f = Math.floor(frame);
          if ((track.enterF !== null && f < track.enterF) || (track.exitF !== null && f >= track.exitF + exitDurF(inst.component))) return null;
        } else {
          const { visible, ...rest } = enterExitStyle(frame, track.enterF, track.exitF);
          if (!visible) return null;
          style = rest;
        }
        const size = { w: box.w / inst.scale, h: box.h / inst.scale };
        return (
          <div key={inst.id} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, transformOrigin: "50% 50%", ...style }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, transformOrigin: "0 0", transform: inst.scale !== 1 ? `scale(${inst.scale})` : undefined }}>
              <Slot inst={inst} track={track} size={size} tl={tl} />
            </div>
          </div>
        );
      })}
    </>
  );
};

export const World: React.FC<WorldProps> = (props) => {
  const frame = useCurrentFrame();
  const c = cameraAt(props.tl, frame);
  const view = visibleWorldRect(c, 0, layout.footer.top, 80);
  const tilt = tiltTransform(c);
  const plane = (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, transformOrigin: "0 0", transform: cameraTransform(c) }}>
      <DataField tl={props.tl} preset={props.field.preset} seed={props.field.seed} geometry={props.field.geometry} marks={props.field.marks} />
      <Instances {...props} view={view} />
    </div>
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {tilt ? <AbsoluteFill style={{ transform: tilt, transformOrigin: `${layout.stage.cx}px ${layout.stage.cy}px` }}>{plane}</AbsoluteFill> : plane}
    </AbsoluteFill>
  );
};
