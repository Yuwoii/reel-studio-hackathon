// Caption tokens = the beat's narration split on whitespace (EXACT text, punctuation attached). Word timings
// come from TTS/whisper and may tokenise differently ("30%" vs "30" "%", dropped punctuation), so we align by
// normalised text and interpolate timings for any token that didn't match. Pure (no imports) → unit-tested.

export interface TimedToken {
  text: string;
  startMs: number;
  endMs: number;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

export function alignCaptionTokens(narration: string, words: { text: string; startMs: number; endMs: number }[], durationMs: number): TimedToken[] {
  const tokens = narration.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const starts: (number | undefined)[] = new Array(tokens.length).fill(undefined);
  const ends: (number | undefined)[] = new Array(tokens.length).fill(undefined);

  if (words.length === tokens.length) {
    words.forEach((w, i) => {
      starts[i] = w.startMs;
      ends[i] = w.endMs;
    });
  } else {
    // Greedy alignment: walk timing words; a token may span several timing words (concatenated) or vice versa.
    let wi = 0;
    for (let ti = 0; ti < tokens.length && wi < words.length; ti++) {
      const target = norm(tokens[ti]);
      if (!target) continue; // pure punctuation token ("—"): interpolated below
      // look ahead a few words for the start of this token
      const end = Math.min(words.length, wi + 4);
      let found = -1;
      for (let k = wi; k < end && found < 0; k++) if (norm(words[k].text) === target) found = k; // exact first
      for (let k = wi; k < end && found < 0; k++) {
        const w = norm(words[k].text);
        if (w && (target.startsWith(w) || w.startsWith(target))) found = k;
      }
      if (found < 0) continue;
      let acc = norm(words[found].text);
      let last = found;
      // a token may span several timing words ("well-known" → "well" "known")
      while (acc.length < target.length && last + 1 < words.length) {
        const next = acc + norm(words[last + 1].text);
        if (!target.startsWith(next)) break;
        acc = next;
        last++;
      }
      starts[ti] = words[found].startMs;
      ends[ti] = words[last].endMs;
      wi = last + 1;
    }
  }

  // Interpolate gaps between known anchors (or the beat edges).
  const known = starts.map((s, i) => (s === undefined ? -1 : i)).filter((i) => i >= 0);
  const firstStart = 0;
  const lastEnd = Math.max(durationMs, 1);
  for (let i = 0; i < tokens.length; i++) {
    if (starts[i] !== undefined) continue;
    const prev = [...known].reverse().find((k) => k < i);
    const next = known.find((k) => k > i);
    const a = prev === undefined ? firstStart : (ends[prev] as number);
    const b = next === undefined ? lastEnd : (starts[next] as number);
    const lo = prev === undefined ? -1 : prev;
    const hi = next === undefined ? tokens.length : next;
    const span = hi - lo - 1;
    const step = (b - a) / Math.max(1, span);
    const idx = i - lo - 1;
    starts[i] = a + idx * step;
    ends[i] = a + (idx + 1) * step;
  }
  return tokens.map((text, i) => ({ text, startMs: starts[i] as number, endMs: Math.max(starts[i] as number, ends[i] as number) }));
}

/** Function words a caption chunk should not END on ("blanket, and the" reads badly; "the snow" is fine). */
const WEAK_TAIL = new Set(
  "a an the and or but nor so to of in on at by for with from into onto as than that this these those my your his her its our their is are was were be been has have had do does did will would can could should if then when while".split(
    " ",
  ),
);
const isWeak = (t: string) => WEAK_TAIL.has(norm(t));

/**
 * Group tokens into chunks of up to `size`: always break after sentence punctuation, break after a comma once the
 * chunk has 2+ words, and when a chunk fills up, carry trailing function words ("and the") over to the next one.
 */
export function chunkTokens<T extends { text: string }>(tokens: T[], size: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const t of tokens) {
    cur.push(t);
    const hardBreak = /[.!?;:]["')\]]*$/.test(t.text) || (/,["')\]]*$/.test(t.text) && cur.length >= 2);
    if (hardBreak) {
      out.push(cur);
      cur = [];
    } else if (cur.length >= size) {
      let cut = cur.length;
      while (cut > 1 && isWeak(cur[cut - 1].text) && !/[,.!?;:]/.test(cur[cut - 1].text)) cut--;
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Case/punctuation-insensitive keyword test for highlighting. */
export const matchesKeyWord = (token: string, keyWord?: string) => !!keyWord && norm(token) !== "" && norm(token) === norm(keyWord);
