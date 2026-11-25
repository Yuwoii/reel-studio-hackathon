// Router — a generic home Wi-Fi router (two antennas, four status LEDs, a cable port), 560 × 300. Promoted from
// remotion/v3lab/hook/devices.tsx (Router). state "active": the status LEDs blink accent (traffic passing).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const RT = {
  w: 560,
  h: 300,
  body: { x: 20, y: 140, w: 520, h: 150 },
  antL: { x0: 110, y0: 140, x1: 80, y1: 20 },
  antR: { x0: 450, y0: 140, x1: 480, y1: 20 },
  led: { x0: 130, dx: 70, y: 215, r: 12, n: 4 },
  port: { x: 390, y: 207, w: 90, h: 16 },
} as const;

/** led.a … led.d, left to right (anchor names need a letter after the dot). */
export const LED_IDS = ["a", "b", "c", "d"] as const;

export const RouterProps = z.object({}).strict();
export type RouterPropsT = z.output<typeof RouterProps>;

export const meta: V3MetaDef<typeof RouterProps> = {
  name: "Router",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3 (device a)",
  summary: "Generic home Wi-Fi router: two antennas, four status LEDs (blink when active), a cable port.",
  families: ["network", "security"],
  propsSchema: RouterProps,
  propsSchemaName: "RouterProps",
  example: {},
  states: ["idle", "active"],
  verbs: {
    enter: { durF: 12, does: "router rises in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 4, does: "idle ↔ active (status LEDs blink accent)" },
    pulse: { durF: 10, does: "one LED flash (a packet passes)" },
  },
  focal: true,
  footprint: () => ({ w: RT.w, h: RT.h }),
  sfx: { enter: "whoosh", state: "tick", pulse: "tick" },
  v3kind: "device",
  assetIds: ["router"],
  anchors: (): AnchorMap => ({
    body: { x: RT.body.x + RT.body.w / 2, y: RT.body.y + RT.body.h / 2, r: 270, label: "the router", physical: "the home Wi-Fi box" },
    "antenna.left": { x: RT.antL.x1, y: RT.antL.y1, r: 26, label: "an antenna", physical: "sends and receives the Wi-Fi radio signal" },
    "antenna.right": { x: RT.antR.x1, y: RT.antR.y1, r: 26, label: "an antenna", physical: "sends and receives the Wi-Fi radio signal" },
    ...Object.fromEntries(Array.from({ length: RT.led.n }, (_, i) => [`led.${LED_IDS[i]}`, { x: RT.led.x0 + i * RT.led.dx, y: RT.led.y, r: RT.led.r + 8, label: "a status light", physical: "one status LED: blinks when data passes through" }])),
    // group: the centre falls between LED 2 and 3; r encloses all four (half the row + one LED + margin)
    leds: { x: RT.led.x0 + (RT.led.dx * (RT.led.n - 1)) / 2, y: RT.led.y, r: (RT.led.dx * (RT.led.n - 1)) / 2 + RT.led.r + 14, label: "the status lights", physical: "blink when data passes through", group: Array.from({ length: RT.led.n }, (_, i) => `led.${LED_IDS[i]}`) },
    port: { x: RT.port.x + RT.port.w / 2, y: RT.port.y + RT.port.h / 2, r: 56, label: "the cable port", physical: "where the line to the internet plugs in" },
  }),
  describe: (state) => `Router leds=${state === "active" ? "blinking (traffic)" : "steady dim"}`,
};
