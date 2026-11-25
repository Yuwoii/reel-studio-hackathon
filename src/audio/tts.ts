// Narration per beat: TTS → trimmed beat_XX.mp3 → aligned word timings reconciled onto the narration tokens.
//
// Providers: edge-tts (default; WordBoundary events give timings directly) or ElevenLabs (only if
// ELEVENLABS_API_KEY is set; no word events → faster-whisper aligns). If edge-tts boundaries are missing or don't
// match the narration (reconcile quality < 0.75), that beat is re-timed with whisper ("whisper-aligned").
//
// Beat edges are trimmed: edge-tts pads ~0.15 s before and ~0.35 s after the speech. With the composition's 0.3 s
// per-beat pad that would leave ~0.8 s of silence between beats — over the 0.7 s acceptance limit — so we keep
// 50 ms lead / 100 ms tail and shift the boundaries by the cut.
//
// Results are cached per beat (audio/beat_XX.json holds a hash of provider+voice+rate+text): a ✏️ revision that only
// changes visuals re-uses the audio instead of re-synthesising.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Progress, TtsResult } from "../contracts.js";
import type { Script } from "../schema/index.js";
import { reconcileWords, type Boundary, type ReconcileStats } from "./align.js";
import { decodedDurationSec, parseSilences, type MediaOptions } from "./media.js";
import { abortError, run, runRaw } from "./proc.js";

export type Provider = "edge" | "elevenlabs";

export interface TtsOptions extends MediaOptions {
  python: string;
  pyDir: string;
  rate: string;
  whisperModel: string;
  whisperDir: string;
  whisperThreads: number;
  provider: Provider;
  elevenLabs?: { apiKey: string; voiceId: string; modelId: string };
  /** Below this reconcile quality the edge-tts boundaries count as garbled → whisper. */
  minQuality: number;
  log: (s: string) => void;
}

interface BeatMeta {
  v: 2; // 2: durationSec = decoded samples / rate (v1 used the mp3 header duration)
  hash: string;
  timingSource: "edge-tts" | "whisper-aligned" | "elevenlabs";
  cutStartMs: number;
  durationSec: number;
  boundaries: Boundary[];
  stats: ReconcileStats;
}

const KEEP_LEAD_SEC = 0.05;
const KEEP_TAIL_SEC = 0.1;

export const beatName = (id: number) => `beat_${String(id).padStart(2, "0")}`;

export async function synthesizeScript(o: TtsOptions, script: Script, jobDir: string, onProgress?: Progress, signal?: AbortSignal): Promise<TtsResult> {
  try {
    return await synthesizeAll(o, o.provider, script, jobDir, onProgress, signal);
  } catch (e) {
    if (o.provider !== "elevenlabs" || (e as Error).name === "AbortError") throw e;
    // Never mix voices inside one reel: on any ElevenLabs failure redo every beat with edge-tts.
    o.log(`elevenlabs failed (${(e as Error).message}) → falling back to edge-tts for all beats`);
    return synthesizeAll(o, "edge", script, jobDir, onProgress, signal);
  }
}

async function synthesizeAll(o: TtsOptions, provider: Provider, script: Script, jobDir: string, onProgress?: Progress, signal?: AbortSignal): Promise<TtsResult> {
  const audioDir = join(jobDir, "audio");
  await mkdir(audioDir, { recursive: true });
  const n = script.beats.length;
  const beats: TtsResult["beats"] = [];
  const sources = new Set<string>();
  for (const [i, beat] of script.beats.entries()) {
    if (signal?.aborted) throw abortError();
    onProgress?.("TTS", `${i + 1}/${n}`, i / n);
    const r = await synthesizeBeat(o, provider, script, beat.id, beat.narration, audioDir, signal);
    beats.push(r.beat);
    sources.add(r.timingSource);
  }
  onProgress?.("TTS", `${n}/${n}`, 1);
  const result: TtsResult = { beats, timingSource: [...sources].sort().join("+") };
  await writeJsonAtomic(join(audioDir, "words.json"), { ...result, voice: script.voice, provider, generatedAt: new Date().toISOString() });
  return result;
}

async function synthesizeBeat(o: TtsOptions, provider: Provider, script: Script, beatId: number, text: string, audioDir: string, signal?: AbortSignal) {
  const name = beatName(beatId);
  const mp3 = join(audioDir, `${name}.mp3`);
  const metaFile = join(audioDir, `${name}.json`);
  const voice = provider === "elevenlabs" ? `elevenlabs:${o.elevenLabs?.voiceId}:${o.elevenLabs?.modelId}` : script.voice;
  const hash = createHash("sha256").update(JSON.stringify([provider, voice, o.rate, text])).digest("hex").slice(0, 16);

  let meta = await readMeta(metaFile);
  if (!meta || meta.hash !== hash || !existsSync(mp3)) {
    meta = await produceBeat(o, provider, script, text, mp3, hash, signal);
    await writeJsonAtomic(metaFile, meta);
  } else {
    o.log(`${name}: cached (${meta.timingSource})`);
  }
  const { words } = reconcileWords(text, meta.boundaries, meta.durationSec * 1000);
  return { beat: { beatId, file: mp3, durationSec: meta.durationSec, words }, timingSource: meta.timingSource };
}

async function produceBeat(o: TtsOptions, provider: Provider, script: Script, text: string, mp3: string, hash: string, signal?: AbortSignal): Promise<BeatMeta> {
  const raw = mp3.replace(/\.mp3$/, ".raw.mp3");
  let boundaries: Boundary[] = [];
  if (provider === "elevenlabs") await elevenLabsTts(o, text, raw, signal);
  else boundaries = await edgeTts(o, text, script.voice, raw, signal);

  const cutStartSec = await trimEdges(o, raw, mp3, signal);
  await rm(raw, { force: true });
  const durationSec = await decodedDurationSec(o, mp3, signal);
  const durMs = durationSec * 1000;
  boundaries = boundaries.map((b) => ({ text: b.text, startMs: b.startMs - cutStartSec * 1000, endMs: b.endMs - cutStartSec * 1000 }));

  let timingSource: BeatMeta["timingSource"] = provider === "elevenlabs" ? "elevenlabs" : "edge-tts";
  let stats = reconcileWords(text, boundaries, durMs).stats;
  const lastEnd = boundaries.at(-1)?.endMs ?? 0;
  const garbled = boundaries.length === 0 || stats.quality < o.minQuality || lastEnd > durMs + 300;
  if (garbled) {
    if (provider === "edge") o.log(`${mp3}: edge-tts boundaries unusable (n=${boundaries.length}, quality=${stats.quality.toFixed(2)}) → whisper`);
    const w = await whisperAlign(o, mp3, text, script.language, signal);
    const ws = reconcileWords(text, w, durMs).stats;
    // Keep whichever source matches the narration better (whisper can be worse on very short beats).
    if (boundaries.length === 0 || ws.quality >= stats.quality) {
      boundaries = w;
      stats = ws;
      if (provider === "edge") timingSource = "whisper-aligned";
    }
  }
  o.log(`${mp3}: ${durationSec.toFixed(3)} s, ${timingSource}, quality ${stats.quality.toFixed(2)} (exact ${stats.exact}/${stats.tokens}, interp ${stats.interpolated})`);
  return { v: 2, hash, timingSource, cutStartMs: Math.round(cutStartSec * 1000), durationSec, boundaries, stats };
}

async function edgeTts(o: TtsOptions, text: string, voice: string, out: string, signal?: AbortSignal): Promise<Boundary[]> {
  const r = await run([o.python, join(o.pyDir, "tts.py")], {
    input: JSON.stringify({ text, voice, out, rate: o.rate }),
    // 3 attempts × (connect 15 + receive 60) + backoff; network-bound, nice is cheap anyway.
    timeoutMs: 4 * 60_000,
    signal,
    nice: o.nice,
  });
  const j = JSON.parse(r.stdout) as { boundaries: Boundary[]; attempts: number };
  if (j.attempts > 1) o.log(`edge-tts needed ${j.attempts} attempts`);
  return j.boundaries;
}

/** faster-whisper word timestamps (py/align.py). Exported for the smoke script. */
export async function whisperAlign(o: TtsOptions, audio: string, prompt: string, language: string, signal?: AbortSignal): Promise<Boundary[]> {
  const r = await run([o.python, join(o.pyDir, "align.py")], {
    input: JSON.stringify({ audio, prompt, language }),
    env: { ...process.env, REEL_WHISPER_MODEL: o.whisperModel, REEL_WHISPER_DIR: o.whisperDir, REEL_WHISPER_THREADS: String(o.whisperThreads), REEL_FFMPEG: o.ffmpeg },
    timeoutMs: 15 * 60_000, // first run downloads the model
    signal,
    nice: o.nice,
  });
  return (JSON.parse(r.stdout) as { words: Boundary[] }).words;
}

async function elevenLabsTts(o: TtsOptions, text: string, out: string, signal?: AbortSignal): Promise<void> {
  const el = o.elevenLabs;
  if (!el) throw new Error("ElevenLabs not configured");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(el.voiceId)}?output_format=mp3_44100_128`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": el.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: el.modelId }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
      // Body text only (never headers) — the key is in a request header, not echoed back.
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error("ElevenLabs returned empty audio");
      await writeFile(out, buf);
      return;
    } catch (e) {
      if (signal?.aborted) throw abortError();
      lastErr = e;
      const status = /HTTP (\d+)/.exec((e as Error).message)?.[1];
      if (status && Number(status) < 500 && status !== "429") break; // 4xx (bad key/voice) won't fix itself
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Cut leading/trailing silence to KEEP_LEAD/KEEP_TAIL and re-encode to mp3. Returns seconds cut from the start
 * (to shift the boundaries). If there is nothing worth trimming, the file is just renamed.
 */
async function trimEdges(o: MediaOptions, raw: string, out: string, signal?: AbortSignal): Promise<number> {
  const dur = await decodedDurationSec(o, raw, signal);
  const r = await runRaw([o.ffmpeg, "-hide_banner", "-nostdin", "-nostats", "-i", raw, "-af", "silencedetect=noise=-45dB:d=0.03", "-f", "null", "-"], { nice: o.nice, signal, timeoutMs: 60_000 });
  const sil = r.code === 0 ? parseSilences(r.stderr, dur) : [];
  const lead = sil[0] && sil[0].startSec <= 0.01 ? sil[0].endSec : 0;
  const lastSil = sil.at(-1);
  const tailStart = lastSil && lastSil.endSec >= dur - 0.01 && lastSil.startSec > lead ? lastSil.startSec : dur;
  const cutStart = Math.max(0, lead - KEEP_LEAD_SEC);
  const cutEnd = Math.min(dur, tailStart + KEEP_TAIL_SEC);
  if (cutStart < 0.03 && dur - cutEnd < 0.03) {
    await rename(raw, out);
    return 0;
  }
  const tmp = out + ".tmp.mp3";
  await run(
    [o.ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", raw, "-ss", cutStart.toFixed(3), "-to", cutEnd.toFixed(3), "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", tmp],
    { nice: o.nice, signal, timeoutMs: 60_000 },
  );
  await rename(tmp, out);
  return cutStart;
}

async function readMeta(file: string): Promise<BeatMeta | null> {
  try {
    const m = JSON.parse(await readFile(file, "utf8")) as BeatMeta;
    return m.v === 2 ? m : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, file);
}
