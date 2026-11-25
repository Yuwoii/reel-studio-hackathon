// LeafSection — a drawn cross-section of a leaf (or a cactus stem) with one pore on the underside (2026-11-10 concept
// device, after rs-20261110-61f00b "explain plants, c3/c4 etc CAM plants": v3 had no plant picture, so the director put
// padlocks in for the pores and every board was refused). 900 × 1040. Illustrative layout, not to scale.
//
//   ☀ / ☾                                  sky badge (light / night), top right
//   ═══════════ top skin ════════════      epidermis + waxy cuticle
//   ▯▯▯▯▯▯▯▯ tall cells ▯▯▯▯▯▯▯▯▯          c3 / cam: tall green cells (where the sugar is made; cam: they store the acid)
//    ○  ○   ○  spongy cells  ○   ○         loose cells around air spaces, a small vein
//   ═══════════ under skin ═══╡ ╞════      the pore (stoma) between two guard cells: open / narrow / shut
//        CO₂ ↑      ↓ water vapour         outside air: carbon dioxide drifts in, water vapour drifts out
//
//   c4: the inside is a ring layout around the vein: OUTER cells grab the carbon dioxide and hand it (as a 4-carbon
//   acid, orange) to the INNER ring round the vein, where the sugar is made — the two-step handoff.
//
// States (initial = props.start): open · narrow (half open) · shut · night · day. night/day set the sky AND the pore the
// way the pathway does it: cam opens at night and shuts by day; c3/c4 shut at night and open by day. Every change
// blends over 12 f. One pure model (simAt) gives the pore, the sky, the carbon dioxide inside, the cam store and the
// sugar rate, so the renderer, describe and the tests read the same numbers.
// Same bundle-safety rules as every meta: runtime import of `zod` only.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const LEAF = {
  w: 900,
  h: 1040,
  sky: { x: 812, y: 52, r: 30 },
  cuticle: 104,
  topSkin: [110, 150] as const,
  underSkin: [770, 810] as const,
  pore: { x: 450, y: 790 },
  airPocket: { x: 450, y: 732, r: 38 },
  /** c3 / cam tall cells: x0, width, y0, y1 */
  palisade: { n: 8, x0: 44, cw: 92, gap: 10, y0: 162, y1: 420 },
  /** spongy cells (x, y, rx, ry) */
  spongy: [
    [92, 500, 50, 38], [220, 478, 46, 34], [330, 540, 42, 36], [600, 520, 48, 36], [720, 486, 44, 34], [820, 540, 40, 34],
    [130, 640, 46, 36], [262, 664, 44, 32], [640, 660, 46, 34], [780, 650, 44, 36], [380, 650, 36, 30], [520, 640, 34, 30],
  ] as const,
  vein: { x: 450, y: 560, r: 48 },
  /** c4 ring layout */
  c4: { cx: 450, cy: 460, vein: 66, innerR: 138, innerN: 10, innerCell: 44, outerR: 252, outerN: 14, outerCell: 50 },
  /** outside air */
  air: [810, 1040] as const,
  blendF: 12,
} as const;

export const LEAF_STATES = ["open", "narrow", "shut", "night", "day"] as const;
export type LeafState = (typeof LEAF_STATES)[number];
export const PATHWAYS = ["c3", "c4", "cam"] as const;
export type Pathway = (typeof PATHWAYS)[number];

export const LeafSectionProps = z
  .object({
    pathway: z.enum(PATHWAYS).default("c3"),
    /** state at frame 0 (no ramp) */
    start: z.enum(LEAF_STATES).default("open"),
    /** hot, dry air pulls more water vapour out of an open pore (more drops) */
    heat: z.enum(["mild", "hot"]).default("mild"),
    /** draw the sky badge (sun / moon) */
    sky: z.boolean().default(true),
  })
  .strict();
export type LeafSectionPropsT = z.output<typeof LeafSectionProps>;

// ── pure model ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pore openness (1 open, 0.4 narrow, 0 shut) and night (0 day … 1 night) a state stands for, per pathway. */
export function stateTarget(state: string, pathway: Pathway, cur: { pore: number; night: number }): { pore: number; night: number } {
  switch (state) {
    case "open": return { pore: 1, night: cur.night };
    case "narrow": return { pore: 0.4, night: cur.night };
    case "shut": return { pore: 0, night: cur.night };
    case "night": return { pore: pathway === "cam" ? 1 : 0, night: 1 };
    case "day": return { pore: pathway === "cam" ? 0 : 1, night: 0 };
    default: return cur;
  }
}
const isLeafState = (s: string | undefined): s is LeafState => !!s && (LEAF_STATES as readonly string[]).includes(s);
export interface LeafEvent {
  f: number;
  do: string;
  state?: string;
}
const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Pore + night at frame f (fractional ok) from the initial state and the state events (12 f blends). */
export function modeAt(pathway: Pathway, initial: string, events: readonly LeafEvent[], f: number): { pore: number; night: number } {
  let cur = stateTarget(isLeafState(initial) ? initial : "open", pathway, { pore: 1, night: 0 });
  for (const e of events) {
    if (e.f > f) break;
    if (e.do !== "state" || !isLeafState(e.state)) continue;
    const to = stateTarget(e.state, pathway, cur);
    const k = smooth((f - e.f) / LEAF.blendF);
    cur = { pore: cur.pore + (to.pore - cur.pore) * k, night: cur.night + (to.night - cur.night) * k };
  }
  return cur;
}

export interface LeafSim {
  pore: number;
  night: number;
  /** carbon dioxide inside the leaf, 0..1 (air spaces) */
  co2: number;
  /** cam: acid stored in the cells, 0..1 */
  store: number;
  /** sugar being made, 0..1 (needs light and carbon dioxide where the sugar is made) */
  sugar: number;
  /** c4: the outer → inner handoff running, 0..1 */
  pump: number;
  /** water vapour leaving, 0..1 */
  water: number;
}

/** Steady-state start values for the initial state (a leaf that has been open for a while is full of CO₂). */
function startSim(p: Pick<LeafSectionPropsT, "pathway" | "start">): { co2: number; store: number } {
  const m = stateTarget(p.start, p.pathway, { pore: 1, night: 0 });
  const light = 1 - m.night;
  const co2 = co2Target(p.pathway, m.pore, light, 0);
  const store = p.pathway === "cam" ? (m.night > 0.5 ? 0.5 : 0) : 0;
  return { co2, store };
}
function co2Target(pathway: Pathway, pore: number, light: number, store: number): number {
  // open pore: air inside close to outside; shut: the cells use up what is left (in light), a little stays in the dark
  const fromAir = 0.12 + 0.88 * Math.min(1, pore * 1.15);
  const used = light > 0.5 ? fromAir : Math.max(fromAir, 0.35);
  if (pathway === "cam" && light > 0.5 && store > 0.05) return Math.max(used, 0.85); // the stored acid gives it back
  return used;
}

const SIM = new Map<string, { co2: number[]; store: number[] }>();
/** Integrated values (co2 inside, cam store) per whole frame, cached per (props, events). */
function series(p: Pick<LeafSectionPropsT, "pathway" | "start">, events: readonly LeafEvent[], upTo: number) {
  const key = `${p.pathway}|${p.start}|${events.filter((e) => e.do === "state").map((e) => `${e.f}:${e.state}`).join(",")}`;
  let s = SIM.get(key);
  if (!s) {
    const st = startSim(p);
    s = { co2: [st.co2], store: [st.store] };
    SIM.set(key, s);
    if (SIM.size > 200) SIM.delete(SIM.keys().next().value as string);
  }
  for (let f = s.co2.length; f <= upTo; f++) {
    const m = modeAt(p.pathway, p.start, events, f);
    const light = 1 - m.night;
    let store = s.store[f - 1];
    if (p.pathway === "cam") {
      if (m.night > 0.5 && m.pore > 0.3) store = Math.min(1, store + 1 / 75); // night: carbon dioxide in, kept as acid
      else if (light > 0.5) store = Math.max(0, store - 1 / 150); // day: given back for the sugar
    }
    const target = co2Target(p.pathway, m.pore, light, store);
    const co2 = s.co2[f - 1] + (target - s.co2[f - 1]) / 22;
    s.co2.push(co2);
    s.store.push(store);
  }
  return s;
}

/** Everything the picture shows at frame f. */
export function simAt(p: Pick<LeafSectionPropsT, "pathway" | "start" | "heat">, events: readonly LeafEvent[], frame: number): LeafSim {
  const f = Math.max(0, Math.floor(frame));
  const s = series(p, events, f);
  const m = modeAt(p.pathway, p.start, events, frame);
  const light = 1 - m.night;
  const co2 = s.co2[f];
  const store = s.store[f];
  // c3 / cam: Rubisco in the green cells gets the air's CO₂; c4: the outer cells' pump keeps the inner ring rich
  const pump = p.pathway === "c4" ? light * Math.min(1, co2 * 2.6) : 0;
  const where = p.pathway === "c4" ? pump : p.pathway === "cam" ? Math.max(co2, store > 0.05 ? 1 : 0) : co2;
  const sugar = light > 0.5 ? smooth((where - 0.15) / 0.75) * light : 0;
  const water = m.pore * (p.heat === "hot" ? 1 : 0.6) * (m.night > 0.5 ? 0.45 : 1);
  return { pore: m.pore, night: m.night, co2, store, sugar, pump, water };
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function palisadeCells(): { x: number; y: number; w: number; h: number }[] {
  const P = LEAF.palisade;
  return Array.from({ length: P.n }, (_, i) => ({ x: P.x0 + i * (P.cw + P.gap), y: P.y0, w: P.cw, h: P.y1 - P.y0 }));
}
export function ringCells(which: "inner" | "outer"): { x: number; y: number; r: number }[] {
  const C = LEAF.c4;
  const n = which === "inner" ? C.innerN : C.outerN;
  const R = which === "inner" ? C.innerR : C.outerR;
  const r = which === "inner" ? C.innerCell : C.outerCell;
  const off = which === "inner" ? 0 : Math.PI / n;
  return Array.from({ length: n }, (_, i) => {
    const a = off + (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: C.cx + R * Math.cos(a), y: C.cy + R * Math.sin(a), r };
  });
}
/** Half-width of the pore slit (px) at openness o. */
export const poreHalf = (o: number) => 2 + 15 * o;
/** Guard-cell centre offset from the pore centre (px): the cells bow apart as the pore opens. */
export const guardOffset = (o: number) => 30 + 15 * o;

const what = (p: LeafSectionPropsT) => (p.pathway === "cam" ? "cactus stem" : "leaf");

function stateLine(state: string, p: LeafSectionPropsT): string {
  const m = stateTarget(state, p.pathway, stateTarget(p.start, p.pathway, { pore: 1, night: 0 }));
  const pore = m.pore >= 0.99 ? "OPEN" : m.pore > 0.05 ? "HALF OPEN (narrow)" : "SHUT";
  const sky = state === "night" ? "NIGHT (moon, dark)" : state === "day" ? "DAY (sun, light)" : null;
  return `${sky ? `${sky}; ` : ""}pore ${pore}`;
}

export const meta: V3MetaDef<typeof LeafSectionProps> = {
  name: "LeafSection",
  version: 1,
  tier: "p0",
  spec: "2026-11-10 concept device (rs-20261110-61f00b plants C3 / C4 / CAM: pores, carbon dioxide in, water out, the two-step handoff, the night store)",
  summary:
    "Leaf (or cactus stem) cut open, one pore (stoma) between two guard cells on the underside: carbon dioxide drifts in and water vapour drifts out while the pore is open (more water when hot); pathway c3 = tall green cells make sugar from the carbon dioxide inside (pore shut → the carbon dioxide inside runs low, sugar stops); c4 = ring layout: outer cells grab the carbon dioxide and hand it inward (orange 4-carbon acid) to the inner ring round the vein where the sugar is made, so it keeps going with a narrow pore; cam = night: pore open, carbon dioxide stored as acid in the cells (purple fills up); day: pore shut, the store gives it back and sugar is made. States open / narrow / shut / night / day.",
  families: ["science"],
  propsSchema: LeafSectionProps,
  propsSchemaName: "LeafSectionProps",
  example: { pathway: "c4", start: "open", heat: "hot" },
  states: [...LEAF_STATES],
  initialState: (p) => p.start,
  verbs: {
    enter: { durF: 12, does: "the cross-section rises in (the start state already drawn, gases already flowing)" },
    exit: { durF: 8, does: "fades out" },
    state: {
      durF: LEAF.blendF,
      does: "open · narrow (half open) · shut: the guard cells bow apart / close the pore (12 f), the gas flows follow; night / day: the sky turns and the pore does what the pathway does (cam opens at night, c3/c4 shut); the carbon dioxide inside and the cam store change over the next seconds",
      props: ["heat"],
    },
    pulse: { durF: 10, does: "a bright ping on the pore" },
    focus: { durF: 18, does: "ring flash on the cells where the sugar is made" },
  },
  focal: true,
  footprint: () => ({ w: LEAF.w, h: LEAF.h }),
  sfx: { enter: "whoosh", state: "tick" },
  v3kind: "device",
  assetIds: ["leaf-section"],
  anchors: (p): AnchorMap => {
    const thing = what(p);
    const C = LEAF.c4;
    const out: AnchorMap = {
      leaf: { x: LEAF.w / 2, y: (LEAF.cuticle + LEAF.underSkin[1]) / 2, r: 440, label: `the ${thing}, cut open`, physical: `a ${thing} cut through to show the cells inside (illustration, not to scale)` },
      pore: { x: LEAF.pore.x, y: LEAF.pore.y, r: 60, label: "a pore (stoma)", physical: "a tiny opening on the underside: carbon dioxide gets in and water vapour gets out through it" },
      guards: { x: LEAF.pore.x, y: LEAF.pore.y, r: 90, label: "the guard cells", physical: "two cells either side of the pore that open and close it" },
      inside: { x: LEAF.airPocket.x, y: LEAF.airPocket.y, r: 50, label: "the air inside", physical: "the air space just inside the pore" },
      "co2.in": { x: 300, y: 930, r: 80, label: "carbon dioxide coming in", physical: "carbon dioxide from the air, drifting in through the pore" },
      "water.out": { x: 610, y: 930, r: 80, label: "water vapour going out", physical: "water vapour leaving through the same pore" },
      skin: { x: LEAF.w / 2, y: LEAF.topSkin[0] + 10, r: 420, box: { x0: 0, y0: LEAF.cuticle, x1: LEAF.w, y1: LEAF.topSkin[1] }, label: "the waxy skin", physical: "the top skin with its waxy layer (keeps water in)" },
    };
    if (p.pathway === "c4") {
      out.outer = { x: C.cx, y: C.cy, r: C.outerR + C.outerCell, label: "the outer cells", physical: "they grab the carbon dioxide first and pass it inward", group: ["outer.cell"] };
      const o = ringCells("outer")[3];
      out["outer.cell"] = { x: o.x, y: o.y, r: o.r, label: "an outer cell", physical: "grabs carbon dioxide and passes it inward as a 4-carbon acid" };
      out.inner = { x: C.cx, y: C.cy, r: C.innerR + C.innerCell, label: "the inner cells", physical: "the ring round the vein where the carbon dioxide is handed over and the sugar is made", group: ["inner.cell"] };
      const i = ringCells("inner")[2];
      out["inner.cell"] = { x: i.x, y: i.y, r: i.r, label: "an inner cell", physical: "gets the carbon dioxide handed in and makes the sugar" };
      out.vein = { x: C.cx, y: C.cy, r: C.vein, label: "the vein", physical: "carries water in and the sugar away" };
      out.handoff = { x: (o.x + C.cx) / 2, y: (o.y + C.cy) / 2, r: 70, label: "the handoff", physical: "the outer cells passing the carbon dioxide inward (as a 4-carbon acid)" };
      out.sugar = { x: C.cx, y: C.cy, r: C.innerR + C.innerCell, label: "where the sugar is made", physical: "the inner ring round the vein" };
    } else {
      const P = LEAF.palisade;
      out.cells = { x: LEAF.w / 2, y: (P.y0 + P.y1) / 2, r: 420, box: { x0: P.x0, y0: P.y0, x1: P.x0 + P.n * (P.cw + P.gap) - P.gap, y1: P.y1 }, label: "the green cells", physical: p.pathway === "cam" ? "they store the carbon dioxide as acid at night and make sugar from it by day" : "they make sugar from the carbon dioxide inside", group: ["cell"] };
      const c = palisadeCells()[4];
      out.cell = { x: c.x + c.w / 2, y: c.y + c.h / 2, r: c.h / 2, box: { x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }, label: "a green cell", physical: "one of the cells that make the sugar" };
      out.sugar = { ...out.cells, group: undefined, label: "where the sugar is made", physical: "the tall green cells" };
      out.vein = { x: LEAF.vein.x, y: LEAF.vein.y, r: LEAF.vein.r, label: "a vein", physical: "carries water in and the sugar away" };
      if (p.pathway === "cam") out.store = { ...out.cells, group: undefined, label: "the night store", physical: "carbon dioxide kept in the cells as an acid overnight (purple), given back by day" };
    }
    if (p.sky) out.sky = { x: LEAF.sky.x, y: LEAF.sky.y, r: 44, label: "day or night", physical: "the sun by day, the moon at night" };
    return out;
  },
  continuous: () => true,
  whenToUse: { text: "a line about a plant's pores (stomata), carbon dioxide getting into a leaf, water escaping, C3 / C4 / CAM photosynthesis, or a cactus breathing at night", words: ["pore", "stoma", "leaf", "leaves", "photosynth", "cactus", "cacti"] },
  describe: (state, p) => {
    const thing = what(p);
    const s = stateLine(state, p);
    const base = `LeafSection ${p.pathway.toUpperCase()} ${thing} cut open, ${s}`;
    const open = !/SHUT/.test(s);
    const flow = open ? `; carbon dioxide drifts IN through the pore and water vapour drifts OUT${p.heat === "hot" ? " (hot: lots of water)" : ""}` : "; nothing goes in or out (the carbon dioxide inside runs low over a few seconds in light)";
    if (p.pathway === "c4") return `${base}${flow}; outer cells grab the carbon dioxide and hand it (orange 4-carbon acid) to the inner ring round the vein, where sugar is made${state === "narrow" ? " — still at full speed with the pore half open" : ""}`;
    if (p.pathway === "cam") {
      if (state === "night") return `${base}${flow} (less at night); the carbon dioxide is stored in the cells as acid (purple fills up), no sugar in the dark`;
      if (state === "day") return `${base}${flow}; the stored acid gives the carbon dioxide back (purple drains) and the cells make sugar`;
      return `${base}${flow}`;
    }
    return `${base}${flow}; the tall green cells make sugar while there is carbon dioxide inside and light`;
  },
};
