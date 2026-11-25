// v3 script model (W1, ADR-002 §7; promoted from research/v3/R4/sketch/script.v3.ts).
//
// v2 had ONE artifact (script.v2.json) in which every phrase had to be a grounded claim mapped to a source quote. That
// shaped the prose into source paraphrases (R5 §2: GR1 + FC2). v3 splits it:
//   narrative.json  written by the director's WRITER turn: lines in the viewer's words, acts, pauses and per-line
//                   rates as data, shot intents, the carrier analogy with "what breaks", terms with the line whose
//                   picture explains them, and a one-name-per-thing table. Lines are NOT grounded one by one.
//   claims.json     written by a fresh-context EXTRACTOR (no tools): every factual claim the narrative makes,
//                   including claims implied by the analogy and by drawn behaviour (R1 §8.6). Then fact-checked on
//                   claims only; a failed claim returns a hint to the writer and is never applied (FC2 retired).
//   sources.json    the research the fact check reads: per source the verbatim quotes (support comes from quotes).
// Data only: no I/O here. The gates live in src/director/v3/*.

import { z } from "zod";

/** R1 acts, in order. Root-cause reels reuse the labels: why = "what went wrong", tradeoff = "how they fixed it". */
export const ACTS = ["hook", "ground", "mechanism", "why", "tradeoff", "payoff", "cta"] as const;
export type Act = (typeof ACTS)[number];
export const ACT_INDEX: Readonly<Record<Act, number>> = Object.freeze(Object.fromEntries(ACTS.map((a, i) => [a, i])) as Record<Act, number>);

/** L01 (TLS), W01 (watch), A01 (ANC), B01 (converted v2 boards): one letter + two digits. */
export const LINE_ID = /^[A-Z]\d{2}$/;
export const CLAIM_ID = /^C\d{2}$/;
/** Same grammar as the asset registry (research/v3/R4/sketch/asset-manifest.ts; W3a's src/v3/assets/manifest.ts). */
export const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/;
export const ANCHOR_NAME = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,2}$/;
export const RATE = /^[+-]\d{1,2}%$/;

export const HOOK_PATTERNS = ["curiosity-question", "myth-twist", "contradiction", "lived-moment", "object-in-hand"] as const;
export type HookPattern = (typeof HOOK_PATTERNS)[number];
export const TRACKS = ["how-it-works", "root-cause"] as const;
/** "reel" = a full 60–75 s reel (acts through the CTA); "opening" = hook + ground + mechanism only (R1 watch/ANC). */
export const SCOPES = ["reel", "opening"] as const;

/** Term budget per reel (R1 §3.3, scorecard C1): code-enforced by terms.ts, zod only caps the array. */
export const TERM_BUDGET = 3;
export const MAX_LINE_CHARS = 160;
/** Script-stage limits the gates read (decisions 3c, 5g; scorecard A3/A4/E1). */
export const HOOK_MAX_LAST_WORD_SEC = 8.5;
/** ADR-002 §8 PA1 / R5 PC1: hook pause ≥ 800 ms (W1 fix round: was 700, which disagreed with PA1 and the prompt). */
export const HOOK_QUESTION_MIN_PAUSE_MS = 800;
export const HOOK_PUNCH_MIN_PAUSE_MS = 800;
export const LEAD_SILENCE_MAX_MS = 700;
export const PAUSE_SD_MIN_MS = 180;
export const TERM_PICTURE_MIN_SEC = 1.5;
export const TERM_PAUSE_MIN_MS = 600;
/** S2 voice rule (D1-DECISIONS-V3 "S2 voice", supersedes decision 3a's −8…−14 % band): one rate for the whole reel,
 *  never slowed, ≈ +5 % and raised (≤ +10 %) only to land ≤ 75 s. Mirrors src/v3/tts.ts RATE_RANGE_PCT (tested). */
export const RATE_S2_PCT = { min: 0, max: 10 } as const;
/** S2 default rate (src/v3/tts.ts V3_DEFAULT_RATE). The S2 reference reel shipped at +8 %. */
export const V3_RATE_DEFAULT = "+5%";
/** S2 deliberate gaps (ms of audible silence after a line; pacing.ts PA1 checks them on the voice):
 *  sink-in after the opening question / a new name / the turn, after a big question or the closing line, ordinary. */
export const S2_GAPS_MS = { sink: [850, 900], big: [600, 700], ordinary: [250, 350] } as const;
/** Reel length at the last spoken word (S2 accepted: ≤ 75 s; PA1_DURATION_SEC). Blocks measured, warns estimated. */
export const REEL_DURATION_SEC = { min: 60, max: 75 } as const;

export const ShotIntent = z
  .object({
    /** Curated registry id the line wants on screen, or a device the library draws (W3a/W4 resolve it). */
    asset: z.string().regex(ASSET_ID).optional(),
    /** "<instance>.<anchor>" or a bare anchor name ("urlbar.schemeS", "building.frontDoor"). */
    anchor: z.string().regex(ANCHOR_NAME).optional(),
    /** What is on screen, for the storyboard stage and the judges (plain production note). */
    note: z.string().min(2).max(400),
    /** Camera move / event, incl. what fills a pause ≥ 600 ms (scorecard E6). */
    keyframe: z.string().max(400).optional(),
    /** Overlay bound to an anchor; any text in it must be a spoken word (C7). */
    overlay: z.string().max(300).optional(),
  })
  .strict();
export type ShotIntentT = z.output<typeof ShotIntent>;

export const NarrativeLine = z
  .object({
    id: z.string().regex(LINE_ID),
    act: z.enum(ACTS),
    text: z.string().min(2).max(MAX_LINE_CHARS),
    /** Set at the storyboard stage (where the visual change lands); optional while writing. */
    keyword: z.string().min(1).max(40).optional(),
    /** edge-tts prosody rate. S2: one rate for the reel (default +5 %, ≤ +10 % only to land ≤ 75 s); the writer
     *  normally leaves it out. Decision 3a's per-line −8…−14 % is retired. */
    rate: z.string().regex(RATE).default(V3_RATE_DEFAULT),
    /** The audible silence after this line's last word (W2 defines it on the voice). */
    pauseAfterMs: z.number().int().min(0).max(1500),
    shot: ShotIntent.optional(),
  })
  .strict();
export type NarrativeLineT = z.output<typeof NarrativeLine>;

export const AnalogyRow = z
  .object({
    source: z.string().min(2).max(80), // "sealed letter"
    real: z.string().min(2).max(160), // "your request, encrypted with TLS"
    /** Real-world features of the source that DO carry over (R1 analogy rule 6). */
    carriesOver: z.string().max(240).optional(),
    /** Where the analogy breaks: the script must not lean on this (R1 analogy rule 2). */
    breaks: z.string().min(3).max(320),
  })
  .strict();

export const TermDef = z
  .object({
    term: z.string().min(1).max(40),
    /** The plain-words description spoken BEFORE (or with) the name: "description … is called X". */
    gloss: z.string().min(3).max(160),
    /** The line whose picture shows what the term names (first on screen there). */
    pictureLine: z.string().regex(LINE_ID),
    /** The line that first speaks the term. */
    termLine: z.string().regex(LINE_ID),
    /** Optional line that fixes a misleading everyday meaning ("termination" → "that's where the seal ends"). */
    hangLine: z.string().regex(LINE_ID).optional(),
    /** The reel's topic term: may not be spoken before the mechanism act (scorecard B8). */
    topic: z.boolean().default(false),
  })
  .strict();
export type TermDefT = z.output<typeof TermDef>;

export const NameRow = z
  .object({
    thing: z.string().min(2).max(120),
    /** The only spoken name(s) of the thing ("the website's own mailroom", "it"). */
    name: z.string().min(1).max(80),
    /** Words that would be a second name for it (synonym drift, H10): never spoken. */
    never: z.array(z.string().min(2).max(40)).max(10).default([]),
  })
  .strict();

export const Narrative = z
  .object({
    version: z.literal("v3"),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(3).max(90),
    track: z.enum(TRACKS),
    /** The series label shown in the header (kept: decision 4). Must equal the track's configured label. */
    series: z.string().min(3).max(24),
    scope: z.enum(SCOPES).default("reel"),
    /** S2 voice (D1-DECISIONS-V3 "S2 voice — 2026-11-02"; src/v3/tts.ts V3_VOICE). */
    voice: z.string().default("en-US-AvaMultilingualNeural"),
    leadSilenceMs: z.number().int().min(0).max(1200),
    hookPattern: z.enum(HOOK_PATTERNS),
    /** The ONE sentence a viewer should be able to repeat to a friend (what the non-technical restatement is
     *  compared with). Writer-side, not spoken. */
    point: z.string().min(10).max(240),
    lines: z.array(NarrativeLine).min(4).max(40),
    analogy: z.object({ carrier: z.string().min(3).max(120), rows: z.array(AnalogyRow).min(1).max(12) }).strict().optional(),
    terms: z.array(TermDef).max(8),
    names: z.array(NameRow).max(12).default([]),
    /** Root-cause track only: the company whose incident it is. Spoken at most once, it is exempt from the
     *  undeclared-term (TU1) and vendor-aside (H6) checks (prompt ROOT_CAUSE_APPENDIX: "the vendor is named once"). */
    vendor: z.string().min(2).max(40).optional(),
    /** Extras that belong in the post caption, not on screen (industry names, second cases). */
    caption: z.array(z.string().min(2).max(240)).max(6).default([]),
  })
  .strict()
  .superRefine((n, ctx) => {
    const ids = n.lines.map((l) => l.id);
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `duplicate line id ${id}`, path: ["lines", i, "id"] });
      seen.add(id);
    });
    const at = (id: string) => ids.indexOf(id);
    n.terms.forEach((t, k) => {
      for (const f of ["pictureLine", "termLine", "hangLine"] as const) {
        const v = t[f];
        if (v !== undefined && at(v) < 0) ctx.addIssue({ code: "custom", message: `term ${t.term}: ${f} ${v} is not a line`, path: ["terms", k, f] });
      }
    });
    if (n.lines[0]?.act !== "hook") ctx.addIssue({ code: "custom", message: "the first line is the hook", path: ["lines", 0, "act"] });
  });
export type NarrativeT = z.output<typeof Narrative>;
export type NarrativeIn = z.input<typeof Narrative>;

export const CLAIM_KINDS = ["fact", "number", "prevalence", "scope", "behaviour-drawn", "analogy-implied", "hook-object-today"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
/** hedged = the claim is true as worded because the line already carries the source's hedge ("can", "careful companies"). */
export const CLAIM_VERDICTS = ["pending", "supported", "hedged", "overstated", "unsupported", "contradicted"] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];
export const PASSING_VERDICTS: ReadonlySet<ClaimVerdict> = new Set(["supported", "hedged"]);

/** What the extractor returns; the fact check fills verdict + sourceId/quote; a failed claim carries a `hint` for the
 *  WRITER (never applied to the narration: FC2 retired). */
export const Claim = z
  .object({
    id: z.string().regex(CLAIM_ID),
    lines: z.array(z.string().regex(LINE_ID)).min(1).max(8),
    text: z.string().min(5).max(300),
    kind: z.enum(CLAIM_KINDS),
    sourceId: z.string().max(80).optional(),
    quote: z.string().max(600).optional(),
    verdict: z.enum(CLAIM_VERDICTS).default("pending"),
    why: z.string().max(400).optional(),
    hint: z.string().max(300).optional(),
  })
  .strict();
export type ClaimT = z.output<typeof Claim>;
export const Claims = z
  .object({
    version: z.literal("v3"),
    claims: z.array(Claim).max(40),
    /** Lines the extractor found to carry no factual claim (setup, questions, transitions, the viewer's belief). */
    noClaim: z.array(z.string().regex(LINE_ID)).max(40).default([]),
  })
  .strict();
export type ClaimsT = z.output<typeof Claims>;

/** One researched source: support comes from its VERBATIM quotes; context is surrounding page text (scope, hedges). */
export const ClaimSource = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
    title: z.string().max(200).optional(),
    url: z.string().url(),
    /** When the page was published/updated or retrieved (dated sources matter for hook-object-today). */
    date: z.string().max(40).optional(),
    quotes: z.array(z.string().min(5).max(800)).min(1).max(20),
    context: z.array(z.string().max(1200)).max(10).default([]),
  })
  .strict();
export type ClaimSourceT = z.output<typeof ClaimSource>;
export const Sources = z.object({ version: z.literal("v3"), sources: z.array(ClaimSource).min(1).max(30) }).strict();
export type SourcesT = z.output<typeof Sources>;

/** Measured TTS timing (R1 tts-timing format / W2 output): word times are absolute reel seconds. */
export interface NarrativeTiming {
  totalSec?: number;
  lines: Array<{ id: string; startSec: number; wordTimes: Array<{ text: string; startSec: number; endSec: number }> }>;
}

/** Pause statistics (scorecard E1/E2, PA1): CTA excluded, and the last line's trailing pause excluded when nothing
 *  follows it (an opening ends without a CTA, so that silence is never heard between two lines). */
export function pauseStats(lines: readonly { pauseAfterMs: number; act: string }[]): { mean: number; sd: number; maxRun: number; n: number } {
  const heard = lines.at(-1)?.act === "cta" ? lines : lines.slice(0, -1);
  const p = heard.filter((l) => l.act !== "cta").map((l) => l.pauseAfterMs);
  const mean = p.reduce((a, b) => a + b, 0) / Math.max(1, p.length);
  const sd = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, p.length));
  let maxRun = p.length ? 1 : 0;
  for (let i = 1, run = 1; i < p.length; i++) maxRun = Math.max(maxRun, (run = p[i] === p[i - 1] ? run + 1 : 1));
  return { mean, sd, maxRun, n: p.length };
}

/** Spoken word tokens of a line (what TTS boundaries count). Hyphenated words stay one token ("Wi-Fi"). */
export function lineWords(text: string): string[] {
  return String(text ?? "")
    .replace(/[“”"]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""))
    .filter(Boolean);
}

/** One finding of a v3 script gate. block/error fail the gate; warn is reported only. `hint` goes back to the WRITER
 *  (it is never applied to the narration). */
export interface ScriptGap {
  gate: "schema" | "writer" | "terms" | "claims" | "factcheck" | "physics" | "nontech";
  code: string;
  severity: "block" | "error" | "warn";
  lines?: string[];
  message: string;
  hint?: string;
}
export const gapsPass = (gaps: readonly ScriptGap[]): boolean => !gaps.some((g) => g.severity !== "warn");

/** edge-tts Andrew articulation at +0 % (R1: 3.31 w/s on the anti-example; 2.4–2.9 at −10 %): the LEGACY pre-TTS
 *  model for S1-era narratives (voice en-US-AndrewNeural, per-phrase). W1.1: within ±9 % on the four Andrew fixtures. */
export const EST_ARTICULATION_WPS = 3.4;
/** Clip trim the v2 / S1 per-phrase TTS keeps around speech (50 ms lead + 100 ms tail, src/v2/ops/tts.ts). */
export const CLIP_PAD_SEC = 0.15;
/** S2 production voice (src/v3/tts.ts V3_VOICE). */
export const AVA_VOICE = "en-US-AvaMultilingualNeural";

/** Pre-TTS speech model per voice: words/s at +0 % (scaled linearly by the rate), the extra seconds between one line's
 *  last word and the next line's first word beyond pauseAfterMs, and the first word's offset into its line.
 *  Ava (S2, measured on the 22-line / 218-word SINK script, research/v3/S2/voice-ab/*.tts.json and the shipped
 *  jobs/_dev/v3/s2/voice/tts-v3.json; voiced = Σ per-line first→last word):
 *    +0 % 67.59 s voiced, last word 78.11 s · +5 % 64.49 s / 74.84 s · +8 % 63.30 s / 73.68 s.
 *  Fit: 3.21 w/s × (1 + rate) → +0.5 / −0.3 / −0.4 % on the last word (tests: ±2 %). The audible pause IS the gap
 *  (src/v3/tts.ts lays out audiblePauseMs), so only ~13 ms per join remains. */
export const VOICE_MODELS: Readonly<Record<string, { wps: number; joinSec: number; wordLeadSec: number }>> = Object.freeze({
  [AVA_VOICE]: { wps: 3.21, joinSec: 0.013, wordLeadSec: 0 },
  "en-US-AndrewNeural": { wps: EST_ARTICULATION_WPS, joinSec: CLIP_PAD_SEC, wordLeadSec: 0.05 },
});
export const voiceModel = (voice?: string) => VOICE_MODELS[voice ?? AVA_VOICE] ?? VOICE_MODELS[AVA_VOICE];

export function rateFactor(rate: string): number {
  const m = /^([+-]\d{1,2})%$/.exec(rate);
  return 1 + (m ? Number(m[1]) : 0) / 100;
}

/** Pre-TTS timing estimate (words spread evenly over each line's estimated speech). Measured timing (W2 / R1
 *  tts-timing) always wins: see timingFor(). */
export function estimateTiming(n: Pick<NarrativeT, "leadSilenceMs" | "lines"> & { voice?: string }): NarrativeTiming {
  const m = voiceModel(n.voice);
  let t = n.leadSilenceMs / 1000;
  const lines: NarrativeTiming["lines"] = [];
  for (const l of n.lines) {
    const w = lineWords(l.text);
    const per = 1 / (m.wps * rateFactor(l.rate ?? V3_RATE_DEFAULT));
    const start = t;
    const a = start + m.wordLeadSec;
    lines.push({ id: l.id, startSec: +start.toFixed(3), wordTimes: w.map((text, i) => ({ text, startSec: +(a + i * per).toFixed(3), endSec: +(a + (i + 1) * per).toFixed(3) })) });
    t = a + w.length * per + m.joinSec + l.pauseAfterMs / 1000;
  }
  const last = lines.at(-1);
  return { totalSec: last ? +(last.wordTimes.at(-1)?.endSec ?? last.startSec).toFixed(2) + 0.1 : 0, lines };
}

/** Why a supplied measured timing does not cover the narrative (null = it does). */
export function timingMismatch(n: Pick<NarrativeT, "lines">, measured: NarrativeTiming): string | null {
  if (measured.lines.length !== n.lines.length) return `${measured.lines.length} measured lines for ${n.lines.length} narrative lines`;
  for (let i = 0; i < n.lines.length; i++) {
    const l = n.lines[i];
    const m = measured.lines[i];
    if (m?.id !== l.id) return `line ${i + 1} is ${l.id} in the narrative but ${m?.id ?? "(none)"} in the timing`;
    const w = lineWords(l.text);
    if (m.wordTimes.length !== w.length) return `${l.id}: ${m.wordTimes.length} measured words for ${w.length} narrative words ("${l.text}")`;
  }
  return null;
}

/** The measured timing when it covers every line (same ids, same word count), else the estimate. `rejected` says
 *  why a SUPPLIED measured timing was not used, so the gates can refuse instead of silently downgrading (TIM0). */
export function timingFor(n: Pick<NarrativeT, "leadSilenceMs" | "lines"> & { voice?: string }, measured?: NarrativeTiming | null): { timing: NarrativeTiming; measured: boolean; rejected: string | null } {
  if (measured) {
    const why = timingMismatch(n, measured);
    if (!why) return { timing: measured, measured: true, rejected: null };
    return { timing: estimateTiming(n), measured: false, rejected: why };
  }
  return { timing: estimateTiming(n), measured: false, rejected: null };
}

/** The last spoken word's end (s): what the S2 length rule (≤ 75 s) and PA1.duration measure. */
export function speechEndSec(t: NarrativeTiming): number | null {
  for (let i = t.lines.length - 1; i >= 0; i--) {
    const w = t.lines[i].wordTimes.at(-1);
    if (w) return w.endSec;
  }
  return null;
}
