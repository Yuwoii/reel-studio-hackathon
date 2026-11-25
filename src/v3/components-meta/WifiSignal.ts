// WifiSignal — the drawn Wi-Fi stop of the trip (S2: "Wi-Fi waves, a small router, a cable run"): the familiar three
// arcs over a dot, 260 × 220. state "active": the arcs light up one after another, looping (radio traffic);
// pulse: one sweep (something hops through).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const WF = { w: 260, h: 220, cx: 130, cy: 190, r: [52, 102, 152] as const, sweepF: 18 } as const;

export const WifiSignalProps = z.object({}).strict();
export type WifiSignalPropsT = z.output<typeof WifiSignalProps>;

export const meta: V3MetaDef<typeof WifiSignalProps> = {
  name: "WifiSignal",
  version: 1,
  tier: "p0",
  spec: "S2 brief 2026-11-02 (Wi-Fi stop)",
  summary: "Wi-Fi symbol (three arcs over a dot); arcs light up in a loop when active.",
  families: ["network", "security"],
  propsSchema: WifiSignalProps,
  propsSchemaName: "WifiSignalProps",
  example: {},
  states: ["idle", "active"],
  verbs: {
    enter: { durF: 12, does: "symbol pops in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 4, does: "idle ↔ active (arcs light up in a loop)" },
    pulse: { durF: WF.sweepF, does: "one sweep of the arcs (something hops through)" },
  },
  focal: true,
  footprint: () => ({ w: WF.w, h: WF.h }),
  sfx: { enter: "tick", pulse: "tick" },
  v3kind: "device",
  assetIds: ["wifi-signal"],
  anchors: (): AnchorMap => ({
    wifi: { x: WF.cx, y: WF.cy - 70, r: 140, label: "the Wi-Fi", physical: "the wireless network your phone talks to" },
    dot: { x: WF.cx, y: WF.cy, r: 24, label: "the Wi-Fi", physical: "where the radio signal starts" },
  }),
  describe: (state) => `WifiSignal ${state === "active" ? "arcs lighting up (traffic)" : "steady"}`,
};
