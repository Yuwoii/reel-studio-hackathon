// v3 lints (ADR-002 §5): pure TypeScript, $0, on every save. They judge the LOWERED board through the same
// resolveTimeline the renderer uses (lint frame N = rendered frame N), plus the shot / asset / anchor data only v3 has.
//
//   V0  the board is a v3-native board: an upgraded v2.1 board (parseAnyStoryboard → upgradeV21) has no real-object
//       shots and is refused unless the caller opts in (allowUpgraded: renderer parity / round-trip tooling)      block
//   A1  every asset used is allowed by the owner's D1 policy (class, licence, provenance, marks, live 3D) and fits the
//       component that shows it                                                                    block
//   A2  assets[] pins a version (and sha) the registry and the deployed site carry; v3 site hash not stale     block
//   A3  a plate's visible part at every settled frame stays inside its safeCrop                                error
//   A4  plate zoom ≤ plateMaxZoom (file w / layout w × 1.25; devices are vector and exempt)                    error
//   A5  screen overlays at their settled frames sit in the safe zone, clear of the caption card; the ring/dot
//       sits on its part (bind offset ≤ 12 px); a bound part must not move with a later host state change
//       (binds are resolved once: the bound instance would not follow)                                          error
//   A6  plate tone: p99 luma / mean saturation within the policy limits                                         error
//   A7  first concrete image ≤ 1 s: shot s01 is real / real+analogy, on screen by frame 30, ≥ 25 % of the stage  block
//   A8  every mechanism beat shows a real object (≥ 25 % visible, shot role real / real+analogy / cutaway), or a
//       DIAGRAM (v2 component or Trace; not a bare ring / pill / spotlight / glow) bound to a ≥ 25 % visible one  error
//   A9  term after picture: the term is spoken ≥ 45 f (1.5 s) after its picture is on screen, and the picture is
//       still on screen when it is spoken                                                                       error
//   A10 filled silence: every pause ≥ 600 ms holds a camera key, an SFX, an action or a travel                   warn
//   A11 the payoff shot matches the hook shot (enter "match", same subject, zoom within ±15 %)                  warn
//   A12 each CC BY asset's attribution is in the job's caption text                                             block
//   A13 no overlay label text the voice does not say (words already on the object, e.g. the host, exempt)      error
//   A14 nothing cut off at the frame edge (2026-11-04, W4 round-2 review: router / servers / inset callout / URL
//       sliced by the edge). At every beat's settled frame, in the visible window x 0–1080 × y 218–1560 (header band
//       to the hairline above the caption band): (a) an `edge` part (text, readout, inset callout: AnchorPx.edge, box
//       = AnchorPx.box) of an object the beat is ABOUT (shot subject, action / camera target) is never partly shown
//       (a macro close-up, zoom ≥ 3 on another part of the same object, may crop it); (b) such an object (its
//       meta.content box, else its footprint) that fits the window is never cut by more than 15 % of its size while
//       ≥ 25 % of it is shown. Context objects peeking into a wide shot are not judged; overlays are A5's     block
//   A15 no dead stretch: > 2.5 s (75 f) where nothing on screen changes — no camera move / cut, no visible action
//       (enter, exit, a REAL state change, pulse, focus, travel), no header change, and no continuously animated
//       component (meta.continuous: vessels beating, waves scrolling) at ≥ 35 % of the frame width. Block when the
//       stretch covers ≥ 75 f of a mechanism / why line, warn elsewhere                                     block/warn
//   A16 the picture of a mechanism line is big enough: the largest object the beat is about (meta.content, else its
//       footprint; clipped to the frame) spans ≥ 35 % of the frame width at the settled frame                 block
//   A17 a mechanism line whose words match a mechanism component's whenToUse shows that component (≥ 25 % on
//       screen at the settled frame); names the component (and an instance re-entered after its exit)          warn
//   A18 a state animation started in a beat (meta.animWindows: a WeeksPoster fill wave) is done by that beat's still
//       frame (keyword + 6, past camera moves); L1 also blocks a state the props cannot draw (meta.stateIssue:
//       seg5 on a 3-share poster) (2026-11-10, rs-20261109-25f1a4)                                             block
//   softened v2 rules (ADR-002 §5, D1 #5g):
//   L7v3 something changes every beat — a camera key, action, SFX or header; a held REAL object in a non-analogy
//        shot counts (drift)                                                                                    warn
//   L8v3 ≤ 6 hard cuts, each starting in a pause (at/after the previous phrase's last word end) or ≤ 4 f after a
//        phrase start                                                                                            error
//   L9v3 camera peak ≤ 150 px/f; ≤ 190 px/f for moves onto a real object (W3a snap probe, not ADR's 280); no
//        tilted camera (tiltX > 0) while a real object or an anchor target is framed (projection is flat)       error
//
// NOT run here (W3b fix round, deferred to W4): the v2 battery (src/v2/lints.ts lintStoryboard: caption collisions,
// text ghosting L18, …). It re-parses v2.1 and refuses v3 ids / zoom > 2.2, so it needs a parse-free entry with a v3
// LintOptions profile. A v3 "0 block / 0 error / 0 warn" covers the v3 set above only.
//
// The licence/policy check of every asset used = A1 + A2 + A6 + A12.

import type { AssetManifestT, AssetPolicyT } from "./assets/manifest.js";
import { allowedBy, captionCredits, plateMaxZoom } from "./assets/manifest.js";
import { ASSET_ALLOWED, ASSET_POLICY, ASSETS } from "./assets.gen.js";
import { V3_METAS } from "./components-meta/index.js";
import type { AnyV3Meta } from "./components-meta/_types.js";
import { lowerToV21, makeLowerLib, propsStateAt, resolveTravels, travelOffset, travelPeakPxPerF, v3RegistryEntries, overlayAnchorAt, type LookupLike, type Lowered, type LowerLib, type ResolvedTravel, type ScreenOverlay } from "./lower.js";
import { area, FRAME, intersect, OVERLAY_SAFE, onScreenShare, rectToScreen, stageCover, worldToScreen, type Cam, type Pt, type Rect } from "./project.js";
import type { ShotT, StoryboardV3T } from "../schema/storyboard.v3.js";
import type { WordsFileT } from "../schema/storyboard.v2.js";
import type { LintResult, Severity } from "../v2/lints.js";
import { LIBRARY_LOOKUP, parseInstanceProps } from "../v2/library.js";
import { buildFootprintLookup, type LookupEntry } from "../v2/components-meta/_lookup.js";
import type { AnyComponentMeta } from "../v2/components-meta/_types.js";
import { cameraAt, captionCardAt, findSeq, fitStoryboard, msToFrame, normToken, resolveTimeline, settledOf, tokenize, type FootprintLookup, type Timeline } from "../v2/timeline.js";

export type { LintResult, Severity };

// ── the container's v3 library (v2 lookup + v3 metas + the generated asset index) ─────────────────────────────────

let LOOKUP: FootprintLookup | null = null;
/** v2 LIBRARY_LOOKUP ∪ the v3 components (props-aware footprints, own anchors): what resolveTimeline / culling use. */
export function v3Lookup(): FootprintLookup {
  if (!LOOKUP) {
    const v3 = buildFootprintLookup(v3RegistryEntries(V3_METAS) as unknown as Record<string, LookupEntry>, V3_METAS as unknown as Record<string, AnyComponentMeta>);
    LOOKUP = { ...LIBRARY_LOOKUP, ...v3 } as FootprintLookup;
  }
  return LOOKUP;
}
let LIB: LowerLib | null = null;
export function v3Lib(): LowerLib {
  if (!LIB) LIB = makeLowerLib(v3Lookup() as unknown as Record<string, LookupLike>, V3_METAS, ASSETS);
  return LIB;
}

// ── scene: lowered board + timeline + per-frame geometry (shared with src/v3/digest.ts) ─────────────────────────────

export interface SceneV3 {
  sb: StoryboardV3T;
  lowered: Lowered;
  tl: Timeline;
  travels: ResolvedTravel[];
  lookup: FootprintLookup;
  lib: LowerLib;
  cam: (f: number) => Cam;
  /** world box of a world instance at frame f (travel applied); null for screen overlays / unknown */
  boxAt: (id: string, f: number) => Rect | null;
  /** inside its enter → exit window at frame f (8 f exit fade counted) */
  liveAt: (id: string, f: number) => boolean;
  /** live AND at least `share` of its box on the frame */
  visibleAt: (id: string, f: number, share?: number) => boolean;
  /** screen-overlay footprint (screen px) at frame f */
  overlayBoxAt: (o: ScreenOverlay, f: number) => Rect | null;
  /** the shot a beat belongs to */
  shotOf: (beatIndex: number) => ShotT | undefined;
  /** first frame of each hard cut */
  cutFrames: number[];
  metaOf: (component: string) => AnyV3Meta | undefined;
  isReal: (id: string) => boolean;
  /** true = the v2 stage fill was applied, as the renderer does when nothing is locked (upgraded v2 boards) */
  fitted: boolean;
}

export function sceneV3(sb: StoryboardV3T, words: WordsFileT | null | undefined, opts: { lib?: LowerLib; lookup?: FootprintLookup } = {}): SceneV3 {
  const lib = opts.lib ?? v3Lib();
  const lookup = opts.lookup ?? v3Lookup();
  const lowered = lowerToV21(sb, lib);
  // = remotion/v3/ExplainerV3.tsx buildSceneV3: the v2 stage fill runs only when nothing is locked (lint frame N =
  // rendered frame N for upgraded v2 boards too).
  const fitted = !lowered.locked.length;
  if (fitted) lowered.board = fitStoryboard(lowered.board, words ?? null, lookup).sb;
  const tl = resolveTimeline(lowered.board, words ?? null, lookup);
  const travels = resolveTravels(lowered.travels, tl);
  const enterExit = new Map<string, { enterF: number | null; exitF: number | null }>();
  for (const e of tl.events) {
    if (e.kind !== "action") continue;
    const cur = enterExit.get(e.target) ?? { enterF: null, exitF: null };
    if (e.do === "enter" && (cur.enterF === null || e.frame < cur.enterF)) cur.enterF = e.frame;
    if (e.do === "exit" && (cur.exitF === null || e.frame < cur.exitF)) cur.exitF = e.frame;
    enterExit.set(e.target, cur);
  }
  const cam = (f: number): Cam => {
    const c = cameraAt(tl, f);
    return { x: c.x, y: c.y, zoom: c.zoom };
  };
  const baseBox = new Map<string, Rect>();
  for (const [id, p] of Object.entries(lowered.placed)) if (!lowered.screenOverlays.some((o) => o.id === id)) baseBox.set(id, p.box);
  const boxAt = (id: string, f: number): Rect | null => {
    const b = baseBox.get(id);
    if (!b) return null;
    const d = travelOffset(travels, id, f);
    return { x: b.x + d.x, y: b.y + d.y, w: b.w, h: b.h };
  };
  const liveAt = (id: string, f: number): boolean => {
    const t = enterExit.get(id);
    if (!t) return true;
    return (t.enterF === null || f >= t.enterF) && (t.exitF === null || f < t.exitF + 8);
  };
  const ovIds = new Map(lowered.screenOverlays.map((o) => [o.id, o]));
  const overlayBoxAt = (o: ScreenOverlay, f: number): Rect | null => {
    const size = lib.size(o.component, o.props, undefined);
    if (!size) return null;
    const own = lib.ownAnchor(o.component, o.props, undefined) ?? { x: size.w / 2, y: size.h / 2 };
    const s = worldToScreen(cam(f), overlayAnchorAt(o, travels, f));
    return { x: s.x + o.dx - own.x, y: s.y + o.dy - own.y, w: size.w, h: size.h };
  };
  const visibleAt = (id: string, f: number, share = 0.01): boolean => {
    if (!liveAt(id, f)) return false;
    const o = ovIds.get(id);
    if (o) {
      if (!liveAt(o.to.instance, f)) return false;
      const b = overlayBoxAt(o, f);
      return !!b && !!intersect(b, { x: 0, y: 0, w: FRAME.w, h: FRAME.h });
    }
    const b = boxAt(id, f);
    return !!b && onScreenShare(cam(f), b) >= share;
  };
  const shotOf = (bi: number): ShotT | undefined => {
    let hit: ShotT | undefined;
    for (const s of sb.shots) if (sb.beats.findIndex((b) => b.id === s.fromBeat) <= bi) hit = s;
    return hit;
  };
  const isReal = (id: string) => lowered.real.includes(id);
  return { sb, lowered, tl, travels, lookup, lib, cam, boxAt, liveAt, visibleAt, overlayBoxAt, shotOf, cutFrames: tl.hardCuts, metaOf: (c) => lib.v3meta(c), isReal, fitted };
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface V3LintOptions {
  lib?: LowerLib;
  lookup?: FootprintLookup;
  /** the owner's D1 policy (default: the generated ASSET_POLICY = data/asset-policy.json) */
  policy?: AssetPolicyT;
  /** manifests (default: the generated ASSETS) */
  assets?: readonly AssetManifestT[];
  /** A12: the post caption the studio drop will carry (CC BY credits must be in it). */
  captionText?: string;
  /** A2: "id@v" refs of file assets the deployed site carries (remotion/v3/assetUrls.gen.ts keys at deploy). */
  siteAssetRefs?: readonly string[];
  /** A2: v3 library hash stamped on the site vs the current sources. */
  pinnedV3Hash?: string;
  currentV3Hash?: string;
  /** L9v3 caps (px/f) */
  speedCapPx?: number;
  realSpeedCapPx?: number;
  /** V0: accept an upgraded v2.1 board (round-trip / renderer-parity tooling only). Default false → block. */
  allowUpgraded?: boolean;
}

export interface V3LintReport {
  ok: boolean;
  blocked: boolean;
  counts: Record<Severity, number>;
  results: LintResult[];
  scene?: SceneV3;
}

export const A_LIMITS = {
  firstImageF: 30,
  firstImageStageShare: 0.25,
  termLeadF: 45,
  filledPauseMs: 600,
  matchZoomTol: 0.15,
  leaderPx: 12,
  speedCapPx: 150,
  /** W3a snap probe (research/v3/W3a/snapprobe.json): above ~190 px/f the 32-sample tent leaves > 3 px between
   *  sub-samples and small text streaks; ADR §5's 280 would show striation. */
  realSpeedCapPx: 190,
  cutTolF: 4,
  safeCropTol: 0.01,
  /** A14: px an edge may overshoot before it counts (anti-aliasing / rounding) */
  edgeTolPx: 8,
  /** A14b: a whole object the beat is about may be cut by at most this share of its size … */
  cutShare: 0.15,
  /** … and only counts while at least this share of it is in the window (a peek from off frame is not a cut) */
  cutMinShown: 0.25,
  /** A14a: zoom from which a close-up on one part may crop the object's other edge parts */
  macroZoom: 3,
  /** A15: longest stretch with nothing changing (75 f = 2.5 s) */
  staticMaxF: 75,
  /** A15: a continuously animated component counts as change only at ≥ this share of the frame width */
  staticAnimMinShare: 0.35,
  /** A16: the main picture of a mechanism line spans ≥ this share of the frame width */
  mainMinShare: 0.35,
} as const;

/** A14's visible window (screen px): full width, header band (218) to the hairline (1560) above the caption band. */
export const A14_WINDOW: Readonly<Rect> = { x: 0, y: 218, w: FRAME.w, h: 1560 - 218 };

/** A3's visible band (screen y). */
export const A3_BAND = { y0: 218, y1: 1560 } as const;

const OVERLAY_TEXT_PROPS: Record<string, readonly string[]> = { LabelPill: ["text"], Glow: ["label"] };

export function lintStoryboardV3(sb: StoryboardV3T, words: WordsFileT | null | undefined, opts: V3LintOptions = {}): V3LintReport {
  const out: LintResult[] = [];
  const add = (id: string, severity: Severity, message: string, extra: Partial<LintResult> = {}) => out.push({ id, severity, message, ...extra });
  const policy = opts.policy ?? ASSET_POLICY;
  const manifests = opts.assets ?? ASSETS;
  const manifestOf = (id: string, v?: number) => manifests.find((m) => m.id === id && (v === undefined || m.version === v));
  const finish = (scene?: SceneV3): V3LintReport => {
    const counts = { block: 0, error: 0, warn: 0 } as Record<Severity, number>;
    for (const r of out) counts[r.severity]++;
    return { ok: counts.block === 0 && counts.error === 0, blocked: counts.block > 0, counts, results: out, scene };
  };

  // V0: an upgraded v2.1 board is not a v3 board (no real-object shots): refuse unless the caller opts in
  const upgraded = sb.origin === "v2.1";
  if (upgraded && !opts.allowUpgraded) add("V0", "block", "upgraded v2.1 board: it has no real-object shots, so A7 (first concrete image) and A8 (mechanism on a real object) cannot hold; write a v3.0 board (submit refuses v2.1)");

  // ── asset policy / pins (A1, A2, A6, A12): no timeline needed ───────────────────────────────────────────────
  const used = new Map<string, AssetManifestT>();
  for (const a of sb.assets) {
    const m = manifestOf(a.id, a.version);
    if (!m) {
      const any = manifestOf(a.id);
      add("A2", "block", any ? `asset ${a.id}@${a.version}: the registry carries ${a.id}@${any.version}, not @${a.version}` : `asset ${a.id}: not in the asset registry`, { path: "assets" });
      continue;
    }
    used.set(a.id, m);
    if (a.sha256 && m.file && a.sha256 !== m.file.sha256) add("A2", "block", `asset ${a.id}@${a.version}: pinned sha ${a.sha256.slice(0, 12)}… ≠ registry ${m.file.sha256.slice(0, 12)}…`, { path: "assets" });
    if (m.file && opts.siteAssetRefs && !opts.siteAssetRefs.includes(`${m.id}@${m.version}`)) add("A2", "block", `asset ${m.id}@${m.version}: the deployed site does not carry its file (redeploy the v3 site)`, { path: "assets" });
    const verdict = opts.policy || opts.assets ? allowedBy(m, policy) : (ASSET_ALLOWED[`${m.id}@${m.version}`] ?? allowedBy(m, policy));
    if (!verdict.ok) add("A1", "block", `asset ${m.id}@${m.version} not allowed by the D1 policy: ${verdict.why}`, { path: "assets" });
    if (m.tone && (m.tone.p99Luma > policy.tone.maxP99Luma || m.tone.meanSat > policy.tone.maxMeanSat)) add("A6", "error", `plate ${m.id}@${m.version}: tone p99 luma ${m.tone.p99Luma} / mean saturation ${m.tone.meanSat} over the limits (${policy.tone.maxP99Luma} / ${policy.tone.maxMeanSat})`, { path: "assets" });
  }
  if (opts.pinnedV3Hash && opts.currentV3Hash && opts.pinnedV3Hash !== opts.currentV3Hash) add("A2", "block", `v3 site is stale: site hash ${opts.pinnedV3Hash.slice(0, 12)}… ≠ sources ${opts.currentV3Hash.slice(0, 12)}… (redeploy reel-studio-v3-*)`);
  sb.world.forEach((i) => {
    const m = i.asset ? used.get(i.asset) : undefined;
    if (!m) return;
    const kindOk = i.component === "Plate" ? m.kind === "photo" || m.kind === "capture" : i.component === "Model3D" ? m.kind === "model3d" : m.kind === "device" && m.component === i.component;
    if (!kindOk) add("A1", "block", `instance ${i.id}: ${i.component} cannot show asset ${m.id} (${m.kind}${m.component ? ` / ${m.component}` : ""})`, { path: `world.${i.id}.asset` });
  });
  const credits = captionCredits([...used.values()]);
  for (const c of credits) {
    if (opts.captionText === undefined) add("A12", "block", `CC BY asset used: the caption must carry "${c}" (no caption text given)`);
    else if (!opts.captionText.includes(c)) add("A12", "block", `CC BY credit missing from the caption: "${c}"`);
  }

  // ── geometry / timing lints ───────────────────────────────────────────────────────────────────────────────────
  let scene: SceneV3;
  try {
    scene = sceneV3(sb, words, { lib: opts.lib, lookup: opts.lookup });
  } catch (e) {
    add("L1", "block", `lowering failed: ${(e as Error).message}`);
    return finish();
  }
  for (const i of scene.lowered.issues) add("L1", "block", `lowering: ${i.message}`, { path: i.path });
  // L1 props (2026-11-03, anc 57–61 s): every instance's props against its component's schema, v3 and v2 alike. The
  // v2 carry-over drops v2 L1 (verb rules misfire on v3 ids), so a v2 diagram with a too-long label used to reach the
  // render and draw as the PlaceholderCard (an empty "SIGNALTRACE" panel). Checked on the LOWERED props (what renders).
  for (const li of scene.lowered.board.world) {
    const raw = (li.props ?? {}) as Record<string, unknown>;
    const m3 = opts.lib?.v3meta(li.component) ?? V3_METAS[li.component];
    const res = m3 ? m3.propsSchema.safeParse(raw) : parseInstanceProps(li.component, raw);
    if (!res) continue;
    const ok = "success" in res ? res.success : res.ok;
    if (ok) continue;
    const why = "success" in res ? res.error.issues.map((q: { path: PropertyKey[]; message: string }) => `${q.path.map(String).join(".") || "(props)"}: ${q.message}`).join("; ") : res.error;
    add("L1", "block", `instance "${li.id}" (${li.component}) props do not parse — it would render as an empty placeholder card: ${why}`, { path: `world.${li.id}.props` });
  }
  const { tl, lowered } = scene;
  const last = tl.durationF - 1;
  const settled = tl.beats.map((b) => settledOf(tl, b));
  const native = !upgraded;

  // A3 / A4: plates at every settled frame (+ the frame before each next camera move = the hold end)
  const holdEnds = tl.cameraSegments.map((s) => Math.max(0, s.startF - 1));
  const checkFrames = [...new Set([...settled, ...holdEnds])].filter((f) => f >= 0 && f <= last).sort((a, b) => a - b);
  for (const i of sb.world) {
    if (i.component !== "Plate" || !i.asset) continue;
    const m = used.get(i.asset);
    if (!m) continue;
    const reported = { a3: false, a4: false };
    for (const f of checkFrames) {
      if (!scene.visibleAt(i.id, f)) continue;
      const box = scene.boxAt(i.id, f)!;
      const c = scene.cam(f);
      const maxZ = plateMaxZoom(m, box.w / (i.scale ?? 1)) / (i.scale ?? 1);
      if (!reported.a4 && c.zoom > maxZ + 1e-6) {
        reported.a4 = true;
        add("A4", "error", `plate ${i.id} (${m.id}@${m.version}, ${m.file?.w} px wide, laid out ${Math.round(box.w)} px): camera zoom ${c.zoom.toFixed(2)} at f${f} exceeds its resolution cap ${maxZ.toFixed(2)}`, { frame: f, path: `world.${i.id}` });
      }
      if (m.safeCrop && !reported.a3) {
        // what the viewer sees of the plate: full width, the band between the header (218) and the hairline (1560) —
        // above and below sit the solid header band and the caption/footer zone
        const view = { x: c.x - 540 / c.zoom, y: c.y - (855 - A3_BAND.y0) / c.zoom, w: FRAME.w / c.zoom, h: (A3_BAND.y1 - A3_BAND.y0) / c.zoom };
        const vis = intersect(view, box);
        if (!vis) continue;
        const n = { x0: (vis.x - box.x) / box.w, y0: (vis.y - box.y) / box.h, x1: (vis.x + vis.w - box.x) / box.w, y1: (vis.y + vis.h - box.y) / box.h };
        const t = A_LIMITS.safeCropTol;
        const sc = m.safeCrop;
        if (n.x0 < sc.x0 - t || n.y0 < sc.y0 - t || n.x1 > sc.x1 + t || n.y1 > sc.y1 + t) {
          reported.a3 = true;
          add("A3", "error", `plate ${i.id} (${m.id}): at f${f} the frame shows x ${n.x0.toFixed(2)}–${n.x1.toFixed(2)}, y ${n.y0.toFixed(2)}–${n.y1.toFixed(2)} of the plate, outside its safe crop x ${sc.x0}–${sc.x1}, y ${sc.y0}–${sc.y1}`, { frame: f, path: `world.${i.id}` });
        }
      }
    }
  }

  // A5: a bound part that moves with a later host state change (the bind is resolved once)
  for (const d of lowered.drift) add("A5", "error", `${d.id} is bound to ${d.to.instance}#${d.to.anchor}, which moves ${Math.round(d.px)} px when ${d.to.instance} changes state/props in ${d.beat}: the binding does not follow (bind to a part that stays put, or enter ${d.id} after the change)`, { beatId: d.beat, path: `world.${d.id}.bind` });

  // A5: screen overlays at the settled frames while they are live
  for (const o of lowered.screenOverlays) {
    const inst = sb.world.find((w) => w.id === o.id)!;
    if ((o.component === "LabelPill" || o.component === "AnchorRing" || o.component === "Glow") && Math.hypot(o.dx, o.dy) > A_LIMITS.leaderPx)
      add("A5", "error", `overlay ${o.id}: bound ${Math.round(Math.hypot(o.dx, o.dy))} px off its part (bind dx/dy); the ${o.component === "LabelPill" ? "leader dot" : "ring centre"} must sit on ${o.to.instance}#${o.to.anchor} (≤ ${A_LIMITS.leaderPx} px; move the pill with props.dx/dy)`, { path: `world.${o.id}.bind` });
    const ent = tl.events.find((e) => e.kind === "action" && e.target === o.id && e.do === "enter");
    const ovFrames = [...new Set([...settled, ...(ent ? [settledOf(tl, { keywordF: ent.frame + 6 })] : [])])].sort((a, b) => a - b);
    for (const f of ovFrames) {
      if (!scene.visibleAt(o.id, f)) continue;
      const anchorScr = worldToScreen(scene.cam(f), overlayAnchorAt(o, scene.travels, f));
      if (o.component === "Spotlight") {
        if (anchorScr.x < OVERLAY_SAFE.x0 || anchorScr.x > OVERLAY_SAFE.x1 || anchorScr.y < OVERLAY_SAFE.y0 || anchorScr.y > OVERLAY_SAFE.y1) add("A5", "error", `spotlight ${o.id} centre (${Math.round(anchorScr.x)}, ${Math.round(anchorScr.y)}) outside the safe zone at f${f}`, { frame: f, path: `world.${o.id}` });
        break;
      }
      const b = scene.overlayBoxAt(o, f);
      if (!b) continue;
      const textRight = OVERLAY_TEXT_PROPS[o.component] ? OVERLAY_SAFE.textRight : OVERLAY_SAFE.x1;
      const bad: string[] = [];
      if (b.x < OVERLAY_SAFE.x0) bad.push(`left ${Math.round(b.x)} < ${OVERLAY_SAFE.x0}`);
      if (b.x + b.w > textRight) bad.push(`right ${Math.round(b.x + b.w)} > ${textRight}`);
      if (b.y < OVERLAY_SAFE.y0) bad.push(`top ${Math.round(b.y)} < ${OVERLAY_SAFE.y0} (header band)`);
      if (b.y + b.h > OVERLAY_SAFE.y1) bad.push(`bottom ${Math.round(b.y + b.h)} > ${OVERLAY_SAFE.y1}`);
      const cap = captionCardAt(tl, f);
      if (cap && intersect(b, cap)) bad.push("overlaps the caption card");
      if (bad.length) {
        add("A5", "error", `overlay ${o.id} (${o.component}${inst.props && typeof inst.props.text === "string" ? ` "${inst.props.text}"` : ""}) at f${f}: ${bad.join(", ")}`, { frame: f, path: `world.${o.id}` });
        break;
      }
    }
  }

  // A7: first concrete image ≤ 1 s
  if (native) {
    const s0 = sb.shots[0];
    const F = A_LIMITS.firstImageF;
    if (!s0 || (s0.role !== "real" && s0.role !== "real+analogy")) add("A7", "block", `shot s01 must show a real object (role real / real+analogy), not ${s0?.role ?? "nothing"}`, { path: "shots.0" });
    else if (!scene.isReal(s0.subject)) add("A7", "block", `shot s01 subject "${s0.subject}" is not a real-object component (device / plate / 3D)`, { path: "shots.0" });
    else {
      const box = scene.boxAt(s0.subject, F);
      const cover = box ? stageCover(scene.cam(F), box) : 0;
      if (!scene.liveAt(s0.subject, F)) add("A7", "block", `shot s01 subject "${s0.subject}" is not on screen by frame ${F} (enters later)`, { frame: F });
      else if (cover < A_LIMITS.firstImageStageShare) add("A7", "block", `shot s01 subject "${s0.subject}" covers ${(cover * 100).toFixed(0)} % of the stage at f${F} (needs ≥ ${A_LIMITS.firstImageStageShare * 100} %)`, { frame: F });
    }
  }

  // A8: every mechanism beat shows a real object (or something bound to a visible real one)
  sb.beats.forEach((b, bi) => {
    if (b.act !== "mechanism" || !native) return;
    const f = settled[bi];
    const shot = scene.shotOf(bi);
    const realShot = shot && (shot.role === "real" || shot.role === "real+analogy" || shot.role === "cutaway") && scene.isReal(shot.subject) && scene.visibleAt(shot.subject, f, 0.25);
    // a DIAGRAM bound to a real object: a v2 component (no v3 meta) or a Trace — a bare ring/pill/spotlight/glow
    // annotates, it does not explain
    const isDiagram = (c: string) => !scene.metaOf(c) || c === "Trace";
    const anchored = sb.world.some((i) => i.bind && isDiagram(i.component) && scene.isReal(i.bind.to.instance) && scene.visibleAt(i.id, f) && scene.visibleAt(i.bind.to.instance, f, 0.25));
    if (!realShot && !anchored) add("A8", "error", `${b.id} (mechanism) at f${f}: no real object on screen (shot ${shot?.id ?? "?"} ${shot?.role ?? ""} subject "${shot?.subject ?? ""}") and no diagram/overlay bound to a visible real one`, { beatId: b.id, frame: f });
  });

  // A9: term after picture
  sb.beats.forEach((b, bi) => {
    const tb = tl.beats[bi];
    for (const t of b.terms) {
      const hits = findSeq(tokenize(b.phrase).map(normToken), tokenize(t.term).map(normToken));
      if (!hits.length) {
        add("A9", "error", `${b.id}: term "${t.term}" is not spoken in this beat`, { beatId: b.id });
        continue;
      }
      const T = tb.words[hits[0]].startF;
      const pi = sb.beats.findIndex((x) => x.id === t.pictureBeat);
      const subject = t.anchor?.instance ?? scene.shotOf(pi)?.subject;
      if (!subject) {
        add("A9", "error", `${b.id}: term "${t.term}" has no picture subject`, { beatId: b.id });
        continue;
      }
      // the picture must be on screen when the term is spoken, and have been on screen (one continuous run) ≥ 45 f
      if (!scene.visibleAt(subject, T, 0.1)) {
        let seen = false;
        for (let f = tl.beats[pi]?.startF ?? 0; f < T && !seen; f++) seen = scene.visibleAt(subject, f, 0.25);
        add("A9", "error", seen ? `${b.id}: "${t.term}" is spoken at f${T} while its picture "${subject}" is off screen` : `${b.id}: "${t.term}" is spoken at f${T} but its picture "${subject}" (${t.pictureBeat}) was never on screen before it`, { beatId: b.id, frame: T });
        continue;
      }
      let P = T;
      while (P > 0 && scene.visibleAt(subject, P - 1, 0.1)) P--;
      if (T - P < A_LIMITS.termLeadF) add("A9", "error", `${b.id}: "${t.term}" is spoken ${T - P} f after its picture "${subject}" appears (needs ≥ ${A_LIMITS.termLeadF} f = 1.5 s)`, { beatId: b.id, frame: T });
    }
  });

  // A10: filled silences
  const fillers = (f0: number, f1: number) =>
    tl.events.some((e) => (e.kind === "camera" || e.kind === "sfx" || e.kind === "action" || e.kind === "header") && e.frame >= f0 && e.frame <= f1) ||
    tl.cameraSegments.some((s) => s.transition === "move" && s.startF < f1 && s.endF > f0) ||
    scene.travels.some((t) => t.startF < f1 && t.endF > f0);
  const gaps: { after: string; f0: number; f1: number; ms: number }[] = [];
  if (tl.beats.length && tl.words.length) gaps.push({ after: "lead", f0: 0, f1: tl.beats[0].firstWordF, ms: tl.words[0].startMs });
  tl.beats.forEach((b, i) => {
    const n = tl.beats[i + 1];
    if (n && b.words.length && n.words.length) gaps.push({ after: b.id, f0: b.lastWordEndF, f1: n.firstWordF, ms: n.words[0].startMs - b.words[b.words.length - 1].endMs });
  });
  for (const g of gaps) if (g.ms >= A_LIMITS.filledPauseMs && !fillers(g.f0, g.f1)) add("A10", "warn", `${g.after === "lead" ? "lead silence" : `pause after ${g.after}`} (${Math.round(g.ms)} ms, f${g.f0}–${g.f1}) holds nothing: add a camera key, an SFX or an action`, { frame: g.f0, ...(g.after !== "lead" ? { beatId: g.after } : {}) });

  // A11: payoff ↔ hook match
  const payIdx = sb.beats.findIndex((b) => b.act === "payoff");
  if (payIdx >= 0 && native) {
    const hook = scene.shotOf(0);
    const pay = scene.shotOf(payIdx);
    const zh = scene.cam(settled[0]).zoom;
    const zp = scene.cam(settled[payIdx]).zoom;
    if (!hook || !pay || pay.enter !== "match" || pay.matchOf !== hook.id || pay.subject !== hook.subject) add("A11", "warn", `the payoff (${sb.beats[payIdx].id}) should return to the hook's picture: shot ${pay?.id ?? "?"} enter "match", matchOf ${hook?.id ?? "s01"}, subject "${hook?.subject ?? ""}"`, { beatId: sb.beats[payIdx].id });
    else if (Math.abs(zp / zh - 1) > A_LIMITS.matchZoomTol) add("A11", "warn", `payoff zoom ${zp.toFixed(2)} vs hook ${zh.toFixed(2)}: a match is within ±${A_LIMITS.matchZoomTol * 100} %`, { beatId: sb.beats[payIdx].id });
  }

  // A13: overlay label text must be spoken (or already written on the object)
  const spokenIn = (bi: number) => new Set(tokenize(sb.beats[bi]?.phrase ?? "").map(normToken));
  const onObject = new Set<string>();
  for (const i of sb.world) if (i.component === "BrowserWindow") for (const k of ["host", "path"]) if (typeof i.props?.[k] === "string") tokenize(String(i.props[k]).replace(/[./]/g, " ")).forEach((t) => onObject.add(normToken(t)));
  for (const i of sb.world) {
    const keys = OVERLAY_TEXT_PROPS[i.component];
    if (!keys) continue;
    const texts: string[] = [];
    for (const k of keys) if (typeof i.props?.[k] === "string") texts.push(String(i.props[k]));
    sb.beats.forEach((b) => b.actions.forEach((a) => a.target === i.id && a.props && keys.forEach((k) => typeof a.props![k] === "string" && texts.push(String(a.props![k])))));
    if (!texts.length) continue;
    const bi = Math.max(0, sb.beats.findIndex((b) => b.actions.some((a) => a.target === i.id && a.do === "enter")));
    const said = new Set([...spokenIn(bi - 1), ...spokenIn(bi), ...spokenIn(bi + 1)]);
    for (const text of texts) {
      const missing = tokenize(text).map(normToken).filter((t) => t && !said.has(t) && !onObject.has(t));
      if (missing.length) add("A13", "error", `overlay ${i.id} label "${text}": the voice does not say ${missing.map((m) => `"${m}"`).join(", ")} around ${sb.beats[bi]?.id ?? "its beat"} (labels repeat spoken words only)`, { path: `world.${i.id}.props` });
    }
  }

  // L7v3: something changes every beat
  sb.beats.forEach((b, bi) => {
    if (b.actions.length || b.camera.length || b.sfx.length || b.header) return;
    const shot = scene.shotOf(bi);
    if (shot && shot.role !== "analogy" && shot.role !== "diagram" && scene.isReal(shot.subject) && scene.visibleAt(shot.subject, settled[bi], 0.25)) return; // a held real object drifts (+2 % zoom per hold)
    add("L7v3", "warn", `${b.id}: nothing changes (no action, camera key, SFX or header) and no real object is held on screen`, { beatId: b.id });
  });

  // L8v3: ≤ 6 hard cuts, each in a pause or on a phrase start
  const cuts = tl.cameraSegments.filter((s) => s.transition === "hardCut");
  if (cuts.length > 6) add("L8v3", "error", `${cuts.length} hard cuts (max 6, D1 #5g)`);
  for (const c of cuts) {
    const f = c.startF;
    const tol = A_LIMITS.cutTolF;
    const inPause = tl.beats.some((b, i) => {
      const prevEnd = i === 0 ? 0 : tl.beats[i - 1].lastWordEndF;
      return f >= prevEnd && f <= b.firstWordF + tol;
    }) || (tl.beats.length > 0 && f >= tl.beats[tl.beats.length - 1].lastWordEndF);
    if (!inPause) add("L8v3", "error", `hard cut in ${c.beatId} at f${f} falls in speech: place cuts in a pause (from the previous phrase's last word end) or ≤ ${tol} f after a phrase start`, { beatId: c.beatId, frame: f });
  }

  // L9v3: camera speed
  const capN = opts.speedCapPx ?? A_LIMITS.speedCapPx;
  const capR = opts.realSpeedCapPx ?? A_LIMITS.realSpeedCapPx;
  for (const s of tl.cameraSegments) {
    if (s.transition !== "move") continue;
    const key = sb.beats[s.beatIndex].camera[s.keyIndex];
    const onReal = !!key && "anchor" in key.target && scene.isReal(key.target.instance);
    const cap = onReal ? capR : capN;
    if (s.peakPxPerF > cap + 1e-6) add("L9v3", "error", `${s.beatId} camera move ${s.ease} f${s.startF}–${s.endF} peaks at ${Math.round(s.peakPxPerF)} px/f (cap ${cap}${onReal ? " onto a real object, W3a snap probe" : ""}): lengthen durF or shorten the move`, { beatId: s.beatId, frame: s.startF });
  }
  // L9v3 tilt: the v3 projection (src/v3/project.ts) is flat, so a tilted camera on a real object / anchor target
  // would put rings and binds off their parts
  const tiltKeys: { where: string; tilt: number; beatId?: string }[] = [];
  if (sb.camera0 && (sb.camera0.tiltX ?? 0) > 0 && lowered.real.length) tiltKeys.push({ where: "camera0", tilt: sb.camera0.tiltX });
  sb.beats.forEach((b) => b.camera.forEach((k, j) => {
    const t = (k as { tiltX?: number }).tiltX ?? 0;
    if (t > 0 && ("anchor" in k.target || ("instance" in k.target && scene.isReal(k.target.instance)) || lowered.real.length)) tiltKeys.push({ where: `${b.id}.camera.${j}`, tilt: t, beatId: b.id });
  }));
  for (const k of tiltKeys) add("L9v3", "error", `${k.where}: tiltX ${k.tilt} on a board with real objects / anchor targets — the v3 projection is flat (rings and binds would miss their parts); use tiltX 0`, k.beatId ? { beatId: k.beatId } : {});
  for (const t of scene.travels) {
    const z = scene.cam(t.startF).zoom;
    const v = travelPeakPxPerF(t, z);
    if (v > capN) add("L9v3", "error", `travel of ${t.instance} (${sb.beats[t.beatIndex].id}) peaks at ${Math.round(v)} px/f on screen (cap ${capN}): lengthen durF`, { beatId: sb.beats[t.beatIndex].id, frame: t.startF });
  }
  lintFramingV3(scene, settled, add);
  lintAnimV3(scene, settled, add);
  return finish(scene);
}

// ── A14–A17: framing, dead stretches, size, mechanism component fit (2026-11-04) ─────────────────────────────────

type Add = (id: string, severity: Severity, message: string, extra?: Partial<LintResult>) => void;

/** Props (parsed) + state of a v3 instance as of beat bi; null for v2 components / plates / 3D / unparsable props. */
export function v3PropsAt(scene: SceneV3, id: string, bi: number): { meta: AnyV3Meta; props: Record<string, unknown>; state: string | undefined; size: { w: number; h: number } } | null {
  const inst = scene.sb.world.find((w) => w.id === id);
  if (!inst || inst.component === "Plate" || inst.component === "Model3D") return null;
  const meta = scene.metaOf(inst.component);
  if (!meta) return null;
  const ps = propsStateAt(scene.sb, inst, meta, bi);
  const parsed = meta.propsSchema.safeParse(ps.props);
  if (!parsed.success) return null;
  const props = parsed.data as Record<string, unknown>;
  const state = ps.state ?? meta.initialState?.(props as never) ?? meta.states[0];
  return { meta, props, state, size: meta.footprint(props as never, inst.w) };
}

/** Screen box of a footprint-px rect of a world instance at frame f (scale + camera applied). */
function partToScreen(scene: SceneV3, id: string, f: number, r: { x0: number; y0: number; x1: number; y1: number }): Rect | null {
  const box = scene.boxAt(id, f);
  const pl = scene.lowered.placed[id];
  if (!box || !pl) return null;
  return rectToScreen(scene.cam(f), { x: box.x + r.x0 * pl.scale, y: box.y + r.y0 * pl.scale, w: (r.x1 - r.x0) * pl.scale, h: (r.y1 - r.y0) * pl.scale });
}

/** How far a screen rect reaches past each window edge (px, 0 = inside). */
function overshoot(r: Rect, w: Rect = A14_WINDOW): { left: number; right: number; top: number; bottom: number } {
  return { left: Math.max(0, w.x - r.x), right: Math.max(0, r.x + r.w - (w.x + w.w)), top: Math.max(0, w.y - r.y), bottom: Math.max(0, r.y + r.h - (w.y + w.h)) };
}
const shownShare = (r: Rect, w: Rect = A14_WINDOW) => (r.w > 0 && r.h > 0 ? area(intersect(r, w)) / (r.w * r.h) : 0);
const sidesText = (o: ReturnType<typeof overshoot>, min: { x: number; y: number }) =>
  (["left", "right", "top", "bottom"] as const).filter((k) => o[k] > (k === "left" || k === "right" ? min.x : min.y)).map((k) => `${Math.round(o[k])} px past the ${k === "top" ? "top (under the header band)" : k === "bottom" ? "bottom (into the caption band)" : k} edge`);

/** What a beat is ABOUT: its shot subject, its action targets and its camera's instance / anchor targets. */
function beatFocus(scene: SceneV3, bi: number): Set<string> {
  const b = scene.sb.beats[bi];
  const out = new Set<string>();
  const shot = scene.shotOf(bi);
  if (shot) out.add(shot.subject);
  for (const a of b.actions) out.add(a.target);
  for (const k of b.camera) if ("instance" in k.target) out.add(k.target.instance);
  return out;
}

function lintFramingV3(scene: SceneV3, settled: readonly number[], add: Add): void {
  const { sb, tl } = scene;
  const L = A_LIMITS;
  const overlayIds = new Set(scene.lowered.screenOverlays.map((o) => o.id));
  const worldIds = sb.world.filter((i) => !overlayIds.has(i.id) && scene.lowered.placed[i.id]).map((i) => i.id);
  const compOf = new Map(sb.world.map((i) => [i.id, i.component]));

  // A14: edge parts + whole objects cut off by the frame edge
  sb.beats.forEach((b, bi) => {
    const f = settled[bi];
    const c = scene.cam(f);
    const focus = beatFocus(scene, bi);
    const camParts = b.camera.flatMap((k) => ("anchor" in k.target ? [k.target] : []));
    for (const id of worldIds) {
      if (!scene.visibleAt(id, f)) continue;
      if (!focus.has(id)) continue; // context objects peeking in from a wide shot are not judged (S2 calibration)
      const box = scene.boxAt(id, f)!;
      const v = v3PropsAt(scene, id, bi);
      const pl = scene.lowered.placed[id];
      const ct = v?.meta.content?.(v.props as never, v.size, v.state);
      const scr = rectToScreen(c, ct ? { x: box.x + ct.x * pl.scale, y: box.y + ct.y * pl.scale, w: ct.w * pl.scale, h: ct.h * pl.scale } : box);
      if (v) {
        const macro = c.zoom >= L.macroZoom && camParts.some((t) => t.instance === id);
        const anchors = v.meta.anchors(v.props as never, v.size, undefined, v.state);
        for (const [name, a] of Object.entries(anchors)) {
          if (!a.edge) continue;
          const r = a.box ?? { x0: a.x - (a.r ?? 0), y0: a.y - (a.r ?? 0), x1: a.x + (a.r ?? 0), y1: a.y + (a.r ?? 0) };
          const ps = partToScreen(scene, id, f, r);
          if (!ps) continue;
          const sh = shownShare(ps);
          const o = overshoot(ps);
          if (sh <= 0 || Math.max(o.left, o.right, o.top, o.bottom) <= L.edgeTolPx) continue;
          if (macro && !camParts.some((t) => t.instance === id && t.anchor === name)) continue;
          add("A14", "block", `${b.id} at f${f}: "${id}#${name}" (${a.label}) is cut off by the frame edge — ${sidesText(o, { x: L.edgeTolPx, y: L.edgeTolPx }).join(", ")}; only ${Math.round(sh * 100)} % of it shows. Move the camera / zoom out (or move ${id}) so the whole ${a.label} is inside x 0–1080, y 218–1560, or crop it out entirely`, { beatId: b.id, frame: f, path: `world.${id}` });
        }
      }
      if (scr.w > A14_WINDOW.w || scr.h > A14_WINDOW.h) continue; // larger than the window: a close-up crop, not a cut
      const sh = shownShare(scr);
      if (sh < L.cutMinShown || sh >= 1) continue;
      const o = overshoot(scr);
      const min = { x: Math.max(L.edgeTolPx, L.cutShare * scr.w), y: Math.max(L.edgeTolPx, L.cutShare * scr.h) };
      const sides = sidesText(o, min);
      if (sides.length) add("A14", "block", `${b.id} at f${f}: ${id} (${compOf.get(id)}, ${Math.round(scr.w)}×${Math.round(scr.h)} px on screen) is cut off — ${sides.join(", ")} (${Math.round(sh * 100)} % shows). It fits the frame: centre it (camera target / zoom) or move it so all of it is inside x 0–1080, y 218–1560`, { beatId: b.id, frame: f, path: `world.${id}` });
    }
  });

  // A15: dead stretches (nothing on screen changes for > 2.5 s)
  const N = tl.durationF;
  if (N > 0 && tl.beats.length) {
    const active = new Uint8Array(N);
    const mark = (a: number, z: number) => {
      for (let f = Math.max(0, Math.floor(a)); f <= Math.min(N - 1, Math.ceil(z)); f++) active[f] = 1;
    };
    for (const sg of tl.cameraSegments) {
      if (sg.transition === "hardCut") mark(sg.startF, sg.startF + 1);
      else {
        const a = sg.from, z = sg.to;
        const moved = Math.hypot(((z.x - a.x) * (a.zoom + z.zoom)) / 2, ((z.y - a.y) * (a.zoom + z.zoom)) / 2) > 4 || Math.abs(z.zoom / a.zoom - 1) > 0.02;
        if (moved) mark(sg.startF, sg.endF);
      }
    }
    // state actions count only when they change something (a new state, or props)
    const lastState = new Map<string, string | undefined>();
    for (const i of sb.world) {
      const v = v3PropsAt(scene, i.id, -1);
      lastState.set(i.id, v?.state);
    }
    const actions = tl.events.filter((e): e is Extract<Timeline["events"][number], { kind: "action" }> => e.kind === "action").sort((a, z) => a.frame - z.frame);
    for (const e of actions) {
      if (e.target === "header" || e.target === "datafield") {
        mark(e.frame, e.frame + 12);
        continue;
      }
      const comp = compOf.get(e.target);
      const meta = comp ? scene.metaOf(comp) : undefined;
      const dur = meta?.verbs[e.do as keyof typeof meta.verbs]?.durF ?? 12;
      if (e.do === "state") {
        const prev = lastState.get(e.target);
        const changed = (e.state !== undefined && e.state !== prev) || (e.props && Object.keys(e.props).length > 0);
        if (e.state !== undefined) lastState.set(e.target, e.state);
        if (!changed) continue;
      }
      const seen = scene.visibleAt(e.target, e.frame) || scene.visibleAt(e.target, Math.min(N - 1, e.frame + dur));
      if (seen) mark(e.frame, e.frame + dur);
    }
    for (const e of tl.events) if (e.kind === "header") mark(e.frame, e.frame + 12);
    for (const t of scene.travels) if (scene.visibleAt(t.instance, t.startF) || scene.visibleAt(t.instance, t.endF)) mark(t.startF, t.endF);
    // continuously animated components, big enough on screen to read as motion
    const minW = L.staticAnimMinShare * FRAME.w;
    const bySeg = tl.beats.map((_, bi) => worldIds.filter((id) => {
      const v = v3PropsAt(scene, id, bi);
      return !!v?.meta.continuous?.(v.props as never, v.state);
    }));
    tl.beats.forEach((tb, bi) => {
      const ids = bySeg[bi];
      if (!ids.length) return;
      const end = bi + 1 < tl.beats.length ? tl.beats[bi + 1].startF : N;
      for (let f = tb.startF; f < end; f++) {
        if (active[f]) continue;
        for (const id of ids) {
          if (!scene.visibleAt(id, f)) continue;
          const s = intersect(rectToScreen(scene.cam(f), scene.boxAt(id, f)!), { x: 0, y: 0, w: FRAME.w, h: FRAME.h });
          if (s && s.w >= minW) {
            active[f] = 1;
            break;
          }
        }
      }
    });
    const from = tl.beats[0].firstWordF;
    const to = Math.min(N - 1, tl.beats[tl.beats.length - 1].lastWordEndF);
    let f = from;
    while (f <= to) {
      if (active[f]) {
        f++;
        continue;
      }
      let g = f;
      while (g + 1 <= to && !active[g + 1]) g++;
      const len = g - f + 1;
      if (len > L.staticMaxF) {
        let worst = -1, worstOv = 0, mechOv = 0;
        tl.beats.forEach((tb, bi) => {
          const end = bi + 1 < tl.beats.length ? tl.beats[bi + 1].startF : N;
          const ov = Math.max(0, Math.min(g + 1, end) - Math.max(f, tb.startF));
          const act = sb.beats[bi].act;
          if (act === "mechanism" || act === "why") {
            mechOv = Math.max(mechOv, ov);
            if (ov > worstOv || worst < 0 || (sb.beats[worst].act !== "mechanism" && sb.beats[worst].act !== "why")) if (ov > 0) { worst = bi; worstOv = ov; }
          } else if (worst < 0 && ov > 0) {
            worst = bi;
            worstOv = ov;
          }
        });
        const bad = mechOv >= L.staticMaxF;
        const beat = sb.beats[Math.max(0, worst)];
        const span = sb.beats.filter((_, bi) => {
          const end = bi + 1 < tl.beats.length ? tl.beats[bi + 1].startF : N;
          return Math.min(g + 1, end) > Math.max(f, tl.beats[bi].startF);
        }).map((x) => x.id);
        add("A15", bad ? "block" : "warn", `dead stretch ${(len / 30).toFixed(1)} s (f${f}–${g}, ${(f / 30).toFixed(1)}–${((g + 1) / 30).toFixed(1)} s, ${span.join(" ")}): nothing on screen changes — no camera move, no visible action, no animated part ≥ ${Math.round(L.staticAnimMinShare * 100)} % of the frame width${bad ? ` on a ${beat.act} line` : ""}. Show the line's mechanism moving: a state change or action on what the words describe, a camera move onto the part being explained, or a mechanism component drawn big (≤ ${(L.staticMaxF / 30).toFixed(1)} s without change); mid-line timing: at {word: n} (0-based spoken word of the phrase), since offsetF only reaches -15..+45 f`, { beatId: beat.id, frame: f });
      }
      f = g + 1;
    }
  }

  // A16 / A17: mechanism lines — picture big enough, matching mechanism component on screen
  const mechs = Object.values(V3_METAS).filter((m) => m.whenToUse);
  sb.beats.forEach((b, bi) => {
    if (b.act !== "mechanism") return;
    const f = settled[bi];
    const c = scene.cam(f);
    const focus = [...beatFocus(scene, bi)].filter((id) => !overlayIds.has(id) && scene.lowered.placed[id] && scene.visibleAt(id, f, 0.25));
    let best: { id: string; w: number } | null = null;
    for (const id of focus) {
      const box = scene.boxAt(id, f)!;
      const v = v3PropsAt(scene, id, bi);
      const pl = scene.lowered.placed[id];
      const ct = v?.meta.content?.(v.props as never, v.size, v.state);
      const world = ct ? { x: box.x + ct.x * pl.scale, y: box.y + ct.y * pl.scale, w: ct.w * pl.scale, h: ct.h * pl.scale } : box;
      const s = intersect(rectToScreen(c, world), { x: 0, y: 0, w: FRAME.w, h: FRAME.h });
      const w = s?.w ?? 0;
      if (!best || w > best.w) best = { id, w };
    }
    if (best && best.w < L.mainMinShare * FRAME.w) add("A16", "block", `${b.id} (mechanism) at f${f}: the biggest thing this line is about, ${best.id}, is ${Math.round(best.w)} px wide on screen (${Math.round((best.w / FRAME.w) * 100)} % of the frame; needs ≥ ${Math.round(L.mainMinShare * 100)} %, camera zoom ${c.zoom.toFixed(2)}). Zoom in on the part the line explains (camera target its anchor, zoom up) or show the mechanism big`, { beatId: b.id, frame: f });

    const phrase = ` ${b.phrase.toLowerCase().replace(/[’]/g, "'")} `;
    for (const m of mechs) {
      let hit: string | undefined;
      for (const w of m.whenToUse!.words) {
        const mm = new RegExp(`(?:^|[^a-z'])(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z']*)`).exec(phrase);
        if (mm) {
          hit = mm[1];
          break;
        }
      }
      if (!hit) continue;
      const insts = sb.world.filter((i) => i.component === m.name);
      if (insts.some((i) => scene.visibleAt(i.id, f, 0.25))) continue;
      const reentered = insts.filter((i) => {
        const evs = tl.events.filter((e) => e.kind === "action" && e.target === i.id && (e.do === "enter" || e.do === "exit")).map((e) => (e as { do: string; frame: number }));
        const firstExit = evs.find((e) => e.do === "exit");
        return !!firstExit && evs.some((e) => e.do === "enter" && e.frame > firstExit.frame);
      });
      add(
        "A17",
        "warn",
        `${b.id} (mechanism) says "${hit}": this is what ${m.name} is for (${m.whenToUse!.text}), but no ${m.name} is on screen at f${f}${insts.length ? ` (${insts.map((i) => i.id).join(", ")} ${insts.length > 1 ? "are" : "is"} not visible there)` : ""}. Show it on this line (describe_component ${m.name})${reentered.length ? `; ${reentered.map((i) => i.id).join(", ")} entered again after its exit — an instance enters ONCE and is not drawn after its exit: use a new instance id for the second appearance` : ""}`,
        { beatId: b.id, frame: f },
      );
    }
  });
}

// ── A18 + the state check: components that animate a state over many frames (2026-11-10, WeeksPoster) ─────────────

function lintAnimV3(scene: SceneV3, settled: readonly number[], add: Add): void {
  const { sb, tl } = scene;
  for (const inst of sb.world) {
    const meta = scene.metaOf(inst.component);
    if (!meta || (!meta.animWindows && !meta.stateIssue)) continue;
    const base = meta.propsSchema.safeParse(inst.props ?? {});
    if (!base.success) continue; // L1 props already blocks it
    // L1 state: a state name the component has but these props cannot draw (seg5 on a 3-share poster)
    if (meta.stateIssue) {
      sb.beats.forEach((b, bi) => {
        for (const a of b.actions) {
          if (a.target !== inst.id || a.do !== "state" || !a.state) continue;
          const at = meta.propsSchema.safeParse(propsStateAt(sb, inst, meta, bi).props);
          const why = at.success ? meta.stateIssue!(at.data as never, a.state) : null;
          if (why) add("L1", "block", `${b.id}: instance "${inst.id}" (${inst.component}) ${why}`, { beatId: b.id, path: `world.${inst.id}` });
        }
      });
    }
    if (!meta.animWindows) continue;
    const events = tl.events
      .filter((e): e is Extract<Timeline["events"][number], { kind: "action" }> => e.kind === "action" && e.target === inst.id)
      .sort((a, z) => a.frame - z.frame)
      .map((e) => ({ f: e.frame, do: e.do, ...(e.state !== undefined ? { state: e.state } : {}), ...(e.props ? { props: e.props } : {}) }));
    const initial = meta.initialState?.(base.data as never) ?? meta.states[0];
    const wins = meta.animWindows(base.data as never, initial, events);
    tl.beats.forEach((_tb, bi) => {
      const sf = settled[bi];
      // by the still it covers, not the beat it starts in: a fill anchored before this beat's keyword (offsetF < 0 on the
      // first word) or queued behind an earlier fill is still caught
      const w = wins.find((x) => x.from <= sf && sf < x.to);
      if (!w || !scene.visibleAt(inst.id, sf)) return;
      const from = Math.round(w.from), to = Math.round(w.to), early = Math.ceil(w.to - sf);
      const queued = w.queuedTo !== undefined && w.eventF !== undefined;
      const fix = queued
        ? `It starts at f${from}, not at its state event (f${Math.round(w.eventF!)}), because the fill before it runs until f${Math.round(w.queuedTo!)}: start the earlier state ≥ ${early} f sooner, or merge the two states into one jump (one state straight to the later level, ≤ 20 f in all)`
        : `Start it ≥ ${early} f earlier so it is done by f${sf} (a single wave of ≤ 20 f from an idle poster at {ref: "keyword", offsetF: -14} is done at keyword + 6)`;
      add("A18", "block", `${sb.beats[bi].id} at the settled still frame f${sf}: ${inst.component} "${inst.id}" ${w.what} is still running (f${from}–${to}), so the still shows it half-done. ${fix}`, { beatId: sb.beats[bi].id, frame: sf });
    });
  }
}

/** Frame of a beat's first audible word (ms → f), exported for tests / digest. */
export const firstWordFrame = (tl: Timeline, bi: number): number => tl.beats[bi]?.firstWordF ?? msToFrame(0);
export { rectToScreen, type Pt };
