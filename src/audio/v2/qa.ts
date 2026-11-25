// QA for a v2 audio master (ADR-001 §7 / RESEARCH §5 gates). Everything is MEASURED on the output files with the
// container ffmpeg (5.1), never taken from the plan:
//
//   loudness   master ebur128: |I + 14| ≤ 0.5 LU, true peak ≤ −1.5 dBTP, LRA reported
//   balance    voice − music during speech, 20–26 LU: median of the 100 ms momentary series of the voice and music
//              stems over frames whose 400 ms window centre falls inside a spoken word (word timestamps), both stems
//              audible (> −70 LUFS; ebur128 prints nan/-inf on digital silence). Skipped for voice-only reels.
//   duck       (warning) music stem vs the unducked bed stem, 50 ms RMS windows: median reduction while a word is
//              spoken 4–5 dB, and the reduction's swing (max − min) inside each 1 s window ≤ 6 dB at p90 (no word-rate
//              pumping). Skipped for voice-only reels.
//   density    SFX onsets DETECTED in the sfx stem: 1–3 per 10 s on average and ≤ 3 in any 10 s window. Empty 10 s
//              windows (from 1 s) are reported in the detail, not failed: SFX go only on transitions and mechanism
//              moments (W4 fix round 2), so a long context stretch may stay without one
//   sync       each planned SFX is found in the sfx stem by a matched filter (normalised cross-correlation of the raw
//              file, converted exactly like the mixer's input, over ±100 ms around its placement). The SFX are
//              deterministic synthesised waveforms mixed linearly, so the peak lag is the sample-exact onset even when
//              tails overlap. |detected − placement| ≤ 1 frame; placement − event must equal the documented lead.
//   duration   master length == durationF / fps, within one AAC frame (1024 samples = 21.3 ms): AAC is coded in
//              1024-sample frames and ffmpeg 5.1's mp4 edit list trims the priming but not the tail, so the decoded
//              length is rounded up to the frame grid (the W6 mux cuts to the video with -t / -shortest).
//   codec      AAC, 48 kHz, stereo, 192 kb/s (± 10 %)
//
// Parsers and detectors are pure and unit-tested; runQa() does the I/O.

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { parseEbur128Summary, TARGET_I } from "../media.js";
import type { Timeline } from "../../v2/timeline.js";
import { ffmpeg, ffprobe, type FfExec } from "./ffexec.js";
import { FMT, MASTER_I_TOL, MASTER_TP_MAX, SAMPLE_RATE } from "./mix.js";
import { leadMs, MAX_PER_10S, MAX_PER_WINDOW, maxInWindow, MIN_IN_WINDOW, MIN_PER_10S, MIN_WINDOW_FROM_MS, sparseWindows, WINDOW_MS, type SfxPlacement, type SoundSfx } from "./sfx.js";

export const VM_MIN_LU = 20;
export const VM_MAX_LU = 26;
export const AUDIBLE_LUFS = -70;
/** Matched filter: search ±100 ms around the placement with the first ≤ 300 ms of the file; found when NCC ≥ 0.5. */
export const SYNC_SEARCH_MS = 100;
export const SYNC_TEMPLATE_MS = 300;
export const SYNC_MIN_SCORE = 0.5;
/** One AAC frame. */
export const DURATION_TOL_SAMPLES = 1024;
export const AAC_KBPS = 192;
/** Duck depth (R4): median reduction of the bed during speech, and the per-second pumping limit. */
export const DUCK_MIN_DB = 4;
export const DUCK_MAX_DB = 5;
export const DUCK_SWING_MAX_DB = 6;
export const DUCK_WINDOW_MS = 50;

// ── parsers ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MomentaryFrame {
  /** End of the 400 ms window (s). */
  t: number;
  /** Momentary loudness (LUFS); −Infinity for digital silence (ebur128 prints nan / -inf). */
  M: number;
}

/** ebur128 framelog=info lines → [{t, M}]. */
export function parseMomentary(stderr: string): MomentaryFrame[] {
  const out: MomentaryFrame[] = [];
  for (const m of stderr.matchAll(/\bt:\s*([\d.]+(?:e[-+]?\d+)?)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?inf|-?nan|-?[\d.]+)/g)) {
    const v = Number(m[2]);
    out.push({ t: Number(m[1]), M: Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY });
  }
  return out;
}

/** astats "Number of samples" (the last one printed = Overall). */
export function parseSampleCount(stderr: string): number {
  const all = [...stderr.matchAll(/Number of samples:\s*(\d+)/g)];
  if (!all.length) throw new Error("astats: no sample count");
  return Number(all[all.length - 1][1]);
}

export interface ProbeAudio {
  codec: string;
  sampleRate: number;
  channels: number;
  bitRate: number;
  durationSec: number;
}

export function parseProbeAudio(json: string): ProbeAudio {
  const j = JSON.parse(json) as { streams?: Record<string, unknown>[]; format?: { duration?: string } };
  const a = j.streams?.find((s) => s.codec_type === "audio");
  if (!a) throw new Error("ffprobe: no audio stream");
  return {
    codec: String(a.codec_name ?? ""),
    sampleRate: Number(a.sample_rate ?? 0),
    channels: Number(a.channels ?? 0),
    bitRate: Number(a.bit_rate ?? 0),
    durationSec: Number(a.duration ?? j.format?.duration ?? Number.NaN),
  };
}

// ── measurements (pure) ──────────────────────────────────────────────────────────────────────────────────────────

const median = (a: readonly number[]) => {
  if (!a.length) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const quantile = (a: readonly number[], q: number) => {
  if (!a.length) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface VoiceMusicResult {
  medianLU: number;
  p10LU: number;
  p90LU: number;
  frames: number;
  medianMusicLufs: number;
}

/** Voice − music during speech, gated on word timestamps (window centre t − 0.2 s inside a word). */
export function voiceMinusMusic(voice: readonly MomentaryFrame[], music: readonly MomentaryFrame[], words: readonly { startMs: number; endMs: number }[]): VoiceMusicResult {
  const ws = [...words].sort((a, b) => a.startMs - b.startMs);
  const inWord = (ms: number) => {
    let lo = 0;
    let hi = ws.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ws[mid].endMs < ms) lo = mid + 1;
      else if (ws[mid].startMs > ms) hi = mid - 1;
      else return true;
    }
    return false;
  };
  const diffs: number[] = [];
  const ms: number[] = [];
  const n = Math.min(voice.length, music.length);
  for (let i = 0; i < n; i++) {
    const v = voice[i].M;
    const m = music[i].M;
    if (!(v > AUDIBLE_LUFS) || !(m > AUDIBLE_LUFS)) continue;
    if (!inWord(Math.round((voice[i].t - 0.2) * 1000))) continue;
    diffs.push(v - m);
    ms.push(m);
  }
  return { medianLU: r1(median(diffs)), p10LU: r1(quantile(diffs, 0.1)), p90LU: r1(quantile(diffs, 0.9)), frames: diffs.length, medianMusicLufs: r1(median(ms)) };
}

export interface DuckResult {
  /** Median bed − music (dB, positive = ducked) over 50 ms windows centred inside a spoken word. */
  medianDb: number;
  /** 90th percentile of the reduction during speech (the deep end). */
  p90Db: number;
  /** p90 over 1 s windows of (max − min) reduction inside the window (pumping). */
  swingP90Db: number;
  /** 1 s windows whose swing exceeds DUCK_SWING_MAX_DB, of all measured 1 s windows. */
  swingOver: number;
  seconds: number;
  speechWindows: number;
}

/**
 * Duck depth + pumping from the music stem and the unducked bed stem (mono f32, same length/rate). Windows where the
 * bed is below −70 dBFS RMS (holes, fades to silence) are skipped; 1 s windows need ≥ half their 50 ms windows.
 */
export function duckStats(music: Float32Array, bed: Float32Array, words: readonly { startMs: number; endMs: number }[], sampleRate = SAMPLE_RATE, winMs = DUCK_WINDOW_MS): DuckResult {
  const W = Math.max(1, Math.round((winMs * sampleRate) / 1000));
  const n = Math.floor(Math.min(music.length, bed.length) / W);
  const ws = [...words].sort((a, b) => a.startMs - b.startMs);
  let wi = 0;
  const speech: number[] = [];
  const perSec = new Map<number, number[]>();
  const floor = Math.pow(10, AUDIBLE_LUFS / 20);
  for (let k = 0; k < n; k++) {
    let sm = 0;
    let sb = 0;
    for (let i = k * W; i < (k + 1) * W; i++) {
      sm += music[i] * music[i];
      sb += bed[i] * bed[i];
    }
    const rb = Math.sqrt(sb / W);
    if (!(rb > floor)) continue;
    const red = 20 * Math.log10(rb / Math.max(Math.sqrt(sm / W), 1e-9));
    const centreMs = ((k + 0.5) * W * 1000) / sampleRate;
    while (wi < ws.length && ws[wi].endMs < centreMs) wi++;
    if (wi < ws.length && ws[wi].startMs <= centreMs) speech.push(red);
    const sec = Math.floor(centreMs / 1000);
    const a = perSec.get(sec);
    if (a) a.push(red);
    else perSec.set(sec, [red]);
  }
  const need = Math.ceil(1000 / winMs / 2);
  const swings = [...perSec.values()].filter((a) => a.length >= need).map((a) => Math.max(...a) - Math.min(...a));
  return { medianDb: r1(median(speech)), p90Db: r1(quantile(speech, 0.9)), swingP90Db: r1(quantile(swings, 0.9)), swingOver: swings.filter((x) => x > DUCK_SWING_MAX_DB).length, seconds: swings.length, speechWindows: speech.length };
}

export function pcmF32(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.byteLength & ~3));
  return new Float32Array(ab);
}

/**
 * Normalised cross-correlation of `template` against `signal` for lags [fromLag, toLag] (samples): Σ t·s / √(Σt²·Σs²)
 * over the template span. Returns the best lag and its score (1 = the template alone, scaled), or null when the
 * template is silent or no lag fits inside the signal.
 */
export function matchTemplate(signal: Float32Array, template: Float32Array, fromLag: number, toLag: number): { lag: number; score: number } | null {
  const L = template.length;
  let tt = 0;
  for (let i = 0; i < L; i++) tt += template[i] * template[i];
  if (!(tt > 0)) return null;
  const lo = Math.max(0, fromLag);
  const hi = Math.min(signal.length - L, toLag);
  if (hi < lo) return null;
  // running Σs² over the window
  let ss = 0;
  for (let i = lo; i < lo + L; i++) ss += signal[i] * signal[i];
  let best: { lag: number; score: number } | null = null;
  for (let lag = lo; lag <= hi; lag++) {
    if (lag > lo) ss += signal[lag + L - 1] * signal[lag + L - 1] - signal[lag - 1] * signal[lag - 1];
    if (ss <= 1e-12) continue;
    let dot = 0;
    for (let i = 0; i < L; i++) dot += template[i] * signal[lag + i];
    const score = dot / Math.sqrt(tt * ss);
    if (!best || score > best.score) best = { lag, score };
  }
  return best;
}

export interface OnsetCheck {
  id: string;
  type: SoundSfx;
  placementMs: number;
  detectedOnsetMs: number | null;
  errorMs: number | null;
  score: number | null;
}

/** Find every planned sound in the sfx stem (mono f32, 48 kHz) with its file's template. */
export function detectSfxOnsets(stem: Float32Array, placements: readonly Pick<SfxPlacement, "id" | "type" | "startMs">[], templates: Readonly<Partial<Record<SoundSfx, Float32Array>>>, sampleRate = SAMPLE_RATE): OnsetCheck[] {
  const search = Math.round((SYNC_SEARCH_MS * sampleRate) / 1000);
  return placements.map((p) => {
    const t = templates[p.type];
    const nominal = Math.round((p.startMs * sampleRate) / 1000);
    const m = t ? matchTemplate(stem, t, nominal - search, nominal + search) : null;
    const found = m && m.score >= SYNC_MIN_SCORE ? m : null;
    const onsetMs = found ? (found.lag * 1000) / sampleRate : null;
    return { id: p.id, type: p.type, placementMs: r2(p.startMs), detectedOnsetMs: onsetMs === null ? null : r2(onsetMs), errorMs: onsetMs === null ? null : r2(onsetMs - p.startMs), score: m ? Math.round(m.score * 1000) / 1000 : null };
  });
}

// ── gates ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QaGate {
  id: "integrated" | "truePeak" | "voiceMinusMusic" | "duck" | "sfxDensity" | "sfxSync" | "sfxLeads" | "duration" | "codec";
  /** null = not applicable (skipped). */
  pass: boolean | null;
  value: unknown;
  target: string;
  detail?: string;
}

export interface QaReport {
  ok: boolean;
  gates: QaGate[];
  master: { integratedLufs: number; truePeakDbtp: number; lra?: number; samples: number; expectedSamples: number; probe: ProbeAudio };
  voiceMusic: VoiceMusicResult | null;
  /** Duck depth / pumping (null: voice-only or no bed stem). */
  duck?: DuckResult | null;
  sfx: {
    detected: number;
    planned: number;
    per10s: number;
    maxInWindow: number;
    onsets: OnsetCheck[];
    leadErrors: { id: string; expectedLeadMs: number; actualLeadMs: number }[];
  };
}

export interface GateInputs {
  fps: number;
  durationMs: number;
  master: QaReport["master"];
  voiceMusic: VoiceMusicResult | null;
  duck?: DuckResult | null;
  onsets: OnsetCheck[];
  leadErrors: QaReport["sfx"]["leadErrors"];
}

export function evaluateGates(g: GateInputs): { gates: QaGate[]; per10s: number; maxInWindow: number; detected: number } {
  const frameMs = 1000 / g.fps;
  const m = g.master;
  const detectedOnsets = g.onsets.filter((o) => o.detectedOnsetMs !== null).map((o) => o.detectedOnsetMs as number);
  const per10s = g.durationMs > 0 ? r2((detectedOnsets.length * WINDOW_MS) / g.durationMs) : 0;
  const win = maxInWindow(detectedOnsets);
  const sparse = sparseWindows(detectedOnsets, g.durationMs);
  const bad = g.onsets.filter((o) => o.errorMs === null || Math.abs(o.errorMs) > frameMs);
  const worst = g.onsets.reduce((w, o) => (o.errorMs !== null && Math.abs(o.errorMs) > Math.abs(w) ? o.errorMs : w), 0);
  const containerSamples = Math.round(m.probe.durationSec * SAMPLE_RATE);
  const durErr = [m.samples - m.expectedSamples, containerSamples - m.expectedSamples];
  const durWorst = durErr.reduce((w, e) => (Math.abs(e) > Math.abs(w) ? e : w), 0);
  const kbps = m.probe.bitRate / 1000;
  const gates: QaGate[] = [
    { id: "integrated", pass: Math.abs(m.integratedLufs - TARGET_I) <= MASTER_I_TOL, value: m.integratedLufs, target: `|I − (${TARGET_I})| ≤ ${MASTER_I_TOL} LU` },
    { id: "truePeak", pass: m.truePeakDbtp <= MASTER_TP_MAX, value: m.truePeakDbtp, target: `≤ ${MASTER_TP_MAX} dBTP` },
    g.voiceMusic
      ? { id: "voiceMinusMusic", pass: g.voiceMusic.medianLU >= VM_MIN_LU && g.voiceMusic.medianLU <= VM_MAX_LU, value: g.voiceMusic.medianLU, target: `${VM_MIN_LU}–${VM_MAX_LU} LU during speech`, detail: `${g.voiceMusic.frames} speech frames, p10 ${g.voiceMusic.p10LU} / p90 ${g.voiceMusic.p90LU}` }
      : { id: "voiceMinusMusic", pass: null, value: null, target: `${VM_MIN_LU}–${VM_MAX_LU} LU during speech`, detail: "voice-only reel (no bed)" },
    g.duck
      ? {
          id: "duck",
          pass: g.duck.medianDb >= DUCK_MIN_DB && g.duck.medianDb <= DUCK_MAX_DB && g.duck.swingP90Db <= DUCK_SWING_MAX_DB,
          value: { medianDb: g.duck.medianDb, swingP90Db: g.duck.swingP90Db },
          target: `median duck ${DUCK_MIN_DB}–${DUCK_MAX_DB} dB during speech, p90 swing per 1 s ≤ ${DUCK_SWING_MAX_DB} dB`,
          detail: `${g.duck.speechWindows} speech windows, p90 depth ${g.duck.p90Db} dB, ${g.duck.swingOver}/${g.duck.seconds} s swing > ${DUCK_SWING_MAX_DB} dB`,
        }
      : { id: "duck", pass: null, value: null, target: `median duck ${DUCK_MIN_DB}–${DUCK_MAX_DB} dB during speech, p90 swing per 1 s ≤ ${DUCK_SWING_MAX_DB} dB`, detail: "voice-only reel (no bed)" },
    {
      id: "sfxDensity",
      pass: per10s >= MIN_PER_10S && per10s <= MAX_PER_10S && win.count <= MAX_PER_WINDOW,
      value: { per10s, maxInWindow: win.count, emptyWindows: sparse.length },
      target: `${MIN_PER_10S}–${MAX_PER_10S} per 10 s, ≤ ${MAX_PER_WINDOW} in any 10 s (windows with < ${MIN_IN_WINDOW} from ${MIN_WINDOW_FROM_MS / 1000} s reported)`,
      detail: `${detectedOnsets.length} onsets detected of ${g.onsets.length} planned${sparse.length ? `; empty 10 s windows start at ${sparse.map((s) => `${s / 1000}`).join(", ")} s` : ""}`,
    },
    { id: "sfxSync", pass: g.onsets.length === 0 ? null : bad.length === 0, value: { worstErrorMs: worst, failing: bad.map((b) => b.id) }, target: `|detected − planned onset| ≤ ${r2(frameMs)} ms (1 f)` },
    { id: "sfxLeads", pass: g.leadErrors.length === 0, value: g.leadErrors, target: "placement − event = documented lead (whoosh −200, glitch −150, impacts +1 f, chatter 0)" },
    {
      id: "duration",
      pass: Number.isFinite(durWorst) && Math.abs(durWorst) <= DURATION_TOL_SAMPLES,
      value: { expectedSamples: m.expectedSamples, decodedSamples: m.samples, containerSamples, worstErrorMs: r2((durWorst * 1000) / SAMPLE_RATE) },
      target: `decoded and container length = video length ± ${DURATION_TOL_SAMPLES} samples (1 AAC frame)`,
    },
    {
      id: "codec",
      pass: m.probe.codec === "aac" && m.probe.sampleRate === SAMPLE_RATE && m.probe.channels === 2 && Math.abs(kbps - AAC_KBPS) <= AAC_KBPS * 0.1,
      value: { codec: m.probe.codec, sampleRate: m.probe.sampleRate, channels: m.probe.channels, kbps: r1(kbps) },
      target: `aac 48 kHz stereo ${AAC_KBPS} kb/s ± 10 %`,
    },
  ];
  return { gates, per10s, maxInWindow: win.count, detected: detectedOnsets.length };
}

/** Planned leads vs the documented ones (pure). Clamped placements (lead reached before 0 s) are exempt. */
export function leadErrors(placements: readonly Pick<SfxPlacement, "id" | "type" | "eventMs" | "startMs" | "clamped">[], fps: number) {
  const out: { id: string; expectedLeadMs: number; actualLeadMs: number }[] = [];
  for (const p of placements) {
    if (p.clamped) continue;
    const exp = leadMs(p.type, fps);
    const act = p.startMs - p.eventMs;
    if (Math.abs(act - exp) > 0.01) out.push({ id: p.id, expectedLeadMs: r2(exp), actualLeadMs: r2(act) });
  }
  return out;
}

// ── I/O ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RunQaOptions {
  exec: FfExec;
  master: string;
  /** Stems from mixReel (voice required; music when a bed was used; sfx when SFX were placed). */
  stems: { voice?: string; music?: string; sfx?: string; bed?: string };
  timeline: Pick<Timeline, "fps" | "durationF" | "durationMs" | "words">;
  placements: readonly SfxPlacement[];
  /** Directory holding the raw SFX files (matched-filter templates). */
  sfxDir: string;
  /** Scratch dir for the PCM dumps (removed afterwards). */
  workDir: string;
  signal?: AbortSignal;
}

async function momentaryOf(x: FfExec, file: string, signal?: AbortSignal): Promise<MomentaryFrame[]> {
  const r = await ffmpeg(x, ["-i", file, "-af", "ebur128=framelog=info", "-f", "null", "-"], { signal, maxBuffer: 64 * 1024 * 1024 });
  return parseMomentary(r.stderr);
}

/** Decode to mono f32 48 kHz (raw SFX files first go through the mixer's own input conversion). */
async function monoPcm(x: FfExec, file: string, workDir: string, tag: string, preFmt: boolean, signal?: AbortSignal): Promise<Float32Array> {
  const raw = path.join(workDir, `.qa-${tag}.f32`);
  await ffmpeg(x, ["-y", "-i", file, "-af", `${preFmt ? FMT + "," : ""}aformat=sample_fmts=flt:channel_layouts=mono`, "-ar", String(SAMPLE_RATE), "-f", "f32le", raw], { signal });
  try {
    return pcmF32(await readFile(raw));
  } finally {
    await rm(raw, { force: true });
  }
}

export async function runQa(o: RunQaOptions): Promise<QaReport> {
  const x = o.exec;
  const tl = o.timeline;
  const expectedSamples = Math.round((tl.durationF * SAMPLE_RATE) / tl.fps);

  const mr = await ffmpeg(x, ["-i", o.master, "-map", "0:a:0", "-af", "ebur128=peak=true,astats=metadata=0", "-f", "null", "-"], { signal: o.signal });
  const sum = parseEbur128Summary(mr.stderr);
  const pr = await ffprobe(x, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,sample_rate,channels,bit_rate,duration:format=duration", "-of", "json", o.master], { signal: o.signal });
  const master = { integratedLufs: sum.integratedLufs, truePeakDbtp: sum.truePeakDbtp, lra: sum.lra, samples: parseSampleCount(mr.stderr), expectedSamples, probe: parseProbeAudio(pr.stdout) };

  let vm: VoiceMusicResult | null = null;
  if (o.stems.music) {
    if (!o.stems.voice) throw new Error("qa: the music gate needs the voice stem");
    const [V, M] = [await momentaryOf(x, o.stems.voice, o.signal), await momentaryOf(x, o.stems.music, o.signal)];
    vm = voiceMinusMusic(V, M, tl.words);
  }
  let duck: DuckResult | null = null;
  if (o.stems.music && o.stems.bed) {
    duck = duckStats(await monoPcm(x, o.stems.music, o.workDir, "music-stem", false, o.signal), await monoPcm(x, o.stems.bed, o.workDir, "bed-stem", false, o.signal), tl.words);
  }

  let onsets: OnsetCheck[] = [];
  if (o.placements.length) {
    if (!o.stems.sfx) throw new Error("qa: SFX were planned but there is no sfx stem");
    const templates: Partial<Record<SoundSfx, Float32Array>> = {};
    const maxLen = Math.round((SYNC_TEMPLATE_MS * SAMPLE_RATE) / 1000);
    for (const t of [...new Set(o.placements.map((p) => p.type))].sort()) {
      const pcm = await monoPcm(x, path.join(o.sfxDir, o.placements.find((p) => p.type === t)!.file), o.workDir, `raw-${t}`, true, o.signal);
      templates[t] = pcm.subarray(0, Math.min(pcm.length, maxLen));
    }
    onsets = detectSfxOnsets(await monoPcm(x, o.stems.sfx, o.workDir, "sfx-stem", false, o.signal), o.placements, templates);
  }

  const le = leadErrors(o.placements, tl.fps);
  const ev = evaluateGates({ fps: tl.fps, durationMs: (tl.durationF * 1000) / tl.fps, master, voiceMusic: vm, duck, onsets, leadErrors: le });
  return {
    ok: ev.gates.every((g) => g.pass !== false),
    gates: ev.gates,
    master,
    voiceMusic: vm,
    duck,
    sfx: { detected: ev.detected, planned: o.placements.length, per10s: ev.per10s, maxInWindow: ev.maxInWindow, onsets, leadErrors: le },
  };
}
