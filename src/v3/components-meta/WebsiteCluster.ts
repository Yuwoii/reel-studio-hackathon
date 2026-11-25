// WebsiteCluster — "a big website isn't one computer" (S2 reel, owner feedback 2026-11-02: replaces S1's building /
// mailroom / server photos). Footprint 1000 × 760.
//
//   state "box" (initial): ONE website box — a rounded card with the site's name and a page glyph.
//   state "split" (16 f): the box opens into a FRONT SERVER (left, steps forward) and a row of `computers` (3–6) simple
//        drawn computers behind it, wired to the front server by short inner lines; `outline` draws a dashed line
//        around all of them with the site's name on it (one website, no intruder).
//   props: key (a key badge on the front server: it holds the website's key), meters + frontLoad / backLoad (small
//        effort meters: the front server works, the computers behind it don't have to), active (1-based computer whose
//        inner line + outline light up), check (a calm accent check next to the name: "that's normal").
//   pulse: the front server's light flashes (a box arrives).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

/** Copy of BrowserWindow.GENERIC_HOST (metas import only zod at runtime; test/v3-s2-components.test.ts checks equality). */
export const GENERIC_HOST = /^(?:[a-z0-9-]{1,20}\.)?(?:example\.(?:com|org|net)|[a-z0-9-]{1,20}\.(?:example|test))$/;

export const WC = {
  w: 1000,
  h: 760,
  outline: { x: 20, y: 70, w: 960, h: 670, r: 40 },
  name: { x: 60, y: 40, h: 60 },
  front: { x: 70, y: 220, w: 220, h: 360 },
  row: { x0: 400, x1: 950, y: 240, h: 310, maxW: 130 },
  meterH: 120,
  splitF: 16,
} as const;

export const WebsiteClusterProps = z
  .object({
    name: z.string().max(24).regex(GENERIC_HOST, "name must be a reserved generic name (example.com/.org/.net, *.example, *.test)").default("example.com"),
    computers: z.number().int().min(3).max(6).default(4),
    outline: z.boolean().default(true),
    key: z.boolean().default(true),
    meters: z.boolean().default(false),
    frontLoad: z.number().min(0).max(1).default(0.2),
    backLoad: z.number().min(0).max(1).default(0.2),
    active: z.number().int().min(0).max(6).default(0),
    check: z.boolean().default(false),
  })
  .strict()
  .refine((p) => p.active <= p.computers, "active ≤ computers");
export type WebsiteClusterPropsT = z.output<typeof WebsiteClusterProps>;

/** Box (x, y, w, h) of computer i (1-based) in the row. */
export function computerBox(i: number, n: number) {
  const span = WC.row.x1 - WC.row.x0;
  const gap = 24;
  const w = Math.min(WC.row.maxW, (span - gap * (n - 1)) / n);
  const total = n * w + (n - 1) * gap;
  const x = WC.row.x0 + (span - total) / 2 + (i - 1) * (w + gap);
  return { x, y: WC.row.y, w, h: WC.row.h };
}
export const frontOutlet = () => ({ x: WC.front.x + WC.front.w, y: WC.front.y + WC.front.h * 0.62 });
/** y of the inner bus (the short line from the front server to the row). */
export const busY = () => WC.row.y + WC.row.h + 70;

export const meta: V3MetaDef<typeof WebsiteClusterProps> = {
  name: "WebsiteCluster",
  version: 1,
  tier: "p0",
  spec: "S2 brief 2026-11-02 (front server + row of computers = one website)",
  summary: "One website box that splits into a front server (holds the key) and a row of computers inside a dashed 'one website' outline.",
  families: ["network", "security", "systems"],
  propsSchema: WebsiteClusterProps,
  propsSchemaName: "WebsiteClusterProps",
  example: { name: "example.com", computers: 4, outline: true, key: true },
  states: ["box", "split"],
  verbs: {
    enter: { durF: 12, does: "website rises in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: WC.splitF, does: "box → split: the website box opens into a front server stepping forward and a row of computers behind it", props: ["meters", "frontLoad", "backLoad", "active", "check", "outline", "key"] },
    pulse: { durF: 10, does: "the front server's light flashes (something arrives)" },
  },
  focal: true,
  footprint: () => ({ w: WC.w, h: WC.h }),
  sfx: { enter: "whoosh", state: "whoosh", pulse: "tick" },
  v3kind: "device",
  assetIds: ["website-cluster"],
  anchors: (p, _s, _c, state): AnchorMap => {
    const O = WC.outline;
    const F = WC.front;
    const a: AnchorMap = {
      website: { x: O.x + O.w / 2, y: O.y + O.h / 2, r: O.w / 2, label: "the website", physical: `${p.name}: everything that answers when you visit it` },
      name: { x: WC.name.x + 150, y: WC.name.y + WC.name.h / 2, r: 160, label: "the website's name", physical: p.name },
    };
    if (state === "box") {
      a.page = { x: O.x + O.w / 2, y: O.y + O.h / 2 + 30, r: 150, label: "the website", physical: "the website seen from outside: one box" };
      a.inlet = { x: O.x, y: F.y + F.h / 2, r: 30, label: "the way in", physical: "where what you send arrives" };
      return a;
    }
    const n = p.computers;
    a.front = { x: F.x + F.w / 2, y: F.y + F.h / 2, r: F.h / 2, label: "the front server", physical: "the website's front computer: everything you send hits it first" };
    a["front.inlet"] = { x: F.x, y: F.y + F.h / 2, r: 30, label: "the front server's door", physical: "where incoming connections arrive" };
    a["front.light"] = { x: F.x + 40, y: F.y + 36, r: 22, label: "the front server's light", physical: "flashes when something arrives" };
    if (p.key) a["front.key"] = { x: F.x + F.w / 2, y: F.y + F.h * 0.33, r: 44, label: "the website's key", physical: "the front server holds the key that opens your lock" };
    if (p.meters) a["front.meter"] = { x: F.x + F.w + 30, y: F.y + F.h - WC.meterH / 2, r: WC.meterH / 2, label: "the front server's effort", physical: "how hard it works unlocking" };
    const first = computerBox(1, n), last = computerBox(n, n);
    a.row = { x: (first.x + last.x + last.w) / 2, y: WC.row.y + WC.row.h / 2, r: (last.x + last.w - first.x) / 2, label: "the computers behind it", physical: "the website's other computers (they do the actual work)", group: Array.from({ length: n }, (_, k) => `computer${k + 1}`) };
    for (let i = 1; i <= n; i++) {
      const b = computerBox(i, n);
      a[`computer${i}`] = { x: b.x + b.w / 2, y: b.y + b.h / 2, r: b.h / 2, label: `computer ${i}`, physical: "one of the website's computers" };
      if (p.meters) a[`computer${i}.meter`] = { x: b.x + b.w / 2, y: b.y + b.h + 20, r: b.w / 2, label: `computer ${i}'s effort`, physical: "how hard it works" };
    }
    const o = frontOutlet();
    a["inner.line"] = { x: (o.x + first.x) / 2, y: busY(), r: (first.x - o.x) / 2 + 20, label: "the inner line", physical: "inside the website: from the front server to the computers behind it" };
    if (p.outline) a.outline = { x: O.x, y: O.y + O.h / 2, r: 30, label: "the website's edge", physical: "everything inside the dashed line is one website" };
    if (p.check) a.check = { x: WC.name.x + 340, y: WC.name.y + WC.name.h / 2, r: 30, label: "normal", physical: "a check: this is how it is supposed to work" };
    return a;
  },
  describe: (state, p) =>
    state === "box"
      ? `WebsiteCluster "${p.name}" as ONE box`
      : `WebsiteCluster "${p.name}": front server${p.key ? " holding the key" : ""} + ${p.computers} computers behind it${p.outline ? ", dashed outline = one website" : ""}${p.meters ? `, effort front=${Math.round(p.frontLoad * 100)}% back=${Math.round(p.backLoad * 100)}%` : ""}${p.active ? `, line to computer ${p.active} lit` : ""}${p.check ? ", calm check" : ""}`,
};
