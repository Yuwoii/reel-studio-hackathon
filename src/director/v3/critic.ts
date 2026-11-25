// v3 BOARD CRITIC + the board-stage judges runner (W4; ADR-002 §6.3 X4/X5, §6.4 second run, hand-off §7 W4 "critic
// X4/X5; the non-technical judge on the board digest").
//
// The v2 §13 critic graded stills against a 42-point rubric; decision 5g retired the rubric gate. What the owner and
// the S2 reviews actually checked is structural, and readable from the board digest without rendering a frame:
//   - the picture follows every line (the thing the line talks about is on screen, and changes, when it is said);
//   - the objects are big enough at phone size;
//   - no dead stretch longer than ~5 s (nothing moves, nothing changes);
//   - ≤ 6 hard cuts, each in a pause (D1 5g);
//   - X4 the real object recognisable at its still, overlays on their parts; X5 the hook shows a concrete object in its
//     first second, the payoff returns to it.
// Two layers again:
//   1. CODE ($0): the v3 lints that measure these (A7 first concrete image, A8 mechanism beats real/anchored, A10
//      filled silences, A11 payoff match, L7v3 something changes every beat, L8v3 cuts) plus CR1 dead stretches
//      (> DEAD_ERROR_S error, > DEAD_WARN_S warn) and CR2 subject size at the settled frame (< SIZE_ERROR_PX error,
//      < SIZE_WARN_PX warn; screen px on the 1080-wide frame).
//   2. LLM critic (fresh, no tools, Sonnet-class; majority-of-N, fail closed) on the narration + digest + the measured
//      numbers: picture-misses-line / too-small / dead-stretch / cut / hook / payoff / clutter.
// The NON-TECHNICAL judge (nontech.ts, unchanged) runs on the board as a narrative whose "you see" notes are the
// board's own plain picture per beat (viewerPicture), with the timeline's word times as measured timing.
//
// runBoardJudges() is the one call the director's v3 submit flow makes: physics board → critic → non-technical, code
// checks first; when the code checks already block, the LLM votes are skipped (shared subscription) unless
// llmOnCodeBlock is set.

import { DEFAULT_JUDGE_MODEL } from "../v2/judge.js";
import { Narrative, lineWords, type NarrativeT, type NarrativeTiming } from "../../schema/script.v3.js";
import type { StoryboardV3T } from "../../schema/storyboard.v3.js";
import { ASSETS } from "../../v3/assets.gen.js";
import { digestLinesV3 } from "../../v3/digest.js";
import { lintStoryboardV3, sceneV3, type SceneV3 } from "../../v3/lints.js";
import { area, intersect, type Rect } from "../../v3/project.js";
import type { JudgeRunArgs, JudgeSpend } from "./claims.js";
import { tag } from "./claims.js";
import { runNontech, type NontechResult } from "./nontech.js";
import {
  ENDPOINT_COMPONENTS,
  PROTECTION,
  WAY_COMPONENTS,
  beatSubjectSizes,
  boardGapsPass,
  boardModel,
  boardNarration,
  runPhysicsBoard,
  runVotedBoardJudge,
  type BoardGap,
  type BoardJudgeInput,
  type BoardModel,
  type PhysicsBoardResult,
  type VotedJudgeResult,
} from "./physicsBoard.js";

// ---------------------------------------------------------------- code metrics

export const DEAD_WARN_S = 4;
export const DEAD_ERROR_S = 5;
/** Smallest side of a beat's acted-on object at its settled frame (screen px, 1080 × 1920 frame). S2 r1 (accepted)
 *  measured 120 px for its smallest (the end-of-line padlock in the 39 s wide): its reviewers called those "small",
 *  so < 140 warns; < 80 px (≈ 4 mm on a phone) is a speck and errors. */
export const SIZE_WARN_PX = 140;
export const SIZE_ERROR_PX = 80;
/** The v3 lints the critic reports as its own structure evidence. */
export const CRITIC_LINT_IDS = ["A7", "A8", "A10", "A11", "L7v3", "L8v3"] as const;

/** Frames where something visibly changes: camera moves/cuts, action events over their verb duration, travels. */
export function changeCover(scene: SceneV3): Array<[number, number]> {
  const { tl, sb } = scene;
  const spans: Array<[number, number]> = [];
  for (const s of tl.cameraSegments) spans.push([s.startF, Math.max(s.startF + 1, s.endF)]);
  for (const e of tl.events) {
    if (e.kind !== "action") continue;
    const comp = sb.world.find((w) => w.id === e.target)?.component ?? "";
    const verbs = scene.metaOf(comp)?.verbs as Record<string, { durF?: number } | undefined> | undefined;
    spans.push([e.frame, e.frame + Math.max(6, verbs?.[e.do]?.durF ?? 12)]);
  }
  for (const t of scene.travels) spans.push([t.startF, t.endF]);
  spans.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

/** Stretches with no visible change (frames), longest first. */
export function deadStretches(scene: SceneV3): Array<{ fromF: number; toF: number; sec: number }> {
  const cover = changeCover(scene);
  const end = scene.tl.durationF;
  const out: Array<{ fromF: number; toF: number; sec: number }> = [];
  let cur = 0;
  for (const [a, b] of cover) {
    if (a > cur) out.push({ fromF: cur, toF: a, sec: +((a - cur) / scene.tl.fps).toFixed(2) });
    cur = Math.max(cur, b);
  }
  if (end > cur) out.push({ fromF: cur, toF: end, sec: +((end - cur) / scene.tl.fps).toFixed(2) });
  return out.sort((x, y) => y.sec - x.sec);
}

export interface CriticMetrics {
  durationSec: number;
  hardCuts: Array<{ f: number; sec: number; beat: string; inPause: boolean }>;
  dead: Array<{ fromSec: number; toSec: number; sec: number; beats: string[] }>;
  sizes: ReturnType<typeof beatSubjectSizes>;
  lints: Array<{ id: string; severity: string; beat?: string; message: string }>;
}

/** The measured numbers without the lint list (criticCodeChecks adds it). */
export const criticMetrics = (m: BoardModel): CriticMetrics => criticMetricsWith(m, []);

function criticMetricsWith(m: BoardModel, lints: CriticMetrics["lints"]): CriticMetrics {
  const { scene } = m;
  const { tl, sb } = scene;
  const hardCuts = tl.hardCuts.map((f) => {
    const bi = m.beatAt(f);
    const b = tl.beats[bi];
    const prev = tl.beats[bi - 1];
    // in a pause: at/after the previous phrase's last word, before this phrase's first word (+ the lint's 4 f)
    const inPause = (!prev || f >= prev.lastWordEndF) && f <= b.firstWordF + 4;
    return { f, sec: +(f / tl.fps).toFixed(2), beat: sb.beats[bi].id, inPause };
  });
  const dead = deadStretches(scene)
    .filter((d) => d.sec >= 2)
    .map((d) => ({ fromSec: +(d.fromF / tl.fps).toFixed(1), toSec: +(d.toF / tl.fps).toFixed(1), sec: d.sec, beats: [...new Set([m.beatAt(d.fromF), m.beatAt(Math.max(d.fromF, d.toF - 1))])].map((i) => sb.beats[i].id) }));
  return { durationSec: +(tl.durationF / tl.fps).toFixed(2), hardCuts, dead, sizes: beatSubjectSizes(m), lints };
}

export function criticCodeChecks(sb: StoryboardV3T, words: BoardJudgeInput["words"], m: BoardModel): { gaps: BoardGap[]; metrics: CriticMetrics } {
  const rep = lintStoryboardV3(sb, words, {});
  const lints = rep.results.filter((r) => (CRITIC_LINT_IDS as readonly string[]).includes(r.id)).map((r) => ({ id: r.id, severity: r.severity, beat: r.beatId, message: r.message }));
  const metrics = criticMetricsWith(m, lints);
  const gaps: BoardGap[] = lints.map((l) => ({ gate: "critic", code: `CR:${l.id}`, severity: l.severity as BoardGap["severity"], ...(l.beat ? { beats: [l.beat] } : {}), message: `[${l.id}] ${l.message}` }));
  for (const d of metrics.dead.filter((x) => x.sec > DEAD_WARN_S))
    gaps.push({ gate: "critic", code: "CR1", severity: d.sec > DEAD_ERROR_S ? "error" : "warn", beats: d.beats, message: `[dead-stretch] nothing visibly changes for ${d.sec} s (${d.fromSec}–${d.toSec} s)`, hint: "Give that stretch a camera move, a state change or a travel on its key word." });
  // the objects the line acts on (not the ones leaving), at the settled frame
  sb.beats.forEach((b, bi) => {
    const s = metrics.sizes[bi];
    const acting = new Set(b.actions.filter((a) => a.do !== "exit").map((a) => a.target));
    const subject = m.scene.shotOf(bi)?.subject;
    for (const it of s.items.filter((x) => acting.has(x.id) || x.id === subject)) {
      const side = Math.min(it.w, it.h);
      if (side >= SIZE_WARN_PX) continue;
      gaps.push({ gate: "critic", code: "CR2", severity: side < SIZE_ERROR_PX ? "error" : "warn", beats: [b.id], message: `[too-small] ${it.id} is ${it.w}×${it.h} px at ${(s.f / m.fps).toFixed(1)} s (zoom ${s.zoom}) on "${b.phrase}"`, hint: "Push in on it (zoom so it is ≥ 140 px), or scale it up." });
    }
  });
  return { gaps, metrics };
}

/** The measured numbers as the LLM critic reads them. */
export function metricsBlock(mt: CriticMetrics): string {
  return [
    `duration ${mt.durationSec} s`,
    `hard cuts (${mt.hardCuts.length}): ${mt.hardCuts.map((c) => `${c.beat} @${c.sec} s ${c.inPause ? "in a pause" : "WHILE A WORD IS SPOKEN"}`).join("; ") || "none"}`,
    `longest stretches with no visible change: ${mt.dead.slice(0, 5).map((d) => `${d.sec} s (${d.fromSec}–${d.toSec} s, ${d.beats.join("/")})`).join("; ") || "none ≥ 2 s"}`,
    "on-screen size of what each beat acts on, at its settled frame (screen px of a 1080 × 1920 frame):",
    ...mt.sizes.map((s) => `  ${s.beat} z${s.zoom}: ${s.items.map((i) => `${i.id} ${i.w}×${i.h}`).join(", ") || "(nothing tracked)"}`),
    `lints: ${mt.lints.map((l) => `${l.id} ${l.severity}${l.beat ? ` ${l.beat}` : ""}: ${l.message}`).join(" | ") || "clean"}`,
  ].join("\n");
}

// ---------------------------------------------------------------- LLM critic

export const CRITIC_KINDS = ["picture-misses-line", "too-small", "dead-stretch", "cut", "hook", "payoff", "clutter"] as const;

export const CRITIC_SYSTEM_PROMPT = `You are the edit critic for 9:16 explainer reels watched on a phone (Instagram), for a general audience. You judge the STORYBOARD from text: the narration with its time spans, one digest line per beat at its settled frame (camera zoom and focus, the shot and its subject, the subject's drawn state, overlays and the part each sits on), a plain description of what the viewer sees per beat, and numbers measured on the real render timeline (on-screen sizes, cuts, stretches with no visible change). The voice is final; do not judge its wording or its facts, and do not judge whether a picture is physically correct (another reviewer does that).
Judge whether the PICTURE carries the narration on a phone. Flag with severity "error" only when a viewer would be confused, miss the point or stop watching:
1. picture-misses-line — when a line is spoken, the thing it talks about is not on screen, not in focus, or nothing about it changes, or the screen shows a different thing (the line names the website's front server, the camera is on the phone).
2. too-small — the object the line is about is too small to read on a phone: below about 80 px on its short side it is a speck; a padlock, label or picture the line depends on needs about 140 px.
3. dead-stretch — nothing visibly changes for more than about 5 s.
4. cut — more than 6 hard cuts, or a hard cut that lands while a word is being spoken.
5. hook — the first second does not show a concrete, recognisable object, or the opening question has no picture of the thing it asks about.
6. payoff — the payoff does not return to the hook's object (the viewer never sees the answer land on the thing asked about).
7. clutter — several things compete where the line is about one (labels piling up, a ring around the wrong part).
Use severity "nit" for anything weaker (slightly small, a little busy, a change a few frames late).
First AUDIT in plain text (no curly braces), beat by beat: what the line is about, what the screen shows then, its size, whether it changes on the line. Then the hook, the payoff, cuts and the longest still stretches.
End your reply with ONE JSON object (nothing after it):
{"ok":true|false,"findings":[{"beats":["b05"],"kind":"picture-misses-line|too-small|dead-stretch|cut|hook|payoff|clutter","severity":"error|nit","where":"picture","claim":"<what the board shows, quoted>","why":"…","hint":"<what to show instead, ≤ 30 words>"}]}
"ok" is true exactly when there is no "error" finding.`;

// ---------------------------------------------------------------- viewer picture (non-technical judge, critic)

/** Visible prop changes in plain words (component metas: WebsiteCluster check/meters/active, Phone photo/bar/screen). */
const PLAIN_PROPS: Record<string, (k: string, v: unknown, all: Record<string, unknown>, name: string) => string | undefined> = {
  WebsiteCluster: (k, v, all) =>
    k === "check" && v === true
      ? "a calm green check appears next to the website's name"
      : k === "meters"
        ? v === true
          ? `small effort meters appear: the front server's is ${Number(all.frontLoad ?? 0) >= 0.5 ? "high" : "low"}, the computers' behind it ${Number(all.backLoad ?? 0) >= 0.5 ? "high" : "low"}`
          : "the effort meters go away"
        : k === "active" && typeof v === "number" && v > 0
          ? `the line to computer ${v} behind the front server lights up`
          : undefined,
  Phone: (k, v, _all, name) =>
    k === "photo"
      ? v === "none"
        ? `the picture lifts off ${name}'s screen, leaving an empty slot`
        : `the picture is back on ${name}'s screen`
      : k === "bar" && v === "tapped"
        ? `${name}'s address bar expands to 'https://example.com'`
        : k === "highlight" && v === "s"
          ? "the 's' lights up"
          : k === "screen" && v === "post"
            ? `${name} shows the picture as a new post`
            : undefined,
};
const PLAIN_ENTER_STATE: Record<string, string> = { open: "open", locked: "locked", peek: "locked", unlocked: "open", shown: "the photo showing", scrambled: "scrambled" };
const ENDPOINT_OR_WAY: ReadonlySet<string> = new Set([...ENDPOINT_COMPONENTS, ...WAY_COMPONENTS].filter((c) => c !== "Snooper"));

/** Viewer names: every copy of the picture is "the picture"; the first box is "your box". */
function plainName(m: BoardModel, id: string): string {
  const c = m.scene.sb.world.find((w) => w.id === id)?.component;
  if (c === "PhotoCard") return "the picture";
  if (c === "LockBox") return m.tracked.find((x) => m.scene.sb.world.find((w) => w.id === x)?.component === "LockBox") === id ? "your box" : "another box";
  return m.name(id).replace(/^[^(]*\(|\)$/g, "");
}
const PLAIN_STATE: Record<string, Record<string, string>> = {
  LockBox: {
    open: "the box opens; the picture is out and visible",
    locked: "the box's lid shuts and its padlock clicks shut",
    peek: "the box turns see-through: the picture inside is just scrambled characters, but the address label stays readable",
    unlocked: "the box's padlock opens and the picture rises out",
  },
  Padlock: { open: "the padlock opens", locked: "the padlock clicks shut" },
  PhotoCard: { scrambled: "the picture turns into scrambled characters", shown: "the picture shows clearly" },
  WebsiteCluster: { split: "the website opens up: a front server in front, a row of computers behind it", box: "the website is one box" },
  Snooper: { looking: "the person raises the magnifier to look", idle: "the person lowers the magnifier" },
  WifiSignal: { active: "the Wi-Fi symbol lights up", idle: "the Wi-Fi symbol dims" },
  Router: { active: "the router's lights blink", idle: "the router's lights calm down" },
  WeeksPoster: {
    blank: "the poster's boxes are all empty",
    seg1: "the next share of boxes fills with colour",
    seg2: "the next share of boxes fills with colour",
    seg3: "the next share of boxes fills with colour",
    seg4: "the next share of boxes fills with colour",
    seg5: "the next share of boxes fills with colour",
    seg6: "the next share of boxes fills with colour",
    empty: "the empty boxes still left light up",
    dim: "the poster dims",
  },
  LeafSection: {
    open: "the leaf's pore opens",
    narrow: "the leaf's pore half closes",
    shut: "the leaf's pore closes",
    night: "night falls on the leaf",
    day: "day breaks on the leaf",
  },
  Plant: { day: "the sky turns to day", night: "the sky turns to night" },
};

/** "at your phone" / "at the router" / "inside the website" / "between …" for a viewer. */
function plainPlace(m: BoardModel, r: Rect | null, f: number, self: string): string {
  if (!r) return "";
  const { scene } = m;
  let best: { id: string; share: number } | null = null;
  for (const id of [...m.endpoints, ...m.way]) {
    if (id === self || !scene.liveAt(id, f)) continue;
    const share = area(intersect(r, scene.boxAt(id, f) ?? { x: 0, y: 0, w: 0, h: 0 })) / Math.max(1, area(r));
    if (share > 0 && (!best || share > best.share)) best = { id, share };
  }
  if (!best) {
    // not on anything: "beside X" when within 200 px of an endpoint / way object
    // endpoints first (a box packed beside the phone is "beside your phone", even when the Wi-Fi is closer)
    for (const pool of [m.endpoints, m.way]) {
      let near: { id: string; d: number } | null = null;
      for (const id of pool) {
        const b = id === self || !scene.liveAt(id, f) ? null : scene.boxAt(id, f);
        if (!b) continue;
        const d = Math.hypot(Math.max(b.x - (r.x + r.w), r.x - (b.x + b.w), 0), Math.max(b.y - (r.y + r.h), r.y - (b.y + b.h), 0));
        if (!near || d < near.d) near = { id, d };
      }
      if (near && near.d <= 200) return `beside ${plainName(m, near.id)}`;
    }
    return "";
  }
  const n = plainName(m, best.id);
  return best.share >= 0.5 && m.endpoints.includes(best.id) ? `inside ${n}` : `at ${n}`;
}

/** What a viewer sees in each beat, in plain words (camera, things appearing, labels in 'quotes' = on-screen text,
 *  state changes, moves). Built from the same scene the digest uses. */
export function viewerPicture(m: BoardModel): string[] {
  const { scene } = m;
  const { sb, tl } = scene;
  const comp = (id: string) => sb.world.find((w) => w.id === id)?.component ?? "";
  const lastState = new Map<string, string>();
  return sb.beats.map((b, bi) => {
    const bits: string[] = [];
    for (const s of tl.cameraSegments.filter((x) => x.beatIndex === bi)) {
      const z = s.to.zoom;
      const key = b.camera[s.keyIndex]?.target as Record<string, unknown> | undefined;
      // the object the camera lands on: its target instance, else the visible object nearest the frame centre
      let on = typeof key?.instance === "string" ? key.instance : "";
      if (!on) {
        let best = Infinity;
        for (const id of [...m.endpoints, ...m.way, ...m.tracked]) {
          const r = scene.visibleAt(id, s.endF, 0.2) ? scene.boxAt(id, s.endF) : null;
          if (!r) continue;
          const d = Math.hypot(r.x + r.w / 2 - s.to.x, r.y + r.h / 2 - s.to.y);
          if (d < best) [best, on] = [d, id];
        }
      }
      const what = on ? plainName(m, on) : "the scene";
      const part = typeof key?.anchor === "string" ? scene.lowered.anchorPoints[`${on}#${key.anchor}`]?.label : undefined;
      const view = z >= 1.8 ? `close-up on ${part ?? what}` : z <= 0.75 ? "wide view of the whole trip" : `the view moves to ${what}`;
      const text = s.transition === "hardCut" ? `cut to ${view.replace(/^the view moves to /, "")}` : view;
      if (bits[bits.length - 1] !== text) bits.push(text);
    }
    for (const a of b.actions) {
      const i = sb.world.find((w) => w.id === a.target);
      if (!i) continue;
      const f = tl.events.find((e) => e.kind === "action" && e.beatIndex === bi && e.target === a.target && e.do === a.do)?.frame ?? tl.beats[bi].startF;
      if (a.do === "enter") {
        const lbl = i.bind ? (scene.lowered.anchorPoints[`${i.bind.to.instance}#${i.bind.to.anchor}`]?.label ?? i.bind.to.anchor) : "";
        const text = String(i.props?.text ?? "");
        if (i.component === "LabelPill") bits.push(lbl.toLowerCase() === text.toLowerCase() ? `a label '${text}' appears beside it` : `a label '${text}' points at ${lbl}`);
        else if (i.component === "AnchorRing") bits.push(`a ring circles ${lbl}`);
        else if (i.component === "Trace") bits.push("a bright line runs along the route");
        else if (i.component === "Figure") bits.push("a thin line is drawn along the route");
        else if (i.component !== "Spotlight" && i.component !== "Glow") {
          const st0 = PROTECTION[i.component] ? m.stateAt(i.id, f + 1) : "";
          const st = st0 ? ` (${PLAIN_ENTER_STATE[st0] ?? st0})` : "";
          const where = ENDPOINT_OR_WAY.has(i.component) ? "" : plainPlace(m, scene.boxAt(i.id, f), f, i.id);
          bits.push(`${plainName(m, i.id)} appears${st}${where ? ` ${where}` : ""}`);
        }
      } else if (a.do === "state" && a.state) {
        if (PROTECTION[i.component] && scene.visibleAt(i.id, f, 0.05) === false) continue;
        const prev = lastState.get(i.id) ?? scene.metaOf(i.component)?.states[0];
        lastState.set(i.id, a.state);
        const t = prev === a.state ? undefined : PLAIN_STATE[i.component]?.[a.state];
        if (t) bits.push(t.replace(/^the box/, plainName(m, i.id)));
        // a state event also changes what is drawn through its props (the website's check and meters, the phone's photo)
        const pr = (a.props ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(pr)) {
          const d = PLAIN_PROPS[i.component]?.(k, v, pr, plainName(m, i.id));
          if (d && bits[bits.length - 1] !== d) bits.push(d);
        }
        const txt = (a.props as Record<string, unknown> | undefined)?.text;
        if (i.component === "LabelPill" && typeof txt === "string") bits.push(`the label now reads '${txt}'`);
      } else if (a.do === "travel") {
        const t = scene.travels.find((x) => x.instance === i.id && x.beatIndex === bi);
        if (!t) continue;
        const from = plainPlace(m, scene.boxAt(i.id, t.startF), t.startF, i.id) || "where it was";
        const to = plainPlace(m, scene.boxAt(i.id, t.endF), t.endF, i.id) || "a new spot";
        const bare = (p: string) => p.replace(/^(?:inside|at|beside) /, "");
        const via: string[] = [];
        for (let k = t.startF; k <= t.endF; k += 3) {
          const p = bare(plainPlace(m, scene.boxAt(i.id, k), k, i.id));
          if (p && p !== bare(from) && p !== bare(to) && !via.includes(p)) via.push(p);
        }
        const n = plainName(m, i.id);
        if (bare(from) === bare(to)) bits.push(from === to ? `${n} moves ${to}` : to.startsWith("inside") ? `${n} moves into ${bare(to)}` : to.startsWith("beside") ? `${n} moves out, ${to}` : `${n} moves to ${bare(to)}`);
        else bits.push(`${n} moves from ${bare(from)}${via.length ? ` past ${via.join(", ")}` : ""} to ${bare(to)}`);
      }
    }
    return bits.join("; ").slice(0, 400) || "the picture holds";
  });
}

// ---------------------------------------------------------------- non-technical judge on the board

/** The board as a v3 narrative for nontech.ts: one line per beat ("B01" ↔ b01), the phrase as text, the beat's pause,
 *  and the viewer picture as the line's "you see" note. */
export function boardNarrative(sb: StoryboardV3T, m: BoardModel, o: { point: string; title?: string; slug?: string; track?: NarrativeT["track"] }): NarrativeT {
  const pics = viewerPicture(m);
  return Narrative.parse({
    version: "v3",
    slug: (o.slug ?? sb.codename ?? "board").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board",
    title: (o.title ?? sb.codename ?? "Board").slice(0, 90).padEnd(3, "."),
    track: o.track ?? "how-it-works",
    series: String(sb.series ?? "HOW IT WORKS").slice(0, 24).padEnd(3, "."),
    scope: "reel",
    leadSilenceMs: Math.min(1200, Math.max(0, sb.leadMs ?? 0)),
    hookPattern: "curiosity-question",
    point: o.point,
    lines: sb.beats.map((b, i) => ({ id: `B${b.id.slice(1)}`, act: b.act, text: b.phrase.slice(0, 160), rate: "+0%", pauseAfterMs: Math.min(1500, b.pauseAfterMs ?? 0), shot: { note: pics[i] } })),
    terms: [],
  });
}

/** The timeline's word times as measured narrative timing (null when a beat's word count differs from lineWords). */
export function boardTiming(sb: StoryboardV3T, scene: SceneV3): NarrativeTiming | null {
  const { tl } = scene;
  const lines: NarrativeTiming["lines"] = [];
  for (let i = 0; i < sb.beats.length; i++) {
    const tb = tl.beats[i];
    const w = lineWords(sb.beats[i].phrase);
    if (tb.estimated || tb.words.length !== w.length) return null;
    lines.push({ id: `B${sb.beats[i].id.slice(1)}`, startSec: tb.startF / tl.fps, wordTimes: tb.words.map((x, k) => ({ text: w[k], startSec: x.startMs / 1000, endSec: x.endMs / 1000 })) });
  }
  return { totalSec: tl.durationF / tl.fps, lines };
}

const toBeat = (l: string) => (/^B\d{2}$/.test(l) ? `b${l.slice(1)}` : l);

export interface BoardNontechResult {
  ok: boolean;
  gaps: BoardGap[];
  result: NontechResult | null;
  narrative: NarrativeT | null;
}

export async function runBoardNontech(a: JudgeRunArgs & BoardJudgeInput & { votes?: number; m?: BoardModel }): Promise<BoardNontechResult> {
  if (!a.point || a.point.trim().length < 10) return { ok: false, gaps: [{ gate: "nontech-board", code: "NTB0", severity: "block", message: "non-technical board judge NOT RUN: no point (narrative.point) to compare the restatement with" }], result: null, narrative: null };
  const m = a.m ?? boardModel(a.sb, a.words, { scene: a.scene });
  const narrative = boardNarrative(a.sb, m, { point: a.point });
  const timing = boardTiming(a.sb, m.scene);
  const result = await runNontech({ ...a, narrative, timing });
  const gaps: BoardGap[] = result.gaps.map((g) => ({ gate: "nontech-board", code: `NT:${g.code}`, severity: g.severity, ...(g.lines?.length ? { beats: g.lines.map(toBeat) } : {}), message: g.message.replace(/\bB(\d{2})\b/g, "b$1"), ...(g.hint ? { hint: g.hint } : {}) }));
  return { ok: boardGapsPass(gaps), gaps, result, narrative };
}

// ---------------------------------------------------------------- critic runner

export interface CriticResult extends VotedJudgeResult {
  code: BoardGap[];
  metrics: CriticMetrics;
  skippedLlm: boolean;
  prompt: string;
}

export function criticPrompt(i: BoardJudgeInput, m: BoardModel, metrics: CriticMetrics): string {
  const pics = viewerPicture(m);
  return [
    ...(i.point ? [tag("point_the_reel_makes", i.point)] : []),
    tag("narration", boardNarration(m.scene).join("\n")),
    tag("digest", digestLinesV3(i.sb, i.words, { scene: m.scene, manifests: i.manifests ?? ASSETS }).join("\n")),
    tag("viewer_sees", i.sb.beats.map((b, k) => `${b.id}: ${pics[k]}`).join("\n")),
    tag("measured", metricsBlock(metrics)),
    "Audit first (plain text), then end with the JSON object.",
  ].join("\n");
}

/** The board critic: code checks, then N LLM votes (REEL_V3_CRITIC_VOTES, default 3; model REEL_V3_CRITIC_MODEL). */
export async function runBoardCritic(a: JudgeRunArgs & BoardJudgeInput & { votes?: number; llmOnCodeBlock?: boolean; m?: BoardModel }): Promise<CriticResult> {
  const m = a.m ?? boardModel(a.sb, a.words, { scene: a.scene });
  const { gaps: code, metrics } = criticCodeChecks(a.sb, a.words, m);
  const prompt = criticPrompt(a, m, metrics);
  if (!boardGapsPass(code) && !a.llmOnCodeBlock) return { ok: false, findings: [], gaps: code, code, metrics, votes: 0, perVote: [], raw: "", spend: [], skippedLlm: true, prompt };
  const r = await runVotedBoardJudge(a, { gate: "critic", votesEnv: "REEL_V3_CRITIC_VOTES", modelEnv: "REEL_V3_CRITIC_MODEL", defaultModel: DEFAULT_JUDGE_MODEL, system: CRITIC_SYSTEM_PROMPT, prompt, beatIds: new Set(a.sb.beats.map((b) => b.id)), kinds: CRITIC_KINDS });
  const gaps = [...code, ...r.gaps];
  return { ...r, ok: boardGapsPass(gaps), gaps, code, metrics, skippedLlm: false, prompt };
}

// ---------------------------------------------------------------- all board judges

export interface BoardJudgesResult {
  ok: boolean;
  gaps: BoardGap[];
  physics: PhysicsBoardResult | null;
  critic: CriticResult | null;
  nontech: BoardNontechResult | null;
  spend: JudgeSpend[];
  costUsd: number;
}

export type BoardJudgeName = "physics" | "critic" | "nontech";

/** Physics board → critic → non-technical (each one's votes in parallel, the judges one after another so at most N
 *  sessions share the subscription at a time). Code checks first; a judge's LLM votes are skipped when its own code
 *  checks block, and the later judges are skipped once an earlier judge blocks, unless llmOnCodeBlock / runAll. */
export async function runBoardJudges(a: JudgeRunArgs & BoardJudgeInput & { only?: readonly BoardJudgeName[]; votes?: number; llmOnCodeBlock?: boolean; runAll?: boolean }): Promise<BoardJudgesResult> {
  const only = new Set<BoardJudgeName>(a.only ?? ["physics", "critic", "nontech"]);
  const scene = a.scene ?? sceneV3(a.sb, a.words);
  const m = boardModel(a.sb, a.words, { scene });
  const base = { ...a, scene };
  const sub = (s: string) => ({ claudeDir: `${a.claudeDir}-${s}` });
  let physics: PhysicsBoardResult | null = null;
  let critic: CriticResult | null = null;
  let nontech: BoardNontechResult | null = null;
  const blocked = () => [physics, critic, nontech].some((r) => r && !r.ok);
  if (only.has("physics")) physics = await runPhysicsBoard({ ...base, ...sub("physics") });
  if (only.has("critic") && (a.runAll || !blocked())) critic = await runBoardCritic({ ...base, ...sub("critic"), m });
  if (only.has("nontech") && (a.runAll || !blocked())) nontech = await runBoardNontech({ ...base, ...sub("nontech"), m });
  const gaps = [...(physics?.gaps ?? []), ...(critic?.gaps ?? []), ...(nontech?.gaps ?? [])];
  const spend = [...(physics?.spend ?? []), ...(critic?.spend ?? []), ...(nontech?.result?.spend ?? [])];
  return { ok: boardGapsPass(gaps) && only.size > 0, gaps, physics, critic, nontech, spend, costUsd: +spend.reduce((t, s) => t + s.costUsd, 0).toFixed(4) };
}
