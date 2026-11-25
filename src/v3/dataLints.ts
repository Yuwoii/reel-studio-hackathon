// DATA LINTS (honeypot-weekly plan): $0 checks of a DATA job's narrative, storyboard and caption against its
// owner-measured data pack (src/data/honeypotPack.ts). They run only when the job carries a verified pack
// (src/director/v3/dataPack.ts); a normal job never reaches them. Outside the v3 library hash on purpose: this file
// is not under remotion/ or src/v3/components-meta/ and nothing the renderer imports imports it
// (scripts/v3/site-hash.ts --list shows the hashed set).
//
//   DP-NUM   every number the voice SAYS, and every number shown in a board text prop, is a pack number
//            (numberSet = the facts' numbers + constants, normalised like SRC1). Weekday / month words only as the
//            pack has them: a line with a weekday AND numbers needs one fact (or one day of the daily list) holding
//            both; a weekday without numbers needs a fact naming it (the busiest day, the cluster day). Bindings:
//            HeroStat.value ∈ numberSet; a Meter without valueLabel shows round(value·100) % ∈ numberSet;
//            MetricChart.values = the pack's 7 daily counts in order, spike = the peak day, no incident window,
//            threshold ∈ numberSet, x labels = the days at their evenly spread indices; Terminal lines = pack
//            terminalLines exactly, in pack order, no extra line.                                      error
//   DP-LEAK  the pack's deny set (IPs, the domain stem, the zone, domains, e-mail, AWS keys, high-entropy tokens)
//            over narration, shot notes, every storyboard string prop, Terminal lines, card text and caption.
//            Matches are reported by id only (never the matched text). RFC 2606 example names (example.com,
//            *.example, *.test — the only hosts BrowserWindow allows) are not leaks.                    error
//   DP-GEO   countries are hosting locations: "attackers from <country>" / "<Nationality> hackers" refuse, and a
//            country named without "hosted / rented / server / cloud" in the same text refuses.          error
//
// Pure functions: no file access, no network.

import { DENY_RES, MONTHS, WEEKDAYS, denyHits, stringsIn, type DataPackV1T } from "../data/honeypotPack.js";
import { peakIndex } from "../data/honeypotFacts.js";
import { normNumber, numbersIn } from "../director/v3/numbers.js";

export type DataLintCode = "DP-NUM" | "DP-LEAK" | "DP-GEO";

export interface DataLintFinding {
  code: DataLintCode;
  /** where the text came from: "L03", "b05 world.chart.props.values", "caption[0]", … */
  where: string;
  /** narration line id (narrative checks) */
  line?: string;
  /** storyboard beat id (board checks, when the finding is tied to a beat) */
  beatId?: string;
  message: string;
}

export interface LabeledText {
  where: string;
  text: string;
  line?: string;
  beatId?: string;
}

export interface DataNumbersReport {
  findings: DataLintFinding[];
  /** spoken number tokens checked / that are pack numbers */
  spoken: { checked: number; matched: number };
  /** on-screen numbers checked / that matched (text props + bindings) */
  onScreen: { checked: number; matched: number };
}

export interface DataNumbersInput {
  pack: DataPackV1T;
  /** narration lines (id + spoken text; optional shot intent whose 'quoted' words appear on screen) */
  lines?: ReadonlyArray<{ id: string; text: string; shot?: { note?: string; overlay?: string; keyframe?: string } | null }>;
  /** the parsed storyboard (StoryboardV3T-shaped: world[], beats[]) */
  storyboard?: BoardLike | null;
}

/** The parts of a storyboard v3 the data lints read (kept structural so a raw parsed board fits). */
export interface BoardLike {
  world: ReadonlyArray<{ id: string; component: string; props?: Record<string, unknown> }>;
  beats: ReadonlyArray<{ id: string; actions?: ReadonlyArray<{ target: string; do?: string; props?: Record<string, unknown> }> }>;
  [k: string]: unknown;
}

// ── shared ──────────────────────────────────────────────────────────────────────────────────────────────────────

const WEEKDAY_RE = new RegExp(`\\b(${WEEKDAYS.join("|")})s?\\b`, "gi");
/** "May" only as a month next to a digit ("15 May", "May 15"): the word is a verb far more often. */
const MONTH_RE = new RegExp(`\\b(${MONTHS.filter((m) => m !== "May").join("|")})\\b|\\b\\d{1,2}\\s+May\\b|\\bMay\\s+\\d{1,2}\\b`, "g");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const weekdaysIn = (t: string): string[] => [...new Set([...String(t).matchAll(WEEKDAY_RE)].map((m) => cap(m[1])))];
const monthsIn = (t: string): string[] => [...new Set([...String(t).matchAll(MONTH_RE)].map((m) => (m[1] ? m[1] : "May")))];
const numsOf = (t: string): string[] => [...new Set(numbersIn(t).map(normNumber))];

/** Keys whose string values are structure (ids, enums, refs, seeds, hashes), not text a viewer reads. */
const STRUCTURAL_KEYS = new Set([
  "id", "instance", "anchor", "target", "component", "asset", "pageAsset", "station", "subject", "fromBeat", "forBeat", "beat", "pictureBeat",
  "seed", "ease", "transition", "do", "at", "ref", "state", "tone", "kind", "mode", "preset", "role", "enter", "part", "act", "rate", "space",
  "keywordColor", "headerDot", "dot", "schema", "libraryVersion", "family", "headerMode", "sha256", "sourceIds", "claims", "type", "music", "blur", "style",
]);
/** Text props whose numbers are chrome, not data ("STEP 2/4 · THE ASK"): leak-scanned, never number-checked. */
const NUMBER_EXEMPT_KEYS = new Set(["headerRight", "right", "protocol", "validTo"]);

function lastKey(p: string): string {
  const m = /([A-Za-z_][\w]*)(?:\[\d+\])*$/.exec(p);
  return m ? m[1] : p;
}
const isStructuralPath = (p: string): boolean => p.split(".").some((seg) => STRUCTURAL_KEYS.has(seg.replace(/\[\d+\]/g, "")));
/** A library asset ref ("cat-photo@1", "phone@2"): structure, wherever it sits (Phone props.photo). */
const ASSET_REF_RE = /^[a-z0-9][a-z0-9-]*@\d+$/;

/** On-screen words of a shot intent: the 'single-quoted' parts (prompt rule: everything unquoted is crew talk). */
export function quotedOnScreen(t: string | undefined): string[] {
  return [...String(t ?? "").matchAll(/(?<![A-Za-z0-9])'([^'\n]{1,80}?)'(?![A-Za-z0-9])/g)].map((m) => m[1]);
}

/** Facts as checkable units: each fact, plus each day of the daily list (F05) on its own (flagged `daily`). */
function factUnits(pack: DataPackV1T): Array<{ text: string; daily: boolean; nums: Set<string> }> {
  const out: Array<{ text: string; daily: boolean; nums: Set<string> }> = [];
  for (const f of pack.facts) {
    if (f.id === "F05") {
      const body = f.text.replace(/^[^:]*:\s*/, "");
      for (const seg of body.split(";")) out.push({ text: seg, daily: true, nums: new Set(numsOf(seg)) });
    } else out.push({ text: f.text, daily: false, nums: new Set(numsOf(f.text)) });
  }
  return out;
}

// ── DP-NUM ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * DP-NUM over the narration and/or the storyboard. Strict on purpose (false positives are fixed by the pack's
 * constants list, not by loosening the rule).
 */
export function lintDataNumbers(i: DataNumbersInput): DataNumbersReport {
  const { pack } = i;
  const set = new Set(pack.numberSet);
  const units = factUnits(pack);
  const weekDays = new Set<string>(pack.stats.daily.map((d) => d.weekday));
  const weekMonths = new Set<string>(pack.stats.daily.map((d) => d.month));
  const findings: DataLintFinding[] = [];
  const spoken = { checked: 0, matched: 0 };
  const onScreen = { checked: 0, matched: 0 };

  /** numbers + calendar words of one text; `counter` books the numbers */
  const checkText = (t: LabeledText, counter: { checked: number; matched: number }, spokenLine: boolean) => {
    const nums = numsOf(t.text);
    for (const n of nums) {
      counter.checked++;
      if (set.has(n)) counter.matched++;
      else findings.push({ code: "DP-NUM", where: t.where, ...(t.line ? { line: t.line } : {}), ...(t.beatId ? { beatId: t.beatId } : {}), message: `${t.where} ${spokenLine ? "says" : "shows"} "${n}", which is not a number in the data pack — use the pack's numbers exactly as its facts write them (no sums, roundings, shares or comparisons of your own)` });
    }
    for (const m of monthsIn(t.text)) {
      if (!weekMonths.has(m)) findings.push({ code: "DP-NUM", where: t.where, ...(t.line ? { line: t.line } : {}), ...(t.beatId ? { beatId: t.beatId } : {}), message: `${t.where} names ${m}, but the pack's week is in ${[...weekMonths].join(" / ")}` });
    }
    for (const w of weekdaysIn(t.text)) {
      if (!weekDays.has(w)) {
        findings.push({ code: "DP-NUM", where: t.where, ...(t.line ? { line: t.line } : {}), ...(t.beatId ? { beatId: t.beatId } : {}), message: `${t.where} names ${w}, which is not a day of the pack's week` });
        continue;
      }
      const lineNums = nums.filter((n) => set.has(n));
      const ok = lineNums.length
        ? units.some((u) => u.text.includes(w) && lineNums.every((n) => u.nums.has(n)))
        : units.some((u) => !u.daily && u.text.includes(w));
      if (!ok)
        findings.push({
          code: "DP-NUM",
          where: t.where,
          ...(t.line ? { line: t.line } : {}),
          ...(t.beatId ? { beatId: t.beatId } : {}),
          message: lineNums.length
            ? `${t.where} ties ${w} to ${lineNums.join(", ")}, but no fact in the pack states ${lineNums.length > 1 ? "those numbers" : "that number"} for ${w} — say the day only where a fact names it with the number`
            : `${t.where} names ${w}, but no fact in the pack is about ${w} (only the daily list has it) — name the day the facts single out, or none`,
        });
    }
  };

  for (const l of i.lines ?? []) {
    checkText({ where: l.id, line: l.id, text: l.text }, spoken, true);
    const quoted = [l.shot?.note, l.shot?.overlay, l.shot?.keyframe].flatMap(quotedOnScreen);
    for (const q of quoted) checkText({ where: `${l.id} shot`, line: l.id, text: q }, onScreen, false);
  }

  const sb = i.storyboard;
  if (sb) {
    for (const inst of sb.world ?? []) {
      const acts = (sb.beats ?? []).flatMap((b) => (b.actions ?? []).filter((a) => a.target === inst.id && a.props).map((a) => ({ beatId: b.id, props: a.props as Record<string, unknown> })));
      const snapshots: Array<{ where: string; beatId?: string; props: Record<string, unknown>; delta?: Record<string, unknown> }> = [{ where: `world.${inst.id}.props`, props: inst.props ?? {} }];
      for (const a of acts) snapshots.push({ where: `${a.beatId} ${inst.id} action props`, beatId: a.beatId, props: { ...(inst.props ?? {}), ...a.props }, delta: a.props });
      for (const snap of snapshots) {
        // text props (only the strings this snapshot adds: an action re-checks its own props, not the base again)
        for (const s of stringsIn(snap.delta ?? snap.props)) {
          if (isStructuralPath(s.path) || NUMBER_EXEMPT_KEYS.has(lastKey(s.path)) || ASSET_REF_RE.test(s.value)) continue;
          if (inst.component === "Terminal" && /^lines\[\d+\]\.text$/.test(s.path)) continue; // the Terminal rule below
          if (inst.component === "HeroStat" && s.path === "value") continue; // the HeroStat rule below
          checkText({ where: `${snap.where}.${s.path}`, ...(snap.beatId ? { beatId: snap.beatId } : {}), text: s.value }, onScreen, false);
        }
        bindingChecks(inst.component, snap.props, snap.delta, snap.where, snap.beatId, pack, set, findings, onScreen);
      }
    }
  }
  return { findings, spoken, onScreen };
}

function bindingChecks(
  component: string,
  props: Record<string, unknown>,
  delta: Record<string, unknown> | undefined,
  where: string,
  beatId: string | undefined,
  pack: DataPackV1T,
  set: ReadonlySet<string>,
  findings: DataLintFinding[],
  onScreen: { checked: number; matched: number },
): void {
  const touched = (k: string) => !delta || k in delta;
  const push = (message: string) => findings.push({ code: "DP-NUM", where, ...(beatId ? { beatId } : {}), message });
  const num = (label: string, v: string) => {
    onScreen.checked++;
    if (set.has(v)) onScreen.matched++;
    else push(`${where}: ${label} ${v} is not a number in the data pack`);
  };

  if (component === "HeroStat" && touched("value") && props.value !== undefined) {
    const v = props.value;
    const decimals = typeof props.decimals === "number" ? props.decimals : 0;
    if (typeof v === "number") num("HeroStat value", normNumber(decimals ? v.toFixed(decimals) : String(v)));
    else if (typeof v === "string") for (const n of numsOf(v)) num("HeroStat value", n);
  }

  if (component === "Meter" && (touched("value") || touched("valueLabel")) && props.valueLabel === undefined && typeof props.value === "number") {
    num("Meter percentage", String(Math.round(props.value * 100)));
  }

  if (component === "MetricChart") {
    const daily = pack.stats.daily;
    if (touched("values") && Array.isArray(props.values)) {
      const want = daily.map((d) => d.hits);
      const got = props.values as unknown[];
      onScreen.checked++;
      if (got.length === want.length && got.every((x, k) => x === want[k])) onScreen.matched++;
      else push(`${where}: MetricChart values must be the pack's 7 daily counts in order (${want.join(", ")}), got ${got.slice(0, 10).join(", ")}${got.length > 10 ? " …" : ""}`);
    }
    if (touched("spike") && props.spike !== undefined) {
      onScreen.checked++;
      if (props.spike === peakIndex(pack.stats)) onScreen.matched++;
      else push(`${where}: MetricChart spike must mark the busiest day (index ${peakIndex(pack.stats)}, ${daily[peakIndex(pack.stats)].weekday}), got ${String(props.spike)}`);
    }
    if (touched("window") && props.window !== undefined) push(`${where}: MetricChart window band: the data pack has no incident window — drop it`);
    if (touched("threshold") && typeof props.threshold === "number") num("MetricChart threshold", normNumber(String(props.threshold)));
    if (touched("xLabels") && Array.isArray(props.xLabels) && props.xLabels.length) {
      const labels = (props.xLabels as unknown[]).map(String);
      const k = labels.length;
      const n = daily.length;
      if (k < 2 || (n - 1) % (k - 1) !== 0) push(`${where}: MetricChart xLabels: ${k} label(s) cannot sit on the 7 days (use 2, 3 or 4: they spread evenly from the first to the last point)`);
      else
        labels.forEach((lab, j) => {
          const d = daily[(j * (n - 1)) / (k - 1)];
          const w3 = d.weekday.slice(0, 3);
          const okForms = new Set([w3, d.weekday, String(d.day), `${w3} ${d.day}`, `${d.day} ${d.month.slice(0, 3)}`].map((x) => x.toLowerCase()));
          if (!okForms.has(lab.trim().toLowerCase())) push(`${where}: MetricChart xLabels[${j}] "${lab}" sits on ${d.weekday} ${d.day} ${d.month}: label it "${w3}", "${d.day}" or "${w3} ${d.day}"`);
        });
    }
  }

  if (component === "Terminal" && touched("lines") && Array.isArray(props.lines)) {
    const want = pack.terminalLines;
    const got = (props.lines as unknown[]).map((l) => (l && typeof l === "object" ? String((l as { text?: unknown }).text ?? "") : String(l)));
    let at = 0;
    got.forEach((t, j) => {
      onScreen.checked++;
      const k = want.indexOf(t, at);
      if (k < 0) {
        push(`${where}: Terminal line ${j + 1} is not one of the pack's terminal lines${want.includes(t) ? " (out of order or repeated)" : ""} — a Terminal shows only the pack's lines, exactly, in pack order`);
        return;
      }
      onScreen.matched++;
      at = k + 1;
    });
  }
}

// ── DP-LEAK ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** RFC 2606 / 6761 example names (BrowserWindow's only allowed hosts): they excuse the generic `domain` id only.
 *  Every other deny pattern (IPs, LAN / Tailscale, the domain stem, the zone, keys) runs on the UNSTRIPPED text, so a
 *  leak dressed up as an example host ("<ip>.example", "api-gateway.example.com", "<zone>.test") is still caught. */
const EXAMPLE_HOST_RE = /\b(?:[a-z0-9-]+\.)*example(?:\.(?:com|org|net))?\b|\b[a-z0-9-]+\.(?:example|test)\b/gi;

/** Letters-only words (camelCase names such as "BleepingComputer") are words, not secrets: the entropy check counts a
 *  token only when it carries a digit or a symbol. They are folded to lower case for the scan (every other deny
 *  pattern is case-insensitive or needs digits; "AKIA…" tokens are kept as they are). */
const foldLetterWords = (t: string): string => t.replace(/\b[A-Za-z]{12,}\b/g, (w) => (/^AKIA/.test(w) ? w : w.toLowerCase()));

/** DP-LEAK: the pack's deny set over each text. Findings carry the deny ids only, never the matched text. */
export function lintDataLeak(texts: ReadonlyArray<string | LabeledText>): DataLintFinding[] {
  const out: DataLintFinding[] = [];
  texts.forEach((x, k) => {
    const t: LabeledText = typeof x === "string" ? { where: `text[${k}]`, text: x } : x;
    const raw = foldLetterWords(String(t.text ?? ""));
    let ids = denyHits(raw);
    if (ids.includes("domain") && !denyHits(raw.replace(EXAMPLE_HOST_RE, " ")).includes("domain")) ids = ids.filter((id) => id !== "domain");
    if (ids.length) out.push({ code: "DP-LEAK", where: t.where, ...(t.line ? { line: t.line } : {}), ...(t.beatId ? { beatId: t.beatId } : {}), message: `${t.where}: matches the public deny set (${ids.join(", ")}) — no IP addresses, domains, e-mail addresses, keys or credential-like strings anywhere in a data reel` });
  });
  return out;
}

/** The deny ids the lint knows (for the card / tests). */
export const DATA_LEAK_IDS: readonly string[] = [...DENY_RES.map((d) => d.id), "entropy"];

// ── DP-GEO ──────────────────────────────────────────────────────────────────────────────────────────────────────

const COMMON_COUNTRIES = [
  "China", "Russia", "Russian Federation", "United States", "America", "Iran", "North Korea", "South Korea", "Korea", "Germany", "Netherlands", "France",
  "United Kingdom", "Britain", "Brazil", "India", "Vietnam", "Singapore", "Hong Kong", "Japan", "Ukraine", "Romania", "Bulgaria", "Turkey", "Indonesia",
  "Canada", "Switzerland", "Israel", "Pakistan", "Nigeria", "Taiwan", "Thailand", "Poland", "Italy", "Spain", "Sweden", "Finland", "Ireland", "Australia",
];
const DEMONYMS = [
  "Chinese", "Russian", "American", "Iranian", "North Korean", "Korean", "German", "Dutch", "French", "British", "Brazilian", "Indian", "Vietnamese",
  "Ukrainian", "Romanian", "Bulgarian", "Turkish", "Indonesian", "Japanese", "Singaporean", "Israeli", "Pakistani", "Nigerian", "Taiwanese", "Polish",
];
const ACTORS = "attackers?|hackers?|criminals?|cybercriminals?|scammers?|gangs?|groups?|actors?|spies|spy|people|operators?";
const SCOPE_WORDS = /\b(?:host(?:ed|ing|s)?|rent(?:ed|s)?|server|servers|cloud|data ?cent(?:er|re)s?|hosting)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** DP-GEO: country attribution stays a hosting location (F12 caveat). */
export function lintDataScope(texts: ReadonlyArray<string | LabeledText>, pack?: Pick<DataPackV1T, "stats"> | null): DataLintFinding[] {
  const countries = [...new Set([...(pack?.stats.countries.map((c) => c.country) ?? []), ...(pack?.stats.bursts.map((b) => b.country) ?? []), ...COMMON_COUNTRIES])].sort((a, b) => b.length - a.length);
  const cRe = new RegExp(`\\b(?:the\\s+)?(${countries.map(esc).join("|")})\\b`);
  const actorFrom = new RegExp(`\\b(?:${ACTORS})\\s+(?:from|in|based in|out of|inside)\\s+(?:the\\s+)?(?:${countries.map(esc).join("|")})\\b`, "i");
  const demonymActor = new RegExp(`\\b(?:${DEMONYMS.map(esc).join("|")})\\s+(?:state\\s+)?(?:${ACTORS}|bots?)\\b`, "i");
  const out: DataLintFinding[] = [];
  texts.forEach((x, k) => {
    const t: LabeledText = typeof x === "string" ? { where: `text[${k}]`, text: x } : x;
    const s = String(t.text ?? "");
    const base = { code: "DP-GEO" as const, where: t.where, ...(t.line ? { line: t.line } : {}), ...(t.beatId ? { beatId: t.beatId } : {}) };
    if (actorFrom.test(s) || demonymActor.test(s)) out.push({ ...base, message: `${t.where}: attributes the traffic to people of a country — the pack only knows where a server is hosted, not who runs it (say "a server hosted in …")` });
    else if (cRe.test(s) && !SCOPE_WORDS.test(s)) out.push({ ...base, message: `${t.where}: names a country without saying it is where the server is hosted ("hosted in", "a server rented in …") — countries are hosting locations, not who is behind it` });
  });
  return out;
}

// ── text collection ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every public-facing string of a narrative: line text, shot intents (note / overlay / keyframe), title, point,
 *  caption extras, terms and names (structural keys skipped). */
export function narrativeDataTexts(n: NarrativeLike): LabeledText[] {
  const out: LabeledText[] = [];
  for (const s of stringsIn(n)) {
    if (isStructuralPath(s.path) || /^(?:version|slug|voice|track|series|scope|hookPattern)$/.test(s.path)) continue;
    const m = /^lines\[(\d+)\]/.exec(s.path);
    const line = m ? n.lines[Number(m[1])]?.id : undefined;
    out.push({ where: line ? `${line} ${s.path.replace(/^lines\[\d+\]\.?/, "") || "text"}` : s.path, text: s.value, ...(line ? { line } : {}) });
  }
  return out;
}

/** Every string of a storyboard a viewer can read or that carries free text (structural ids / enums / hashes skipped). */
export function boardDataTexts(sb: BoardLike): LabeledText[] {
  const out: LabeledText[] = [];
  for (const s of stringsIn(sb)) {
    if (isStructuralPath(s.path)) continue;
    const m = /^beats\[(\d+)\]/.exec(s.path);
    const beatId = m ? sb.beats[Number(m[1])]?.id : undefined;
    out.push({ where: beatId ? `${beatId} ${s.path.replace(/^beats\[\d+\]\.?/, "")}` : s.path, text: s.value, ...(beatId ? { beatId } : {}) });
  }
  return out;
}

/** Narration lines for DP-GEO (spoken text + on-screen quoted shot words). */
export function spokenAndShownTexts(lines: ReadonlyArray<{ id: string; text: string; shot?: { note?: string; overlay?: string; keyframe?: string } | null }>): LabeledText[] {
  return lines.flatMap((l) => [{ where: l.id, line: l.id, text: l.text }, ...[l.shot?.note, l.shot?.overlay, l.shot?.keyframe].flatMap(quotedOnScreen).map((q) => ({ where: `${l.id} shot`, line: l.id, text: q }))]);
}

/** Every data lint over a narrative (and optionally its board): the one entry point the tools call. */
export interface NarrativeLike {
  lines: ReadonlyArray<{ id: string; text: string; shot?: { note?: string; overlay?: string; keyframe?: string } | null }>;
  [k: string]: unknown;
}

export interface DataJobReport extends DataNumbersReport {
  leak: DataLintFinding[];
  geo: DataLintFinding[];
  /** every finding (DP-NUM, DP-LEAK, DP-GEO), in that order */
  all: DataLintFinding[];
}

export function lintDataJob(a: { pack: DataPackV1T; narrative?: NarrativeLike | null; storyboard?: BoardLike | null; extraTexts?: readonly LabeledText[] }): DataJobReport {
  const num = lintDataNumbers({ pack: a.pack, ...(a.narrative ? { lines: a.narrative.lines } : {}), ...(a.storyboard ? { storyboard: a.storyboard } : {}) });
  const texts: LabeledText[] = [...(a.narrative ? narrativeDataTexts(a.narrative) : []), ...(a.storyboard ? boardDataTexts(a.storyboard) : []), ...(a.extraTexts ?? [])];
  const leak = lintDataLeak(texts);
  // DP-GEO reads what the viewer hears and sees: the spoken lines + quoted on-screen words + board text, never crew notes
  // (the board's phrase / display / keyword are the spoken lines again: read once, from the narrative)
  const boardShown = a.storyboard ? boardDataTexts(a.storyboard).filter((t) => !/ (?:phrase|keyword|display(?:\[\d+\])?)$/.test(t.where)) : [];
  const geoTexts: LabeledText[] = [...(a.narrative?.lines ? spokenAndShownTexts(a.narrative.lines) : []), ...boardShown, ...(a.extraTexts ?? [])];
  const geo = lintDataScope(geoTexts, a.pack);
  return { ...num, leak, geo, all: [...num.findings, ...leak, ...geo] };
}
