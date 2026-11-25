// v2 Lambda cost ledger (JSONL, one row per Lambda call — success or failure). Moved from scripts/v2/render-dev.ts
// (W3 P2); render-dev.ts re-exports spentFor / checkBudget. Every caller checks the budget BEFORE a call and books the
// row AFTER it, whatever the outcome.
//
// Caps (all enforced by checkBudget, reserve included):
//   tag     — per job / experiment (render-dev --budget, director per-job ceiling)
//   global  — the whole ledger, every tag (a new tag gets no fresh budget). A DEV-HARNESS cap only: render-dev keeps
//             its $2 default (--global-budget / REEL_V2_DEV_CAP_USD); elsewhere it is OFF unless REEL_V2_DEV_CAP_USD
//             is set (globalCapFromEnv → null), and the production render (src/pipeline/v2/render.ts) never applies it
//             (W7: the lifetime $2 had started to gate production renders).
//   monthly — calendar month (UTC) to date over the whole ledger (REEL_V2_MONTHLY_CAP_USD, legacy REEL_LAMBDA_MONTHLY_USD,
//             default $25 — W7 owner decision, was $10 in D1 #5)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./root.js";

export const DEFAULT_LEDGER = path.join(ROOT, "data", "v2-dev-ledger.jsonl");
/** Booked for a still whose cost Remotion never reported (call failed before returning an estimate). */
export const STILL_RESERVE_USD = 0.002;
/** Booked per frame for a media render whose cost never came back. */
export const MEDIA_RESERVE_USD_PER_F = 0.0001;
/** Orchestrator Lambda cost per wall second (3008 MB, eu-central-2; ADR-001 §8). */
export const ORCHESTRATOR_USD_PER_S = 0.0000435;
/** render-dev's hard stop over ALL tags (a new --tag does not get a fresh budget). Override: --global-budget or
 *  REEL_V2_DEV_CAP_USD. Dev harnesses only — never a production default (globalCapFromEnv). */
export const DEV_GLOBAL_CAP_USD = 2.0;
/** Lambda spend per calendar month (UTC), production and dev together. Override: REEL_V2_MONTHLY_CAP_USD (W7: $25,
 *  owner 2026-10-27; was $10 in D1 #5). */
export const MONTHLY_CAP_USD = 25;
/** Monthly cap env names, first set wins (REEL_LAMBDA_MONTHLY_USD is the pre-W7 name, still honoured). */
export const MONTHLY_CAP_ENV = ["REEL_V2_MONTHLY_CAP_USD", "REEL_LAMBDA_MONTHLY_USD"] as const;

export interface LedgerRow {
  ts: string;
  tag: string;
  kind: "still" | "media";
  site: string;
  composition: string;
  frames: number[] | [number, number];
  estimatedPriceUsd: number;
  orchestratorUsd: number;
  totalUsd: number;
  wallSec: number;
  renderSec?: number;
  lambdasInvoked?: number;
  framesPerLambda?: number;
  retries?: number;
  /** L18 model (φ = 1) for this range's chunk layout: slowest chunk and sum, seconds. */
  predicted?: { chunkMaxSec: number; sumSec: number; maxSamples: number };
  out: string | null;
  props: { sb: string; words: string | null; blur: boolean; debug: boolean; cover?: boolean };
  /** absent = ok (older rows). */
  status?: "ok" | "failed";
  /** how the failed row's cost was obtained */
  costSource?: "accruedSoFar" | "reserve";
  error?: string;
}

export function readLedger(file = DEFAULT_LEDGER): LedgerRow[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerRow);
}

export function book(row: LedgerRow, file = DEFAULT_LEDGER): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(row) + "\n");
}

export function spentFor(tag: string | null, rows: readonly Pick<LedgerRow, "tag" | "totalUsd">[] = readLedger()): number {
  return rows.filter((r) => tag === null || r.tag === tag).reduce((s, r) => s + (r.totalUsd ?? 0), 0);
}

/**
 * Spend in the calendar month (UTC) of `now`, over all tags. A row whose ts does not parse counts as this month
 * (fail closed: an undatable row must not slip out of the monthly cap).
 */
export function monthToDateUsd(rows: readonly { ts?: string; totalUsd: number }[], now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let s = 0;
  for (const r of rows) {
    const t = r.ts ? new Date(r.ts) : null;
    const dated = t && Number.isFinite(t.getTime());
    if (!dated || (t.getUTCFullYear() === y && t.getUTCMonth() === m)) s += r.totalUsd ?? 0;
  }
  return s;
}

/** REEL_V2_MONTHLY_CAP_USD, else REEL_LAMBDA_MONTHLY_USD, else $25. An unparsable value throws instead of meaning "no cap". */
export function monthlyCapFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  for (const name of MONTHLY_CAP_ENV) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const v = Number(raw);
    if (!(Number.isFinite(v) && v >= 0)) throw new Error(`budget: invalid ${name} ${JSON.stringify(raw)}`);
    return v;
  }
  return MONTHLY_CAP_USD;
}

export interface BudgetOptions {
  /** Monthly cap in USD (default: monthlyCapFromEnv()). */
  monthlyCap?: number;
  /** Clock for the month-to-date window (tests). */
  now?: Date;
}

/**
 * Throws unless the tag, the whole ledger and the month to date all stay under their caps with `reserve` added.
 * `globalBudget` null = no whole-ledger cap (production; W7). A number must be finite and ≥ 0 (a typo never means "off").
 * The error messages start with "budget:" (the bot's card shows them as a budget refusal; nothing was spent).
 */
export function checkBudget(tag: string, budget: number, globalBudget: number | null, reserve: number, rows: readonly LedgerRow[] = readLedger(), opts: BudgetOptions = {}): string {
  if (!(Number.isFinite(budget) && budget >= 0)) throw new Error(`budget: invalid tag cap ${String(budget)}`);
  if (globalBudget !== null && !(Number.isFinite(globalBudget) && globalBudget >= 0)) throw new Error(`budget: invalid global cap ${String(globalBudget)}`);
  const monthly = opts.monthlyCap ?? monthlyCapFromEnv();
  if (!(Number.isFinite(monthly) && monthly >= 0)) throw new Error(`budget: invalid monthly cap ${String(monthly)}`);
  if (!(Number.isFinite(reserve) && reserve >= 0)) throw new Error(`budget: invalid reserve ${String(reserve)}`);
  const s = spentFor(tag, rows);
  const all = spentFor(null, rows);
  const mtd = monthToDateUsd(rows, opts.now ?? new Date());
  if (s + reserve > budget) throw new Error(`budget: tag "${tag}" has spent $${s.toFixed(4)}; +$${reserve.toFixed(4)} reserve would pass the $${budget.toFixed(2)} cap`);
  if (globalBudget !== null && all + reserve > globalBudget) throw new Error(`budget: the dev ledger has spent $${all.toFixed(4)} over all tags; +$${reserve.toFixed(4)} reserve would pass the global $${globalBudget.toFixed(2)} cap`);
  if (mtd + reserve > monthly) throw new Error(`budget: $${mtd.toFixed(4)} spent this month; +$${reserve.toFixed(4)} reserve would pass the monthly $${monthly.toFixed(2)} cap (REEL_V2_MONTHLY_CAP_USD)`);
  return `ledger: tag "${tag}" spent $${s.toFixed(4)} of $${budget.toFixed(2)}; all tags $${all.toFixed(4)}${globalBudget === null ? " (no lifetime cap)" : ` of $${globalBudget.toFixed(2)}`}; month $${mtd.toFixed(4)} of $${monthly.toFixed(2)}`;
}

/** Global (whole-ledger) cap outside render-dev: REEL_V2_DEV_CAP_USD when set (NaN on a typo, which checkBudget then
 *  refuses), else null = off (W7: a lifetime dev cap must not gate production). render-dev keeps DEV_GLOBAL_CAP_USD. */
export function globalCapFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.REEL_V2_DEV_CAP_USD;
  return raw === undefined || raw.trim() === "" ? null : Number(raw);
}
