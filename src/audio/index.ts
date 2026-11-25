// AudioModule (src/contracts.ts): narration TTS + word timings, ffmpeg mastering/preview/stills/measurement.
//
// Everything heavy runs as a `nice -n 19` child (see proc.ts) one at a time — the pipeline calls these methods
// sequentially. Env knobs (all optional): REEL_PYTHON, REEL_PY_DIR, REEL_TTS (edge|elevenlabs), REEL_TTS_RATE,
// REEL_WHISPER_MODEL, REEL_WHISPER_DIR, REEL_WHISPER_THREADS, REEL_FFMPEG, REEL_FFPROBE, REEL_FFMPEG_THREADS,
// ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AudioModule, MediaReport, Progress, TtsResult } from "../contracts.js";
import type { Script } from "../schema/index.js";
import * as media from "./media.js";
import { synthesizeScript, whisperAlign, type Provider, type TtsOptions } from "./tts.js";

export { reconcileWords, type Boundary, type ReconcileResult, type ReconcileStats } from "./align.js";
export { beatName } from "./tts.js";

export interface AudioModuleOptions {
  python?: string;
  /** Directory holding tts.py / align.py. */
  pyDir?: string;
  provider?: Provider;
  /** edge-tts prosody rate, e.g. "+5%". */
  rate?: string;
  whisperModel?: string;
  whisperDir?: string;
  whisperThreads?: number;
  ffmpeg?: string;
  ffprobe?: string;
  ffmpegThreads?: number;
  /** Prefix children with `nice -n 19` (default true). */
  nice?: boolean;
  minQuality?: number;
  log?: (s: string) => void;
  env?: NodeJS.ProcessEnv;
}

/** Walk up from this file until a dir containing py/tts.py (works from src/ under tsx and from dist/ when built). */
function findRepoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, "py", "tts.py"))) return d;
    d = dirname(d);
  }
  return process.cwd();
}

export function resolveAudioOptions(opts: AudioModuleOptions = {}): TtsOptions {
  const env = opts.env ?? process.env;
  const root = findRepoRoot();
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const wantProvider = opts.provider ?? (env.REEL_TTS as Provider | undefined) ?? (apiKey ? "elevenlabs" : "edge");
  // ElevenLabs without a key silently means edge-tts (must never crash when absent).
  const provider: Provider = wantProvider === "elevenlabs" && apiKey ? "elevenlabs" : "edge";
  return {
    python: opts.python ?? env.REEL_PYTHON ?? join(root, ".venv", "bin", "python"),
    pyDir: opts.pyDir ?? env.REEL_PY_DIR ?? join(root, "py"),
    rate: opts.rate ?? env.REEL_TTS_RATE ?? "+0%",
    whisperModel: opts.whisperModel ?? env.REEL_WHISPER_MODEL ?? "base",
    whisperDir: resolve(opts.whisperDir ?? env.REEL_WHISPER_DIR ?? join(root, "data", "whisper")),
    whisperThreads: opts.whisperThreads ?? Number(env.REEL_WHISPER_THREADS ?? 2),
    provider,
    elevenLabs: apiKey
      ? { apiKey, voiceId: env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM", modelId: env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2" }
      : undefined,
    minQuality: opts.minQuality ?? 0.75,
    ffmpeg: opts.ffmpeg ?? env.REEL_FFMPEG ?? "ffmpeg",
    ffprobe: opts.ffprobe ?? env.REEL_FFPROBE ?? "ffprobe",
    threads: opts.ffmpegThreads ?? Number(env.REEL_FFMPEG_THREADS ?? 4),
    nice: opts.nice ?? true,
    log: opts.log ?? (() => {}),
  };
}

export interface ExtendedAudioModule extends AudioModule {
  readonly options: Readonly<Omit<TtsOptions, "elevenLabs">> & { elevenLabs: boolean };
  /** Direct whisper alignment of one file (diagnostics / smoke test). */
  whisperAlign(audio: string, prompt: string, language: string, signal?: AbortSignal): ReturnType<typeof whisperAlign>;
}

export function createAudioModule(opts: AudioModuleOptions = {}): ExtendedAudioModule {
  const o = resolveAudioOptions(opts);
  const { elevenLabs, ...rest } = o;
  return {
    options: { ...rest, elevenLabs: !!elevenLabs },
    synthesize: (script: Script, jobDir: string, onProgress?: Progress, signal?: AbortSignal): Promise<TtsResult> =>
      synthesizeScript(o, script, jobDir, onProgress, signal),
    masterAudio: (inMp4, outMp4, signal) => media.masterAudio(o, inMp4, outMp4, signal, o.log),
    makePreview: (inMp4, outMp4, maxBytes, signal) => media.makePreview(o, inMp4, outMp4, maxBytes, signal, o.log),
    extractStills: (inMp4, outDir, atSec) => media.extractStills(o, inMp4, outDir, atSec),
    measure: (mp4): Promise<MediaReport> => media.measure(o, mp4),
    whisperAlign: (audio, prompt, language, signal) => whisperAlign(o, audio, prompt, language, signal),
  };
}
