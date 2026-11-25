// PPG (optical heart-rate) light model shared by WatchBack, Glow and Model3D. Pure functions of the frame.
//
// Physics (R1 facts review, BLOCKER W02): the watch's green LEDs flash HUNDREDS of times per second, so on screen they
// read as a constant glow (a tiny fast shimmer at most). What rises and falls with each heartbeat is the green light
// coming BACK to the light sensors (more blood absorbs more green). So:
//   ledLevel(f)        ≈ constant: 0.94 ± 0.04 deterministic shimmer that changes every frame — never at heart rate
//   returnedLevel(f)   1 between beats, dips by `depth` once per beat (fast drop, slower recovery) at `bpm`
// Never drive an LED from returnedLevel / a heartbeat; test/v3-w3a-components.test.ts checks this (LED/heartbeat correlation, dips per beat).

/** Deterministic per-frame hash in [0, 1). */
export function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** LED brightness 0..1 while measuring: steady glow with a fast (per-frame) shimmer of ±amp. */
export function ledLevel(f: number, amp = 0.04): number {
  return 0.94 + amp * (2 * hash01(Math.floor(f)) - 1);
}

/** Phase (0..1) within the current beat; `fps` frames per second. */
export function beatPhase(frame: number, bpm: number, fps = 30, from = 0): number {
  const t = (frame - from) / fps;
  const p = (t * bpm) / 60;
  return p - Math.floor(p);
}

/** Returned-light level: 1 at rest, dips to 1 − depth just after each beat (drop in 12 % of the beat, recover by 60 %). */
export function returnedLevel(frame: number, bpm: number, depth = 0.35, fps = 30, from = 0): number {
  if (frame < from) return 1;
  const ph = beatPhase(frame, bpm, fps, from);
  const dip = ph < 0.12 ? ph / 0.12 : ph < 0.6 ? 1 - (ph - 0.12) / 0.48 : 0;
  const e = dip * dip * (3 - 2 * dip);
  return 1 - depth * e;
}
