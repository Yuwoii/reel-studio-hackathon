// Per-job director state (<jobDir>/director.json): the SDK session id (revise/selfCheck resume it), the shared turn
// budget, cost, and a short run history. Written atomically (tmp + rename) after every run, success or not.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export type DirectorPhase = "draft" | "revise" | "selfcheck";

export interface DirectorRun {
  phase: DirectorPhase;
  at: string;
  turns: number;
  costUsd: number;
  subtype: string;
  saved: boolean;
  failedSaves: number;
}

export interface DirectorState {
  v: 1;
  sessionId?: string;
  model?: string;
  /** Turns used by ALL runs of this job (draft + revisions + self-checks) — the REEL_MAX_TURNS_PER_JOB budget. */
  turnsUsed: number;
  costUsd: number;
  saves: number;
  lastSavedAt?: string;
  runs: DirectorRun[];
}

export function emptyState(): DirectorState {
  return { v: 1, turnsUsed: 0, costUsd: 0, saves: 0, runs: [] };
}

/** <jobsDir>/<jobId>, refusing ids that could escape jobsDir. */
export function jobDirFor(jobsDir: string, jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) throw new Error(`invalid job id ${JSON.stringify(jobId).slice(0, 90)}`);
  const root = path.resolve(jobsDir);
  const dir = path.resolve(root, jobId);
  if (path.dirname(dir) !== root) throw new Error("job dir escapes JOBS_DIR");
  return dir;
}

export async function atomicWrite(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, data, { mode: 0o644 });
  await rename(tmp, file);
}

export async function loadState(jobDir: string): Promise<DirectorState> {
  try {
    const s = JSON.parse(await readFile(path.join(jobDir, "director.json"), "utf8")) as Partial<DirectorState>;
    if (s.v !== 1) return emptyState();
    return { ...emptyState(), ...s, runs: Array.isArray(s.runs) ? s.runs : [] };
  } catch {
    return emptyState();
  }
}

export async function saveState(jobDir: string, s: DirectorState): Promise<void> {
  await atomicWrite(path.join(jobDir, "director.json"), JSON.stringify(s, null, 2) + "\n");
}

/** Turns still available for this job (never negative). */
export function remainingTurns(s: DirectorState, budget: number): number {
  return Math.max(0, budget - s.turnsUsed);
}

/** Book one finished SDK run against the job: turns + cost accumulate, the run is appended (history capped). */
export function recordRun(s: DirectorState, run: DirectorRun, sessionId?: string): DirectorState {
  return {
    ...s,
    sessionId: sessionId ?? s.sessionId,
    turnsUsed: s.turnsUsed + Math.max(0, run.turns),
    costUsd: Math.round((s.costUsd + Math.max(0, run.costUsd)) * 1e6) / 1e6,
    saves: s.saves + (run.saved ? 1 : 0),
    runs: [...s.runs, run].slice(-20),
  };
}
