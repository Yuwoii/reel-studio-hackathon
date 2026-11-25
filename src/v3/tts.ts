// v3 narration TTS (W2, ADR-002 §7 step 7; voice rule = D1-DECISIONS-V3 "S2 voice — 2026-11-02", which supersedes
// decision 3a): edge-tts en-US-AvaMultilingualNeural, ONE request per sentence/thought (full sentence prosody — never
// split a sentence into phrases), deliberate gaps from the script's pauseAfterMs as data, one reel rate (default +5 %,
// only raised/lowered to land the reel ≤ 75 s; never slowed below +0 %), merged word boundaries. TypeScript port of
// research/v3/R2/tools/pace_tts.py, made container-compatible:
//
//   - synthesis goes through the SAME py/tts.py the v2 bot uses in production (edge-tts 7.3.1 in /opt/venv, one call
//     per sentence/thought, WordBoundary events, 3 retries) — no new Python dependency (py/tts.py needs only edge-tts);
//   - the edge trim and all PCM work happen here in Node on ffmpeg-decoded s16le (24 kHz mono, edge's native rate),
//     so the TTS step does not depend on numpy (which the image only carries for faster-whisper);
//   - why one request per sentence and not one per reel: the Edge read-aloud endpoint rejects every SSML element
//     (<break>, <prosody>, <emphasis>, <s> → NoAudioReceived; R2 VOICE.md §1.2), so a deliberate gap can only be
//     digital silence placed between two requests. Inside one request edge uses its own sentence gaps (~400 ms after
//     every sentence, S2 VOICE-AB.md), so a multi-sentence "thought" ("That's normal. It's part of the website.")
//     keeps edge's gap and only the gaps BETWEEN requests are chosen. S1 split lines into phrases at −8…−14 %; the
//     owner heard that as "slowed and robotic" (S1 feedback #4) — `phraseWarnings` flags a request that does not end
//     a sentence.
//
// Trim rule (R2): 10 ms RMS frames; keep from the first frame above −45 dBFS minus 30 ms to the last frame above
// −45 dBFS plus 60 ms. W2 fix: the start is never later than edge's first word start − 20 ms (a quiet fricative onset
// — "Follow" — sits below −45 dBFS for ~40 ms and the RMS rule cut it), and a 5 ms fade-in removes any click. The clip's `leadPadMs` / `tailPadMs` are then measured the way ffmpeg silencedetect sees
// silence (per-sample |x| below −45 dBFS): clip edge → first / after last sample above the threshold. Measured on the
// TLS narration, RMS-frame pads made silencedetect read the pauses up to 46 ms short; per-sample pads fix that.
//
// Word snap: edge-tts sometimes starts a word inside the natural pause at a comma ("going, but", "lots, behind";
// R2's full TLS run had the same "but") or at a sentence end inside a multi-sentence request ("normal. It's"). Inside each clip, runs of ≥ 200 ms below −45 dBFS (silencedetect d=0.2)
// are found and a word whose start (end) lies inside such a run is moved to the run's end (start); a word lying wholly
// inside one is shifted out to the nearer edge. A line's first word never starts before the clip's first audible
// sample (edge's onset sits ~10–40 ms ahead of it). So no caption word is lit during audible silence. `snapped`
// counts the moves.
//
// Pauses are AUDIBLE gaps (ADR-002 §7: "the measured audible gap = pauseAfterMs"): the digital silence placed
// between two clips is   gapAfterMs = pauseAfterMs − tailPad(this) − leadPad(next)   (≥ 0), so from the last
// above-threshold frame of one phrase to the first above-threshold frame of the next is exactly pauseAfterMs
// (when pauseAfterMs ≥ the two pads, ≈ 90 ms; below that the gap is the pads alone and `excessMs` says so).
// Likewise the first clip starts at leadGapMs = leadMs − leadPad(first), so the first audible frame is at leadMs.
//
// Timeline contract (src/v2/timeline.ts, W2 cursor change): the board's optional `leadMs` and per-beat
// `pauseAfterMs` carry the SAME audible numbers as the narrative (ADR-002 §7: narrative → beat 1:1), and words.json
// beats carry `leadPadMs` / `tailPadMs`; resolveTimeline subtracts the pads exactly as this module does, so every beat
// lands where narration.wav has it (sample-exact; tested in test/v3-w2-tts.test.ts). `layout` repeats the board
// values (= the requested audible ones); `lines[].gapAfterMs` is the file gap, for information only.
//
// Cache (ADR-002 §8.2): each phrase's raw edge output is cached under <outDir>/cache/<key>.{mp3,json}, key =
// sha256(CACHE_V, engine, voice, rate, text) — what changes the synthesised audio. Pauses and lead do not change a
// phrase's audio; they are in `layoutKey` (the assembled narration's key), so a pause edit re-assembles for free.
// Deviation from ADR-002 §8.2 (which lists pauseAfterMs/lead in the per-phrase key): same invalidation, finer split.
//
// Whole-sentence requests and captions (S2 check, research/v3/S2/voice-ab work/s3-ava, 22 requests, 218 words):
// edge returns one WordBoundary per token for whole sentences too (reconcile quality 1.00 on every request, 0 fuzzy /
// 0 interpolated); the snap moved 1–3 words per request (the first-word clamp plus comma / in-request sentence gaps).
//
// Network: edge-tts only (via py/tts.py). No secrets are read. Children run under nice -n 19 (src/audio/proc.ts).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileWords, type Boundary, type ReconcileStats } from "../audio/align.js";
import { abortError, run } from "../audio/proc.js";
import { lineWords, type NarrativeTiming } from "../schema/script.v3.js";

/** S2 voice (owner pick by ear, 2026-11-02). */
export const V3_VOICE = "en-US-AvaMultilingualNeural";
/** S2: one reel rate, ≈ +5 % — only to land ≤ 75 s (Ava at +0 % ran the S2 script to 78.1 s). */
export const V3_DEFAULT_RATE = "+5%";
export const SAMPLE_RATE = 24_000;
export const FRAME_SAMPLES = SAMPLE_RATE / 100; // 10 ms
export const TRIM_THRESH_DB = -45;
export const TRIM_LEAD_KEEP_MS = 30;
export const TRIM_TAIL_KEEP_MS = 60;
export const DEFAULT_TAIL_MS = 300;
/** Per-sample silence amplitude (−45 dBFS) and the silencedetect minimum duration used for pads and the word snap. */
export const SILENCE_AMP = Math.round(32768 * 10 ** (TRIM_THRESH_DB / 20));
export const SNAP_MIN_SILENCE_MS = 200;
/** Trim start ≤ edge's first word start − this; fade-in length at the clip start. */
export const ONSET_GUARD_MS = 20;
export const FADE_IN_MS = 5;
/** Bump when the trim / snap / layout rules change (part of layoutKey; the phrase cache holds raw edge output). */
export const TRIM_V = 2;
/** S2 voice rule: never slowed (< +0 % made S1 sound "slowed and robotic"), never rushed (> +10 %, the v2 +8 % Andrew
 *  already read 4.2 voiced w/s). Outside it is allowed but reported (`rateWarnings`), as is a reel with mixed rates. */
export const RATE_RANGE_PCT = { min: 0, max: 10 } as const;
/** A request should end a sentence (. ? ! …, optionally followed by a closing quote/bracket). */
export const SENTENCE_END_RE = /[.?!…]["'”’)\]]*\s*$/;
/** Bump when the synthesis call or its cached format changes (invalidates every cached phrase). */
export const CACHE_V = 1;
/** Below this reconcile quality the edge boundaries count as garbled → whisper on the trimmed clip (v2 rule). */
export const MIN_QUALITY = 0.75;

export interface V3Phrase {
  /** Narrative line id ("L01"); carried into the outputs. */
  id: string;
  text: string;
  /** edge-tts prosody rate, "+5%"; default `V3TtsOptions.rate` (→ V3_DEFAULT_RATE). S2: one rate for the reel. */
  rate?: string;
  /** Audible silence after this request's last above-threshold frame (ignored on the last one; see tailMs). S2:
   *  ~850–900 ms where something must sink in (opening question, a new name, the turn), 600–700 after a big
   *  question / closing line, 250–350 between ordinary sentences. */
  pauseAfterMs: number;
  /** v2 words.json beat id; default b01, b02, … by position (ADR-002 §7: lines map to beats 1:1). */
  beatId?: string;
}

/** One synthesised phrase, before trimming: mono PCM + WordBoundary times relative to the PCM start. */
export interface SynthOut {
  pcm: Int16Array;
  sampleRate: number;
  boundaries: Boundary[];
  attempts?: number;
}
export type SynthFn = (req: { text: string; voice: string; rate: string; cacheBase: string }, signal?: AbortSignal) => Promise<SynthOut>;
export type AlignFn = (wavFile: string, text: string, signal?: AbortSignal) => Promise<Boundary[]>;

export interface V3TtsOptions {
  outDir: string;
  voice?: string;
  /** Rate for phrases without their own (default V3_DEFAULT_RATE). */
  rate?: string;
  /** Audible silence before the first word (the hook "beat"; narrative.leadSilenceMs). */
  leadMs?: number;
  /** Digital silence after the last phrase in narration.wav (not part of the timeline layout). */
  tailMs?: number;
  python?: string;
  pyDir?: string;
  ffmpeg?: string;
  nice?: boolean;
  /** Injectable for tests (default: py/tts.py + ffmpeg decode, cached). */
  synth?: SynthFn;
  /** Optional whisper fallback for garbled boundaries (default: none → the edge boundaries are kept, quality logged). */
  align?: AlignFn;
  /** Phrase cache directory (default <outDir>/cache). */
  cacheDir?: string;
  /** Write beat_XX.wav + narration.wav + words.json + tts-v3.json (default true). */
  write?: boolean;
  log?: (s: string) => void;
  signal?: AbortSignal;
}

export interface V3Word {
  text: string;
  /** Relative to this phrase's trimmed clip start (v2 words.json base). */
  startMs: number;
  endMs: number;
}

export interface V3LineResult {
  id: string;
  beatId: string;
  text: string;
  rate: string;
  cacheKey: string;
  cached: boolean;
  timingSource: "edge-tts" | "whisper-aligned";
  /** Trimmed clip length (exact samples / rate). */
  durationMs: number;
  samples: number;
  /** Below-threshold audio kept at the clip edges by the trim. */
  leadPadMs: number;
  tailPadMs: number;
  /** Absolute start of the clip in narration.wav / the timeline. */
  audioStartMs: number;
  /** Requested audible pause after this line (0 for the last line). */
  pauseAfterMs: number;
  /** Digital silence placed after the clip (the timeline FILE gap; 0 for the last line). */
  gapAfterMs: number;
  /** Realised audible gap (tailPad + gap + next leadPad) and how much it exceeds the request (pads > pause). */
  audiblePauseMs: number;
  excessMs: number;
  words: V3Word[];
  quality: ReconcileStats;
  /** Words moved out of an intra-clip silence (see header). */
  snapped: number;
  file?: string;
}

export interface V3TtsResult {
  voice: string;
  engine: "edge-tts";
  sampleRate: number;
  leadMs: number;
  tailMs: number;
  /** Board values (audible, = the requested ones; see header). */
  layout: { leadMs: number; beats: Array<{ beatId: string; lineId: string; pauseAfterMs: number }> };
  /** Rates outside the S2 range (+0 … +10 %) and mixed rates within one reel. */
  rateWarnings: string[];
  /** Requests that do not end a sentence (S2: one request per sentence/thought, no per-phrase splitting). */
  phraseWarnings: string[];
  layoutKey: string;
  lines: V3LineResult[];
  /** v2 words.json (beat-relative ms; exact durationSec so the timeline cursor is sample-exact). */
  words: { beats: Array<{ beatId: string; durationSec: number; leadPadMs: number; tailPadMs: number; words: V3Word[]; file?: string }>; timingSource: string; voice: string; provider: "edge" };
  /** W1 NarrativeTiming (absolute seconds, lineWords tokens) for the writer gates and PA1. */
  timing: NarrativeTiming;
  /** Absolute word boundaries (whitespace tokens, ms) over the whole narration. */
  allWords: Array<{ text: string; startMs: number; endMs: number; lineId: string }>;
  totalMs: number;
  narrationFile?: string;
}

// ── PCM helpers (pure) ──────────────────────────────────────────────────────────────────────────────────────────────

const msToSamples = (ms: number) => Math.round((ms * SAMPLE_RATE) / 1000);
const samplesToMs = (n: number) => (n * 1000) / SAMPLE_RATE;

/** Per 10 ms frame: RMS in dBFS. */
export function frameDb(pcm: Int16Array): Float64Array {
  const n = Math.floor(pcm.length / FRAME_SAMPLES);
  const out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let k = f * FRAME_SAMPLES, e = k + FRAME_SAMPLES; k < e; k++) {
      const v = pcm[k] / 32768;
      s += v * v;
    }
    out[f] = 20 * Math.log10(Math.sqrt(s / FRAME_SAMPLES) + 1e-9);
  }
  return out;
}

/** R2 trim: [a, b) sample bounds to keep plus the kept pads, or null when the clip has no frame above threshold. */
export function trimBounds(pcm: Int16Array, firstWordStartMs?: number): { a: number; b: number; loudStart: number; loudEnd: number } | null {
  const db = frameDb(pcm);
  let first = -1;
  let last = -1;
  for (let f = 0; f < db.length; f++) {
    if (db[f] > TRIM_THRESH_DB) {
      if (first < 0) first = f;
      last = f;
    }
  }
  if (first < 0) return null;
  const loudStart = first * FRAME_SAMPLES;
  const loudEnd = (last + 1) * FRAME_SAMPLES;
  let a = Math.max(0, loudStart - msToSamples(TRIM_LEAD_KEEP_MS));
  if (firstWordStartMs !== undefined && Number.isFinite(firstWordStartMs)) a = Math.max(0, Math.min(a, msToSamples(firstWordStartMs - ONSET_GUARD_MS)));
  const b = Math.min(pcm.length, loudEnd + msToSamples(TRIM_TAIL_KEEP_MS));
  return { a, b, loudStart, loudEnd };
}

/** Per-sample pads: samples before the first / after the last |x| > SILENCE_AMP (the whole clip when silent). */
export function samplePads(pcm: Int16Array): { lead: number; tail: number } {
  let i = 0;
  while (i < pcm.length && Math.abs(pcm[i]) <= SILENCE_AMP) i++;
  let j = pcm.length - 1;
  while (j >= i && Math.abs(pcm[j]) <= SILENCE_AMP) j--;
  return { lead: i, tail: pcm.length - 1 - j };
}

/** Runs of ≥ minMs where every sample is |x| ≤ SILENCE_AMP (ms, clip-relative), leading/trailing runs excluded. */
export function innerSilences(pcm: Int16Array, minMs = SNAP_MIN_SILENCE_MS): Array<{ startMs: number; endMs: number }> {
  const min = msToSamples(minMs);
  const out: Array<{ startMs: number; endMs: number }> = [];
  let run = -1;
  for (let k = 0; k <= pcm.length; k++) {
    const quiet = k < pcm.length && Math.abs(pcm[k]) <= SILENCE_AMP;
    if (quiet && run < 0) run = k;
    else if (!quiet && run >= 0) {
      if (run > 0 && k < pcm.length && k - run >= min) out.push({ startMs: samplesToMs(run), endMs: samplesToMs(k) });
      run = -1;
    }
  }
  return out;
}

/** Move word starts/ends that fall inside a silence run to its edge (keeps order; returns the number moved). */
export function snapWordsOutOfSilence(words: V3Word[], silences: ReadonlyArray<{ startMs: number; endMs: number }>, leadPadMs?: number): number {
  let moved = 0;
  for (const w of words) {
    for (const s of silences) {
      if (w.startMs > s.startMs && w.startMs < s.endMs && w.endMs > s.endMs) {
        w.startMs = s.endMs;
        moved++;
      } else if (w.endMs > s.startMs && w.endMs < s.endMs && w.startMs < s.startMs) {
        w.endMs = s.startMs;
        moved++;
      } else if (w.startMs >= s.startMs && w.endMs <= s.endMs && w.endMs > w.startMs) {
        // wholly inside: shift out to the nearer edge, keeping the word's length
        const d = w.endMs - w.startMs;
        if (s.endMs - w.endMs <= w.startMs - s.startMs) [w.startMs, w.endMs] = [s.endMs, s.endMs + d];
        else [w.startMs, w.endMs] = [s.startMs - d, s.startMs];
        moved++;
      }
    }
  }
  // the first word does not start before the clip's first audible sample
  if (leadPadMs !== undefined && words.length && words[0].startMs < leadPadMs && words[0].endMs > leadPadMs) {
    words[0].startMs = leadPadMs;
    moved++;
  }
  for (let i = 1; i < words.length; i++) if (words[i].startMs < words[i - 1].startMs) words[i].startMs = words[i - 1].startMs;
  for (const w of words) if (w.endMs < w.startMs) w.endMs = w.startMs;
  for (let i = 1; i < words.length; i++) if (words[i].startMs < words[i - 1].endMs) words[i - 1].endMs = Math.max(words[i - 1].startMs, words[i].startMs);
  return moved;
}

/** Linear fade-in over the first FADE_IN_MS (in place). */
export function fadeIn(pcm: Int16Array, ms = FADE_IN_MS): Int16Array {
  const n = Math.min(pcm.length, msToSamples(ms));
  for (let k = 0; k < n; k++) pcm[k] = Math.round((pcm[k] * k) / n);
  return pcm;
}

/** 16-bit mono PCM WAV file bytes. */
export function wavBytes(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export function phraseCacheKey(voice: string, rate: string, text: string): string {
  return createHash("sha256").update(JSON.stringify([CACHE_V, "edge-tts", voice, rate, text])).digest("hex").slice(0, 20);
}

/** Split a whitespace token's span over its lineWords() sub-tokens (W1 NarrativeTiming counts lineWords). */
function toLineWords(words: Array<{ text: string; startMs: number; endMs: number }>): Array<{ text: string; startMs: number; endMs: number }> {
  const out: Array<{ text: string; startMs: number; endMs: number }> = [];
  for (const w of words) {
    const sub = lineWords(w.text);
    const step = (w.endMs - w.startMs) / Math.max(1, sub.length);
    sub.forEach((text, k) => out.push({ text, startMs: w.startMs + k * step, endMs: w.startMs + (k + 1) * step }));
  }
  return out;
}

// ── production synth: py/tts.py (the v2 container path) + ffmpeg decode ────────────────────────────────────────────

function findRepoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, "py", "tts.py"))) return d;
    d = dirname(d);
  }
  return process.cwd();
}

export function edgeSynth(o: { python?: string; pyDir?: string; ffmpeg?: string; nice?: boolean; log?: (s: string) => void } = {}): SynthFn {
  const root = findRepoRoot();
  const python = o.python ?? process.env.REEL_PYTHON ?? join(root, ".venv", "bin", "python");
  const pyDir = o.pyDir ?? process.env.REEL_PY_DIR ?? join(root, "py");
  const ffmpeg = o.ffmpeg ?? process.env.REEL_FFMPEG ?? "ffmpeg";
  const nice = o.nice ?? true;
  return async ({ text, voice, rate, cacheBase }, signal) => {
    const mp3 = `${cacheBase}.mp3`;
    const meta = `${cacheBase}.json`;
    let boundaries: Boundary[] | null = null;
    let attempts = 0;
    if (existsSync(mp3) && existsSync(meta)) {
      try {
        const m = JSON.parse(await readFile(meta, "utf8")) as { v: number; text: string; voice: string; rate: string; boundaries: Boundary[] };
        if (m.v === CACHE_V && m.text === text && m.voice === voice && m.rate === rate) boundaries = m.boundaries;
      } catch {
        boundaries = null;
      }
    }
    if (!boundaries) {
      await mkdir(dirname(mp3), { recursive: true });
      const r = await run([python, join(pyDir, "tts.py")], { input: JSON.stringify({ text, voice, out: resolve(mp3), rate }), timeoutMs: 4 * 60_000, signal, nice });
      const j = JSON.parse(r.stdout) as { boundaries: Boundary[]; attempts: number };
      boundaries = j.boundaries;
      attempts = j.attempts;
      const tmp = `${meta}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ v: CACHE_V, text, voice, rate, boundaries }, null, 1) + "\n");
      await rename(tmp, meta);
    }
    const pcm = await decodePcm(ffmpeg, mp3, nice, signal);
    return { pcm, sampleRate: SAMPLE_RATE, boundaries, attempts };
  };
}

/** ffmpeg → s16le mono 24 kHz (binary stdout; proc.ts's run() collects text, so spawn directly here). */
async function decodePcm(ffmpeg: string, file: string, nice: boolean, signal?: AbortSignal): Promise<Int16Array> {
  const { spawn } = await import("node:child_process");
  if (signal?.aborted) throw abortError();
  const argv = [...(nice ? ["nice", "-n", "19"] : []), ffmpeg, "-nostdin", "-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"];
  return new Promise((res, rej) => {
    const ch = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    const onAbort = () => ch.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    ch.stdout.on("data", (c: Buffer) => chunks.push(c));
    ch.stderr.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-4000)));
    ch.on("error", (e) => rej(e));
    ch.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return rej(abortError());
      if (code !== 0) return rej(new Error(`ffmpeg decode ${file} exited ${code}: ${err.trim()}`));
      const b = Buffer.concat(chunks);
      const copy = new Int16Array(Math.floor(b.length / 2));
      for (let i = 0; i < copy.length; i++) copy[i] = b.readInt16LE(i * 2);
      res(copy);
    });
  });
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** S2 rate rule (pure): each rate outside +0 … +10 %, and one warning when the reel mixes rates. */
export function rateWarningsFor(phrases: ReadonlyArray<{ id: string; rate: string }>): string[] {
  const out = phrases
    .filter((p) => { const v = Number(p.rate.replace("%", "")); return v < RATE_RANGE_PCT.min || v > RATE_RANGE_PCT.max; })
    .map((p) => `${p.id}: rate ${p.rate} outside the S2 voice range +${RATE_RANGE_PCT.min}…+${RATE_RANGE_PCT.max} % (never slowed; ≈ +5 % only to land ≤ 75 s)`);
  const rates = [...new Set(phrases.map((p) => p.rate))];
  if (rates.length > 1) out.push(`mixed rates ${rates.join(", ")}: S2 reads the reel at one rate (decision 3a's per-line rates are retired)`);
  return out;
}

/** S2 chunking rule (pure): a request that does not end a sentence was split mid-sentence (S1's per-phrase style). */
export function phraseWarningsFor(phrases: ReadonlyArray<{ id: string; text: string }>): string[] {
  return phrases
    .filter((p) => !SENTENCE_END_RE.test(p.text))
    .map((p) => `${p.id}: "${p.text.trim().slice(-24)}" does not end a sentence — S2 synthesises one whole sentence/thought per request (join it with the next line)`);
}

/** Synthesise every phrase (cached), trim, lay out with audible pauses, and return words + timing + layout. */
export async function synthesizeNarrationV3(input: readonly V3Phrase[], opts: V3TtsOptions): Promise<V3TtsResult> {
  if (!input.length) throw new Error("tts v3: no phrases");
  const voice = opts.voice ?? V3_VOICE;
  const leadMs = Math.max(0, opts.leadMs ?? 0);
  const tailMs = Math.max(0, opts.tailMs ?? DEFAULT_TAIL_MS);
  const log = opts.log ?? (() => {});
  const write = opts.write ?? true;
  const outDir = resolve(opts.outDir);
  const cacheDir = opts.cacheDir ? resolve(opts.cacheDir) : join(outDir, "cache");
  const synth = opts.synth ?? edgeSynth({ ...opts, log });
  const defaultRate = opts.rate ?? V3_DEFAULT_RATE;
  const phrases: Array<V3Phrase & { rate: string }> = input.map((p) => ({ ...p, rate: p.rate ?? defaultRate }));
  for (const p of phrases) {
    if (!/^[+-]\d{1,2}%$/.test(p.rate)) throw new Error(`tts v3: ${p.id}: bad rate "${p.rate}"`);
    if (!Number.isFinite(p.pauseAfterMs) || p.pauseAfterMs < 0) throw new Error(`tts v3: ${p.id}: bad pauseAfterMs ${p.pauseAfterMs}`);
    if (!p.text.trim()) throw new Error(`tts v3: ${p.id}: empty text`);
  }
  const rateWarnings = rateWarningsFor(phrases);
  const phraseWarnings = phraseWarningsFor(phrases);
  [...rateWarnings, ...phraseWarnings].forEach((w) => log(`warn: ${w}`));
  if (write || opts.cacheDir) await mkdir(cacheDir, { recursive: true });

  // 1. synth + trim each phrase
  const clips: Array<{ p: V3Phrase & { rate: string }; key: string; cached: boolean; pcm: Int16Array; leadPad: number; tailPad: number; words: V3Word[]; snapped: number; quality: ReconcileStats; source: V3LineResult["timingSource"] }> = [];
  for (const [i, p] of phrases.entries()) {
    if (opts.signal?.aborted) throw abortError();
    const key = phraseCacheKey(voice, p.rate, p.text);
    const cacheBase = join(cacheDir, key);
    const cached = existsSync(`${cacheBase}.mp3`) && existsSync(`${cacheBase}.json`);
    const s = await synth({ text: p.text, voice, rate: p.rate, cacheBase }, opts.signal);
    if (s.sampleRate !== SAMPLE_RATE) throw new Error(`tts v3: ${p.id}: sample rate ${s.sampleRate} ≠ ${SAMPLE_RATE}`);
    const tb = trimBounds(s.pcm, s.boundaries.length ? Math.min(...s.boundaries.map((b) => b.startMs)) : undefined);
    if (!tb) throw new Error(`tts v3: ${p.id}: no audio above ${TRIM_THRESH_DB} dBFS`);
    const pcm = fadeIn(s.pcm.slice(tb.a, tb.b));
    const cutMs = samplesToMs(tb.a);
    const durMs = samplesToMs(pcm.length);
    const shifted = s.boundaries.map((b) => ({ text: b.text, startMs: b.startMs - cutMs, endMs: b.endMs - cutMs }));
    let { words, stats } = reconcileWords(p.text, shifted, durMs);
    let source: V3LineResult["timingSource"] = "edge-tts";
    if ((shifted.length === 0 || stats.quality < MIN_QUALITY) && opts.align) {
      const tmpWav = join(outDir, `align_${key}.wav`);
      await mkdir(outDir, { recursive: true });
      await writeFile(tmpWav, wavBytes(pcm));
      try {
        const w = await opts.align(tmpWav, p.text, opts.signal);
        const r = reconcileWords(p.text, w, durMs);
        if (shifted.length === 0 || r.stats.quality >= stats.quality) {
          words = r.words;
          stats = r.stats;
          source = "whisper-aligned";
        }
      } finally {
        await rm(tmpWav, { force: true });
      }
    }
    const ws: V3Word[] = words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
    const pads = samplePads(pcm);
    const snapped = snapWordsOutOfSilence(ws, innerSilences(pcm), samplesToMs(pads.lead));
    log(`${p.id}: ${cached ? "cached" : "synth"} ${durMs.toFixed(0)} ms @ ${p.rate}, ${source}, quality ${stats.quality.toFixed(2)}, snapped ${snapped} (${i + 1}/${phrases.length})`);
    clips.push({ p, key, cached, pcm, leadPad: samplesToMs(pads.lead), tailPad: samplesToMs(pads.tail), words: ws, snapped, quality: stats, source });
  }

  // 2. layout in samples (sample-exact; ms derived from samples)
  const leadGap = Math.max(0, msToSamples(leadMs) - msToSamples(clips[0].leadPad));
  let cursor = leadGap;
  const lines: V3LineResult[] = [];
  const parts: Int16Array[] = [new Int16Array(leadGap)];
  clips.forEach((c, i) => {
    const next = clips[i + 1];
    const isLast = !next;
    const want = isLast ? 0 : c.p.pauseAfterMs;
    const padSum = isLast ? 0 : msToSamples(c.tailPad) + msToSamples(next.leadPad);
    const gap = isLast ? 0 : Math.max(0, msToSamples(want) - padSum);
    const audible = isLast ? 0 : samplesToMs(padSum + gap);
    const beatId = c.p.beatId ?? `b${String(i + 1).padStart(2, "0")}`;
    lines.push({
      id: c.p.id,
      beatId,
      text: c.p.text,
      rate: c.p.rate,
      cacheKey: c.key,
      cached: c.cached,
      timingSource: c.source,
      durationMs: samplesToMs(c.pcm.length),
      samples: c.pcm.length,
      leadPadMs: c.leadPad,
      tailPadMs: c.tailPad,
      audioStartMs: samplesToMs(cursor),
      pauseAfterMs: want,
      gapAfterMs: samplesToMs(gap),
      audiblePauseMs: +audible.toFixed(3),
      excessMs: isLast ? 0 : +Math.max(0, audible - want).toFixed(3),
      words: c.words,
      quality: c.quality,
      snapped: c.snapped,
      file: write ? join(outDir, `beat_${beatId.slice(1)}.wav`) : undefined,
    });
    parts.push(c.pcm);
    cursor += c.pcm.length;
    if (!isLast) {
      parts.push(new Int16Array(gap));
      cursor += gap;
    }
  });
  const tailS = msToSamples(tailMs);
  parts.push(new Int16Array(tailS));
  const total = cursor + tailS;

  const layoutKey = createHash("sha256")
    .update(JSON.stringify([CACHE_V, TRIM_V, voice, leadMs, tailMs, TRIM_THRESH_DB, TRIM_LEAD_KEEP_MS, TRIM_TAIL_KEEP_MS, phrases.map((p) => [p.id, p.text, p.rate, p.pauseAfterMs])]))
    .digest("hex")
    .slice(0, 20);

  const allWords = lines.flatMap((l) => l.words.map((w) => ({ text: w.text, startMs: l.audioStartMs + w.startMs, endMs: l.audioStartMs + w.endMs, lineId: l.id })));
  const timing: NarrativeTiming = {
    totalSec: +(samplesToMs(total) / 1000).toFixed(3),
    lines: lines.map((l) => ({
      id: l.id,
      startSec: +(l.audioStartMs / 1000).toFixed(4),
      wordTimes: toLineWords(l.words).map((w) => ({ text: w.text, startSec: +((l.audioStartMs + w.startMs) / 1000).toFixed(4), endSec: +((l.audioStartMs + w.endMs) / 1000).toFixed(4) })),
    })),
  };
  const sources = [...new Set(lines.map((l) => l.timingSource))].sort().join("+");
  const result: V3TtsResult = {
    voice,
    engine: "edge-tts",
    sampleRate: SAMPLE_RATE,
    leadMs,
    tailMs,
    layout: { leadMs, beats: lines.map((l) => ({ beatId: l.beatId, lineId: l.id, pauseAfterMs: l.pauseAfterMs })) },
    rateWarnings,
    phraseWarnings,
    layoutKey,
    lines,
    words: { beats: lines.map((l) => ({ beatId: l.beatId, durationSec: l.samples / SAMPLE_RATE, leadPadMs: l.leadPadMs, tailPadMs: l.tailPadMs, words: l.words, file: l.file })), timingSource: sources, voice, provider: "edge" },
    timing,
    allWords,
    totalMs: samplesToMs(total),
  };

  // 3. files
  if (write) {
    for (const [i, l] of lines.entries()) await writeAtomic(l.file!, wavBytes(clips[i].pcm));
    const all = new Int16Array(total);
    let o = 0;
    for (const part of parts) {
      all.set(part, o);
      o += part.length;
    }
    result.narrationFile = join(outDir, "narration.wav");
    await writeAtomic(result.narrationFile, wavBytes(all));
    await writeAtomic(join(outDir, "words.json"), Buffer.from(JSON.stringify(result.words, null, 1) + "\n"));
    await writeAtomic(join(outDir, "tts-v3.json"), Buffer.from(JSON.stringify(result, null, 1) + "\n"));
  }
  return result;
}

/** PCM of the assembled narration (for tests / measurement without writing files). */
export function assemblePcm(result: V3TtsResult, clipPcm: readonly Int16Array[]): Int16Array {
  const total = msToSamples(result.totalMs);
  const out = new Int16Array(total);
  result.lines.forEach((l, i) => out.set(clipPcm[i], msToSamples(l.audioStartMs)));
  return out;
}

async function writeAtomic(file: string, data: Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
