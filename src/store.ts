// Persistent bot state: the job records (DATA_DIR/state.json) and usage counters (DATA_DIR/usage.json).
// Both are written atomically (tmp + rename) through one serialised write chain, like homelab-agent's Store.
//
// Status changes go through transition(): the legality check and the in-memory set are SYNCHRONOUS, so two button
// presses racing on the same job can't both pass (the second sees the new status). Persisting happens afterwards.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { JobDataPack } from "./data/honeypotPack.js";

export const JOB_STATUSES = [
  "queued",
  "drafting",
  "awaiting_approval",
  "awaiting_feedback",
  "revising",
  "rendering",
  "done",
  "sending",
  "sent",
  "discarded",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** What a queued job will do when it reaches the front of the queue. */
export type JobOp = "draft" | "revise" | "render";

/** Statuses that hold the single worker slot. */
export const ACTIVE_STATUSES: readonly JobStatus[] = ["drafting", "revising", "rendering"];
/** In-flight statuses that a restart interrupts (never auto-resumed). */
export const INTERRUPTIBLE_STATUSES: readonly JobStatus[] = ["drafting", "revising", "rendering", "sending"];
export const TERMINAL_STATUSES: readonly JobStatus[] = ["sent", "discarded"];

/**
 * Legal transitions. failed/cancelled are not quite terminal: a job that already has a script (slug) can be
 * re-rendered from them (🔁 on the failure notice) — the bot enforces the "has a script" part.
 */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["drafting", "revising", "rendering", "cancelled", "discarded", "failed"],
  drafting: ["awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["awaiting_feedback", "queued", "rendering", "discarded", "failed"],
  awaiting_feedback: ["queued", "revising", "discarded", "failed"],
  revising: ["awaiting_approval", "failed", "cancelled"],
  rendering: ["done", "failed", "cancelled"],
  done: ["sending", "queued", "rendering", "discarded", "failed"],
  sending: ["sent", "done", "failed"],
  sent: [],
  discarded: [],
  failed: ["queued", "rendering", "discarded"],
  cancelled: ["queued", "rendering", "discarded"],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface JobHistoryEntry {
  at: string;
  status: JobStatus;
  note?: string;
}

export interface Job {
  jobId: string; // rs-<YYYYMMDD>-<6 hex>
  threadId: string;
  promptMessageId: string;
  prompt: string;
  status: JobStatus;
  /** Set while status === "queued": what runs when the job reaches the front. */
  queuedOp?: JobOp;
  /** Owner feedback waiting for a queued revise. */
  feedback?: string;
  slug?: string;
  title?: string;
  /**
   * The owner pressed ✅ on the CURRENT script and hasn't asked for edits since. Required for 🔁 from failed/cancelled,
   * so a job interrupted mid-revise (half-written script.json, never approved) can't be rendered without a fresh ✅.
   */
  approved?: boolean;
  /** Monotonic enqueue order (set on every → queued), so FIFO survives a restart. */
  queueSeq?: number;
  scriptCardMessageId?: string;
  statusMessageId?: string;
  /** The current result card (or failure notice with 🔁) — the only message whose send/rerender buttons are live. */
  resultMessageId?: string;
  /**
   * Honeypot-weekly data job (src/data/honeypotPack.ts): the sha-pinned pack this job was created from. Set only by
   * the inbox watcher; its presence enables read_data_pack, the reserved-host source and the DP-NUM / DP-LEAK lints.
   */
  dataPack?: JobDataPack;
  createdAt: string;
  updatedAt: string;
  error?: string;
  history: JobHistoryEntry[];
}

export interface Usage {
  day: string; // YYYY-MM-DD (UTC)
  jobsToday: number;
  month: string; // YYYY-MM (UTC)
  monthRenders: number;
  monthCostUsd: number;
  monthRenderSec: number;
}

export type TransitionResult = { ok: true; job: Job; persisted: Promise<void> } | { ok: false; reason: string; job?: Job };

/** Terminal jobs older than this are dropped from state.json on load. */
export const PRUNE_AFTER_MS = 30 * 24 * 3600_000;
const HISTORY_MAX = 50;

export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** Fail fast if a state dir is not writable (e.g. Docker created a missing bind-mount source as root). */
export async function assertWritableDir(dir: string): Promise<void> {
  const probe = path.join(dir, `.write-probe.${process.pid}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, "ok", { mode: 0o600 });
    await fs.rm(probe, { force: true });
  } catch (e) {
    throw new Error(`dir ${dir} is not writable by uid ${process.getuid?.() ?? "?"} (${(e as Error)?.message ?? e})`);
  }
}

export function newJobId(now = new Date()): string {
  return `rs-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex")}`;
}
export const JOB_ID_RE = /^rs-\d{8}-[0-9a-f]{6}$/;

export class Store {
  private jobs = new Map<string, Job>();
  private usage: Usage = { day: "", jobsToday: 0, month: "", monthRenders: 0, monthCostUsd: 0, monthRenderSec: 0 };
  private writing: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(
    readonly dir: string,
    private now: () => number = Date.now,
    private log: (s: string) => void = (s) => console.error(s),
  ) {}

  get stateFile(): string {
    return path.join(this.dir, "state.json");
  }
  get usageFile(): string {
    return path.join(this.dir, "usage.json");
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.stateFile, "utf8")) as { jobs?: Record<string, Job> };
      const cutoff = this.now() - PRUNE_AFTER_MS;
      for (const j of Object.values(raw.jobs ?? {})) {
        if (!j || typeof j.jobId !== "string" || !JOB_STATUSES.includes(j.status)) continue;
        const terminal = TERMINAL_STATUSES.includes(j.status) || j.status === "failed" || j.status === "cancelled";
        if (terminal && Date.parse(j.updatedAt) < cutoff) continue;
        this.jobs.set(j.jobId, { ...j, history: Array.isArray(j.history) ? j.history : [] });
        if (Number.isFinite(j.queueSeq)) this.seq = Math.max(this.seq, j.queueSeq as number);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") this.log(`[store] state.json unreadable, starting empty: ${(e as Error).message}`);
    }
    try {
      const u = JSON.parse(await fs.readFile(this.usageFile, "utf8")) as Partial<Usage>;
      this.usage = {
        day: String(u.day ?? ""),
        jobsToday: Number(u.jobsToday) || 0,
        month: String(u.month ?? ""),
        monthRenders: Number(u.monthRenders) || 0,
        monthCostUsd: Number(u.monthCostUsd) || 0,
        monthRenderSec: Number(u.monthRenderSec) || 0,
      };
    } catch {
      /* first run */
    }
  }

  /** Queue an atomic snapshot write of both files; resolves when this (and every earlier) write is done. */
  persist(): Promise<void> {
    const state = JSON.stringify({ version: 1, jobs: Object.fromEntries(this.jobs) }, null, 2);
    const usage = JSON.stringify(this.usage, null, 2);
    this.writing = this.writing
      .then(() => atomicWrite(this.stateFile, state))
      .then(() => atomicWrite(this.usageFile, usage))
      .catch((e) => this.log(`[store] write failed: ${(e as Error).message}`));
    return this.writing;
  }

  flush(): Promise<void> {
    return this.writing;
  }

  // ---- jobs

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  byThread(threadId: string): Job | undefined {
    for (const j of this.jobs.values()) if (j.threadId === threadId) return j;
    return undefined;
  }

  all(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  create(j: Pick<Job, "jobId" | "threadId" | "promptMessageId" | "prompt"> & Partial<Job>): { job: Job; persisted: Promise<void> } {
    if (this.jobs.has(j.jobId)) throw new Error(`job ${j.jobId} exists`);
    const at = this.iso();
    const job: Job = { status: "queued", queuedOp: "draft", ...j, createdAt: at, updatedAt: at, history: [{ at, status: j.status ?? "queued" }] };
    if (job.status === "queued") job.queueSeq = ++this.seq;
    this.jobs.set(job.jobId, job);
    return { job, persisted: this.persist() };
  }

  /** Synchronous check-and-set; `patch` is applied together with the status. */
  transition(jobId: string, to: JobStatus, patch: Partial<Omit<Job, "jobId" | "status" | "history">> = {}, note?: string): TransitionResult {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, reason: "unknown job" };
    if (!canTransition(job.status, to)) return { ok: false, reason: `illegal transition ${job.status} → ${to}`, job };
    const at = this.iso();
    Object.assign(job, patch, { status: to, updatedAt: at });
    if (to !== "queued") delete job.queuedOp;
    else job.queueSeq = ++this.seq;
    job.history.push({ at, status: to, ...(note ? { note } : {}) });
    if (job.history.length > HISTORY_MAX) job.history.splice(0, job.history.length - HISTORY_MAX);
    return { ok: true, job, persisted: this.persist() };
  }

  /** Jobs in status "queued", in the order they were enqueued (FIFO across restarts; legacy rows by createdAt). */
  queuedInOrder(): Job[] {
    return this.all()
      .filter((j) => j.status === "queued")
      .sort((a, b) => (a.queueSeq ?? 0) - (b.queueSeq ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }

  /** Non-status fields (message ids, slug…). */
  patch(jobId: string, patch: Partial<Omit<Job, "jobId" | "status" | "history">>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve();
    Object.assign(job, patch, { updatedAt: this.iso() });
    return this.persist();
  }

  // ---- usage (UTC day / month)

  private roll(): void {
    const iso = this.iso();
    const day = iso.slice(0, 10);
    const month = iso.slice(0, 7);
    if (this.usage.day !== day) this.usage = { ...this.usage, day, jobsToday: 0 };
    if (this.usage.month !== month) this.usage = { ...this.usage, month, monthRenders: 0, monthCostUsd: 0, monthRenderSec: 0 };
  }

  usageNow(): Usage {
    this.roll();
    return { ...this.usage };
  }

  /** Atomically check the daily budget and count one job. false = over budget (nothing counted). */
  tryCountJob(maxPerDay: number): boolean {
    this.roll();
    if (this.usage.jobsToday >= maxPerDay) return false;
    this.usage.jobsToday += 1;
    return true;
  }

  /** Give back a counted job (thread creation failed before the job existed). */
  uncountJob(): void {
    this.roll();
    this.usage.jobsToday = Math.max(0, this.usage.jobsToday - 1);
  }

  recordRender(costUsd: number | undefined, renderSec: number): Promise<void> {
    this.roll();
    this.usage.monthRenders += 1;
    this.usage.monthCostUsd += Number.isFinite(costUsd) ? (costUsd as number) : 0;
    this.usage.monthRenderSec += Number.isFinite(renderSec) ? renderSec : 0;
    return this.persist();
  }
}
