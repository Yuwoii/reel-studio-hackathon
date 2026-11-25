// ffmpeg/ffprobe side of the audio module: probe, two-pass loudnorm mastering, size-capped preview, stills, and the
// acceptance measurement (ebur128 + silencedetect). Parsers are exported pure functions so they are unit-tested
// against captured ffmpeg output without running ffmpeg.

import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MediaReport } from "../contracts.js";
import { run, runRaw, type RunOptions } from "./proc.js";

export interface MediaOptions {
  ffmpeg: string;
  ffprobe: string;
  nice: boolean;
  /** x264/aac thread cap — NUC 1 runs live services. */
  threads: number;
}

export const TARGET_I = -14;
export const TARGET_TP = -1.5;
export const TARGET_LRA = 11;
/** Acceptance window (handoff): −14 ±1 LUFS, true peak ≤ −1 dBTP. */
export const I_TOLERANCE = 1;
export const TP_CEILING = -1.0;
export const SILENCE_DB = -40;
export const SILENCE_MIN_SEC = 0.7;

// ── parsers ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LoudnormMeasure {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** loudnorm print_format=json → the LAST {...} block on stderr (ffmpeg prints it after the filter banner). */
export function parseLoudnormJson(stderr: string): LoudnormMeasure {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm: no JSON block in ffmpeg output");
  const j = JSON.parse(stderr.slice(start, end + 1)) as Partial<LoudnormMeasure>;
  for (const k of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"] as const) {
    const v = j[k];
    // "-inf" happens for digital silence; second pass can't use it.
    if (typeof v !== "string" || !Number.isFinite(Number(v))) throw new Error(`loudnorm: bad ${k}=${String(v)} (silent audio?)`);
  }
  return j as LoudnormMeasure;
}

/** ebur128 Summary block → integrated loudness (LUFS) and true peak (dBTP). */
export function parseEbur128Summary(stderr: string): { integratedLufs: number; truePeakDbtp: number; lra?: number } {
  const at = stderr.lastIndexOf("Summary:");
  if (at < 0) throw new Error("ebur128: no Summary in ffmpeg output");
  const s = stderr.slice(at);
  const num = (re: RegExp) => {
    const m = re.exec(s);
    if (!m) return Number.NaN;
    return m[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(m[1]);
  };
  const integratedLufs = num(/\bI:\s+(-?inf|-?[\d.]+)\s+LUFS/);
  // "True peak:" section → "Peak:  -1.6 dBFS"
  const tpSection = s.slice(Math.max(0, s.indexOf("True peak:")));
  const m = /Peak:\s+(-?inf|-?[\d.]+)\s+dBFS/.exec(tpSection);
  const truePeakDbtp = !m ? Number.NaN : m[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(m[1]);
  const lra = num(/\bLRA:\s+(-?[\d.]+)\s+LU\b/);
  if (Number.isNaN(integratedLufs) || Number.isNaN(truePeakDbtp)) throw new Error("ebur128: could not parse I / true peak");
  return { integratedLufs, truePeakDbtp, lra: Number.isNaN(lra) ? undefined : lra };
}

/** silencedetect lines → [{startSec,endSec}]; an open silence at EOF ends at durationSec. */
export function parseSilences(stderr: string, durationSec: number): Array<{ startSec: number; endSec: number }> {
  const out: Array<{ startSec: number; endSec: number }> = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      open = Math.max(0, Number(s[1]));
      continue;
    }
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && open !== null) {
      out.push({ startSec: open, endSec: Number(e[1]) });
      open = null;
    }
  }
  if (open !== null) out.push({ startSec: open, endSec: durationSec });
  return out;
}

export function parseFps(r: string | undefined): number {
  if (!r) return 0;
  const [a, b] = r.split("/").map(Number);
  return b ? a / b : a || 0;
}

/** Video bitrate (bits/s) so video+audio fit in `maxBytes` with headroom for container overhead. */
export function previewVideoBitrate(maxBytes: number, durationSec: number, audioBps = 128_000, factor = 1): number {
  const totalBps = (maxBytes * 8 * 0.9) / Math.max(1, durationSec); // 10 % headroom: mux overhead + VBV overshoot
  return Math.round(Math.min(5_000_000, Math.max(250_000, (totalBps - audioBps) * factor)));
}

// ── ffprobe ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

export async function probe(o: MediaOptions, file: string, signal?: AbortSignal) {
  const r = await run(
    [o.ffprobe, "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate", "-of", "json", file],
    { nice: false, timeoutMs: 60_000, signal },
  );
  const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: ProbeStream[] };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  return {
    durationSec: Number(j.format?.duration ?? Number.NaN),
    video: v ? { codec: v.codec_name ?? "", width: v.width ?? 0, height: v.height ?? 0, fps: parseFps(v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v.r_frame_rate) } : null,
    audio: a ? { codec: a.codec_name ?? "" } : null,
  };
}

export async function probeDuration(o: MediaOptions, file: string, signal?: AbortSignal): Promise<number> {
  const d = (await probe(o, file, signal)).durationSec;
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe: no duration for ${file}`);
  return d;
}

/**
 * Exact playable duration of an audio file = decoded samples / sample rate. For mp3 the container/header duration
 * (what `ffprobe format=duration` reports) includes the encoder delay + end padding (~60 ms per edge-tts beat, which
 * added up to 0.5 s over a reel); decoders — ffmpeg, Chromium in Remotion — skip those samples.
 */
export async function decodedDurationSec(o: MediaOptions, file: string, signal?: AbortSignal): Promise<number> {
  const pr = await run([o.ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", file], { nice: false, timeoutMs: 60_000, signal });
  const rate = Number(pr.stdout.trim());
  const r = await runRaw([o.ffmpeg, "-hide_banner", "-nostdin", "-nostats", "-i", file, "-map", "0:a:0", "-af", "astats=metadata=0:reset=0", "-f", "null", "-"], { nice: o.nice, timeoutMs: 120_000, signal });
  const m = /Number of samples:\s*(\d+)/.exec(r.stderr);
  if (r.code === 0 && m && rate > 0) return Number(m[1]) / rate;
  return probeDuration(o, file, signal); // fallback: header duration (slightly long, never short)
}

const ff = (o: MediaOptions, args: string[], ro: RunOptions = {}) => run([o.ffmpeg, "-hide_banner", "-nostdin", "-y", ...args], { nice: o.nice, ...ro });

// ── loudness ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function loudness(o: MediaOptions, file: string, signal?: AbortSignal) {
  const dur = (await probe(o, file, signal)).durationSec;
  // ebur128 passes audio through, so silencedetect can share the same decode.
  const r = await runRaw(
    [o.ffmpeg, "-hide_banner", "-nostdin", "-nostats", "-i", file, "-map", "0:a:0", "-af", `ebur128=peak=true:framelog=verbose,silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN_SEC}`, "-f", "null", "-"],
    { nice: o.nice, timeoutMs: 10 * 60_000, signal },
  );
  if (r.code !== 0) throw new Error(`ffmpeg ebur128 failed: ${r.stderr.trim().split("\n").slice(-5).join(" | ")}`);
  return { ...parseEbur128Summary(r.stderr), silences: parseSilences(r.stderr, dur), durationSec: dur };
}

const LN = `I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`;

/** Two-pass loudnorm → AAC 192k 48 kHz, video copied, +faststart. Corrective gain+limiter pass if still off. */
export async function masterAudio(o: MediaOptions, inMp4: string, outMp4: string, signal?: AbortSignal, log?: (s: string) => void): Promise<void> {
  const p = await probe(o, inMp4, signal);
  if (!p.audio) throw new Error(`masterAudio: ${inMp4} has no audio stream`);
  const pass1 = await ff(o, ["-nostats", "-i", inMp4, "-map", "0:a:0", "-af", `loudnorm=${LN}:print_format=json`, "-f", "null", "-"], { signal });
  const m = parseLoudnormJson(pass1.stderr);
  log?.(`loudnorm pass1: I=${m.input_i} TP=${m.input_tp} LRA=${m.input_lra} thresh=${m.input_thresh} offset=${m.target_offset}`);
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  const tmp = outMp4 + ".tmp.mp4";
  // loudnorm resamples to 192 kHz internally → aresample back to 48 kHz explicitly. The trailing aformat pins the
  // layout: Debian ffmpeg 5.1 (the container) otherwise fails "Cannot select channel layout" (6.1 on the host doesn't).
  await encodeMaster(o, inMp4, tmp, `loudnorm=${LN}:${measured}:linear=true:print_format=summary,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`, p.video !== null, signal);

  let res = await loudness(o, tmp, signal);
  log?.(`master: I=${res.integratedLufs} TP=${res.truePeakDbtp}`);
  // Correction: loudnorm falls back to dynamic mode (or misses) when linear gain would breach TP. Then apply a plain
  // gain towards −14 followed by a 4×-oversampled limiter at −2 dBFS (true-peak margin), re-measure, max 2 rounds.
  let gainDb = 0;
  for (let round = 1; round <= 2 && !withinTarget(res.integratedLufs, res.truePeakDbtp); round++) {
    gainDb += TARGET_I - res.integratedLufs;
    const limit = Math.pow(10, (TARGET_TP - 0.5) / 20).toFixed(4);
    const af = `loudnorm=${LN}:${measured}:linear=true:print_format=summary,volume=${gainDb.toFixed(2)}dB,aresample=192000,alimiter=limit=${limit}:level=false:attack=5:release=50,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;
    log?.(`corrective pass ${round}: gain ${gainDb.toFixed(2)} dB, limit ${limit}`);
    await encodeMaster(o, inMp4, tmp, af, p.video !== null, signal);
    res = await loudness(o, tmp, signal);
    log?.(`master (corrected): I=${res.integratedLufs} TP=${res.truePeakDbtp}`);
  }
  if (!withinTarget(res.integratedLufs, res.truePeakDbtp)) {
    await rm(tmp, { force: true });
    throw new Error(`masterAudio: could not reach target (I=${res.integratedLufs} LUFS, TP=${res.truePeakDbtp} dBTP)`);
  }
  await rename(tmp, outMp4);
}

export function withinTarget(i: number, tp: number): boolean {
  return Math.abs(i - TARGET_I) <= I_TOLERANCE && tp <= TP_CEILING;
}

async function encodeMaster(o: MediaOptions, inMp4: string, out: string, af: string, hasVideo: boolean, signal?: AbortSignal) {
  await ff(
    o,
    [
      "-i", inMp4,
      ...(hasVideo ? ["-map", "0:v:0", "-c:v", "copy"] : []),
      "-map", "0:a:0", "-af", af,
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-threads", String(o.threads),
      "-movflags", "+faststart", "-f", "mp4", out,
    ],
    { signal, timeoutMs: 15 * 60_000 },
  );
}

// ── preview / stills / measure ──────────────────────────────────────────────────────────────────────────────────

export async function makePreview(o: MediaOptions, inMp4: string, outMp4: string, maxBytes = 9_000_000, signal?: AbortSignal, log?: (s: string) => void): Promise<{ bytes: number }> {
  const dur = await probeDuration(o, inMp4, signal);
  const tmp = outMp4 + ".tmp.mp4";
  let factor = 1;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const vbps = previewVideoBitrate(maxBytes, dur, 128_000, factor);
    await ff(
      o,
      [
        "-i", inMp4,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale=720:1280:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-b:v", String(vbps), "-maxrate", String(Math.round(vbps * 1.3)), "-bufsize", String(vbps * 2),
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-threads", String(o.threads),
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
  throw new Error(`makePreview: could not get under ${maxBytes} bytes`);
}

export async function extractStills(o: MediaOptions, inMp4: string, outDir: string, atSec?: number[]): Promise<Array<{ file: string; atSec: number }>> {
  const dur = await probeDuration(o, inMp4);
  const times = (atSec ?? [1.5, dur / 2, dur - 1]).map((t) => Math.min(Math.max(0, t), Math.max(0, dur - 0.05)));
  await mkdir(outDir, { recursive: true });
  const out: Array<{ file: string; atSec: number }> = [];
  for (const [i, t] of times.entries()) {
    const file = join(outDir, `still_${String(i + 1).padStart(2, "0")}.jpg`);
    // -ss before -i = fast keyframe seek + exact decode to t (ffmpeg ≥ 2.1 is frame-accurate this way).
    await ff(o, ["-ss", t.toFixed(3), "-i", inMp4, "-frames:v", "1", "-q:v", "2", "-update", "1", file], { timeoutMs: 120_000 });
    out.push({ file, atSec: Math.round(t * 1000) / 1000 });
  }
  return out;
}

export async function measure(o: MediaOptions, mp4: string): Promise<MediaReport> {
  const p = await probe(o, mp4);
  const l = p.audio ? await loudness(o, mp4) : { integratedLufs: Number.NaN, truePeakDbtp: Number.NaN, silences: [] };
  return {
    width: p.video?.width ?? 0,
    height: p.video?.height ?? 0,
    fps: Math.round((p.video?.fps ?? 0) * 1000) / 1000,
    durationSec: p.durationSec,
    videoCodec: p.video?.codec ?? "",
    audioCodec: p.audio?.codec ?? "",
    integratedLufs: l.integratedLufs,
    truePeakDbtp: l.truePeakDbtp,
    silenceGaps: l.silences.filter((s) => s.endSec - s.startSec >= SILENCE_MIN_SEC),
    bytes: (await stat(mp4)).size,
  };
}
