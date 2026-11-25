// Label scramble for the packet-B components (W2.1 fix B r2). One entry point over motion.ts `scramble()`
// (change-only by default; `all` = an explicit re-scramble of an unchanged value), plus a digit MASK: an unsettled
// digit never shows a different valid digit (a paused frame must not read "exit code 100 = 570 + 9" or "found Aug 27").
// It shows MASK_GLYPH in textDim instead; settled digits and digits that never change are shown as they are.
// Discrete on Math.floor(frame) (scramble() floors), pure, seeded.
import React from "react";
import { scramble } from "../motion";
import { color, type ColorToken } from "../theme";

/** ASCII (on the L19 glyph list and in both bundled fonts' cmaps), so the mono advance stays 0.6 em. */
export const MASK_GLYPH = "#";

export interface ScrambleRun {
  text: string;
  masked: boolean;
}

/**
 * `from` → `to` over [start, start + durF): change-only roll (letters roll within their class), digits that are not
 * yet the target digit are masked. `all` re-rolls every classed glyph of `to` (from === to). Outside the window the
 * plain string comes back as one unmasked run.
 */
export function scrambleRuns(from: string, to: string, frame: number, start: number, durF: number, seed: string, all = false): ScrambleRun[] {
  const f = Math.floor(frame);
  if (f < start) return [{ text: from, masked: false }];
  if (f >= start + durF || (from === to && !all)) return [{ text: to, masked: false }];
  const s = all ? scramble(to, to, f, start, durF, seed) : scramble(from, to, f, start, durF, seed, { changedOnly: true });
  // a pure deletion shows the old string shrinking (real old glyphs, no rolled digits): nothing to mask
  if (s.length !== to.length) return [{ text: s, masked: false }];
  const runs: ScrambleRun[] = [];
  for (let i = 0; i < s.length; i++) {
    const masked = /[0-9]/.test(s[i]) && s[i] !== to[i];
    const ch = masked ? MASK_GLYPH : s[i];
    const last = runs[runs.length - 1];
    if (last && last.masked === masked) last.text += ch;
    else runs.push({ text: ch, masked });
  }
  return runs;
}

/** The plain text of a run list (tests, width maths). */
export const runsText = (runs: readonly ScrambleRun[]): string => runs.map((r) => r.text).join("");

/** Draws a run list; masked runs in `maskToken` (textDim). Unmasked runs inherit the parent colour. */
export const ScrambleText: React.FC<{ runs: readonly ScrambleRun[]; maskToken?: ColorToken }> = ({ runs, maskToken = "textDim" }) => (
  <>
    {runs.map((r, i) => (r.masked ? <span key={i} style={{ color: color[maskToken] }}>{r.text}</span> : <React.Fragment key={i}>{r.text}</React.Fragment>))}
  </>
);
