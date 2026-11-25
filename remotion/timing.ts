// Beat timing for the Remotion bundle. Re-implements src/schema's beatFrames()/totalFrames() because remotion/
// may only `import type` from src/schema (webpack can't resolve its NodeNext ".js" runtime imports).
// test/remotion-timing.test.ts proves both implementations agree.

import type { BeatAudio } from "../src/schema/index.js";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const BEAT_PAD_SEC = 0.3;
export const COMPOSITION_ID = "Reel";

export function beatFrames(audio: Pick<BeatAudio, "durationSec">[]): number[] {
  return audio.map((a) => Math.ceil((a.durationSec + BEAT_PAD_SEC) * FPS));
}

export function totalFrames(audio: Pick<BeatAudio, "durationSec">[]): number {
  return beatFrames(audio).reduce((a, b) => a + b, 0);
}

/** Start frame of every beat (prefix sums of beatFrames). */
export function beatStarts(frames: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const f of frames) {
    out.push(acc);
    acc += f;
  }
  return out;
}
