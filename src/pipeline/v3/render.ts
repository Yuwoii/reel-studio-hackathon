// v3 RENDER CORE (W6 cut-over): one saved v3 director job (storyboard.v3.json + narrative.v3.json + the job's Ava voice)
// → ONE Remotion Lambda media render of "ExplainerV3", MUTED (W0 master: h264 CRF 14, x264 slow, bt709) → the S2 audio
// path (bed + SFX + ducking + −14 LUFS master + QA) → mux → final.mp4, preview.mp4 (< 9 MB), contact-sheet.png.
// Factored out of scripts/v3/render-job.ts (W4.2 review render) so the script and the #reels bot (src/pipeline/v3/
// index.ts produce()) run the SAME code. Callers decide the policy:
//   - the script: reel-studio-v3-* dev sites only, jobs under jobs/_dev, ffmpeg in a throwaway reel-studio container,
//     renders with red badges (review render), audio gates reported, not enforced;
//   - the bot: the LIVE site (REEL_V3_RENDER_SITE, default "reel-studio"), the container's own ffmpeg 5.1, the job's
//     $0.50 Lambda ceiling over frame stills + render + cover, the monthly cap, audio gates enforced (fail closed).
//
// Site pin (L15 for v3): data/sites/<site>/site.json must name that site and carry `v3LibraryHash` equal to the
// caller's `currentHash` — the bot passes V3_LIBRARY_HASH (src/v3/library-hash.gen.ts, the sources this image ships),
// the script v3LibraryHash() of the working tree. A stale or unstamped site refuses BEFORE any Lambda call.
// Money: ≤ MAX_RENDERERS (7) renderers + the orchestrator = ≤ 8 lambdas (framesPerLambda); budget checked BEFORE the
// call (tag cap, optional lifetime cap, monthly cap) and booked in data/v2-dev-ledger.jsonl after it, ok or failed,
// with the sha256 of the board + words rendered (the mux refuses a video from other bytes).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FfExec } from "../../audio/v2/ffexec.js";
import { parseAnyStoryboard } from "../../schema/storyboard.v3.js";
import { sceneV3 } from "../../v3/lints.js";
import type { OutputFps } from "../../v2/lints.js";
import { framesPerLambda, MAX_RENDERERS } from "../../v2/render-plan.js";
import { book, checkBudget, DEFAULT_LEDGER, MEDIA_RESERVE_USD_PER_F, ORCHESTRATOR_USD_PER_S, readLedger, STILL_RESERVE_USD, type LedgerRow } from "../../v2/ops/ledger.js";
import { errText } from "../../v2/ops/lambda.js";
import { ROOT } from "../../v2/ops/root.js";
import { runStillBatch, type StillRenderer } from "../../v2/ops/stills.js";
import { MediaRenderError, ORCHESTRATOR_RESERVE_SEC, type MediaRenderer, type MediaResult } from "../v2/render.js";

export const COMPOSITION_V3 = "ExplainerV3";
export const PREVIEW_MAX_BYTES_V3 = 9_000_000;
/** Remotion per-chunk timeout for v3 (3D + photo plates are heavier than v2; the review renders used 120 s). */
export const V3_CHUNK_TIMEOUT_MS = 120_000;
/** Output rate of the final v3 media render (owner decision 2026-11-06: 60). The board, words, lints, stills, frame
 *  check and the mix stay at the 30 fps author rate; ExplainerV3 doubles the time base (inputProps.outputFps).
 *  REEL_V3_OUTPUT_FPS=30 in .env turns it off without a rebuild. */
export function outputFpsV3(env: NodeJS.ProcessEnv = process.env): OutputFps {
  const v = env.REEL_V3_OUTPUT_FPS?.trim();
  if (!v) return 60;
  if (v === "30" || v === "60") return Number(v) as OutputFps;
  throw new Error(`REEL_V3_OUTPUT_FPS must be 30 or 60, got ${JSON.stringify(v)}`);
}
export const RENDER_DIR_V3 = "render";

/** A refusal BEFORE any Lambda call ($0 spent): site, layout, env or budget. The message is card-ready. */
export class RenderRefusedV3 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderRefusedV3";
  }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const readJson = <T>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

export interface NarrV3 {
  slug?: string;
  title?: string;
  voice?: string;
  leadSilenceMs: number;
  lines: Array<{ id: string; text: string; rate?: string; pauseAfterMs: number; act?: string }>;
}

export interface JobPlanV3 {
  jobDir: string;
  renderDir: string;
  board: { file: string; sha256: string; beats: number };
  words: { file: string; sha256: string; source: "job" | "resynth-needed" | "resynth"; reason: string };
  /** Author frames (30 fps). */
  durationF: number;
  fps: number;
  durationSec: number;
  /** Final render rate and its frame count (durationF × outputFps / fps); the Lambda layout is planned on these. */
  outputFps: OutputFps;
  outputFrames: number;
  coverF: number;
  framesPerLambda: number;
  renderers: number;
  reserveUsd: number;
  badges: string[];
  warnings: string[];
}

// ── plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Read + check a saved job (pure apart from reading files). The voice is the job's own synthesize_tts output when
 *  tts.v3.json's voicedHash matches the narrative and every beat file exists; else (or with resynth) render/voice. */
export async function planJobV3(a: { jobDir: string; resynth?: boolean; renderDir?: string; outputFps?: OutputFps }): Promise<{ plan: JobPlanV3; narrative: NarrV3; sb: unknown; words: unknown | null }> {
  const jobDir = path.resolve(a.jobDir);
  if (!existsSync(jobDir)) throw new Error(`no job dir ${jobDir}`);
  const boardFile = path.join(jobDir, "storyboard.v3.json");
  if (!existsSync(boardFile)) throw new Error("no saved storyboard (storyboard.v3.json): the job never got past submit_storyboard_v3");
  const sbBuf = readFileSync(boardFile);
  const p = parseAnyStoryboard(JSON.parse(sbBuf.toString("utf8")));
  if (!p.ok || !p.value) throw new Error(`storyboard does not parse: ${p.errors.slice(0, 6).join("; ")}`);
  const narrative = readJson<NarrV3>(path.join(jobDir, "narrative.v3.json"));
  if (!narrative?.lines?.length) throw new Error("no narrative.v3.json");
  const job = readJson<{ badges?: string[]; warnings?: string[] }>(path.join(jobDir, "job.v3.json"));
  const state = readJson<{ badges?: string[]; warnings?: string[] }>(path.join(jobDir, "director-v3.json"));
  const badges = job?.badges ?? state?.badges ?? [];
  const warnings = job?.warnings ?? state?.warnings ?? [];

  const { hashNarrativeVoice } = await import("../../director/v3/tools.js");
  const tts = readJson<{ voicedHash?: string }>(path.join(jobDir, "tts.v3.json"));
  const wordsFile = path.join(jobDir, "words.json");
  const jobWords = readJson<{ beats?: Array<{ beatId: string; file?: string }> }>(wordsFile);
  const want = hashNarrativeVoice(narrative as never);
  let reason = "";
  if (!tts?.voicedHash) reason = "no tts.v3.json";
  else if (tts.voicedHash !== want) reason = `tts.v3.json voicedHash ${tts.voicedHash} ≠ narrative ${want}`;
  else if (!jobWords?.beats?.length) reason = "no words.json";
  else if (jobWords.beats.length !== narrative.lines.length) reason = `words.json has ${jobWords.beats.length} beats, narrative ${narrative.lines.length} lines`;
  else {
    const missing = jobWords.beats.filter((b) => !b.file || !existsSync(b.file)).map((b) => b.beatId);
    if (missing.length) reason = `voice files missing for ${missing.join(", ")}`;
  }
  const renderDir = path.resolve(a.renderDir ?? path.join(jobDir, RENDER_DIR_V3));
  const useJob = !a.resynth && !reason;
  const resynthWords = path.join(renderDir, "voice", "words.json");
  const wordsPath = useJob ? wordsFile : resynthWords;
  const words = useJob ? jobWords : readJson(resynthWords);
  const wordsBuf = words ? readFileSync(wordsPath) : null;
  // timeline from the words that will be rendered (a resynth not run yet: estimate from the job's words, if any)
  const tl = sceneV3(p.value, (words ?? jobWords) as never).tl;
  const outputFps = a.outputFps ?? outputFpsV3();
  const outputFrames = tl.durationF * (outputFps / tl.fps);
  const fpl = framesPerLambda(outputFrames);
  const renderers = Math.ceil(outputFrames / fpl);
  if (renderers > MAX_RENDERERS) throw new Error(`render layout: fpl ${fpl} → ${renderers} renderers > ${MAX_RENDERERS}`);
  const beats = (p.value as { beats?: unknown[] }).beats?.length ?? 0;
  if (beats !== narrative.lines.length) throw new Error(`board has ${beats} beats, narrative ${narrative.lines.length} lines (they are 1:1)`);
  return {
    plan: {
      jobDir,
      renderDir,
      board: { file: boardFile, sha256: sha(sbBuf), beats },
      words: { file: wordsPath, sha256: wordsBuf ? sha(wordsBuf) : "", source: useJob ? "job" : words ? "resynth" : "resynth-needed", reason: a.resynth ? "--resynth" : reason || "job voice matches the narrative" },
      durationF: tl.durationF,
      fps: tl.fps,
      durationSec: tl.durationF / tl.fps,
      outputFps,
      outputFrames,
      coverF: Number.isInteger(tl.coverF) && tl.coverF >= 0 && tl.coverF < tl.durationF ? tl.coverF : Math.floor(tl.durationF / 2),
      framesPerLambda: fpl,
      renderers,
      // per AUTHOR frame on purpose: at 60 fps that is ½ × 1e-4 per output frame, still above the worst measured cost
      // (≤ 4.1e-5 per frame, 30 fps v3; v2 60 fps 1.6e-5 per output frame), and it keeps the $0.50 job ceiling reachable
      reserveUsd: MEDIA_RESERVE_USD_PER_F * tl.durationF,
      badges,
      warnings,
    },
    narrative,
    sb: p.value,
    words,
  };
}

/** The bytes the render used are still the bytes on disk (re-hash before the mux). */
export function sameBytes(plan: Pick<JobPlanV3, "board" | "words">): boolean {
  try {
    return sha(readFileSync(plan.board.file)) === plan.board.sha256 && sha(readFileSync(plan.words.file)) === plan.words.sha256;
  } catch {
    return false;
  }
}

// ── site (L15 for v3) ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SiteStatusV3 {
  ok: boolean;
  serveUrl: string | null;
  siteHash: string | null;
  nowHash: string;
  why: string;
}

/** data/sites/<site>/site.json must name the site, point at its bundle and carry v3LibraryHash === currentHash. */
export function siteStatusV3(site: string, currentHash: string, root: string = ROOT): SiteStatusV3 {
  if (!/^[a-z0-9-]{3,60}$/.test(site)) return { ok: false, serveUrl: null, siteHash: null, nowHash: currentHash, why: `bad site name ${site}` };
  const rel = path.join("data", "sites", site, "site.json");
  const s = readJson<{ siteName?: string; serveUrl?: string; v3LibraryHash?: string }>(path.join(root, rel));
  if (!s) return { ok: false, serveUrl: null, siteHash: null, nowHash: currentHash, why: `no ${rel} (never deployed)` };
  if (s.siteName !== site || typeof s.serveUrl !== "string" || !/^https:\/\//.test(s.serveUrl) || !s.serveUrl.includes(`/sites/${site}/`)) return { ok: false, serveUrl: null, siteHash: s.v3LibraryHash ?? null, nowHash: currentHash, why: `${rel} does not point at ${site}` };
  if (!s.v3LibraryHash) return { ok: false, serveUrl: s.serveUrl, siteHash: null, nowHash: currentHash, why: `${rel} has no v3LibraryHash (the site bundle does not carry ExplainerV3 yet — deploy it: REEL_V2_SITE_NAME=${site} scripts/v2/deploy-dev.sh)` };
  if (s.v3LibraryHash !== currentHash) return { ok: false, serveUrl: s.serveUrl, siteHash: s.v3LibraryHash, nowHash: currentHash, why: `stale: site ${s.v3LibraryHash.slice(0, 12)}… ≠ this build ${currentHash.slice(0, 12)}… (remotion/ or v3 metas/assets changed since the deploy)` };
  return { ok: true, serveUrl: s.serveUrl, siteHash: s.v3LibraryHash, nowHash: currentHash, why: "current" };
}

// ── voice ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A fresh per-sentence Ava synth into <renderDir>/voice (the same phrases synthesize_tts sends: one request per line,
 *  the line's rate and pauseAfterMs) + words.json. */
export async function resynthVoiceV3(plan: Pick<JobPlanV3, "renderDir">, n: NarrV3, o: { log?: (s: string) => void; signal?: AbortSignal; synth?: import("../../v3/tts.js").V3TtsOptions["synth"] } = {}): Promise<{ voice: string; lines: number; totalMs: number }> {
  const { synthesizeNarrationV3 } = await import("../../v3/tts.js");
  const outDir = path.join(plan.renderDir, "voice");
  await mkdir(outDir, { recursive: true });
  const phrases = n.lines.map((l, i) => ({ id: l.id, text: l.text, rate: l.rate, pauseAfterMs: l.pauseAfterMs, beatId: `b${String(i + 1).padStart(2, "0")}` }));
  const r = await synthesizeNarrationV3(phrases, { outDir, voice: n.voice, leadMs: n.leadSilenceMs, log: o.log, ...(o.signal ? { signal: o.signal } : {}), ...(o.synth ? { synth: o.synth } : {}) } as never);
  await writeFile(path.join(outDir, "words.json"), JSON.stringify(r.words, null, 2) + "\n");
  return { voice: r.voice, lines: r.lines.length, totalMs: r.totalMs };
}

// ── media render (Lambda, muted) ──────────────────────────────────────────────────────────────────────────────────

export interface RenderMediaV3Args {
  plan: JobPlanV3;
  site: string;
  serveUrl: string;
  tag: string;
  /** $ cap for the tag (the bot: the job ceiling minus what the frame stills spent). */
  tagCapUsd: number;
  /** Lifetime cap over the whole ledger (REEL_V2_DEV_CAP_USD) or null. */
  globalCapUsd: number | null;
  monthlyCapUsd?: number;
  /** Extra reserve checked with the render (e.g. the cover still that follows under the same tag). */
  extraReserveUsd?: number;
  inputProps: Record<string, unknown>;
  outFile: string;
  renderImpl: MediaRenderer;
  ledgerFile?: string;
  root?: string;
  /** Recorded in the ledger row's props (relative paths). */
  propsInfo?: Record<string, unknown>;
  log?: (s: string) => void;
  onProgress?: (fraction: number, detail: string) => void;
  signal?: AbortSignal;
  now?: () => Date;
}

export interface RenderMediaV3Result {
  totalUsd: number;
  renderSec: number;
  wallSec: number;
  lambdasInvoked?: number;
  budgetLine: string;
}

/** The $ reserve a render needs under its tag cap: frames × MEDIA_RESERVE_USD_PER_F + 900 s of orchestrator + extra
 *  (e.g. the cover still). The pipeline's card uses the same number to warn before ✅ (src/pipeline/v3/index.ts). */
export function renderReserveUsdV3(plan: Pick<JobPlanV3, "reserveUsd">, extraReserveUsd = 0): number {
  return plan.reserveUsd + ORCHESTRATOR_USD_PER_S * ORCHESTRATOR_RESERVE_SEC + extraReserveUsd;
}

/** One muted ExplainerV3 media render. Budget refusal → RenderRefusedV3 ($0, nothing booked). Every started render is
 *  booked (accruedSoFar + orchestrator wall, or the reserve when no cost came back). The file lands at outFile only on
 *  success (written to <outFile>.part.mp4 first). */
export async function renderMediaV3(a: RenderMediaV3Args): Promise<RenderMediaV3Result> {
  const ledgerFile = a.ledgerFile ?? DEFAULT_LEDGER;
  const root = a.root ?? ROOT;
  const now = a.now ?? (() => new Date());
  const reserve = renderReserveUsdV3(a.plan, a.extraReserveUsd);
  let budgetLine: string;
  try {
    budgetLine = checkBudget(a.tag, a.tagCapUsd, a.globalCapUsd, reserve, readLedger(ledgerFile), { ...(a.monthlyCapUsd !== undefined ? { monthlyCap: a.monthlyCapUsd } : {}), now: now() });
  } catch (e) {
    throw new RenderRefusedV3(`💸 Render refused by a Lambda budget cap — nothing was rendered, $0 spent. ${errText(e).replace(/^budget:\s*/, "")}`);
  }
  a.log?.(budgetLine);
  if (a.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  const frames = a.plan.outputFrames;
  await mkdir(path.dirname(a.outFile), { recursive: true });
  await rm(a.outFile, { force: true });
  const part = `${a.outFile}.part.mp4`;
  const t0 = Date.now();
  let res: MediaResult | undefined;
  let error: unknown = null;
  try {
    // the plan owns the output rate (its Lambda layout was computed on it), so the caller cannot render a different one
    res = await a.renderImpl({ serveUrl: a.serveUrl, composition: COMPOSITION_V3, inputProps: { ...a.inputProps, outputFps: a.plan.outputFps }, framesPerLambda: a.plan.framesPerLambda, outFile: part, signal: a.signal, onProgress: a.onProgress, timeoutMs: V3_CHUNK_TIMEOUT_MS });
    await rename(part, a.outFile);
  } catch (e) {
    error = e;
    await rm(part, { force: true }).catch(() => undefined);
  }
  const wallSec = (Date.now() - t0) / 1000;
  const renderSec = res?.renderSec ?? wallSec;
  const accrued = res ? res.costUsd : error instanceof MediaRenderError ? error.accruedUsd : null;
  const est = accrued ?? a.plan.reserveUsd;
  const orch = renderSec * ORCHESTRATOR_USD_PER_S;
  const rel = (p: string) => path.relative(root, p);
  const row: LedgerRow = {
    ts: now().toISOString(), tag: a.tag, kind: "media", site: a.site, composition: COMPOSITION_V3, frames: [0, frames - 1], estimatedPriceUsd: est, orchestratorUsd: orch,
    totalUsd: est + orch, wallSec, renderSec, lambdasInvoked: res?.lambdasInvoked, framesPerLambda: a.plan.framesPerLambda, retries: res?.retries ?? 0,
    out: error ? null : rel(a.outFile),
    props: { sb: rel(a.plan.board.file), sbSha256: a.plan.board.sha256, words: rel(a.plan.words.file), wordsSha256: a.plan.words.sha256, blur: true, debug: false, outputFps: a.plan.outputFps, ...(a.propsInfo ?? {}) } as unknown as LedgerRow["props"],
    status: error ? "failed" : "ok", ...(error ? { costSource: accrued === null ? ("reserve" as const) : ("accruedSoFar" as const), error: errText(error) } : {}),
  };
  book(row, ledgerFile);
  if (error) {
    if (a.signal?.aborted || (error instanceof MediaRenderError && error.aborted)) throw Object.assign(new Error(`render cancelled (booked $${row.totalUsd.toFixed(5)})`), { name: "AbortError" });
    throw new Error(`Lambda render failed (booked $${row.totalUsd.toFixed(5)}): ${errText(error)}`);
  }
  a.log?.(`media → ${row.out}  ${frames} f  $${row.totalUsd.toFixed(5)}  render ${renderSec.toFixed(1)} s  lambdas ${row.lambdasInvoked ?? "?"}  fpl ${a.plan.framesPerLambda}`);
  return { totalUsd: row.totalUsd, renderSec, wallSec, ...(res?.lambdasInvoked !== undefined ? { lambdasInvoked: res.lambdasInvoked } : {}), budgetLine };
}

/** The caption-free cover (props.cover hides the SubtitleCard) as ONE booked Lambda still → coverFile. Best effort:
 *  never throws; returns the $ booked (0 when refused before the call). */
export async function renderCoverV3(a: { serveUrl: string; site: string; sb: unknown; words: unknown; coverF: number; tag: string; tagCapUsd: number; monthlyCapUsd?: number; outDir: string; coverFile: string; stillImpl: StillRenderer; ledgerFile?: string; root?: string; log?: (s: string) => void; signal?: AbortSignal; now?: () => Date }): Promise<number> {
  try {
    const r = await runStillBatch({
      serveUrl: a.serveUrl, site: a.site, composition: COMPOSITION_V3, inputProps: { storyboard: a.sb, words: a.words, blur: false, debug: false, cover: true },
      frames: [a.coverF], tag: a.tag, tagCapUsd: a.tagCapUsd, globalCapUsd: null, ...(a.monthlyCapUsd !== undefined ? { monthlyCapUsd: a.monthlyCapUsd } : {}), outDir: a.outDir, name: ".cover",
      propsInfo: { sb: "storyboard.v3.json", words: "words.json", blur: false, debug: false, cover: true }, parallel: 1, renderImpl: a.stillImpl, ...(a.ledgerFile ? { ledgerFile: a.ledgerFile } : {}), ...(a.root ? { root: a.root } : {}), log: a.log, signal: a.signal, ...(a.now ? { now: a.now } : {}),
    });
    const ok = r.stills[0];
    if (ok) {
      await rename(ok.file, a.coverFile);
      a.log?.(`cover still f${a.coverF} → ${path.basename(a.coverFile)} ($${ok.usd.toFixed(5)})`);
    } else a.log?.(`cover still f${a.coverF} failed: ${r.failed.map((f) => f.error).join(" | ").slice(0, 300)} — the studio drop falls back to a frame grab`);
    return r.spentUsd;
  } catch (e) {
    a.log?.(`cover still refused: ${errText(e)} — the studio drop falls back to a frame grab`);
    return 0;
  }
}
export { STILL_RESERVE_USD };

// ── mix + mux + preview + contact sheet (the S2 audio path) ──────────────────────────────────────────────────────

export interface MixMuxV3Result {
  exec: FfExec["kind"];
  bed: string | null;
  sfx: unknown;
  qa: import("../v2/audio.js").AudioQaSummaryV2;
  mux: import("../v2/audio.js").MuxCheck;
  /** ffprobe of final.mp4 (codecs, size, fps) for the result card's MediaReport. */
  probe: import("../v2/audio.js").StreamProbe;
  finalMp4: string;
  previewFile: string;
  previewBytes: number;
  contactSheet: string;
  durationSec: number;
  mixSec: number;
}

/** Bed + SFX (v3 metas' sfx, v2 registry fallback) + voice → master (−14 LUFS) + QA → mux → preview (< previewMaxBytes,
 *  re-encoded smaller until it fits) → contact sheet (one frame every 2 s, 10 columns). All ffmpeg through `exec`
 *  (the container's ffmpeg 5.1 in the bot; a throwaway reel-studio container from the script). */
export async function mixAndMuxV3(o: { plan: JobPlanV3; sb: unknown; words: unknown; video: string; exec: FfExec; assetsDir: string; previewMaxBytes?: number; log?: (s: string) => void; signal?: AbortSignal }): Promise<MixMuxV3Result> {
  const { V3_METAS } = await import("../../v3/components-meta/index.js");
  const { registrySfxLookup } = await import("../../v2/sfx-anchors.js");
  const { bedFile, loadAudioAssets, resolveBed } = await import("../../audio/v2/job.js");
  const { mixReel } = await import("../../audio/v2/mix.js");
  const { runQa } = await import("../../audio/v2/qa.js");
  const { planSfx } = await import("../../audio/v2/sfx.js");
  const { ffmpeg } = await import("../../audio/v2/ffexec.js");
  const { checkMux, makePreviewV2, muxMaster, outputFpsOf, probeStreams, summarizeAudioQa } = await import("../v2/audio.js");
  const x = o.exec;
  const log = o.log ?? (() => {});
  const maxBytes = o.previewMaxBytes ?? PREVIEW_MAX_BYTES_V3;
  const tl = sceneV3(o.sb as never, o.words as never).tl;
  const wb = (o.words as { beats: Array<{ file?: string }> }).beats;
  const voiceFiles = wb.map((b) => b.file ?? "");
  for (const f of voiceFiles) if (!f || !existsSync(f)) throw new Error(`missing voice file ${f}`);
  const sbw = o.sb as { world: Array<{ id: string; component: string }> };
  const assets = await loadAudioAssets(o.assetsDir);
  const bedId = resolveBed("default", o.sb as never, assets.manifest);
  const bed = bedId === null ? null : bedFile(assets, bedId);
  const v2 = registrySfxLookup(sbw.world as never);
  const comp = new Map(sbw.world.map((i) => [i.id, i.component]));
  const actionSfx = (target: string, verb: string) => {
    const m = V3_METAS[comp.get(target) ?? ""] as { sfx?: Record<string, string> } | undefined;
    return m ? m.sfx?.[verb] : v2(target, verb);
  };
  const plan2 = planSfx(tl, { levels: assets.levels, fill: true, actionSfx: actionSfx as Parameters<typeof planSfx>[1]["actionSfx"] });
  const mixDir = path.join(o.plan.renderDir, "mix");
  await mkdir(mixDir, { recursive: true });
  const t0 = Date.now();
  // S2: the bed covers the whole reel (the fade reads only the CTA beat's audioEndMs)
  const bedTl = { ...tl, beats: tl.beats.map((b) => (b.part === "cta" ? { ...b, audioEndMs: tl.durationMs } : b)) };
  const mix = await mixReel({ exec: x, timeline: bedTl, plan: plan2, voiceFiles, bedFile: bed?.file ?? null, sfxDir: assets.sfxDir, outDir: mixDir, stems: true, log, ...(o.signal ? { signal: o.signal } : {}) } as Parameters<typeof mixReel>[0]);
  const qaRaw = await runQa({ exec: x, master: mix.master, stems: mix.stems, timeline: tl, placements: plan2.placements, sfxDir: assets.sfxDir, workDir: mixDir, ...(o.signal ? { signal: o.signal } : {}) } as Parameters<typeof runQa>[0]);
  const durationSec = tl.durationF / tl.fps;
  const qa = summarizeAudioQa({ bed: bed?.id ?? null, bedAlias: bed?.alias ?? null, sfx: plan2, qa: qaRaw } as Parameters<typeof summarizeAudioQa>[0], (Date.now() - t0) / 1000);
  log(`QA: I ${qa.integratedLufs} TP ${qa.truePeakDbtp} VM ${qa.voiceMinusMusicLU} ready ${qa.ready} failed [${qa.failed.map((g) => g.id).join(", ")}]`);
  const finalMp4 = path.join(o.plan.renderDir, "final.mp4");
  await muxMaster(x, o.video, mix.master, finalMp4, durationSec, o.signal);
  const fp = await probeStreams(x, finalMp4, o.signal);
  const fps = outputFpsOf(fp, tl.fps);
  const mux = checkMux(fp, durationSec, fps);
  qa.mux = mux;
  const previewFile = path.join(o.plan.renderDir, "preview.mp4");
  const prev = await makePreviewV2(x, finalMp4, previewFile, mux.videoSec, maxBytes, 2, o.signal, log, fps);
  if (prev.bytes >= maxBytes) throw new Error(`preview ${prev.bytes} bytes ≥ ${maxBytes}`);
  const sheet = path.join(o.plan.renderDir, "contact-sheet.png");
  const every = Math.max(1, Math.round(2 * fps));
  const cols = 10;
  const rows = Math.max(1, Math.ceil(Math.ceil(Math.round(durationSec * fps) / every) / cols));
  await ffmpeg(x, ["-v", "error", "-y", "-i", finalMp4, "-vf", `select='not(mod(n\\,${every}))',scale=200:356,tile=${cols}x${rows}:padding=4:color=black`, "-frames:v", "1", sheet], { ...(o.signal ? { signal: o.signal } : {}) });
  return { exec: x.kind, bed: bed?.id ?? null, sfx: plan2.report, qa, mux, probe: fp, finalMp4, previewFile, previewBytes: prev.bytes, contactSheet: sheet, durationSec, mixSec: (Date.now() - t0) / 1000 };
}
