// Compat shim (W2.1): the library has ONE scramble, `scramble()` in ../motion.ts (class-preserving; `changedOnly` =
// the old diffScramble behaviour). New code calls scramble(from, to, f, start, durF, seed, { changedOnly: true }).
// This wrapper keeps the old signature for callers not yet migrated; its output is identical to the old helper.
import { commonEnds, scramble } from "../motion";

export { commonEnds };

/**
 * `from` → `to` over [start, start + durF) re-rolling only the changed span. `all` re-rolls every classed glyph of
 * `to` (an explicit `scramble` action on an unchanged value). Delegates to motion.ts scramble().
 */
export function diffScramble(from: string, to: string, frame: number, start: number, durF: number, seed: string, all = false): string {
  if (Math.floor(frame) < start) return from;
  if (from === to && !all) return to;
  if (all) return scramble(to, to, frame, start, durF, seed); // from === to path: every classed glyph rolls
  return scramble(from, to, frame, start, durF, seed, { changedOnly: true });
}
