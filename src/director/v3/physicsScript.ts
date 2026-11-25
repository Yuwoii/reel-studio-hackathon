// v3 PHYSICS + ANALOGY JUDGE AT THE SCRIPT STAGE (W1; ADR-002 §7 step 4, R5 PH1 moved earlier + AN1; decision 5g:
// "physics judge runs on the SCRIPT before TTS as a blocking check"). In v2 the physics judge ran at
// submit_storyboard, after TTS, so its findings on the TLS job ("closes your connection" vs "encrypts the responses
// back") only ever shipped as a red badge. Here a fresh expert (strongest model, v2 judge isolation) reads the
// narration, the shot intents (drawn behaviour is a claim, R1 §8.6), the analogy table with its "breaks" column, the
// extracted claims and (W4) the planned assets' ASSET FACTS, and checks them against ESTABLISHED physics and
// engineering — not against the writer's sources. Any "error" blocks; nits are reported. Rewrite suggestions are
// hints for the writer, never applied.
// W1.1: majority-of-N voting (default 3, REEL_V3_PHYSICS_VOTES): an error blocks only when a majority of independent
// judges flag an error on the same line (mergePhysicsVotes); a minority error is reported as a nit with its count.

import { firstJsonObject } from "../v2/clarity.js";
import { DEFAULT_PHYSICS_MODEL, ESCALATE_KINDS, type PhysicsKind } from "../v2/physics.js";
import type { ClaimsT, NarrativeT, ScriptGap, SourcesT } from "../../schema/script.v3.js";
import { hasOwnerData } from "./dataPack.js";
import { analogyBlock, clean, judgeSession, judgeVotes, majorityOf, modelFor, narrationBlock, tag, voteDir, type JudgeRunArgs, type JudgeSpend } from "./claims.js";

export const PHYSICS_SCRIPT_MAX_REPAIRS = 1;
/** v2's six kinds plus the analogy and asset kinds (AN1; ADR-002 §6.2 wrong-asset-claim). */
export const PHYSICS_SCRIPT_KINDS = [
  "wrong-simplification",
  "wrong-direction",
  "wrong-mechanism-drawn",
  "overstatement",
  "brand-attribution",
  "contradiction",
  "misleading-analogy",
  "leans-on-break",
  "analogy-vs-real-world",
  "wrong-asset-claim",
] as const;
export type PhysicsScriptKind = (typeof PHYSICS_SCRIPT_KINDS)[number];
const HARMLESS = /\b(?:harmless|fine for (?:this|the|a general) (?:audience|viewer)|acceptable simplification|would not mislead)\b/i;
const ANALOGY_KINDS: ReadonlySet<string> = new Set(["misleading-analogy", "leans-on-break"]);

export const PHYSICS_SCRIPT_SYSTEM_PROMPT = `You are a senior physicist and engineer (networking, electronics, acoustics, physiology as needed). You review the SCRIPT of a 60–80 s "how it works" explainer for a general, non-technical audience BEFORE it is voiced and animated. Judge it against ESTABLISHED physics and engineering — textbooks, standards, how real devices and systems are actually built — not against whatever the writer read. Simplifying is fine and expected; saying or showing something false is not.
You get: the numbered narration, each line's PICTURE notes (what will be drawn and animated — animated behaviour is a claim too: what blinks, how fast, where an effect happens, what travels where), the carrier ANALOGY table (analogy part → real part, what carries over, where it breaks), the extracted claims, and facts about the planned real-object assets (what each image does and does not show truthfully).
Flag with severity "error" only these:
1. wrong-simplification — a simplification that is false as stated, or a device/system said to work in a way it does not.
2. wrong-direction — a change in the wrong direction (more vs less, up vs down) in words or picture.
3. wrong-mechanism-drawn — the picture notes draw a different mechanism, place or rate than the real one (e.g. LEDs blinking at heart rate when they flash hundreds of times a second; cancellation drawn everywhere instead of at the ear).
4. overstatement — an absolute where the truth is partial and the difference matters ("can't be read" is fine for contents but not if it implies the destination is hidden too).
5. brand-attribution — one vendor's product presented as THE technology.
6. contradiction — two lines (or a line and its picture) that cannot both be true.
7. misleading-analogy — a viewer reasoning ONLY from the analogy would reach a wrong answer to the reel's own question, or a false belief about the real thing.
8. leans-on-break — a line relies on exactly the part of the analogy the table says breaks.
9. analogy-vs-real-world — a line contradicts how the analogy SOURCE works in everyday life (an envelope's address is on the outside), so the picture jars.
10. wrong-asset-claim — a line or picture claims something the asset facts say the image does not show.
Use severity "nit" for imprecise but harmless wording a viewer would not misunderstand. Do NOT flag style, pacing, a missing detail, or a true statement that is merely simple.
First AUDIT in plain text (no curly braces), one line per check: A every consequence/number; B every stated direction vs the picture; C every drawn system, rate and place; D every absolute; E every analogy row used — does the main claim still come out right, does any line lean on its break, does it fit the source's real-world behaviour; F contradictions between lines; G asset facts.
Then for every finding give the lines, the exact words (quote them), why it is wrong in one or two plain sentences, and a HINT for the writer (what would be true; ≤ 30 words — the writer rewrites in their own voice).
End your reply with ONE JSON object (nothing after it):
{"ok":true|false,"findings":[{"lines":["L05"],"kind":"…","severity":"error|nit","where":"narration|picture|analogy|both","claim":"…","why":"…","hint":"…"}]}
"ok" is true exactly when there is no "error" finding.`;

export interface PhysicsScriptFinding {
  lines: string[];
  kind: PhysicsScriptKind;
  severity: "error" | "nit";
  where: "narration" | "picture" | "analogy" | "both";
  claim: string;
  why: string;
  hint: string;
}

export interface PhysicsScriptResult {
  ok: boolean;
  /** Merged findings (majority vote when votes > 1). */
  findings: PhysicsScriptFinding[];
  gaps: ScriptGap[];
  raw: string;
  /** One JudgeSpend per vote (call order). */
  spend: JudgeSpend[];
  votes: number;
  /** Every vote's escalated findings (null = no usable reply). */
  perVote: Array<PhysicsScriptFinding[] | null>;
}

/** DATA JOBS only (the sources cite the owner's measured data, code-decided by host): measured counts are not physics. */
export const MEASURED_DATA_NOTE = "This script reports the owner's own MEASURED counts from a honeypot (a decoy server that logs every request it gets) for one week. Those counts, dates and shares are measurements another checker verifies against the log: they are NOT physics or engineering claims — never flag their size, never judge them against general knowledge, and do not ask for a source. Judge only what the script says about HOW things work (what the scanned file is, what a request does, what the pictures show) and directions in words and pictures.";

export function physicsScriptPrompt(n: NarrativeT, claims: ClaimsT | null, assetFacts: readonly string[] = [], o: { measuredData?: boolean } = {}): string {
  return [
    ...(o.measuredData ? [tag("measured_data", MEASURED_DATA_NOTE)] : []),
    tag("title", n.title),
    tag("point_the_reel_makes", n.point),
    tag("narration_with_pictures", narrationBlock(n, { shots: true })),
    tag("analogy_table", analogyBlock(n)),
    tag("claims", claims?.claims.map((c) => `${c.id} [${c.kind}; ${c.lines.join(",")}] ${c.text}`).join("\n") || "(not extracted)"),
    tag("asset_facts", assetFacts.join("\n") || "(no registry assets planned yet: judge the picture notes as drawn illustrations)"),
    "Audit first (plain text), then end with the JSON object.",
  ].join("\n");
}

export function parsePhysicsScript(text: string, lineIds: ReadonlySet<string>): { ok: boolean; findings: PhysicsScriptFinding[] } | null {
  const t = String(text ?? "");
  const at = t.search(/\{\s*"ok"\s*:/);
  const o = firstJsonObject(at >= 0 ? t.slice(at) : t);
  if (!o || !Array.isArray(o.findings)) return null;
  const findings: PhysicsScriptFinding[] = [];
  for (const x of o.findings as unknown[]) {
    if (!x || typeof x !== "object") continue;
    const f = x as Record<string, unknown>;
    const why = clean(f.why, 500);
    if (!why) continue;
    const kind = (PHYSICS_SCRIPT_KINDS as readonly string[]).includes(String(f.kind)) ? (f.kind as PhysicsScriptKind) : "wrong-simplification";
    const where = (["narration", "picture", "analogy", "both"] as const).find((w) => w === f.where) ?? "narration";
    findings.push({ lines: (Array.isArray(f.lines) ? f.lines : []).map(String).filter((l) => lineIds.has(l)).slice(0, 8), kind, severity: f.severity === "nit" ? "nit" : "error", where, claim: clean(f.claim, 300), why, hint: clean(f.hint, 300) });
  }
  return { ok: !escalate(findings).some((f) => f.severity === "error"), findings: escalate(findings).slice(0, 12) };
}

/** v2 W7.3 rule, kept: a "nit" in which the PICTURE contradicts the narration (direction / mechanism / overstatement /
 *  contradiction) is an error. Analogy nits stay nits unless they lean on the break or mislead. */
export function escalate(fs: readonly PhysicsScriptFinding[]): PhysicsScriptFinding[] {
  return fs.map((f) => {
    if (f.severity !== "nit") return f;
    // the judge's own "harmless for this audience" keeps an OVERSTATEMENT nit a nit (W1 r4); it never rescues a
    // wrong direction, a wrong drawn mechanism or a contradiction on the picture (v2 W7.3 + decision 5g; W1 fix round)
    if (f.kind === "overstatement" && HARMLESS.test(f.why)) return f;
    if ((f.where === "picture" || f.where === "both") && ESCALATE_KINDS.has(f.kind as PhysicsKind)) return { ...f, severity: "error", why: `${f.why} (escalated: the picture contradicts the narration as drawn)` };
    if (ANALOGY_KINDS.has(f.kind)) return { ...f, severity: "error", why: `${f.why} (escalated: an analogy that misleads is an error)` };
    return f;
  });
}

export function physicsScriptGaps(fs: readonly PhysicsScriptFinding[]): ScriptGap[] {
  return fs.map((f) => ({
    gate: "physics" as const,
    code: `PH:${f.kind}`,
    severity: f.severity === "error" ? ("block" as const) : ("warn" as const),
    lines: f.lines,
    message: `[${f.kind}, ${f.where}]${f.claim ? ` "${f.claim}"` : ""}: ${f.why}`,
    ...(f.hint ? { hint: f.hint } : {}),
  }));
}

/** Majority vote over N physics judges (pure; W1.1 ruling 2). Findings are already escalated per vote. An error
 *  finding blocks when a majority of votes raise an error on at least one of its lines (two experts independently
 *  flagging the same line is one problem, even when they name a different kind); a finding without lines matches by
 *  kind. An error below the majority is kept as a nit with its vote count; nits are kept, de-duplicated by
 *  kind + lines. With one vote it returns that vote unchanged.
 *  FAIL CLOSED (W1.1 fix round): a vote with no usable reply (null) counts as agreeing with EVERY error, like the
 *  fact check's "missing verdict = fail". Before, its findings were merged as [] — a clean vote — so 1 error + 1
 *  unusable + 1 clean vote passed (measured with a fake queryImpl). */
export function mergePhysicsVotes(perVote: ReadonlyArray<readonly PhysicsScriptFinding[] | null>): PhysicsScriptFinding[] {
  const N = perVote.length;
  if (N <= 1) return [...(perVote[0] ?? [])];
  const need = majorityOf(N);
  const hits = (f: PhysicsScriptFinding, vote: readonly PhysicsScriptFinding[] | null) =>
    vote === null ||
    vote.some((g) => g.severity === "error" && (f.lines.length && g.lines.length ? g.lines.some((l) => f.lines.includes(l)) : g.kind === f.kind));
  const out: PhysicsScriptFinding[] = [];
  const seen = new Set<string>();
  perVote.forEach((vote) => {
    for (const f of vote ?? []) {
      const key = `${f.severity}|${f.kind}|${[...f.lines].sort().join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (f.severity !== "error") {
        out.push(f);
        continue;
      }
      const votes = perVote.filter((v) => hits(f, v)).length;
      // one blocking finding per agreed line set is enough: skip a later vote's duplicate of an agreed error
      if (votes >= need && out.some((o) => o.severity === "error" && hits(f, [o]))) continue;
      const nulls = perVote.filter((v) => v === null).length;
      out.push(votes >= need ? { ...f, why: `${f.why} [${votes}/${N} votes${nulls ? `, ${nulls} unusable counted as agreeing` : ""}]` } : { ...f, severity: "nit", why: `${f.why} [${votes}/${N} votes: below the majority, reported]` });
    }
  });
  return out;
}

/** The script-stage physics judge with majority-of-N voting (REEL_V3_PHYSICS_VOTES, default 3). */
export async function runPhysicsScript(a: JudgeRunArgs & { narrative: NarrativeT; claims: ClaimsT | null; assetFacts?: readonly string[]; votes?: number; sources?: SourcesT }): Promise<PhysicsScriptResult> {
  const N = judgeVotes("REEL_V3_PHYSICS_VOTES", a);
  const runs = await Promise.all(Array.from({ length: N }, (_, i) => runOnePhysics({ ...a, claudeDir: voteDir(a.claudeDir, i, N) })));
  const spend = runs.map((r) => r.spend);
  const raw = N === 1 ? runs[0].raw : runs.map((r, i) => `--- vote ${i + 1} ---\n${r.raw}`).join("\n");
  // a vote with no usable reply counts as a blocking "not checked" vote: fail closed when a majority has none
  const usable = runs.filter((r) => r.findings !== null);
  if (usable.length < majorityOf(N)) {
    const gaps: ScriptGap[] = [{ gate: "physics", code: "PH0", severity: "block", message: `physics NOT CHECKED: ${N - usable.length}/${N} judge vote(s) gave no usable reply` }];
    return { ok: false, findings: [], gaps, raw, spend, votes: N, perVote: runs.map((r) => r.findings) };
  }
  const findings = mergePhysicsVotes(runs.map((r) => r.findings));
  const gaps = physicsScriptGaps(findings);
  if (N > 1) a.log?.(`physics: ${gaps.filter((g) => g.severity === "block").length} error(s) by majority of ${N}, $${spend.reduce((t, x) => t + x.costUsd, 0).toFixed(4)}`);
  return { ok: !findings.some((f) => f.severity === "error"), findings, gaps, raw, spend, votes: N, perVote: runs.map((r) => r.findings) };
}

async function runOnePhysics(a: JudgeRunArgs & { narrative: NarrativeT; claims: ClaimsT | null; assetFacts?: readonly string[]; sources?: SourcesT }): Promise<{ findings: PhysicsScriptFinding[] | null; raw: string; spend: JudgeSpend }> {
  const model = modelFor("REEL_V3_PHYSICS_MODEL", process.env.REEL_V2_PHYSICS_MODEL?.trim() || DEFAULT_PHYSICS_MODEL, a);
  const s = await judgeSession("physics", PHYSICS_SCRIPT_SYSTEM_PROMPT, model, a);
  const ids = new Set(a.narrative.lines.map((l) => l.id));
  const prompt = physicsScriptPrompt(a.narrative, a.claims, a.assetFacts, hasOwnerData(a.sources) ? { measuredData: true } : {});
  let raw = await s.ask(prompt);
  let v = parsePhysicsScript(raw, ids);
  for (let r = 0; !v && r < PHYSICS_SCRIPT_MAX_REPAIRS; r++) {
    raw = await s.ask(`${prompt}\n\nYour previous reply did not end with the JSON object. Reply with the JSON object only.`);
    v = parsePhysicsScript(raw, ids);
  }
  a.log?.(`physics: ${v ? (v.ok ? "ok" : `${v.findings.filter((f) => f.severity === "error").length} error(s)`) : "no reply"}, $${s.spend.costUsd.toFixed(4)}`);
  return { findings: v?.findings ?? null, raw, spend: s.spend };
}
