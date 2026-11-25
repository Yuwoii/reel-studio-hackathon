// W7 number- and geometry-truth lints for the "how it works" components (research/notes/W7-library-spec.md §5), pure
// helpers over the per-beat snapshots (visualDigest.ts beatSnapshots, settled keyword frames); lints.ts calls them.
// Every check reuses the component's OWN geometry / number helper (the renderer and the digest call the same one), so a
// lint can never disagree with the picture:
//   L53 SignalTrace — (a) block: a trace's authored `cycles` disagrees with rate × span (the renderer ignores it);
//       (b) error: `sampled` + a phrase that says the sampler misses a peak, but the samples catch it (sampledMax);
//       (c) error: `summed` + a phrase that claims silence / total cancelling, but the sum is not flat (sumFlatness);
//           W7.3: "cancel" / "quiet" alone is partial (sum < SUM_RESIDUAL_MAX), and a FLAT sum where the words do not
//           claim a total cancellation is an error outside the hook act (real ANC leaves a residual; W7.2 anc b10/b21);
//       (d) error: tag none without sourceIds, or a rate × span above the 12-cycle cap without tag notToScale.
//   L54 LayerStack — (b) warn: `pulse` on a stack with no swell layer (nothing swells, the light does not change);
//       (c) warn: the keyword names a layer that is not `active` on that beat (a keyword with no visual change; warn
//       until camera part targets land); (d) error: tag none without sourceIds.
//   L55 SensorGrid — (a) error: `located` with no node ≥ threshold; (b) error: two touches whose circles overlap (they
//       read as one); (c) error: a typed readout that contradicts the computed centroid by > 0.5 grid units;
//       (d) error: the phrase speaks a touch / finger count ≠ touches.length.
// W7.1 (pilot review; consumes visualDigest.drawnCues, the same cue the renderer draws):
//   L55 (e) error: the phrase says the capacitance / charge / field DROPS, but the touched grid draws a rising level
//       (measure "level": the peak at the touched crossing) — set measure "delta" (W7 touchscreen: the bump went UP).
//   L53 (e) warn: the phrase says "180 degrees" / "out of phase" / "half a wave", but the SignalTrace on screen draws
//       no phase arc — set phaseMark "auto" on that beat (W7 ANC: a keyword with no visual change).

import type { Storyboard } from "../schema/storyboard.v2.js";
import type { Timeline } from "./timeline.js";
import { drawnCues, rawPropsAt, type BeatSnapshot, type OnScreen } from "./visualDigest.js";
import { cyclesCapped, derivedCycles, sampledMax, sumFlatness, traceCycles, type SignalTracePropsT } from "./components-meta/SignalTrace.js";
import type { LayerStackPropsT } from "./components-meta/LayerStack.js";
import { gridLevels, touchSigma, type SensorGridPropsT } from "./components-meta/SensorGrid.js";

export interface PhysicalFinding {
  id: "L53" | "L54" | "L55";
  severity: "block" | "error" | "warn";
  message: string;
  beatId?: string;
  frame?: number;
}

/** L53b: a phrase that says the sampler misses the peak. */
export const MISS_RE = /\b(?:miss(?:es|ed|ing)?|between (?:the )?samples|can['’]?t see|cannot see|never sees?|skips?|skipped|blind to)\b/i;
/** L53c: a phrase that claims the sum is silent / cancelled. */
export const SILENCE_RE = /\b(?:silen(?:ce|t)|cancel(?:s|led|ling|ed|ing|lation)?|flat(?:line)?|quiet|nothing left|zero)\b/i;
/** L55e: a phrase that says the measured quantity falls. */
export const DROP_RE = /\b(?:drops?|dropp(?:ed|ing)|falls?|fell|falling|decreas(?:e|es|ed|ing)|less|lower(?:s|ed|ing)?|weaken(?:s|ed|ing)?|steals?|stole|takes? away)\b/i;
/** L55e: …and names what falls (a "drop" of something else is not the grid's reading). */
export const GRID_QUANTITY_RE = /\b(?:capacitance|charge|field|coupling)\b/i;
/** L53e: a phrase that names the phase shift. */
export const PHASE_RE = /\b(?:180|half a wave|out of phase|opposite phase|anti-?phase|phase[- ]flipped|flipped|upside[- ]down)\b/i;
/** L53b threshold: the samples' max below this share of the true peak = the sampler visibly misses it. */
export const SAMPLED_MISS_MAX = 0.8;
/** L53c threshold: max |sum| below this = a flat line. */
export const SUM_FLAT_MAX = 0.1;
/** W7.3 L53c: words that claim TOTAL cancellation (a flat sum); "cancel" / "quiet" alone are partial (a residual). */
export const TOTAL_CANCEL_RE = /\b(?:silen(?:ce|t)|flat(?:line)?|nothing left|zero|complete(?:ly)?|entire(?:ly)?|total(?:ly)?|perfect(?:ly)?|exact(?:ly)?|fully|all of it)\b/i;
/** W7.3 L53c: a partial cancellation is drawn visibly smaller than this (max |sum|). */
export const SUM_RESIDUAL_MAX = 0.35;
/** W7.3 L53c: max |sum| below this = drawn with NO residual (the library's default residual 0.12 leaves ≥ ~0.03 on a
 *  0.3+ amp wave; an exact twin sums to ~0). */
export const SUM_EXACT_FLAT = 0.02;
/** W7.3 L53c: the idealised demo of the hook act (a hill + its exact mirror) may be drawn flat. */
const IDEAL_PARTS = new Set(["hook", "stakes", "reveal"]);
/** L53a tolerance between an authored `cycles` and rate × span. */
export const CYCLES_TOL = 0.5;
/** L55c tolerance between a typed readout and the computed centroid (grid units). */
export const READOUT_TOL = 0.5;

const WORD_NUM: Record<string, number> = { one: 1, a: 1, single: 1, two: 2, both: 2, three: 3, four: 4, five: 5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };
/** L55d: "two fingers", "a single touch", "3 touches". */
const TOUCH_COUNT_RE = /\b(one|a|single|two|both|three|four|five|[1-5])\s+(?:\w+\s+)?(touch(?:es)?|fingers?|taps?)\b/gi;

const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);

/** The keyword of a beat (punctuation trimmed). */
const keywordOf = (b: { keyword: string }) => b.keyword.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Spoken touch / finger counts in a phrase (each match → its number). */
export function spokenTouchCounts(phrase: string): number[] {
  const out: number[] = [];
  for (const m of phrase.matchAll(TOUCH_COUNT_RE)) {
    const w = m[1].toLowerCase();
    // "a touch" is singular only with the singular noun ("a fingers" is not English; "a few touches" has no count)
    if ((w === "a" || w === "single") && /s$/i.test(m[2])) continue;
    const n = WORD_NUM[w];
    if (n !== undefined) out.push(n);
  }
  return out;
}

/** "col 5.2 · row 3.1" → {col, row}; null = no numeric centroid in the text. */
export function parseReadout(text: string): { col: number; row: number } | null {
  const c = /\bcol(?:umn)?\s*(\d+(?:\.\d+)?)/i.exec(text);
  const r = /\brow\s*(\d+(?:\.\d+)?)/i.exec(text);
  return c && r ? { col: Number(c[1]), row: Number(r[1]) } : null;
}

const honestyIssue = (o: OnScreen, comp: string, id: PhysicalFinding["id"], beatId: string, frame: number): PhysicalFinding | null =>
  (o.props as { tag?: string }).tag === "none" && !o.inst.sourceIds.length
    ? { id, severity: "error", message: `${comp} "${o.inst.id}" has tag "none" but no sourceIds — an unsourced picture of a mechanism keeps its honesty tag (illustrative / notToScale / simulated); drop tag "none" or add the source it is drawn from`, beatId, frame }
    : null;

/** L53–L55 over the beat snapshots. One finding per (instance, check). */
export function physicalTruthIssues(snaps: readonly BeatSnapshot[], sb: Pick<Storyboard, "beats">, tl: Pick<Timeline, "events">): PhysicalFinding[] {
  const out: PhysicalFinding[] = [];
  const seen = new Set<string>();
  const push = (key: string, f: PhysicalFinding | null) => {
    if (!f || seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  const beatById = new Map(sb.beats.map((b) => [b.id, b]));
  const pulsedOn = new Set<string>();
  for (const e of tl.events) if (e.kind === "action" && e.do === "pulse") pulsedOn.add(`${e.beatId}|${e.target}`);

  for (const s of snaps) {
    const b = beatById.get(s.beat.id);
    if (!b) continue;
    const at = { beatId: b.id, frame: s.frame };
    for (const o of s.items) {
      const id = o.inst.id;
      if (o.inst.component === "SignalTrace") {
        const p = o.props as SignalTracePropsT;
        if (!Array.isArray(p.traces)) continue;
        // (a) authored cycles vs rate × span: only cycles the director WROTE (the parsed props carry the default 3)
        const d = derivedCycles(p);
        if (d !== null) {
          const raw = rawPropsAt(tl, o.inst, s.frame).traces;
          (Array.isArray(raw) ? raw : []).forEach((t, i) => {
            const c = (t as { cycles?: unknown })?.cycles;
            if (typeof c === "number" && Math.abs(c - traceCycles(p, i)) > CYCLES_TOL)
              push(`${id}|cycles|${i}`, { id: "L53", severity: "block", message: `${b.id}: SignalTrace "${id}" trace ${i} sets cycles ${c}, but rate "${p.rate}" × span "${p.span}" draws ${Number(traceCycles(p, i).toFixed(2))} — the renderer derives the cycles from the spoken numbers and ignores yours: drop cycles, or change rate / span`, ...at });
          });
        }
        // (b) the sampler "misses" a peak it actually catches
        if (o.state === "sampled" && MISS_RE.test(b.phrase)) {
          const m = sampledMax(p);
          if (m >= SAMPLED_MISS_MAX)
            push(`${id}|sampled`, { id: "L53", severity: "error", message: `${b.id}: the phrase says the sampler misses the peak, but SignalTrace "${id}" samples it at ${Math.round(m * 100)} % of the true peak (need < ${SAMPLED_MISS_MAX * 100} %) — lower samples or shift the trace's phase so the dots fall between the peaks`, ...at });
        }
        // (c) "silence" that is not a flat line; W7.3: a flat line where the words do not claim TOTAL cancellation
        if (o.state === "summed" && p.combine === "sum") {
          const fl = sumFlatness(p);
          const total = TOTAL_CANCEL_RE.test(b.phrase);
          if (total && fl >= SUM_FLAT_MAX)
            push(`${id}|sum`, { id: "L53", severity: "error", message: `${b.id}: the phrase claims the sum cancels completely, but SignalTrace "${id}" draws a sum up to ${fl.toFixed(2)} (need < ${SUM_FLAT_MAX}) — the anti-noise trace must be the same shape / amp / phase with invert true (residual 0 for a total cancellation)`, ...at });
          else if (!total && SILENCE_RE.test(b.phrase) && fl >= SUM_RESIDUAL_MAX)
            push(`${id}|sum`, { id: "L53", severity: "error", message: `${b.id}: the phrase says the waves cancel, but SignalTrace "${id}" draws a sum up to ${fl.toFixed(2)} (a visible cancellation stays < ${SUM_RESIDUAL_MAX}) — the anti-noise trace is the same shape / amp / phase with invert true (the library's residual leaves the small wiggle)`, ...at });
          else if (!total && fl < SUM_EXACT_FLAT && !IDEAL_PARTS.has(b.part))
            push(`${id}|flat`, { id: "L53", severity: "error", message: `${b.id}: SignalTrace "${id}" sums to a FLAT line (total cancellation), but the words (${JSON.stringify(b.phrase.slice(0, 60))}) do not say it is total — real cancellation leaves a small residual: drop residual: 0 (the library leaves 12 % by default), or say "completely" only when the source does`, ...at });
        }
        // (e) the phase shift spoken but not drawn (drawnCues: no arc while summed or dim)
        if (o.state !== "summed" && o.state !== "dim" && b.part !== "cta" && p.traces.length >= 2 && PHASE_RE.test(b.phrase) && !drawnCues(o).some((c) => c.cue === "phase"))
          push(`${id}|phase|${b.id}`, { id: "L53", severity: "warn", message: `${b.id}: the phrase says ${JSON.stringify(b.phrase.match(PHASE_RE)![0])}, but SignalTrace "${id}" draws no phase arc — set phaseMark "auto" in a state / mark action on that keyword, so the half-wave shift is drawn ("180°")`, ...at });
        // (d) honesty
        push(`${id}|tag`, honestyIssue(o, "SignalTrace", "L53", b.id, s.frame));
        if (cyclesCapped(p) && p.tag !== "notToScale")
          push(`${id}|cap`, { id: "L53", severity: "error", message: `${b.id}: SignalTrace "${id}" rate "${p.rate}" × span "${p.span}" is ${Math.round(derivedCycles(p)!)} cycles, drawn at the 12-cycle cap — set tag "notToScale"`, ...at });
      } else if (o.inst.component === "LayerStack") {
        const p = o.props as LayerStackPropsT;
        if (!Array.isArray(p.layers)) continue;
        if ((pulsedOn.has(`${b.id}|${id}`) || p.swelled) && !p.layers.some((l) => l.swell))
          push(`${id}|swell`, { id: "L54", severity: "warn", message: `${b.id}: ${p.swelled ? "swelled" : '"pulse"'} on LayerStack "${id}" but no layer has swell true — nothing swells and the returned light does not change; mark the blood / tissue layer swell: true`, ...at });
        const kw = new Set(tokens(keywordOf(b)));
        const named = p.layers.find((l) => tokens(l.label).some((t) => kw.has(t)));
        if (named && o.focal && b.part !== "cta" && p.active !== named.id)
          push(`${id}|active|${b.id}`, { id: "L54", severity: "warn", message: `${b.id}: the keyword "${b.keyword}" names layer "${named.label}" of LayerStack "${id}", but it is not active on this beat — set props.active "${named.id}" in a state action on the keyword, so the layer the phrase names lights up`, ...at });
        push(`${id}|tag`, honestyIssue(o, "LayerStack", "L54", b.id, s.frame));
      } else if (o.inst.component === "SensorGrid") {
        const p = o.props as SensorGridPropsT;
        if (!Array.isArray(p.touches)) continue;
        const g = gridLevels(p);
        if (o.state === "located" && !g.clusters.length)
          push(`${id}|located`, { id: "L55", severity: "error", message: `${b.id}: SensorGrid "${id}" is "located" but no node reaches threshold ${p.threshold} (max level ${g.max}) — nothing is drawn as found: add a touch or lower the threshold`, ...at });
        if (p.touches.length === 2 && (o.state === "touch" || o.state === "located")) {
          const [t0, t1] = p.touches;
          const dist = Math.hypot((t0.x - t1.x) * p.cols, (t0.y - t1.y) * p.rows);
          const r = Math.max(touchSigma(t0, p.cols, p.rows), touchSigma(t1, p.cols, p.rows));
          if (dist < r)
            push(`${id}|overlap`, { id: "L55", severity: "error", message: `${b.id}: the two touches on SensorGrid "${id}" are ${dist.toFixed(1)} nodes apart (their bumps overlap, < ${r.toFixed(1)}) — they read as one touch: move them apart`, ...at });
        }
        if (o.state === "located" && typeof p.readout === "string" && p.readout !== "auto" && g.clusters.length === 1) {
          const rd = parseReadout(p.readout);
          const c = g.clusters[0];
          if (rd && (Math.abs(rd.col - c.col) > READOUT_TOL || Math.abs(rd.row - c.row) > READOUT_TOL))
            push(`${id}|readout`, { id: "L55", severity: "error", message: `${b.id}: SensorGrid "${id}" readout "${p.readout}" but the computed centroid is col ${c.col.toFixed(1)} · row ${c.row.toFixed(1)} — use readout "auto"`, ...at });
        }
        for (const n of spokenTouchCounts(b.phrase))
          if (n !== p.touches.length && (o.state === "touch" || o.state === "located"))
            push(`${id}|count|${b.id}`, { id: "L55", severity: "error", message: `${b.id}: the phrase speaks ${n} touch${n === 1 ? "" : "es"} but SensorGrid "${id}" draws ${p.touches.length} — make touches match the narration`, ...at });
        // (e) "capacitance drops" over a grid that draws the touched crossing as a peak
        if ((o.state === "touch" || o.state === "located") && p.touches.length && DROP_RE.test(b.phrase) && GRID_QUANTITY_RE.test(b.phrase) && !drawnCues(o).some((c) => c.cue === "drop"))
          push(`${id}|drop`, { id: "L55", severity: "error", message: `${b.id}: the phrase says the ${b.phrase.match(GRID_QUANTITY_RE)![0].toLowerCase()} drops, but SensorGrid "${id}" draws the touched crossing as a rising level — set measure "delta" (grey baseline, the touched nodes go dark and print −8), so the picture falls where the narration does`, ...at });
        push(`${id}|tag`, honestyIssue(o, "SensorGrid", "L55", b.id, s.frame));
      }
    }
  }
  return out;
}
