// WatchBack — a generic smartwatch underside (illustrative layout, no real product's arrangement; D1 #2d). Promoted from
// remotion/v3lab/devices/WatchBack.tsx. 720 × 860 at the footprint origin.
//
// PPG behaviour (R1 facts review BLOCKER W02, fixed here): in state "measuring" the two green LEDs glow STEADILY with a
// fast per-frame shimmer (they really flash hundreds of times a second); only the RETURNED light — the green glow
// around the four light sensors — dips once per heartbeat at `bpm`. The LEDs never pulse at heart rate.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const WB = { w: 720, h: 860 } as const;
/** Normalised to the box (x × w, y × h, r × w) — the same layout Model3D adds as discs on the 3D watch. */
export const WB_PARTS = {
  case: { x: 0.5, y: 0.5, r: 0.46 },
  sensorWindow: { x: 0.5, y: 0.5, r: 0.3 },
  "led.left": { x: 0.44, y: 0.5, r: 0.045 },
  "led.right": { x: 0.56, y: 0.5, r: 0.045 },
  "sensor.top": { x: 0.5, y: 0.38, r: 0.05 },
  "sensor.left": { x: 0.36, y: 0.52, r: 0.05 },
  "sensor.right": { x: 0.64, y: 0.52, r: 0.05 },
  "sensor.bottom": { x: 0.5, y: 0.64, r: 0.05 },
} as const;

export const WatchBackProps = z
  .object({
    bpm: z.number().int().min(40).max(180).default(72),
    /** depth of the per-beat dip of the RETURNED light (0.15–0.5) */
    dip: z.number().min(0.15).max(0.5).default(0.35),
  })
  .strict();
export type WatchBackPropsT = z.output<typeof WatchBackProps>;

const LABELS: Record<keyof typeof WB_PARTS, [string, string]> = {
  case: ["the back of the watch", "the underside that sits on your wrist"],
  sensorWindow: ["the sensor window", "round window over the optical heart sensor"],
  "led.left": ["a green LED", "green light shines into the skin (flashes hundreds of times a second)"],
  "led.right": ["a green LED", "green light shines into the skin (flashes hundreds of times a second)"],
  "sensor.top": ["a light sensor", "photodiode: measures how much green light comes back"],
  "sensor.left": ["a light sensor", "photodiode: measures how much green light comes back"],
  "sensor.right": ["a light sensor", "photodiode: measures how much green light comes back"],
  "sensor.bottom": ["a light sensor", "photodiode: measures how much green light comes back"],
};

export const meta: V3MetaDef<typeof WatchBackProps> = {
  name: "WatchBack",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3 (device a); R1 facts review W02",
  summary: "Generic smartwatch underside: sensor window, 2 green LEDs, 4 light sensors; measuring = steady LEDs, returned light dips per beat.",
  families: ["science"],
  propsSchema: WatchBackProps,
  propsSchemaName: "WatchBackProps",
  example: { bpm: 72 },
  states: ["idle", "measuring"],
  verbs: {
    enter: { durF: 12, does: "watch back rises in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 8, does: "idle ↔ measuring (LEDs on: steady glow; returned light dips once per beat)", props: ["bpm", "dip"] },
    focus: { durF: 18, does: "brief ring flash on the sensor window" },
  },
  focal: true,
  footprint: () => ({ w: WB.w, h: WB.h }),
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["watch-back"],
  anchors: (): AnchorMap => {
    const out: AnchorMap = {};
    for (const [k, v] of Object.entries(WB_PARTS) as [keyof typeof WB_PARTS, (typeof WB_PARTS)[keyof typeof WB_PARTS]][]) {
      out[k] = { x: v.x * WB.w, y: v.y * WB.h, r: v.r * WB.w, label: LABELS[k][0], physical: LABELS[k][1] };
    }
    out.leds = { x: WB.w / 2, y: WB.h / 2, r: 0.11 * WB.w, label: "the green LEDs", physical: "both LEDs: shine green light into the skin", group: ["led.left", "led.right"] };
    return out;
  },
  continuous: (_p, state) => state === "measuring",
  describe: (state, p) =>
    state === "measuring"
      ? `WatchBack leds=steady glow (fast shimmer; real LEDs flash hundreds of times a second, NOT with the heartbeat) returnLight=dips ${Math.round(p.dip * 100)}% once per beat @${p.bpm}bpm`
      : "WatchBack leds=off returnLight=none",
};
