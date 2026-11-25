// v3 BOARD PHYSICS JUDGE (W4; ADR-002 §6.1/§6.2, hand-off §7 W4 "physics with ASSET FACTS and wrong-asset-claim").
// The script-stage physics judge (physicsScript.ts) has already passed the narration before TTS. This judge runs on
// the STORYBOARD: the narration is fixed and true, and the question is whether the PICTURE tells the same truth, beat
// by beat. Measured on S2 (research/v3/S2/NOTES.md, r1 blockers): the review that blocked S2 r0 caught exactly this —
// the cat picture travelling the Wi-Fi/router/cable UNLOCKED while the voice said "that 's' keeps it safe while it
// travels", other senders' boxes and the queue OPEN outside the website, and the lock flickering open/shut on "That
// lock is called TLS". Those are truth checks on the picture, not taste.
//
// Two layers:
//   1. CODE ($0, deterministic, from the lowered board through the real resolveTimeline = what the renderer draws):
//        BP1 picture-contradicts-narration  unprotected content (PhotoCard showing its photo, LockBox open/unlocked)
//            MOVES across an on-the-way object (Wi-Fi, router, snooper) — unless that beat's narration says it is
//            unprotected ("without", "unlocked", "not encrypted", "anyone can read" …)                        block
//        BP2 picture-contradicts-narration  an unprotected LockBox is on screen outside every endpoint (phone /
//            website: its box overlaps none of them), except while it is being packed at its start (it locks later
//            before it ever moves)                                                                            block
//        BP3 state-continuity  a lock (LockBox / Padlock) visibly flips protected ↔ unprotected and back within
//            FLICKER_F frames (1.5 s) — the S2 r0 "lock flicker"                                                block
//        BP4 normal-thing-styled-as-attack  a Snooper drawn over the website (the website opening its own lock is
//            normal), or an alarm label (hack/attack/stolen …) on an endpoint                          block / warn
//        BP5 state-continuity (soft)  a visible lock changes state in a beat whose narration (this or the previous
//            line) has no lock/open word — the LLM decides whether there is a reason                            warn
//   2. LLM (fresh, no tools, strongest model; majority-of-N, fail closed — claims.ts judgeVotes + physicsScript.ts
//      mergePhysicsVotes): reads the narration with timings, the digest lines, a STATE TIMELINE (every content item and
//      lock: state, place, travels, protection while travelling), the ASSET FACTS and the COMPONENT STATE SEMANTICS, and
//      flags picture-contradicts-narration / state-continuity / wrong-asset-claim / normal-thing-styled-as-attack /
//      contradiction. The code findings are NOT shown to it (independent evidence; merged after).
//
// The same STATE TIMELINE + facts feed the critic (critic.ts). Nothing here edits the board: findings carry hints for
// the director, never applied.

import { firstJsonObject } from "../v2/clarity.js";
import { DEFAULT_PHYSICS_MODEL } from "../v2/physics.js";
import type { StoryboardV3T } from "../../schema/storyboard.v3.js";
import type { WordsFileT } from "../../schema/storyboard.v2.js";
import { ASSETS } from "../../v3/assets.gen.js";
import type { AssetManifestT } from "../../v3/assets/manifest.js";
import { assetFactsV3, digestLinesV3 } from "../../v3/digest.js";
import { sceneV3, type SceneV3 } from "../../v3/lints.js";
import { area, intersect, rectToScreen, type Rect } from "../../v3/project.js";
import { settledOf } from "../../v2/timeline.js";
import { clean, judgeSession, judgeVotes, majorityOf, modelFor, tag, voteDir, type JudgeRunArgs, type JudgeSpend } from "./claims.js";
import { mergePhysicsVotes, type PhysicsScriptFinding } from "./physicsScript.js";

// ---------------------------------------------------------------- component semantics (what "protected" means)

/** Lock / content semantics of the v3 components (from their metas: LockBox, PhotoCard, Padlock). A state listed here
 *  is drawn as PROTECTED (locked / scrambled); every other state of the component is drawn unprotected. */
export const PROTECTION: Readonly<Record<string, { protectedStates: readonly string[]; role: "container" | "content" | "lock"; plain: string; states: Readonly<Record<string, string>> }>> = {
  LockBox: {
    protectedStates: ["locked", "peek"],
    role: "container",
    plain: "a box carrying the picture",
    states: { open: "OPEN: lid up, picture out and visible", locked: "LOCKED: lid shut, padlock clicked, picture hidden", peek: "LOCKED, x-ray: contents scrambled, address label readable", unlocked: "UNLOCKED: padlock open (neutral), picture rises out, visible" },
  },
  PhotoCard: { protectedStates: ["scrambled"], role: "content", plain: "the picture (a card)", states: { shown: "photo VISIBLE (readable)", scrambled: "SCRAMBLED: random characters, photo hidden" } },
  Padlock: { protectedStates: ["locked"], role: "lock", plain: "a padlock", states: { locked: "LOCKED (shackle shut)", open: "OPEN (shackle up, neutral)" } },
};
/** Where content starts or ends its trip (being there unlocked is fine). */
export const ENDPOINT_COMPONENTS: ReadonlySet<string> = new Set(["Phone", "WebsiteCluster", "BrowserWindow", "Building", "ServerRack", "WatchBack", "Headphones"]);
/** Things on the way (Wi-Fi, routers, people looking): content passing them must be protected unless narrated. */
export const WAY_COMPONENTS: ReadonlySet<string> = new Set(["WifiSignal", "Router", "Snooper"]);
const WEBSITE_COMPONENTS: ReadonlySet<string> = new Set(["WebsiteCluster", "Building", "ServerRack"]);
const PLAIN: Record<string, string> = {
  Phone: "your phone",
  WebsiteCluster: "the website",
  BrowserWindow: "the browser",
  Building: "the building",
  ServerRack: "the server rack",
  WifiSignal: "the Wi-Fi",
  Router: "the router",
  Snooper: "the snooper",
  LockBox: "a box",
  PhotoCard: "the picture card",
  Padlock: "a padlock",
};

/** An object this close to an endpoint (world px, no overlap) is "beside" it. */
export const BESIDE_PX = 120;
/** Two protection changes of one lock within this many frames = a flicker (1.5 s at 30 fps). */
export const FLICKER_F = 45;
/** A box packed at its start may still be finishing its lock as it sets off (the lid lands a few frames into the
 *  move): up to this many frames after its first move starts still counts as packed. */
export const PACK_TOLERANCE_F = 10;
/** Sampling step for the frame scans (frames). */
const STEP = 2;
/** Narration that SAYS the content is unprotected at that point (then showing it unprotected is the point, not a lie). */
export const NARRATED_UNPROTECTED = /\b(?:without|unlocked|unencrypted|not (?:locked|encrypted|protected|safe|sealed)|in the clear|plain ?text|anyone can read|no lock)\b/i;
/** Narration that gives a lock a reason to change (this beat or the one before). */
export const LOCK_WORDS = /\b(?:lock\w*|unlock\w*|open\w*|seal\w*|clos\w*|shut\w*|key\w*|ends?|terminat\w*|secur\w*|safe\w*|protect\w*|encrypt\w*|decrypt\w*|after that|up to)\b/i;
const ALARM_LABEL = /\b(?:hack\w*|attack\w*|stolen|steal\w*|thief|intruder|break-?in|breach\w*|danger\w*|unsafe|leak\w*)\b/i;

export const isProtected = (component: string, state: string): boolean => !!PROTECTION[component]?.protectedStates.includes(state);

// ---------------------------------------------------------------- board model (pure; from the lowered timeline)

export interface StateStep {
  /** frame from which the drawn protection of this state is in force (a lock looks shut only once it has clicked) */
  f: number;
  /** frame of the state event itself */
  eventF: number;
  state: string;
  beat: string;
}

export interface BoardModel {
  scene: SceneV3;
  fps: number;
  /** tracked instance id → its state steps (first = initial state at frame 0) */
  steps: Map<string, StateStep[]>;
  tracked: string[];
  endpoints: string[];
  way: string[];
  beatAt: (f: number) => number;
  stateAt: (id: string, f: number) => string;
  protectedAt: (id: string, f: number) => boolean;
  travellingAt: (id: string, f: number) => boolean;
  sec: (f: number) => string;
  name: (id: string) => string;
}

export function boardModel(sb: StoryboardV3T, words: WordsFileT | null | undefined, opts: { scene?: SceneV3 } = {}): BoardModel {
  const scene = opts.scene ?? sceneV3(sb, words);
  const { tl } = scene;
  const comp = (id: string) => sb.world.find((w) => w.id === id)?.component ?? "";
  const tracked = sb.world.filter((w) => PROTECTION[w.component]).map((w) => w.id);
  const endpoints = sb.world.filter((w) => ENDPOINT_COMPONENTS.has(w.component)).map((w) => w.id);
  const way = sb.world.filter((w) => WAY_COMPONENTS.has(w.component)).map((w) => w.id);
  const steps = new Map<string, StateStep[]>();
  for (const id of tracked) {
    const i = sb.world.find((w) => w.id === id)!;
    const meta = scene.metaOf(i.component);
    const init = meta ? (meta.initialState ? meta.initialState(meta.propsSchema.parse(i.props ?? {})) : (meta.states[0] ?? "")) : "";
    const durF = meta?.verbs.state?.durF ?? 0;
    const out: StateStep[] = [{ f: 0, eventF: 0, state: init, beat: sb.beats[0]?.id ?? "b01" }];
    const evs = tl.events.filter((e): e is Extract<typeof e, { kind: "action" }> => e.kind === "action" && e.target === id && e.do === "state" && !!e.state).sort((a, b) => a.frame - b.frame);
    for (const e of evs) {
      const prev = out[out.length - 1].state;
      const st = e.state!;
      if (st === prev) continue;
      // closing is drawn over the state's transition (lid shuts, shackle clicks): protected only once it lands;
      // opening reads as open from its first frame
      const f = isProtected(i.component, st) && !isProtected(i.component, prev) ? e.frame + durF : e.frame;
      out.push({ f, eventF: e.frame, state: st, beat: e.beatId });
    }
    steps.set(id, out);
  }
  const stateAt = (id: string, f: number) => {
    const s = steps.get(id);
    if (!s) return "";
    let cur = s[0];
    for (const x of s) if (x.f <= f) cur = x;
    return cur.state;
  };
  const beatAt = (f: number) => {
    let bi = 0;
    tl.beats.forEach((b, i) => {
      if (b.startF <= f) bi = i;
    });
    return bi;
  };
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const w of sb.world) {
    const base = PLAIN[w.component];
    if (!base) continue;
    const n = (counts.get(w.component) ?? 0) + 1;
    counts.set(w.component, n);
    names.set(w.id, n === 1 ? base : base.replace(/^(?:a|the|your) /, "another "));
  }
  return {
    scene,
    fps: tl.fps,
    steps,
    tracked,
    endpoints,
    way,
    beatAt,
    stateAt,
    protectedAt: (id, f) => isProtected(comp(id), stateAt(id, f)),
    travellingAt: (id, f) => scene.travels.some((t) => t.instance === id && t.startF <= f && f <= t.endF),
    sec: (f) => (f / tl.fps).toFixed(1),
    name: (id) => `${id} (${names.get(id) ?? comp(id)})`,
  };
}

const live = (m: BoardModel, id: string, f: number) => m.scene.liveAt(id, f);
const overlap = (a: Rect | null, b: Rect | null) => (a && b ? area(intersect(a, b)) : 0);

/** Where a world rect is at frame f, in words an engineer reads: inside / at the edge of an endpoint, on the way at a
 *  way object, or outside with the distance to the nearest endpoint. */
export function placeOf(m: BoardModel, r: Rect | null, f: number, self?: string): string {
  if (!r) return "?";
  let best: { id: string; share: number } | null = null;
  for (const id of m.endpoints) {
    if (id === self || !live(m, id, f)) continue;
    const share = overlap(r, m.scene.boxAt(id, f)) / Math.max(1, area(r));
    if (share > 0 && (!best || share > best.share)) best = { id, share };
  }
  if (best) return best.share >= 0.5 ? `inside ${m.name(best.id)}` : `at the edge of ${m.name(best.id)} (${Math.round(best.share * 100)} % inside)`;
  for (const id of m.way) {
    if (id === self || !live(m, id, f)) continue;
    if (overlap(r, m.scene.boxAt(id, f)) > 0) return `ON THE WAY, at ${m.name(id)}`;
  }
  const nearest = (pool: readonly string[]) => {
    let near: { id: string; d: number } | null = null;
    for (const id of pool) {
      const b = id === self || !live(m, id, f) ? null : m.scene.boxAt(id, f);
      if (!b) continue;
      const dx = Math.max(b.x - (r.x + r.w), r.x - (b.x + b.w), 0);
      const dy = Math.max(b.y - (r.y + r.h), r.y - (b.y + b.h), 0);
      const d = Math.round(Math.hypot(dx, dy));
      if (!near || d < near.d) near = { id, d };
    }
    return near;
  };
  const ep = nearest(m.endpoints);
  const wy = nearest(m.way);
  // within BESIDE_PX of an endpoint it is "beside" it (packed / unpacked there), not somewhere on the way (S2 W4
  // validation: "OUTSIDE, 50 px from the phone; 26 px from the Wi-Fi" read to the judges as "locked by the Wi-Fi")
  if (ep && ep.d <= BESIDE_PX) return `beside ${m.name(ep.id)} (${ep.d} px outside it)`;
  const bits = [ep && `${ep.d} px from ${m.name(ep.id)}`, wy && wy.d <= 60 && `${wy.d} px from ${m.name(wy.id)}`].filter(Boolean);
  return bits.length ? `OUTSIDE, ${bits.join("; ")}` : "OUTSIDE";
}

/** placeOf + "at <box>" when a picture card overlaps a visible box (rising out of / dropping into it). */
function placeWithBox(m: BoardModel, id: string, f: number): string {
  const r = m.scene.boxAt(id, f);
  const p = placeOf(m, r, f, id);
  const c = m.scene.sb.world.find((w) => w.id === id)?.component;
  if (c !== "PhotoCard") return p;
  const box = m.tracked.find((b) => b !== id && m.scene.sb.world.find((w) => w.id === b)?.component === "LockBox" && m.scene.visibleAt(b, f, 0.05) && overlap(r, m.scene.boxAt(b, f)) > 0);
  return box ? `${p}, at ${m.name(box)}` : p;
}

// ---------------------------------------------------------------- code checks

export const BOARD_PHYSICS_KINDS = ["picture-contradicts-narration", "state-continuity", "wrong-asset-claim", "normal-thing-styled-as-attack", "contradiction"] as const;
export type BoardPhysicsKind = (typeof BOARD_PHYSICS_KINDS)[number];

export interface BoardFinding {
  beats: string[];
  kind: BoardPhysicsKind | string;
  severity: "error" | "nit";
  where: string;
  claim: string;
  why: string;
  hint: string;
  /** code-check id (BP1 …) or "llm" */
  source: string;
}

export interface BoardGap {
  gate: "physics-board" | "critic" | "nontech-board";
  code: string;
  severity: "block" | "error" | "warn";
  beats?: string[];
  message: string;
  hint?: string;
}
export const boardGapsPass = (gaps: readonly BoardGap[]): boolean => !gaps.some((g) => g.severity !== "warn");

/** Contiguous runs of hit frames (gap ≤ 2 steps) → [startF, endF]. */
function runs(hits: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const f of hits) {
    const last = out[out.length - 1];
    if (last && f - last[1] <= STEP * 2) last[1] = f;
    else out.push([f, f]);
  }
  return out;
}

export function boardPhysicsChecks(m: BoardModel): BoardGap[] {
  const { scene } = m;
  const { sb, tl } = scene;
  const gaps: BoardGap[] = [];
  const comp = (id: string) => sb.world.find((w) => w.id === id)?.component ?? "";
  const phrase = (bi: number) => sb.beats[bi]?.phrase ?? "";
  const beatIds = (a: number, b: number) => [...new Set([m.beatAt(a), m.beatAt(b)])].map((i) => sb.beats[i].id);
  const visible = (id: string, f: number) => scene.visibleAt(id, f, 0.05);
  const content = m.tracked.filter((id) => PROTECTION[comp(id)].role !== "lock");

  // BP1: unprotected content moving across an on-the-way object
  for (const id of content) {
    for (const t of scene.travels.filter((x) => x.instance === id)) {
      const hits: number[] = [];
      const at: string[] = [];
      for (let f = t.startF; f <= t.endF; f += 1) {
        if (!visible(id, f) || m.protectedAt(id, f)) continue;
        const r = scene.boxAt(id, f);
        const w = m.way.find((wid) => live(m, wid, f) && overlap(r, scene.boxAt(wid, f)) > 0);
        if (w) {
          hits.push(f);
          if (!at.includes(w)) at.push(w);
        }
      }
      for (const [a, b] of runs(hits)) {
        const bi = m.beatAt(a);
        const narrated = NARRATED_UNPROTECTED.test(phrase(bi));
        gaps.push({
          gate: "physics-board",
          code: "BP1",
          severity: narrated ? "warn" : "block",
          beats: beatIds(a, b),
          message: `[picture-contradicts-narration] ${m.name(id)} travels ${PROTECTION[comp(id)].states[m.stateAt(id, a)] ?? m.stateAt(id, a)} across ${at.map((w) => m.name(w)).join(", ")} at ${m.sec(a)}–${m.sec(b)} s while the voice says "${phrase(bi)}"${narrated ? " (the line says it is unprotected: reported)" : ""}`,
          ...(narrated ? {} : { hint: "Lock (or scramble) it before it leaves the phone, or keep it at the phone until it is locked; only show it unprotected where the line says so." }),
        });
      }
    }
  }

  // BP2: an open box on screen outside every endpoint (not while being packed at its start)
  for (const id of m.tracked.filter((x) => comp(x) === "LockBox")) {
    const own = scene.travels.filter((t) => t.instance === id).sort((a, b) => a.startF - b.startF);
    const firstTravel = own[0]?.startF ?? Infinity;
    const st = m.steps.get(id)!;
    const hits: number[] = [];
    for (let f = 0; f < tl.durationF; f += STEP) {
      if (!scene.visibleAt(id, f, 0.1) || m.protectedAt(id, f)) continue;
      const r = scene.boxAt(id, f);
      if (m.endpoints.some((e) => live(m, e, f) && overlap(r, scene.boxAt(e, f)) > 0)) continue;
      // packing: not moved yet, and it locks before it first moves
      const locksAt = st.find((s) => s.f > f && isProtected("LockBox", s.state))?.f;
      if (f < firstTravel + PACK_TOLERANCE_F && locksAt !== undefined && locksAt <= firstTravel + PACK_TOLERANCE_F) continue;
      hits.push(f);
    }
    for (const [a, b] of runs(hits)) {
      const bi = m.beatAt(a);
      gaps.push({
        gate: "physics-board",
        code: "BP2",
        severity: "block",
        beats: beatIds(a, b),
        message: `[picture-contradicts-narration] ${m.name(id)} is ${PROTECTION.LockBox.states[m.stateAt(id, a)] ?? m.stateAt(id, a)} ${placeOf(m, scene.boxAt(id, a), a, id)} at ${m.sec(a)}–${m.sec(b)} s ("${phrase(bi)}"): an open box outside the phone and the website shows the content unprotected on the way`,
        hint: "Lock it while it is still hidden (state before enter), and open it only where it is unlocked: inside (or touching) the website.",
      });
    }
  }

  // BP3: lock flicker — protection flips and flips back within FLICKER_F while visible
  for (const id of m.tracked.filter((x) => PROTECTION[comp(x)].role !== "content")) {
    const changes: Array<{ f: number; to: boolean; state: string }> = [];
    let prev: boolean | null = null;
    for (let f = 0; f < tl.durationF; f += 1) {
      if (!visible(id, f)) {
        prev = null;
        continue;
      }
      const p = m.protectedAt(id, f);
      if (prev !== null && p !== prev) changes.push({ f, to: p, state: m.stateAt(id, f) });
      prev = p;
    }
    for (let k = 1; k < changes.length; k++) {
      const a = changes[k - 1];
      const b = changes[k];
      if (b.f - a.f > FLICKER_F) continue;
      gaps.push({
        gate: "physics-board",
        code: "BP3",
        severity: "block",
        beats: beatIds(a.f, b.f),
        message: `[state-continuity] ${m.name(id)} flickers: ${a.to ? "shuts" : "opens"} at ${m.sec(a.f)} s (${a.state}) and ${b.to ? "shuts" : "opens"} again at ${m.sec(b.f)} s (${b.state}), ${b.f - a.f} f apart, on "${phrase(m.beatAt(a.f))}"`,
        hint: "A lock changes once per narrated reason. Re-asserting a state it already has must not re-run the open → locked animation; drop the extra state change.",
      });
    }
  }

  // BP4: normal opening styled as an attack
  for (const s of sb.world.filter((w) => w.component === "Snooper")) {
    const hits: number[] = [];
    for (let f = 0; f < tl.durationF; f += STEP) {
      if (!visible(s.id, f)) continue;
      const r = scene.boxAt(s.id, f);
      if (sb.world.some((w) => WEBSITE_COMPONENTS.has(w.component) && live(m, w.id, f) && overlap(r, scene.boxAt(w.id, f)) > 0)) hits.push(f);
    }
    for (const [a, b] of runs(hits))
      gaps.push({ gate: "physics-board", code: "BP4", severity: "block", beats: beatIds(a, b), message: `[normal-thing-styled-as-attack] ${m.name(s.id)} is drawn over the website at ${m.sec(a)}–${m.sec(b)} s: the website opening its own lock is normal, not snooping`, hint: "Keep the snooper on the way (Wi-Fi, router, cable), never at the website." });
  }
  for (const w of sb.world.filter((x) => x.component === "LabelPill" && x.bind && ENDPOINT_COMPONENTS.has(comp(x.bind.to.instance)))) {
    const texts = [String(w.props?.text ?? ""), ...sb.beats.flatMap((b) => b.actions.filter((a) => a.target === w.id && a.do === "state").map((a) => String((a.props as Record<string, unknown> | undefined)?.text ?? "")))];
    const bad = texts.find((t) => ALARM_LABEL.test(t));
    if (bad) gaps.push({ gate: "physics-board", code: "BP4", severity: "warn", message: `[normal-thing-styled-as-attack] label "${bad}" (${w.id}) sits on ${m.name(w.bind!.to.instance)}: check it is not calling a normal step an attack` });
  }

  // BP5 (soft): a visible lock change in a beat with no lock word in this or the previous line
  for (const id of m.tracked.filter((x) => PROTECTION[comp(x)].role !== "content")) {
    const st = m.steps.get(id)!;
    for (let k = 1; k < st.length; k++) {
      const s = st[k];
      if (isProtected(comp(id), s.state) === isProtected(comp(id), st[k - 1].state) || !visible(id, s.eventF)) continue;
      const bi = sb.beats.findIndex((b) => b.id === s.beat);
      if (LOCK_WORDS.test(phrase(bi)) || LOCK_WORDS.test(phrase(bi - 1))) continue;
      gaps.push({ gate: "physics-board", code: "BP5", severity: "warn", beats: [s.beat], message: `[state-continuity] ${m.name(id)} turns ${s.state} at ${m.sec(s.eventF)} s on "${phrase(bi)}": no lock word in this or the previous line` });
    }
  }
  return gaps;
}

// ---------------------------------------------------------------- text for the judges

/** Narration as the board judges read it: "b05 [ground] 13.4–16.1 s (then 250 ms) "So before it leaves …"". */
export function boardNarration(scene: SceneV3): string[] {
  const { sb, tl } = scene;
  return sb.beats.map((b, i) => {
    const tb = tl.beats[i];
    return `${b.id} [${b.act}] ${(tb.firstWordF / tl.fps).toFixed(1)}–${(tb.lastWordEndF / tl.fps).toFixed(1)} s${b.pauseAfterMs ? ` (then ${b.pauseAfterMs} ms silence)` : ""} "${b.phrase}"`;
  });
}

/** Per component used: its states and what each state draws (the judge reads protection from this). */
export function componentSemantics(sb: StoryboardV3T, scene: SceneV3): string[] {
  const used = [...new Set(sb.world.map((w) => w.component))];
  const out: string[] = [];
  for (const c of used) {
    const meta = scene.metaOf(c);
    const p = PROTECTION[c];
    if (!meta && !p) continue;
    const states = p ? Object.entries(p.states).map(([k, v]) => `${k} = ${v}`).join("; ") : (meta?.states ?? []).join(", ");
    const does = meta?.verbs.state?.does;
    out.push(`${c}: ${meta?.summary ?? ""}${states ? ` | states: ${states}` : ""}${does ? ` | state change: ${does}` : ""}${p ? ` | PROTECTED states: ${p.protectedStates.join(", ")}` : ""}`.slice(0, 600));
  }
  return out;
}

/** Every part the board aims at or binds to, with the component's own label for it (parts drawn by a component that
 *  the asset manifest does not list, e.g. the website's "check", are real parts too). */
export function partsUsed(sb: StoryboardV3T, scene: SceneV3): string[] {
  const refs = new Set<string>();
  for (const w of sb.world) if (w.bind) refs.add(`${w.bind.to.instance}#${w.bind.to.anchor}`);
  for (const b of sb.beats) {
    for (const c of b.camera) if ("anchor" in c.target) refs.add(`${(c.target as { instance: string }).instance}#${(c.target as { anchor: string }).anchor}`);
    for (const a of b.actions) for (const v of a.via ?? []) refs.add(`${v.instance}#${v.anchor}`);
  }
  return [...refs].sort().map((r) => `${r} = ${scene.lowered.anchorPoints[r]?.label ?? "?"}`);
}

/** STATE TIMELINE: per beat, every change of a content item / lock / snooper (enter, exit, state, travel with its
 *  route and protection) and a settled snapshot of the visible ones (state + place). */
export function stateTimeline(m: BoardModel): string[] {
  const { scene } = m;
  const { sb, tl } = scene;
  const comp = (id: string) => sb.world.find((w) => w.id === id)?.component ?? "";
  const ids = [...m.tracked, ...sb.world.filter((w) => w.component === "Snooper").map((w) => w.id)];
  const stateText = (id: string, f: number) => {
    const s = m.stateAt(id, f);
    return PROTECTION[comp(id)]?.states[s] ?? s;
  };
  /** an unprotected box that has not moved yet and locks before (or as) it first moves */
  const packing = (id: string, f: number) => {
    if (comp(id) !== "LockBox" || m.protectedAt(id, f + 1)) return false;
    const first = scene.travels.filter((t) => t.instance === id).sort((a, b) => a.startF - b.startF)[0]?.startF ?? Infinity;
    const locks = m.steps.get(id)?.find((s) => s.f > f && isProtected("LockBox", s.state))?.f;
    return f < first && locks !== undefined && locks <= first + PACK_TOLERANCE_F;
  };
  const out: string[] = [];
  sb.beats.forEach((b, bi) => {
    const tb = tl.beats[bi];
    const f0 = bi === 0 ? 0 : tb.startF;
    const f1 = tb.endF;
    out.push(`${b.id} ${m.sec(f0)}–${m.sec(f1)} s "${b.phrase}"`);
    const ev = tl.events
      .filter((e): e is Extract<typeof e, { kind: "action" }> => e.kind === "action" && e.beatIndex === bi && ids.includes(e.target) && ["enter", "exit", "state"].includes(e.do))
      .sort((a, c) => a.frame - c.frame);
    for (const e of ev) {
      if (e.do === "enter") out.push(`  ${m.sec(e.frame)} s ${m.name(e.target)} appears ${PROTECTION[comp(e.target)] ? `${stateText(e.target, e.frame)}, ` : ""}${placeWithBox(m, e.target, e.frame)}${packing(e.target, e.frame) ? " — being packed before it leaves" : ""}`);
      else if (e.do === "exit") out.push(`  ${m.sec(e.frame)} s ${m.name(e.target)} disappears (${placeWithBox(m, e.target, e.frame)})`);
      else if (e.state && PROTECTION[comp(e.target)]) {
        const step = m.steps.get(e.target)?.find((s) => s.eventF === e.frame && s.state === e.state);
        if (!step) continue; // a no-op re-assertion of the state it already has
        const vis = scene.visibleAt(e.target, e.frame, 0.05) ? "" : " (while hidden)";
        out.push(`  ${m.sec(e.frame)} s ${m.name(e.target)} → ${stateText(e.target, step.f)}${step.f !== e.frame ? ` (lands ${m.sec(step.f)} s)` : ""}${vis}, ${placeWithBox(m, e.target, e.frame)}`);
      } else if (e.state && comp(e.target) === "Snooper") out.push(`  ${m.sec(e.frame)} s ${m.name(e.target)} → ${e.state}`);
    }
    for (const t of scene.travels.filter((x) => x.beatIndex === bi && ids.includes(x.instance))) {
      const places: string[] = [];
      let unprot: number[] = [];
      let seen = false;
      for (let f = t.startF; f <= t.endF; f += STEP) {
        if (!scene.visibleAt(t.instance, f, 0.05)) continue;
        seen = true;
        const p = placeWithBox(m, t.instance, f).replace(/, \d+ px from ([^;]+)(?:; .*)?$/, " near $1").replace(/ \(\d+ (?:% inside|px outside it)\)/, "");
        if (places[places.length - 1] !== p) places.push(p);
        if (!m.protectedAt(t.instance, f)) unprot.push(f);
      }
      if (!seen) {
        out.push(`  ${m.sec(t.startF)} s ${m.name(t.instance)} moves while hidden`);
        continue;
      }
      const prot =
        unprot.length === 0
          ? "protected the whole way"
          : unprot[unprot.length - 1] <= t.startF + PACK_TOLERANCE_F && packing(t.instance, t.startF - 1)
            ? `protected: its lid lands ${unprot[unprot.length - 1] - t.startF + STEP} f after it sets off (packed at its start)`
            : `UNPROTECTED (${stateText(t.instance, unprot[0])}) ${m.sec(unprot[0])}–${m.sec(unprot[unprot.length - 1])} s`;
      unprot = [];
      // a mid-route touch of an endpoint that is neither the start nor the end is the route passing its corner, not a
      // return to it (S2 W4 validation: "→ at the edge of phone →" read as "the box goes back to the sender")
      const route = places
        .map((p, k) => (k > 0 && k < places.length - 1 && /^(?:at the edge of|beside) /.test(p) ? `passing the corner of ${p.replace(/^(?:at the edge of|beside) /, "").replace(/, at .*$/, "")}` : p))
        .filter((p, k, all) => k === 0 || p !== all[k - 1]);
      out.push(`  ${m.sec(t.startF)}–${m.sec(t.endF)} s ${m.name(t.instance)} travels: ${route.join(" → ")}; ${prot}`);
    }
    // the settled frame, or later when a state change of this beat is still landing then (a lid shutting)
    const landing = [...m.steps.values()].flat().filter((x) => x.beat === b.id && x.f <= f1).map((x) => x.f);
    const f = Math.max(settledOf(tl, tb), ...landing);
    const snap = ids
      .filter((id) => scene.visibleAt(id, f, 0.05))
      .map((id) => `${id} ${PROTECTION[comp(id)] ? m.stateAt(id, f).toUpperCase() : m.stateAt(id, f) || "on screen"} ${placeOf(m, scene.boxAt(id, f), f, id)}`);
    if (snap.length) out.push(`  settled ${m.sec(f)} s: ${snap.join("; ")}`);
  });
  return out;
}

/** On-screen size of the beat's subjects at its settled frame (screen px of 1080×1920): the instances the beat acts
 *  on (or the shot subject), largest first. Shared with the critic. */
export function beatSubjectSizes(m: BoardModel): Array<{ beat: string; f: number; zoom: number; items: Array<{ id: string; w: number; h: number }> }> {
  const { scene } = m;
  const { sb, tl } = scene;
  return sb.beats.map((b, bi) => {
    const f = settledOf(tl, tl.beats[bi]);
    const cam = scene.cam(f);
    const ids = [...new Set([...b.actions.map((a) => a.target), scene.shotOf(bi)?.subject ?? ""])].filter((id) => {
      const w = sb.world.find((x) => x.id === id);
      return !!w && !w.bind?.space?.startsWith("screen") && w.component !== "Figure" && w.component !== "Trace" && scene.visibleAt(id, f, 0.05);
    });
    const items = ids
      .map((id) => {
        const r = scene.boxAt(id, f);
        const s = r ? rectToScreen(cam, r) : null;
        return s ? { id, w: Math.round(s.w), h: Math.round(s.h) } : null;
      })
      .filter((x): x is { id: string; w: number; h: number } => !!x)
      .sort((a, c) => c.w * c.h - a.w * a.h);
    return { beat: b.id, f, zoom: +cam.zoom.toFixed(2), items };
  });
}

// ---------------------------------------------------------------- LLM judge

export const PHYSICS_BOARD_MAX_REPAIRS = 1;

export const PHYSICS_BOARD_SYSTEM_PROMPT = `You are a senior network engineer and physicist who also works as a strict continuity supervisor on animated explainers. You review the STORYBOARD of a 60–80 s vertical explainer for a general, non-technical audience. The narration is final and already fact-checked: do not re-judge its wording. Your job is whether the PICTURE tells the same truth as the voice, at the moment the voice says it, and whether objects behave consistently from beat to beat.
You cannot see the video. You get it as text computed from the real render timeline (what the renderer draws at each frame):
- the narration per beat with its time span;
- one digest line per beat at its settled frame (camera focus, shot, the subject's drawn state, overlays and the part each sits on);
- a STATE TIMELINE: every content item (what is being protected, e.g. a picture) and every lock — when it appears, each state change and when it lands, each move with the places it passes and whether it is protected while moving, and a settled snapshot of where each one is. Places: "inside X" / "at the edge of X" (an endpoint: the phone, the website), "ON THE WAY, at …" (Wi-Fi, router, a snooper), "OUTSIDE, n px from …";
- the ASSET FACTS (what each drawn object depicts, what each named part physically is, caveats it must not contradict) and the COMPONENT STATE SEMANTICS (which states are drawn protected).
Flag with severity "error" only these:
1. picture-contradicts-narration — what is drawn says something false or the opposite of the voice at that moment: content shown travelling unprotected (open, unlocked, readable) through the Wi-Fi, routers or cables while the voice says it is kept safe on the way; content shown readable where the voice says it cannot be read; an open box or readable content outside the endpoints when nothing says it is unprotected there; a step drawn at a different place than the voice says.
2. state-continuity — a lock opens or shuts with no reason in the narration or the story, opens and shuts again (or the reverse) within a second or two (a flicker), an object is in a state on one beat that contradicts the previous beat without a visible change, or an object jumps to another place without moving.
3. wrong-asset-claim — a label, ring or drawn state claims something the ASSET FACTS do not show or a caveat forbids.
4. normal-thing-styled-as-attack — a normal, intended step drawn as an attack, break-in or failure (a snooper at the website, alarm colours or labels on the website opening its own lock), or an attack drawn as harmless.
5. contradiction — two pictures that cannot both be true in the same story (the lock shown ending at two different places).
Use severity "nit" for small timing slips (a change a fraction of a second off its word) and anything a viewer would not misread.
Do NOT flag: style, size, pacing, camera or composition (another reviewer does that); the narration's own facts; staging conventions — objects entering or leaving, an object prepared while hidden, a picture packed into its box at the phone before it leaves, an object unpacked at (touching) the endpoint it was sent to, a route that brushes past an object's corner, labels. The call-to-action beat (act cta, "Send this to someone …") shows the viewer sharing the VIDEO itself: what moves there is the shared post, not data on the trip the reel explains.
First AUDIT in plain text (no curly braces): A trace each content item through the reel — where it is and whether it is protected at each beat, versus what the voice says then; B trace each lock — every change, its beat, the narrated reason; C every label and ring against the asset facts; D any normal step styled as an attack; E contradictions between beats.
Then for every finding give the beat ids, the exact picture fact (quote the timeline or digest), why it is wrong in one or two plain sentences, and a HINT for the director (what to draw instead, ≤ 30 words).
End your reply with ONE JSON object (nothing after it):
{"ok":true|false,"findings":[{"beats":["b05"],"kind":"picture-contradicts-narration|state-continuity|wrong-asset-claim|normal-thing-styled-as-attack|contradiction","severity":"error|nit","where":"picture|label|state|both","claim":"…","why":"…","hint":"…"}]}
"ok" is true exactly when there is no "error" finding.`;

export interface BoardJudgeInput {
  sb: StoryboardV3T;
  words: WordsFileT | null | undefined;
  /** The ONE sentence the reel makes (narrative.point); optional context. */
  point?: string;
  manifests?: readonly AssetManifestT[];
  scene?: SceneV3;
}

export function physicsBoardPrompt(i: BoardJudgeInput, m: BoardModel = boardModel(i.sb, i.words, { scene: i.scene })): string {
  const manifests = i.manifests ?? ASSETS;
  return [
    ...(i.point ? [tag("point_the_reel_makes", i.point)] : []),
    tag("narration", boardNarration(m.scene).join("\n")),
    tag("digest", digestLinesV3(i.sb, i.words, { scene: m.scene, manifests }).join("\n")),
    tag("state_timeline", stateTimeline(m).join("\n")),
    tag("asset_facts", assetFactsV3(i.sb, manifests).join("\n") || "(none)"),
    tag("parts_used", partsUsed(i.sb, m.scene).join("\n") || "(none)"),
    tag("component_state_semantics", componentSemantics(i.sb, m.scene).join("\n")),
    "Audit first (plain text), then end with the JSON object.",
  ].join("\n");
}

/** Parse a board judge's reply (physics or critic): findings with beat ids. `kinds` = the allowed kinds (unknown → first). */
export function parseBoardFindings(text: string, beatIds: ReadonlySet<string>, kinds: readonly string[], source = "llm"): { ok: boolean; findings: BoardFinding[] } | null {
  const t = String(text ?? "");
  const at = t.search(/\{\s*"ok"\s*:/);
  const o = firstJsonObject(at >= 0 ? t.slice(at) : t);
  if (!o || !Array.isArray(o.findings)) return null;
  const findings: BoardFinding[] = [];
  for (const x of o.findings as unknown[]) {
    if (!x || typeof x !== "object") continue;
    const f = x as Record<string, unknown>;
    const why = clean(f.why, 500);
    if (!why) continue;
    const beats = (Array.isArray(f.beats) ? f.beats : Array.isArray(f.lines) ? f.lines : []).map((b) => String(b).toLowerCase()).filter((b) => beatIds.has(b)).slice(0, 8);
    findings.push({ beats, kind: kinds.includes(String(f.kind)) ? String(f.kind) : kinds[0], severity: f.severity === "nit" ? "nit" : "error", where: clean(f.where, 20) || "picture", claim: clean(f.claim, 300), why, hint: clean(f.hint, 300), source });
  }
  return { ok: !findings.some((f) => f.severity === "error"), findings: findings.slice(0, 12) };
}

/** Majority vote over N board judges, reusing physicsScript.mergePhysicsVotes (same rule: an error blocks when a
 *  majority raise an error on one of its beats; below the majority it is kept as a nit with its count; a vote with no
 *  usable reply (null) counts as agreeing with every error — FAIL CLOSED). Beats ride in the `lines` field. */
export function mergeBoardVotes(perVote: ReadonlyArray<readonly BoardFinding[] | null>): BoardFinding[] {
  const toP = (f: BoardFinding) => ({ lines: f.beats, kind: f.kind, severity: f.severity, where: f.where, claim: f.claim, why: f.why, hint: f.hint, source: f.source }) as unknown as PhysicsScriptFinding;
  const merged = mergePhysicsVotes(perVote.map((v) => (v === null ? null : v.map(toP))));
  return merged.map((p) => {
    const q = p as unknown as PhysicsScriptFinding & { source?: string };
    return { beats: q.lines, kind: q.kind, severity: q.severity, where: q.where, claim: q.claim, why: q.why, hint: q.hint, source: q.source ?? "llm" };
  });
}

export function findingGaps(gate: BoardGap["gate"], fs: readonly BoardFinding[]): BoardGap[] {
  return fs.map((f) => ({ gate, code: `${gate === "critic" ? "CR" : "PB"}:${f.kind}`, severity: f.severity === "error" ? ("block" as const) : ("warn" as const), beats: f.beats, message: `[${f.kind}, ${f.where}]${f.claim ? ` "${f.claim}"` : ""}: ${f.why}`, ...(f.hint ? { hint: f.hint } : {}) }));
}

export interface VotedJudgeResult {
  ok: boolean;
  findings: BoardFinding[];
  gaps: BoardGap[];
  votes: number;
  perVote: Array<BoardFinding[] | null>;
  raw: string;
  spend: JudgeSpend[];
}

/** N independent votes of one board judge (shared by physics + critic): fail closed when a majority is unusable. */
export async function runVotedBoardJudge(
  a: JudgeRunArgs & { votes?: number },
  o: { gate: BoardGap["gate"]; votesEnv: string; modelEnv: string; defaultModel: string; system: string; prompt: string; beatIds: ReadonlySet<string>; kinds: readonly string[] },
): Promise<VotedJudgeResult> {
  const N = judgeVotes(o.votesEnv, a);
  const one = async (i: number) => {
    const s = await judgeSession(o.gate, o.system, modelFor(o.modelEnv, o.defaultModel, a), { ...a, claudeDir: voteDir(a.claudeDir, i, N) });
    let raw = await s.ask(o.prompt);
    let v = parseBoardFindings(raw, o.beatIds, o.kinds);
    for (let r = 0; !v && r < PHYSICS_BOARD_MAX_REPAIRS; r++) {
      raw = await s.ask(`${o.prompt}\n\nYour previous reply did not end with the JSON object. Reply with the JSON object only.`);
      v = parseBoardFindings(raw, o.beatIds, o.kinds);
    }
    a.log?.(`${o.gate} vote ${i + 1}/${N}: ${v ? (v.ok ? "ok" : `${v.findings.filter((f) => f.severity === "error").length} error(s)`) : "no reply"}, $${s.spend.costUsd.toFixed(4)}`);
    return { findings: v?.findings ?? null, raw, spend: s.spend };
  };
  const runsOut = await Promise.all(Array.from({ length: N }, (_, i) => one(i).catch((e: unknown) => ({ findings: null, raw: `ERROR ${String((e as Error)?.message ?? e)}`, spend: (e as { spend?: JudgeSpend })?.spend ?? { gate: o.gate, model: "?", asks: 0, turns: 0, costUsd: 0, ms: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } } }))));
  const spend = runsOut.map((r) => r.spend);
  const raw = runsOut.map((r, i) => (N === 1 ? r.raw : `--- vote ${i + 1} ---\n${r.raw}`)).join("\n");
  const perVote = runsOut.map((r) => r.findings);
  const usable = perVote.filter((v) => v !== null).length;
  if (usable < majorityOf(N)) {
    return { ok: false, findings: [], gaps: [{ gate: o.gate, code: `${o.gate === "critic" ? "CR" : "PB"}0`, severity: "block", message: `${o.gate} NOT CHECKED: ${N - usable}/${N} judge vote(s) gave no usable reply` }], votes: N, perVote, raw, spend };
  }
  const findings = mergeBoardVotes(perVote);
  return { ok: !findings.some((f) => f.severity === "error"), findings, gaps: findingGaps(o.gate, findings), votes: N, perVote, raw, spend };
}

export interface PhysicsBoardResult extends VotedJudgeResult {
  /** BP1–BP5 ($0) */
  code: BoardGap[];
  /** true when the LLM votes were skipped (code already blocked and `llmOnCodeBlock` was false) */
  skippedLlm: boolean;
  prompt: string;
}

/** The board physics judge: code checks, then (unless they already block and llmOnCodeBlock is false) N LLM votes
 *  (REEL_V3_PHYSICS_BOARD_VOTES, default 3; model REEL_V3_PHYSICS_BOARD_MODEL, else the v2/v3 physics model). */
export async function runPhysicsBoard(a: JudgeRunArgs & BoardJudgeInput & { votes?: number; llmOnCodeBlock?: boolean }): Promise<PhysicsBoardResult> {
  const m = boardModel(a.sb, a.words, { scene: a.scene });
  const code = boardPhysicsChecks(m);
  const prompt = physicsBoardPrompt(a, m);
  const codeBlocks = !boardGapsPass(code);
  if (codeBlocks && !a.llmOnCodeBlock) {
    a.log?.(`physics-board: ${code.filter((g) => g.severity !== "warn").length} code block(s); LLM votes skipped`);
    return { ok: false, findings: [], gaps: code, code, votes: 0, perVote: [], raw: "", spend: [], skippedLlm: true, prompt };
  }
  const env = a.env ?? process.env;
  const r = await runVotedBoardJudge(a, {
    gate: "physics-board",
    votesEnv: "REEL_V3_PHYSICS_BOARD_VOTES",
    modelEnv: "REEL_V3_PHYSICS_BOARD_MODEL",
    defaultModel: env.REEL_V3_PHYSICS_MODEL?.trim() || env.REEL_V2_PHYSICS_MODEL?.trim() || DEFAULT_PHYSICS_MODEL,
    system: PHYSICS_BOARD_SYSTEM_PROMPT,
    prompt,
    beatIds: new Set(a.sb.beats.map((b) => b.id)),
    kinds: BOARD_PHYSICS_KINDS,
  });
  const gaps = [...code, ...r.gaps];
  return { ...r, ok: boardGapsPass(gaps), gaps, code, skippedLlm: false, prompt };
}
