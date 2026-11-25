// LayerStack — W7 (spec research/notes/W7-library-spec.md §4.2, R7 N-16 CrossSection with probes and rays). A labelled
// cross-section of matter in layers: what sits under a phone's glass, skin over tissue over a pulsing vessel, an SSD
// cell's gate stack, an ear cup. Geometry is computed from a few semantic props (no hand-placed rects): layers by size,
// probes on the top / bottom edge, rays emitter → scatter in the `depth` layer → detector, flows between two layers.
//
//      LED        PD                          probe row: 120 × 44 pads + mono 26 label above (emitter dot /
//   ┌──[●]────────[□]───────────────────┐       detector square / contact)
//   │ back crystal                      │     layers: thin 56 / medium 96 / thick 150 px, 1 px borderStrong edges,
//   │ skin · epidermis   \  /\/\  /     │       flat token patterns per kind (grid hatch, tissue stipple, liquid
//   │ blood vessel        \/    \/      │       lines, conductor lighter); label mono 500 28 + sub mono 26 textDim
//   │ tissue                            │     rays 3 px: down leg full, return leg at `strength`
//   └───────────────────────────────────┘
//   NOT TO SCALE                              honesty tag
//
// States: idle · focus (active layer outlined, the rest 0.6) · lit (rays) · flow (flows; carriers move only during
// `mark`, ≤ 4 px/f) · dim. `pulse` swells every `swell` layer +16 % and back over 20 f and dims the return rays with it
// (more blood → less light back: the PPG mechanism in one verb). No flight, no blur window.
// Renderer: remotion/v2/components/LayerStack.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef, DrawnShape } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);
const Ref = z.string().regex(/^[a-z0-9-]{1,16}$/);
const Tag = z.enum(["illustrative", "notToScale", "simulated", "none"]);

export const LAYER_KINDS = ["solid", "grid", "tissue", "conductor", "liquid", "gap"] as const;

export const LayerDef = z
  .object({
    id: Ref,
    label: z.string().min(1).max(20),
    sub: z.string().min(1).max(24).optional(),
    kind: z.enum(LAYER_KINDS).default("solid"),
    size: z.enum(["thin", "medium", "thick"]).default("medium"),
    /** `pulse` swells this layer +16 % of its height and back over 20 f (blood volume per heartbeat). Reserved. */
    swell: z.boolean().default(false),
  })
  .strict();
export const ProbeDef = z
  .object({
    id: Ref,
    label: z.string().min(1).max(14),
    role: z.enum(["emitter", "detector", "contact"]),
    side: z.enum(["top", "bottom"]).default("top"),
    /** x share of the stack width. */
    at: z.number().min(0.05).max(0.95),
    /** W7.3 an emitter's light colour: its dot and every ray it sends draw in it (green → lime, red → red, infrared →
     *  dim, white → white). Unset: read from the label ("GREEN LED" → green). A coloured ray tone that contradicts it
     *  is drawn in the light's colour (no red ray from a green LED: red light needs its own red emitter). */
    light: z.enum(["green", "red", "infrared", "white"]).optional(),
  })
  .strict();
export const RayDef = z
  .object({
    /** Emitter probe → detector probe (on the other side = transmission). */
    from: Ref,
    to: Ref,
    /** The layer it reaches / scatters in. */
    depth: Ref,
    /** Returned share, drawn as the return leg's opacity. */
    strength: z.number().min(0.2).max(1).default(1),
    label: z.string().min(1).max(14).optional(),
    tone: Tone.default("neutral"),
    /** W7.3 PARTIAL ray: a layer id or a contact probe id that takes the rest (1 − strength) of the ray — a branch from
     *  the scatter path into it ("your finger takes some field away"). The return leg keeps `strength`. */
    divert: Ref.optional(),
    divertLabel: z.string().min(1).max(14).optional(),
  })
  .strict();
export const FlowDef = z
  .object({
    /** Layer ids; the arrow runs between their centres, crossing the layers between. */
    from: Ref,
    to: Ref,
    /** Required: a flow always names its quantity. */
    label: z.string().min(1).max(16),
    tone: Tone.default("accent"),
    /** x share of the stack width (default: 0.5, a second flow 0.72). */
    at: z.number().min(0.1).max(0.9).optional(),
  })
  .strict();

export type LayerDefT = z.output<typeof LayerDef>;
export type ProbeDefT = z.output<typeof ProbeDef>;
export type RayDefT = z.output<typeof RayDef>;
export type FlowDefT = z.output<typeof FlowDef>;

/** Every probe / ray / flow / active ref exists; ids unique; a ray runs emitter → detector. Exported for L1 / tests. */
export function layerStackIssues(p: { layers: readonly { id: string }[]; probes?: readonly { id: string; role: string }[]; rays?: readonly { from: string; to: string; depth: string; divert?: string; divertLabel?: string }[]; flows?: readonly { from: string; to: string }[]; active?: string }): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const layers = new Set<string>();
  for (const l of p.layers) {
    if (layers.has(l.id)) out.push({ path: "layers", message: `layer id "${l.id}" is used twice` });
    layers.add(l.id);
  }
  const probes = new Map<string, string>();
  for (const q of p.probes ?? []) {
    if (probes.has(q.id) || layers.has(q.id)) out.push({ path: "probes", message: `probe id "${q.id}" is used twice` });
    probes.set(q.id, q.role);
  }
  (p.rays ?? []).forEach((r: { from: string; to: string; depth: string; divert?: string; divertLabel?: string }, i) => {
    if (r.divert !== undefined) {
      if (r.divert === r.depth) out.push({ path: `rays.${i}.divert`, message: `ray ${i}: divert "${r.divert}" is the depth layer itself — name the layer / contact probe that takes field away` });
      else if (!layers.has(r.divert) && probes.get(r.divert) !== "contact") out.push({ path: `rays.${i}.divert`, message: `ray ${i}: divert "${r.divert}" is neither a layer nor a contact probe` });
    }
    if (r.divertLabel !== undefined && r.divert === undefined) out.push({ path: `rays.${i}.divertLabel`, message: `ray ${i}: divertLabel needs a divert` });
    if (probes.get(r.from) !== "emitter") out.push({ path: `rays.${i}.from`, message: `ray ${i}: "${r.from}" is not an emitter probe` });
    if (probes.get(r.to) !== "detector") out.push({ path: `rays.${i}.to`, message: `ray ${i}: "${r.to}" is not a detector probe` });
    if (!layers.has(r.depth)) out.push({ path: `rays.${i}.depth`, message: `ray ${i}: no layer "${r.depth}"` });
  });
  (p.flows ?? []).forEach((f, i) => {
    if (!layers.has(f.from)) out.push({ path: `flows.${i}.from`, message: `flow ${i}: no layer "${f.from}"` });
    if (!layers.has(f.to)) out.push({ path: `flows.${i}.to`, message: `flow ${i}: no layer "${f.to}"` });
    if (f.from === f.to) out.push({ path: `flows.${i}`, message: `flow ${i}: from and to are the same layer` });
  });
  if (p.active !== undefined && !layers.has(p.active)) out.push({ path: "active", message: `active: no layer "${p.active}"` });
  return out;
}

export const LayerStackProps = z
  .object({
    title: z.string().min(1).max(28).optional(),
    layers: z.array(LayerDef).min(2).max(6),
    probes: z.array(ProbeDef).max(3).default([]),
    rays: z.array(RayDef).max(3).default([]),
    flows: z.array(FlowDef).max(2).default([]),
    /** Highlighted layer: 2 px outline + label in activeTone; the others drop to 0.6. */
    active: Ref.optional(),
    activeTone: Tone.default("accent"),
    /** W7.2 held swell: every `swell` layer stays expanded (+16 %) and every return ray drops to its swollen strength
     *  (more blood → more absorbed → less light back), tweened 12 f. Set it on "more absorbed", clear it on "less". */
    swelled: z.boolean().default(false),
    tag: Tag.default("notToScale"),
    /** W7.3 drawn height, SET BY THE LIBRARY's stage-fill pass (timeline.ts fitWorld height step) — directors leave it
     *  out: the footprint height the layer bands grow into when the stack is the only focal subject (probes, title and
     *  tag keep their size; bands grow in proportion, ≤ ×LAYER_STACK.maxBandGrow). */
    fillH: z.number().int().min(200).max(1600).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const i of layerStackIssues(p)) ctx.addIssue({ code: "custom", path: i.path.split("."), message: i.message });
  });

export type LayerStackPropsT = z.output<typeof LayerStackProps>;

export const LAYER_STACK = {
  defaultW: 900,
  minW: 640,
  maxW: 952,
  pad: 36,
  border: 2,
  titlePx: 44,
  titleLh: 52,
  titleGap: 20,
  /** Probe row: label (34) + gap (8) + pad (44), on the stack edge. */
  probeRowH: 90,
  probeW: 120,
  probeH: 44,
  probeLabelH: 34,
  layerH: { thin: 56, medium: 96, thick: 150 },
  swellK: 0.16,
  labelPx: 28,
  subPx: 26,
  labelInset: 20,
  tagGap: 18,
  rowH: 40,
  stackRadius: 14,
  rayW: 3,
  carrierR: 6,
  carriers: 3,
  carrierPxPerF: 4,
  markF: 60,
  pulseF: 20,
  drawF: 18,
  rayStaggerF: 4,
  flowPlateGap: 18,
  /** W7.3 height fill: a band grows at most this much (×) over its spec size. */
  maxBandGrow: 3,
  /** Partial ray: the strength-drop ghost lasts this long (f) after a rays override lowers a return. */
  ghostF: 30,
  /** Partial-ray branch: draw-on frames and minimum stroke width (a 10 % share still reads at phone size). */
  divertDrawF: 6,
  divertMinW: 5,
} as const;

const L = LAYER_STACK;
const mono = (chars: number, px: number) => chars * px * 0.6;

export const STACK_TAG_TEXT: Record<z.output<typeof Tag>, string> = { illustrative: "ILLUSTRATIVE", notToScale: "NOT TO SCALE", simulated: "SIMULATED", none: "" };

/** Thin layers put their sub on the label's line. */
export function layerTextW(l: Pick<LayerDefT, "label" | "sub" | "size">): number {
  const lab = mono(l.label.length, L.labelPx);
  const sub = l.sub ? mono(l.sub.length, L.subPx) : 0;
  return l.size === "thin" && l.sub ? lab + 18 + sub : Math.max(lab, sub);
}

export function layerStackMinWidth(p: LayerStackPropsT): number {
  const title = p.title ? p.title.length * L.titlePx * 0.62 : 0;
  const layer = Math.max(...p.layers.map((l) => layerTextW(l) + 2 * L.labelInset + 220 /* room right of the label for rays / flows */));
  const flow = Math.max(0, ...p.flows.map((f) => mono(f.label.length, L.subPx) + 2 * 12 + 80));
  return Math.ceil(Math.max(L.minW, title, layer, flow + 360) + 2 * L.pad);
}

export function layerStackWidth(p: LayerStackPropsT, w: number | undefined): number {
  return Math.min(L.maxW, Math.max(w ?? L.defaultW, layerStackMinWidth(p)));
}

/** Swell amount 0..1 at `dt` frames after a pulse (expand and relax over 20 f). */
export function swellCurve(dt: number): number {
  if (dt < 0 || dt > L.pulseF) return 0;
  return Math.sin((Math.PI * dt) / L.pulseF);
}

/** Share of a return ray's strength a full swell takes away (more blood → less light back). */
export const SWELL_ABSORB = 0.45;

/** THE drawn return strength of a ray at swell s (0..1): what the renderer draws (opacity + width) and the digest
 *  prints, so "more absorbed" always reads as a weaker return. */
export const returnStrength = (strength: number, s: number) => Math.max(0.12, strength * (1 - SWELL_ABSORB * Math.min(1, Math.max(0, s))));

/** Return-leg stroke width at a drawn strength (≈ 2–7 px: a weak return is visibly thinner at phone size). */
export const returnWidth = (drawn: number) => Math.round((1 + 6 * drawn) * 10) / 10;

export interface StackLayout {
  w: number;
  h: number;
  titleY: number | null;
  stackX: number;
  stackW: number;
  stackTop: number;
  /** Bottom of the stack at this swell (the footprint reserves the full swell). */
  stackBottom: number;
  layers: { id: string; y: number; h: number }[];
  topProbeY: number | null;
  bottomProbeY: number | null;
  tagY: number | null;
}

/** Spec band height of each layer, grown by the library's fillH (W7.3) in proportion, ≤ ×maxBandGrow. */
export function bandHeights(p: Pick<LayerStackPropsT, "layers" | "probes" | "title" | "tag" | "fillH">): number[] {
  const base = p.layers.map((l) => L.layerH[l.size]);
  if (p.fillH === undefined) return base;
  const sum = base.reduce((a, b) => a + b, 0);
  const fixed = stackLayoutRaw({ ...p, fillH: undefined } as LayerStackPropsT, base).h - sum;
  const g = Math.min(L.maxBandGrow, Math.max(1, (p.fillH - fixed) / sum));
  return base.map((h) => Math.round(h * g));
}

/** Layout at swell s (0..1). Pure; renderer, shape() and the tests share it. */
export function stackLayout(p: LayerStackPropsT, w: number, s = 0): StackLayout {
  return { ...stackLayoutRaw(p, bandHeights(p), s), w, stackW: w - 2 * L.pad };
}

function stackLayoutRaw(p: LayerStackPropsT, bands: readonly number[], s = 0): StackLayout {
  const w = 0;
  const top = p.probes.some((q) => q.side === "top");
  const bottom = p.probes.some((q) => q.side === "bottom");
  let y = L.pad;
  const titleY = p.title ? y : null;
  if (p.title) y += L.titleLh + L.titleGap;
  const topProbeY = top ? y : null;
  if (top) y += L.probeRowH;
  const stackTop = y;
  const layers = p.layers.map((l, i) => {
    const base = bands[i];
    const h = l.swell ? base * (1 + L.swellK * s) : base;
    const out = { id: l.id, y, h };
    y += h;
    return out;
  });
  const stackBottom = y;
  const reserve = p.layers.reduce((a, l, i) => a + (l.swell ? bands[i] * L.swellK : 0), 0);
  let fy = stackTop + bands.reduce((a, b) => a + b, 0) + reserve;
  const bottomProbeY = bottom ? fy : null;
  if (bottom) fy += L.probeRowH;
  const tagY = p.tag !== "none" ? fy + L.tagGap : null;
  if (tagY !== null) fy = tagY + L.rowH;
  return { w, h: Math.ceil(fy + L.pad), titleY, stackX: L.pad, stackW: w - 2 * L.pad, stackTop, stackBottom, layers, topProbeY, bottomProbeY, tagY };
}

/** Probe pad centre x and its edge y (where the pad touches the stack). */
export function probeAt(q: Pick<ProbeDefT, "at" | "side">, lay: StackLayout): { x: number; y: number } {
  return { x: lay.stackX + q.at * lay.stackW, y: q.side === "top" ? lay.stackTop : lay.stackBottom };
}

/** Ray polyline: emitter edge → down to the depth layer's middle → along it (where the light is absorbed / scattered) →
 *  back to the detector edge. `down` = the index of the last point of the inbound leg (points[0..down]); the last
 *  segment is the return leg (drawn at `strength`). */
export function rayGeometry(p: LayerStackPropsT, w: number, s = 0): { points: { x: number; y: number }[]; down: number }[] {
  const lay = stackLayout(p, w, s);
  return p.rays.map((r) => {
    const a = p.probes.find((q) => q.id === r.from);
    const b = p.probes.find((q) => q.id === r.to);
    const d = lay.layers.find((l) => l.id === r.depth);
    if (!a || !b || !d) return { points: [], down: 0 };
    const A = probeAt(a, lay);
    const B = probeAt(b, lay);
    let g = B.x - A.x;
    if (Math.abs(g) < 90) g = g < 0 ? -140 : 140; // same column: travel out and come back
    const my = d.y + d.h / 2;
    // in → travel through the depth layer → out: a clean trapezoid reads as "light goes in, comes back" at phone size
    const pts = [
      { x: A.x, y: A.y },
      { x: A.x + 0.3 * g, y: my },
      { x: A.x + 0.7 * g, y: my },
      { x: B.x, y: B.y },
    ];
    return { points: pts, down: 1 };
  });
}

/** Flow arrow x and its start / end y: from the `from` layer's centre to the FAR edge of the `to` layer (an upward flow
 *  ends at the top of `to`, e.g. the glass surface under a finger), so even adjacent layers get a readable arrow. */
export function flowGeometry(p: LayerStackPropsT, w: number, s = 0): { x: number; y0: number; y1: number }[] {
  const lay = stackLayout(p, w, s);
  return p.flows.map((f, i) => {
    const a = lay.layers.find((l) => l.id === f.from);
    const b = lay.layers.find((l) => l.id === f.to);
    const x = lay.stackX + (f.at ?? (i === 0 ? 0.5 : 0.72)) * lay.stackW;
    const y0 = a ? a.y + a.h / 2 : lay.stackTop;
    const up = !!a && !!b && b.y < a.y;
    const y1 = b ? (up ? b.y + 6 : b.y + b.h - 6) : lay.stackBottom;
    return { x, y0, y1 };
  });
}

// ── W7.3 light colour + partial rays ────────────────────────────────────────────────────────────────────────────

export type LightColour = "green" | "red" | "infrared" | "white";
const LIGHT_RE: ReadonlyArray<[RegExp, LightColour]> = [
  [/\bgreen\b/i, "green"],
  [/\b(?:infra-?red|ir)\b/i, "infrared"],
  [/\bred\b/i, "red"],
  [/\bwhite\b/i, "white"],
];
/** An emitter's light colour: explicit `light`, else read from its label; null = not declared (or not an emitter). */
export function probeLight(q: Pick<ProbeDefT, "role" | "label" | "light">): LightColour | null {
  if (q.role !== "emitter") return null;
  if (q.light) return q.light;
  for (const [re, c] of LIGHT_RE) if (re.test(q.label)) return c;
  return null;
}
const LIGHT_TONE: Record<LightColour, "accent" | "danger" | "dim" | "neutral"> = { green: "accent", red: "danger", infrared: "dim", white: "neutral" };
/** Tone an emitter's dot draws in when lit (its light colour), null = no declared colour (the ray's tone). */
export const lightTone = (c: LightColour | null) => (c ? LIGHT_TONE[c] : null);

/** THE drawn tone of ray i: its own tone, except that a COLOURED tone (lime / red) that contradicts its emitter's light
 *  colour is drawn in the light's colour (a GREEN LED never sends a red ray). Grey / dim stay. Renderer, digest, lints. */
export function rayTone(p: Pick<LayerStackPropsT, "rays" | "probes">, i: number): "accent" | "danger" | "neutral" | "dim" {
  const r = p.rays[i];
  if (!r) return "neutral";
  const lt = lightTone(probeLight(p.probes.find((q) => q.id === r.from) ?? { role: "detector", label: "" }));
  if (lt && (r.tone === "accent" || r.tone === "danger") && r.tone !== lt) return lt;
  return r.tone;
}

/** Share of ray i that its divert takes (1 − strength), 0 = not a partial ray. */
export const divertShare = (r: Pick<RayDefT, "divert" | "strength">) => (r.divert ? Math.max(0, Math.min(1, 1 - r.strength)) : 0);

/** Partial-ray branch geometry: from the middle of the scatter path to the divert target (a layer: its centre at the
 *  branch x; a contact probe: its pad edge), null = no divert. */
export function divertGeometry(p: LayerStackPropsT, w: number, s = 0): ({ a: { x: number; y: number }; b: { x: number; y: number } } | null)[] {
  const lay = stackLayout(p, w, s);
  const rays = rayGeometry(p, w, s);
  return p.rays.map((r, i) => {
    if (!r.divert || !rays[i]?.points.length) return null;
    const pts = rays[i].points;
    const a = { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
    const l = lay.layers.find((x) => x.id === r.divert);
    if (l) {
      const up = l.y + l.h / 2 < a.y;
      return { a, b: { x: a.x, y: up ? l.y + l.h * 0.55 : l.y + l.h * 0.45 } };
    }
    const q = p.probes.find((x) => x.id === r.divert);
    if (!q) return null;
    return { a, b: probeAt(q, lay) };
  });
}

export const meta = {
  name: "LayerStack",
  version: 3,
  tier: "p0",
  spec: "W7 library spec §4.2 (R7 N-16 CrossSection)",
  summary: "Cross-section of 2–6 labelled layers with edge probes (emitter / detector / contact), rays emitter → `depth` layer → detector (return strength = opacity + width; a drop leaves a fading ghost; `divert` sends the lost share into a layer / contact probe: the finger takes SOME field; rays are their emitter's light colour: `light` or a label like GREEN LED), labelled flows (carriers move on `mark`); `active` outlines a layer; `pulse` (one beat) or swelled (held) swells `swell` layers and weakens the return light (more absorbed); NOT TO SCALE tag.",
  families: ["science", "data", "systems"],
  propsSchema: LayerStackProps,
  propsSchemaName: "LayerStackProps",
  example: {
    title: "Under the glass",
    layers: [
      { id: "glass", label: "cover glass", size: "medium" },
      { id: "ito", label: "electrode grid", sub: "transparent ITO", kind: "grid", size: "thin" },
      { id: "display", label: "display", kind: "conductor", size: "thick" },
    ],
  },
  states: ["idle", "focus", "lit", "flow", "dim", "final"],
  verbs: {
    enter: { durF: 31, does: "plate-first entrance (plateFade), then the layers slide in from the left 3 f apart (13 + 3·layers f), probes with the top / bottom layer" },
    exit: { durF: 8, does: "content fades + blurs 4 f on the opaque plate, then the plate 4 f" },
    state: {
      durF: 12,
      does: "idle: layers + probes · focus: the `active` layer outlined in activeTone (6 f), the rest fade to 0.6 · lit: rays shown (6 f fade, or drawn by drawOn); strength changes tween 12 f; the return leg's opacity AND width follow its strength, a drop leaves a ghost of the old return (30 f: 'absorbs / dims' reads in a still); a ray with `divert` branches the lost share into that layer / contact probe (12 f draw, width = the share) · swelled true: swell layers held expanded and every return ray weaker (more absorbed) · flow: flow arrows + labels (carriers move only during mark) · dim: all textDim · final (CTA): back to the last live (non idle / dim) state with its props, so 'Follow' lands on the climax picture",
      props: ["active", "activeTone", "rays", "flows", "swelled"],
    },
    drawOn: { durF: 26, does: "rays draw from the emitter down into the depth layer and back up to the detector (18 f each, 4 f apart); rays stay drawn while lit / flow" },
    mark: { durF: 60, does: "carriers travel each flow once at ≤ 4 px/f (no blur window)" },
    pulse: { durF: 20, does: "every `swell` layer expands +16 % and relaxes (one heartbeat); the return rays dim with it (more blood → less light back)" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
  },
  focal: true,
  footprint: (p, w) => {
    const W = layerStackWidth(p, w);
    return { w: W, h: stackLayout(p, W).h };
  },
  shape: (p, w): DrawnShape => {
    const W = layerStackWidth(p, w);
    const lay = stackLayout(p, W);
    const parts: DrawnShape["parts"] = [{ part: "", x: 0, y: 0, w: W, h: lay.h }];
    for (const l of lay.layers) parts.push({ part: `layer:${l.id}`, x: lay.stackX, y: l.y, w: lay.stackW, h: l.h });
    for (const q of p.probes) {
      const c = probeAt(q, lay);
      parts.push({ part: `probe:${q.id}`, x: c.x - L.probeW / 2, y: q.side === "top" ? c.y - L.probeRowH : c.y, w: L.probeW, h: L.probeRowH });
    }
    divertGeometry(p, W).forEach((d, i) => {
      if (d) parts.push({ part: `divert:${i}`, x: Math.min(d.a.x, d.b.x) - 12, y: Math.min(d.a.y, d.b.y), w: Math.abs(d.b.x - d.a.x) + 24, h: Math.abs(d.b.y - d.a.y) });
    });
    rayGeometry(p, W).forEach((r, i) => {
      if (!r.points.length) return;
      const x0 = Math.min(...r.points.map((q) => q.x));
      const y0 = Math.min(...r.points.map((q) => q.y));
      parts.push({ part: `ray:${i}`, x: x0, y: y0, w: Math.max(...r.points.map((q) => q.x)) - x0, h: Math.max(...r.points.map((q) => q.y)) - y0 });
    });
    flowGeometry(p, W).forEach((f, i) => parts.push({ part: `flow:${i}`, x: f.x - 20, y: Math.min(f.y0, f.y1), w: 40, h: Math.abs(f.y1 - f.y0) }));
    return { parts };
  },
  sfx: { enter: "tick", drawOn: "whoosh", pulse: "tick", state: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof LayerStackProps>;
