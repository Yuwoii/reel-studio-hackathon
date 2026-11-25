// ServerRack — a generic server rack front (new in W3a; the R3 rack was 3D/Grab3D, refused at D1). 560 × 1120:
// a frame with mounting rails and `units` (4–8) 1U-style servers, each with four drive bays, a vent and three status
// LEDs. `active` (1-based, 0 = none) outlines one server in accent. state "busy": LEDs blink (work in progress).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const SR = {
  w: 560,
  h: 1120,
  frame: { x: 20, y: 20, w: 520, h: 1080 },
  unit: { x: 60, y0: 70, w: 440, h: 110, step: 124 },
  bay: { x0: 80, dx: 62, w: 50, h: 70 },
  vent: { x0: 340, x1: 420 },
  led: { x0: 446, dx: 22, dy: 40, r: 6 },
} as const;

export const ServerRackProps = z
  .object({
    units: z.number().int().min(4).max(8).default(8),
    active: z.number().int().min(0).max(8).default(0),
  })
  .strict()
  .refine((p) => p.active <= p.units, "active ≤ units");
export type ServerRackPropsT = z.output<typeof ServerRackProps>;

export const unitY = (i: number) => SR.unit.y0 + (i - 1) * SR.unit.step;

export const meta: V3MetaDef<typeof ServerRackProps> = {
  name: "ServerRack",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3 (device a)",
  summary: "Generic server rack: 4–8 servers with drive bays and status LEDs; one can be outlined; busy = LEDs blink.",
  families: ["systems", "network", "outage"],
  propsSchema: ServerRackProps,
  propsSchemaName: "ServerRackProps",
  example: { units: 8, active: 3 },
  states: ["idle", "busy"],
  verbs: {
    enter: { durF: 12, does: "rack rises in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 4, does: "idle ↔ busy (status LEDs blink)", props: ["active"] },
    focus: { durF: 18, does: "flashes the active server outline" },
  },
  focal: true,
  footprint: () => ({ w: SR.w, h: SR.h }),
  sfx: { enter: "whoosh", state: "chatter" },
  v3kind: "device",
  assetIds: ["server-rack"],
  anchors: (p): AnchorMap => {
    const a: AnchorMap = { rack: { x: SR.w / 2, y: SR.h / 2, r: 520, label: "the server rack", physical: "a cabinet of computers (servers) in a data centre" } };
    for (let i = 1; i <= p.units; i++) {
      const y = unitY(i);
      a[`unit${i}`] = { x: SR.unit.x + SR.unit.w / 2, y: y + SR.unit.h / 2, r: 232, label: `server ${i}`, physical: "one computer in the rack" };
      a[`unit${i}.leds`] = { x: SR.led.x0 + SR.led.dx, y: y + SR.led.dy, r: 34, label: `server ${i}'s lights`, physical: "status lights: blink when the server works" };
    }
    const act = p.active || 1;
    a.leds = { ...a[`unit${act}.leds`], label: "the status lights" };
    return a;
  },
  describe: (state, p) => `ServerRack servers=${p.units}${p.active ? ` outlined=server ${p.active}` : ""} leds=${state === "busy" ? "blinking (working)" : "steady"}`,
};
