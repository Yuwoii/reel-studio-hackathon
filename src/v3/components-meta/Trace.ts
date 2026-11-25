// Trace — a path that draws on from a bound anchor through up to 6 waypoints (dx, dy relative to the anchor, screen px)
// with an optional travelling dot and arrow head: light going into the skin and back, a cable route, a request hop.
//   style "light" = green light (physically green only), "data" = accent, "dim" = textDim.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const TRACE = { pad: 24, drawF: 20, stroke: 5, dotR: 9, loopF: 45 } as const;
export const TraceProps = z
  .object({
    pts: z.array(z.object({ dx: z.number().min(-900).max(900), dy: z.number().min(-1400).max(1400) }).strict()).min(1).max(6),
    style: z.enum(["light", "data", "dim"]).default("data"),
    arrow: z.boolean().default(true),
    dot: z.boolean().default(false),
  })
  .strict();
export type TracePropsT = z.output<typeof TraceProps>;

export function traceGeom(p: Pick<TracePropsT, "pts">) {
  const xs = [0, ...p.pts.map((q) => q.dx)], ys = [0, ...p.pts.map((q) => q.dy)];
  const minX = Math.min(...xs) - TRACE.pad, minY = Math.min(...ys) - TRACE.pad;
  const w = Math.max(...xs) + TRACE.pad - minX, h = Math.max(...ys) + TRACE.pad - minY;
  const pts = [{ x: -minX, y: -minY }, ...p.pts.map((q) => ({ x: q.dx - minX, y: q.dy - minY }))];
  return { w, h, ax: -minX, ay: -minY, pts };
}

export const meta: V3MetaDef<typeof TraceProps> = {
  name: "Trace",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §4.3 overlays",
  summary: "A path drawn from a named part through waypoints (light into skin and back, a cable route), optional moving dot.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: TraceProps,
  propsSchemaName: "TraceProps",
  example: { pts: [{ dx: 0, dy: 120 }, { dx: 80, dy: 120 }, { dx: 80, dy: 0 }], style: "light" },
  states: [],
  verbs: { enter: { durF: TRACE.drawF, does: "path draws on" }, exit: { durF: 8, does: "fades" } },
  focal: false,
  footprint: (p) => {
    const g = traceGeom(p);
    return { w: g.w, h: g.h };
  },
  anchor: (p) => {
    const g = traceGeom(p);
    return { x: g.ax, y: g.ay };
  },
  sfx: { enter: "whoosh" },
  enterExit: "self",
  v3kind: "overlay",
  anchors: (p): AnchorMap => {
    const g = traceGeom(p);
    const e = g.pts[g.pts.length - 1];
    return { start: { x: g.ax, y: g.ay, r: 12, label: "trace start", physical: "sits on the bound anchor" }, end: { x: e.x, y: e.y, r: 12, label: "trace end", physical: "where the path arrives" } };
  },
  describe: (_s, p) => `TRACE ${p.style === "light" ? "green light path" : p.style} ${p.pts.length} legs${p.dot ? " with moving dot" : ""}`,
};
