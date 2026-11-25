// v3 digest (ADR-002 §6): imagery made LEGIBLE AS TEXT for the critic, the physics judge and the non-technical judge.
//
//   digestLinesV3   one line per beat at its settled frame, ≤ 160 chars:
//                   b01 hook @56 z3.20 on browser#urlbar.schemeS | SHOT s01 real · BrowserWindow[browser-generic a] bar=tapped … · RING on browser#urlbar.schemeS "the S of https"
//                   (camera focus · shot id/role/CUT · the subject with its asset + source class and its describe() —
//                   "animated behaviour is a claim" · every live overlay / bound instance with the anchor it sits on)
//   assetFactsV3    once per job: each asset used — kind, licence, author, depicts, anchors (name = physical), caveats
//                   (the physics judge checks pictures and labels against these: `wrong-asset-claim`)
//   plainDigestV3   for the non-technical judge: time ranges + what a viewer sees, in the assets' own plain words
//                   ("0.0–3.4 s: a browser window; zoom onto the S of https; a ring around it")
//
// All of it is computed from sceneV3() — the lowered board through the real resolveTimeline — so the text says what
// the rendered frame shows.

import type { AnchorRefT, StoryboardV3T } from "../schema/storyboard.v3.js";
import type { WordsFileT } from "../schema/storyboard.v2.js";
import { ASSETS } from "./assets.gen.js";
import type { AssetManifestT } from "./assets/manifest.js";
import { sceneV3, type SceneV3 } from "./lints.js";
import { settledOf } from "../v2/timeline.js";

export const DIGEST_MAX = 160;
const RING_NAMES: Record<string, string> = { AnchorRing: "RING", LabelPill: "PILL", Spotlight: "SPOT", Glow: "GLOW", Trace: "TRACE" };
const clip = (s: string, n = DIGEST_MAX) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Manifest used by an instance: its pinned asset, else the device asset whose component it is. */
function assetFor(sb: StoryboardV3T, id: string, manifests: readonly AssetManifestT[]): AssetManifestT | undefined {
  const i = sb.world.find((w) => w.id === id);
  if (!i) return undefined;
  if (i.asset) {
    const v = sb.assets.find((a) => a.id === i.asset)?.version;
    return manifests.find((m) => m.id === i.asset && (v === undefined || m.version === v));
  }
  return manifests.find((m) => m.kind === "device" && m.component === i.component);
}

/** State + props in force for an instance at frame f (from the resolved action events). */
function stateAt(scene: SceneV3, id: string, f: number): { state: string; props: Record<string, unknown> } {
  const i = scene.sb.world.find((w) => w.id === id)!;
  const meta = scene.metaOf(i.component);
  let state = meta ? (meta.initialState ? meta.initialState(meta.propsSchema.parse(i.props ?? {})) : meta.states[0] ?? "") : "";
  let props: Record<string, unknown> = { ...(scene.lowered.board.world.find((w) => w.id === id)?.props ?? scene.lowered.screenOverlays.find((o) => o.id === id)?.props ?? i.props ?? {}) };
  const allowed = new Set(meta?.verbs.state?.props ?? []);
  for (const e of scene.tl.events) {
    if (e.kind !== "action" || e.target !== id || e.frame > f || e.do !== "state") continue;
    if (e.state) state = e.state;
    if (e.props) for (const [k, v] of Object.entries(e.props)) if (allowed.has(k)) props = { ...props, [k]: v };
  }
  return { state, props };
}

function describeAt(scene: SceneV3, id: string, f: number): string {
  const i = scene.sb.world.find((w) => w.id === id);
  if (!i) return id;
  const meta = scene.metaOf(i.component);
  if (!meta) return i.component;
  const { state, props } = stateAt(scene, id, f);
  const p = meta.propsSchema.safeParse(props);
  return p.success ? meta.describe(state, p.data) : i.component;
}

const refText = (r: AnchorRefT) => `${r.instance}#${r.anchor}`;
/** a travel waypoint: the part, "+(dx, dy)" when it is offset from it (the letter stops above the door) */
const viaText = (v: AnchorRefT & { dx?: number; dy?: number }) => `${refText(v)}${v.dx || v.dy ? `+(${Math.round(v.dx ?? 0)}, ${Math.round(v.dy ?? 0)})` : ""}`;
/** the travel actions in lowering order (= scene.travels order: beats in order, actions in order) */
const travelActions = (sb: StoryboardV3T) => sb.beats.flatMap((b) => b.actions.filter((a) => a.do === "travel" && sb.world.some((w) => w.id === a.target)));

/** Where the camera is aimed at frame f: the latest camera key (or camera0) that started at or before f. */
function focusAt(scene: SceneV3, f: number): string {
  const segs = scene.tl.cameraSegments.filter((s) => s.startF <= f);
  const s = segs[segs.length - 1];
  const t = s ? scene.sb.beats[s.beatIndex].camera[s.keyIndex]?.target : scene.sb.camera0?.target;
  if (!t) return scene.sb.stations[0]?.id ?? "?";
  if ("anchor" in t) return `on ${refText(t as AnchorRefT)}`;
  if ("instance" in t) return `on ${t.instance}`;
  if ("station" in t) return t.station;
  return `(${Math.round(t.x)}, ${Math.round(t.y)})`;
}

export function digestLinesV3(sb: StoryboardV3T, words: WordsFileT | null | undefined, opts: { scene?: SceneV3; manifests?: readonly AssetManifestT[] } = {}): string[] {
  const scene = opts.scene ?? sceneV3(sb, words);
  const manifests = opts.manifests ?? ASSETS;
  const { tl } = scene;
  return sb.beats.map((b, bi) => {
    const f = settledOf(tl, tl.beats[bi]);
    const c = scene.cam(f);
    const shot = scene.shotOf(bi);
    const cut = shot && shot.fromBeat === b.id && tl.cameraSegments.some((s) => s.beatIndex === bi && s.transition === "hardCut");
    const head = `${b.id} ${b.act} @${f} z${c.zoom.toFixed(2)} ${focusAt(scene, f)}`;
    const rest: string[] = [];
    // overlays + world-bound instances live at f (a travelled prop is named where it now is)
    for (const i of sb.world) {
      if (!i.bind || i.id === shot?.subject || !scene.visibleAt(i.id, f)) continue;
      const tag = RING_NAMES[i.component];
      const label = i.component === "LabelPill" ? ` "${String(stateAt(scene, i.id, f).props.text ?? "")}"` : i.component === "Glow" && i.props?.label ? ` "${String(i.props.label)}"` : "";
      const anchorLabel = scene.lowered.anchorPoints[refText(i.bind.to)]?.label;
      if (tag) rest.push(`${tag} on ${refText(i.bind.to)}${label}${!label && anchorLabel ? ` "${anchorLabel}"` : ""}`);
      else {
        const acts = travelActions(sb);
        const k = scene.travels.reduce((best, t, j) => (t.instance === i.id && t.startF <= f && (best < 0 || t.startF >= scene.travels[best].startF) ? j : best), -1);
        const via = k >= 0 ? (acts[k]?.via ?? []) : [];
        const where = via.length ? `at ${viaText(via[via.length - 1])}${scene.travels[k].endF > f ? " (travelling)" : ""}` : `on ${refText(i.bind.to)}`;
        rest.push(`${describeAt(scene, i.id, f)} ${where}`);
      }
    }
    scene.travels.forEach((t, j) => {
      if (t.instance === shot?.subject && t.startF <= f && t.endF >= f) rest.push(`travels → ${(travelActions(sb)[j]?.via ?? []).map(viaText).join("→")}`);
    });
    let shotSeg = "";
    if (shot) {
      const subj = sb.world.find((w) => w.id === shot.subject);
      const m = assetFor(sb, shot.subject, manifests);
      const src = m ? `[${m.id}${m.kind === "device" ? "" : `@${m.version}`} ${m.sourceClass}${m.kind === "photo" ? ` ${m.licence.id}/${m.licence.author}` : ""}]` : "";
      const vis = scene.visibleAt(shot.subject, f, 0.1) ? "" : " (OFF SCREEN)";
      const comp = subj?.component ?? "?";
      let desc = describeAt(scene, shot.subject, f);
      if (desc.startsWith(comp)) desc = desc.slice(comp.length).trim();
      const pre = `SHOT ${shot.id} ${shot.role}${cut ? " CUT" : shot.fromBeat === b.id && shot.enter !== "cut" ? ` ${shot.enter.toUpperCase()}` : ""} · ${comp}${src}`;
      // the describe() text gets whatever room the overlays leave (anchors matter more to the judges than prose)
      const room = Math.max(28, DIGEST_MAX - head.length - 3 - pre.length - vis.length - rest.reduce((n, r) => n + r.length + 3, 0) - 1);
      if (room < desc.length) desc = room > 8 ? `${desc.slice(0, room - 1)}…` : "";
      shotSeg = `${pre}${desc ? ` ${desc}` : ""}${vis}`;
    }
    const parts = [shotSeg, ...rest].filter(Boolean);
    return clip(`${head} | ${parts.join(" · ")}`);
  });
}

/** The ASSET FACTS block (ADR-002 §6.2): every asset the board shows, with what each anchor physically is and what the
 *  asset does NOT truthfully show (caveats, verbatim). */
export function assetFactsV3(sb: StoryboardV3T, manifests: readonly AssetManifestT[] = ASSETS): string[] {
  const seen = new Map<string, AssetManifestT>();
  for (const i of sb.world) {
    const m = assetFor(sb, i.id, manifests);
    if (m && !seen.has(`${m.id}@${m.version}`)) seen.set(`${m.id}@${m.version}`, m);
  }
  const lines: string[] = [];
  for (const m of seen.values()) {
    lines.push(`ASSET ${m.id}@${m.version} (${m.kind}, ${m.licence.id}, ${m.licence.author}): "${m.depicts}"`);
    const anchors = Object.entries(m.anchors).map(([k, a]) => `${k} = ${a.physical}`);
    if (anchors.length) lines.push(`  anchors: ${anchors.join("; ")}`);
    if (m.caveats.length) lines.push(`  caveats: ${m.caveats.join("; ")}`);
  }
  return lines;
}

/** Plain-words digest for the non-technical judge: per shot run, what a viewer sees (asset depicts + anchor labels). */
export function plainDigestV3(sb: StoryboardV3T, words: WordsFileT | null | undefined, opts: { scene?: SceneV3; manifests?: readonly AssetManifestT[] } = {}): string[] {
  const scene = opts.scene ?? sceneV3(sb, words);
  const manifests = opts.manifests ?? ASSETS;
  const { tl } = scene;
  const sec = (f: number) => (f / tl.fps).toFixed(1);
  const lastState = new Map<string, string>();
  return sb.beats.map((b, bi) => {
    const tb = tl.beats[bi];
    const f0 = bi === 0 ? 0 : tb.startF;
    const f1 = tb.endF;
    const shot = scene.shotOf(bi);
    const bits: string[] = [];
    if (shot) {
      const m = assetFor(sb, shot.subject, manifests);
      bits.push(m ? m.depicts.replace(/\.$/, "").replace(/^A /, "a ").replace(/^The /, "the ") : shot.subject);
    }
    for (const s of tl.cameraSegments) {
      if (s.beatIndex !== bi) continue;
      const key = b.camera[s.keyIndex];
      if (!key) continue;
      const tgt = "anchor" in key.target ? scene.lowered.anchorPoints[refText(key.target)]?.label ?? key.target.anchor : "instance" in key.target ? key.target.instance : "station" in key.target ? key.target.station : "the scene";
      bits.push(s.transition === "hardCut" ? `cut to ${tgt}` : s.to.zoom > s.from.zoom * 1.05 ? `zoom onto ${tgt}` : s.to.zoom < s.from.zoom * 0.95 ? `pull back to ${tgt}` : `move to ${tgt}`);
    }
    for (const a of b.actions) {
      const i = sb.world.find((w) => w.id === a.target);
      if (!i) continue;
      if (a.do === "enter" && i.bind) {
        const lbl = scene.lowered.anchorPoints[refText(i.bind.to)]?.label ?? i.bind.to.anchor;
        bits.push(i.component === "AnchorRing" ? `a ring around ${lbl}` : i.component === "LabelPill" ? `a label "${String(i.props?.text ?? "")}" on ${lbl}` : i.component === "Spotlight" ? `the rest dims around ${lbl}` : i.component === "Glow" ? `${lbl} glows` : `${i.component.toLowerCase()} on ${lbl}`);
      } else if (a.do === "enter") bits.push(`${(assetFor(sb, i.id, manifests)?.depicts ?? i.component).replace(/\.$/, "").replace(/^A /, "a ")} appears`);
      else if (a.do === "travel") {
        const names = (a.via ?? []).map((v) => `${v.dx || v.dy ? "near " : ""}${scene.lowered.anchorPoints[refText(v)]?.label ?? v.anchor}`).filter((n, k, all) => k === 0 || n !== all[k - 1]);
        bits.push(`the ${i.component.toLowerCase()} moves to ${names.join(", then ")}${names.length < (a.via?.length ?? 0) ? " (along a path)" : ""}`);
      }
      else if (a.do === "state" && a.state) {
        const prev = lastState.get(i.id) ?? scene.metaOf(i.component)?.states[0];
        lastState.set(i.id, a.state);
        if (prev !== a.state) bits.push(`the ${i.component.toLowerCase()} → ${a.state}`);
      }
    }
    return `${sec(f0)}–${sec(f1)} s: ${bits.join("; ")} — "${b.phrase}"`;
  });
}
