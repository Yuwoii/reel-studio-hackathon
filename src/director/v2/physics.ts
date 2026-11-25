// W7.1 PHYSICS JUDGE (how-it-works track). The W7 pilots passed every gate with physics that is wrong: the fact
// check asks "does the source say this?", and popular sources repeat popular simplifications —
//   - GPS: "38 µs/day → 10 km/day position error" (a receiver solves its own clock bias from ≥ 4 satellites; a drift
//     shared by all satellite clocks is mostly absorbed, so the popular km figure is not what a user would see), the
//     board drew 2 satellites + a ground clock as the reference, and "clocks gain 38 µs" right after "were adjusted";
//   - touchscreen: "COUPLING LOST" (mutual coupling is REDUCED, slightly), a header "TI CAPTIVATE" implying phones use
//     TI's CapTIvate line, and a SensorGrid drawing the touched crossing as the brightest value while the narration
//     says the capacitance DROPS.
// So a fresh expert (same infra as the clarity gate: one no-tools judge call, askJudge) reads the narration, every
// on-screen string and a digest of what is drawn, and checks the explanation against ESTABLISHED physics and
// engineering, not against the sources. A finding of severity "error" refuses (≤ MAX_PHYSICS_REJECTIONS per phase,
// each with a concrete rewrite), then the job goes on with a red "physics:" badge. Runs in submit_storyboard (early:
// before the stills are paid for) and in save_job (the board that is saved must have passed, or carry the badge).

import { authEnv, defaultToken } from "../../auth.js";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ScriptV2 } from "../../schema/script.v2.js";
import { phraseBeatId } from "../../schema/script.v2.js";
import type { Storyboard } from "../../schema/storyboard.v2.js";
import type { Timeline } from "../../v2/timeline.js";
import { escapeXml } from "../webfetch.js";
import { firstJsonObject } from "./clarity.js";
import { criticDigest } from "./critic.js";
import { askJudge } from "./mechanism.js";

export const PHYSICS_FILE = "physics.json";
export const PHYSICS_BADGE_PREFIX = "physics:";
/** Refusals per phase, then a red badge (the job is still delivered). */
export const MAX_PHYSICS_REJECTIONS = 2;
/** Re-asks after a malformed reply. */
export const PHYSICS_MAX_REPAIRS = 1;
/** Drawn-digest lines sent to the judge (one beat ≈ 1–3 lines). */
export const PHYSICS_MAX_DRAWN_LINES = 120;
/** The physics judge reasons about mechanisms, not wording: the strongest model by default (REEL_V2_PHYSICS_MODEL
 *  overrides; the job's judge model is NOT used). */
export const DEFAULT_PHYSICS_MODEL = "claude-opus-5-5";
const MAX_FIELD = 500;

export const PHYSICS_KINDS = ["wrong-simplification", "wrong-direction", "wrong-mechanism-drawn", "overstatement", "brand-attribution", "contradiction"] as const;
export type PhysicsKind = (typeof PHYSICS_KINDS)[number];

export class PhysicsError extends Error {
  turns = 0;
  costUsd = 0;
}

export interface PhysicsInput {
  title: string;
  question?: string;
  answer?: string;
  /** Narration, CTA excluded, with part tags. */
  beats: Array<{ beat: string; part: string; text: string }>;
  /** The header strings in order ("start: GPS · STEP 1/4", "b05: GPS · STEP 2/4"). */
  headers: string[];
  /** What each beat draws at its keyword still (critic digest lines: items, tones, values, texts). */
  drawn: string[];
}

export interface PhysicsFinding {
  beats: string[];
  kind: PhysicsKind;
  severity: "error" | "nit";
  where: "narration" | "screen" | "both";
  claim: string;
  why: string;
  rewrite: string;
}

export interface PhysicsResult {
  ok: boolean;
  findings: PhysicsFinding[];
  turns: number;
  costUsd: number;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

/** The header right-label sequence of a board. */
export function headerLines(sb: Pick<Storyboard, "headerRight" | "beats" | "series">): string[] {
  const out = [`series: ${sb.series}`, `start: ${sb.headerRight}`];
  for (const b of sb.beats) if (b.header?.right) out.push(`${b.id}: ${b.header.right}`);
  return out;
}

/** The judge's input from the stored script and a linted board (its timeline). */
export function buildPhysicsInput(script: Pick<ScriptV2, "title" | "phrases" | "story">, sb: Storyboard, tl: Timeline): PhysicsInput {
  return {
    title: script.title,
    ...(script.story ? { question: script.story.question, answer: script.story.answer } : {}),
    beats: script.phrases.map((p, i) => ({ beat: phraseBeatId(i), part: p.part, text: p.text })).filter((b) => b.part !== "cta"),
    headers: headerLines(sb),
    drawn: criticDigest(sb, tl).slice(0, PHYSICS_MAX_DRAWN_LINES),
  };
}

/** What the verdict is keyed on: the narration, the header strings and the drawn digest. */
export function physicsKey(i: PhysicsInput): string {
  return createHash("sha256").update(JSON.stringify([i.beats, i.headers, i.drawn])).digest("hex").slice(0, 32);
}

export const PHYSICS_SYSTEM_PROMPT = `You are a senior physicist and electrical engineer. You review a 70-second "how it works" explainer for a general audience BEFORE it is published. Judge it against ESTABLISHED physics and engineering — textbooks, standards, how real devices are actually built and operated — NOT against whatever sources the writer read: popular articles repeat popular simplifications. Simplifying is fine; saying something false is not.
You get the narration (numbered beats), the header strings, and a digest of what each beat DRAWS (components, their labels, values and colours: lime = the highlighted "answer" colour, red = danger / failure, grey = neutral; a value drawn biggest / brightest reads as "highest").
Flag with severity "error" only these:
1. wrong-simplification — a popular simplification that is false as stated: a number or consequence that only holds if the real system did not do what it actually does (it corrects, calibrates, solves for it, averages it out), or a device said to work in a way it does not.
2. wrong-direction — the direction of a change is wrong or contradicts itself (up vs down, more vs less, gains vs loses, faster vs slower), in the narration OR in the picture: e.g. a quantity the narration says DROPS drawn as the highest / brightest value, a "loss" drawn in the answer colour as if it were a gain.
3. wrong-mechanism-drawn — the picture draws a different mechanism or geometry than the real one: the wrong reference, too few parts for how it really works (e.g. fewer transmitters than a position fix needs), a field or signal path where there is none.
4. overstatement — an absolute where the truth is partial and the difference matters for understanding ("lost" when it is reduced slightly, "erases" when it reduces, "always" when usually).
5. brand-attribution — a header, label or line that names one vendor's product as if it were THE technology (e.g. one chip maker's product line on a reel about every phone), unless the reel is about that product. A document id (an application-note number) as a source label is fine.
6. contradiction — two lines that cannot both be true (something "was adjusted" and then still "gains" the error it was adjusted for).
A PICTURE THAT CONTRADICTS ITS OWN NARRATION IS AN ERROR, never a nit, even when it looks small: a perfectly flat summed line (total cancellation) while the words say the sound is reduced, or real cancellation leaves a residual; the full field / full light return drawn with the finger there while the words say the finger takes some away; a ray coloured differently from the light its source makes.
Do NOT flag style, pacing, rounding, a missing detail, a source's figure quoted with its hedge, or a true statement that is merely simple or incomplete. Use severity "nit" for imprecise-but-harmless WORDING a viewer would not misunderstand.
Before you answer, AUDIT the reel in plain text (no curly braces), one line per check:
A. Every number that is a CONSEQUENCE ("an error of X would cause Y", "Y per day"): would the real system actually show Y, or does it measure, solve for, calibrate or cancel the cause (so Y is a myth)? Popular "would drift N km a day" style figures are the classic trap.
B. Every quantity whose direction the narration states (drops, rises, slows, gains): what does the picture make look biggest, brightest or highlighted at that moment — the same direction? A quantity that falls must not be drawn as the peak.
C. Every drawn system: are the parts, references and counts the ones the real mechanism needs (how many transmitters, what is compared with what, where the field or signal actually is)?
D. Every absolute word (lost, erases, all, none, never, always, perfectly): true, or only partly?
E. Every header and label: a vendor product name presented as the technology itself?
F. Lines that contradict each other once a correction or condition has been stated.
Then give your findings. For every finding: the beats (use "start" for the opening header), the exact claim (quote it), why it is wrong in one or two plain sentences of physics, and a CONCRETE rewrite — the replacement narration line (≤ 14 words, plain words, same job in the story) or the exact board change (what to draw / label instead).
End your reply with ONE JSON object (after the audit; nothing after it):
{"ok":true|false,"findings":[{"beats":["b01"],"kind":"wrong-simplification|wrong-direction|wrong-mechanism-drawn|overstatement|brand-attribution|contradiction","severity":"error|nit","where":"narration|screen|both","claim":"…","why":"…","rewrite":"…"}]}
"ok" is true exactly when there is no "error" finding.`;

const tag = (name: string, body: string) => `<${name}>\n${escapeXml(body)}\n</${name}>`;

export function physicsPrompt(i: PhysicsInput): string {
  return [
    tag("title", i.title),
    ...(i.question ? [tag("question", i.question)] : []),
    ...(i.answer ? [tag("answer", i.answer)] : []),
    tag("narration", i.beats.map((b) => `${b.beat} [${b.part}] ${b.text}`).join("\n")),
    tag("header", i.headers.join("\n")),
    tag("drawn", i.drawn.join("\n") || "(no board)"),
    "Audit first (plain text), then end with the JSON object.",
  ].join("\n");
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : "");

export function parsePhysics(text: string, beatIds: ReadonlySet<string>): { ok: boolean; findings: PhysicsFinding[] } | null {
  // the reply is an audit then the JSON: parse from the first '{"ok"' (else the first object at all)
  const t = String(text ?? "");
  const at = t.search(/\{\s*"ok"\s*:/);
  const o = firstJsonObject(at >= 0 ? t.slice(at) : t);
  if (!o || !Array.isArray(o.findings)) return null;
  const findings: PhysicsFinding[] = [];
  for (const x of o.findings as unknown[]) {
    if (!x || typeof x !== "object") continue;
    const f = x as Record<string, unknown>;
    const kind = (PHYSICS_KINDS as readonly string[]).includes(String(f.kind)) ? (f.kind as PhysicsKind) : "wrong-simplification";
    const beats = (Array.isArray(f.beats) ? f.beats : []).map(str).filter((b) => beatIds.has(b) || /^(?:start|header|series)$/.test(b)).slice(0, 8);
    const why = str(f.why);
    if (!why) continue;
    findings.push({
      beats,
      kind,
      severity: f.severity === "nit" ? "nit" : "error",
      where: f.where === "screen" || f.where === "both" ? f.where : "narration",
      claim: str(f.claim),
      why,
      rewrite: str(f.rewrite),
    });
  }
  const kept = escalateNits(findings.slice(0, 12));
  return { ok: !kept.some((f) => f.severity === "error"), findings: kept };
}

/** W7.3: the judge's recurring "nits" that are a PICTURE contradicting its narration (W7.2 touch b03 "full field
 *  returning with the finger touching", anc b10/b21 "sum FLAT (drawn as total cancellation)") passed every pilot. A nit
 *  about the screen (or both) of a direction / mechanism / overstatement / contradiction kind, or one whose text says
 *  the picture shows a flat sum / the full field, is an error. Narration-only wording nits stay nits. */
export const ESCALATE_KINDS: ReadonlySet<PhysicsKind> = new Set(["wrong-direction", "wrong-mechanism-drawn", "overstatement", "contradiction"]);
const ESCALATE_TEXT = /\b(?:flat (?:line|sum)|sum flat|total cancell?ation|perfect (?:silence|cancell?ation)|full (?:field|return|strength)|return(?:ing|s)? 100 ?%|100 ?% return|lags the claim|picture (?:contradicts|lags)|drawn as)\b/i;
export function escalateNits(findings: readonly PhysicsFinding[]): PhysicsFinding[] {
  return findings.map((f) => {
    if (f.severity !== "nit") return f;
    const screen = f.where !== "narration" && ESCALATE_KINDS.has(f.kind);
    if (!screen && !(f.where !== "narration" && ESCALATE_TEXT.test(`${f.claim} ${f.why}`))) return f;
    return { ...f, severity: "error", why: `${f.why} (escalated: the picture contradicts the narration as drawn)` };
  });
}

/** Refusal lines for the error findings (pure; tested). */
export function physicsGaps(findings: readonly PhysicsFinding[]): string[] {
  return findings
    .filter((f) => f.severity === "error")
    .map((f) => `${f.beats.join(", ") || "reel"} [${f.kind}, ${f.where}]${f.claim ? ` ${JSON.stringify(f.claim)}` : ""}: ${f.why}${f.rewrite ? ` → ${f.rewrite}` : ""}`);
}

export interface PhysicsArgs {
  input: PhysicsInput;
  claudeDir: string;
  oauthToken?: string;
  model?: string;
  signal?: AbortSignal;
  log?: (l: string) => void;
  queryImpl?: (a: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
}

export async function runPhysicsCheck(args: PhysicsArgs): Promise<PhysicsResult> {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  const model = args.model ?? (process.env.REEL_V2_PHYSICS_MODEL?.trim() || DEFAULT_PHYSICS_MODEL);
  const token = args.oauthToken ?? defaultToken();
  if (!token) throw new PhysicsError("CLAUDE_CODE_OAUTH_TOKEN is not set");
  await mkdir(args.claudeDir, { recursive: true });
  const queryImpl = args.queryImpl ?? ((a: { prompt: string; options: Options }) => query(a));
  const ids = new Set(args.input.beats.map((b) => b.beat));
  let turns = 0;
  let costUsd = 0;
  const fail = (m: string) => Object.assign(new PhysicsError(m), { turns: Math.max(turns, 1), costUsd });
  const prompt = physicsPrompt(args.input);
  let p = prompt;
  for (let n = 0; n <= PHYSICS_MAX_REPAIRS; n++) {
    const r = await askJudge({ prompt: p, systemPrompt: PHYSICS_SYSTEM_PROMPT, model, oauthToken: token, claudeDir: args.claudeDir, maxTurns: 2, signal: args.signal, log: args.log, queryImpl }, usage);
    turns += r.turns;
    costUsd += r.costUsd;
    if (args.signal?.aborted) throw fail("physics check aborted");
    if (r.thrown && !r.sawResult) throw fail(`physics check SDK error: ${r.error}`);
    const v = parsePhysics(r.text, ids);
    if (v) {
      args.log?.(`physics: ${v.ok ? "ok" : `${physicsGaps(v.findings).length} error(s)`} (${v.findings.length} finding(s))`);
      return { ...v, turns, costUsd, usage };
    }
    p = `${prompt}\n\nYour previous reply did not end with the JSON object. Reply with the JSON object only.`;
  }
  throw fail("physics check: the judge gave no usable reply");
}
