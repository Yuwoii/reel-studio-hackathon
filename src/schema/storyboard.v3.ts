// storyboard.json v3.0 — v2.1 + real-object SHOTS (ADR-002 §4, W3b; promoted from research/v3/R4/sketch/storyboard.v3.ts).
//
// v3 ADDS to v2.1, it does not fork it (ADR-002 §4.1, §9):
//   - world instances may be v3 library components (src/v3/components-meta: Plate, BrowserWindow, Phone, WatchBack,
//     ServerRack, Building, Envelope, Router, Headphones, Model3D + the overlays AnchorRing, LabelPill, Spotlight, Glow,
//     Trace), may carry an `asset` (pinned in `assets[]`) and may be BOUND to a named part of a real object
//     (`bind: {to: {instance, anchor}, dx, dy, space}`; space "screen" = keeps its pixel size under zoom → OverlayLayer);
//   - camera keys may target an anchor ({instance, anchor[, fill]}), zoom to 4× (the plate resolution cap is lint A4),
//     use the `snap` ease (lowered to pushOut 8–14 f until W4 adds a true snap bezier) and hard-cut (≤ 6 per reel, in
//     pauses: lint L8v3, D1 #5g);
//   - `travel` actions fly a prop along anchors (the sealed letter hops phone → router);
//   - `shots[]` say what each run of beats is ABOUT (subject instance + role) so lints, digest and judges can ask "is the
//     real thing on screen here?" (A7, A8, A9);
//   - per-beat `act`, `pauseAfterMs` (AUDIBLE gap, W2), `rate`, `claims`, `terms` carry the v3 script model; `leadMs`
//     (audible lead silence, W2) on the board.
//
// Pauses are data end to end: narrative.lines[].pauseAfterMs → beat.pauseAfterMs → TTS gap → resolveTimeline cursor
// (src/v2/timeline.ts, W2). `pauseAfterMs` / `leadMs` are OPTIONAL here on purpose: absent = the v2 semantics (GAP_MS,
// start 0), which is what an upgraded v2.1 board needs to lower back identically (ADR-002 §9, measured by the
// anti-example round-trip test). A v3-native board that leaves them out is flagged by lint A10/PA (W4 submit).
//
// lowerToV21() (src/v3/lower.ts) resolves every anchor to world px BEFORE resolveTimeline, so the v2 timeline, camera,
// blur windows and Explainer layers run on the lowered board. This module is container-side (zod); the Remotion bundle
// receives the PARSED board (like v2).

import { z } from "zod";
import { ANCHOR_NAME, ASSET_ID } from "../v3/assets/manifest.js";
import { V3_COMPONENT_IDS } from "../v3/components-meta/index.js";
import { LIBRARY_IDS } from "../v2/registry.gen.js";
import { At, Action, ACTION_VERBS, Beat, CameraKey, countFigNodes, findRawColours, Id, Instance, parseStoryboard, Sfx, Station, Storyboard, type Storyboard as StoryboardV21 } from "./storyboard.v2.js";

export const SCHEMA_V3 = "v3.0" as const;

/** v3 library ids by role (src/v3/components-meta `v3kind`): real objects are locked (never moved by the v2 stage fill). */
export const V3_REAL = ["Plate", "BrowserWindow", "Phone", "WatchBack", "ServerRack", "Building", "Envelope", "Router", "Headphones", "Model3D"] as const;
export const V3_OVERLAYS = ["AnchorRing", "LabelPill", "Spotlight", "Glow", "Trace"] as const;
/** Components that show a file asset (need `asset`, pinned in `assets[]`). */
export const FILE_ASSET_COMPONENTS = ["Plate", "Model3D"] as const;

/** R1 playbook acts → the v2 part tag every beat keeps (v2 lints / digest read `part`). */
export const ACTS = ["hook", "ground", "mechanism", "why", "tradeoff", "payoff", "cta"] as const;
export type ActT = (typeof ACTS)[number];
export const ACT_TO_PART = { hook: "hook", ground: "context", mechanism: "mechanism", why: "stakes", tradeoff: "twist", payoff: "closure", cta: "cta" } as const;
/** Parts a beat of each act may carry (upgraded v2 boards keep their own part tag). */
export const ACT_PARTS: Record<ActT, readonly string[]> = { hook: ["hook"], ground: ["context", "stakes"], mechanism: ["mechanism", "reveal"], why: ["stakes", "context"], tradeoff: ["twist"], payoff: ["closure", "climax"], cta: ["cta", "ask"] };
/** v2 part → act (upgradeV21). */
export const PART_TO_ACT: Record<string, ActT> = { hook: "hook", stakes: "why", reveal: "mechanism", twist: "tradeoff", mechanism: "mechanism", context: "ground", climax: "payoff", closure: "payoff", cta: "cta", ask: "cta" };

/** D1 #5g: up to 6 hard cuts per reel, placed in pauses (lint L8v3 checks the placement; this is the count cap). */
export const MAX_HARD_CUTS_V3 = 6;
/** ADR-002 §4.3: `snap` lowers to pushOut with this duration range (W3a snap probe: ≥ 14 f keeps small text clean). */
export const SNAP_DUR_F = { min: 8, max: 14, dflt: 14 } as const;

export const AnchorRef = z.object({ instance: Id, anchor: z.string().regex(ANCHOR_NAME, "anchor: dotted lowerCamel (urlbar.schemeS)") }).strict();
export type AnchorRefT = z.infer<typeof AnchorRef>;

/** Place an instance relative to a named part of a real object. world = moves and scales with the camera (a v2 diagram
 *  next to the rack, the envelope on the URL bar); screen = follows the anchor but keeps its pixel size (rings, pills,
 *  spotlights, glows → OverlayLayer). (dx, dy) = offset of the instance's own anchor point (meta.anchor, else its box
 *  centre) from the bound part, px in the binding space. */
export const Bind = z
  .object({
    to: AnchorRef,
    dx: z.number().min(-1000).max(1000).default(0),
    dy: z.number().min(-1600).max(1600).default(0),
    space: z.enum(["world", "screen"]).default("world"),
  })
  .strict();
export type BindT = z.output<typeof Bind>;

export const InstanceV3 = Instance.extend({
  /** v2 LIBRARY_IDS ∪ v3 V3_COMPONENT_IDS (cross-ref below). */
  component: z.string().regex(/^[A-Z][A-Za-z0-9]{2,30}$/),
  /** top-left in world px; required unless bound */
  x: z.number().optional(),
  y: z.number().optional(),
  /** v3 file components are laid out wider than v2 cards (a plate fills a 1080 stage at zoom 1, up to 2160) */
  w: z.number().min(60).max(2160).optional(),
  /** asset id (pinned with its version in `assets[]`): required for Plate / Model3D, informative for devices */
  asset: z.string().regex(ASSET_ID).optional(),
  bind: Bind.optional(),
  /** never moved / rescaled by the v2 stage fill (default true for real objects, set by lowering). It only LOCKS: an
   *  authored `locked: true` never makes an instance count as a real object (that comes from the component meta and
   *  its asset manifest only: lower.ts realIds, lints A7/A8/L7v3). */
  locked: z.boolean().optional(),
});
export type InstanceV3T = z.output<typeof InstanceV3>;

const CameraTargetV2 = [z.object({ station: Id }).strict(), z.object({ instance: Id }).strict(), z.object({ x: z.number(), y: z.number() }).strict()] as const;
/** + land ON a part of a real object. `fill` = share of the stage width the part's diameter (anchor r) should span; the
 *  zoom is then derived (capped 0.6–4, and by the plate's resolution in lint A4); without it `zoom` is used. */
export const AnchorTarget = AnchorRef.extend({ fill: z.number().min(0.05).max(1).optional() }).strict();
export const CameraTargetV3 = z.union([...CameraTargetV2, AnchorTarget]);
export type CameraTargetV3T = z.output<typeof CameraTargetV3>;

export const CAMERA_EASES_V3 = ["bible", "longPan", "pushOut", "snap"] as const;
export const CameraKeyV3 = CameraKey.extend({
  target: CameraTargetV3,
  /** v2 caps zoom at 2.2 (cards). Real objects go deeper (the hook zooms 3.2× onto the S of https); the real ceiling for
   *  a photo is its resolution (lint A4). */
  zoom: z.number().min(0.6).max(4),
  /** snap = the hook's fast ease-out push on the key word (8–14 f) */
  ease: z.enum(CAMERA_EASES_V3).default("bible"),
  durF: z.number().int().min(8, "camera durF 8–45 f").max(45, "camera durF ≤ 45 f: chain a second key for a longer drift").optional(),
});
export type CameraKeyV3T = z.output<typeof CameraKeyV3>;

/** + travel: a prop flies along anchors of other instances (the letter hops phone → Wi-Fi → router). */
export const ACTION_VERBS_V3 = [...ACTION_VERBS, "travel"] as const;
/** A travel waypoint: a named part + an optional WORLD-px offset from it (the letter stops just above the door so the
 *  door stays visible; it runs along a drawn cable from the router's port). */
export const ViaPoint = AnchorRef.extend({ dx: z.number().min(-1000).max(1000).optional(), dy: z.number().min(-1600).max(1600).optional() }).strict();
export type ViaPointT = z.output<typeof ViaPoint>;
export const ActionV3 = Action.extend({
  do: z.enum(ACTION_VERBS_V3),
  via: z.array(ViaPoint).min(1).max(6).optional(),
  durF: z.number().int().min(6).max(120).optional(),
});
export type ActionV3T = z.output<typeof ActionV3>;

export const TermUse = z
  .object({
    term: z.string().min(1).max(40),
    /** The beat whose picture shows the thing the term names (≥ 1.5 s on screen before the term is spoken: A9 / TA1). */
    pictureBeat: z.string().regex(/^b\d{2}$/),
    /** The part that IS the picture (optional; default = the picture beat's shot subject). */
    anchor: AnchorRef.optional(),
  })
  .strict();
export type TermUseT = z.output<typeof TermUse>;

export const BeatV3 = Beat.extend({
  act: z.enum(ACTS),
  camera: z.array(CameraKeyV3).max(3).default([]),
  /** v3: a hold with only a camera key, an SFX or a pause is legal (L7v3 checks that something still changes). */
  // ≤ 10 (v2: 5): a v3 line can walk a prop across several real objects (the TLS hook's b04: dots fill, the letter
  // enters, hops to the antenna, the port and along the cable, with ring/pill/trace labels on the way). W3b fix round.
  actions: z.array(ActionV3).max(10).default([]),
  sfx: z.array(Sfx).max(3).default([]),
  /** AUDIBLE silence after the beat's last word (W2: copied 1:1 from the narrative). Absent = v2 GAP_MS. */
  pauseAfterMs: z.number().int().min(0).max(1500).optional(),
  /** edge-tts prosody rate of this beat ("-12%"; D1 #3a). */
  rate: z.string().regex(/^[+-]\d{1,2}%$/).default("+0%"),
  /** claim ids (W1 claims.json) this beat's narration makes. */
  claims: z.array(z.string().regex(/^C\d{2}$/)).max(6).default([]),
  /** terms first SPOKEN in this beat. */
  terms: z.array(TermUse).max(2).default([]),
});
export type BeatV3T = z.output<typeof BeatV3>;

export const SHOT_ROLES = ["real", "analogy", "real+analogy", "cutaway", "diagram"] as const;
export type ShotRoleT = (typeof SHOT_ROLES)[number];
export const Shot = z
  .object({
    id: z.string().regex(/^s\d{2}$/),
    /** First beat of the shot; the shot runs until the next shot's fromBeat. */
    fromBeat: z.string().regex(/^b\d{2}$/),
    /** The instance that IS the shot (a real object, or the analogy prop sitting on one). */
    subject: Id,
    role: z.enum(SHOT_ROLES),
    /** cut = a hard cut starts it; move = the camera travels to it; match = same subject + framing as an earlier shot */
    enter: z.enum(["cut", "move", "match"]).default("cut"),
    matchOf: z.string().regex(/^s\d{2}$/).optional(),
  })
  .strict();
export type ShotT = z.output<typeof Shot>;

export const AssetUse = z.object({ id: z.string().regex(ASSET_ID), version: z.number().int().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict();
export type AssetUseT = z.output<typeof AssetUse>;

/** A real object the library does not have yet (ADR-002 §3): goes to the owner's ingest queue; never blocks a reel. */
export const AssetRequest = z
  .object({ depicts: z.string().min(5).max(160), anchorsNeeded: z.array(z.string().regex(ANCHOR_NAME)).max(6).default([]), forBeat: z.string().regex(/^b\d{2}$/), fallback: Id })
  .strict();

const V2 = Storyboard.shape;

export const StoryboardV3Object = z
  .object({
    schema: z.literal(SCHEMA_V3),
    // NO `origin` field (W3b fix round): an authored board cannot declare itself "upgraded" to skip the shot checks and
    // A7/A8/A11. The upgrade marker is out of band: upgradeV21() sets `origin` on the in-memory value only, and a
    // board carrying the key fails this strict parse.
    libraryVersion: z.string().min(1).max(24),
    series: V2.series,
    mode: V2.mode,
    family: V2.family,
    codename: V2.codename,
    headerMode: V2.headerMode,
    headerRight: V2.headerRight,
    headerSourceIds: V2.headerSourceIds,
    headerDot: V2.headerDot,
    /** v3: "none" = no data field (a real object fills the stage); the field stays available for diagram cutaways */
    datafield: z.object({ preset: z.enum(["none", "hex", "logs", "process", "nodes", "lattice", "matrix", "book", "certs"]), seed: z.string().min(1).max(40) }).strict(),
    captions: V2.captions,
    blur: V2.blur,
    music: V2.music,
    sources: V2.sources,
    /** Audible silence before the first word, the picture already on screen (R1 §2.3: 500–700 ms). Absent = v2 (0). */
    leadMs: z.number().int().min(0).max(1200).optional(),
    assets: z.array(AssetUse).max(12).default([]),
    shots: z.array(Shot).min(1).max(16),
    stations: V2.stations,
    world: z.array(InstanceV3).max(48),
    camera0: z.object({ target: CameraTargetV3, zoom: z.number().min(0.6).max(4), tiltX: z.number().min(0).max(25).default(0) }).strict().optional(),
    /** ≥ 4 so a hook fragment (the W3b TLS hook board) parses; the director's save requires ≥ 10 (W4 contract). */
    beats: z.array(BeatV3).min(4).max(40),
    cover: V2.cover,
    componentRequests: V2.componentRequests,
    assetRequests: z.array(AssetRequest).max(3).default([]),
  })
  .strict();

type StoryboardV3Out = z.output<typeof StoryboardV3Object>;
const KNOWN_COMPONENTS = new Set<string>([...LIBRARY_IDS, ...V3_COMPONENT_IDS]);

function crossRefsV3(s: StoryboardV3Out, ctx: z.RefinementCtx): void {
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
  dupes(s.shots.map((x) => x.id), "shot", "shots");
  dupes(s.assets.map((x) => x.id), "asset", "assets");
  const stations = new Set(s.stations.map((x) => x.id));
  const inst = new Map(s.world.map((x) => [x.id, x]));
  const sources = new Set(s.sources.map((x) => x.id));
  const pinned = new Set(s.assets.map((a) => a.id));
  const beatIds = s.beats.map((b) => b.id);
  const refOk = (r: AnchorRefT, path: (string | number)[]) => {
    if (!inst.has(r.instance)) issue(`unknown instance "${r.instance}" (anchor ${r.anchor})`, path);
  };
  const checkTarget = (t: CameraTargetV3T, path: (string | number)[]) => {
    if ("station" in t && !stations.has(t.station)) issue(`unknown station "${t.station}"`, path);
    else if ("anchor" in t) refOk(t, path);
    else if ("instance" in t && !inst.has(t.instance)) issue(`unknown instance "${t.instance}"`, path);
  };

  s.world.forEach((i, k) => {
    const p = ["world", k];
    if (!KNOWN_COMPONENTS.has(i.component)) issue(`instance "${i.id}": unknown component ${i.component}`, [...p, "component"]);
    if (!stations.has(i.station)) issue(`instance "${i.id}": unknown station "${i.station}"`, [...p, "station"]);
    if (i.asset && !pinned.has(i.asset)) issue(`instance "${i.id}": asset ${i.asset} is not pinned in assets[]`, [...p, "asset"], "A2");
    if ((FILE_ASSET_COMPONENTS as readonly string[]).includes(i.component) && !i.asset) issue(`instance "${i.id}": ${i.component} needs an asset`, p);
    if (i.bind) {
      refOk(i.bind.to, [...p, "bind", "to"]);
      if (i.bind.to.instance === i.id) issue(`instance "${i.id}" is bound to itself`, [...p, "bind"]);
    } else if (i.x === undefined || i.y === undefined) issue(`instance "${i.id}": x/y required unless bound`, p);
    if ((V3_OVERLAYS as readonly string[]).includes(i.component) && !i.bind) issue(`instance "${i.id}": ${i.component} must be bound to an anchor`, p);
    if ((V3_OVERLAYS as readonly string[]).includes(i.component) && i.bind?.space === "world") issue(`instance "${i.id}": ${i.component} is a screen overlay (bind.space "screen")`, [...p, "bind", "space"]);
    if (i.component === "Figure") {
      if (!i.figure?.length) issue(`instance "${i.id}": a Figure needs figure nodes`, [...p, "figure"]);
      const n = countFigNodes(i.figure);
      if (n > 80) issue(`instance "${i.id}": Figure has ${n} nodes (max 80)`, [...p, "figure"], "L13");
    } else if (i.figure) issue(`instance "${i.id}": only a Figure takes figure nodes`, [...p, "figure"]);
    i.sourceIds.forEach((id, j) => sources.has(id) || issue(`unknown source "${id}"`, [...p, "sourceIds", j]));
    for (const q of findRawColours(i.props)) issue(`instance "${i.id}": raw colour in props.${q.join(".")} (use a Tone/Token name)`, [...p, "props", ...q], "L2");
  });
  // bind chains must end on an unbound instance (no cycles)
  for (const i of s.world) {
    const seen = new Set<string>([i.id]);
    let cur = i;
    while (cur.bind) {
      const nxt = inst.get(cur.bind.to.instance);
      if (!nxt) break;
      if (seen.has(nxt.id)) {
        issue(`instance "${i.id}": bind cycle via "${nxt.id}"`, ["world", s.world.indexOf(i), "bind"]);
        break;
      }
      seen.add(nxt.id);
      cur = nxt;
    }
  }
  if (s.camera0) checkTarget(s.camera0.target, ["camera0", "target"]);
  s.headerSourceIds.forEach((id, j) => sources.has(id) || issue(`unknown source "${id}"`, ["headerSourceIds", j]));

  {
    s.shots.forEach((sh, k) => {
      if (!inst.has(sh.subject)) issue(`shot ${sh.id}: unknown subject "${sh.subject}"`, ["shots", k, "subject"]);
      if (!beatIds.includes(sh.fromBeat)) issue(`shot ${sh.id}: unknown beat ${sh.fromBeat}`, ["shots", k, "fromBeat"]);
      if (k === 0 && sh.fromBeat !== "b01") issue("the first shot starts at b01 (first concrete image ≤ 1 s)", ["shots", 0, "fromBeat"], "A7");
      if (k > 0 && beatIds.indexOf(sh.fromBeat) <= beatIds.indexOf(s.shots[k - 1].fromBeat)) issue(`shot ${sh.id}: shots run in beat order, one per fromBeat`, ["shots", k, "fromBeat"]);
      if (sh.enter === "match" && !s.shots.slice(0, k).some((o) => o.id === sh.matchOf)) issue(`shot ${sh.id}: enter "match" needs matchOf = an earlier shot`, ["shots", k, "matchOf"]);
    });
  }
  let cuts = 0;
  s.beats.forEach((b, k) => {
    const p = ["beats", k];
    const want = `b${String(k + 1).padStart(2, "0")}`;
    if (b.id !== want) issue(`beat ${k + 1} must have id "${want}" (got "${b.id}")`, [...p, "id"]);
    b.display?.forEach((d, j) => {
      const n = d.trim().split(/\s+/).filter(Boolean).length;
      if (n > 5) issue(`display phrase "${d}" has ${n} words (max 5)`, [...p, "display", j], "L5b");
    });
    b.sourceIds.forEach((id, j) => sources.has(id) || issue(`unknown source "${id}"`, [...p, "sourceIds", j]));
    b.camera.forEach((c, j) => {
      checkTarget(c.target, [...p, "camera", j, "target"]);
      if (c.transition === "hardCut") cuts++;
      if (c.ease === "snap" && c.durF !== undefined && c.durF > SNAP_DUR_F.max) issue(`snap move ${c.durF} f: a snap is ${SNAP_DUR_F.min}–${SNAP_DUR_F.max} f (use pushOut for slower)`, [...p, "camera", j, "durF"]);
    });
    b.actions.forEach((a, j) => {
      const q = [...p, "actions", j];
      if (a.target !== "datafield" && a.target !== "header" && !inst.has(a.target)) issue(`unknown action target "${a.target}"`, [...q, "target"]);
      if (a.do === "travel") {
        if (!a.via?.length) issue("travel needs via (anchors to fly along)", q);
        if (a.target === "datafield" || a.target === "header") issue("travel needs an instance target", q);
      } else if (a.via) issue("only travel takes via", q);
      a.via?.forEach((v, m) => refOk(v, [...q, "via", m]));
      if (a.props) for (const r of findRawColours(a.props)) issue(`raw colour in action props.${r.join(".")}`, [...q, "props", ...r], "L2");
    });
    b.terms.forEach((t, j) => {
      const pi = beatIds.indexOf(t.pictureBeat);
      if (pi < 0) issue(`term "${t.term}": unknown pictureBeat ${t.pictureBeat}`, [...p, "terms", j]);
      else if (pi > k) issue(`term "${t.term}": its picture (${t.pictureBeat}) comes after the term (A9/TA1)`, [...p, "terms", j], "A9");
      if (t.anchor) refOk(t.anchor, [...p, "terms", j, "anchor"]);
    });
    if (!ACT_PARTS[b.act].includes(b.part)) issue(`part ${b.part} does not fit act ${b.act} (${ACT_PARTS[b.act].join("/")})`, [...p, "part"]);
  });
  if (cuts > MAX_HARD_CUTS_V3) issue(`${cuts} hard cuts (max ${MAX_HARD_CUTS_V3}, D1 #5g)`, ["beats"], "L8v3");
  if (s.cover && !beatIds.includes(s.cover.beat)) issue(`cover: unknown beat "${s.cover.beat}"`, ["cover", "beat"]);
  s.componentRequests.forEach((r, i) => {
    if (!beatIds.includes(r.forBeat)) issue(`componentRequests: unknown beat "${r.forBeat}"`, ["componentRequests", i, "forBeat"], "L14");
    if (!inst.has(r.fallback)) issue(`componentRequests "${r.name}": fallback instance "${r.fallback}" does not exist`, ["componentRequests", i, "fallback"], "L14");
  });
  s.assetRequests.forEach((r, i) => {
    if (!beatIds.includes(r.forBeat)) issue(`assetRequests: unknown beat "${r.forBeat}"`, ["assetRequests", i, "forBeat"]);
    if (!inst.has(r.fallback)) issue(`assetRequests: fallback instance "${r.fallback}" does not exist`, ["assetRequests", i, "fallback"]);
  });
}

export const StoryboardV3 = StoryboardV3Object.superRefine(crossRefsV3);
export type StoryboardV3Input = z.input<typeof StoryboardV3>;
/** Parsed board. `origin` is NOT a schema field: only upgradeV21() sets it (in memory), so lints can refuse an upgraded
 *  v2.1 board (lint V0) and the lowering can strip it; JSON carrying `origin` fails the strict parse. */
export type StoryboardV3T = z.output<typeof StoryboardV3> & { origin?: "v2.1" };

export interface StoryboardV3Parse {
  ok: boolean;
  value?: StoryboardV3T;
  /** the schema the input carried ("v2.1" boards are upgraded) */
  from?: "v2.1" | "v3.0";
  errors: string[];
  issues: { path: string; message: string; lint: string }[];
}

const TAGGED = /^\[([A-Z]\d+(?:b|v3)?)\]\s*/;

export function parseStoryboardV3(input: unknown): StoryboardV3Parse {
  const r = StoryboardV3.safeParse(input);
  if (r.success) return { ok: true, value: r.data, from: "v3.0", errors: [], issues: [] };
  const issues = r.error.issues.map((i) => {
    const path = i.path.map(String).join(".");
    const m = TAGGED.exec(i.message);
    return { path, message: m ? i.message.slice(m[0].length) : i.message, lint: m ? m[1] : "L1" };
  });
  return { ok: false, from: "v3.0", errors: issues.map((i) => `${i.path || "(root)"}: ${i.message}`), issues };
}

/**
 * v2.1 → v3.0, losslessly (ADR-002 §9): every v2 field kept as is; act derived from part; one "diagram" shot over the
 * whole reel; NO leadMs / pauseAfterMs (v2 timing) — so lowerToV21(upgradeV21(sb)).board deep-equals sb and the timeline
 * is identical (test/v3-w3-schema.test.ts on the owner's anti-example).
 */
export function upgradeV21(sb: StoryboardV21): StoryboardV3T {
  return {
    ...(sb as unknown as StoryboardV3T),
    schema: SCHEMA_V3,
    origin: "v2.1",
    assets: [],
    assetRequests: [],
    shots: [{ id: "s01", fromBeat: "b01", subject: sb.world[0]?.id ?? "none", role: "diagram", enter: "cut" }],
    beats: sb.beats.map((b) => ({ ...b, act: PART_TO_ACT[b.part], rate: "+0%", claims: [], terms: [] })) as unknown as StoryboardV3T["beats"],
  };
}

/** Route on `schema`: "v2.1" → v2 parse + upgradeV21; "v3.0" → v3 parse. Errors keep their lint tags. */
export function parseAnyStoryboard(input: unknown): StoryboardV3Parse {
  const schema = input && typeof input === "object" ? (input as { schema?: unknown }).schema : undefined;
  if (schema === SCHEMA_V3) return parseStoryboardV3(input);
  if (schema === "v2.1") {
    const r = parseStoryboard(input);
    if (!r.ok || !r.value) return { ok: false, from: "v2.1", errors: r.errors, issues: r.issues };
    return { ok: true, from: "v2.1", value: upgradeV21(r.value), errors: [], issues: [] };
  }
  const msg = `schema: expected "v3.0" or "v2.1" (got ${JSON.stringify(schema)})`;
  return { ok: false, errors: [msg], issues: [{ path: "schema", message: msg, lint: "L1" }] };
}

export { At, Station };
