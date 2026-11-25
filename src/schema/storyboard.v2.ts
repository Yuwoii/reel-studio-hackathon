// storyboard.json v2.1 — what the v2 director writes per reel (data only: D1 #7, ADR-001 §2.1 / §4).
//
// One fixed `Explainer` composition renders every storyboard; the director never writes TSX. This module is the zod 4
// contract plus cross-reference checks. Pure lints that need timings live in src/v2/lints.ts; frame maths in
// src/v2/timeline.ts (resolveTimeline), which only `import type`s from here.
//
// Adjustments to the ADR §4 draft, per research/D1-DECISIONS.md:
//  - series: "ROOT CAUSE" (D1 #1); "INCIDENT REPLAY" is accepted as an alias and normalised to ROOT CAUSE (ADR §2.9).
//  - header: right-label modes EVENT / SPEC / CLOCK (never the publish date); story-reactive dot dim/danger/accent.
//  - captions: active-word tracking (W7.3: the active word WHITE, bold) + one semantic keyword per beat phrase (lime or
//    danger) — D1 #8; never two coloured words at once.
//  - blur: velocity-adaptive tent shutter, floor 8, cap 32 at 1 px spacing (ADR §2.7, R8b; W2 gate fix).
//  - tokens: + textFainter (D1 #11 / RESEARCH §9 #8). Hex/rgb strings are unrepresentable by type and rejected inside
//    free-form props (L2).
//  - hard cuts ≤2, glitch 0–3, 60–80 s, CTA last: enforced by lints (they need timings).
//  - additions: camera0 (opening shot), cover.beat (cover anchors need a beat), beat/instance `illustrative` +
//    instance `sourceIds` (L16), header dot.
//
// Coordinates: world space, px, origin top-left. Instance x/y = the instance's top-left corner in WORLD coordinates
// (not station-relative); `station` groups instances for camera targeting and off-station hiding. The camera puts its
// target at screen (540, 855) — the stage centre (bible §1: stage 150–1560).

import { z } from "zod";
import { LIBRARY_IDS, LIBRARY_VERSION } from "../v2/registry.gen.js";

export const SCHEMA_VERSION = "v2.1" as const;
export const SERIES = "ROOT CAUSE" as const;
export const SERIES_ALIASES = ["INCIDENT REPLAY"] as const;
/** W7: the header's series label is per track (src/director/v2/topics.ts seriesLabels: ROOT CAUSE for incidents,
 *  "HOW IT WORKS" for the fundamentals track, both overridable in config). Any upper-case label of 3–16 chars;
 *  the director's board must use its script's label (tools.ts boardContractErrors). */
export const SERIES_LABEL_RE = /^[A-Z][A-Z0-9 ]{1,14}[A-Z0-9]$/;

/** Colour tokens by name only (hex is unrepresentable). theme.ts maps them (bible §2 + D1 #11 amendments). */
export const TOKENS = ["bg", "bgRaised", "bgRaised2", "border", "borderStrong", "text", "textDim", "textFaint", "textFainter", "accent", "accentInk", "danger", "dangerBg"] as const;
export const Token = z.enum(TOKENS);
export const Tone = z.enum(["accent", "danger", "neutral", "dim"]);
export const Id = z.string().regex(/^[a-z0-9-]{2,32}$/, "id: 2–32 chars of a-z 0-9 -");

/** Anchors, resolved to absolute frames by resolveTimeline() within the beat they appear in. */
export const AtRef = z.enum(["keyword", "phraseStart", "phraseEnd"]);
export const At = z.union([
  AtRef,
  z.object({ word: z.number().int().min(0) }).strict(),
  z.object({
    ref: AtRef,
    offsetF: z
      .number()
      .int()
      .min(-15, "offsetF ≥ -15. For a moment mid-line use {word: n} (n = 0-based spoken word of the phrase)")
      .max(45, "offsetF ≤ 45 (1.5 s). For a moment mid-line use {word: n} (n = 0-based spoken word of the phrase)"),
  }).strict(),
]);

/**
 * bible   = bezier(0.65,0,0.35,1) 12–20 f (short moves; bible §4)
 * longPan = bezier(0.45,0,0.55,1) ≥22 f (pans > ~900 px; PROOF r5)
 * pushOut = ease-out push-in (R1 ref2/ref3)
 * enter   = spring d200 s180 m0.6 (components only)
 * linear  = tracks only (never the camera)
 */
export const EASES = ["bible", "longPan", "pushOut", "enter", "linear"] as const;
export const Ease = z.enum(EASES);
export const CameraEase = z.enum(["bible", "longPan", "pushOut"]);

const PATH_D = /^[MLAZmlaz0-9.,\s-]{1,4000}$/;

const TrackKey = z.object({
  at: At,
  value: z.number(),
  ease: Ease.default("bible"),
  durF: z.number().int().min(1).max(60).default(16),
});
const Track = z.array(TrackKey).max(8);

export interface FigNodeT {
  id: string;
  kind: "rect" | "line" | "polyline" | "arc" | "path" | "text" | "arrow" | "group";
  geom: {
    x: number;
    y: number;
    w?: number;
    h?: number;
    r?: number;
    points?: [number, number][];
    d?: string;
    text?: string;
    font?: "sans" | "mono";
    size?: "label" | "body" | "title";
  };
  stroke?: z.infer<typeof Token>;
  fill?: z.infer<typeof Token>;
  strokeW?: "hair" | "thin" | "bold";
  enter?: { at: z.infer<typeof At>; how: "fade" | "drawOn" | "scaleIn" | "scramble" };
  exit?: { at: z.infer<typeof At>; how: "fade" | "drawOff" };
  tracks?: Partial<Record<"x" | "y" | "w" | "h" | "opacity" | "strokeDash" | "rotate", z.input<typeof Track>>>;
  fillTo?: { at: z.infer<typeof At>; token: z.infer<typeof Token> }[];
  morphTo?: { at: z.infer<typeof At>; d: string; durF: number }[];
  children?: FigNodeT[];
}

/** Figure primitive node (ADR §2.3): ≤80 nodes per Figure in total, M/L/A/Z paths, token colours only. */
export const FigNode: z.ZodType<FigNodeT> = z.lazy(() =>
  z
    .object({
      id: Id,
      kind: z.enum(["rect", "line", "polyline", "arc", "path", "text", "arrow", "group"]),
      geom: z
        .object({
          x: z.number(),
          y: z.number(),
          w: z.number().optional(),
          h: z.number().optional(),
          r: z.number().optional(),
          points: z.array(z.tuple([z.number(), z.number()])).max(64).optional(),
          d: z.string().regex(PATH_D, "path d: only M/L/A/Z commands and numbers").optional(),
          text: z.string().max(40).optional(),
          font: z.enum(["sans", "mono"]).optional(),
          size: z.enum(["label", "body", "title"]).optional(),
        })
        .strict(),
      stroke: Token.optional(),
      fill: Token.optional(),
      strokeW: z.enum(["hair", "thin", "bold"]).optional(),
      enter: z.object({ at: At, how: z.enum(["fade", "drawOn", "scaleIn", "scramble"]) }).optional(),
      exit: z.object({ at: At, how: z.enum(["fade", "drawOff"]) }).optional(),
      tracks: z.object({ x: Track, y: Track, w: Track, h: Track, opacity: Track, strokeDash: Track, rotate: Track }).partial().optional(),
      fillTo: z.array(z.object({ at: At, token: Token })).max(4).optional(),
      morphTo: z.array(z.object({ at: At, d: z.string().regex(PATH_D), durF: z.number().int().min(6).max(40) })).max(3).optional(),
      children: z.array(FigNode).max(40).optional(),
    })
    .strict(),
) as z.ZodType<FigNodeT>;

export const Station = z.object({ id: Id, x: z.number(), y: z.number(), w: z.number().min(200), h: z.number().min(200) }).strict();

export const Instance = z
  .object({
    id: Id,
    component: z.enum(LIBRARY_IDS),
    station: Id,
    x: z.number(),
    y: z.number(),
    w: z.number().min(60).max(1000).optional(),
    scale: z.number().min(0.5).max(2).default(1),
    z: z.number().int().min(0).max(9).default(1),
    /** Overrides the component's focal metadata (L4). Focal elements sit on opaque plates, never scrims [PROOF]. */
    focal: z.boolean().optional(),
    plate: z.boolean().default(true),
    /** Facts behind numbers this instance shows (L16). Beats that act on it also count. */
    sourceIds: z.array(Id).max(4).default([]),
    /** Shows example / magnified values; such instances need an IllustrativeTag nearby, not a source (R7). */
    illustrative: z.boolean().default(false),
    /** Re-parsed by registry[component].propsSchema (W2). Strings only carry content; colours via Tone/Token. */
    props: z.record(z.string(), z.unknown()).default({}),
    figure: z.array(FigNode).max(80).optional(),
  })
  .strict();

const CameraTarget = z.union([
  z.object({ station: Id }).strict(),
  z.object({ instance: Id }).strict(),
  z.object({ x: z.number(), y: z.number() }).strict(),
]);

export const CameraKey = z
  .object({
    /** Move START frame. */
    at: At.default("keyword"),
    target: CameraTarget,
    zoom: z.number().min(0.6).max(2.2),
    tiltX: z.number().min(0).max(25).default(0),
    ease: CameraEase.default("bible"),
    /** Default by ease: bible 16, longPan 24, pushOut 18. Ignored for hardCut. */
    durF: z.number().int().min(12).max(30).optional(),
    transition: z.enum(["move", "hardCut"]).default("move"), // 'blurCut' only after its Lambda cost test [R1]
    shake: z.boolean().default(false),
  })
  .strict();

export const ACTION_VERBS = ["enter", "exit", "state", "focus", "pulse", "scramble", "drawOn", "countUp", "mark", "glitch"] as const;
export const Action = z
  .object({
    target: z.union([Id, z.enum(["datafield", "header"])]),
    do: z.enum(ACTION_VERBS),
    at: At.default("keyword"),
    state: z.string().max(40).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const SFX_TYPES = ["tick", "whoosh", "glitch", "thud", "chatter", "silenceHole"] as const;
export const Sfx = z.object({ type: z.enum(SFX_TYPES), at: At.default("keyword"), gainDb: z.number().min(-12).max(0).default(0) }).strict();

/** R5 part tags. `ask` (mid-roll follow ask) exists in the rubric but D1 #12 bans it → L12 error. */
export const PARTS = ["hook", "stakes", "reveal", "twist", "mechanism", "context", "climax", "closure", "cta", "ask"] as const;
export const Part = z.enum(PARTS);

export const HeaderDot = z.enum(["dim", "danger", "accent"]);

export const Beat = z
  .object({
    id: z.string().regex(/^b\d{2}$/, "beat id: b01, b02, …"),
    part: Part,
    /** TTS unit; must equal the TTS words token for token (L5). */
    phrase: z.string().min(3).max(120),
    /** Optional caption split (≤5 words each, single line); default: auto-split by resolveTimeline [R1][PROOF]. */
    display: z.array(z.string().min(1)).min(1).max(6).optional(),
    /** Exactly once in `phrase` (L5). Highlighted in its display phrase; may be several words. */
    keyword: z.string().min(1).max(40),
    keywordColor: z.enum(["accent", "danger"]),
    sourceIds: z.array(Id).max(4).default([]),
    /** The phrase speaks example values (e.g. "give it 512 megabytes"); exempts it from L16 sourcing. */
    illustrative: z.boolean().default(false),
    camera: z.array(CameraKey).max(2).default([]),
    actions: z.array(Action).min(1).max(4),
    sfx: z.array(Sfx).max(3).default([]),
    header: z
      .object({ right: z.string().min(1).max(24).optional(), dot: HeaderDot.optional(), at: At.default("keyword") })
      .strict()
      .refine((h) => h.right !== undefined || h.dot !== undefined, "header change needs right and/or dot")
      .optional(),
  })
  .strict();

const seriesField = z.preprocess(
  (v) => (typeof v === "string" && (SERIES_ALIASES as readonly string[]).includes(v.trim().toUpperCase()) ? SERIES : v),
  z.string().regex(SERIES_LABEL_RE, "series: 3–16 chars A-Z 0-9 space (e.g. ROOT CAUSE, HOW IT WORKS)"),
);

const StoryboardObject = z
  .object({
    schema: z.literal(SCHEMA_VERSION),
    libraryVersion: z.literal(LIBRARY_VERSION),
    series: seriesField.default(SERIES),
    mode: z.enum(["concept", "event"]),
    family: z.enum(["security", "outage", "network", "systems", "science", "data"]), // R7
    codename: z.string().regex(/^[A-Z0-9-]{4,12}$/, "codename: 4–12 chars A-Z 0-9 -"),
    headerMode: z.enum(["EVENT", "SPEC", "CLOCK"]),
    /** Opening right label; beats change it via beat.header.right (scramble). */
    headerRight: z.string().min(1).max(24),
    /** Sources for the opening header label (frame 0, before any beat). Needed when it shows a number or date (L16). */
    headerSourceIds: z.array(Id).max(4).default([]),
    headerDot: HeaderDot.default("dim"),
    datafield: z.object({ preset: z.enum(["hex", "logs", "process", "nodes", "lattice", "matrix", "book", "certs"]), seed: z.string().min(1).max(40) }).strict(),
    captions: z
      .object({
        layout: z.enum(["bottomCard", "topBuilder"]).default("bottomCard"),
        /** D1 #8: active-word tracking (W7.3: white + bold, not lime) + ONE semantic keyword in keywordColor, the only
         *  coloured word. `keyword` = bible-strict colour-only variant. */
        style: z.enum(["activeWordKeyword", "keyword"]).default("activeWordKeyword"),
      })
      .strict()
      .prefault({}),
    blur: z
      .object({
        adaptive: z.literal(true).default(true),
        shutter: z.literal("tent").default("tent"),
        minSamples: z.number().int().min(6).max(32).default(8),
        // W2: 1 px sample spacing, cap 32 (src/v2/timeline.ts BLUR_PX_PER_SAMPLE / BLUR_MAX_SAMPLES)
        maxSamples: z.number().int().min(8).max(32).default(32),
        shutterAngle: z.number().min(90).max(180).default(180),
      })
      .strict()
      .prefault({}),
    music: z.object({ bed: z.string().regex(/^[a-z0-9-]{3,40}$/).nullable() }).strict(), // null = voice-only
    sources: z.array(z.object({ id: Id, title: z.string().min(1).max(120), ref: z.string().min(1).max(300) }).strict()).min(1).max(20),
    stations: z.array(Station).min(1).max(8),
    world: z.array(Instance).max(40),
    /** Opening shot (frame 0). Default: first station centre at zoom 1. */
    camera0: z.object({ target: CameraTarget, zoom: z.number().min(0.6).max(2.2), tiltX: z.number().min(0).max(25).default(0) }).strict().optional(),
    beats: z.array(Beat).min(15).max(40),
    /** Settled frame for the IG cover [VR2 m5] (L20). */
    cover: z.object({ beat: z.string().regex(/^b\d{2}$/), at: At }).strict().optional(),
    componentRequests: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Za-z0-9]{2,30}$/),
            purpose: z.string().max(300),
            props: z.string().max(500),
            forBeat: z.string().regex(/^b\d{2}$/),
            fallback: Id,
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();

type StoryboardOut = z.output<typeof StoryboardObject>;

// ── cross-reference checks (L1 unless tagged) ─────────────────────────────────────────────────────────────────────

/** A string that IS a hex colour (so "issue #1234", "PR #4521", "build #deadbeef" in copy stay legal), or contains a
 *  CSS colour function anywhere. */
/** Mirrors MAX_DISPLAY_WORDS in src/v2/timeline.ts (schema has no runtime imports from src/v2). */
const MAX_DISPLAY_WORDS_SCHEMA = 5;
const RAW_HEX = /^\s*#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\s*$/i;
const RAW_COLOUR_FN = /\b(?:rgba?|hsla?|hwb|oklch|oklab)\s*\(/i;
export function isRawColour(value: string): boolean {
  return RAW_HEX.test(value) || RAW_COLOUR_FN.test(value);
}

/** Paths of string values that look like raw CSS colours (L2: colours by token name only). */
export function findRawColours(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  const out: (string | number)[][] = [];
  if (typeof value === "string") {
    if (isRawColour(value)) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findRawColours(v, [...path, i])));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) out.push(...findRawColours(v, [...path, k]));
  }
  return out;
}

export function countFigNodes(nodes: readonly FigNodeT[] | undefined): number {
  return (nodes ?? []).reduce((n, x) => n + 1 + countFigNodes(x.children), 0);
}

function crossRefs(s: StoryboardOut, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[], tag = "L1") => ctx.addIssue({ code: "custom", message: `[${tag}] ${message}`, path });
  const dupes = (ids: string[], what: string, key: string) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) issue(`duplicate ${what} id "${id}"`, [key, i, "id"]);
      seen.add(id);
    });
  };
  dupes(s.stations.map((x) => x.id), "station", "stations");
  dupes(s.world.map((x) => x.id), "instance", "world");
  dupes(s.sources.map((x) => x.id), "source", "sources");
  const stations = new Set(s.stations.map((x) => x.id));
  const instances = new Map(s.world.map((x) => [x.id, x]));
  const sources = new Set(s.sources.map((x) => x.id));
  const beatIds = new Set<string>();

  const checkTarget = (t: z.infer<typeof CameraTarget>, path: (string | number)[]) => {
    if ("station" in t && !stations.has(t.station)) issue(`unknown station "${t.station}"`, path);
    if ("instance" in t && !instances.has(t.instance)) issue(`unknown instance "${t.instance}"`, path);
  };

  s.world.forEach((inst, i) => {
    if (!stations.has(inst.station)) issue(`instance "${inst.id}": unknown station "${inst.station}"`, ["world", i, "station"]);
    if (inst.component === "Figure") {
      if (!inst.figure?.length) issue(`instance "${inst.id}": a Figure needs figure nodes`, ["world", i, "figure"]);
      const n = countFigNodes(inst.figure);
      if (n > 80) issue(`instance "${inst.id}": Figure has ${n} nodes (max 80)`, ["world", i, "figure"], "L13");
    } else if (inst.figure) issue(`instance "${inst.id}": only a Figure takes figure nodes`, ["world", i, "figure"]);
    inst.sourceIds.forEach((id, j) => sources.has(id) || issue(`unknown source "${id}"`, ["world", i, "sourceIds", j]));
    for (const p of findRawColours(inst.props)) issue(`instance "${inst.id}": raw colour in props.${p.join(".")} (use a Tone/Token name)`, ["world", i, "props", ...p], "L2");
  });
  if (s.camera0) checkTarget(s.camera0.target, ["camera0", "target"]);
  s.headerSourceIds.forEach((id, j) => sources.has(id) || issue(`unknown source "${id}"`, ["headerSourceIds", j]));

  s.beats.forEach((b, i) => {
    const want = `b${String(i + 1).padStart(2, "0")}`;
    if (b.id !== want) issue(`beat ${i + 1} must have id "${want}" (got "${b.id}")`, ["beats", i, "id"]);
    beatIds.add(b.id);
    // D1 #8 / amendments: display phrases 1–5 words (same whitespace tokenizer as resolveTimeline).
    b.display?.forEach((d, j) => {
      const n = d.trim().split(/\s+/).filter(Boolean).length;
      if (n > MAX_DISPLAY_WORDS_SCHEMA) issue(`display phrase "${d}" has ${n} words (max ${MAX_DISPLAY_WORDS_SCHEMA})`, ["beats", i, "display", j], "L5b");
    });
    b.sourceIds.forEach((id, j) => sources.has(id) || issue(`unknown source "${id}"`, ["beats", i, "sourceIds", j]));
    b.camera.forEach((c, j) => checkTarget(c.target, ["beats", i, "camera", j, "target"]));
    b.actions.forEach((a, j) => {
      if (a.target !== "datafield" && a.target !== "header" && !instances.has(a.target)) issue(`unknown action target "${a.target}"`, ["beats", i, "actions", j, "target"]);
      if (a.props) for (const p of findRawColours(a.props)) issue(`raw colour in action props.${p.join(".")}`, ["beats", i, "actions", j, "props", ...p], "L2");
    });
  });
  if (s.cover && !beatIds.has(s.cover.beat)) issue(`cover: unknown beat "${s.cover.beat}"`, ["cover", "beat"]);
  s.componentRequests.forEach((r, i) => {
    if (!beatIds.has(r.forBeat)) issue(`componentRequests: unknown beat "${r.forBeat}"`, ["componentRequests", i, "forBeat"], "L14");
    if (!instances.has(r.fallback)) issue(`componentRequests "${r.name}": fallback instance "${r.fallback}" does not exist`, ["componentRequests", i, "fallback"], "L14");
  });
}

export const Storyboard = StoryboardObject.superRefine(crossRefs);

export type StoryboardInput = z.input<typeof Storyboard>;
export type Storyboard = z.output<typeof Storyboard>;
export type BeatT = Storyboard["beats"][number];
export type InstanceT = Storyboard["world"][number];
export type StationT = Storyboard["stations"][number];
export type CameraKeyT = BeatT["camera"][number];
export type ActionT = BeatT["actions"][number];
export type SfxT = BeatT["sfx"][number];
export type AtT = z.infer<typeof At>;
export type EaseT = z.infer<typeof Ease>;
export type PartT = z.infer<typeof Part>;
export type TokenT = z.infer<typeof Token>;
export type CameraTargetT = z.infer<typeof CameraTarget>;

// ── words.json (v1 TTS output format, src/audio/tts.ts) ──────────────────────────────────────────────────────────

export const WordTiming = z.object({ text: z.string(), startMs: z.number(), endMs: z.number() }).passthrough();
/** v1 writes beatId as a number (1-based); v2 may write "b01". Both map to storyboard beat ids. */
export const WordsFile = z
  .object({
    beats: z.array(z.object({ beatId: z.union([z.number().int().min(1), z.string().regex(/^b\d{2}$/)]), durationSec: z.number().positive(), words: z.array(WordTiming), file: z.string().optional() }).passthrough()),
    timingSource: z.string().optional(),
    voice: z.string().optional(),
    provider: z.string().optional(),
    /** true for synthetic timings (scripts/v2/synth-words.ts, fixtures). */
    synthetic: z.boolean().optional(),
  })
  .passthrough();
export type WordsFileT = z.infer<typeof WordsFile>;

export interface StoryboardParse {
  ok: boolean;
  value?: Storyboard;
  /** "path: message" strings; messages carry a [Ln] tag when a specific lint owns the rule. */
  errors: string[];
  issues: { path: string; message: string; lint: string }[];
}

const TAGGED = /^\[(L\d+b?)\]\s*/;

/** safeParse + flat errors. libraryVersion mismatches are reported as L15; everything untagged is L1. */
export function parseStoryboard(input: unknown): StoryboardParse {
  const r = Storyboard.safeParse(input);
  if (r.success) return { ok: true, value: r.data, errors: [], issues: [] };
  const issues = r.error.issues.map((i) => {
    const path = i.path.map(String).join(".");
    const m = TAGGED.exec(i.message);
    const lint = m ? m[1] : path === "libraryVersion" ? "L15" : "L1";
    return { path, message: m ? i.message.slice(m[0].length) : i.message, lint };
  });
  return { ok: false, errors: issues.map((i) => `${i.path || "(root)"}: ${i.message}`), issues };
}
