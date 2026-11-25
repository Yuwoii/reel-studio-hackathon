// v2 final audio (W4 → used by produce() once W6 wires the Lambda render): the Lambda render is MUTED; after its MP4
// comes back, src/audio/v2 mixes + masters the job (voice + optional bed + SFX → master.m4a, AAC 192k, QA measured on
// the output), the master is muxed onto the video (video and audio stream-copied, cut to the timeline length) and the
// mux is re-checked; the ≤ 9 MB preview re-encodes only the video and COPIES the mastered AAC, so the owner hears the
// exact master. Fail closed: a failed loudness / true-peak / voice − music (20–26 LU; skipped → pass null on voice-only
// reels) / codec / duration gate blocks "ready" (AudioGateError), SFX gates are listed on the result card as warnings.

import { existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { MediaReport } from "../../contracts.js";
import { previewVideoBitrate } from "../../audio/media.js";
import { type FfExec, ffmpeg, ffprobe } from "../../audio/v2/ffexec.js";
import { type MixJobReport, bedFile, loadAudioAssets, loadJobTimeline, mixJob, resolveBed, voiceFilesFor } from "../../audio/v2/job.js";
import { SAMPLE_RATE } from "../../audio/v2/mix.js";
import type { QaGate } from "../../audio/v2/qa.js";
import { PipelineError } from "../index.js";

/** Gates that block "ready" when they fail (fail closed). The rest are warnings on the card. voiceMinusMusic blocks
 *  since W4 fix round 2: a bed that masks the voice is a broken reel, not a cosmetic warning (pass null = voice-only). */
export const BLOCKING_GATES: readonly QaGate["id"][] = ["integrated", "truePeak", "voiceMinusMusic", "codec", "duration"];
/** Mux re-check: |audio − video| ≤ one AAC frame (1024 samples) + 1 ms rounding; |video − timeline| ≤ one frame. */
export const MUX_AV_TOL_MS = (1024 * 1000) / SAMPLE_RATE + 1;
export const MIX_DIR = "mix";
export const FINAL_FILE = "final.mp4";
export const PREVIEW_FILE = "preview.mp4";
export const PREVIEW_AUDIO_BPS = 192_000;

export interface FailedGate {
  id: string;
  value: unknown;
  target: string;
  blocking: boolean;
  detail?: string;
}

/** What the result card shows about the audio (and what an AudioGateError carries). */
export interface AudioQaSummaryV2 {
  bed: string | null;
  bedAlias: string | null;
  integratedLufs: number;
  truePeakDbtp: number;
  lra: number | null;
  /** Median voice − music during speech (LU); null for a voice-only reel. */
  voiceMinusMusicLU: number | null;
  /** Bed duck during speech (median dB) and its p90 per-second swing (dB); null for voice-only / no bed stem. */
  duck: { medianDb: number; swingP90Db: number } | null;
  /** dropped = storyboard (authored) SFX the planner refused, with "beat type reason"; unused fill candidates are not drops. */
  sfx: { kept: number; derived: number; dropped: number; droppedAuthored: string[]; holes: number; detected: number; per10s: number; maxInWindow: number; maxSyncErrorMs: number | null };
  /** Worst master-vs-timeline length error from QA (ms). */
  durationDeltaMs: number | null;
  /** Mux re-check (set once muxed). */
  mux?: MuxCheck;
  failed: FailedGate[];
  /** No blocking gate failed. */
  ready: boolean;
  mixSec: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** mixJob report → card summary (pure). */
export function summarizeAudioQa(r: Pick<MixJobReport, "bed" | "bedAlias" | "sfx" | "qa">, mixSec: number): AudioQaSummaryV2 {
  const q = r.qa;
  const errs = q.sfx.onsets.map((o) => o.errorMs).filter((e): e is number => e !== null);
  const dur = q.gates.find((g) => g.id === "duration")?.value as { worstErrorMs?: unknown } | undefined;
  const authored = r.sfx.dropped.filter((d) => d.source === "storyboard").map((d) => `${d.beatId} ${d.type} ${d.reason}`);
  const failed: FailedGate[] = q.gates
    .filter((g) => g.pass === false)
    .map((g) => ({ id: g.id, value: g.value, target: g.target, blocking: BLOCKING_GATES.includes(g.id), ...(g.detail ? { detail: g.detail } : {}) }));
  return {
    bed: r.bed,
    bedAlias: r.bedAlias,
    integratedLufs: q.master.integratedLufs,
    truePeakDbtp: q.master.truePeakDbtp,
    lra: num(q.master.lra),
    voiceMinusMusicLU: q.voiceMusic ? q.voiceMusic.medianLU : null,
    duck: q.duck ? { medianDb: q.duck.medianDb, swingP90Db: q.duck.swingP90Db } : null,
    sfx: {
      kept: r.sfx.report.kept,
      derived: r.sfx.report.keptDerived,
      dropped: authored.length,
      droppedAuthored: authored,
      holes: r.sfx.report.holes,
      detected: q.sfx.detected,
      per10s: q.sfx.per10s,
      maxInWindow: q.sfx.maxInWindow,
      maxSyncErrorMs: errs.length ? Math.max(...errs.map(Math.abs)) : null,
    },
    durationDeltaMs: num(dur?.worstErrorMs),
    failed,
    ready: !failed.some((f) => f.blocking),
    mixSec: Math.round(mixSec * 10) / 10,
  };
}

const f1 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "n/a" : n.toFixed(1));

function gateValueText(g: FailedGate): string {
  const v = g.value;
  if (typeof v === "number") return f1(v);
  if (v === null || v === undefined) return "n/a";
  return JSON.stringify(v).slice(0, 120);
}

/** Card lines (plain text, no secrets): loudness, voice − music, SFX, then every failed gate. */
export function audioQaLines(s: AudioQaSummaryV2): { loudness: string; mix: string; sfx: string; failed: string[] } {
  const bed = s.bed ? `bed ${s.bed}` : "voice-only";
  return {
    loudness: `I ${f1(s.integratedLufs)} LUFS · TP ${f1(s.truePeakDbtp)} dBTP · LRA ${f1(s.lra)} LU`,
    mix: `${bed} · voice − music ${s.voiceMinusMusicLU === null ? "n/a" : `${f1(s.voiceMinusMusicLU)} LU`}${s.duck ? ` · duck ${f1(s.duck.medianDb)} dB (swing p90 ${f1(s.duck.swingP90Db)} dB/s)` : ""} · mix ${f1(s.mixSec)} s`,
    sfx: `${s.sfx.kept} kept (${s.sfx.derived} derived) · ${s.sfx.dropped} authored dropped${s.sfx.droppedAuthored.length ? ` (${s.sfx.droppedAuthored.slice(0, 3).join(", ")})` : ""} · ${s.sfx.per10s.toFixed(2)}/10 s (max ${s.sfx.maxInWindow}) · sync ≤ ${s.sfx.maxSyncErrorMs === null ? "n/a" : `${Math.round(s.sfx.maxSyncErrorMs)} ms`}`,
    failed: s.failed.map((g) => `${g.blocking ? "⛔" : "⚠️"} ${g.id}: ${gateValueText(g)} (target ${g.target})`),
  };
}

/** A blocking audio gate failed: the job must not become "ready" (nothing is muxed into out/). */
export class AudioGateError extends PipelineError {
  constructor(readonly qa: AudioQaSummaryV2) {
    super(`audio QA failed (fail closed): ${qa.failed.filter((g) => g.blocking).map((g) => `${g.id} ${gateValueText(g)} (target ${g.target})`).join("; ")} — I ${f1(qa.integratedLufs)} LUFS, TP ${f1(qa.truePeakDbtp)} dBTP`);
    this.name = "AudioGateError";
  }
}

// ── preflight (before any render spend) ───────────────────────────────────────────────────────────────────────────

/** Everything the mixer needs exists and parses: storyboard + words, per-beat TTS (fresh), assets, bed. Throws. */
export async function preflightAudio(jobDir: string, assetsDir: string, bedChoice = "default"): Promise<{ bed: string | null; durationSec: number }> {
  const { sb, tl } = await loadJobTimeline(jobDir);
  await voiceFilesFor(jobDir, tl);
  const assets = await loadAudioAssets(assetsDir);
  const want = resolveBed(bedChoice, sb, assets.manifest);
  const bed = want === null ? null : bedFile(assets, want);
  if (bed && !existsSync(bed.file)) throw new Error(`bed ${bed.id}: ${bed.file} not found`);
  return { bed: bed?.id ?? null, durationSec: tl.durationF / tl.fps };
}

// ── probe / mux / preview ─────────────────────────────────────────────────────────────────────────────────────────

export interface StreamProbe {
  formatSec: number;
  bytes: number;
  video: { codec: string; width: number; height: number; fps: number; sec: number | null } | null;
  audio: { codec: string; sampleRate: number; channels: number; kbps: number | null; sec: number | null } | null;
}

/** ffprobe -of json (streams + format) → StreamProbe (pure). */
export function parseStreamProbe(json: string): StreamProbe {
  const j = JSON.parse(json) as { format?: { duration?: string; size?: string }; streams?: Array<Record<string, unknown>> };
  const n = (v: unknown) => (v === undefined || v === null || v === "N/A" ? Number.NaN : Number(v));
  const sec = (v: unknown) => (Number.isFinite(n(v)) ? n(v) : null);
  const fps = (r: unknown) => {
    const [a, b] = String(r ?? "0/0").split("/").map(Number);
    return b ? a / b : a || 0;
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  return {
    formatSec: n(j.format?.duration),
    bytes: n(j.format?.size),
    video: v ? { codec: String(v.codec_name ?? ""), width: Number(v.width ?? 0), height: Number(v.height ?? 0), fps: fps(v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v.r_frame_rate), sec: sec(v.duration) } : null,
    audio: a ? { codec: String(a.codec_name ?? ""), sampleRate: Number(a.sample_rate ?? 0), channels: Number(a.channels ?? 0), kbps: Number.isFinite(n(a.bit_rate)) ? n(a.bit_rate) / 1000 : null, sec: sec(a.duration) } : null,
  };
}

export async function probeStreams(x: FfExec, file: string, signal?: AbortSignal): Promise<StreamProbe> {
  const r = await ffprobe(x, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels,bit_rate,duration:format=duration,size", "-of", "json", file], { signal });
  return parseStreamProbe(r.stdout);
}

export interface MuxCheck {
  expectedSec: number;
  videoSec: number;
  audioSec: number;
  /** audio − video (ms). */
  avDeltaMs: number;
  /** video − timeline (ms). */
  videoDeltaMs: number;
  ok: boolean;
  problems: string[];
}

/** Final MP4 probe → mux re-check (pure): one video + one AAC 48 kHz stereo stream, lengths aligned. */
export function checkMux(p: StreamProbe, expectedSec: number, fps: number): MuxCheck {
  const problems: string[] = [];
  const videoSec = p.video?.sec ?? p.formatSec;
  const audioSec = p.audio?.sec ?? Number.NaN;
  if (!p.video) problems.push("no video stream");
  if (!p.audio) problems.push("no audio stream");
  else if (p.audio.codec !== "aac" || p.audio.sampleRate !== SAMPLE_RATE || p.audio.channels !== 2) problems.push(`audio is ${p.audio.codec} ${p.audio.sampleRate} Hz ${p.audio.channels} ch, not aac 48 kHz stereo`);
  const avDeltaMs = (audioSec - videoSec) * 1000;
  const videoDeltaMs = (videoSec - expectedSec) * 1000;
  if (!(Math.abs(avDeltaMs) <= MUX_AV_TOL_MS)) problems.push(`audio ${audioSec.toFixed(3)} s vs video ${videoSec.toFixed(3)} s (Δ ${avDeltaMs.toFixed(1)} ms > ${MUX_AV_TOL_MS.toFixed(1)})`);
  if (!(Math.abs(videoDeltaMs) <= 1000 / fps + 0.5)) problems.push(`video ${videoSec.toFixed(3)} s vs timeline ${expectedSec.toFixed(3)} s (Δ ${videoDeltaMs.toFixed(1)} ms > 1 frame)`);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { expectedSec, videoSec, audioSec, avDeltaMs: r(avDeltaMs), videoDeltaMs: r(videoDeltaMs), ok: problems.length === 0, problems };
}

/** W0: the render's OUTPUT rate from the probed master — the author (timeline) rate unless the video runs at an integer
 *  multiple of it (60 fps time-base wrapper → 60). checkMux's one-frame tolerance and the preview's -r use it. */
export function outputFpsOf(p: StreamProbe, timelineFps: number): number {
  const v = p.video?.fps ?? 0;
  const k = Math.round(v / timelineFps);
  return k >= 2 && Math.abs(v - k * timelineFps) < 0.01 * timelineFps ? k * timelineFps : timelineFps;
}

/** The preview's frame rate: Discord gets ≤ 30 fps (W0: a 60 fps master is decimated, which also keeps it < 9 MB). */
export const PREVIEW_MAX_FPS = 30;

/** Muted render + master.m4a → final MP4 (both streams copied, cut to the timeline length, +faststart). */
export async function muxMaster(x: FfExec, videoMp4: string, masterM4a: string, outMp4: string, durationSec: number, signal?: AbortSignal): Promise<void> {
  const tmp = `${outMp4}.tmp.mp4`;
  await rm(tmp, { force: true });
  try {
    await ffmpeg(x, ["-y", "-i", videoMp4, "-i", masterM4a, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-t", durationSec.toFixed(6), "-movflags", "+faststart", "-f", "mp4", tmp], { signal, timeoutMs: 10 * 60_000 });
    await rename(tmp, outMp4);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** ≤ maxBytes 720p preview: video re-encoded, the mastered AAC stream COPIED (the owner hears the master). */
export async function makePreviewV2(x: FfExec, inMp4: string, outMp4: string, durationSec: number, maxBytes: number, threads: number, signal?: AbortSignal, log?: (s: string) => void, inFps?: number): Promise<{ bytes: number }> {
  // W0: only a > 30 fps master gets -r 30; a 30 fps master keeps the v2 argv exactly. The bt709 tags of the W0 master
  // carry through scale + libx264 on the container's ffmpeg 5.1 (measured, research/v3/W0/greys-summary.txt).
  const rate = inFps !== undefined && inFps > PREVIEW_MAX_FPS ? ["-r", String(PREVIEW_MAX_FPS)] : [];
  const tmp = `${outMp4}.tmp.mp4`;
  let factor = 1;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const vbps = previewVideoBitrate(maxBytes, durationSec, PREVIEW_AUDIO_BPS, factor);
    await ffmpeg(
      x,
      [
        "-y", "-i", inMp4,
        "-map", "0:v:0", "-map", "0:a:0",
        "-vf", "scale=720:1280:flags=lanczos,format=yuv420p",
        ...rate,
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-b:v", String(vbps), "-maxrate", String(Math.round(vbps * 1.3)), "-bufsize", String(vbps * 2),
        "-c:a", "copy",
        "-threads", String(threads),
        "-movflags", "+faststart", "-f", "mp4", tmp,
      ],
      { signal, timeoutMs: 20 * 60_000 },
    );
    const bytes = (await stat(tmp)).size;
    log?.(`preview attempt ${attempt}: ${vbps} bps → ${bytes} bytes`);
    if (bytes < maxBytes) {
      await rename(tmp, outMp4);
      return { bytes };
    }
    factor *= 0.85 * (maxBytes / bytes);
  }
  await rm(tmp, { force: true });
  throw new PipelineError(`preview: could not get under ${maxBytes} bytes`);
}

export interface FinishAudioOptions {
  exec: FfExec;
  jobDir: string;
  /** The MUTED render (any audio stream in it is ignored). */
  videoMp4: string;
  assetsDir: string;
  /** "default" = the storyboard's music.bed (null → voice + SFX only). */
  bed?: string;
  previewMaxBytes: number;
  threads?: number;
  signal?: AbortSignal;
  log?: (s: string) => void;
  now?: () => number;
}

export interface FinishAudioResult {
  qa: AudioQaSummaryV2;
  report: MixJobReport;
  finalMp4: string;
  previewFile: string;
  previewBytes: number;
  media: MediaReport;
}

/** Mix + master + QA → (fail closed) → mux + re-check → preview with the mastered audio. */
export async function finishAudioV2(o: FinishAudioOptions): Promise<FinishAudioResult> {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const mixDir = path.join(o.jobDir, MIX_DIR);
  await mkdir(mixDir, { recursive: true });
  const t0 = now();
  const report = await mixJob({ exec: o.exec, jobDir: o.jobDir, outDir: mixDir, assetsDir: o.assetsDir, bed: o.bed ?? "default", keepStems: false, signal: o.signal, log });
  const qa = summarizeAudioQa(report, (now() - t0) / 1000);
  log(`audio QA: I ${f1(qa.integratedLufs)} TP ${f1(qa.truePeakDbtp)} VM ${f1(qa.voiceMinusMusicLU)} sfx ${qa.sfx.kept}/${qa.sfx.per10s} per 10 s, failed [${qa.failed.map((g) => g.id).join(", ")}]`);
  if (!qa.ready) throw new AudioGateError(qa);

  const vin = await probeStreams(o.exec, o.videoMp4, o.signal);
  if (!vin.video) throw new PipelineError(`render ${path.basename(o.videoMp4)} has no video stream`);
  const finalMp4 = path.join(o.jobDir, FINAL_FILE);
  await muxMaster(o.exec, o.videoMp4, report.mix.master, finalMp4, report.durationSec, o.signal);
  const fp = await probeStreams(o.exec, finalMp4, o.signal);
  const outFps = outputFpsOf(fp, report.fps);
  const mux = checkMux(fp, report.durationSec, outFps);
  qa.mux = mux;
  if (!mux.ok) {
    qa.failed.push({ id: "mux", value: { videoSec: mux.videoSec, audioSec: mux.audioSec }, target: "audio = video = timeline length", blocking: true, detail: mux.problems.join("; ") });
    qa.ready = false;
    throw new AudioGateError(qa);
  }

  const previewFile = path.join(o.jobDir, PREVIEW_FILE);
  const { bytes } = await makePreviewV2(o.exec, finalMp4, previewFile, mux.videoSec, o.previewMaxBytes, o.threads ?? 2, o.signal, log, outFps);
  const pp = await probeStreams(o.exec, previewFile, o.signal);
  if (!pp.audio || pp.audio.codec !== "aac") throw new PipelineError("preview has no AAC audio stream (expected the mastered audio)");

  const media: MediaReport = {
    width: fp.video!.width,
    height: fp.video!.height,
    fps: Math.round(fp.video!.fps * 1000) / 1000,
    durationSec: mux.videoSec,
    videoCodec: fp.video!.codec,
    audioCodec: fp.audio!.codec,
    integratedLufs: qa.integratedLufs,
    truePeakDbtp: qa.truePeakDbtp,
    silenceGaps: [],
    bytes: Number.isFinite(fp.bytes) ? fp.bytes : (await stat(finalMp4)).size,
  };
  return { qa, report, finalMp4, previewFile, previewBytes: bytes, media };
}
