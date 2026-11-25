// Slot contract between the Explainer and library components (W2 implements real components against it).
import type { InstanceT } from "../../../src/schema/storyboard.v2";
import type { Timeline } from "../../../src/v2/timeline";
import type { InstanceTrack } from "../world";

export interface SlotProps {
  inst: InstanceT;
  /** Resolved actions for this instance (enter/exit/state/pulse/… frames) + its world box. */
  track: InstanceTrack;
  /** Unscaled layout size (footprint at the instance width); the slot wrapper applies inst.scale. */
  size: { w: number; h: number };
  tl: Timeline;
}
