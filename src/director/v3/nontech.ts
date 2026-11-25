// v3 NON-TECHNICAL VIEWER JUDGE (W1; ADR-002 §6.4, R5 NT1 replacing CL1/CL2 + ST2/ST3/ST6 + the rubric total;
// SCORECARD G1–G5). v2's clarity judge listed 5 unknown terms on the TLS job and still returned ok:true; the owner
// then said a viewer without a tech background could not follow. Here a fresh judge PLAYS the Phase R persona —
// 34, works in retail, on Instagram every day, no tech background — and "watches" the reel once: the narration with
// its timings and pauses, plus a plain description of what is on screen. It must restate the explanation, list every
// word it did not know (and whether the reel explained it), name where it got lost and where it would scroll away.
// Blocking: see GATE RULE below (G1 restatement, G2 words, G3 scroll, G4 lost). It runs on the narrative before TTS (here) and again on the
// board digest after the storyboard (W4).
//
// GATE RULE (W1.1, orchestrator ruling 1 — ADOPTED amendment of ADR-002 §6.4, the default gate):
//   - a word the viewer understood from context (gotIt true: can say what it is in this video) only WARNS;
//   - a word the viewer did NOT understand that the reel SAYS or WRITES on screen (quoted note/overlay text) BLOCKS;
//     a puzzling word that only appears in a crew note warns;
//   - a lost point: ONE viewer's lost point is a blocking CANDIDATE; across the votes it BLOCKS only when ALL votes
//     lost the thread at the SAME line (owner ruling, D1-DECISIONS-V3 "W4.2 judge rulings — 2026-11-03" #1), else it
//     only WARNS, tagged LOST_WARN_TAG and carried onto the card like the "might" scrolls (viewerCardWarnings()).
//     With REEL_V3_NONTECH_VOTES=1 the one viewer is "all votes". "slowed" warns;
//   - a certain scroll before the payoff BLOCKS; a "might" scroll only WARNS, wherever it is and however many there are
//     (owner ruling, D1-DECISIONS-V3 "W4 judge gates — 2026-11-03" #1: the old ">= 2 'might' points before the payoff
//     block" rule blocked S2, which the owner accepted). "Might" points stay visible: they are warnings carried onto
//     the card (mightScrollWarnings(), tools.ts save_job → job.v3.json warnings);
//   - a wrong or point-missing restatement BLOCKS (G1).
//   Why not the literal §6.4 rule ("any unknown word or lost point blocks"): measured in W1, it failed 21 of 21 runs on
//   every narrative, including ones a human persona read followed end to end (W1 Review 3), because the viewer lists
//   everyday words it half-knows but understood ("https", "chip", "sound wave"). It is still computed on every reply
//   for $0 (`literal`), and REEL_V3_NONTECH_RULE=literal makes it gate.
// Votes: REEL_V3_NONTECH_VOTES=N (default 3, W1.1 ruling 2; 1 = a single viewer) runs N independent viewers; a
//   blocking finding (same word / same line) blocks when a majority of the votes raise it, else it is reported
//   (W1 measured the viewer flipping words and lines run to run on identical text).

import { DEFAULT_JUDGE_MODEL } from "../v2/judge.js";
import { firstJsonObject } from "../v2/clarity.js";
import { timingFor, type NarrativeT, type NarrativeTiming, type ScriptGap } from "../../schema/script.v3.js";
import { quotedScreenText } from "./terms.js";
import { clean, judgeSession, judgeVotes, modelFor, tag, type JudgeRunArgs, type JudgeSpend } from "./claims.js";

export const NONTECH_PERSONA =
  "You are 34 and work in retail. You are on Instagram every day and scroll fast. You have no tech background: you never studied networking, electronics or physics beyond school. You have a smartphone, use Wi-Fi, have a router at home, use headphones, have heard people say \"the server is down\" and think \"the lock means a website is safe\". You have never heard words like TLS, load balancer, certificate, photodiode or DSP.";

export const NONTECH_SYSTEM_PROMPT = `${NONTECH_PERSONA}
You just watched ONE short vertical video, once, with the sound on, at the pace given (timings and pauses are real). You know ONLY what the video says and shows. Do not use outside knowledge to fill gaps: if the video does not tell you, you do not know it. Be honest, not polite — the makers need to know where real viewers drop off.
The "you see" notes were written for the animation crew: picture what they describe. Only text inside single quotes in them is written ON SCREEN; every other word of the notes (plate, anchor, cutaway, driver, nacelle, push-in …) is a crew description you never see or hear.
Report:
1. restatement: explain what you learned to a friend, in your own everyday words, 2–4 sentences.
2. unknownWords: every word or phrase you heard or read that you did not know or only half knew, with the line id. "gotIt": true if you can say what it is or does IN THIS VIDEO (the video explained it, or the picture made it clear), even if you would like more detail; false only if you could not say what it refers to.
3. lost: moments where you LOST THE THREAD — you could not follow what the video was saying at that point and did not catch up. Empty if none.
4. slowed: moments that took you a moment or felt fast, but you caught up within a line or two. Empty if none.
5. scroll: points where you WOULD scroll away (be honest about yourself, not about a hypothetical bored viewer), with "certain": true; points where you only MIGHT drift off, with "certain": false. Empty if you would watch to the end.
6. wouldSend: would you send it to someone, and to whom.
Use the line ids exactly as they appear in the video (e.g. the id before each "you hear").
Reply with ONLY one JSON object:
{"restatement":"…","unknownWords":[{"word":"…","line":"<line id>","gotIt":true,"why":"…"}],"lost":[{"line":"<line id>","sec":35.0,"why":"…"}],"slowed":[{"line":"<line id>","sec":20.0,"why":"…"}],"scroll":[{"line":"<line id>","sec":62.0,"certain":true,"why":"…"}],"wouldSend":{"yes":true,"toWhom":"…"}}`;

export const NONTECH_COMPARE_SYSTEM_PROMPT = `You compare what a viewer understood from a short explainer video with the ONE point the video was written to make. You have no tools.
You get the intended point, the video's narration (for reference: what the viewer actually heard), and the viewer's restatement (written by a non-technical viewer who saw the video once). Read the restatement charitably: everyday wording of a true statement is not wrong (blood "bouncing red light back" = reflecting red light).
- "matches": true when the restatement gets the point's core right in everyday words (simpler wording and missing side details are fine).
- "wrong": ONLY statements in the restatement that are FALSE about the real thing or contradict the point (a misunderstanding the video caused); [] when nothing is false. No commentary in this list.
- "missing": core parts of the point the restatement does not contain (only parts a friend would need to get it).
Reply with ONLY one JSON object: {"matches":true|false,"wrong":["…"],"missing":["…"],"why":"one sentence"}`;

/** Crew notes → what a viewer sees: drop anchor ids (urlbar.schemeS), timings in ms and crew words. */
export function plainPicture(s: string): string {
  return String(s ?? "")
    .replace(/\bexample\.com\b/g, "EXAMPLECOM")
    .replace(/\b[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9.]*\b/g, "")
    .replace(/EXAMPLECOM/g, "example.com")
    .replace(/\(?\b\d+(?:-\d+)?\s?ms\b[^,;)]*\)?/gi, "")
    .replace(/\b(?:anchor|plate|keyframe|SFX|ease-out|ease)\b/gi, "")
    .replace(/\s+([,;.)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The viewer's "screening": per line, the time span, the words heard, the pause, what is on screen. */
export function nontechScreening(n: NarrativeT, timing: NarrativeTiming): string {
  const tl = new Map(timing.lines.map((l) => [l.id, l]));
  return n.lines
    .map((l) => {
      const t = tl.get(l.id);
      const a = t?.wordTimes[0]?.startSec ?? t?.startSec ?? 0;
      const b = t?.wordTimes.at(-1)?.endSec ?? a;
      const see = l.shot ? plainPicture([l.shot.note, l.shot.keyframe, l.shot.overlay].filter(Boolean).join("; ")) : "";
      return `${a.toFixed(1)}–${b.toFixed(1)} s ${l.id}: you hear "${l.text}"${l.pauseAfterMs ? ` (then ${(l.pauseAfterMs / 1000).toFixed(1)} s of silence)` : ""}${see ? `\n    you see: ${see}` : ""}`;
    })
    .join("\n");
}

export function nontechPrompt(n: NarrativeT, timing: NarrativeTiming, measured: boolean): string {
  return [
    `The video (${measured ? "timings measured from the real voice" : "timings estimated"}, ${n.leadSilenceMs} ms of picture before the first word):`,
    tag("video", nontechScreening(n, timing)),
    "Reply with the JSON object only.",
  ].join("\n");
}

export interface ViewerReply {
  restatement: string;
  unknownWords: Array<{ word: string; line: string; gotIt: boolean; why: string }>;
  lost: Array<{ line: string; sec: number | null; why: string }>;
  slowed: Array<{ line: string; sec: number | null; why: string }>;
  scroll: Array<{ line: string; sec: number | null; certain: boolean; why: string }>;
  wouldSend: { yes: boolean; toWhom: string };
}
export interface CompareReply {
  matches: boolean;
  wrong: string[];
  missing: string[];
  why: string;
}

const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Array<Record<string, unknown>>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseViewer(text: string): ViewerReply | null {
  const o = firstJsonObject(text);
  if (!o || typeof o.restatement !== "string") return null;
  const ws = (o.wouldSend ?? {}) as Record<string, unknown>;
  return {
    restatement: clean(o.restatement, 1200),
    unknownWords: arr(o.unknownWords).map((u) => ({ word: clean(u.word, 80), line: clean(u.line, 8), gotIt: u.gotIt === true || u.explained === true, why: clean(u.why, 300) })).filter((u) => u.word),
    lost: arr(o.lost).map((u) => ({ line: clean(u.line, 8), sec: num(u.sec), why: clean(u.why, 300) })).filter((u) => u.why || u.line),
    slowed: arr(o.slowed).map((u) => ({ line: clean(u.line, 8), sec: num(u.sec), why: clean(u.why, 300) })).filter((u) => u.why || u.line),
    scroll: arr(o.scroll).map((u) => ({ line: clean(u.line, 8), sec: num(u.sec), certain: u.certain !== false, why: clean(u.why, 300) })).filter((u) => u.why || u.line),
    wouldSend: { yes: ws.yes === true, toWhom: clean(ws.toWhom, 120) },
  };
}

/** One clause that only says "no error" ("none", "Nothing clearly false", "no real errors"). An entry is dropped only
 *  when EVERY clause is one (W1 fix round: the old unanchored filter dropped "Thinks no one can see …, which is wrong"). */
const NO_ERROR_CLAUSE = /^(?:none|n\/a|nothing|no(?:thing)?(?:\s+(?:clearly|real|clear|actual|obvious))?\s+(?:false|wrong|incorrect|errors?|misunderstandings?|mistakes?)(?:\s+(?:here|statements?|claims?|beliefs?|found))?|nothing\s+(?:is\s+)?(?:clearly\s+|really\s+)?(?:false|wrong|incorrect))$/i;

export function parseCompare(text: string): CompareReply | null {
  const o = firstJsonObject(text);
  if (!o || typeof o.matches !== "boolean") return null;
  // only an entry that IS a "no error" remark is dropped (anchored: "Thinks no one can see …, which is wrong" is a
  // real false belief and stays; W1 fix round)
  const isNoError = (x: string) => x.split(/[;,.!]+/).map((c) => c.trim()).filter(Boolean).every((c) => NO_ERROR_CLAUSE.test(c));
  return { matches: o.matches, wrong: (Array.isArray(o.wrong) ? o.wrong : []).map((x) => clean(x, 300)).filter((x) => x && !isNoError(x)), missing: (Array.isArray(o.missing) ? o.missing : []).map((x) => clean(x, 300)).filter(Boolean), why: clean(o.why, 300) };
}

const STOP = new Set("a an the of to in on at by for from with and or but so as is are was be it its it's this that these those your you my me i we our their them they his her what which who how why when where there here not no one some any all just very about into onto out up down over".split(" "));
const toks = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((t) => t.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter((t) => t && !STOP.has(t));

/** Light suffix folding for word matching (W1.1 fix round): plural -s/-es/-ies, -ing, -ed, -ion and a final -e fold
 *  to one stem on BOTH sides, so "photodiode" matches "photodiodes", "router" "routers", "decryption" "decrypts",
 *  "unseal" "unsealing", "terminate" "termination". Deliberately crude: it only has to say "same word" for the
 *  forms a viewer writes back, never to lemmatise English. */
export function stem(t: string): string {
  let w = t;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith("ion")) w = w.slice(0, -3);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** The reel's spoken + quoted on-screen words as stems, plus every adjacent pair joined ("wi fi" → "wifi"). */
function reelStems(n: Pick<NarrativeT, "lines">): Set<string> {
  const out = new Set<string>();
  for (const text of [...n.lines.map((l) => l.text), ...n.lines.flatMap((l) => quotedScreenText(l))]) {
    const ts = String(text ?? "").toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9']+/).map((t) => t.replace(/^'+|'+$/g, "").replace(/'s$/, "")).filter(Boolean);
    ts.forEach((t, i) => {
      if (!STOP.has(t)) out.add(stem(t));
      if (i + 1 < ts.length) out.add(stem(t + ts[i + 1]));
    });
  }
  return out;
}

/** Does the reel SAY or WRITE (quoted on-screen text) the viewer's unknown word or phrase? (W1.1) More than half of the
 *  phrase's content words (stop words dropped, possessive 's folded, whole-word match after stem()) must be spoken or
 *  quoted on screen. A phrase naming alternatives ("load balancer / reverse proxy", "a or b") counts as said when ANY
 *  alternative is; a hyphenated or spaced compound matches its joined form ("Wi-Fi" = "wifi"). W1's check matched any
 *  3+ letter token as a SUBSTRING of the reel text, so "the" (or "key" inside "keep") made every multi-word phrase
 *  "in the reel" and the crew-note exemption never applied; the first W1.1 version matched exact words only, so a
 *  viewer writing "photodiode" for a reel that says "photodiodes" only warned (W1.1 fix round). */
export function saidOrWritten(word: string, n: Pick<NarrativeT, "lines">): boolean {
  const reel = reelStems(n);
  const alts = String(word ?? "").split(/\s*(?:\/|\||;|,|\bor\b)\s*/i).filter((x) => x.trim());
  return alts.some((alt) => {
    const w = toks(alt).map(stem);
    if (!w.length) return false;
    if (w.length > 1 && reel.has(stem(toks(alt).join("")))) return true;
    return w.filter((t) => reel.has(t)).length * 2 > w.length;
  });
}

/** Marks a G3 gap that comes from a "might" scroll point (a warning by owner ruling; shown on the card). */
export const MIGHT_SCROLL_TAG = "might scroll";
/** Marks a G4 "lost the thread" gap that did not get a unanimous same-line vote (a warning by owner ruling
 *  2026-11-03 W4.2 #1; shown on the card). */
export const LOST_WARN_TAG = "lost, not unanimous: warning";

/** G1–G5 as gaps (pure). A CERTAIN scroll point blocks before the payoff (for an opening: anywhere); a "might" point
 *  only warns (owner ruling 2026-11-03). */
export function nontechGaps(v: ViewerReply | null, c: CompareReply | null, n: NarrativeT): ScriptGap[] {
  if (!v) return [{ gate: "nontech", code: "NT0", severity: "block", message: "non-technical viewer NOT CHECKED: no usable reply" }];
  const gaps: ScriptGap[] = [];
  const ids = n.lines.map((l) => l.id);
  const inReel = (w: string) => saidOrWritten(w, n);
  const payoffAt = n.scope === "reel" ? n.lines.findIndex((l) => l.act === "payoff") : n.lines.length;
  // judges sometimes answer "L10" for a W10 narrative: map by number when the prefix is wrong
  const lineOf = (l: string) => (ids.includes(l) ? l : ids.find((x) => x.slice(1) === l.slice(1) && /^[A-Z]\d{2}$/.test(l)) ?? l);
  const lineOk = (l: string) => (ids.includes(lineOf(l)) ? [lineOf(l)] : undefined);
  // G2 is about words the reel SAYS or WRITES: a "word" the viewer took from the crew notes (cross-section, nacelle)
  // that is neither spoken nor in quoted on-screen text is reported, not blocking (W1 r9/r10)

  for (const u of v.unknownWords.filter((x) => !x.gotIt && !inReel(x.word)))
    gaps.push({ gate: "nontech", code: "G2", severity: "warn", lines: lineOk(u.line), message: `"${u.word}" (${lineOf(u.line)}) puzzled the viewer but is neither spoken nor written on screen (crew note): ${u.why}` });
  for (const u of v.unknownWords.filter((x) => !x.gotIt && inReel(x.word)))
    gaps.push({ gate: "nontech", code: "G2", severity: "block", lines: lineOk(u.line), message: `the viewer did not know "${u.word}" (${lineOf(u.line)}) and still does not: ${u.why}`, hint: `Say it in everyday words, or show the thing first and describe it before naming it.` });
  for (const u of v.unknownWords.filter((x) => x.gotIt)) gaps.push({ gate: "nontech", code: "G2", severity: "warn", lines: lineOk(u.line), message: `new word "${u.word}" (${lineOf(u.line)}), understood by the end: ${u.why}` });
  for (const l of v.lost) gaps.push({ gate: "nontech", code: "G4", severity: "block", lines: lineOk(l.line), message: `the viewer lost the thread at ${lineOf(l.line)}${l.sec !== null ? ` (${l.sec} s)` : ""}: ${l.why}`, hint: "Fix the line the viewer names: one idea, a doer for the action, nothing the picture has not shown yet." });
  for (const l of v.slowed) gaps.push({ gate: "nontech", code: "G4", severity: "warn", lines: lineOk(l.line), message: `slowed the viewer at ${lineOf(l.line)}${l.sec !== null ? ` (${l.sec} s)` : ""}: ${l.why}` });
  // a "might" scroll point never blocks (owner ruling 2026-11-03, D1-DECISIONS-V3 "W4 judge gates" #1; before: two
  // or more before the payoff of a full reel blocked, which blocked the owner-accepted S2). It is a warning tagged
  // MIGHT_SCROLL_TAG so the card shows it. A CERTAIN scroll before the payoff still blocks.
  for (const s of v.scroll) {
    const i = ids.indexOf(lineOf(s.line));
    const early = i < 0 || i < payoffAt;
    const block = early && s.certain;
    gaps.push({ gate: "nontech", code: "G3", severity: block ? "block" : "warn", lines: lineOk(s.line), message: `the viewer ${s.certain ? "would" : "might"} scroll away at ${lineOf(s.line)}${s.sec !== null ? ` (${s.sec} s)` : ""}${s.certain ? "" : ` [${MIGHT_SCROLL_TAG}: warning]`}: ${s.why}`, ...(block ? { hint: "Give the viewer a reason to stay at that line: their own stake, a visible change, or cut it." } : {}) });
  }
  if (!v.wouldSend.yes) gaps.push({ gate: "nontech", code: "G5", severity: "warn", message: "the viewer would not send it to anyone" });
  if (!c) gaps.push({ gate: "nontech", code: "G1", severity: "block", message: "restatement NOT COMPARED: the comparison judge gave no usable reply" });
  else {
    if (c.wrong.length) gaps.push({ gate: "nontech", code: "G1", severity: "block", message: `the viewer came away with something false: ${c.wrong.join(" | ")}`, hint: "Find the line or picture that caused the wrong belief and make it unambiguous." });
    if (!c.matches) gaps.push({ gate: "nontech", code: "G1", severity: "block", message: `the restatement misses the point (${c.why})${c.missing.length ? `: missing ${c.missing.join(" | ")}` : ""}` });
  }
  return gaps;
}

/** ADR-002 §6.4 read literally: every unknown word the reel says or writes blocks (understood or not), plus every
 *  lost point. Pure; reported next to the calibrated gaps, never instead of them unless REEL_V3_NONTECH_RULE=literal. */
export function literalBlocking(v: ViewerReply | null, n: NarrativeT): string[] {
  if (!v) return ["no usable viewer reply"];
  const inReel = (w: string) => saidOrWritten(w, n);
  return [...v.unknownWords.filter((u) => inReel(u.word)).map((u) => `unknown word "${u.word}" (${u.line}${u.gotIt ? ", understood" : ""})`), ...v.lost.map((l) => `lost at ${l.line}`)];
}

const gapKey = (g: ScriptGap) => `${g.code}|${g.code === "G2" ? (/"([^"]+)"/.exec(g.message)?.[1] ?? "").toLowerCase() : g.code === "G1" ? "" : (g.lines ?? []).join(",")}`;

/** Majority vote over N viewers' gaps (pure).
 *  - A blocking key (same word for G2, same line set for G3/G4, any G1) raised by ≥ ⌊N/2⌋+1 votes blocks once; fewer → warn.
 *  - FAIL CLOSED (W1.1 fix round): a vote with no usable viewer reply (NT0) counts as agreeing with EVERY blocking key,
 *    like the fact check's "missing verdict = fail"; NT0 itself blocks when a majority of votes are unusable. Before,
 *    1 real block + 1 unusable + 1 clean vote merged to a pass.
 *  - PER-VOTE RULES (W1.1 fix round): "a lost point blocks" and "a certain scroll before the payoff blocks" are rules
 *    about ONE viewer's watch ("might" scrolls only warn since the 2026-11-03 owner ruling, so they never aggregate), so they are also voted as a whole: when a majority of votes block on G3
 *    somewhere — even on different lines — one aggregate block is emitted; for G4 the aggregate only WARNS (owner ruling
 *    2026-11-03 W4.2 #1: a "lost" point blocks only when ALL votes lost at the SAME line) (unless a per-line key already
 *    blocks for that code). Measured before the fix: 3/3 viewers lost at L10, L12, L17 merged to 0 blocks. G2 stays
 *    per word on purpose: the ruling blocks a particular word the reel says, and W1 measured the viewer naming a
 *    different half-known word run to run on identical text. */
export function mergeVotes(perVote: ReadonlyArray<readonly ScriptGap[]>): ScriptGap[] {
  const N = perVote.length;
  if (N <= 1) return [...(perVote[0] ?? [])];
  const need = Math.floor(N / 2) + 1;
  const unusable = new Set(perVote.map((gs, vi) => (gs.some((g) => g.code === "NT0") ? vi : -1)).filter((vi) => vi >= 0));
  const out: ScriptGap[] = [];
  if (unusable.size >= need) out.push({ gate: "nontech", code: "NT0", severity: "block", message: `non-technical viewer NOT CHECKED: ${unusable.size}/${N} votes gave no usable reply` });
  const seen = new Set<string>();
  const all = perVote.flatMap((gs, vi) => gs.map((g) => ({ g, vi })));
  for (const { g } of all) {
    if (g.code === "NT0") continue;
    const k = `${g.severity === "warn" ? "w" : "b"}|${gapKey(g)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (g.severity === "warn") {
      out.push(g);
      continue;
    }
    const voters = new Set([...unusable, ...all.filter((x) => x.g.severity !== "warn" && gapKey(x.g) === gapKey(g)).map((x) => x.vi)]);
    const votes = voters.size;
    const note = unusable.size ? `, ${unusable.size} unusable counted as agreeing` : "";
    // G4 "lost" needs EVERY vote at the same line (owner ruling 2026-11-03 W4.2 #1); everything else a majority
    if (g.code === "G4") {
      out.push(votes >= N ? { ...g, message: `${g.message} [${votes}/${N} votes, unanimous${note}]` } : { ...g, severity: "warn", message: `${g.message} [${votes}/${N} votes; ${LOST_WARN_TAG}]` });
      continue;
    }
    out.push(votes >= need ? { ...g, message: `${g.message} [${votes}/${N} votes${note}]` } : { ...g, severity: "warn", message: `${g.message} [${votes}/${N} votes: below the majority, reported]` });
  }
  for (const code of ["G4", "G3"] as const) {
    if (out.some((g) => g.code === code && g.severity !== "warn")) continue;
    const per = perVote.map((gs, vi) => (unusable.has(vi) ? null : gs.filter((g) => g.code === code && g.severity !== "warn")));
    const voters = per.filter((x) => x === null || x.length > 0).length;
    if (voters < need) continue;
    // every real vote on the SAME line(s): the per-line gap above already says it (no "different lines" aggregate)
    if (new Set(per.flatMap((x) => (x ?? []).map((g) => (g.lines ?? []).join(",")))).size <= 1) continue;
    const where = per.map((x, vi) => `v${vi + 1}: ${x === null ? "unusable" : x.length ? x.map((g) => (g.lines ?? ["?"]).join(",")).join(" ") : "-"}`).join("; ");
    const lines = [...new Set(per.flatMap((x) => (x ?? []).flatMap((g) => g.lines ?? [])))];
    // G4 on different lines only WARNS (owner ruling 2026-11-03 W4.2 #1: only a unanimous same-line "lost" blocks)
    const warnOnly = code === "G4";
    out.push({
      gate: "nontech",
      code,
      severity: warnOnly ? "warn" : "block",
      ...(lines.length ? { lines } : {}),
      message: `${code === "G4" ? "a majority of viewers lost the thread" : "a majority of viewers would scroll away before the payoff"}, on different lines [${voters}/${N} votes; ${where}${warnOnly ? `; ${LOST_WARN_TAG}` : ""}]`,
      hint: code === "G4" ? "Each viewer got lost somewhere different: the stretch is too dense — fewer ideas, each shown before it is named." : "Each viewer drifted somewhere different: the middle sags — give the viewer a stake or a visible change sooner, or cut.",
    });
  }
  return out;
}

type CardGap = { code: string; severity: string; message: string; lines?: readonly string[]; beats?: readonly string[] };

/** The "lost the thread" points that only warn (not unanimous; owner ruling 2026-11-03 W4.2 #1), as plain lines for
 *  the card. Deduplicated by message; "slowed" (also G4) is not included. */
export function lostWarnings(gaps: ReadonlyArray<CardGap>): string[] {
  const out = new Set<string>();
  for (const g of gaps) if (g.severity === "warn" && /(?:^|:)G4$/.test(g.code) && g.message.includes(LOST_WARN_TAG)) out.add(g.message.slice(0, 300));
  return [...out];
}

/** Every viewer warning that goes on the card: "might scroll" points + non-unanimous "lost" points. */
export function viewerCardWarnings(gaps: ReadonlyArray<CardGap>): string[] {
  return [...mightScrollWarnings(gaps), ...lostWarnings(gaps)];
}

/** The "might scroll" warnings of a gap list (script or board stage), as plain lines for the card. Deduplicated by
 *  line; a gap that already blocks is not a warning. */
export function mightScrollWarnings(gaps: ReadonlyArray<{ code: string; severity: string; message: string; lines?: readonly string[]; beats?: readonly string[] }>): string[] {
  const out = new Map<string, string>();
  for (const g of gaps) {
    if (g.severity !== "warn" || !/(?:^|:)G3$/.test(g.code) || !g.message.includes(`[${MIGHT_SCROLL_TAG}`)) continue;
    const k = (g.lines ?? g.beats ?? []).join(",").toLowerCase() || g.message;
    if (!out.has(k)) out.set(k, g.message.replace(` [${MIGHT_SCROLL_TAG}: warning]`, "").slice(0, 300));
  }
  return [...out.values()];
}

export interface NontechResult {
  ok: boolean;
  viewer: ViewerReply | null;
  compare: CompareReply | null;
  /** Every vote's viewer/compare (length = votes). */
  viewers: Array<ViewerReply | null>;
  compares: Array<CompareReply | null>;
  gaps: ScriptGap[];
  /** ADR-002 §6.4 read literally (see the header): per vote, and whether a majority of votes pass it. */
  literal: { ok: boolean; perVote: string[][] };
  rule: "calibrated" | "literal";
  measured: boolean;
  raw: { viewer: string; compare: string };
  spend: JudgeSpend[];
}

export async function runNontech(a: JudgeRunArgs & { narrative: NarrativeT; timing?: NarrativeTiming | null; votes?: number }): Promise<NontechResult> {
  const env = a.env ?? process.env;
  const votes = judgeVotes("REEL_V3_NONTECH_VOTES", a);
  const rule = env.REEL_V3_NONTECH_RULE === "literal" ? "literal" : "calibrated";
  const runs = await Promise.all(Array.from({ length: votes }, (_, i) => runOneViewer({ ...a, ...(votes > 1 ? { claudeDir: a.claudeDir ? `${a.claudeDir}-v${i + 1}` : a.claudeDir } : {}) })));
  const n = a.narrative;
  const perVoteLiteral = runs.map((r) => literalBlocking(r.viewer, n));
  const need = Math.floor(votes / 2) + 1;
  const literal = { ok: perVoteLiteral.filter((x) => x.length === 0).length >= need, perVote: perVoteLiteral };
  let gaps = mergeVotes(runs.map((r) => r.gaps));
  if (rule === "literal" && !literal.ok) gaps = [...gaps, { gate: "nontech", code: "G6L", severity: "block", message: `ADR-002 §6.4 literal: ${perVoteLiteral[0].join("; ")}` }];
  const spend = runs.flatMap((r) => r.spend);
  a.log?.(`nontech: ${gaps.filter((g) => g.severity !== "warn").length} blocking (${votes} vote${votes > 1 ? "s" : ""}, literal §6.4 ${literal.ok ? "pass" : "fail"}), $${spend.reduce((s, x) => s + x.costUsd, 0).toFixed(4)}`);
  return {
    ok: !gaps.some((g) => g.severity !== "warn"),
    viewer: runs[0].viewer,
    compare: runs[0].compare,
    viewers: runs.map((r) => r.viewer),
    compares: runs.map((r) => r.compare),
    gaps,
    literal,
    rule,
    measured: runs[0].measured,
    raw: votes === 1 ? runs[0].raw : { viewer: runs.map((r, i) => `--- vote ${i + 1} ---\n${r.raw.viewer}`).join("\n"), compare: runs.map((r, i) => `--- vote ${i + 1} ---\n${r.raw.compare}`).join("\n") },
    spend,
  };
}

async function runOneViewer(a: JudgeRunArgs & { narrative: NarrativeT; timing?: NarrativeTiming | null }): Promise<{ viewer: ViewerReply | null; compare: CompareReply | null; gaps: ScriptGap[]; measured: boolean; raw: { viewer: string; compare: string }; spend: JudgeSpend[] }> {
  const n = a.narrative;
  const { timing, measured } = timingFor(n, a.timing);
  const vs = await judgeSession("nontech", NONTECH_SYSTEM_PROMPT, modelFor("REEL_V3_NONTECH_MODEL", DEFAULT_JUDGE_MODEL, a), a);
  const prompt = nontechPrompt(n, timing, measured);
  let rawV = await vs.ask(prompt);
  let viewer = parseViewer(rawV);
  if (!viewer) {
    rawV = await vs.ask(`${prompt}\n\nYour previous reply was not the JSON object. Reply with the JSON object only.`);
    viewer = parseViewer(rawV);
  }
  const spend = [vs.spend];
  let compare: CompareReply | null = null;
  let rawC = "";
  if (viewer) {
    // a separate model call (default Sonnet) without the persona: point (+ the narration for reference) vs restatement
    const cs = await judgeSession("nontech-compare", NONTECH_COMPARE_SYSTEM_PROMPT, modelFor("REEL_V3_NONTECH_COMPARE_MODEL", DEFAULT_JUDGE_MODEL, { env: a.env }), a);
    rawC = await cs.ask([tag("intended_point", n.point), tag("narration", n.lines.map((l) => l.text).join(" ")), tag("viewer_restatement", viewer.restatement), "Reply with the JSON object only."].join("\n"));
    compare = parseCompare(rawC);
    spend.push(cs.spend);
  }
  const gaps = nontechGaps(viewer, compare, n);
  return { viewer, compare, gaps, measured, raw: { viewer: rawV, compare: rawC }, spend };
}
