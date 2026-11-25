// Real edge-tts narration + word timings for v2 storyboard beats, through the v1 audio module (src/audio/tts.ts: one
// edge-tts call per beat with WordBoundary events, edge trim to 50 ms lead / 100 ms tail, reconcile onto the phrase
// tokens, whisper fallback for garbled boundaries). Voice/rate per D1 / amendments §8: en-US-AndrewNeural, +8 %. The
// 250 ms beat gaps are not in the audio files: resolveTimeline() places beats GAP_MS apart (timeline.ts, D1 #3).
// Moved from scripts/v2/tts-words.ts (W3 P2) so the container-bound director can use it; that script is a thin CLI.
//
// Writes <jobDir>/audio/beat_XX.{mp3,json} (per-beat cache keyed on provider+voice+rate+text, so a re-run only
// re-synthesises changed phrases). Network: edge-tts only. No secrets are read.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createAudioModule } from "../../audio/index.js";
import type { AudioModule } from "../../contracts.js";
import type { Script } from "../../schema/index.js";
import type { WordsFileT } from "../../schema/storyboard.v2.js";

export const V2_VOICE = "en-US-AndrewNeural";
export const V2_RATE = "+8%";

/** v1 TtsResult beats (numeric ids) → v2 words.json beats ("bNN" ids). */
export function toV2Words(beats: { beatId: number; durationSec: number; words: { text: string; startMs: number; endMs: number }[] }[], timingSource: string): WordsFileT {
  return {
    beats: beats.map((b) => ({
      beatId: `b${String(b.beatId).padStart(2, "0")}`,
      durationSec: Math.round(b.durationSec * 1000) / 1000,
      words: b.words.map((w) => ({ text: w.text, startMs: Math.round(w.startMs), endMs: Math.round(w.endMs) })),
    })),
    timingSource,
    voice: V2_VOICE,
    provider: "edge",
  };
}

export interface TtsWordsOptions {
  /** Injectable for tests; default createAudioModule({ provider: "edge", rate: V2_RATE }). */
  audio?: Pick<AudioModule, "synthesize">;
  log?: (s: string) => void;
  signal?: AbortSignal;
}

/** Synthesise (or reuse the per-beat cache in <jobDir>/audio) and return the v2 words.json for these beats. */
export async function ttsWords(beats: readonly { id: string; phrase: string }[], jobDir: string, opts: TtsWordsOptions = {}): Promise<WordsFileT> {
  const log = opts.log ?? ((s: string) => console.error(s));
  for (const b of beats) if (!/^b\d{2}$/.test(b.id)) throw new Error(`tts: beat id "${b.id}" is not bNN`);
  // Only the fields synthesizeScript() reads (beats[].id/narration, voice, language).
  const script = {
    voice: V2_VOICE,
    language: "en-US",
    beats: beats.map((b) => ({ id: Number(b.id.slice(1)), narration: b.phrase })),
  } as unknown as Script;
  mkdirSync(jobDir, { recursive: true });
  const audio = opts.audio ?? createAudioModule({ provider: "edge", rate: V2_RATE, log });
  const r = await audio.synthesize(script, path.resolve(jobDir), undefined, opts.signal);
  return toV2Words(r.beats, r.timingSource);
}
