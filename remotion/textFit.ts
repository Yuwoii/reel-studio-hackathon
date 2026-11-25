// Rough text measurement without a DOM: per-font average glyph width (em) → greedy line wrap → font size that
// fits N lines in a box. Good enough to keep captions/titles inside the safe zone; the containers also clip.

export function charWidthEm(family: string): number {
  return /press start/i.test(family) ? 1.0 : 0.66; // Montserrat Black averages ~0.62em (mixed case), caps ~0.72
}

export function wrapLines(words: string[], maxChars: number): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const w of words) {
    const add = (cur.length ? 1 : 0) + w.length;
    if (cur.length && len + add > maxChars) {
      lines.push(cur);
      cur = [w];
      len = w.length;
    } else {
      cur.push(w);
      len += add;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Largest font size ≤ base (down to minFrac·base) whose wrap fits in maxLines and whose longest word fits. */
export function fitFontSize(words: string[], family: string, base: number, boxWidth: number, maxLines: number, minFrac = 0.55, upper = false): number {
  const em = charWidthEm(family) * (upper && !/press start/i.test(family) ? 1.1 : 1);
  for (let size = base; size >= base * minFrac; size -= 2) {
    const maxChars = Math.floor(boxWidth / (size * em));
    if (maxChars < 1) continue;
    if (words.some((w) => w.length > maxChars)) continue;
    if (wrapLines(words, maxChars).length <= maxLines) return size;
  }
  return Math.floor(base * minFrac);
}

/** Same as wrapLines but returns word indices per line. */
export function wrapIndices(words: string[], maxChars: number): number[][] {
  let i = 0;
  return wrapLines(words, maxChars).map((ln) => ln.map(() => i++));
}
