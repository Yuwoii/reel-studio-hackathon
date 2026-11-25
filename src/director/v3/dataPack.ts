// DATA JOBS (honeypot-weekly plan): the director side of a job that carries an owner-measured data pack.
//
// A data job's folder holds `datapack.json` = the BYTE-EXACT pack.json of a pack the inbox watcher verified from the
// read-only pack mount (verifyPackDir). The director re-verifies it on every run (sha against the job's dataPack
// pointer when given, the strict DataPackV1 zod + deny scan, and verifyRendered: the sentences, lines and constants
// must be what the templates make of its stats), then (re)seeds the pack's facts.txt into the job's page store under
// the reserved URL HP_DATA_URL(week). That URL's host (*.reel-studio.invalid) can never be fetched (webfetch.ts refuses
// .invalid), so the only way a page under it exists is this seed.
//
// Trust path (all four, decided in code): host == HP_DATA_HOST (hostOf), the job has a verified pack, the page text is
// byte-identical to factsText(pack) (reservedSourceGaps), and web_fetch refuses .invalid. A job WITHOUT datapack.json
// behaves exactly as before (no tool, no prompt appendix, no lints); a reserved-host source in it is refused.

import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { factsText, HP_DATA_HOST, HP_DATA_URL, HP_SOURCE_ID, parsePack, sha256Hex, WEEKDAYS, type DataPackV1T, type FactT } from "../../data/honeypotPack.js";
import { normNumber, numbersIn } from "./numbers.js";
import { CATEGORY_PHRASE, peakIndex, verifyRendered } from "../../data/honeypotFacts.js";
import { hostOf, normUrl } from "../research.js";
import { loadPageText, savePageText } from "../v2/research.js";
import type { SourcesT } from "../../schema/script.v3.js";

/** The job-folder copy of the verified pack.json (byte-exact, so its sha256 is the pack's sha). */
export const DATAPACK_FILE = "datapack.json";
/** Reserved second-level domain: every host under it is first-party data, never a web page. */
export const RESERVED_DATA_DOMAIN = "reel-studio.invalid";

export interface LoadedDataPack {
  pack: DataPackV1T;
  sha256: string;
  /** factsText(pack): the exact page text seeded under `url`. */
  facts: string;
  url: string;
}

export type DataPackErrorCode = "HP_MISSING" | "HP_SHA" | "HP_SCHEMA" | "HP_LEAK";
export class DataPackError extends Error {
  constructor(
    readonly code: DataPackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataPackError";
  }
}

/** Is this URL on the reserved data domain (any host under *.reel-studio.invalid)? */
export function isReservedDataUrl(url: string): boolean {
  const h = hostOf(url).toLowerCase().replace(/\.$/, "");
  return h === RESERVED_DATA_DOMAIN || h.endsWith(`.${RESERVED_DATA_DOMAIN}`);
}

/** Is this the owner-measured data host (the only reserved host a source may cite)? */
export const isOwnerDataUrl = (url: string): boolean => hostOf(url).toLowerCase() === HP_DATA_HOST;

/** Does a source sheet cite the owner's measured data (code-decided by host; the factcheck / physics scope flag)? */
export const hasOwnerData = (s: Pick<SourcesT, "sources"> | null | undefined): boolean => !!s?.sources.some((x) => isOwnerDataUrl(x.url));

/**
 * The job's verified data pack, or null for a normal job (no datapack.json). FAIL CLOSED: a datapack.json that is
 * present but wrong (sha ≠ the job's pointer, schema, deny scan, re-render mismatch) throws — the job never runs on it.
 * `expectSha` (the job's dataPack.sha256) makes a missing file an error too.
 */
export async function loadJobDataPack(jobDir: string, expectSha?: string): Promise<LoadedDataPack | null> {
  let buf: Buffer;
  try {
    buf = await readFile(path.join(jobDir, DATAPACK_FILE));
  } catch {
    if (expectSha) throw new DataPackError("HP_MISSING", `${DATAPACK_FILE} is missing for a data job`);
    return null;
  }
  const sha = sha256Hex(buf);
  if (expectSha !== undefined && expectSha !== sha) throw new DataPackError("HP_SHA", `${DATAPACK_FILE} does not match the job's pack sha`);
  const p = parsePack(buf.toString("utf8"));
  if (!p.ok) throw new DataPackError(p.code, `${DATAPACK_FILE}: ${p.detail}`);
  const problems = verifyRendered(p.pack);
  if (problems.length) throw new DataPackError("HP_SCHEMA", `${DATAPACK_FILE} is inconsistent: ${problems.slice(0, 4).join("; ")}`);
  return { pack: p.pack, sha256: sha, facts: factsText(p.pack), url: HP_DATA_URL(p.pack.weekKey) };
}

/** Write the verified pack.json bytes into the job folder (mode 600, atomic). For the inbox watcher / dry runs. */
export async function writeJobDataPack(jobDir: string, packJson: string | Buffer): Promise<void> {
  await mkdir(jobDir, { recursive: true });
  const file = path.join(jobDir, DATAPACK_FILE);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, packJson, { mode: 0o600 });
  await rename(tmp, file);
}

/** (Re)seed the pack's facts.txt into the job's page store under the reserved URL (idempotent; overwrites a tamper). */
export async function seedDataPackPage(jobDir: string, dp: LoadedDataPack): Promise<void> {
  await savePageText(jobDir, [dp.url], dp.facts);
}

/**
 * RESERVED-HOST GUARD (submit_script, before the page check): a source on *.reel-studio.invalid is refused unless the
 * job has a verified pack, the source is exactly that pack's URL, and the stored page is byte-identical to the pack's
 * facts (sha). A normal job never has such a source accepted.
 */
export async function reservedSourceGaps(jobDir: string, s: Pick<SourcesT, "sources">, dp: LoadedDataPack | undefined): Promise<string[]> {
  const out: string[] = [];
  for (const src of s.sources) {
    if (!isReservedDataUrl(src.url)) continue;
    if (!dp) {
      out.push(`${src.id}: ${src.url} is a reserved data address; only a data job's own pack can be cited there — drop the source`);
      continue;
    }
    if (normUrl(src.url) !== normUrl(dp.url)) {
      out.push(`${src.id}: ${src.url} is not this job's data pack (${dp.url}) — cite the pack exactly as read_data_pack returns it`);
      continue;
    }
    const page = await loadPageText(jobDir, src.url);
    if (page === null || sha256Hex(page) !== sha256Hex(dp.facts)) out.push(`${src.id}: the stored data page does not match the verified pack (sha) — the job's pack is refused`);
  }
  return out;
}

/** The owner source's code-fixed header fields (title, date, context): what read_data_pack hands the director and
 *  what the fact checker sees, whatever the director wrote. */
export function ownerSourceMeta(dp: LoadedDataPack): { title: string; date: string; context: string[] } {
  const p = dp.pack;
  return { title: `Honeypot weekly data pack ${p.label}`, date: p.stats.daily[6].date, context: ["Owner-measured counts from the honeypot's own request log for the stated dates."] };
}

/**
 * CANONICAL OWNER SOURCE (submit_script, after reservedSourceGaps passed): the owner source's title, date and context are
 * free text the director writes, and the fact checker trusts that source (FIRST_PARTY_DATA_RULE). Code overwrites them
 * with ownerSourceMeta(dp), so nothing the director wrote rides on the trust marker — only the quotes stay theirs, and
 * those must be verbatim on the sha-pinned page. Only the source on THIS job's pack URL is touched.
 */
export function canonicalOwnerSource(s: SourcesT, dp: LoadedDataPack): SourcesT {
  if (!s.sources.some((x) => normUrl(x.url) === normUrl(dp.url))) return s;
  const meta = ownerSourceMeta(dp);
  return { ...s, sources: s.sources.map((x) => (normUrl(x.url) === normUrl(dp.url) ? { ...x, url: dp.url, ...meta } : x)) };
}

/** Words in a line or its shot that mean the picture shows the week day by day (the MetricChart of the daily counts). */
const DAILY_PICTURE_RE = /\b(?:chart|graph|daily|per day|each day|every day|day by day|spike|busiest day)\b/i;

/**
 * CITED-FACT COMPLETION (submit_script, after reservedSourceGaps passed): the director picks ≤ 20 pack sentences as the
 * owner source's quotes, and the fact checker sees only those. Dry run hp-2026-w46 (2026-11-17): a line planned a
 * chart of the 7 daily counts "with the spike on Friday" but the daily-counts fact was not cited, so the claims
 * extractor's behaviour-drawn claim came back UNSUPPORTED and a judge round was lost. The pack's sentences are the
 * verified page (sha), so code adds — never removes or edits — the ones the script relies on: the "about this
 * honeypot" sentence (F00, the hook-object fact), every fact holding a number the script says or quotes on screen
 * (date numbers / constants excluded), every fact naming a weekday the script names, and the daily-counts fact when a
 * line or shot shows the week day by day. Director picks keep their order and come first; the total stays ≤ 20.
 * Only the source on THIS job's pack URL is touched; any other source (and a normal job) is returned unchanged.
 */
export function completeOwnerQuotes(
  s: SourcesT,
  lines: ReadonlyArray<{ text: string; shot?: { note?: string; overlay?: string; keyframe?: string } | null }>,
  dp: LoadedDataPack,
): { sources: SourcesT; added: string[] } {
  const i = s.sources.findIndex((x) => normUrl(x.url) === normUrl(dp.url));
  if (i < 0) return { sources: s, added: [] };
  const texts = lines.flatMap((l) => [l.text, l.shot?.note, l.shot?.overlay, l.shot?.keyframe].filter((t): t is string => typeof t === "string"));
  const all = texts.join("\n");
  const skip = new Set(dp.pack.constants);
  const said = new Set(texts.flatMap(numbersIn).map(normNumber).filter((x) => !skip.has(x)));
  const days = WEEKDAYS.filter((d) => new RegExp(`\\b${d}\\b`, "i").test(all));
  const daily = dp.pack.facts.find((f) => WEEKDAYS.every((d) => f.text.includes(d)));
  const want = (f: FactT): boolean =>
    f.id === "F00" ||
    (DAILY_PICTURE_RE.test(all) && f === daily) ||
    numbersIn(f.text).map(normNumber).some((x) => said.has(x)) ||
    days.some((d) => f.text.includes(d));
  const src = s.sources[i];
  const have = new Set(src.quotes);
  const room = Math.max(0, 20 - src.quotes.length);
  const ordered = [dp.pack.facts.find((f) => f.id === "F00"), daily, ...dp.pack.facts].filter((f): f is FactT => !!f);
  const added = [...new Set(ordered.filter(want).map((f) => f.text))].filter((t) => !have.has(t)).slice(0, room);
  if (!added.length) return { sources: s, added };
  const sources = { ...s, sources: s.sources.map((x, k) => (k === i ? { ...x, quotes: [...x.quotes, ...added] } : x)) };
  return { sources, added };
}

/** The fixed owner-prompt template of a weekly honeypot job (untrusted wrapping still applies: it goes in <reel_prompt>). */
export function hpDraftPrompt(p: Pick<DataPackV1T, "dateText" | "topic">): string {
  return `Weekly honeypot reel for ${p.dateText}: what my honeypot saw that week. The week's leading scan: ${CATEGORY_PHRASE[p.topic]}. Explain how those scans work and how a site defends against them. Every number comes from the data pack (read_data_pack).`;
}

/** The read_data_pack payload: the ready ClaimSource, the facts, the on-screen bindings. Never the raw stats, the
 *  caption or the internal-hits count (card only). */
export function dataPackToolView(dp: LoadedDataPack): Record<string, unknown> {
  const p = dp.pack;
  const factById = new Map(p.facts.map((f) => [f.id, f.text]));
  const day0 = p.stats.daily[0];
  const pk = peakIndex(p.stats);
  return {
    source: (({ title, date, context }) => ({
      id: HP_SOURCE_ID,
      url: dp.url,
      title,
      date,
      quotes: "pick ≤ 20 of facts[].text below, each copied EXACTLY (they are verbatim on the page); never edit a sentence",
      context,
    }))(ownerSourceMeta(dp)),
    facts: p.facts,
    topic: p.topic,
    codename: p.codename,
    dateText: p.dateText,
    stories: p.stories.map((s) => ({ type: s.type, facts: s.factIds.map((id) => ({ id, text: factById.get(id) })) })),
    onScreen: {
      allowedNumbers: p.numberSet,
      constants: p.constants,
      terminalLines: p.terminalLines,
      metricChart: {
        values: p.stats.daily.map((d) => d.hits),
        days: p.stats.daily.map((d) => `${d.weekday.slice(0, 3)} ${d.day}`),
        peakIndex: pk,
        xLabelsRule: `0, 2, 3 or 4 labels (indices spread evenly over the 7 points: 2 → 0,6; 3 → 0,3,6; 4 → 0,2,4,6), each the day's weekday ("${day0.weekday.slice(0, 3)}"), its day of the month ("${day0.day}") or both ("${day0.weekday.slice(0, 3)} ${day0.day}")`,
      },
    },
    rules:
      "DP-NUM: every number you SAY or SHOW must be in onScreen.allowedNumbers, copied as the facts write it (no sums, roundings, shares or comparisons of your own); weekday/month words only as the facts use them (a line with a weekday and a number needs ONE fact holding both). HeroStat value / Meter percentage / MetricChart threshold ∈ allowedNumbers; a MetricChart's values = metricChart.values in that order, spike = peakIndex; a Terminal shows only terminalLines, in order. DP-LEAK: never an IP address, domain, e-mail, key-like string or credential. Countries are where a server is hosted: never 'attackers from <country>'.",
  };
}
