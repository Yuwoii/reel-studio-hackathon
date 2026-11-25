// W7.3 lints from the W7.2 pilot review (p-touch / p-watch / p-anc), pure helpers over the per-beat snapshots
// (visualDigest.ts beatSnapshots at the settled keyword frames); lints.ts calls them:
//   L62 (how-it-works) the KEY STEP is drawn — script.story marks one outline beat as the key step (the change the
//       answer rests on); at that beat's keyword the focal subject must change its drawn state, and the change must be
//       the one the words say (W7.2 touch b11 "The finger displaces part of the field" drew the stack in "focus" with
//       NO field ray at all; anc b07 "A chip flips that wave upside down" recoloured a block diagram) — error.
//   L63 drawing honesty — (a) two traces of one SignalTrace drawn in the same style (W7.2 anc: NOISE and MIRROR both
//       grey dashed: noise vs anti-noise must read apart, grey dashed vs lime solid); (b) a light ray whose colour
//       contradicts its source probe (W7.2 watch b06: a RED ray out of the "GREEN LED"); (c) a field / light ray drawn
//       at full strength under a line that says the finger takes some of it away (W7.2 touch b03, the physics judge's
//       recurring nit) — error.
// Shared with the director's story gate (src/director/v2/story.ts): `changeClasses` (which change a line says).
// W7.3-C: L62 also reads the digest's cues (drawnCues / transitionCues: partial, residual, flip, dims, brightens).

import type { Storyboard } from "../schema/storyboard.v2.js";
import { lightTone, probeLight, type LayerStackPropsT } from "./components-meta/LayerStack.js";
import { traceDashed, traceTone, type SignalTracePropsT } from "./components-meta/SignalTrace.js";
import { parseInstanceProps } from "./library.js";
import { digestItemFull, drawnCues, transitionCues, type BeatSnapshot, type DrawnCue, type OnScreen } from "./visualDigest.js";

export interface W73Finding {
  id: "L62" | "L63";
  severity: "error" | "warn";
  message: string;
  beatId?: string;
  frame?: number;
}

// ── the change a line says ──────────────────────────────────────────────────────────────────────────────────────

/** The kinds of change a narration line can say (the key step's verb). "take" = part of a field / ray is taken away. */
export type ChangeClass = "take" | "decrease" | "increase" | "flip" | "combine";
export const CHANGE_RES: Record<ChangeClass, RegExp> = {
  take: /\b(?:tak(?:e|es|ing)|took|steal(?:s|ing)?|stole|pull(?:s|ing)?|draw(?:s|ing)?|drain(?:s|ing)?)\b[^.?!]{0,30}\b(?:away|off|out)\b|\b(?:displac\w*|divert\w*|shunt\w*|siphon\w*|steal(?:s|ing)?|stole|robs?|blocks?|blocked)\b/i,
  decrease: /\b(?:drops?|dropp(?:ed|ing)|falls?|fell|falling|less|lower(?:s|ed|ing)?|dim(?:s|med|ming|mer)?|weak\w*|absorb\w*|soak\w*|swallow\w*|reduc\w*|shrinks?|fades?|fading|decreas\w*|dips?|dipp\w*|loses?|losing)\b/i,
  increase: /\b(?:rises?|rising|rose|more|bright\w*|grows?|growing|increas\w*|boost\w*|strong\w*|lights? up|lit|swell\w*|peaks?)\b/i,
  flip: /\b(?:flip\w*|invert\w*|upside[- ]down|mirror\w*|opposite|revers\w*|anti-?(?:noise|phase))\b/i,
  combine: /\b(?:combin\w*|add(?:s|ed|ing)? (?:up|together)|sums?|summed|meets?|cancel\w*|overlap\w*|merg\w*|mix(?:es|ed)?)\b/i,
};

/** Which changes a line says (in a fixed order); [] = none of the known verbs. */
export function changeClasses(text: string): ChangeClass[] {
  return (Object.keys(CHANGE_RES) as ChangeClass[]).filter((c) => CHANGE_RES[c].test(String(text ?? "")));
}

// ── L62 the key step is drawn ───────────────────────────────────────────────────────────────────────────────────

/** Labels, pointers and punch lines are not the subject: the key step changes the subject itself. */
const NOT_SUBJECT = new Set(["KineticWord", "SourceTag", "Stamp", "Callout", "RequestPill", "PointerArrow"]);
const MARKS = /\s?ring#\d+|\s?moving\b|\s?\+packet \S+/g;
const subjects = (s: BeatSnapshot) => s.items.filter((o) => o.focal && !NOT_SUBJECT.has(o.inst.component));
const drawn = (o: OnScreen) => digestItemFull(o).replace(MARKS, "").replace(/\s+/g, " ").trim();
const nums = (d: string, re: RegExp) => [...d.matchAll(re)].map((m) => Number(m[1]));
const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const tokens = (d: string) => new Set(d.toLowerCase().match(/[a-z]+/g) ?? []);

/** Evidence, from the drawn digests before / at the key beat, that one subject shows one kind of change. */
export function changeEvidence(cls: ChangeClass, prev: string, cur: string): boolean {
  const ret = [nums(prev, /return (\d+)%/g), nums(cur, /return (\d+)%/g)] as const;
  const drop = [nums(prev, /DROP -(\d+)/g), nums(cur, /DROP -(\d+)/g)] as const;
  const rings = [nums(prev, /field rings (\d)\//g), nums(cur, /field rings (\d)\//g)] as const;
  const peak = [nums(prev, /peak (\d+)\/9/g), nums(cur, /peak (\d+)\/9/g)] as const;
  const pctOf = (d: string) => nums(d.replace(/return \d+%|\d+%-\d+%|see \d+%/g, ""), /(\d+)%/g);
  const pct = [pctOf(prev), pctOf(cur)] as const;
  const tp = tokens(prev);
  const fresh = (w: RegExp) => [...tokens(cur)].some((t) => w.test(t) && !tp.has(t));
  const fewer = (a: readonly number[][]) => a[0].length > 0 && a[1].length > 0 && total(a[1]) < total(a[0]);
  const bigger = (a: readonly number[][]) => a[1].length > 0 && (a[0].length === 0 ? total(a[1]) > 0 : total(a[1]) > total(a[0]));
  const inv = (d: string) => (d.match(/ inv\b/g) ?? []).length;
  switch (cls) {
    case "take":
      // a PART of the field / ray goes: a weaker return that is still drawn, a drop under the touch, fewer field rings,
      // or a ray split / diverted to the finger (library W7.3: partial rays)
      return fewer(ret) || bigger(drop) || fewer(rings) || (/weakened under touch/.test(cur) && !/weakened under touch/.test(prev)) || fresh(/^(?:divert\w*|partial|split|taken|shunt\w*)$/);
    case "decrease":
      return fewer(ret) || bigger(drop) || fewer(rings) || fewer(peak) || fewer(pct) || fresh(/^(?:swelled|absorbed|weakened|dims?|dimmed|divert\w*|partial|summed)$/);
    case "increase":
      return bigger(ret) || bigger(peak) || (pct[0].length > 0 && bigger(pct)) || fresh(/^(?:lit|flow|located|scan|swelled|summed|active)$/) || (ret[0].length === 0 && ret[1].length > 0);
    case "flip":
      return inv(cur) > inv(prev) || (/phase arc/.test(cur) && !/phase arc/.test(prev)) || fresh(/^(?:flip\w*|invert\w*|inverse|mirror)$/);
    case "combine":
      return fresh(/^(?:summed|sum)$/) || (/\bsum\b/.test(cur) && !/\bsum\b/.test(prev));
  }
}

type Rec = Record<string, unknown>;
const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : []);
/** Evidence read from the props in force (library W7.3 verbs the digest may not spell out): a LayerStack ray that
 *  gains a `divert` or loses strength (partial ray), a SignalTrace trace whose `invert` toggles (flip). */
export function propsEvidence(cls: ChangeClass, prev: Pick<OnScreen, "inst" | "props" | "state"> | undefined, cur: Pick<OnScreen, "inst" | "props" | "state">): boolean {
  if (cur.inst.component === "LayerStack" && (cls === "take" || cls === "decrease") && (cur.state === "lit" || cur.state === "flow")) {
    const pr = arr(prev?.props.rays);
    const prevOn = prev && (prev.state === "lit" || prev.state === "flow");
    return arr(cur.props.rays).some((r, i) => {
      const was = pr[i];
      const div = typeof r.divert === "string" && (!prevOn || !was || typeof was.divert !== "string");
      const weaker = !!prevOn && !!was && Number(r.strength ?? 1) < Number(was.strength ?? 1) - 1e-9;
      return (cls === "take" ? div || (weaker && typeof r.divert === "string") : div || weaker);
    });
  }
  if (cur.inst.component === "SignalTrace" && cls === "flip" && prev) {
    const before = new Map(arr(prev.props.traces).map((t) => [String(t.id), !!t.invert]));
    return arr(cur.props.traces).some((t) => before.has(String(t.id)) && before.get(String(t.id)) !== !!t.invert);
  }
  return false;
}

/** W7.3-C: which change each digest cue shows (visualDigest drawnCues = held state cues, transitionCues = what changed
 *  against the beat before). A held cue counts only when it is NEW at the key beat (not drawn on the beat before). */
const CUE_CLASSES: Record<DrawnCue["cue"], readonly ChangeClass[]> = {
  partial: ["take", "decrease"],
  dims: ["decrease"],
  brightens: ["increase"],
  flip: ["flip"],
  phase: ["flip"],
  residual: ["combine", "decrease"],
  drop: ["take", "decrease"],
  field: [],
};
/** The cues an item shows at the key beat that it did not show before (new held cues + transition cues). */
export function keyStepCues(prev: Pick<OnScreen, "inst" | "state" | "props"> | undefined, cur: Pick<OnScreen, "inst" | "state" | "props">): DrawnCue[] {
  const had = new Set(prev ? drawnCues(prev).map((c) => `${c.cue}|${c.text}`) : []);
  return [...drawnCues(cur).filter((c) => !had.has(`${c.cue}|${c.text}`)), ...transitionCues(prev ?? null, cur)];
}
export const cueEvidence = (cls: ChangeClass, cues: readonly DrawnCue[]): boolean => cues.some((c) => CUE_CLASSES[c.cue].includes(cls));

/** L62: the key step beat draws a state change of its focal subject that matches its words. */
export function keyStepIssues(snaps: readonly BeatSnapshot[], sb: Pick<Storyboard, "beats">, keyBeat: string): W73Finding[] {
  const i = snaps.findIndex((s) => s.beat.id === keyBeat);
  if (i < 0) return [];
  const cur = snaps[i];
  const phrase = sb.beats.find((b) => b.id === keyBeat)?.phrase ?? "";
  const at = { beatId: keyBeat, frame: cur.frame };
  const subj = subjects(cur);
  const say = JSON.stringify(phrase.slice(0, 80));
  if (!subj.length)
    return [{ id: "L62", severity: "error", message: `${keyBeat} is the KEY STEP (${say}) but draws no focal subject at its keyword — the key step is THE change the answer rests on: draw it in the subject itself (a LayerStack ray part-diverted to the finger, a SignalTrace flipping to the inverse, a SensorGrid crossing dropping)`, ...at }];
  const prevSnap = snaps[i - 1];
  const before = new Map(prevSnap ? subjects(prevSnap).map((o) => [o.inst.id, o]) : []);
  const classes = changeClasses(phrase);
  // changed = a new subject, another state, another drawn digest, or a props change the library draws (partial ray,
  // trace flip) that the digest may not spell out
  const changed = subj
    .map((o) => {
      const p = before.get(o.inst.id);
      return { o, was: p, prev: p ? drawn(p) : "", cur: drawn(o) };
    })
    .map((x) => ({ ...x, cues: keyStepCues(x.was, x.o) }))
    .filter((x) => !x.was || x.was.state !== x.o.state || x.prev !== x.cur || x.cues.length > 0 || classes.some((c) => propsEvidence(c, x.was, x.o)));
  const shown = subj.map((o) => drawn(o).slice(0, 110)).join(" · ");
  if (!changed.length)
    return [{ id: "L62", severity: "error", message: `${keyBeat} is the KEY STEP (${say}) but its focal subject draws the same state as at ${prevSnap?.beat.id ?? "the beat before"} (${shown}) — a camera move, a ring or a label is not the change: on the keyword, change the subject's drawn state so the viewer SEES the step`, ...at }];
  if (!classes.length) return [];
  if (changed.some((x) => classes.some((c) => cueEvidence(c, x.cues) || changeEvidence(c, x.prev, x.cur) || propsEvidence(c, x.was, x.o)))) return [];
  const want: Record<ChangeClass, string> = {
    take: "part of the field / light taken away (a ray whose strength drops with a part diverted to the finger / contact, a crossing's DROP, fewer field rings) — never the full field with the finger there, never the ray simply gone",
    decrease: "a smaller drawn value (a weaker ray return, a deeper DROP, a lower level / fill)",
    increase: "a larger drawn value (a stronger return, a higher level, a lit / located state)",
    flip: "trace B flipping to the inverse of trace A on the keyword (invert: true, or a phase arc)",
    combine: "the traces summed (state summed) on the keyword",
  };
  return [{ id: "L62", severity: "error", message: `${keyBeat} is the KEY STEP (${say}): the words say ${classes.map((c) => `"${c}"`).join(" / ")}, but what changes is ${changed.map((x) => x.cur.slice(0, 110)).join(" · ")} — draw ${classes.map((c) => want[c]).join("; or ")}`, ...at }];
}

// ── L63 drawing honesty ─────────────────────────────────────────────────────────────────────────────────────────

const TONE_NAME: Record<string, string> = { accent: "lime", danger: "red", neutral: "grey", dim: "dim" };
/** A finger / hand drawn in a stack: a contact probe, or a layer labelled FINGER / HAND / SKIN on top. */
const FINGER_RE = /\b(?:FINGER|FINGERTIP|HAND|THUMB)\b/i;

export function drawingHonestyIssues(snaps: readonly BeatSnapshot[], sb: Pick<Storyboard, "beats">): W73Finding[] {
  const out: W73Finding[] = [];
  const seen = new Set<string>();
  const once = (k: string, f: W73Finding) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };
  const phraseOf = new Map(sb.beats.map((b) => [b.id, b.phrase ?? ""]));
  for (const s of snaps) {
    const at = { beatId: s.beat.id, frame: s.frame };
    const phrase = phraseOf.get(s.beat.id) ?? "";
    for (const o of s.items) {
      if (!o.focal || o.state === "dim") continue;
      const id = o.inst.id;
      if (o.inst.component === "SignalTrace") {
        const pr = parseInstanceProps("SignalTrace", o.props);
        if (!pr?.ok) continue;
        const t = pr.value as SignalTracePropsT;
        // (a) two traces in one style: noise and anti-noise must read apart
        const style = t.traces.map((x, k) => `${traceTone(t, k)}${traceDashed(t, k) ? " dashed" : " solid"}`);
        for (let a = 0; a < style.length; a++)
          for (let b = a + 1; b < style.length; b++)
            if (style[a] === style[b])
              once(`style|${id}`, { id: "L63", severity: "error", message: `${s.beat.id}: SignalTrace "${id}" draws ${JSON.stringify(t.traces[a].label ?? t.traces[a].id)} and ${JSON.stringify(t.traces[b].label ?? t.traces[b].id)} both ${TONE_NAME[style[a].split(" ")[0]] ?? style[a]}${style[a].endsWith("dashed") ? " dashed" : " solid"} — two waves on one card must read apart: the problem grey dashed (line "dashed", tone neutral), the answer lime solid (tone accent, line "solid")`, ...at });
      } else if (o.inst.component === "LayerStack") {
        const pr = parseInstanceProps("LayerStack", o.props);
        if (!pr?.ok) continue;
        const l = pr.value as LayerStackPropsT;
        const raysOn = o.state === "lit" || o.state === "flow";
        // (b) a ray's colour follows its source's declared light colour (the library's probeLight: `light`, else the
        // label "GREEN LED"). The renderer draws a contradicting lime / red ray in the light's colour (rayTone), so the
        // authored tone — and a label like "RED BOUNCES" — would sit on a ray of another colour.
        if (raysOn)
          for (const r of l.rays) {
            const src = l.probes.find((p) => p.id === r.from);
            const light = src ? probeLight(src) : null;
            const lt = lightTone(light);
            if (src && light && lt && (r.tone === "accent" || r.tone === "danger") && r.tone !== lt)
              once(`colour|${id}|${r.from}|${r.tone}`, { id: "L63", severity: "error", message: `${s.beat.id}: LayerStack "${id}" asks for a ${TONE_NAME[r.tone] ?? r.tone} ray${r.label ? ` ${JSON.stringify(r.label)}` : ""} out of ${JSON.stringify(src.label)} (${light} light) — a ray is the colour of the light its source makes (it is drawn ${TONE_NAME[lt] ?? lt}): ${light} light rays are tone "${lt}" or grey; light of another colour needs its own emitter probe (light: "${r.tone === "danger" ? "red" : "green"}"), or say it in the words and keep the picture on the light this device uses`, ...at });
          }
        // (c) the full field under "the finger takes some away"
        const finger = l.probes.some((p) => p.role === "contact") || l.layers.some((x) => FINGER_RE.test(x.label));
        if (raysOn && finger && l.rays.length && s.beat.part !== "cta" && CHANGE_RES.take.test(phrase)) {
          const full = digestItemFull(o).match(/return (\d+)%/g)?.every((m) => Number(m.slice(7, -1)) >= 100) ?? false;
          if (full)
            once(`full|${id}|${s.beat.id}`, { id: "L63", severity: "error", message: `${s.beat.id}: the line says the finger takes field away (${JSON.stringify(phrase.slice(0, 70))}), but LayerStack "${id}" draws the full field (every ray returns 100 %) with the finger there — draw what the words say: the ray's strength drops (strength < 1) with the part the finger takes diverted to it`, ...at });
        }
      }
    }
  }
  return out;
}
