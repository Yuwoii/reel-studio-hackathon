// Building — a generic office building (the "company" in the TLS analogy), 760 × 880. Promoted from
// remotion/v3lab/hook/devices.tsx (Building) and re-laid at the footprint origin. Named parts: the front door (where
// the sealed letter is opened = TLS termination) and the mailroom just inside it.
//   state "door": the front door lights accent; "mailroom": door + the mailroom window lit (letters sorted inside).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const BD = {
  w: 760,
  h: 880,
  roof: { x: 30, y: 34, w: 700, h: 30 },
  body: { x: 60, y: 60, w: 640, h: 760 },
  win: { x0: 130, dx: 135, y0: 130, dy: 115, w: 90, h: 72 },
  door: { x: 300, y: 600, w: 160, h: 220 },
  mailroom: { x: 100, y: 620, w: 160, h: 110 },
  side: { x: 500, y: 620, w: 160, h: 110 },
  groundY: 820,
} as const;

export const BuildingProps = z.object({}).strict();
export type BuildingPropsT = z.output<typeof BuildingProps>;

export const meta: V3MetaDef<typeof BuildingProps> = {
  name: "Building",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3 (device a); R1 TLS analogy (front door / mailroom)",
  summary: "Generic office building: window grid, a front door that lights up, a mailroom window just inside.",
  families: ["security", "network", "systems"],
  propsSchema: BuildingProps,
  propsSchemaName: "BuildingProps",
  example: {},
  states: ["idle", "door", "mailroom"],
  verbs: {
    enter: { durF: 12, does: "building rises in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 10, does: "idle → door (front door lit) → mailroom (mailroom window lit too)" },
  },
  focal: true,
  footprint: () => ({ w: BD.w, h: BD.h }),
  sfx: { enter: "whoosh", state: "thud" },
  v3kind: "device",
  assetIds: ["building"],
  anchors: (): AnchorMap => ({
    building: { x: BD.body.x + BD.body.w / 2, y: BD.body.y + BD.body.h / 2, r: 400, label: "the company building", physical: "the website's company (its servers live inside)" },
    frontDoor: { x: BD.door.x + BD.door.w / 2, y: BD.door.y + BD.door.h / 2, r: 95, label: "the front door", physical: "where traffic enters the company: the load balancer / proxy" },
    mailroom: { x: BD.mailroom.x + BD.mailroom.w / 2, y: BD.mailroom.y + BD.mailroom.h / 2, r: 90, label: "the mailroom", physical: "just inside the door: opened letters are sorted to the right desk" },
    offices: { x: BD.body.x + BD.body.w / 2, y: BD.win.y0 + 1.5 * BD.win.dy + BD.win.h / 2, r: 260, label: "the offices inside", physical: "the computers that do the work (the servers)" },
    roof: { x: BD.roof.x + BD.roof.w / 2, y: BD.roof.y + BD.roof.h / 2, r: 60, label: "the roof", physical: "top of the building" },
  }),
  describe: (state) => `Building door=${state === "idle" ? "closed" : "lit"} mailroom=${state === "mailroom" ? "lit (sorting inside)" : "dark"}`,
};
