// W7 lints from the W6 D2 review (research/notes/W6-carryover.json d2_findings), pure helpers over the per-beat
// snapshots (visualDigest.ts beatSnapshots, settled keyword frames); lints.ts calls them:
//   L50 colour polarity — lime on a culprit / bad state (W6: SIGKILL lime, OUT OF MEMORY at "normal", provider
//       poolers lit as the fix): a drawn text that names a failure is never lime (error); a caption keyword that
//       names a failure is never accent (error); a keyword whose on-screen subject is drawn in the other colour (warn).
//   L51 the CTA keeps the hero object on screen (W6: "CTA has no focal object") — error on an empty stage, else warn.
//   L52 persistent visual — one focal diagram on screen and unchanged for more than PERSIST_MAX_BEATS beats while the
//       narration moves on (W6: 11/24 beats on one target) — warn.
// W7.1 (W7 pilot review):
//   L50 also: a drawn lime quantity named error / drift / loss / drop (GPS "DRIFT", "POSITION ERROR" in lime) — error.
//   L51 is an error whether the CTA shows another object or nothing (touchscreen ended on an empty dimmed grid).
//   L56 KineticWord — its text is a dangling fragment of a narration line ("Sound erases" of "Sound erases sound.";
//       "runs differently" of "Time runs differently up there.") — error; on screen > KINETIC_MAX_HOLD_BEATS beats —
//       warn; still on screen at the CTA — error.
//   L57 header — a header label names a vendor's product ("TI CAPTIVATE") on a reel that is not about it — error.

import type { Storyboard } from "../schema/storyboard.v2.js";
import type { Timeline } from "./timeline.js";
import { digestItemFull, drawnTexts, type BeatSnapshot } from "./visualDigest.js";

/** Words that name a failure / culprit / bad state (drawn in red, never lime). Deliberately not "down", "steal" or
 *  "block": fundamentals use them for normal physics ("which way is down", "your finger steals charge"). */
export const BAD_STATE_RE =
  /\b(?:sig)?kill(?:ed|s)?\b|\boom(?:killed)?\b|\bout of memory\b|\bfail(?:ed|s|ing|ure|over)?\b|\berrors?\b|\bcrash(?:ed|es|ing)?\b|\b(?:went|goes|going) down\b|\boutage\b|\bexpired\b|\bdenied\b|\brejected\b|\brefused\b|\bbroken\b|\bdead\b|\btime(?:d)? ?out\b|\bpanic\b|\bcorrupt(?:ed|ion)?\b|\bculprit\b|\battack(?:er|ed)?\b|\bexploit(?:ed)?\b|\bbreach(?:ed)?\b|\bhijack(?:ed)?\b|\bunavailable\b|\boffline\b|\b5\d\d\b|\b404\b|\bfatal\b|\boverflow(?:ed)?\b|\bleak(?:ed|s)?\b/i;
/** Words that name a success / fix (a danger keyword on them reads backwards). */
export const GOOD_STATE_RE = /\b(?:fixed|fix(?:es)?|works?|working|healthy|safe|recovered|restored|success(?:ful)?|resolved|passes|passed|ok|okay)\b/i;

export const PERSIST_MAX_BEATS = 4;

/** A negator or a remedy verb shortly before the bad word ("NOT KILLED YET", "find the leak", "prevents a crash"):
 *  the text names the absence or the cure of the failure, which may be lime. */
const NEGATED_OR_REMEDY = /(?:\b(?:not|no|never|without|find|fix|fixes|fixed|stop|stops|prevent|prevents|avoid|avoids|catch|catches|detect|detects|patch|patches|survive|survives|survived)\b|n['’]t\b)(?:\W+\w+){0,2}\W+$/i;

/** Does `text` name a failure that is neither negated nor the object of a remedy? */
export function namesBadState(text: string): boolean {
  const re = new RegExp(BAD_STATE_RE.source, "gi");
  for (const m of text.matchAll(re)) if (!NEGATED_OR_REMEDY.test(text.slice(0, m.index))) return true;
  return false;
}
/** W7.1: a drawn quantity that names an error / drift / loss / drop (the "GPS DRIFT 38 µs" lime pill). Not a failure
 *  word for captions (a keyword "drops" can be the measured signal), but a lime DRAWN loss reads as a gain. */
export const LOSS_QUANTITY_RE = /\b(?:drift(?:s|ed|ing)?|loss(?:es)?|lost|los(?:es|ing)|drops?|dropp(?:ed|ing)|decay(?:s|ed)?|deficit|lag(?:s|ged|ging)?|offset error|position error|timing error|error)\b/i;
export function namesLossQuantity(text: string): boolean {
  const re = new RegExp(LOSS_QUANTITY_RE.source, "gi");
  for (const m of text.matchAll(re)) if (!NEGATED_OR_REMEDY.test(text.slice(0, m.index))) return true;
  return false;
}

/** Drawn texts whose colour is the component's style, not a state claim (a quote is the page's words). */
const STYLE_ONLY = new Set(["quote", "term title", "hero label", "hero caption", "hero tag", "box scale", "grid scale", "timeline ticks"]);

export interface W7Finding {
  id: "L50" | "L51" | "L52" | "L56" | "L57";
  severity: "error" | "warn";
  message: string;
  beatId?: string;
  frame?: number;
}

const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
const names = (item: string, keyword: string) => {
  const k = new Set(tokens(keyword));
  return tokens(item).some((t) => k.has(t) || [...k].some((x) => x.length > 3 && (t.startsWith(x) || x.startsWith(t))));
};

/** L50: colour polarity at every keyword still. */
export function colourPolarityIssues(snaps: readonly BeatSnapshot[], sb: Pick<Storyboard, "beats">): W7Finding[] {
  const out: W7Finding[] = [];
  const beatById = new Map(sb.beats.map((b) => [b.id, b]));
  const seen = new Set<string>();
  for (const s of snaps) {
    const b = beatById.get(s.beat.id);
    if (!b || b.part === "cta") continue;
    const kw = b.keyword.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const kwAt = b.phrase.toLowerCase().indexOf(kw.toLowerCase());
    const kwCtx = kwAt >= 0 ? b.phrase.slice(0, kwAt + kw.length) : kw;
    if (b.keywordColor === "accent" && BAD_STATE_RE.test(kw) && namesBadState(kwCtx.slice(Math.max(0, kwCtx.length - kw.length - 40))))
      out.push({ id: "L50", severity: "error", message: `${b.id}: the caption keyword "${b.keyword}" names a failure but is accent (lime) — a failure / culprit is danger (red); lime is the keyword's subject or a success`, beatId: b.id, frame: s.frame });
    else if (b.keywordColor === "danger" && GOOD_STATE_RE.test(kw) && !BAD_STATE_RE.test(b.phrase))
      out.push({ id: "L50", severity: "warn", message: `${b.id}: the caption keyword "${b.keyword}" names a success but is danger (red) — use accent`, beatId: b.id, frame: s.frame });
    for (const o of s.items) {
      for (const t of drawnTexts(o)) {
        if (t.tone === "lime" && !STYLE_ONLY.has(t.what) && (namesBadState(t.text) || namesLossQuantity(t.text))) {
          const key = `${o.inst.id}|${t.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ id: "L50", severity: "error", message: `${b.id}: "${o.inst.id}" draws ${JSON.stringify(t.text)} in lime, but it names a failure / culprit or a loss / drift / error quantity — draw it danger (red), or neutral when it is only context; lime is never on the bad state or a loss`, beatId: b.id, frame: s.frame });
        }
      }
      // the keyword's on-screen subject drawn in the other colour (one finding per beat)
      const subj = drawnTexts(o).find((t) => (t.tone === "lime" || t.tone === "red") && !STYLE_ONLY.has(t.what) && names(t.text, kw));
      if (subj && ((subj.tone === "red" && b.keywordColor === "accent" && !BAD_STATE_RE.test(subj.text)) || (subj.tone === "lime" && b.keywordColor === "danger"))) {
        const key = `${b.id}|subject`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: "L50", severity: "warn", message: `${b.id}: the caption keyword "${b.keyword}" is ${b.keywordColor === "accent" ? "lime" : "red"} but its subject on screen, "${o.inst.id}" ${JSON.stringify(subj.text)}, is ${subj.tone} — one meaning, one colour: match the keyword colour to the subject's state`, beatId: b.id, frame: s.frame });
      }
    }
  }
  return out;
}

/** The reel's hero object: the focal instance on screen at the climax (first climax beat), else the focal instance
 *  on screen in the most beats. */
export function heroInstances(snaps: readonly BeatSnapshot[]): string[] {
  const climax = snaps.find((s) => s.beat.part === "climax");
  const atClimax = climax?.items.filter((o) => o.focal && o.inst.component !== "KineticWord").map((o) => o.inst.id) ?? [];
  if (atClimax.length) return atClimax;
  const count = new Map<string, number>();
  for (const s of snaps) for (const o of s.items) if (o.focal && o.inst.component !== "KineticWord") count.set(o.inst.id, (count.get(o.inst.id) ?? 0) + 1);
  const best = Math.max(0, ...count.values());
  return best ? [...count].filter(([, n]) => n === best).map(([id]) => id) : [];
}

/** States that show nothing of the answer (a hero reset to one of these at the CTA is an empty picture). */
const EMPTY_STATES = new Set(["dim", "idle", "empty", "off"]);
/** W7.2 (watch-a2 b23: the LayerStack back in "focus" — one outlined layer, no light — at the CTA after a climax
 *  drawn "lit" / "flow"): per component, the states that draw none of the mechanism (an emphasis outline is not the
 *  answer). Anything not listed uses EMPTY_STATES. */
const EMPTY_STATES_BY_COMPONENT: Readonly<Record<string, ReadonlySet<string>>> = {
  LayerStack: new Set(["idle", "focus", "dim"]),
  SensorGrid: new Set(["idle", "dim"]),
  SignalTrace: new Set(["dim"]),
};
export const emptyStateOf = (component: string, state: unknown): boolean => (EMPTY_STATES_BY_COMPONENT[component] ?? EMPTY_STATES).has(String(state));

/** L51: the CTA beat shows the hero object (a focal instance from the climax), not an empty stage. */
export function ctaHeroIssues(snaps: readonly BeatSnapshot[]): W7Finding[] {
  const cta = snaps.find((s) => s.beat.part === "cta");
  if (!cta) return [];
  const heroes = heroInstances(snaps.filter((s) => s.beat.part !== "cta"));
  if (!heroes.length) return [];
  const on = cta.items.filter((o) => o.focal && heroes.includes(o.inst.id));
  // W7.1 (touchscreen: the grid was back to "idle", no touch, at the CTA): the hero must still SHOW the answer — not
  // dimmed / reset to an empty state when the climax drew it in a live one
  const climaxStates = (id: string) => snaps.filter((s) => s.beat.part === "climax").flatMap((s) => s.items.filter((c) => c.inst.id === id).map((c) => String(c.state)));
  const emptied = on.filter((o) => emptyStateOf(o.inst.component, o.state) && climaxStates(o.inst.id).some((st) => !emptyStateOf(o.inst.component, st)));
  if (on.length && emptied.length === on.length)
    return [
      {
        id: "L51",
        severity: "error",
        message: `${cta.beat.id} (cta): the hero object ${emptied.map((o) => `"${o.inst.id}"`).join(", ")} is back in state "${emptied[0].state}" — at the CTA it keeps the climax's picture (the touch, the cancelled wave), not an emptied or dimmed one (state "final" recalls its last live state)`,
        beatId: cta.beat.id,
        frame: cta.frame,
      },
    ];
  if (on.length) return [];
  const has = cta.items.filter((o) => o.focal).map((o) => o.inst.id);
  return [
    {
      id: "L51",
      // W7.1: an error either way — an empty stage (W6) or another object (W7 touchscreen: a dimmed grid / a held
      // kinetic fragment) both leave the viewer without the picture the reel explained
      severity: "error",
      message: `${cta.beat.id} (cta): the hero object (${heroes.slice(0, 3).join(", ")}) is not on screen${has.length ? ` (only ${has.slice(0, 3).join(", ")})` : " — the stage is empty"}: keep the climax's focal object in frame through the CTA (no exit, camera on its station), so the last frame is the picture the reel explained`,
      beatId: cta.beat.id,
      frame: cta.frame,
    },
  ];
}

/** L52: a focal diagram on screen and unchanged (same drawn digest, no action on it) for more than
 *  PERSIST_MAX_BEATS consecutive beats. */
export function persistentVisualIssues(snaps: readonly BeatSnapshot[], tl: Pick<Timeline, "events">): W7Finding[] {
  const out: W7Finding[] = [];
  const acted = new Map<string, Set<string>>();
  for (const e of tl.events) if (e.kind === "action") (acted.get(e.beatId) ?? acted.set(e.beatId, new Set()).get(e.beatId)!).add(e.target);
  const runs = new Map<string, { beats: string[]; digest: string; frame: number }>();
  const flush = (id: string) => {
    const r = runs.get(id);
    if (r && r.beats.length > PERSIST_MAX_BEATS)
      out.push({
        id: "L52",
        severity: "warn",
        message: `${r.beats[0]}–${r.beats[r.beats.length - 1]}: "${id}" sits unchanged on screen for ${r.beats.length} beats (> ${PERSIST_MAX_BEATS}) while the narration moves on — change it on the keywords (a state, a drawOn, a push-in on the part the phrase names) or move to the next station`,
        beatId: r.beats[0],
        frame: r.frame,
      });
    runs.delete(id);
  };
  for (const s of snaps) {
    if (s.beat.part === "cta") break;
    const here = new Set<string>();
    for (const o of s.items) {
      if (!o.focal || o.inst.component === "KineticWord" || o.inst.component === "SourceTag") continue;
      here.add(o.inst.id);
      const d = digestItemFull(o);
      const r = runs.get(o.inst.id);
      const changed = acted.get(s.beat.id)?.has(o.inst.id) || !r || r.digest !== d;
      if (changed) {
        flush(o.inst.id);
        runs.set(o.inst.id, { beats: [s.beat.id], digest: d, frame: s.frame });
      } else r!.beats.push(s.beat.id);
    }
    for (const id of [...runs.keys()]) if (!here.has(id)) flush(id);
  }
  for (const id of [...runs.keys()]) flush(id);
  return out;
}

// ── W7.1 L56 KineticWord: a complete phrase, held briefly ─────────────────────────────────────────────────────

export const KINETIC_MAX_HOLD_BEATS = 3;
/** Words a complete phrase never ends on (an article, a preposition, a conjunction). */
const DANGLING_END = new Set("a an the of to in on at by for with from into onto than and or but so that which who whose its your their our my his her is are was were be".split(" "));
/** Words that can open a complete noun phrase / clause (a fragment that starts with one is not missing its subject). */
const OPENER = new Set("a an the this that these those it its your my our their his her one two no every each all some what how why when where we you they he she i".split(" "));
const CONTENT_SKIP = new Set("a an the and or but so of to in on at by for with from up down out off there here then just very really also even still as it its".split(" "));
const kwords = (s: string) => s.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? [];

/** Why a KineticWord text is a dangling fragment of a narration line (null = a complete phrase). */
export function danglingFragment(text: string, phrases: readonly string[]): string | null {
  const k = kwords(text);
  if (!k.length) return null;
  const last = k[k.length - 1];
  if (k.length > 1 && DANGLING_END.has(last)) return `it ends on "${last}"`;
  for (const ph of phrases) {
    for (const clause of ph.split(/[,;:.!?]+|\s(?:and|but|so|then|while|because)\s/i)) {
      const c = kwords(clause);
      if (c.length <= k.length) continue;
      for (let i = 0; i + k.length <= c.length; i++) {
        if (!k.every((w, j) => c[i + j] === w)) continue;
        const after = c.slice(i + k.length);
        const before = c.slice(0, i);
        if (after.length && !CONTENT_SKIP.has(after[0])) return `it stops before "${after[0]}" in ${JSON.stringify(clause.trim())}`;
        if (before.some((w) => !CONTENT_SKIP.has(w)) && !OPENER.has(k[0] ?? "")) return `it drops "${before.join(" ")}" from ${JSON.stringify(clause.trim())}`;
      }
    }
  }
  return null;
}

/** L56: KineticWord text completeness and hold time (keyword stills; a CTA still that shows it is an error). */
export function kineticIssues(snaps: readonly BeatSnapshot[], sb: Pick<Storyboard, "beats">): W7Finding[] {
  const out: W7Finding[] = [];
  const phrases = sb.beats.map((b) => b.phrase ?? "");
  const seen = new Map<string, { beats: string[]; text: string; frame: number }>();
  for (const s of snaps) {
    for (const o of s.items) {
      if (o.inst.component !== "KineticWord") continue;
      const t = String((o.props as { text?: unknown }).text ?? "");
      const r = seen.get(o.inst.id) ?? { beats: [], text: t, frame: s.frame };
      if (!r.beats.length) seen.set(o.inst.id, r);
      r.beats.push(s.beat.id);
      if (s.beat.part === "cta")
        out.push({ id: "L56", severity: "error", message: `${s.beat.id} (cta): KineticWord "${o.inst.id}" ${JSON.stringify(t)} is still on screen — exit it before the CTA, which shows the hero object the reel explained`, beatId: s.beat.id, frame: s.frame });
    }
  }
  for (const [id, r] of seen) {
    const why = danglingFragment(r.text, phrases);
    if (why)
      out.push({ id: "L56", severity: "error", message: `${r.beats[0]}: KineticWord "${id}" ${JSON.stringify(r.text)} is not a complete phrase (${why}) — show the whole claim ("Sound erases sound.") or a complete noun phrase, never a cut-off line`, beatId: r.beats[0], frame: r.frame });
    const body = r.beats.filter((b) => sb.beats.find((x) => x.id === b)?.part !== "cta");
    if (body.length > KINETIC_MAX_HOLD_BEATS)
      out.push({ id: "L56", severity: "warn", message: `${body[0]}–${body[body.length - 1]}: KineticWord "${id}" is held ${body.length} beats (> ${KINETIC_MAX_HOLD_BEATS}) — it is a punch line: land it, then exit it and let the mechanism picture carry the next beats`, beatId: body[0], frame: r.frame });
  }
  return out;
}

// ── W7.1 L57 header names a vendor product ────────────────────────────────────────────────────────────────────

/** Chip / device makers whose name + a product word in a header reads as "this is THE technology". */
export const VENDORS = new Set("TI TEXAS MICROCHIP INFINEON NXP ST STMICRO STMICROELECTRONICS ANALOG ADI MAXIM CYPRESS SYNAPTICS QUALCOMM BROADCOM INTEL AMD NVIDIA APPLE SAMSUNG GOOGLE SONY BOSE GARMIN FITBIT HUAWEI XIAOMI MICROSOFT AMAZON NORDIC RENESAS BOSCH MURATA SKYWORKS".split(" "));
/** Product names that need no vendor in front. */
export const PRODUCTS = new Set("CAPTIVATE AIRPODS IPHONE IPAD GALAXY PIXEL KINDLE QUIETCOMFORT MAGSAFE TRUEDEPTH SNAPDRAGON EXYNOS".split(" "));
const HEADER_FILLER = new Set(["STEP", "SPEC", "PART", "OF", "AND", "THE", "VS"]);

/** The vendor product a header label names (null = none). W7.2: an act label ("STEP 2/4 · <ACT>") is judged on its act. */
export function headerProduct(label: string): { product: string; words: string[] } | null {
  const act = /^STEP \d+\/\d+ · (.+)$/.exec(label.trim());
  const seg = act ? act[1] : (label.split(/[·|]/)[0] ?? "");
  const toks = seg.toUpperCase().match(/[A-Z0-9][A-Z0-9-]*/g) ?? [];
  const words = toks.filter((t) => !/\d/.test(t) && !HEADER_FILLER.has(t) && !VENDORS.has(t) && t.length >= 3);
  const solo = toks.filter((t) => PRODUCTS.has(t));
  if (solo.length) return { product: seg.trim(), words: solo };
  if (toks.length >= 2 && VENDORS.has(toks[0] ?? "") && words.length) return { product: seg.trim(), words };
  return null;
}

/** L57: a header label that names a vendor product the narration never talks about. */
export function headerProductIssues(sb: Pick<Storyboard, "headerRight" | "beats">): W7Finding[] {
  const spoken = ` ${sb.beats.map((b) => b.phrase ?? "").join(" ").toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  const labels: Array<{ beat?: string; text: string }> = [{ text: sb.headerRight }, ...sb.beats.filter((b) => b.header?.right).map((b) => ({ beat: b.id, text: b.header!.right! }))];
  const out: W7Finding[] = [];
  const seen = new Set<string>();
  for (const l of labels) {
    const p = headerProduct(l.text);
    if (!p || seen.has(p.product)) continue;
    seen.add(p.product);
    if (p.words.some((w) => spoken.includes(` ${w} `))) continue; // the reel is about that product
    out.push({ id: "L57", severity: "error", message: `${l.beat ?? "header"}: the header ${JSON.stringify(l.text)} names a vendor product ("${p.product}") the reel is not about — it reads as "phones use ${p.product}". Use the act ("STEP 2/4 · THE GRID"; how-it-works) or the source's document id ("TI SLAY048 · STEP 2/4")`, ...(l.beat ? { beatId: l.beat } : {}) });
  }
  return out;
}
