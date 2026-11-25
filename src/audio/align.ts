// Word-timing reconciliation: narration tokens ← aligned boundaries (edge-tts WordBoundary or faster-whisper words).
//
// The caption track must match the narration WORD-FOR-WORD, so the output tokens are always the narration split on
// whitespace (punctuation stays attached: "again?"). The aligner's words are only a source of TIMES. They differ from
// the narration in predictable ways: punctuation dropped, numbers spoken/merged ("In 1990" is ONE edge-tts boundary,
// whisper may write "nineteen ninety"), hyphenated words split, symbols spelled out ("45%" → "45 percent"), and
// whisper occasionally mishears or drops a word. A small DP sequence alignment with m:n groups (≤3:3) handles all of
// these; tokens the DP cannot place get interpolated times. Pure + synchronous so it can be unit-tested exhaustively.

import type { WordTiming } from "../schema/index.js";

/** One aligned word from the TTS/aligner, times relative to the beat's audio start. */
export interface Boundary {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ReconcileStats {
  tokens: number;
  boundaries: number;
  /** Tokens whose group matched exactly (after normalisation / number spelling). */
  exact: number;
  /** Tokens in a fuzzy (similar but not equal) group. */
  fuzzy: number;
  /** Tokens with no boundary at all → interpolated. */
  interpolated: number;
  /** (exact + 0.5·fuzzy) / tokens — used to decide whether to fall back to whisper. */
  quality: number;
}

export interface ReconcileResult {
  words: WordTiming[];
  stats: ReconcileStats;
}

// ── normalisation ──────────────────────────────────────────────────────────────────────────────────────────────────

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ONES[n % 10] : "");
}
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return under100(r);
  return ONES[h] + "hundred" + (r ? "and" + under100(r) : "");
}
/** English cardinal, no spaces/hyphens ("1234" → "onethousandtwohundredandthirtyfour"). Integers < 1e9 only. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e9) return String(n);
  if (n < 1000) return under1000(n);
  const parts: string[] = [];
  const m = Math.floor(n / 1e6);
  const k = Math.floor((n % 1e6) / 1000);
  const r = n % 1000;
  if (m) parts.push(under1000(m) + "million");
  if (k) parts.push(under1000(k) + "thousand");
  if (r) parts.push(r < 100 ? "and" + under100(r) : under1000(r));
  return parts.join("");
}

/** Spoken variants of a digit string: cardinal, and year-style for 1100–2099 ("1990" → "nineteenninety"). */
function spokenNumbers(digits: string): string[] {
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return [];
  const out = new Set<string>([numberToWords(n), numberToWords(n).replace(/and/g, "")]);
  if (digits.length === 4 && n >= 1100 && n <= 2099 && n % 100 !== 0) {
    const hi = Math.floor(n / 100);
    const lo = n % 100;
    out.add(under100(hi) + (lo < 10 ? "oh" + ONES[lo] : under100(lo)));
    if (n >= 2000 && n < 2010) out.add("twothousand" + (lo ? ONES[lo] : ""));
  }
  if (digits.length === 4 && n % 100 === 0 && n >= 1100 && n <= 1900) out.add(under100(n / 100) + "hundred");
  return [...out];
}

const SYMBOLS: Array<[RegExp, string]> = [
  [/%/g, " percent "],
  [/&/g, " and "],
  [/\+/g, " plus "],
  [/°c\b/gi, " degrees celsius "],
  [/°f\b/gi, " degrees fahrenheit "],
  [/°/g, " degrees "],
];

/** Plain normalisation: NFKC, lowercase, strip diacritics, keep letters+digits only. "Didn't!" → "didnt". */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** All normalised spellings of a text: as written, with symbols spelled out, with numbers spelled out. */
export function variants(s: string): string[] {
  const out = new Set<string>([norm(s)]);
  let spelled = s;
  for (const [re, w] of SYMBOLS) spelled = spelled.replace(re, w);
  // "$5" → "5 dollars" (spoken order differs from written order)
  spelled = spelled.replace(/\$(\d[\d,.]*)/g, "$1 dollars ").replace(/€(\d[\d,.]*)/g, "$1 euros ");
  out.add(norm(spelled));
  // thousands separators: "1,000" → "1000"; decimals: "2.5" → "2 point 5"
  const plain = spelled.replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d)\.(\d)/g, "$1 point $2");
  const numberSpelled = plain.replace(/\d+/g, (d) => " " + (spokenNumbers(d)[0] ?? d) + " ");
  out.add(norm(numberSpelled));
  // year-style alternative for every 4-digit group
  const yearSpelled = plain.replace(/\d+/g, (d) => " " + (spokenNumbers(d).at(-1) ?? d) + " ");
  out.add(norm(yearSpelled));
  out.delete("");
  return [...out];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common (normalised Levenshtein ratio over the best variant pair). */
function similarity(aVars: string[], bVars: string[]): number {
  let best = 0;
  for (const a of aVars)
    for (const b of bVars) {
      if (!a || !b) continue;
      if (a === b) return 1;
      best = Math.max(best, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
    }
  return best;
}

// ── alignment ──────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_GROUP = 3;
const SKIP_TOKEN = 1.1; // token without a boundary (interpolated)
const SKIP_EMPTY_TOKEN = 0.01; // pure punctuation token ("—") never has a boundary
const SKIP_BOUNDARY = 1.0; // extra boundary (whisper hallucination / filler)
const GROUP_PENALTY = 0.08; // per extra member: prefer 1:1 when equally good
/** Below this similarity a group counts as "fuzzy-mismatched" (still placed, but lowers quality). */
const FUZZY_OK = 0.6;

interface Step {
  kind: "group" | "skipToken" | "skipBoundary";
  m: number; // tokens consumed
  n: number; // boundaries consumed
  sim: number;
}

/** Clean aligner output: finite, sorted, non-negative, end ≥ start, empty text dropped. */
export function sanitizeBoundaries(bs: Boundary[], durationMs: number): Boundary[] {
  return bs
    .filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && norm(b.text) !== "")
    .map((b) => {
      const startMs = Math.max(0, Math.min(b.startMs, durationMs));
      return { text: b.text.trim(), startMs, endMs: Math.max(startMs, Math.min(b.endMs, durationMs)) };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

export function tokenize(narration: string): string[] {
  return narration.trim().split(/\s+/).filter(Boolean);
}

/**
 * Align `narration` tokens with `boundaries` and return one WordTiming per token (text exactly as in the narration),
 * monotonic, non-overlapping, inside [0, durationMs].
 */
export function reconcileWords(narration: string, boundariesIn: Boundary[], durationMs: number): ReconcileResult {
  const tokens = tokenize(narration);
  const bs = sanitizeBoundaries(boundariesIn, durationMs);
  const T = tokens.length;
  const B = bs.length;
  const stats: ReconcileStats = { tokens: T, boundaries: B, exact: 0, fuzzy: 0, interpolated: 0, quality: 0 };
  if (!T) return { words: [], stats };

  const tokVars = tokens.map(variants);
  const bVars = bs.map((b) => variants(b.text));
  // Variants of a concatenated run (i..i+m) — computed on the joined raw text so "In 1990" spells as one number.
  const runCache = new Map<string, string[]>();
  const runVars = (src: "t" | "b", i: number, m: number): string[] => {
    if (m === 1) return src === "t" ? tokVars[i] : bVars[i];
    const key = `${src}${i}:${m}`;
    let v = runCache.get(key);
    if (!v) {
      const parts = src === "t" ? tokens.slice(i, i + m) : bs.slice(i, i + m).map((b) => b.text);
      // Joining with "" AND " " covers both "snow-covered"→"snow","covered" and "In 1990"→"In","1990".
      v = [...new Set([...variants(parts.join(" ")), ...variants(parts.join(""))])];
      runCache.set(key, v);
    }
    return v;
  };

  // cost[i][j] = best cost aligning tokens[0..i) with boundaries[0..j)
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: T + 1 }, () => new Array<number>(B + 1).fill(INF));
  const back: (Step | null)[][] = Array.from({ length: T + 1 }, () => new Array<Step | null>(B + 1).fill(null));
  cost[0][0] = 0;
  const relax = (i: number, j: number, s: Step, c: number) => {
    const ni = i + s.m;
    const nj = j + s.n;
    if (c < cost[ni][nj]) {
      cost[ni][nj] = c;
      back[ni][nj] = s;
    }
  };
  for (let i = 0; i <= T; i++) {
    for (let j = 0; j <= B; j++) {
      const c0 = cost[i][j];
      if (c0 === INF) continue;
      if (i < T) relax(i, j, { kind: "skipToken", m: 1, n: 0, sim: 0 }, c0 + (tokVars[i].length ? SKIP_TOKEN : SKIP_EMPTY_TOKEN));
      if (j < B) relax(i, j, { kind: "skipBoundary", m: 0, n: 1, sim: 0 }, c0 + SKIP_BOUNDARY);
      for (let m = 1; m <= MAX_GROUP && i + m <= T; m++) {
        for (let n = 1; n <= MAX_GROUP && j + n <= B; n++) {
          const sim = similarity(runVars("t", i, m), runVars("b", j, n));
          // Cost scales with group size so a 3:3 fuzzy group is never "cheaper" than three 1:1 exact matches.
          const c = (m + n) * (1 - sim) + GROUP_PENALTY * (m + n - 2);
          relax(i, j, { kind: "group", m, n, sim }, c0 + c);
        }
      }
    }
  }

  // Backtrack into groups.
  const steps: Array<Step & { i: number; j: number }> = [];
  for (let i = T, j = B; i > 0 || j > 0; ) {
    const s = back[i][j];
    if (!s) throw new Error("reconcileWords: alignment backtrack failed"); // unreachable: every cell is reachable
    i -= s.m;
    j -= s.n;
    steps.push({ ...s, i, j });
  }
  steps.reverse();

  // Assign times. null = interpolate later.
  const times: Array<{ startMs: number; endMs: number } | null> = new Array(T).fill(null);
  for (const s of steps) {
    if (s.kind !== "group") {
      if (s.kind === "skipToken") stats.interpolated += s.m;
      continue;
    }
    if (s.sim >= 0.999) stats.exact += s.m;
    else if (s.sim >= FUZZY_OK) stats.fuzzy += s.m;
    else stats.interpolated += s.m; // placed by position only — times are still the best estimate available
    const start = bs[s.j].startMs;
    const end = Math.max(start, ...bs.slice(s.j, s.j + s.n).map((b) => b.endMs));
    splitSpan(start, end, tokens.slice(s.i, s.i + s.m), true).forEach((t, k) => (times[s.i + k] = t));
  }
  fillGaps(tokens, times, durationMs);
  stats.quality = (stats.exact + 0.5 * stats.fuzzy) / T;

  const words = enforceMonotonic(
    tokens.map((text, k) => ({ text, startMs: times[k]!.startMs, endMs: times[k]!.endMs })),
    durationMs,
  );
  return { words, stats };
}

/** Split [start,end] across tokens, proportional to spoken length (or evenly). */
function splitSpan(start: number, end: number, toks: string[], byLength: boolean): Array<{ startMs: number; endMs: number }> {
  const w = toks.map((t) => (byLength ? Math.max(1, (variants(t).at(-1) ?? norm(t)).length) : 1));
  const total = w.reduce((a, b) => a + b, 0);
  const out: Array<{ startMs: number; endMs: number }> = [];
  let acc = 0;
  for (const x of w) {
    const s = start + ((end - start) * acc) / total;
    acc += x;
    out.push({ startMs: s, endMs: start + ((end - start) * acc) / total });
  }
  return out;
}

/** Minimum time a caption word should get when it has to be squeezed in. */
const MIN_WORD_MS = 60;

/** Interpolate runs of untimed tokens between their timed neighbours; borrow time from a neighbour if squeezed. */
function fillGaps(tokens: string[], times: Array<{ startMs: number; endMs: number } | null>, durationMs: number): void {
  const T = tokens.length;
  for (let i = 0; i < T; ) {
    if (times[i]) {
      i++;
      continue;
    }
    let k = i;
    while (k < T && !times[k]) k++; // run [i, k)
    let lo = i;
    let hi = k;
    let start = i > 0 ? times[i - 1]!.endMs : 0;
    let end = k < T ? times[k]!.startMs : durationMs;
    // No boundaries at all → the whole run is the whole file: even spacing (spec).
    const even = i === 0 && k === T;
    if (!even && end - start < MIN_WORD_MS * (k - i)) {
      // Squeezed: merge with the previous (or next) timed token and re-split that combined span by length.
      if (i > 0) {
        lo = i - 1;
        start = times[i - 1]!.startMs;
      } else if (k < T) {
        hi = k + 1;
        end = times[k]!.endMs;
      }
    }
    splitSpan(start, Math.max(start, end), tokens.slice(lo, hi), !even).forEach((t, n) => (times[lo + n] = t));
    i = hi;
  }
}

/** Integer ms, monotonic, non-overlapping, within [0, durationMs]. */
function enforceMonotonic(words: WordTiming[], durationMs: number): WordTiming[] {
  const dur = Math.max(0, Math.round(durationMs));
  let prevEnd = 0;
  return words.map((w) => {
    const startMs = Math.min(dur, Math.max(prevEnd, Math.round(w.startMs)));
    const endMs = Math.min(dur, Math.max(startMs, Math.round(w.endMs)));
    prevEnd = endMs;
    return { text: w.text, startMs, endMs };
  });
}
