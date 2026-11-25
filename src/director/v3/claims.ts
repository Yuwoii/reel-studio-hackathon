// v3 CLAIMS EXTRACTOR (W1; ADR-002 §7 step 2, R1 PLAYBOOK §5, R5 §5). A FRESH context with no tools (v2 judge
// isolation: buildJudgeOptions via askJudge) reads the finished narrative — lines, the analogy table, shot intents —
// and lists every factual claim it makes: facts, numbers, prevalence words, scope claims ("can't read a word inside"),
// behaviour the pictures will animate (R1 §8.6: "animated behaviour is a claim"), claims an analogy row implies, and
// that the hook object is true for the viewer today (SCORECARD A7). Setup lines, questions, transitions and the
// viewer's own belief ("You'd think …") carry no claim. Grounding then checks these claims, not the prose (GR1/FC2
// retired): the writer is free to write like a creator, and only what could be false is held to a source.
// PICTURE-ONLY DETAILS ARE STAGING (owner ruling 2026-11-03, D1-DECISIONS-V3 "W4.2 judge rulings" #2): a detail that
// appears ONLY in the shot/picture notes and is never spoken (e.g. how many LEDs are drawn) is not a claim. The
// prompt says so, and a $0 code check (pictureOnlyNumbers) re-asks for a claim that states a number or count no
// spoken line (or quoted on-screen text) of its lines says, then drops a pure number claim that still does. Behaviour
// the picture animates is a claim only when the narration (or on-screen text) states it too.
//
// Also the shared judge plumbing for the v3 script stage (judgeCall + spend), so every judge books turns and $ the same
// way.

import { authEnv, defaultToken } from "../../auth.js";
import { mkdir } from "node:fs/promises";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { escapeXml } from "../webfetch.js";
import { firstJsonObject } from "../v2/clarity.js";
import { DEFAULT_JUDGE_MODEL } from "../v2/judge.js";
import { askJudge } from "../v2/mechanism.js";
import { quotedScreenText } from "./terms.js";
import { ASSETS } from "../../v3/assets.gen.js";
import { META as V2_META } from "../../v2/components-meta/index.js";
import { CLAIM_ID, CLAIM_KINDS, Claims, LINE_ID, type ClaimKind, type ClaimsT, type NarrativeT, type ScriptGap } from "../../schema/script.v3.js";

// ---------------------------------------------------------------- shared judge plumbing

export interface JudgeRunArgs {
  claudeDir: string;
  oauthToken?: string;
  /** Per-judge model override (else the module default / env). */
  model?: string;
  signal?: AbortSignal;
  log?: (l: string) => void;
  env?: NodeJS.ProcessEnv;
  queryImpl?: (a: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
}

/** One judge's measured spend (the $ is the SDK's total_cost_usd: subscription-notional, not cash). */
export interface JudgeSpend {
  gate: string;
  model: string;
  asks: number;
  turns: number;
  costUsd: number;
  ms: number;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

export class ScriptJudgeError extends Error {
  constructor(
    message: string,
    public spend?: JudgeSpend,
  ) {
    super(message);
  }
}

export interface JudgeSession {
  ask(prompt: string): Promise<string>;
  spend: JudgeSpend;
}

/** A fresh, no-tools judge session that books every ask into one JudgeSpend. Throws ScriptJudgeError on a missing
 *  token or an SDK error (callers fail closed: the gate refuses). */
export async function judgeSession(gate: string, systemPrompt: string, model: string, a: JudgeRunArgs): Promise<JudgeSession> {
  const token = a.oauthToken ?? defaultToken(a.env ?? process.env);
  const spend: JudgeSpend = { gate, model, asks: 0, turns: 0, costUsd: 0, ms: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } };
  if (!token) throw new ScriptJudgeError(`${gate}: CLAUDE_CODE_OAUTH_TOKEN is not set`, spend);
  await mkdir(a.claudeDir, { recursive: true });
  const queryImpl = a.queryImpl ?? ((x: { prompt: string; options: Options }) => query(x));
  return {
    spend,
    async ask(prompt: string) {
      spend.asks++;
      const t0 = Date.now();
      const r = await askJudge({ prompt, systemPrompt, model, oauthToken: token, claudeDir: a.claudeDir, maxTurns: 2, signal: a.signal, log: a.log, queryImpl }, spend.usage);
      spend.ms += Date.now() - t0;
      spend.turns += r.turns;
      spend.costUsd += r.costUsd;
      if (a.signal?.aborted) throw new ScriptJudgeError(`${gate} aborted`, spend);
      if (r.thrown && !r.sawResult) throw new ScriptJudgeError(`${gate} SDK error: ${r.error}`, spend);
      return r.text;
    },
  };
}

export const modelFor = (envKey: string, fallback: string, a: Pick<JudgeRunArgs, "model" | "env">) => a.model ?? ((a.env ?? process.env)[envKey]?.trim() || fallback);
/** Majority-of-N voting for the blocking script judges (W1.1, orchestrator ruling 2). W1 measured on frozen fixtures
 *  that every watch/ANC fact-check or physics failure appeared in only 1 of 3 runs on identical text, and the viewer
 *  flipped words between runs; so each of the fact check, physics and viewer judges runs N independent votes and a
 *  finding blocks only when a majority (⌊N/2⌋ + 1) raise it. Default 3; env REEL_V3_<JUDGE>_VOTES or `votes` override
 *  (1 = a single run, the W1 behaviour). Capped at 5 (shared subscription). */
export const DEFAULT_JUDGE_VOTES = 3;
export const MAX_JUDGE_VOTES = 5;
export function judgeVotes(envKey: string, a: { votes?: number; env?: NodeJS.ProcessEnv }): number {
  const raw = a.votes ?? Number((a.env ?? process.env)[envKey]);
  const v = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_JUDGE_VOTES;
  return Math.max(1, Math.min(MAX_JUDGE_VOTES, v));
}
export const majorityOf = (n: number) => Math.floor(n / 2) + 1;
/** A vote's own SDK session dir (votes run in parallel; one dir each). */
export const voteDir = (claudeDir: string, i: number, n: number) => (n > 1 ? `${claudeDir}-v${i + 1}` : claudeDir);

export const tag = (name: string, body: string) => `<${name}>\n${escapeXml(body)}\n</${name}>`;
export const clean = (v: unknown, max = 400) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The narration as the judges read it: "L05 [ground, -12%, pause 600] So your browser seals it, …". */
export function narrationBlock(n: Pick<NarrativeT, "lines">, o: { shots?: boolean } = {}): string {
  return n.lines
    .map((l) => {
      const head = `${l.id} [${l.act}] ${l.text}`;
      if (!o.shots || !l.shot) return head;
      const s = l.shot;
      return `${head}\n    picture: ${s.note}${s.keyframe ? ` | move: ${s.keyframe}` : ""}${s.overlay ? ` | overlay: ${s.overlay}` : ""}`;
    })
    .join("\n");
}
export function analogyBlock(n: Pick<NarrativeT, "analogy">): string {
  if (!n.analogy) return "(no analogy)";
  return [`carrier: ${n.analogy.carrier}`, ...n.analogy.rows.map((r, i) => `A${i + 1}. ${r.source} → ${r.real}${r.carriesOver ? ` | carries over: ${r.carriesOver}` : ""} | breaks: ${r.breaks}`)].join("\n");
}

// ---------------------------------------------------------------- claims extraction

export const CLAIMS_MAX_REPAIRS = 1;

export const CLAIMS_SYSTEM_PROMPT = `You extract the FACTUAL CLAIMS from a narrated 60–80 s explainer script for a general audience, so a separate fact checker can check them against sources. You have no tools. You do not judge whether a claim is true and you do not rewrite anything.
A claim is anything a viewer could take away as true about the real world that could turn out false. List, in line order:
- fact: a statement about how something is or works ("your browser seals it", "the speaker plays it along with your music");
- number: any number, rate, count or duration that is SPOKEN (or written on screen as quoted text);
- prevalence: words like lots of / most / usually / careful companies / every / always (the hedge IS the claim);
- scope: what something does or does NOT cover ("can see where it's going, but can't read a word inside", "right at your ear");
- behaviour-drawn: real behaviour that a SPOKEN line states and the picture animates (what blinks and at what rate, which direction something changes, where an effect happens) — the spoken words carry the claim, the picture only shows it;
- analogy-implied: what a line using the analogy implies about the REAL thing (use the analogy table: state the real-world claim, not the metaphor; "the mailroom has the website's key" → "the TLS-terminating front end holds the site's key");
- hook-object-today: that the object the hook shows looks/behaves that way today (one claim, whenever the hook points at an object). State it for the device or app the picture shows and the way the picture shows it ("on a phone, tapping the address bar shows the full address, starting with https"), not for every device — and never as "the address bar shows https://" when browsers hide the scheme until the bar is tapped. Write it as the plain effect, without "today", "now" or "currently" (the kind already says it is about today's devices): "smartwatches shine green light from their backs into the skin", not "… shine green light today". A printed or drawn object the hook shows (a poster, a chart, a calendar) gets the same claim about what it shows: "a life-in-weeks poster shows one box for each week of a 90-year life".
PICTURE-ONLY DETAILS ARE STAGING, NOT CLAIMS: anything that appears ONLY in the picture notes and is never spoken (or written on screen as quoted text) — how many LEDs, lights, boxes or hops are drawn, what blinks or glows, colours, layout, an arrival cue, numbered or labelled example boxes, camera moves — is staging. Never extract it, and never add it to a claim built from a spoken line (a line that says "your watch shines green light" gives "smartwatches shine green light into the wrist", not "… from two lights"). Read the picture notes only to understand what a spoken line refers to.
NOT claims (list their ids in "noClaim"): example values the picture notes mark as an example or illustrative (an "example" readout of 72 BPM is not a claim; the same number spoken as fact is), rhetorical questions, setup lines that only frame a situation ("When you log in, …" carries a claim only for what it asserts), transitions ("Why bother?", "The catch?"), the viewer's own belief stated as such ("You'd think …" — but the twist that answers it IS a claim), the call to action.
The analogy table (including its "breaks" and "carries over" columns) and the terms list are the WRITER's notes, not what the viewer hears or sees: never extract a claim from them; use the table only to say what a line's metaphor implies about the real thing.
State a spoken behaviour as the real behaviour ("the green LEDs flash hundreds of times a second", when a line says so), not as how it is rendered (shimmer, glow, colours, icons).
Write each claim as ONE plain, checkable sentence about the real thing (not the metaphor), ≤ 40 words, keeping the script's own hedges ("can", "often"). Merge a claim repeated on several lines into one claim listing all its lines. Do not invent claims the script does not make.
Reply with ONLY one JSON object:
{"claims":[{"id":"C01","lines":["L05"],"kind":"fact|number|prevalence|scope|behaviour-drawn|analogy-implied|hook-object-today","text":"…"}],"noClaim":["L15"]}
Ids C01, C02, … in order. Every line id is either in some claim's "lines" or in "noClaim".`;

/** Owner-data jobs only (a cited [OWNER-MEASURED DATA] source, decided in code by the writer): the hook object is the
 *  owner's honeypot, so its hook-object-today claim is about what the honeypot is and does — the pack's "about this
 *  honeypot" sentence supports exactly that — never about how a drawn server or rack looks. Dry run hp-2026-w46
 *  (2026-11-17): without it the extractor wrote "a server rack shows blinking status lights" (unsupported, FC1) or
 *  dropped the claim (CL1 error), and the reel could never pass. Normal jobs keep CLAIMS_SYSTEM_PROMPT byte-identical. */
export const OWNER_DATA_CLAIMS_RULE = `OWNER-MEASURED DATA JOB: this script reports counts from the narrator's own honeypot (a decoy server that records every request it receives). When the hook shows that honeypot (a drawn server or server rack, often with a count on it), its ONE hook-object-today claim is about the honeypot itself as the hook names it — what it is and does — e.g. "the narrator's honeypot is a decoy server that records every request it receives". Never write it about how a server or rack looks (lights, LEDs, cables, blinking): that is staging. Always give that claim when the hook shows the honeypot.`;

/** The extractor's system prompt (+ OWNER_DATA_CLAIMS_RULE only on an owner-data job). */
export const claimsSystemPrompt = (ownerData = false): string => (ownerData ? `${CLAIMS_SYSTEM_PROMPT}\n${OWNER_DATA_CLAIMS_RULE}` : CLAIMS_SYSTEM_PROMPT);

export function claimsPrompt(n: NarrativeT): string {
  return [
    tag("title", n.title),
    tag("narration_with_pictures", narrationBlock(n, { shots: true })),
    tag("analogy_table", analogyBlock(n)),
    tag("terms", n.terms.map((t) => `${t.term}: ${t.gloss}`).join("\n") || "(none)"),
    "Extract the claims. Reply with the JSON object only.",
  ].join("\n");
}

export function parseClaims(text: string): { claims: ClaimsT["claims"]; noClaim: string[] } | null {
  const o = firstJsonObject(text);
  if (!o || !Array.isArray(o.claims)) return null;
  const claims: ClaimsT["claims"] = [];
  (o.claims as unknown[]).forEach((x, i) => {
    if (!x || typeof x !== "object") return;
    const c = x as Record<string, unknown>;
    const id = CLAIM_ID.test(String(c.id)) ? String(c.id) : `C${String(i + 1).padStart(2, "0")}`;
    const lines = (Array.isArray(c.lines) ? c.lines : []).map(String).filter((l) => LINE_ID.test(l)).slice(0, 8);
    const kind = (CLAIM_KINDS as readonly string[]).includes(String(c.kind)) ? (c.kind as ClaimKind) : "fact";
    const t = clean(c.text, 300);
    if (lines.length && t.length >= 5) claims.push({ id, lines, kind, text: t, verdict: "pending" });
  });
  const noClaim = (Array.isArray(o.noClaim) ? o.noClaim : []).map(String).filter((l) => LINE_ID.test(l));
  return { claims: claims.slice(0, 40), noClaim };
}

// number words fold to digits ("sixty" = "60"), so a claim may write a spoken number either way
const NUMBER_WORDS: Record<string, string> = Object.fromEntries([
  ..."two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ").map((w, i) => [w, String(i + 2)]),
  ..."twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((w, i) => [w, String((i + 2) * 10)]),
  ...["hundred", "thousand", "million", "billion", "dozen"].map((w) => [w, w]),
]);
const numTok = (t: string) => (t.length > 4 ? t.replace(/s$/, "") : t);
function numbersIn(s: string): string[] {
  const t = String(s ?? "").toLowerCase();
  const digits = [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", "."));
  const words = t.split(/[^a-z]+/).map(numTok).filter((w) => w in NUMBER_WORDS).map((w) => NUMBER_WORDS[w]);
  return [...new Set([...digits, ...words])];
}

/** The numbers / counts a claim states that NONE of its lines speaks or writes on screen (quoted text) — picture-only
 *  staging (owner ruling 2026-11-03 W4.2 #2). Pure; [] when every number in the claim is said. */
export function pictureOnlyNumbers(c: Pick<ClaimsT["claims"][number], "lines" | "text">, n: Pick<NarrativeT, "lines">): string[] {
  const ls = n.lines.filter((l) => c.lines.includes(l.id));
  const said = new Set(ls.flatMap((l) => [...numbersIn(l.text), ...quotedScreenText(l).flatMap(numbersIn)]));
  return numbersIn(c.text).filter((x) => !said.has(x));
}

/** Problems that warrant a repair re-ask (pure). */
export function claimsProblems(p: { claims: ClaimsT["claims"]; noClaim: string[] }, n: NarrativeT): string[] {
  const ids = new Set(n.lines.map((l) => l.id));
  const out: string[] = [];
  const unknown = [...new Set([...p.claims.flatMap((c) => c.lines), ...p.noClaim].filter((l) => !ids.has(l)))];
  if (unknown.length) out.push(`unknown line ids: ${unknown.join(", ")}`);
  const covered = new Set([...p.claims.flatMap((c) => c.lines), ...p.noClaim]);
  const missing = n.lines.filter((l) => !covered.has(l.id)).map((l) => l.id);
  if (missing.length) out.push(`lines neither in a claim nor in noClaim: ${missing.join(", ")}`);
  const dup = p.claims.map((c) => c.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) out.push(`duplicate claim ids: ${dup.join(", ")}`);
  for (const c of p.claims) {
    const extra = pictureOnlyNumbers(c, n);
    if (extra.length) out.push(`${c.id} states ${extra.map((x) => `"${x}"`).join(", ")}, which no spoken line (or quoted on-screen text) of ${c.lines.join(", ")} says: a detail only in the picture notes is staging, not a claim — leave it out (drop the claim if nothing spoken is left)`);
  }
  return out;
}

let LIBRARY_OBJECT_RE: RegExp | null = null;
/** A shot note that names a real object of the v3 library (asset id "watch-back", component "WatchBack"). */
export function namesLibraryObject(note: string): boolean {
  if (!LIBRARY_OBJECT_RE) {
    const names = [...new Set(ASSETS.flatMap((a) => [a.id, ...(a.component ? [a.component] : [])]))].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    LIBRARY_OBJECT_RE = new RegExp(`(?:^|[^a-z0-9-])(?:${names.join("|")})(?![a-z0-9-])`, "i");
  }
  return LIBRARY_OBJECT_RE.test(note);
}

/** Plain words for a drawn device a tech hook shows without naming a library asset ("a smartwatch on a wrist", "the
 *  browser address bar", "drawn over-ear headphone"). "screen" is left out on purpose: "fills the screen" is staging. */
const DEVICE_WORD_RE = /\b(?:(?:smart)?watch(?:es)?|browsers?|(?:address|url|search) bar|headphones?|earbuds?|earphones?|laptops?|(?:smart)?phones?|tablets?|routers?|keyboards?|monitors?|webcams?|wi-?fi)\b/i;
/** A shot note that shows a device: a library object, or a device in plain words. */
export const namesDevice = (note: string): boolean => namesLibraryObject(note) || DEVICE_WORD_RE.test(note);

let CONCEPT_RE: RegExp | null = null;
/** A shot note that names a concept / mechanism component of the library (v2 UnitGrid, MetricChart …), exact case. */
export function namesConceptComponent(note: string): boolean {
  if (!CONCEPT_RE) CONCEPT_RE = new RegExp(`\\b(?:${Object.keys(V2_META).join("|")})\\b`);
  return CONCEPT_RE.test(note);
}

/** Gate gaps on a parsed claim list (pure). */
export function claimsGaps(c: ClaimsT, n: NarrativeT): ScriptGap[] {
  const gaps: ScriptGap[] = [];
  const hookLines = new Set(n.lines.filter((l) => l.act === "hook").map((l) => l.id));
  const mech = n.lines.filter((l) => l.act === "mechanism");
  const hookShots = n.lines.filter((l) => hookLines.has(l.id) && l.shot);
  // strict by default. Relaxed ONLY for a concept hook: no hook shot has an asset or anchor or shows a device (library
  // object, or a device in plain words), and a hook note names a concept component (UnitGrid … ; e.g. memento mori on a
  // grid, rs-20261109-25f1a4). A concept hook is satisfied by any checked claim on a hook line, and the gate is only a
  // warning when it makes no claim at all.
  const noteOf = (l: (typeof hookShots)[number]) => `${l.shot!.note} ${l.shot!.keyframe ?? ""}`;
  const conceptHook = hookShots.length > 0 && hookShots.every((l) => !l.shot!.asset && !l.shot!.anchor && !namesDevice(noteOf(l))) && hookShots.some((l) => namesConceptComponent(noteOf(l)));
  const objectHook = !conceptHook;
  const hookClaim = c.claims.some((x) => x.lines.some((id) => hookLines.has(id)));
  if (!c.claims.some((x) => x.kind === "hook-object-today") && hookShots.length && (objectHook || !hookClaim))
    gaps.push({
      gate: "claims",
      code: "CL1",
      severity: objectHook ? "error" : "warn",
      message: objectHook ? "no hook-object-today claim: the hook object must be checked as true on the viewer's device today (A7)" : "concept hook (no library object): no claim on the hook lines",
      lines: [...hookLines],
    });
  const claimed = new Set(c.claims.flatMap((x) => x.lines));
  const bare = mech.filter((l) => !claimed.has(l.id)).map((l) => l.id);
  if (mech.length && bare.length === mech.length) gaps.push({ gate: "claims", code: "CL2", severity: "error", message: "no mechanism line carries a claim: the extraction is incomplete", lines: bare });
  return gaps;
}

export interface ClaimsRunResult {
  claims: ClaimsT;
  gaps: ScriptGap[];
  raw: string;
  spend: JudgeSpend;
}

export async function runClaimsExtraction(a: JudgeRunArgs & { narrative: NarrativeT; ownerData?: boolean }): Promise<ClaimsRunResult> {
  const model = modelFor("REEL_V3_CLAIMS_MODEL", DEFAULT_JUDGE_MODEL, a);
  const s = await judgeSession("claims", claimsSystemPrompt(a.ownerData), model, a);
  const prompt = claimsPrompt(a.narrative);
  let raw = await s.ask(prompt);
  let parsed = parseClaims(raw);
  let problems = parsed ? claimsProblems(parsed, a.narrative) : ["the reply was not the JSON object"];
  for (let r = 0; r < CLAIMS_MAX_REPAIRS && problems.length; r++) {
    a.log?.(`claims: repair ${r + 1} (${problems.join("; ")})`);
    raw = await s.ask(`${prompt}\n\nYour previous reply could not be used:\n${problems.map((p) => `- ${p}`).join("\n")}\n${tag("previous_reply", raw.slice(0, 8000))}\nReply again with the COMPLETE JSON object.`);
    parsed = parseClaims(raw) ?? parsed;
    problems = parsed ? claimsProblems(parsed, a.narrative) : problems;
  }
  // still after the repair: a pure number claim whose number is picture-only is dropped (staging, ruling W4.2 #2);
  // its lines go to noClaim unless another claim covers them. Other kinds keep the claim (the warn below names it).
  if (parsed) {
    const drop = parsed.claims.filter((c) => c.kind === "number" && pictureOnlyNumbers(c, a.narrative).length && !numbersIn(c.text).some((x) => !pictureOnlyNumbers(c, a.narrative).includes(x)));
    if (drop.length) {
      const kept = parsed.claims.filter((c) => !drop.includes(c));
      const covered = new Set(kept.flatMap((c) => c.lines));
      parsed = { claims: kept, noClaim: [...new Set([...parsed.noClaim, ...drop.flatMap((c) => c.lines).filter((l) => !covered.has(l))])] };
      problems = claimsProblems(parsed, a.narrative);
      a.log?.(`claims: dropped ${drop.length} picture-only number claim(s): ${drop.map((c) => c.id).join(", ")}`);
    }
  }
  const claims = Claims.parse({ version: "v3", claims: parsed?.claims ?? [], noClaim: parsed?.noClaim ?? [] });
  const gaps: ScriptGap[] = parsed ? claimsGaps(claims, a.narrative) : [{ gate: "claims", code: "CL0", severity: "block", message: "claims NOT EXTRACTED: the extractor gave no usable reply" }];
  for (const p of problems) gaps.push({ gate: "claims", code: "CL0", severity: "warn", message: `extractor reply: ${p}` });
  a.log?.(`claims: ${claims.claims.length} claim(s), ${claims.noClaim.length} no-claim line(s), $${s.spend.costUsd.toFixed(4)}`);
  return { claims, gaps, raw, spend: s.spend };
}
