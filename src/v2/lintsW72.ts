// W7.2 lints from the W7.1 pilot review (touch / watch / watch-a2 / anc), pure helpers over the per-beat snapshots
// (visualDigest.ts beatSnapshots, settled keyword frames); lints.ts calls them:
//   L58 act header (how-it-works) — the SPEC right label is the ACT the viewer is in ("STEP 2/4 · THE GRID"), one
//       label per act, never a source / site name (W7.1: "WIKIPEDIA · STEP 1/4" → "CARDINAL PEAK · STEP 2/4" →
//       "WIKIPEDIA · STEP 3/4" mid-reel) — error.
//   L59 (how-it-works) the picture changes on every keyword — ≥ SAME_PICTURE_MAX_BEATS + 1 consecutive beats whose focal subject
//       draws the same state (a camera move or a ring mark is not a change; W7.1 anc b01–b03, touch b08–b10) — error;
//       fewer than MIN_STATIONS distinct focal compositions, or one component on screen in more than
//       MAX_ONE_PICTURE_SHARE of the story beats (touch: the 8×8 grid in 17 of 22 beats) — error.
//   L60 on-screen craft — a title that is a note about the drawing ("8x8 DRAWN FOR CLARITY"); a narrated count over a
//       grid that draws another count ("192 crossings" over 8×8); (how-it-works) a KineticWord held over consecutive
//       keyword stills (anc b17/b18); a pill / callout label that crosses a focal subject's edge or sits on its drawing (touch b05
//       "CAPACITOR" on the grid cells, watch-a2 b11 on the stack); a pill flying through the header band during a
//       camera move — error.
//   L61 colour roles — lime marks THE signal / answer of a card: two different quantities lime in one focal subject at
//       one beat (anc: "OPPOSITE WAVE" and the "FLAT" sum; watch: the blood layer and the light rays) — error.

import type { Storyboard } from "../schema/storyboard.v2.js";
import { calloutGeometry, type CalloutPropsT } from "./components-meta/Callout.js";
import { drawnTraceTone, type SignalTracePropsT } from "./components-meta/SignalTrace.js";
import { rayTone, type LayerStackPropsT } from "./components-meta/LayerStack.js";
import type { SensorGridPropsT } from "./components-meta/SensorGrid.js";
import { LIBRARY_LOOKUP, parseInstanceProps } from "./library.js";
import { contentParts, HEADER_BAND_BOTTOM, hostLabel, projectBox, visibleChange } from "./lints.js";
import { cameraAt, type Box, type FootprintLookup, type Timeline } from "./timeline.js";
import { digestItemFull, drawnTexts, visibility, type BeatSnapshot, type OnScreen } from "./visualDigest.js";

export interface W72Finding {
  id: "L58" | "L59" | "L60" | "L61";
  severity: "error" | "warn";
  message: string;
  beatId?: string;
  frame?: number;
}

// ── L58 act header ──────────────────────────────────────────────────────────────────────────────────────────────

/** The how-it-works SPEC right label: `STEP n/m · <ACT>`. */
export const ACT_HEADER_RE = /^STEP (\d+)\/(\d+) · ([A-Z][A-Z0-9 .:/+-]*)$/;
const ACT_FILLER = new Set(["THE", "A", "AN", "OF", "AND", "IN", "ON", "TO", "STEP", "HOW", "WHY", "IT", "YOUR"]);
const compactUp = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Site / publisher names of the board's sources (host label, the title's site-name part before ":" / "|" / " - "
 *  or after the last ","), upper-case compact, ≥ 4 chars. */
export function sourceSiteNames(sources: ReadonlyArray<{ id: string; title: string; ref: string }>): Set<string> {
  const out = new Set<string>();
  const add = (x: string | null | undefined) => {
    const c = compactUp(x ?? "");
    if (c.length >= 4) out.add(c);
  };
  for (const s of sources) {
    const url = /https?:\/\/\S+/.exec(s.ref)?.[0];
    add(url ? hostLabel(url) : null);
    const head = /^(.{3,40}?)\s*(?::|\s[|–—-]\s)/.exec(s.title)?.[1];
    if (head && head.split(/\s+/).length <= 3) add(head);
    const tail = /,\s*([^,]{3,30})$/.exec(s.title)?.[1];
    if (tail && tail.split(/\s+/).length <= 3) add(tail);
  }
  return out;
}

/** L58: on how-it-works (`required`) every right label is an act label, the acts count up 1 → m one at a time, an
 *  act keeps its label until the next act, and an act never names a source. Without `required`, act labels that are
 *  used are still held to the act rules. */
export function actHeaderIssues(sb: Pick<Storyboard, "headerRight" | "beats" | "sources">, o: { required?: boolean } = {}): W72Finding[] {
  const labels: Array<{ beat?: string; text: string }> = [{ text: sb.headerRight }, ...sb.beats.filter((b) => b.header?.right).map((b) => ({ beat: b.id, text: b.header!.right! }))];
  const acts = labels.map((l) => ({ ...l, m: ACT_HEADER_RE.exec(l.text.trim()) }));
  if (!acts.some((a) => a.m))
    return o.required
      ? [{ id: "L58", severity: "error", message: `header: the right labels (${[...new Set(labels.map((l) => JSON.stringify(l.text)))].join(" → ")}) are not act labels — on how-it-works the right label is the act the viewer is in, "STEP n/m · <ACT>" ("STEP 1/4 · THE GLASS" → "STEP 2/4 · THE GRID"), held until the next act, never a source or site name` }]
      : [];
  const out: W72Finding[] = [];
  const where = (b?: string) => b ?? "header";
  const at = (b?: string) => (b ? { beatId: b } : {});
  const sites = sourceSiteNames(sb.sources ?? []);
  const spoken = compactUp(sb.beats.map((b) => b.phrase ?? "").join(" "));
  const byStep = new Map<number, string>();
  let prev = 0;
  let total: number | null = null;
  for (const a of acts) {
    if (!a.m) {
      if (o.required)
        out.push({ id: "L58", severity: "error", message: `${where(a.beat)}: the header ${JSON.stringify(a.text)} is not an act label — on how-it-works the right label is the act the viewer is in, "STEP n/m · <ACT>" ("STEP 2/4 · THE GRID"), never a source or site name`, ...at(a.beat) });
      continue;
    }
    const n = Number(a.m[1]);
    const m = Number(a.m[2]);
    const act = a.m[3].trim();
    if (total === null) total = m;
    else if (m !== total) out.push({ id: "L58", severity: "error", message: `${where(a.beat)}: "${a.text}" counts ${m} acts, the opening label ${total} — one total for the whole reel`, ...at(a.beat) });
    if (prev === 0 && n !== 1) out.push({ id: "L58", severity: "error", message: `${where(a.beat)}: the first act label is "${a.text}" — the reel opens on STEP 1/${m}`, ...at(a.beat) });
    else if (prev && n !== prev && n !== prev + 1) out.push({ id: "L58", severity: "error", message: `${where(a.beat)}: "${a.text}" jumps from step ${prev} to ${n} — acts count up one at a time`, ...at(a.beat) });
    const had = byStep.get(n);
    if (had !== undefined && had !== act) out.push({ id: "L58", severity: "error", message: `${where(a.beat)}: act ${n} changes its label mid-act ("${had}" → "${act}") — the header holds one label per act; change it only when the next act starts`, ...at(a.beat) });
    if (had === undefined) byStep.set(n, act);
    const c = compactUp(act);
    const site = [...sites].find((x) => c.includes(x));
    // a site name the narration itself speaks is the reel's subject (a reel about the Apple Watch), not a source credit
    if (site && !spoken.includes(site)) out.push({ id: "L58", severity: "error", message: `${where(a.beat)}: the act "${act}" names a source (${site}) — the header shows the act ("THE GRID", "THE LIGHT PATH"), never where the facts came from; credit sources on the card`, ...at(a.beat) });
    else if (!act.split(/\s+/).some((w) => w.length >= 3 && !ACT_FILLER.has(w))) out.push({ id: "L58", severity: "error", message: `${where(a.beat)}: the act "${act}" names nothing — give the act a 1–3 word name of what it shows ("THE GRID")`, ...at(a.beat) });
    prev = Math.max(prev, n);
  }
  if (total !== null && prev && prev < total) out.push({ id: "L58", severity: "warn", message: `header: the last act shown is ${prev} of ${total} — m counts the acts the reel shows` });
  return out;
}

// ── L59 the picture changes on every keyword; stations ─────────────────────────────────────────────────────────

/** Consecutive beats a focal picture may stay the same (the next one is an error). */
export const SAME_PICTURE_MAX_BEATS = 2;
/** Distinct focal compositions (sets of focal instances, KineticWord / SourceTag aside) a reel needs. */
export const MIN_STATIONS = 3;
/** Share of the story beats (CTA excluded) one focal component may be on screen in. */
export const MAX_ONE_PICTURE_SHARE = 0.6;
const STATION_SKIP = new Set(["KineticWord", "SourceTag", "Stamp"]);
/** Emphasis tokens in a digest (a ring / mark) — not a change of what is drawn. */
const MARK_TOKENS = /\s?ring#\d+|\s?moving\b/g;

const focalOf = (s: BeatSnapshot) => s.items.filter((o) => o.focal);
/** A SensorGrid close-up (state zoom) is its own picture: a station, and not the grid's share (visualStates' rule). */
const closeup = (o: Pick<OnScreen, "inst" | "state">) => (o.inst.component === "SensorGrid" && o.state === "zoom" ? ":closeup" : "");
/** Why the focal picture of `cur` differs from `prev` with the camera held still, or null (same drawn picture). */
export function pictureChange(prev: BeatSnapshot, cur: BeatSnapshot): string | null {
  const a = focalOf(prev);
  const z = focalOf(cur);
  const same = a.length === z.length && z.every((o) => {
    const p = a.find((x) => x.inst.id === o.inst.id);
    return !!p && p.state === o.state && digestItemFull(p).replace(MARK_TOKENS, "") === digestItemFull(o).replace(MARK_TOKENS, "");
  });
  if (same) return null;
  return visibleChange(prev, { ...cur, cam: prev.cam });
}

/** L59 runs: ≥ SAME_PICTURE_MAX_BEATS + 1 consecutive story beats with the same drawn focal picture, any camera. */
export function samePictureRuns(snaps: readonly BeatSnapshot[], keywordOf: (beatId: string) => string = () => ""): Array<{ beats: string[]; keywords: string[]; frame: number; digest: string }> {
  const out: Array<{ beats: string[]; keywords: string[]; frame: number; digest: string }> = [];
  let run: BeatSnapshot[] = [];
  const flush = () => {
    if (run.length > SAME_PICTURE_MAX_BEATS && focalOf(run[0]).length)
      out.push({ beats: run.map((s) => s.beat.id), keywords: run.map((s) => keywordOf(s.beat.id)), frame: run[0].frame, digest: focalOf(run[0]).map((o) => digestItemFull(o).replace(MARK_TOKENS, "")).join(" · ").slice(0, 120) });
    run = [];
  };
  snaps.forEach((s, i) => {
    if (s.beat.part === "cta") return flush();
    const prev = snaps[i - 1];
    if (!run.length || !prev || pictureChange(prev, s) !== null) {
      flush();
      run = [s];
    } else run.push(s);
  });
  flush();
  return out;
}

export function keywordChangeIssues(snaps: readonly BeatSnapshot[], sb: Pick<Storyboard, "beats">, o: { skipBeats?: ReadonlySet<string> } = {}): W72Finding[] {
  const out: W72Finding[] = [];
  const kw = new Map(sb.beats.map((b) => [b.id, b.keyword]));
  for (const r of samePictureRuns(snaps, (id) => kw.get(id) ?? "")) {
    if (o.skipBeats && r.beats.every((b) => o.skipBeats!.has(b))) continue; // L43 already reports this run
    out.push({
      id: "L59",
      severity: "error",
      message: `${r.beats[0]}–${r.beats[r.beats.length - 1]}: ${r.beats.length} beats draw the same picture (${r.digest}) — the keywords ${r.keywords.map((k) => JSON.stringify(k)).join(", ")} change nothing in the subject (a camera move or a ring is not a change): give each keyword a state change of the focal subject (the field weakens → it dims, a row is scanned → it lights) or a new focal element, or merge the phrases`,
      beatId: r.beats[0],
      frame: r.frame,
    });
  }
  const story = snaps.filter((s) => s.beat.part !== "cta");
  if (!story.length) return out;
  const comps = new Set(story.map((s) => focalOf(s).filter((x) => !STATION_SKIP.has(x.inst.component)).map((x) => x.inst.id + closeup(x)).sort().join("+")).filter(Boolean));
  if (comps.size < MIN_STATIONS)
    out.push({ id: "L59", severity: "error", message: `the reel shows only ${comps.size} focal picture(s) (${[...comps].join(" | ")}) — use ≥ ${MIN_STATIONS} stations: the thing in the viewer's hand, the cross-section / mechanism, the measured signal, the close-up of the one part that changes`, beatId: story[0].beat.id });
  const count = new Map<string, string[]>();
  for (const s of story) for (const c of new Set(focalOf(s).filter((x) => !STATION_SKIP.has(x.inst.component)).map((x) => x.inst.component + closeup(x)))) (count.get(c) ?? count.set(c, []).get(c)!).push(s.beat.id);
  for (const [c, beats] of count)
    if (beats.length > MAX_ONE_PICTURE_SHARE * story.length)
      out.push({ id: "L59", severity: "error", message: `a ${c} is on screen in ${beats.length} of ${story.length} story beats (> ${Math.round(MAX_ONE_PICTURE_SHARE * 100)} %) — one picture held this long reads as static: move to another station for a step (a close-up of the one part that changes, the measured signal, a HeroStat of the key number) and come back for the climax`, beatId: beats[0] });
  return out;
}

// ── L60 on-screen craft ────────────────────────────────────────────────────────────────────────────────────────

/** A drawn title / caption that talks about the drawing instead of the thing. */
export const META_TEXT_RE = /\b(?:drawn for clarity|for clarity|not to scale|simplified (?:view|grid|drawing)|illustrative|illustration|schematic only|\d+\s*[x×]\s*\d+ (?:shown|drawn))\b/i;
const TITLE_WHATS = new Set(["grid title", "trace title", "stack title", "box title", "hero label", "card", "timeline label"]);
/** Things a narrated count can count on a SensorGrid. */
const GRID_NOUNS = /^(?:crossings?|intersections?|nodes?|cells?|squares?|pixels?|capacitors?|sensors?|points?|electrodes?|photosites?)$/i;
const PILL_COMPONENTS = new Set(["RequestPill", "Callout", "SourceTag"]);
const KINETIC_SKIP = new Set(["KineticWord"]);

const inter = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The label box of a pill-like item on screen (a Callout's pill without its dot and leader). */
export function pillBox(o: Pick<OnScreen, "inst" | "props" | "screen">): Box | null {
  if (!PILL_COMPONENTS.has(o.inst.component)) return null;
  if (o.inst.component === "SourceTag" && (o.props as { variant?: string }).variant === "stack") return null;
  if (o.inst.component !== "Callout") return o.screen;
  const pr = parseInstanceProps("Callout", o.props);
  if (!pr?.ok) return o.screen;
  const g = calloutGeometry(pr.value as CalloutPropsT);
  const k = o.screen.w / Math.max(1, g.w);
  return { x: o.screen.x + g.pill.x * k, y: o.screen.y + g.pill.y * k, w: g.pill.w * k, h: g.pill.h * k };
}

/** Numbers spoken right before a countable noun ("192 crossings", "12-by-16 … 192 capacitors"). */
export function narratedCounts(phrase: string): Array<{ n: number; noun: string }> {
  const out: Array<{ n: number; noun: string }> = [];
  const toks = phrase.replace(/(\d),(\d{3})/g, "$1$2").split(/\s+/);
  toks.forEach((t, i) => {
    const m = /^(\d{2,6})$/.exec(t.replace(/[^\d]/g, "") === t.replace(/[.,;:!?]+$/, "") ? t.replace(/[.,;:!?]+$/, "") : "");
    if (!m) return;
    for (const w of toks.slice(i + 1, i + 4)) {
      const word = w.replace(/[^\p{L}]/gu, "");
      if (GRID_NOUNS.test(word)) {
        out.push({ n: Number(m[1]), noun: word.toLowerCase() });
        break;
      }
    }
  });
  return out;
}

export function craftIssues(snaps: readonly BeatSnapshot[], sb: Pick<Storyboard, "beats" | "world">, tl: Pick<Timeline, "events" | "durationF" | "cameraSegments" | "camera0">, lib: FootprintLookup = LIBRARY_LOOKUP, o: { heldKinetic?: boolean } = {}): W72Finding[] {
  const out: W72Finding[] = [];
  const seen = new Set<string>();
  const once = (key: string, f: W72Finding) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  const beatById = new Map(sb.beats.map((b) => [b.id, b]));
  let prevKinetic: Set<string> = new Set();
  for (const s of snaps) {
    const b = beatById.get(s.beat.id);
    // meta text as a title
    for (const o of s.items)
      for (const t of drawnTexts(o))
        if (TITLE_WHATS.has(t.what) && META_TEXT_RE.test(t.text))
          once(`meta|${o.inst.id}|${t.text}`, { id: "L60", severity: "error", message: `${s.beat.id}: "${o.inst.id}" is titled ${JSON.stringify(t.text)} — a note about the drawing, not the thing: title the subject ("TOUCH GRID", "UNDER THE GLASS") and say "not to scale" with the component's tag`, beatId: s.beat.id, frame: s.frame });
    // narrated count vs the drawn grid
    if (b && s.beat.part !== "cta")
      for (const c of narratedCounts(b.phrase ?? ""))
        for (const o of s.items) {
          if (!o.focal || o.inst.component !== "SensorGrid" || o.state === "zoom") continue; // a close-up shows one crossing
          const pr = parseInstanceProps("SensorGrid", o.props);
          if (!pr?.ok) continue;
          const g = pr.value as SensorGridPropsT;
          const drawn = g.cols * g.rows;
          if (c.n !== drawn && c.n !== g.cols && c.n !== g.rows)
            once(`count|${s.beat.id}|${o.inst.id}`, { id: "L60", severity: "error", message: `${s.beat.id}: the narration says "${c.n} ${c.noun}" over "${o.inst.id}", which draws ${g.cols}×${g.rows} = ${drawn} — the eye counts the grid: say the number over a HeroStat (or a close-up), not over a grid that shows another count`, beatId: s.beat.id, frame: s.frame });
        }
    // a KineticWord held over consecutive keyword stills
    const kin = new Set(s.items.filter((o) => o.inst.component === "KineticWord").map((o) => o.inst.id));
    for (const id of kin)
      if (o.heldKinetic && prevKinetic.has(id) && s.beat.part !== "cta")
        once(`kin|${id}`, { id: "L60", severity: "error", message: `${s.beat.id}: KineticWord "${id}" is still on screen at this beat's keyword (it landed on the beat before) — the punch line belongs to ONE beat: exit it before the next keyword so the next line gets its own picture`, beatId: s.beat.id, frame: s.frame });
    prevKinetic = kin;
    // pills crossing a focal subject's edge / sitting on its drawing
    for (const p of s.items) {
      const pb = pillBox(p);
      if (!pb || pb.w <= 0 || pb.h <= 0) continue;
      for (const f of s.items) {
        if (!f.focal || f === p || KINETIC_SKIP.has(f.inst.component)) continue;
        const share = inter(pb, f.screen) / (pb.w * pb.h);
        if (share <= 0.05) continue;
        const inside = share >= 0.95;
        once(`pill|${p.inst.id}|${f.inst.id}`, {
          id: "L60",
          severity: "error",
          message: `${s.beat.id}: the label "${p.inst.id}" ${inside ? `sits on top of "${f.inst.id}"'s drawing` : `crosses the edge of "${f.inst.id}"`} — a label lives in empty stage beside its subject (a Callout's dot on the part, its pill outside the subject's box), never over cells, layers or card borders`,
          beatId: s.beat.id,
          frame: s.frame,
        });
      }
    }
  }
  // a pill flying through the header band: a RequestPill whose flight comes in from the top (it crosses the band on
  // screen), or a label on stage before AND after a camera move that rises into the band in between (a pan that
  // carries a label off the top and out of view is ordinary panning)
  for (const w of sb.world) {
    if (w.component !== "RequestPill" || (w.props as { from?: string } | undefined)?.from !== "top") continue;
    const e = tl.events.find((x) => x.kind === "action" && x.target === w.id && x.do === "enter") as { beatId?: string; frame?: number } | undefined;
    if (e) once(`band|${w.id}`, { id: "L60", severity: "error", message: `${e.beatId ?? "enter"}: RequestPill "${w.id}" flies in from the top, through the header band — fly it in from the left, right or bottom`, ...(e.beatId ? { beatId: e.beatId } : {}), ...(e.frame !== undefined ? { frame: e.frame } : {}) });
  }
  const vis = visibility(sb as Storyboard, tl);
  const pills = sb.world.filter((w) => PILL_COMPONENTS.has(w.component));
  const partsOf = new Map(pills.map((w) => [w.id, contentParts(w, lib).map((p) => p.box)]));
  const boxesAt = (id: string, f: number) => (partsOf.get(id) ?? []).map((b) => projectBox(b, cameraAt(tl, f)));
  const onStage = (bs: Box[]) => bs.length > 0 && bs.every((b) => b.y >= HEADER_BAND_BOTTOM && b.y + b.h <= 1560 && b.x < 1080 && b.x + b.w > 0);
  for (const seg of tl.cameraSegments) {
    if (seg.transition !== "move") continue;
    for (const w of pills) {
      const v = vis.get(w.id);
      if (!v || seg.startF < v.from || seg.endF >= v.to || !onStage(boxesAt(w.id, seg.startF)) || !onStage(boxesAt(w.id, seg.endF))) continue;
      for (let k = 1; k < 6; k++) {
        const f = Math.round(seg.startF + ((seg.endF - seg.startF) * k) / 6);
        if (!boxesAt(w.id, f).some((b) => b.y < HEADER_BAND_BOTTOM && b.y + b.h > 150 && b.x < 1080 && b.x + b.w > 0)) continue;
        const beat = [...tl.events].reverse().find((x) => x.kind === "camera" && x.frame <= seg.startF) as { beatId?: string } | undefined;
        once(`band|${w.id}`, { id: "L60", severity: "error", message: `${beat?.beatId ?? "camera"} @${f}: the label "${w.id}" rises into the header band (y < ${HEADER_BAND_BOTTOM}) during the camera move and comes back — keep it below the band through the move (a smaller zoom change, or place it lower in its station)`, ...(beat?.beatId ? { beatId: beat.beatId } : {}), frame: f });
        break;
      }
    }
  }
  return out;
}

// ── L61 colour roles ───────────────────────────────────────────────────────────────────────────────────────────

/** The quantities an instance draws in lime at this moment (one entry per distinct quantity). W7.3: the DRAWN tones
 *  (drawnTraceTone: a twin pair's lime twin, inputs dimmed while summed; rayTone: a ray in its emitter's light colour). */
export function limeRoles(o: Pick<OnScreen, "inst" | "state" | "props">): string[] {
  const roles: string[] = [];
  if (o.state === "dim") return roles;
  if (o.inst.component === "SignalTrace") {
    const pr = parseInstanceProps("SignalTrace", o.props);
    if (!pr?.ok) return roles;
    const t = pr.value as SignalTracePropsT;
    t.traces.forEach((x, i) => {
      if (drawnTraceTone(t, i, o.state) === "accent") roles.push(`trace ${JSON.stringify(x.label ?? x.id)}`);
    });
    if (t.combine === "sum" && o.state === "summed" && t.sumTone === "accent") roles.push(`sum ${JSON.stringify(t.sumLabel ?? "sum")}`);
  } else if (o.inst.component === "LayerStack") {
    const pr = parseInstanceProps("LayerStack", o.props);
    if (!pr?.ok) return roles;
    const l = pr.value as LayerStackPropsT;
    if (l.active && l.activeTone === "accent" && o.state !== "idle") roles.push(`layer "${l.layers.find((x) => x.id === l.active)?.label ?? l.active}"`);
    if ((o.state === "lit" || o.state === "flow") && l.rays.some((_, i) => rayTone(l, i) === "accent")) roles.push("the light rays");
    if (o.state === "flow") for (const f of l.flows) if (f.tone === "accent") roles.push(`flow "${f.label}"`);
  }
  return roles;
}

export function colourRoleIssues(snaps: readonly BeatSnapshot[]): W72Finding[] {
  const out: W72Finding[] = [];
  const seen = new Set<string>();
  for (const s of snaps) {
    if (s.beat.part === "cta") continue;
    for (const o of s.items) {
      if (!o.focal || seen.has(o.inst.id)) continue;
      const r = limeRoles(o);
      if (r.length < 2) continue;
      seen.add(o.inst.id);
      out.push({ id: "L61", severity: "error", message: `${s.beat.id}: "${o.inst.id}" draws ${r.length} different things in lime (${r.join(", ")}) — lime is THE signal / answer of the card, one thing: keep the quantity the narration is about lime and draw the others neutral (grey) or red when they are the problem`, beatId: s.beat.id, frame: s.frame });
    }
  }
  return out;
}
