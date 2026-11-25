// W3.1 grounding extensions (P1): on-screen prop text + whole-fact quote coverage. Pure: no I/O, no model calls.
//
// 1. PROP TEXT (W3 r3 major: event-recent showed four invented region names in a VersionPills, sourced to a page that
//    said only "in all regions"). Every world instance's factual text — whatever its component — is extracted
//    GENERICALLY from the component's registry propsSchema (src/v2/components-meta via META): every string leaf that is
//    free text (not an enum, not an id/key/path pattern), and every number that sits where the schema also accepts a
//    string (HeroStat value). Base props, action prop overrides (state swaps) and Figure nodes (Instance.figure, walked
//    with the storyboard's own Instance schema) all count. A component added to the library is covered with no change
//    here.
//      non-illustrative instance → each text item must be covered by the grounding QUOTES (+ fact claims + narration)
//        of the facts behind its sources: every specific token (number, time, version, 5xx, date) attested (axis ticks
//        inside an attested range count), and at least PROP_MIN_COVERAGE of its content words. Then the model fact
//        check (factcheck.ts) judges the meaning against the quotes.
//      illustrative instance → not fact-checked, but must look generic: domains are reserved example names
//        (example.com, *.test …), IPs are documentation / private ranges, no real cloud region names.
// 2. WHOLE-FACT COVERAGE (W3 r3: f-fix said "07:40 … retry succeeded" with the 07:47 recovery line as its only quote,
//    and the fact check passed it on the page excerpt). A fact passes only if its stored verbatim quotes, together,
//    cover the whole claim: every specific token, and at least FACT_MIN_COVERAGE of its content words. Page excerpts
//    never complete a partial quote — add a second quote instead.
//
// 3. W3.2: numbers a component DRAWS from plain-number props (SCREEN_NUMBERS: Meter %, MetricChart peak/threshold,
//    UnitGrid count) are text items too, and header labels (headerRight, beat.header.right) with a date / number /
//    name are checked against the header's sources and sent to the model check as one "w:header" line.
//
// Wiring (P3, tools.ts / research.ts): call quoteCoverageGaps() after groundingGaps() in submit_script, and
// propGroundingCheck() in submit_storyboard (deterministic gaps refuse the board; its `lines` go to runFactCheckV3).

import type { z } from "zod";
import type { ScriptV2 } from "../../schema/script.v2.js";
import { Instance, type Storyboard } from "../../schema/storyboard.v2.js";
import { META } from "../../v2/components-meta/index.js";
import type { AnyComponentMeta } from "../../v2/components-meta/_types.js";

/** Minimum share of a fact claim's content words its quotes must contain (specific tokens: all of them). */
export const FACT_MIN_COVERAGE = 0.8;
/** Minimum share of an on-screen text item's content words the quotes / claims / narration must contain. */
export const PROP_MIN_COVERAGE = 0.5;

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };
function norm(s: string): string {
  return String(s ?? "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/n't\b/g, " not")
    .replace(/'(s|re|ve|ll|d|m)\b/g, "");
}

const STOP = new Set(
  (
    "a an the and or but if of to in on at for with from by as into onto over under than then so that this these those there here " +
    "it its they them their he she his her we our you your i me my is are was were be been being am do does did done have has had " +
    "will would can could should may might must shall just also only even very really about each every all any some such which who whom " +
    "what when where why how up down out off per via vs etc yet still while whilst though although whereas"
  ).split(" "),
);
/** Negations carry meaning: always content, whatever their length. */
const NEGATION = new Set(["not", "no", "never", "none", "nothing", "without"]);
const NUMWORDS: Record<string, string> = {
  zero: "0", one: "1", single: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", hundred: "100", thousand: "1000",
};
const MONTHS: Record<string, string> = { jan: "january", feb: "february", mar: "march", apr: "april", jun: "june", jul: "july", aug: "august", sep: "september", sept: "september", oct: "october", nov: "november", dec: "december" };

function stem(w: string): string {
  if (w.length <= 3) return w;
  let x = w;
  if (/ie[sd]$/.test(x)) x = x.slice(0, -3) + "y";
  else if (x.endsWith("ing") && x.length > 5) x = x.slice(0, -3);
  else if (x.endsWith("ed") && x.length > 4) x = x.slice(0, -2);
  else if (x.endsWith("es") && x.length > 4) x = x.slice(0, -2);
  else if (x.endsWith("s") && !x.endsWith("ss")) x = x.slice(0, -1);
  if (/([b-df-hj-np-tv-z])\1$/.test(x) && !/(ll|ss)$/.test(x)) x = x.slice(0, -1); // running → run
  if (x.endsWith("e") && x.length > 3) x = x.slice(0, -1);
  return x.length >= 3 ? x : w;
}

export interface Tok {
  /** Normalised form used for matching. */
  key: string;
  /** Has a digit: a number, time, version, status code, date part. */
  specific: boolean;
  /** W3.2 r2: a determiner "one" — attests "1" in a corpus, but is never required of a text (coverage skips it). */
  weak?: boolean;
}

const TOKEN = /\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)+|[a-z]*\d+[a-z0-9]*|[a-z]+/g;

/** Words after "one" / "single" that make it a count (a unit or noun of measure), not a determiner. */
const MEASURE_NOUN = /^(?:ms|msec|millisecond|milliseconds|s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|day|days|week|weeks|month|months|year|years|byte|bytes|bit|bits|kb|mb|gb|tb|kib|mib|gib|tib|percent|%|point|million|billion|thousand|hundred|dollar|dollars|cent|cents|times|time|core|cores|cpu|cpus|gi|mi|ki|request|requests|page|pages)$/;
/** "one" / "single" as a determiner ("in one example", "one of the", "one database link") is no number (W3.2 r2:
 *  oom ex23 "In one example memory.current was about 2.3 GB" was refused for a "1" its quote lacked). */
function determinerNumber(w: string, next: string | undefined): boolean {
  return (w === "one" || w === "single") && !(next && MEASURE_NOUN.test(next));
}

/** Content tokens of a text: stop words dropped, number words → digits, months unified, light stemming. */
export function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const ms = [...norm(text).matchAll(TOKEN)];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    let w = m[0];
    // a determiner "one" still attests "1" (a quote's "one pipeline" covers a screen "1 pipeline"), but is never a
    // specific token a text must find in its quotes
    if (determinerNumber(w, ms[i + 1]?.[0])) {
      out.push({ key: "1", specific: false, weak: true });
      continue;
    }
    if (/^\d+(?:,\d{3})+$/.test(w)) w = w.replace(/,/g, "");
    if (/^\d/.test(w) || /\d/.test(w)) {
      // "007" → "7" (times and versions keep their form)
      if (/^\d+$/.test(w)) w = String(Number(w));
      out.push({ key: w, specific: true });
      continue;
    }
    if (NUMWORDS[w]) {
      out.push({ key: NUMWORDS[w], specific: true });
      continue;
    }
    if (NEGATION.has(w)) {
      out.push({ key: "not", specific: false });
      continue;
    }
    if (STOP.has(w) || w.length < 3) continue;
    out.push({ key: stem(MONTHS[w] ?? w), specific: false });
  }
  return out;
}

export interface Coverage {
  /** Share of content tokens (specific included) found in the corpus; 1 for a text with none. */
  ratio: number;
  missing: string[];
  missingSpecific: string[];
  total: number;
}

/** Coverage of `text` by a corpus token set. `range` (optional): numeric-like tokens attested elsewhere in the same
 *  instance, so axis ticks between two attested values count as attested (07:36 between 07:35 and 07:40). */
export function coverage(text: string, corpus: ReadonlySet<string>, range?: { lo: number; hi: number; kind: string }[]): Coverage {
  const toks = tokens(text).filter((t) => !t.weak);
  const uniq = new Map(toks.map((t) => [t.key, t]));
  const missing: string[] = [];
  const missingSpecific: string[] = [];
  for (const t of uniq.values()) {
    if (corpus.has(t.key)) continue;
    if (t.specific && range?.some((r) => inRange(t.key, r))) continue;
    missing.push(t.key);
    if (t.specific) missingSpecific.push(t.key);
  }
  const total = uniq.size;
  return { ratio: total ? (total - missing.length) / total : 1, missing, missingSpecific, total };
}

function numericValue(key: string): { v: number; kind: string } | null {
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(key);
  if (t) return { v: Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3] ?? 0), kind: "time" };
  if (/^\d+(?:\.\d+)?$/.test(key)) return { v: Number(key), kind: /^\d{4}$/.test(key) ? "year" : "num" };
  return null;
}
function inRange(key: string, r: { lo: number; hi: number; kind: string }): boolean {
  const n = numericValue(key);
  return !!n && n.kind === r.kind && n.v >= r.lo && n.v <= r.hi;
}

export function corpusOf(texts: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const t of texts) for (const k of tokens(t)) s.add(k.key);
  return s;
}

// ── 2. whole-fact quote coverage ───────────────────────────────────────────────────────────────────────────────

export interface QuoteCoverageFinding {
  fact: string;
  coverage: Coverage;
  /** W3.2 r2: scope phrases the claim adds that no quote states ("for this failure"). */
  scope?: string[];
}

/** A scope the claim pins itself to ("for this failure", "in this case", "for these clients"): a quote about another
 *  case does not support it (W3.2 r2 blocker: evergreen-tls "regen": "Regenerating the certificate changes nothing for
 *  this failure" on a quote about old-Android trust stores). */
const SCOPE_PHRASE =
  /\b(?:for|in|with|on|to|of) (?:this|that|these|those|such|the same|our) (?:specific |particular |exact |very )?(?:failures?|errors?|cases?|bugs?|problems?|issues?|incidents?|outages?|scenarios?|situations?|setups?|clients?|paths?|chains?|configurations?|versions?|kinds? of \w+|types? of \w+)\b|\bin (?:this|that|such|these) (?:case|instance|scenario)s?\b/gi;

/** Scope phrases of `claim` whose scope noun no quote contains next to the same determiner. */
export function addedScope(claim: string, quotes: readonly string[]): string[] {
  const q = ` ${quotes.map(flat).join(" | ")} `;
  const out: string[] = [];
  for (const m of String(claim ?? "").matchAll(SCOPE_PHRASE)) {
    const phrase = m[0];
    // the quote states the same scope when it has "<this|that|these…> <noun>" (any preposition)
    const tail = flat(phrase).split(" ").slice(1).join(" ");
    if (!q.includes(` ${tail} `) && !q.includes(` ${tail}`)) out.push(phrase);
  }
  return [...new Set(out)];
}

/** Facts whose quotes do not cover the whole claim (illustrative facts without quotes are skipped; facts with no
 *  quote at all are groundingGaps' job). `grounding` = the parsed Grounding (quotes only are read). W3.2 r2: also a
 *  claim that adds a scope its quotes do not state. */
export function quoteCoverage(script: Pick<ScriptV2, "facts">, grounding: { quotes: readonly { fact: string; quote: string }[] }): QuoteCoverageFinding[] {
  const out: QuoteCoverageFinding[] = [];
  for (const f of script.facts) {
    const qs = grounding.quotes.filter((q) => q.fact === f.id).map((q) => q.quote);
    if (!qs.length) continue;
    const c = coverage(f.claim, corpusOf(qs));
    const scope = addedScope(f.claim, qs);
    // the scope phrases also go into coverage.missing (callers that print `missing` name them)
    if (c.missingSpecific.length || c.ratio < FACT_MIN_COVERAGE || scope.length) out.push({ fact: f.id, coverage: scope.length ? { ...c, missing: [...c.missing, ...scope] } : c, ...(scope.length ? { scope } : {}) });
  }
  return out;
}

export function quoteCoverageGaps(script: Pick<ScriptV2, "facts">, grounding: { quotes: readonly { fact: string; quote: string }[] }): string[] {
  return quoteCoverage(script, grounding).map(({ fact, coverage: c, scope }) => {
    const claim = script.facts.find((f) => f.id === fact)?.claim ?? "";
    const parts: string[] = [];
    if (c.missingSpecific.length) parts.push(`its quote(s) do not contain ${c.missingSpecific.map((t) => JSON.stringify(t)).join(", ")}`);
    else if (c.ratio < FACT_MIN_COVERAGE) parts.push(`its quote(s) cover only ${Math.round(c.ratio * 100)}% of the claim (missing ${c.missing.slice(0, 6).map((t) => JSON.stringify(t)).join(", ")})`);
    if (scope?.length) parts.push(`the claim adds the scope ${scope.map((t) => JSON.stringify(t)).join(", ")}, which no quote states (a quote about another case does not support it)`);
    return `fact "${fact}" ${JSON.stringify(claim.slice(0, 140))}: ${parts.join("; ")} — a fact passes only when its stored verbatim quotes state the WHOLE claim (page excerpts do not count): add a quote for the rest, or narrow the claim (and its line) to what the quotes say`;
  });
}

// ── 1. prop text ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PropText {
  /** "props.items.2", "props.nodes.0.label", "figure.3.text", "b07.props.status" (action override). */
  path: string;
  text: string;
  /** Beat whose action sets it (overrides only). */
  beat?: string;
}

// zod 4 internals, read structurally (def.type + the fields each kind carries).
type Def = { type: string; [k: string]: unknown };
const defOf = (s: unknown): Def | null => ((s as { _zod?: { def?: Def } })?._zod?.def ?? null);
const SAMPLE_TEXT = "Ab 1";

/** A string schema is free text unless a regex check rejects ordinary words ("Ab 1"): ids, edge keys, SVG paths. */
function isFreeTextString(def: Def): boolean {
  const checks = (def.checks as Array<{ _zod?: { def?: { format?: string; pattern?: RegExp } } }> | undefined) ?? [];
  for (const c of checks) {
    const d = c._zod?.def;
    if (d?.format === "regex" && d.pattern instanceof RegExp) {
      const re = new RegExp(d.pattern.source, d.pattern.flags.replace("g", ""));
      if (!re.test(SAMPLE_TEXT)) return false;
    }
  }
  return true;
}

function acceptsFreeString(def: Def | null): boolean {
  if (!def) return false;
  switch (def.type) {
    case "string":
      return isFreeTextString(def);
    case "optional":
    case "default":
    case "nullable":
    case "readonly":
    case "prefault":
    case "catch":
      return acceptsFreeString(defOf(def.innerType));
    case "union":
      return ((def.options as unknown[]) ?? []).some((o) => acceptsFreeString(defOf(o)));
    case "pipe":
      return acceptsFreeString(defOf(def.in));
    case "lazy":
      return acceptsFreeString(defOf((def.getter as () => unknown)()));
    default:
      return false;
  }
}

/**
 * Every free-text value of `value` under zod schema `schema`, walking the VALUE (so recursive lazy schemas terminate
 * and partial objects — action prop overrides — work). Enums, literals, booleans, plain numbers and id/key/path
 * strings are skipped; a number counts when its schema position also accepts free text (HeroStat value 2021).
 */
export function textLeaves(schema: unknown, value: unknown, at = ""): PropText[] {
  const def = defOf(schema);
  if (!def || value === undefined || value === null) return [];
  const out: PropText[] = [];
  const join = (k: string | number) => (at ? `${at}.${k}` : String(k));
  switch (def.type) {
    case "string":
      if (typeof value === "string" && isFreeTextString(def) && value.trim()) out.push({ path: at, text: value });
      break;
    case "optional":
    case "default":
    case "nullable":
    case "readonly":
    case "prefault":
    case "catch":
      return textLeaves(def.innerType, value, at);
    case "pipe":
      return textLeaves(def.in, value, at);
    case "lazy":
      return textLeaves((def.getter as () => unknown)(), value, at);
    case "union": {
      const opts = (def.options as unknown[]) ?? [];
      if (typeof value === "number" && opts.some((o) => acceptsFreeString(defOf(o)))) {
        out.push({ path: at, text: String(value) });
        break;
      }
      // the first option whose kind matches the value
      for (const o of opts) {
        const r = textLeaves(o, value, at);
        if (r.length) return r;
      }
      break;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) break;
      const shape = (def.shape as Record<string, unknown>) ?? {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (shape[k]) out.push(...textLeaves(shape[k], v, join(k)));
      break;
    }
    case "array":
      if (Array.isArray(value)) value.forEach((v, i) => out.push(...textLeaves(def.element, v, join(i))));
      break;
    case "record":
      if (value && typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) out.push(...textLeaves(def.valueType, v, join(k)));
      break;
    case "tuple":
      if (Array.isArray(value)) ((def.items as unknown[]) ?? []).forEach((s, i) => out.push(...textLeaves(s, value[i], join(i))));
      break;
    default:
      break;
  }
  return out;
}

type Inst = z.input<typeof Instance> & { id: string; component: string; props?: Record<string, unknown>; figure?: unknown[]; illustrative?: boolean; sourceIds?: string[] };
type BoardLike =
  | (Pick<Storyboard, "world" | "beats" | "sources"> & Partial<Pick<Storyboard, "headerRight" | "headerSourceIds" | "headerMode">>)
  | {
      world: Inst[];
      beats: Array<{ id: string; sourceIds?: string[]; illustrative?: boolean; header?: { right?: string }; actions?: Array<{ target: string; props?: Record<string, unknown> }> }>;
      sources: Array<{ id: string; ref: string }>;
      headerRight?: string;
      headerSourceIds?: string[];
      headerMode?: string;
    };

// ── numbers a component draws from plain-number props (W3.2) ──────────────────────────────────────────────────
// textLeaves() only sees numbers whose schema position also accepts text (HeroStat value). Several components turn a
// plain number into on-screen text or a readable count: a Meter without valueLabel prints round(value·100)%, a
// MetricChart's peak and threshold set what the axis and the dashed line say, a UnitGrid lights `filled` of 100
// cells. W3.1 probe: Meter {value:0.97}, MetricChart {values:[12,9999], threshold:4242}, UnitGrid {filled:87} with
// quotes saying only "memory usage rose" passed with gaps []. A component meta may declare `screenNumbers(props)`
// itself; otherwise SCREEN_NUMBERS below is the registry's table. Timeline ticks / HeroStat values are strings or
// string|number unions and are already text leaves; ContainerBox `value` only sets a bar (its readout is limitLabel).

export type ScreenNumbersFn = (props: Readonly<Record<string, unknown>>) => Array<{ path: string; text: string }>;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Shortest decimal form, as a source would write it (0.97, 9999, 4.5). */
const numText = (v: number) => String(Number(v.toPrecision(12)));
export const SCREEN_NUMBERS: Readonly<Record<string, ScreenNumbersFn>> = Object.freeze({
  Meter: (p) => (num(p.value) && p.valueLabel === undefined ? [{ path: "value", text: `${Math.round(p.value * 100)}%` }] : []),
  MetricChart: (p) => {
    const out: Array<{ path: string; text: string }> = [];
    const vals = Array.isArray(p.values) ? p.values.filter(num) : [];
    if (vals.length) out.push({ path: "values.max", text: numText(Math.max(...vals)) });
    if (num(p.threshold)) out.push({ path: "threshold", text: numText(p.threshold) });
    if (num(p.yMax)) out.push({ path: "yMax", text: numText(p.yMax) });
    if (num(p.yMin) && p.yMin !== 0) out.push({ path: "yMin", text: numText(p.yMin) });
    return out;
  },
  UnitGrid: (p) => (num(p.filled) ? [{ path: "filled", text: numText(p.filled) }] : []),
});

/** The displayed numbers of one props object (meta.screenNumbers when the meta declares one, else SCREEN_NUMBERS). */
export function screenNumbers(component: string, props: Readonly<Record<string, unknown>>, meta?: AnyComponentMeta): Array<{ path: string; text: string }> {
  const own = (meta as unknown as { screenNumbers?: ScreenNumbersFn } | undefined)?.screenNumbers;
  const fn = typeof own === "function" ? own : SCREEN_NUMBERS[component];
  return fn ? fn(props) : [];
}

const FIGURE_SCHEMA = (Instance as unknown as { shape: Record<string, unknown> }).shape.figure;

/** All on-screen text of one instance: base props, Figure nodes, and every action's prop overrides (with its beat). */
export function instanceTexts(inst: Inst, beats: BoardLike["beats"] = [], meta: AnyComponentMeta | undefined = (META as Record<string, AnyComponentMeta>)[inst.component]): PropText[] {
  if (!meta) return [];
  const base = (inst.props ?? {}) as Record<string, unknown>;
  const out = textLeaves(meta.propsSchema, base, "props");
  out.push(...screenNumbers(inst.component, base, meta).map((n) => ({ path: `props.${n.path}`, text: n.text })));
  if (inst.figure?.length) out.push(...textLeaves(FIGURE_SCHEMA, inst.figure, "figure"));
  for (const b of beats)
    for (const a of b.actions ?? []) {
      if (a.target !== inst.id || !a.props) continue;
      out.push(...textLeaves(meta.propsSchema, a.props, `${b.id}.props`).map((t) => ({ ...t, beat: b.id })));
      // an override's displayed numbers, read on the merged props; only those it changes
      const keys = new Set(Object.keys(a.props));
      out.push(...screenNumbers(inst.component, { ...base, ...a.props }, meta).filter((n) => keys.has(n.path.split(".")[0])).map((n) => ({ path: `${b.id}.props.${n.path}`, text: n.text, beat: b.id })));
    }
  return out;
}

// ── illustrative = visibly generic ─────────────────────────────────────────────────────────────────────────────

const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:example|test|invalid|localhost)|localhost)$/i;
const DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
/** AWS us-east-1, GCP europe-west2, Azure "West US", spelled-out "US WEST" / "SE ASIA" / "EU WEST" region labels. */
const REGION =
  /\b(?:(?:us|eu|ap|sa|ca|me|af|il|mx)-(?:north|south|east|west|central|northeast|northwest|southeast|southwest)-\d|(?:europe|asia|us|northamerica|southamerica|australia|me|africa)-(?:north|south|east|west|central|northeast|southeast|southwest|northwest)\d+|(?:us|eu|se|ap)\s+(?:east|west|north|south|central)|(?:east|west|north|south|central)\s+(?:us|eu|europe|asia)|south\s*east\s+asia|se\s+asia)\b/i;
/** cgroup / sysctl interface file names (memory.max, cpu.max, memory.swap.max, pids.max…; never a common TLD): not domains (W3.1 r2). */
const KERNEL_FILE = /^(?:memory|cpu|cpuset|io|pids|hugetlb|rdma|misc|cgroup)\.(?:[a-z0-9]+\.)*(?!(?:com|org|net|io|dev|app|co|ai|cloud)$)[a-z0-9]+$/i;
const FILE_EXT = /\.(?:json|yaml|yml|txt|log|md|sh|py|ts|js|go|rs|conf|cfg|ini|toml|pem|crt|key|csr|html?|css|png|jpe?g|svg|tar|gz|zip)$/i;

function docOrPrivateIp(a: number, b: number, c: number): boolean {
  return (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 0
  );
}

/** Why an illustrative text is not visibly generic (empty = fine). */
export function nonGenericReasons(text: string): string[] {
  const why: string[] = [];
  const t = String(text ?? "");
  const ips = new Set<string>();
  for (const m of t.matchAll(IPV4)) {
    ips.add(m[0]);
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!docOrPrivateIp(a, b, c)) why.push(`IP ${m[0]} is not a documentation/private address (use 192.0.2.x, 198.51.100.x, 203.0.113.x or 10.x)`);
  }
  for (const m of t.matchAll(DOMAIN)) {
    const d = m[0];
    if (ips.has(d) || /^\d+(?:\.\d+)+$/.test(d) || FILE_EXT.test(d) || KERNEL_FILE.test(d) || !/[a-z]/i.test(d.split(".").slice(-1)[0])) continue;
    if (/^(?:e\.g|i\.e|etc|vs)$/i.test(d)) continue;
    if (!RESERVED_DOMAIN.test(d)) why.push(`domain ${d} is a real-looking name (use example.com / *.example / *.test)`);
  }
  const r = REGION.exec(t);
  if (r) why.push(`"${r[0]}" names a real cloud region (use generic labels like "REGION A")`);
  return why;
}

/** Named specifics in a text (cloud regions, domains, IPs): on a NON-illustrative instance each must appear in the
 *  quotes / claims / narration as written (case and spacing aside) — half-attested words are not enough for names. */
export function namedSpecifics(text: string): string[] {
  const t = String(text ?? "");
  const out = new Set<string>();
  const ips = new Set([...t.matchAll(IPV4)].map((m) => m[0]));
  ips.forEach((ip) => out.add(ip));
  for (const m of t.matchAll(DOMAIN)) {
    const d = m[0];
    if (ips.has(d) || /^\d+(?:\.\d+)+$/.test(d) || FILE_EXT.test(d) || /^(?:e\.g|i\.e|etc|vs)$/i.test(d)) continue;
    out.add(d);
  }
  for (const m of t.matchAll(new RegExp(REGION.source, "gi"))) out.add(m[0]);
  return [...out];
}
const flat = (s: string) => norm(s).replace(/[^a-z0-9.:-]+/g, " ").replace(/\s+/g, " ").trim();

/** Step / part counters in a header ("STEP 1/4", "PART 2", "3/5") are structure, not claims. */
const HEADER_COUNTER = /\b(?:step|part|phase|stage|chapter|ch|act|scene|#)\s*\d+(?:\s*(?:\/|of)\s*\d+)?\b|\b\d+\s*\/\s*\d+\b/gi;
/** The specific tokens of a header label that are claims: years, day numbers, clock times, dotted versions (1.0.2) and
 *  multi-digit codes (404, 137). Single digits, step counters and names with a digit in them ("CGROUP V2", "K8S",
 *  "X509") are labels, not claims. */
export function headerClaimTokens(text: string): string[] {
  return tokens(String(text ?? "").replace(HEADER_COUNTER, " "))
    .filter((t) => t.specific && /^(?:\d{2,}|\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)+)$/.test(t.key))
    .map((t) => t.key);
}

// ── status text vs narration (W3.2 r2) ────────────────────────────────────────────────────────────────────────
// evergreen-tls r2 showed a StatusCard "certificate · expired" for 13 beats while the narration (and its source) said
// "Your certificate is valid" / "The leaf was fine". Each text passes the fact check on its own ("expired" is in some
// fact); together they contradict the thesis.

const BAD_STATE = /^(?:expired|expiring|failed|failing|fails|down|dead|invalid|revoked|broken|error|errored|killed|crashed|rejected|untrusted|offline|unavailable|blocked|stale|oom ?killed)$/i;
const GOOD_STATE = /^(?:valid|fine|ok|okay|healthy|good|working|up|alive|trusted|running|online|available|fresh|current|correct)$/i;
const GOOD_WORDS = "valid|fine|ok|okay|healthy|good|working|up|alive|trusted|running|online|available|correct|never the problem|not expired|not the problem";
const BAD_WORDS = "expired|failed|failing|down|dead|invalid|revoked|broken|killed|crashed|rejected|untrusted|offline|unavailable|blocked";
const STATUS_KEY = /(?:^|\.)(?:status|state|verdict|result|outcome|badge)$/i;
const LABEL_KEY = /(?:^|\.)(?:label|title|name|subject|caption)$/i;

/** The narration sentences that give `subject` the OPPOSITE state of `status` ("certificate" + "expired" vs "Your
 *  certificate is valid"). */
export function statusContradictions(subject: string, status: string, phrases: readonly string[]): Array<{ beat: string; sentence: string }> {
  const st = norm(status).replace(/[^a-z ]+/g, " ").trim();
  const words = st.split(/\s+/).filter(Boolean);
  const bad = words.some((w) => BAD_STATE.test(w)) || BAD_STATE.test(st);
  const good = !bad && (words.some((w) => GOOD_STATE.test(w)) || GOOD_STATE.test(st));
  if (!bad && !good) return [];
  const heads = norm(subject).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!heads.length) return [];
  const opposite = bad ? GOOD_WORDS : BAD_WORDS;
  const out: Array<{ beat: string; sentence: string }> = [];
  phrases.forEach((p, i) => {
    for (const sent of String(p).split(/(?<=[.?!])\s+/)) {
      const t = norm(sent);
      for (const h of heads) {
        const hs = `${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?`;
        const rx = new RegExp(`\\b${hs}\\b(?:\\s+[a-z']+){0,2}?\\s+(?:is|was|are|were|stays|stayed|remains|remained|looks|looked|seems|seemed)\\s+(?:still\\s+|perfectly\\s+|actually\\s+|completely\\s+|totally\\s+)?(?:${opposite})\\b|\\b(?:${opposite})\\s+(?:[a-z']+\\s+)?${hs}\\b`, "i");
        if (rx.test(t)) {
          out.push({ beat: `b${String(i + 1).padStart(2, "0")}`, sentence: sent.trim() });
          return;
        }
      }
    }
  });
  return out;
}

/** An invented placeholder entity on an illustrative label ("Service A", "Host 2", "Node B"). */
const PLACEHOLDER_RE = /\b(?:service|server|host|node|app|application|team|user|customer|db|database|cluster|pod|instance|machine|container|tenant|client|site|vendor|company)\s+([a-z]|\d{1,2})\b/gi;
export function placeholderName(text: string): string | null {
  for (const m of String(text ?? "").matchAll(PLACEHOLDER_RE)) if (/^(?:[A-Z]|\d{1,2})$/.test(m[1])) return m[0];
  return null;
}

// ── quote attribution (W3.3) ─────────────────────────────────────────────────────────────────────────────────────
// evergreen-oom r3 b15: a SourceTag quote from the DEV Community article was attributed "— memory.current" (a kernel
// metric) — it read as a fabricated citation and no check saw it. A quote's attribution must name the cited source
// (its publisher, site or title), never a metric, a field or an invented speaker ("— RAILWAY REPORT" is right).

/** Prop keys that attribute a quote. */
export const ATTRIBUTION_KEY = /(?:^|\.)(?:attribution|cite|citation|byline)$/i;
/** Words that name a kind of document, not who published it ("RAILWAY REPORT", "cgroup2 docs"). */
const ATTR_GENERIC = new Set(
  "the a an of and on by from at for report reports incident incidents postmortem post mortem blog docs doc documentation team engineering status page research news community official press release statement announcement changelog article paper guide advisory security notes note update updates history historical writeup write up analysis".split(" "),
);
/** Host labels that name no publisher (TLDs, second-level registries, generic subdomains). The REGISTRABLE label
 *  (the one before the TLD) is kept even when it is in this list: dev.to → "dev" (DEV Community; W3.3 fix round 1:
 *  "DEV Community" was rejected because "dev" was dropped as a TLD). */
const TLD_LIKE = new Set("com org net io dev app co ai cloud uk de ch fr eu us info me sh tech so to gg ly site www blog docs status github".split(" "));
const SECOND_LEVEL = new Set("co com org net ac gov edu".split(" "));
const attrTokens = (s: string) => (String(s ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 || /\d/.test(w));
/** Publisher labels of a URL's host: blog.railway.com → railway; michal-drozd.com → michal, drozd; dev.to → dev. */
function hostLabels(url: string): string[] {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return parts;
  let reg = parts.length - 2;
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[reg]) && parts[reg + 1].length === 2) reg--; // bbc.co.uk
  return parts.slice(0, reg + 1).filter((l, i) => i === reg || !TLD_LIKE.has(l)).flatMap((l) => [l, ...l.split("-")]);
}
/** Title parts that read as the headline or its topic, not a publisher: a digit or a code-like token ("Exit Code
 *  137", "memory.current", "cgroups v2", "OOMKilled") or a headline word. */
const CODE_LIKE = /\d|[._/=]|\b[a-z]+[A-Z]\w*/;
const HEADLINE_WORDS = /\b(?:why|how|what|when|exit|code|error|errors|fix|fixing|debugging|understanding|guide to)\b/i;
/** A word that names a publishing outlet ("cgroup2 docs", "DEV Community", "Cloudflare Blog"). */
const OUTLET_WORD = /\b(?:docs|documentation|blog|community|engineering|news|wiki|handbook|manual|magazine|journal|press)\b/i;
/**
 * Publisher-ish names of a source (W3.3 fix round 1 — for "Exit Code 137: Why … (DEV Community)" the head "EXIT CODE
 * 137" passed as the publisher and "DEV Community" was rejected):
 *   - the host's publisher labels (hostLabels: dev.to → dev);
 *   - a trailing "(Publisher)", a site suffix after " | " / " - " / " — ", or a title head before ":" / " | " / " - " /
 *     " — " (each <= 3-4 words) — a part counts only when it matches a host label, or names an outlet ("docs", "blog",
 *     "community") without a headline word, or (title head only, when no other part names the publisher) reads as no
 *     headline: no digit, code token or headline word. "(cgroups v2)" and "Exit Code 137" are topic, not publisher.
 */
export function sourceNames(s: { title: string; url: string }): { publisher: Set<string>; all: Set<string> } {
  const title = String(s.title ?? "").trim();
  const labels = hostLabels(s.url);
  const paren = /\(([^()]{2,60})\)\s*$/.exec(title)?.[1] ?? "";
  const bare = paren ? title.slice(0, title.lastIndexOf("(")).trim() : title;
  const head = bare.split(/\s*(?::|\s\|\s|\s[-–—]\s)\s*/)[0] ?? "";
  const site = /\s(?:\||[-–—])\s([^|–—]+)$/.exec(bare)?.[1] ?? "";
  const words = (x: string, n: number) => (x && x !== bare && attrTokens(x).length <= n ? attrTokens(x) : []);
  const hostMatch = (ws: string[]) => ws.some((w) => labels.includes(w)) || labels.some((l) => l.length > 3 && ws.join("").includes(l));
  const outlet = (x: string, ws: string[]) => ws.length > 0 && (hostMatch(ws) || (OUTLET_WORD.test(x) && !HEADLINE_WORDS.test(x)));
  const parenW = attrTokens(paren).length <= 4 ? attrTokens(paren) : [];
  const siteW = words(site, 4);
  const headW = words(head, 3);
  const pub = new Set<string>(labels);
  const named: string[][] = [];
  if (outlet(paren, parenW) || (parenW.length && !CODE_LIKE.test(paren) && !HEADLINE_WORDS.test(paren))) named.push(parenW);
  if (outlet(site, siteW) || (siteW.length && !CODE_LIKE.test(site) && !HEADLINE_WORDS.test(site))) named.push(siteW);
  if (outlet(head, headW) || (headW.length && !named.length && !CODE_LIKE.test(head) && !HEADLINE_WORDS.test(head))) named.push(headW);
  for (const w of named.flat()) pub.add(w);
  return { publisher: pub, all: new Set([...pub, ...attrTokens(title)]) };
}

/** The publisher part of a source's title ("(DEV Community)", "| Cloudflare Blog", "cgroup2 docs:"), if any. */
function publisherPart(s: { title: string; url: string }): string | null {
  const title = String(s.title ?? "").trim();
  const pub = sourceNames(s).publisher;
  const paren = /\(([^()]{2,60})\)\s*$/.exec(title)?.[1]?.trim();
  const bare = paren ? title.slice(0, title.lastIndexOf("(")).trim() : title;
  const site = /\s(?:\||[-–—])\s([^|–—]+)$/.exec(bare)?.[1]?.trim();
  const head = bare.split(/\s*(?::|\s\|\s|\s[-–—]\s)\s*/)[0]?.trim();
  for (const x of [paren, site, head !== bare ? head : undefined]) if (x && x.length <= 28 && attrTokens(x).length && attrTokens(x).every((w) => pub.has(w))) return x;
  return null;
}

/**
 * Why a quote attribution does not name one of `sources` (null = it does). It must contain a publisher / site name of
 * a cited source (sourceNames().publisher), and at least half of its non-generic words must come from that source's
 * title or site — "DEV Community", "RAILWAY REPORT", "Linux kernel docs" pass; "memory.current", "The team",
 * "a senior SRE" do not.
 */
export function attributionProblem(attribution: string, sources: ReadonlyArray<{ title: string; url: string }>): string | null {
  const words = attrTokens(attribution).filter((w) => !ATTR_GENERIC.has(w));
  if (!words.length) return "names no source (only generic words)";
  for (const s of sources) {
    const n = sourceNames(s);
    const known = words.filter((w) => n.all.has(w)).length;
    if (words.some((w) => n.publisher.has(w)) && known / words.length >= 0.5) return null;
  }
  return "names none of its cited sources (a metric, a field or a speaker the source does not name)";
}

/** The name to suggest for a quote's attribution: the publisher part of the source's title, else its host. */
export function suggestedAttribution(s: { title: string; url: string } | undefined): string {
  if (!s) return "the source's publisher";
  const part = publisherPart(s);
  if (part) return part;
  try {
    return new URL(s.url).hostname.replace(/^www\./, "");
  } catch {
    return "the source's publisher";
  }
}

// ── the storyboard check ───────────────────────────────────────────────────────────────────────────────────────

/** One on-screen text block for the model fact check (factcheck.ts): an instance's texts and the facts behind it. */
export interface PropLine {
  /** "w:<instance id>". */
  id: string;
  instance: string;
  component: string;
  texts: string[];
  /** Fact ids whose quotes may support the texts (facts sourced from the instance's sources). */
  facts: string[];
}

export interface PropGroundingCheck {
  gaps: string[];
  warnings: string[];
  /** Non-illustrative instances with text, for the model fact check. */
  lines: PropLine[];
  /** Per instance: the extracted texts (for script.md / debugging). */
  texts: Map<string, PropText[]>;
}

export interface PropGroundingArgs {
  storyboard: BoardLike;
  /** `mode` (optional): an event reel's illustrative placeholder labels ("Service A") are refused, a concept's warned. */
  script: Pick<ScriptV2, "facts" | "sources" | "phrases"> & { mode?: ScriptV2["mode"] };
  /** Parsed Grounding (quotes are read). */
  grounding: { quotes: readonly { fact: string; quote: string }[] };
  /** URL normaliser (research.ts normUrl) so storyboard source refs map onto script sources. */
  normUrl: (u: string) => string;
  /** W7 (W6 bug: a `kubectl describe` line copied from a page the director read was refused): the text of every page
   *  the director read. An on-screen text found VERBATIM on one of them (≥ PAGE_VERBATIM_MIN_TOKENS tokens) is accepted
   *  by the deterministic check (noted as a warning); the model fact check still judges it. */
  readPages?: ReadonlyArray<{ url: string; text: string }>;
}

/** A page-verbatim acceptance needs at least this many tokens (a bare "9" or "137" is on every page). */
export const PAGE_VERBATIM_MIN_TOKENS = 3;

/** The read page whose text contains `text` verbatim (case / punctuation / spacing folded), else null. */
export function verbatimOnPage(text: string, pages: ReadonlyArray<{ url: string; flat: string }>): string | null {
  const t = flat(text);
  if (t.split(" ").filter(Boolean).length < PAGE_VERBATIM_MIN_TOKENS) return null;
  const hit = pages.find((p) => p.flat.includes(` ${t} `));
  return hit ? hit.url : null;
}

/**
 * Deterministic prop-text grounding. Gaps refuse the storyboard: a non-illustrative text with an unattested
 * specific token or < PROP_MIN_COVERAGE content coverage by its quotes (+ claims + narration), or an illustrative
 * text that is not visibly generic. `lines` = what the model fact check must judge next.
 */
/** A NodeGraph node's inner tag (props.nodes.<i>.inner, base or a beat override) and a role glyph: ≤4 capitals. */
const ROLE_GLYPH_PATH = /(?:^|\.)props\.nodes\.\d+\.inner$/;
const ROLE_GLYPH = /^[A-Z]{1,4}$/;

export function propGroundingCheck(a: PropGroundingArgs): PropGroundingCheck {
  const { storyboard: sb, script, grounding } = a;
  const gaps: string[] = [];
  const warnings: string[] = [];
  const lines: PropLine[] = [];
  const texts = new Map<string, PropText[]>();
  const scriptSrcByUrl = new Map(script.sources.map((s) => [a.normUrl(s.url), s.id]));
  const boardToScript = new Map<string, string>();
  for (const s of sb.sources ?? []) {
    const m = /https:\/\/\S+/.exec(s.ref ?? "");
    const id = m ? scriptSrcByUrl.get(a.normUrl(m[0].replace(/[),.;]+$/, ""))) : undefined;
    if (id) boardToScript.set(s.id, id);
    else if (script.sources.some((x) => x.id === s.id)) boardToScript.set(s.id, s.id);
  }
  const quotesOf = (factIds: readonly string[]) => grounding.quotes.filter((q) => factIds.includes(q.fact)).map((q) => q.quote);
  const narration = script.phrases.map((p) => p.text);
  const pagesFlat = (a.readPages ?? []).map((p) => ({ url: p.url, flat: ` ${flat(p.text)} ` }));

  for (const inst of sb.world as Inst[]) {
    const items = instanceTexts(inst, sb.beats);
    if (!items.length) continue;
    texts.set(inst.id, items);
    // W3.3: a quote's attribution names its cited source (all instances, illustrative too)
    const attrs = items.filter((it) => ATTRIBUTION_KEY.test(it.path));
    if (attrs.length) {
      const actedOn = sb.beats.filter((b) => (b.actions ?? []).some((x) => x.target === inst.id)).flatMap((b) => b.sourceIds ?? []);
      const ids = new Set((inst.sourceIds?.length ? inst.sourceIds : actedOn).map((id) => boardToScript.get(id)).filter((x): x is string => !!x));
      const cited = script.sources.filter((s) => !ids.size || ids.has(s.id));
      for (const it of attrs) {
        const why = attributionProblem(it.text, cited);
        if (why)
          gaps.push(
            `"${inst.id}" (${inst.component}) ${it.beat ? `${it.beat} ` : ""}${it.path} ${JSON.stringify(it.text)}: the attribution ${why} — a quote is attributed to the page it quotes (e.g. ${JSON.stringify(suggestedAttribution(cited[0]))}${ids.size ? "" : "; set the instance's sourceIds to that page"}), never to a metric, a field or an invented speaker`,
          );
      }
    }
    // W3.2 r2: a status text that gives the subject the state the narration denies (all instances, illustrative too)
    const labelOf = (beat?: string) => items.filter((it) => LABEL_KEY.test(it.path) && (!beat || !it.beat || it.beat === beat)).map((it) => it.text);
    for (const it of items.filter((x) => STATUS_KEY.test(x.path))) {
      const subject = labelOf(it.beat).join(" ") || inst.id.replace(/[-_]+/g, " ");
      const hits = statusContradictions(subject, it.text, narration);
      if (hits.length)
        gaps.push(
          `"${inst.id}" (${inst.component}) ${it.beat ? `${it.beat} ` : ""}shows ${JSON.stringify(`${subject} · ${it.text}`)} but ${hits.map((h) => `${h.beat} says ${JSON.stringify(h.sentence)}`).slice(0, 2).join(" and ")} — on-screen status must match the narration: label it as what the narration says fails (e.g. the error the client reports, "handshake: certificate has expired"), or give the subject the state the narration gives it and mark the failing part instead`,
        );
    }
    if (inst.illustrative) {
      for (const it of items) for (const r of nonGenericReasons(it.text)) gaps.push(`"${inst.id}" (${inst.component}, illustrative) ${it.path} ${JSON.stringify(it.text)}: ${r} — illustrative visuals must look generic`);
      // W3.2 r2 (event-recent b09 "Service A memory"): labels are still checked — an invented placeholder entity for
      // something the narration names is refused on an event reel (warned on a concept reel).
      for (const it of items.filter((x) => LABEL_KEY.test(x.path))) {
        const ph = placeholderName(it.text);
        if (!ph || narration.some((n) => n.toLowerCase().includes(ph.toLowerCase()))) continue;
        const msg = `"${inst.id}" (${inst.component}, illustrative) ${it.path} ${JSON.stringify(it.text)}: "${ph}" is an invented name — the label shows what the narration or the source calls it (e.g. use the narration's words), since an illustrative flag does not show on screen`;
        (script.mode === "event" ? gaps : warnings).push(msg);
      }
      continue;
    }
    // sources behind the instance: its own sourceIds, else those of the beats acting on it, else every source
    const acted = sb.beats.filter((b) => (b.actions ?? []).some((x) => x.target === inst.id)).flatMap((b) => b.sourceIds ?? []);
    const boardIds = inst.sourceIds?.length ? inst.sourceIds : acted;
    const srcIds = new Set(boardIds.map((id) => boardToScript.get(id)).filter((x): x is string => !!x));
    const linked = script.facts.filter((f) => !f.illustrative && (!srcIds.size || srcIds.has(f.sourceId)));
    if (!srcIds.size) warnings.push(`"${inst.id}" (${inst.component}) shows text but names no source: checked against every fact — add sourceIds, or mark it illustrative if it shows example values`);
    const corpusTexts = [...quotesOf(linked.map((f) => f.id)), ...linked.map((f) => f.claim), ...narration];
    const corpus = corpusOf(corpusTexts);
    const corpusFlat = ` ${corpusTexts.map(flat).join(" | ")} `;
    // attested numeric ranges inside this instance (axis ticks between two attested values)
    const nums = items.flatMap((it) => tokens(it.text)).filter((t) => t.specific && corpus.has(t.key)).map((t) => numericValue(t.key)).filter((x): x is { v: number; kind: string } => !!x);
    const range = ["time", "year", "num"].map((kind) => {
      const v = nums.filter((n) => n.kind === kind).map((n) => n.v);
      return v.length >= 2 ? { lo: Math.min(...v), hi: Math.max(...v), kind } : null;
    }).filter((r): r is { lo: number; hi: number; kind: string } => !!r);
    // W3.3: an attribution is judged by the attribution rule above (it names the page, not a fact): no coverage check.
    // W5: neither is a NodeGraph node's short role glyph (DG5 demands one: CRT / SVC / USR) — W3.3 refused "CRT", "INT",
    // "USR", "RSV", "CGRP" as unquoted words although they claim nothing (its label below the node is still checked).
    const claims = items.filter((x) => !ATTRIBUTION_KEY.test(x.path) && !(inst.component === "NodeGraph" && ROLE_GLYPH_PATH.test(x.path) && ROLE_GLYPH.test(x.text.trim())));
    for (const it of claims) {
      const c = coverage(it.text, corpus, range);
      if (!c.total) continue;
      const where = `"${inst.id}" (${inst.component}) ${it.beat ? `${it.beat} ` : ""}${it.path.replace(/^(?:b\d{2}\.)?/, "")} ${JSON.stringify(it.text)}`;
      const onPage = pagesFlat.length && (c.missingSpecific.length || c.ratio < PROP_MIN_COVERAGE || namedSpecifics(it.text).length) ? verbatimOnPage(it.text, pagesFlat) : null;
      if (onPage) {
        warnings.push(`${where}: not in its quotes, but found verbatim on a page you read (${onPage}) — accepted; the on-screen fact check still judges it`);
        continue;
      }
      const names = namedSpecifics(it.text).filter((n) => !corpusFlat.includes(` ${flat(n)} `) && !corpusFlat.includes(flat(n)));
      if (names.length) gaps.push(`${where}: names ${names.map((n) => JSON.stringify(n)).join(", ")}, which no quote of its source(s) states — show only what the quotes name (e.g. "ALL REGIONS"), or mark the instance illustrative with generic labels`);
      else if (c.missingSpecific.length) gaps.push(`${where}: ${c.missingSpecific.map((t) => JSON.stringify(t)).join(", ")} is in no quote of its source(s) — on-screen facts need a verbatim quote too: quote the page, use the quoted value, or mark the instance illustrative (generic values)`);
      else if (c.ratio < PROP_MIN_COVERAGE) gaps.push(`${where}: only ${Math.round(c.ratio * 100)}% of its words are in the quotes, fact claims or narration (missing ${c.missing.slice(0, 5).map((t) => JSON.stringify(t)).join(", ")}) — use the source's words, or mark the instance illustrative with generic labels`);
    }
    if (claims.length) lines.push({ id: `w:${inst.id}`, instance: inst.id, component: inst.component, texts: [...new Set(claims.map((i) => i.text))], facts: linked.map((f) => f.id) });
  }

  // Header labels (W3.1 carry-over: "SEP 30 2021 · ROOT EXPIRED" is an on-screen date claim no check saw). The opening
  // headerRight and every beat.header.right: their specific tokens (dates, years, times, versions) and named specifics
  // must be attested by the quotes of the header's sources (headerSourceIds + the sources of beats that change it;
  // none → every fact). Plain label words ("SPEC", "ROOT EXPIRED") are not coverage-checked — a header is a label.
  const sbh = sb as { headerRight?: string; headerSourceIds?: string[]; headerMode?: string; beats: Array<{ id: string; sourceIds?: string[]; header?: { right?: string } }> };
  const heads = [
    ...(sbh.headerRight ? [{ path: "headerRight", text: sbh.headerRight, src: sbh.headerSourceIds ?? [] }] : []),
    ...sbh.beats.filter((b) => b.header?.right).map((b) => ({ path: `${b.id}.header.right`, text: b.header!.right!, src: b.sourceIds ?? [] })),
  ];
  const headSpecific = heads.filter((h) => headerClaimTokens(h.text).length || namedSpecifics(h.text).length);
  if (headSpecific.length) {
    const ids = new Set(headSpecific.flatMap((h) => h.src).map((id) => boardToScript.get(id)).filter((x): x is string => !!x));
    const linked = script.facts.filter((f) => !f.illustrative && (!ids.size || ids.has(f.sourceId)));
    const corpusTexts = [...quotesOf(linked.map((f) => f.id)), ...linked.map((f) => f.claim), ...narration];
    const corpus = corpusOf(corpusTexts);
    const corpusFlat = ` ${corpusTexts.map(flat).join(" | ")} `;
    for (const h of headSpecific) {
      const where = `header ${h.path} ${JSON.stringify(h.text)}`;
      const names = namedSpecifics(h.text).filter((n) => !corpusFlat.includes(flat(n)));
      const claim = new Set(headerClaimTokens(h.text));
      const miss = coverage(h.text, corpus).missingSpecific.filter((t) => claim.has(t));
      if (names.length) gaps.push(`${where}: names ${names.map((n) => JSON.stringify(n)).join(", ")}, which no quote of its source(s) states — the header shows only sourced dates and names`);
      else if (miss.length) gaps.push(`${where}: ${miss.map((t) => JSON.stringify(t)).join(", ")} is in no quote of its source(s) — a header date / time / version needs a verbatim quote (headerSourceIds), or drop it from the label`);
    }
    const taken = new Set((sb.world as Inst[]).map((w) => w.id));
    const id = ["header", "header-label", "header-text"].find((x) => !taken.has(x)) ?? "header-x";
    lines.push({ id: `w:${id}`, instance: id, component: "Header", texts: [...new Set(headSpecific.map((h) => h.text))], facts: linked.map((f) => f.id) });
  }
  return { gaps, warnings, lines, texts };
}
