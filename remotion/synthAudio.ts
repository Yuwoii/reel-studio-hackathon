// Synthetic beat audio for previews and dev renders: duration ≈ words / 2.6 s and evenly spaced word timings
// derived from the narration. Shared by Root.tsx (Studio defaultProps, url "" = silent) and
// scripts/remotion-fake-props.ts (which also writes matching silent mp3s). No runtime imports on purpose.

import type { BeatAudio } from "../src/schema/index.js";

export const SYNTH_WORDS_PER_SEC = 2.6;

export function synthBeatAudio(beats: { id: number; narration: string }[], urlFor: (beatId: number) => string = () => ""): BeatAudio[] {
  return beats.map((b) => {
    const tokens = b.narration.trim().split(/\s+/).filter(Boolean);
    const durationSec = Math.round((Math.max(1, tokens.length) / SYNTH_WORDS_PER_SEC + 0.2) * 1000) / 1000;
    const lead = 100; // ms of silence before the first word
    const per = (durationSec * 1000 - lead - 100) / Math.max(1, tokens.length);
    return {
      beatId: b.id,
      url: urlFor(b.id),
      durationSec,
      words: tokens.map((text, i) => ({ text, startMs: Math.round(lead + i * per), endMs: Math.round(lead + (i + 0.9) * per) })),
    };
  });
}
