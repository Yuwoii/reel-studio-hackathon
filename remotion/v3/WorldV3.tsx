// <WorldV3>: the v2 <World> (remotion/v2/layers/World.tsx) for lowered v3 boards — ONE world under the one v2 camera —
// plus: the v3 slot (real objects, plates, 3D), `travel` offsets (a prop flying along anchors, src/v3/lower.ts
// travelOffset) and no data field when the board says datafield "none" (a real object fills the stage).
// Evaluated per motion-blur sub-sample (fractional useCurrentFrame inside WeightedMotionBlur's Freeze).
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { Storyboard } from "../../src/schema/storyboard.v2";
import type { Timeline } from "../../src/v2/timeline";
import { travelOffset, type ResolvedTravel } from "../../src/v3/lower";
import { cameraAt, cameraTransform, tiltTransform, visibleWorldRect } from "../v2/camera";
import { enterExitStyle } from "../v2/motion";
import { layout } from "../v2/theme";
import type { InstanceTrack } from "../v2/world";
import { DataField, type FieldGeometry } from "../v2/layers/DataField";
import type { PresetId } from "../v2/layers/fieldPresets";
import { exitDurFV3, ownsEnterExitV3 } from "./library";
import { SlotV3 } from "./SlotV3";

export interface WorldV3Props {
  sb: Storyboard;
  tl: Timeline;
  tracks: Map<string, InstanceTrack>;
  travels: readonly ResolvedTravel[];
  field: { preset: PresetId; seed: string; geometry: FieldGeometry; marks: readonly import("../v2/world").FieldMark[] } | null;
}

const Instances: React.FC<WorldV3Props & { view: { x0: number; x1: number; y0: number; y1: number } }> = ({ sb, tl, tracks, travels, view }) => {
  const frame = useCurrentFrame();
  const order = sb.world.map((inst, i) => ({ inst, i })).sort((a, b) => a.inst.z - b.inst.z || a.i - b.i);
  return (
    <>
      {order.map(({ inst }) => {
        const track = tracks.get(inst.id)!;
        const b0 = track.box ?? { x: inst.x, y: inst.y, w: (inst.w ?? 600) * inst.scale, h: 160 * inst.scale };
        const d = travelOffset(travels, inst.id, frame);
        const box = { x: b0.x + d.x, y: b0.y + d.y, w: b0.w, h: b0.h };
        if (box.x > view.x1 || box.x + box.w < view.x0 || box.y > view.y1 || box.y + box.h < view.y0) return null;
        let style: React.CSSProperties = {};
        if (ownsEnterExitV3(inst.component)) {
          const f = Math.floor(frame);
          if ((track.enterF !== null && f < track.enterF) || (track.exitF !== null && f >= track.exitF + exitDurFV3(inst.component))) return null;
        } else {
          const { visible, ...rest } = enterExitStyle(frame, track.enterF, track.exitF);
          if (!visible) return null;
          style = rest;
        }
        const size = { w: box.w / inst.scale, h: box.h / inst.scale };
        return (
          <div key={inst.id} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, transformOrigin: "50% 50%", ...style }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, transformOrigin: "0 0", transform: inst.scale !== 1 ? `scale(${inst.scale})` : undefined }}>
              <SlotV3 inst={inst} track={{ ...track, box }} size={size} tl={tl} />
            </div>
          </div>
        );
      })}
    </>
  );
};

export const WorldV3: React.FC<WorldV3Props> = (props) => {
  const frame = useCurrentFrame();
  const c = cameraAt(props.tl, frame);
  const view = visibleWorldRect(c, 0, layout.footer.top, 80);
  const tilt = tiltTransform(c);
  const f = props.field;
  const plane = (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, transformOrigin: "0 0", transform: cameraTransform(c) }}>
      {f ? <DataField tl={props.tl} preset={f.preset} seed={f.seed} geometry={f.geometry} marks={f.marks} /> : null}
      <Instances {...props} view={view} />
    </div>
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {tilt ? <AbsoluteFill style={{ transform: tilt, transformOrigin: `${layout.stage.cx}px ${layout.stage.cy}px` }}>{plane}</AbsoluteFill> : plane}
    </AbsoluteFill>
  );
};
