// Review stills of a v2 storyboard on the DEV Lambda site (W3 P2; moved from scripts/v2/render-dev.ts so the
// container-bound director can call it — tsconfig.build rootDir=src).
//
// renderReviewStills() refuses BEFORE any Lambda call, in this order:
//   1. site: must be reel-studio-v2-* (reads data/sites/<site>/site.json only; "reel-studio" and data/site.json never)
//   2. L15: the site's pinned libraryHash must equal LIBRARY_HASH (a stale or unstamped bundle blocks), and the
//      storyboard must lint without a blocking finding (it has to resolve to a timeline for 3)
//   3. validateFrames: every frame inside the composition
//   4. env: REMOTION_AWS_* present, AWS_PROFILE / AWS_* absent
//   5. budget: tag + global + monthly caps with STILL_RESERVE_USD × frames, re-checked before every parallel group
// ≤ 2 stills in flight (amendments §12). Every call is booked in the ledger, success or failure (a failed call books
// the accrued cost when Remotion reported one, else the reserve). A failed group stops the run; the result lists it.
// A failed still, a budget refusal or an abort AFTER the first group stops the run but RETURNS the booked partial
// result (`stoppedBy`, plus a $0 "not rendered" failed entry per skipped frame); only a refusal before any call throws.
// Review frames (W3.1): reviewStillPicks / settledStillFrames / renderReviewStills({beats}) pick
// max(keywordF + 6, end of every action at/near the keyword and of any camera move), capped before the next beat,
// with the frame + reason for the stills manifest (stillManifestRows). contactSheetRows: sheets from index.json only.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deleteRender, downloadMedia, renderStillOnLambda } from "@remotion/lambda";
import type { Storyboard, WordsFileT } from "../../schema/storyboard.v2.js";
import { lintStoryboard, SETTLE_F } from "../lints.js";
import { COMPONENTS, LIBRARY_HASH } from "../registry.gen.js";
import type { Timeline } from "../timeline.js";
import { packetMarks } from "../visualDigest.js";
import { assertLambdaEnv, COMPOSITION, errText, FUNCTION, REGION, validateFrames } from "./lambda.js";
import { book, checkBudget, DEFAULT_LEDGER, globalCapFromEnv, type LedgerRow, monthlyCapFromEnv, readLedger, STILL_RESERVE_USD } from "./ledger.js";
import { ROOT } from "./root.js";
import { DEV_SITE, devServeUrl, pinnedSiteHash } from "./siteHash.js";

// ── renderer seam ──────────────────────────────────────────────────────────────────────────────────────────────

export interface StillRequest {
  serveUrl: string;
  composition: string;
  inputProps: Record<string, unknown>;
  frame: number;
  /** Local JPEG to write. */
  outFile: string;
  signal?: AbortSignal;
}
export interface StillRenderResult {
  /** Remotion's estimatedPrice.accruedSoFar for this still. */
  costUsd: number;
}
/** Thrown by a renderer when the call failed after Remotion already reported a cost (e.g. download failed). */
export class StillRenderError extends Error {
  constructor(
    message: string,
    readonly accruedUsd: number | null,
  ) {
    super(message);
    this.name = "StillRenderError";
  }
}
export type StillRenderer = (req: StillRequest) => Promise<StillRenderResult>;

/** Default renderer: renderStillOnLambda (JPEG q90, private, maxRetries 1, 30 s, deleteAfter 1-day) → download → deleteRender. */
export const lambdaStillRenderer: StillRenderer = async (req) => {
  let est: number | null = null; // Remotion's estimate, once the render returned
  try {
    const r = await renderStillOnLambda({
      region: REGION, functionName: FUNCTION, serveUrl: req.serveUrl, composition: req.composition, inputProps: req.inputProps, frame: req.frame,
      imageFormat: "jpeg", jpegQuality: 90, privacy: "private", maxRetries: 1, timeoutInMilliseconds: 30_000, deleteAfter: "1-day", logLevel: "warn",
    });
    est = r.estimatedPrice.accruedSoFar;
    await downloadMedia({ region: REGION, bucketName: r.bucketName, renderId: r.renderId, outPath: req.outFile });
    await deleteRender({ region: REGION, bucketName: r.bucketName, renderId: r.renderId }).catch(() => undefined);
    return { costUsd: est };
  } catch (e) {
    throw new StillRenderError(errText(e), est);
  }
};

// ── low-level batch (shared with scripts/v2/render-dev.ts `still` / `gallery`) ─────────────────────────────────

export interface StillOk {
  frame: number;
  file: string;
  usd: number;
  /** renderReviewStills with `beats`: the beats this frame serves and why it was chosen (stills manifest). */
  picks?: StillPick[];
}
export interface StillFailed {
  frame: number;
  error: string;
  usd: number;
}
export interface StillBatchResult {
  stills: StillOk[];
  /** Failed stills, plus one usd-0 entry per frame never started when the batch stopped early (see stoppedBy). */
  failed: StillFailed[];
  /** Booked by this batch (successes + failures). */
  spentUsd: number;
  /** The tag's ledger total after the batch. */
  tagTotalUsd: number;
  /** Set when the batch stopped between groups (budget re-check refused, or aborted) after booking earlier groups.
   *  A refusal before the FIRST call still throws (nothing was spent). */
  stoppedBy?: { reason: "budget" | "aborted" | "failed"; message: string; notRendered: number[] };
  /** renderReviewStills with `beats`: one pick per requested beat (frame + reason), in timeline order. */
  picks?: StillPick[];
}

export interface StillBatch {
  serveUrl: string;
  site: string;
  composition: string;
  inputProps: Record<string, unknown>;
  frames: readonly number[];
  tag: string;
  tagCapUsd: number;
  /** null = no whole-ledger cap. */
  globalCapUsd: number | null;
  monthlyCapUsd?: number;
  outDir: string;
  name: string;
  propsInfo: LedgerRow["props"];
  /** Stills in flight (already clamped by the caller). */
  parallel: number;
  renderImpl?: StillRenderer;
  ledgerFile?: string;
  /** Base for the ledger's relative `out` paths. */
  root?: string;
  log?: (s: string) => void;
  signal?: AbortSignal;
  now?: () => Date;
}

/** File name render-dev has always used: <name>[-cover]-fNNNN[-noblur].jpg */
export function stillFileName(name: string, frame: number, blur: boolean, cover?: boolean): string {
  return `${name}${cover ? "-cover" : ""}-f${String(frame).padStart(4, "0")}${blur ? "" : "-noblur"}.jpg`;
}

function abortError(): Error {
  const e = new Error("stills: aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Budget-checked, booked still batch. No site / hash / env / frame guards here — callers run those first
 * (renderReviewStills, render-dev.ts context()). Throws only when the budget check or an abort refuses BEFORE the
 * first call. Once anything is booked it returns the partial result with `stoppedBy` instead (W3.1: the caller must
 * see the dollars and files of the groups that did render).
 */
export async function runStillBatch(b: StillBatch): Promise<StillBatchResult> {
  const ledger = b.ledgerFile ?? DEFAULT_LEDGER;
  const root = b.root ?? ROOT;
  const log = b.log ?? (() => undefined);
  const render = b.renderImpl ?? lambdaStillRenderer;
  const now = b.now ?? (() => new Date());
  const par = Math.max(1, Math.floor(b.parallel) || 1);
  const guard = (n: number) => log(checkBudget(b.tag, b.tagCapUsd, b.globalCapUsd, STILL_RESERVE_USD * n, readLedger(ledger), { monthlyCap: b.monthlyCapUsd, now: now() }));
  if (b.signal?.aborted) throw abortError();
  guard(b.frames.length);
  mkdirSync(b.outDir, { recursive: true });

  const one = async (frame: number): Promise<{ ok: StillOk } | { failed: StillFailed }> => {
    const t0 = Date.now();
    const out = path.join(b.outDir, stillFileName(b.name, frame, b.propsInfo.blur, b.propsInfo.cover));
    let cost: number | null = null;
    let error: unknown = null;
    try {
      cost = (await render({ serveUrl: b.serveUrl, composition: b.composition, inputProps: b.inputProps, frame, outFile: out, signal: b.signal })).costUsd;
      if (!(Number.isFinite(cost) && cost >= 0)) cost = null;
    } catch (e) {
      error = e;
      cost = e instanceof StillRenderError && e.accruedUsd !== null && Number.isFinite(e.accruedUsd) ? e.accruedUsd : null;
    }
    // Booked whether or not the call succeeded: a failed still still ran a Lambda.
    const usd = cost ?? STILL_RESERVE_USD;
    const row: LedgerRow = {
      ts: now().toISOString(), tag: b.tag, kind: "still", site: b.site, composition: b.composition, frames: [frame],
      estimatedPriceUsd: usd, orchestratorUsd: 0, totalUsd: usd, wallSec: (Date.now() - t0) / 1000, out: error ? null : path.relative(root, out), props: b.propsInfo,
      status: error ? "failed" : "ok", ...(error ? { costSource: cost === null ? "reserve" : "accruedSoFar", error: errText(error) } : {}),
    };
    book(row, ledger);
    if (error) return { failed: { frame, usd, error: `still f${frame} failed (booked $${usd.toFixed(5)}): ${errText(error)}` } };
    log(`still f${frame} → ${row.out}  $${usd.toFixed(5)}  wall ${row.wallSec.toFixed(1)} s`);
    return { ok: { frame, file: out, usd } };
  };

  const stills: StillOk[] = [];
  const failed: StillFailed[] = [];
  let stoppedBy: StillBatchResult["stoppedBy"];
  for (let i = 0; i < b.frames.length; i += par) {
    // allSettled: a failing still must not abandon (and so leave unbooked) its siblings in the same group.
    for (const r of await Promise.allSettled(b.frames.slice(i, i + par).map(one))) {
      if (r.status === "rejected") failed.push({ frame: -1, usd: 0, error: errText(r.reason) }); // book() itself threw
      else if ("ok" in r.value) stills.push(r.value.ok);
      else failed.push(r.value.failed);
    }
    const rest = b.frames.slice(i + par);
    let stop: { reason: "budget" | "aborted" | "failed"; message: string } | null = null;
    if (failed.length) stop = { reason: "failed", message: `stopped after a failed still` };
    else if (rest.length && b.signal?.aborted) stop = { reason: "aborted", message: "stills: aborted" };
    else if (rest.length) {
      try {
        guard(Math.min(par, rest.length));
      } catch (e) {
        stop = { reason: "budget", message: errText(e) };
      }
    }
    if (stop) {
      if (rest.length) {
        stoppedBy = { ...stop, notRendered: [...rest] };
        for (const frame of rest) failed.push({ frame, usd: 0, error: `still f${frame} not rendered ($0): ${stop.message}` });
        log(`stills stopped (${stop.reason}) with ${rest.length} frame(s) left: ${stop.message}`);
      }
      break;
    }
  }
  const spentUsd = [...stills, ...failed].reduce((s, x) => s + x.usd, 0);
  const tagTotalUsd = readLedger(ledger).filter((r) => r.tag === b.tag).reduce((s, r) => s + (r.totalUsd ?? 0), 0);
  return { stills, failed, spentUsd, tagTotalUsd, ...(stoppedBy ? { stoppedBy } : {}) };
}

// ── review stills for the director ─────────────────────────────────────────────────────────────────────────────

export interface ReviewStillsOptions {
  storyboard: Storyboard;
  words: WordsFileT | null;
  /** Explainer frames; empty + cover → the timeline's coverF. Ignored when `beats` is given. */
  frames: readonly number[];
  /** Beat ids: render each at its settled review frame (reviewStillPicks with this storyboard); the result's `picks`
   *  and each StillOk's `picks` carry frame + reason for the stills manifest. */
  beats?: readonly string[];
  tag: string;
  tagCapUsd: number;
  /** Whole-ledger cap (default: REEL_V2_DEV_CAP_USD when set, else none — W7). null = none. */
  globalCapUsd?: number | null;
  /** Monthly cap (default monthlyCapFromEnv: REEL_V2_MONTHLY_CAP_USD or $25). */
  monthlyCapUsd?: number;
  outDir: string;
  namePrefix: string;
  /** Stills in flight, clamped to 1–2 (default 2). */
  parallel?: number;
  /** Motion blur (default false: review stills judge layout, not blur). */
  blur?: boolean;
  /** Cover/thumbnail still (props.cover hides the SubtitleCard). */
  cover?: boolean;
  renderImpl?: StillRenderer;
  ledgerFile?: string;
  /** Dev site (default reel-studio-v2-dev). */
  site?: string;
  /** Repo root for data/sites/<site>/site.json and relative ledger paths (tests use a temp dir). */
  root?: string;
  env?: NodeJS.ProcessEnv;
  /** Ledger label for the storyboard (default "director"). */
  sourceLabel?: string;
  log?: (s: string) => void;
  signal?: AbortSignal;
  now?: () => Date;
}

export const REVIEW_MAX_PARALLEL = 2;

export async function renderReviewStills(o: ReviewStillsOptions): Promise<StillBatchResult> {
  const root = o.root ?? ROOT;
  const env = o.env ?? process.env;
  const site = o.site ?? DEV_SITE;
  // 1. site — never the live "reel-studio", never data/site.json.
  if (!/^reel-studio-v2-/.test(site)) throw new Error(`refusing: "${site}" is not a reel-studio-v2-* site`);
  const serveUrl = devServeUrl(site, root);
  // 2. L15 + blocking lints.
  const pinned = pinnedSiteHash(site, root);
  if (!pinned) throw new Error(`BLOCK L15: data/sites/${site}/site.json has no libraryHash — last deploy unstamped or stale; redeploy`);
  if (pinned !== LIBRARY_HASH) throw new Error(`BLOCK L15: LIBRARY_HASH ${LIBRARY_HASH.slice(0, 12)}… ≠ pinned site ${pinned.slice(0, 12)}… — the deployed ${site} bundle is stale`);
  const report = lintStoryboard(o.storyboard, o.words, { pinnedLibraryHash: pinned });
  const blocks = report.results.filter((r) => r.severity === "block");
  if (blocks.length) throw new Error(`blocking lints: ${blocks.map((r) => `${r.id} ${r.message}`).join(" | ").slice(0, 1200)}`);
  if (!report.timeline) throw new Error("storyboard did not resolve to a timeline — nothing to render");
  // 3. frames (beats → settled review frames, keywordF + 6 minimum).
  let picks: StillPick[] | undefined;
  let frames: number[];
  if (o.beats && o.beats.length) {
    const known = new Set(report.timeline.beats.map((b) => b.id));
    const unknown = o.beats.filter((b) => !known.has(b));
    if (unknown.length) throw new Error(`stills: unknown beat id(s) ${unknown.join(", ")}`);
    picks = reviewStillPicks(report.timeline, { beatIds: o.beats, storyboard: o.storyboard });
    frames = [...new Set(picks.map((p) => p.frame))];
  } else frames = o.frames.length === 0 && o.cover ? [report.timeline.coverF] : [...o.frames];
  if (!frames.length) throw new Error("stills: no frames");
  validateFrames("still", frames, report.timeline.durationF);
  // 4. env.
  assertLambdaEnv(env);
  // 5. budget (inside runStillBatch, before the first call and before every group).
  const blur = o.blur ?? false;
  const globalCapUsd = o.globalCapUsd === undefined ? globalCapFromEnv(env) : o.globalCapUsd;
  const monthlyCapUsd = o.monthlyCapUsd ?? monthlyCapFromEnv(env);
  const parallel = Math.max(1, Math.min(REVIEW_MAX_PARALLEL, Math.floor(o.parallel ?? REVIEW_MAX_PARALLEL) || REVIEW_MAX_PARALLEL));
  const res = await runStillBatch({
    serveUrl, site, composition: COMPOSITION,
    inputProps: { storyboard: o.storyboard, words: o.words, blur, debug: false, ...(o.cover ? { cover: true } : {}) },
    frames, tag: o.tag, tagCapUsd: o.tagCapUsd, globalCapUsd, monthlyCapUsd, outDir: o.outDir, name: o.namePrefix,
    propsInfo: { sb: o.sourceLabel ?? "director", words: o.words ? "inline" : null, blur, debug: false, ...(o.cover ? { cover: true } : {}) },
    parallel, renderImpl: o.renderImpl, ledgerFile: o.ledgerFile, root, log: o.log, signal: o.signal, now: o.now,
  });
  if (!picks) return res;
  const ps = picks;
  return { ...res, picks: ps, stills: res.stills.map((s) => ({ ...s, picks: ps.filter((p) => p.frame === s.frame) })) };
}

/** One stills/index.json row per pick that rendered: beatId, frame, file (relative to `jobDir`), round, plus the
 *  frame selection (keywordF, minF, kind, reason). For the director's render_stills manifest writer (P3). */
export interface StillManifestRow {
  beatId: string;
  frame: number;
  file: string;
  round: number;
  keywordF: number;
  minF: number;
  kind: StillPick["kind"];
  reason: string;
}
export function stillManifestRows(res: Pick<StillBatchResult, "stills">, round: number, jobDir: string): StillManifestRow[] {
  return res.stills.flatMap((s) => (s.picks ?? []).map((p) => ({ beatId: p.beatId, frame: s.frame, file: path.relative(jobDir, s.file), round, keywordF: p.keywordF, minF: p.minF, kind: p.kind, reason: p.reason })));
}

// ── frame pickers ──────────────────────────────────────────────────────────────────────────────────────────────

/** Binding minimum offset of a review still after the keyword (STYLE_BIBLE_V2_AMENDMENTS, lints settledFrame). */
export const STILL_MIN_OFFSET_F = 6;
/** An action starting within ±this many frames of the keyword counts as anchored "at/near" it. */
export const STILL_NEAR_KEYWORD_F = 12;

/** Why a review still sits where it does (stills manifest: frame + reason). */
export interface StillPick {
  beatId: string;
  keywordF: number;
  /** keywordF + offset: never rendered earlier (clamped to the last frame). */
  minF: number;
  /** Where every action anchored at/near the keyword (and any camera move) has settled; may exceed capF. */
  settleF: number;
  /** Last frame before the next beat: its start, its first event or the caption swap away from the keyword's phrase,
   *  whichever is earliest; durationF − 1 for the last beat. */
  capF: number;
  /** The frame rendered: clamp(settleF, minF, max(minF, capF)). */
  frame: number;
  /** "min" = keywordF + offset already settled; "settle" = pushed to the end of an action / camera move; "cap" = cut at
   *  capF; "packet" = a NodeGraph `mark` of this beat shot mid-way along its packet's last hop (W5 integration). */
  kind: "min" | "settle" | "cap" | "packet";
  /** Human-readable, e.g. "settle: hs enter @412+13f → f425". */
  reason: string;
  /** The actions/moves that pushed the frame, in the order they did ("hs enter @412+13f", "camera @400→430"). */
  waitedFor: string[];
}

export interface StillPickOptions {
  beatIds?: readonly string[];
  /** Minimum offset after keywordF (default 6). */
  offsetF?: number;
  /** Instance id → component (from the storyboard world) for per-component verb timings. Without it the slowest
   *  timing any shipped component declares for that verb is used (conservative; capped before the next beat). */
  storyboard?: Pick<Storyboard, "world">;
  nearF?: number;
}

type ActionEv = Extract<Timeline["events"][number], { kind: "action" }>;
type VerbTimings = Readonly<Record<string, Readonly<Record<string, number>>>>;
const TIMINGS: VerbTimings = Object.fromEntries(Object.entries(COMPONENTS).map(([k, v]) => [k, (v as { verbTiming: Readonly<Record<string, number>> }).verbTiming]));
/** Header / datafield / planned components: the lints' classic animating verbs settle in SETTLE_F (L20). */
const fallbackF = (verb: string) => (verb === "countUp" || verb === "scramble" || verb === "enter" || verb === "glitch" ? SETTLE_F : 0);
/** Slowest declared timing of `verb` across the library (no storyboard: which component a target is is unknown). */
function slowestF(verb: string): number {
  let m = -1;
  for (const t of Object.values(TIMINGS)) if (t[verb] !== undefined) m = Math.max(m, t[verb]);
  return m >= 0 ? m : fallbackF(verb);
}

/** Frames from an action's anchor until it has settled (registry verbTiming, which includes enter/exit and the
 *  HeroStat 8 f digit scramble inside its 13 f enter). */
export function actionSettleF(e: Pick<ActionEv, "target" | "do">, componentOf?: ReadonlyMap<string, string>): number {
  if (!componentOf) return e.target === "header" || e.target === "datafield" ? fallbackF(e.do) : slowestF(e.do);
  const comp = componentOf.get(e.target);
  const t = comp ? TIMINGS[comp] : undefined;
  return t ? (t[e.do] ?? fallbackF(e.do)) : fallbackF(e.do);
}

/**
 * Review-still frame per beat: max(keywordF + offset, end of every action anchored at/near the keyword — enter
 * durF, count-ups, digit / text scrambles — and of anything still animating there, incl. a camera move), capped
 * before the next beat. keywordF + offset stays the binding minimum even when the cap is earlier.
 */
export function reviewStillPicks(timeline: Timeline, opts: StillPickOptions = {}): StillPick[] {
  const want = opts.beatIds ? new Set(opts.beatIds) : null;
  const offsetF = opts.offsetF ?? STILL_MIN_OFFSET_F;
  const nearF = opts.nearF ?? STILL_NEAR_KEYWORD_F;
  const last = timeline.durationF - 1;
  const componentOf = opts.storyboard ? new Map(opts.storyboard.world.map((i) => [i.id, i.component as string])) : undefined;
  const marks = opts.storyboard ? packetMarks(timeline, opts.storyboard.world) : [];
  const isPacket = (e: ActionEv) => marks.some((m) => m.target === e.target && m.startF === e.frame);
  // W5 integration: a beat's still is bound to the actions that START inside it (w5/r1 b20 was pushed by b19's 88 f mark),
  // and a packet mark is shot mid-flight below instead of waited out
  const actions = timeline.events.filter((e): e is ActionEv => e.kind === "action" && !isPacket(e)).map((e) => ({ e, end: e.frame + actionSettleF(e, componentOf) }));
  const label = (a: (typeof actions)[number]) => `${a.e.target} ${a.e.do} @${a.e.frame}+${a.end - a.e.frame}f`;
  const out: StillPick[] = [];
  timeline.beats.forEach((b, bi) => {
    if (want && !want.has(b.id)) return;
    const minF = Math.max(0, Math.min(last, b.keywordF + offsetF));
    const next = timeline.beats[bi + 1];
    // before the next beat: its start, its first event, and the swap away from this keyword's caption phrase
    let end = last + 1;
    let capBy = "the end";
    if (next) {
      end = next.startF;
      capBy = `${next.id} starts`;
      for (const e of timeline.events)
        if (e.beatIndex > bi && e.kind !== "keyword" && e.frame > b.keywordF && e.frame < end) {
          end = e.frame;
          capBy = `${next.id}'s first ${e.kind} @${e.frame}`;
        }
    }
    const kwPhrase = timeline.displayPhrases.find((d) => d.beatId === b.id && d.keywordWord !== null);
    if (kwPhrase && kwPhrase.hideF > b.keywordF && kwPhrase.hideF < end) {
      end = kwPhrase.hideF;
      capBy = `caption ${kwPhrase.id} swaps out @${kwPhrase.hideF}`;
    }
    const capF = Math.max(0, Math.min(last, end - 1));
    let f = minF;
    const waitedFor: string[] = [];
    for (let guard = 0; guard < 64; guard++) {
      let to = f;
      let why = "";
      for (const a of actions) {
        // anchored at/near this keyword (not settled yet), or anything mid-animation at f
        const near = a.e.beatIndex === bi && Math.abs(a.e.frame - b.keywordF) <= nearF;
        const inFlight = a.e.beatIndex === bi && a.e.frame <= f && a.end > f;
        if ((near || inFlight) && a.end > to) {
          to = a.end;
          why = label(a);
        }
      }
      for (const s of timeline.cameraSegments)
        if (s.transition === "move" && f >= s.startF && f < s.endF && s.endF > to) {
          to = s.endF;
          why = `camera @${s.startF}→${s.endF}`;
        }
      if (to <= f) break;
      waitedFor.push(why);
      f = to;
      if (f > capF) break;
    }
    const settleF = Math.max(minF, f); // may lie past capF / the last frame: the reason says what was cut
    let frame = Math.max(minF, Math.min(settleF, capF));
    let kind: StillPick["kind"] = settleF > frame ? "cap" : frame > minF ? "settle" : "min";
    // the last packet mark of this beat still in flight at or after the minimum: shoot it mid-way along its last hop
    // (later if the rest settles while the packet still flies); never before keywordF + offset, never past the cap
    const pk = marks.filter((m) => m.beatIndex === bi && m.endF > minF && Math.max(minF, m.midF) <= capF).at(-1);
    let packetWhy = "";
    if (pk) {
      const at = Math.max(minF, pk.midF);
      const later = Math.max(at, Math.min(settleF, capF));
      frame = later < pk.endF ? later : at;
      kind = "packet";
      packetWhy = `packet ${pk.target} ${pk.route} mid-flight (last hop) @${pk.startF}: f${frame} (flight ends f${pk.endF})`;
      waitedFor.push(`packet ${pk.target} ${pk.route}`);
    }
    const reason =
      kind === "packet"
        ? packetWhy
        : kind === "min"
        ? `keyword+${offsetF}: settled at f${minF}`
        : kind === "settle"
          ? `settle: ${waitedFor.join(", ")} → f${frame}`
          : `cap: wanted f${settleF} (${waitedFor.join(", ")}), cut at f${frame}: ${capBy}${frame === minF ? ` (keyword+${offsetF} minimum)` : ""}`;
    out.push({ beatId: b.id, keywordF: b.keywordF, minF, settleF, capF, frame, kind, reason, waitedFor });
  });
  return out;
}

/** keywordF + offsetF per beat (all beats, or `beatIds` in timeline order), clamped to the last frame, deduped.
 *  The raw keyword frame — NOT a settled review frame; review stills use settledStillFrames / reviewStillPicks. */
export function keywordStillFrames(timeline: Timeline, beatIds?: readonly string[], offsetF = STILL_MIN_OFFSET_F): number[] {
  const want = beatIds ? new Set(beatIds) : null;
  const out: number[] = [];
  for (const b of timeline.beats) {
    if (want && !want.has(b.id)) continue;
    const f = Math.max(0, Math.min(timeline.durationF - 1, b.keywordF + offsetF));
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

/** Settled review-still frame per beat (reviewStillPicks().frame), deduped, timeline order. Pass the storyboard:
 *  without it every verb gets the library's slowest timing. */
export function settledStillFrames(timeline: Timeline, storyboard: Pick<Storyboard, "world"> | undefined, beatIds?: readonly string[]): number[] {
  const out: number[] = [];
  for (const p of reviewStillPicks(timeline, { beatIds, storyboard })) if (!out.includes(p.frame)) out.push(p.frame);
  return out;
}

/** `n` evenly spaced beats (first … last) plus the first climax beat and the last cta beat; ids in timeline order. */
export function pickReviewBeats(timeline: Timeline, n: number): string[] {
  const beats = timeline.beats;
  if (!beats.length) return [];
  const idx = new Set<number>();
  const k = Math.max(0, Math.min(beats.length, Math.floor(n) || 0));
  if (k === 1) idx.add(Math.floor((beats.length - 1) / 2));
  else for (let i = 0; i < k; i++) idx.add(Math.round((i * (beats.length - 1)) / (k - 1)));
  const climax = beats.findIndex((b) => b.part === "climax");
  if (climax >= 0) idx.add(climax);
  const cta = beats.map((b) => b.part).lastIndexOf("cta");
  if (cta >= 0) idx.add(cta);
  return [...idx].sort((a, b) => a - b).map((i) => beats[i].id);
}

// ── contact sheet (W3.1: built from stills/index.json only, never a directory glob) ─────────────────────────────

export interface StillIndexRow {
  beatId: string;
  frame: number;
  file: string;
  round?: number;
  kind?: string;
  reason?: string;
}

/**
 * Tiles for a review contact sheet: the stills/index.json rows only (a superseded earlier-round still that is still
 * on disk is never shown), the latest round per beat (a later row wins a tie), only files that exist, by frame.
 */
export function contactSheetRows(index: unknown, exists: (file: string) => boolean): StillIndexRow[] {
  if (!Array.isArray(index)) return [];
  const byBeat = new Map<string, StillIndexRow>();
  for (const r of index as Partial<StillIndexRow>[]) {
    if (!r || typeof r.beatId !== "string" || typeof r.file !== "string" || !Number.isInteger(r.frame)) continue;
    const row = r as StillIndexRow;
    const prev = byBeat.get(row.beatId);
    if (!prev || (row.round ?? 0) >= (prev.round ?? 0)) byBeat.set(row.beatId, row);
  }
  return [...byBeat.values()].filter((r) => exists(r.file)).sort((a, b) => a.frame - b.frame || a.beatId.localeCompare(b.beatId));
}

/** Tile label: "b06 f0497 r2 settle" (drawtext-safe: no colons, quotes or backslashes). */
export function contactSheetLabel(r: StillIndexRow): string {
  return [r.beatId, `f${String(r.frame).padStart(4, "0")}`, r.round !== undefined ? `r${r.round}` : "", r.kind ?? ""].filter(Boolean).join(" ").replace(/[^A-Za-z0-9 ._+-]/g, "");
}
