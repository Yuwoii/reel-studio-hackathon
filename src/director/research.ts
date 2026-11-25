// Research ledger + gate. The prompt asks for proper research, but a prompt alone produced one search and a vendor
// blog — so save_script enforces a floor for FACTUAL scripts (any sources or facts): enough searches, enough pages
// actually read from more than one site, every cited source one of those pages, and a real fact sheet. The ledger is
// per job (<jobDir>/research.json) so a revision can build on the draft's research.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Script } from "../schema/index.js";
import { atomicWrite } from "./state.js";

export const RESEARCH_MIN = { searches: 3, pages: 3, sites: 2, facts: 4 } as const;
/** After this many gate rejections the script is accepted anyway (paywalled/obscure topics) with a warning note. */
export const MAX_GATE_REJECTIONS = 2;

export interface ResearchLedger {
  searches: number;
  /** Normalised URLs of pages web_fetch actually returned (requested + final URL after redirects). */
  fetched: string[];
}

const FILE = "research.json";

export function emptyLedger(): ResearchLedger {
  return { searches: 0, fetched: [] };
}

/** Lowercase host, no fragment, no trailing slash, no "www." — so a cited source matches the page that was read. */
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    const p = x.pathname.replace(/\/+$/, "");
    return `${host}${p}${x.search}`;
  } catch {
    return u.trim();
  }
}

export function hostOf(u: string): string {
  return normUrl(u).split("/")[0];
}

export function recordFetch(l: ResearchLedger, ...urls: string[]): void {
  for (const u of urls) {
    const n = normUrl(u);
    if (n && !l.fetched.includes(n)) l.fetched.push(n);
  }
}

export async function loadLedger(jobDir: string): Promise<ResearchLedger> {
  try {
    const o = JSON.parse(await readFile(path.join(jobDir, FILE), "utf8")) as Partial<ResearchLedger>;
    return { searches: Number(o.searches) || 0, fetched: Array.isArray(o.fetched) ? o.fetched.filter((x) => typeof x === "string") : [] };
  } catch {
    return emptyLedger();
  }
}

export async function saveLedger(jobDir: string, l: ResearchLedger): Promise<void> {
  await atomicWrite(path.join(jobDir, FILE), JSON.stringify(l, null, 2) + "\n");
}

/** A script that cites anything is treated as factual and must meet the research floor. Fiction cites nothing. */
export function isFactual(script: Pick<Script, "sources" | "facts">): boolean {
  return script.sources.length > 0 || script.facts.length > 0;
}

/** Shortfalls (empty = passes). Only meaningful for factual scripts. */
export function researchGaps(script: Pick<Script, "sources" | "facts">, l: ResearchLedger): string[] {
  const gaps: string[] = [];
  const sites = new Set(l.fetched.map((u) => u.split("/")[0]));
  if (l.searches < RESEARCH_MIN.searches) gaps.push(`only ${l.searches} web search(es) — run at least ${RESEARCH_MIN.searches} from different angles`);
  if (l.fetched.length < RESEARCH_MIN.pages) gaps.push(`only ${l.fetched.length} page(s) read with web_fetch — read at least ${RESEARCH_MIN.pages}`);
  if (sites.size < RESEARCH_MIN.sites) gaps.push(`pages from only ${sites.size} site(s) — use at least ${RESEARCH_MIN.sites} independent sites`);
  const unread = script.sources.filter((s) => !l.fetched.includes(normUrl(s.url)));
  if (unread.length) gaps.push(`sources you did not read with web_fetch (read them or drop them): ${unread.map((s) => s.url).join(", ")}`);
  if (script.facts.length < RESEARCH_MIN.facts) gaps.push(`fact sheet has ${script.facts.length} claim(s) — list every concrete claim the narration makes (at least ${RESEARCH_MIN.facts})`);
  return gaps;
}
