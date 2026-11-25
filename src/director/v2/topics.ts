// W7 topic tracks + the curated fundamentals list (owner feedback 2026-10-27: the W6 pilot topics — incident
// postmortems — were confusing; the owner wants FUNDAMENTAL "how does this actually work" topics explained in great
// detail, e.g. how a touch screen finds your finger, how a watch reads your pulse with green light; NOT the OSI model).
//
// Two tracks (script.track):
//   - "root-cause"   incidents and failure mechanisms; series label ROOT CAUSE (unchanged);
//   - "how-it-works" fundamentals; series label HOW IT WORKS, headerMode SPEC, mode concept, story-first (story.ts),
//                    ≤ 2 primary sources, plain-language gate (clarity.ts).
// The labels are config: REEL_V2_SERIES_ROOT_CAUSE / REEL_V2_SERIES_HOW_IT_WORKS override the defaults.
//
// A vague or empty owner prompt ("surprise me", "something interesting") gets a curated topic picked by code
// (pickCuratedTopic), never a director's free choice — the curated list is what the owner asked for.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SERIES, SERIES_LABEL_RE } from "../../schema/storyboard.v2.js";
import type { ScriptTrack, ScriptV2 } from "../../schema/script.v2.js";
import { CURATED_TOPICS, type CuratedTopic } from "./curatedTopics.js";

export { CURATED_TOPICS, type CuratedTopic };

export const HOW_IT_WORKS_SERIES = "HOW IT WORKS" as const;
export const DEFAULT_SERIES_LABELS: Readonly<Record<ScriptTrack, string>> = Object.freeze({ "root-cause": SERIES, "how-it-works": HOW_IT_WORKS_SERIES });
/** How-it-works: at most this many cited (primary) sources per reel (fact check unchanged). */
export const HOW_IT_WORKS_MAX_SOURCES = 2;
/** The series CTA per track (≤ 7 words, follow). */
export const TRACK_CTA: Readonly<Record<ScriptTrack, string>> = Object.freeze({ "root-cause": "Follow for more root causes.", "how-it-works": "Follow to see how things work." });

const ENV_KEY: Readonly<Record<ScriptTrack, string>> = { "root-cause": "REEL_V2_SERIES_ROOT_CAUSE", "how-it-works": "REEL_V2_SERIES_HOW_IT_WORKS" };

/** The configured series label per track (env override when it is a valid label, else the default). */
export function seriesLabels(env: NodeJS.ProcessEnv = process.env): Record<ScriptTrack, string> {
  const out = { ...DEFAULT_SERIES_LABELS };
  for (const t of Object.keys(out) as ScriptTrack[]) {
    const v = env[ENV_KEY[t]]?.trim().toUpperCase();
    if (v && SERIES_LABEL_RE.test(v)) out[t] = v;
  }
  return out;
}

export const trackOf = (s: Pick<ScriptV2, "track">): ScriptTrack => s.track ?? "root-cause";
export const isHowItWorks = (s: Pick<ScriptV2, "track">): boolean => trackOf(s) === "how-it-works";

/** The series label a script's board must carry. */
export function seriesOf(s: Pick<ScriptV2, "track" | "series">, env: NodeJS.ProcessEnv = process.env): string {
  return s.series ?? seriesLabels(env)[trackOf(s)];
}

// ── W7.1: the track is deterministic ───────────────────────────────────────────────────────────────────────────
// W7 pilots: 2 of 3 how-it-works drafts carried no script.track (one even "root-cause"), so the header, the card, the
// cover and the CTA said ROOT CAUSE and the ≤ 2-source cap never ran. The job's track is now decided by code from the
// owner prompt (jobTrackOf, stored in state.track at draft time) and a script without a track gets it (withTrack).

/** "how does X work" / "why does X …" questions (and "how X works"): a fundamentals prompt. "why did …" (an event) is not. */
const HOW_QUESTION_RE =
  /\b(?:how|why)\s+(?:does|do|can|could|would|is|are)\s+(?:\S+\s+){0,8}?(?:work|works|know|knows|find|finds|tell|tells|see|sees|sense|senses|measure|measures|detect|detects|stay|stays|keep|keeps|make|makes|charge|charges|heat|heats|remember|remembers|read|reads|hear|hears|erase|erases|cancel|cancels|drift|drifts|focus|focuses|scan|scans|show|shows|count|counts|recogni[sz]e|recogni[sz]es)\b|\bhow\s+(?:an?\s+|the\s+|your\s+|my\s+)?[\w-]+(?:\s+[\w-]+){0,3}\s+(?:actually\s+)?works?\b|\bhow\s+(?:it|they|this|that)\s+(?:actually\s+)?works?\b/i;

/** True when the owner prompt is a "how does / why does X work" question. */
export function isHowQuestion(prompt: string): boolean {
  const p = String(prompt ?? "").replace(/\s+/g, " ").trim();
  // a prompt that OPENS with "how / why does …" asks about a mechanism ("why does ice float"); inside a longer prompt
  // only the explicit "… work / know / find …" forms count
  return /^(?:(?:but|so|ok|okay|hey)\s+)?(?:how|why)\s+(?:does|do|can|is|are)\s+\S/i.test(p) || HOW_QUESTION_RE.test(p);
}

/** Everyday names of each curated topic (lower case; spaces also match written together: "touch screen" = "touchscreen"). */
export const TOPIC_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  touchscreen: ["touchscreen", "touch screen", "capacitive touch", "multi touch", "multitouch", "screen know where your finger", "screen find your finger"],
  "heartbeat-ppg": ["heart rate", "heartbeat", "pulse", "green light", "ppg", "photoplethysmography", "apple watch", "smartwatch", "fitness tracker", "oximeter"],
  "gps-relativity": ["gps", "satnav", "sat nav", "satellite navigation", "gnss", "galileo"],
  "noise-cancelling": ["noise cancelling", "noise canceling", "noise cancellation", "anc", "airpods pro"],
  "wireless-charging": ["wireless charging", "wireless charger", "qi charging", "qi charger", "magsafe", "inductive charging", "charge with no wire", "charges with no wire"],
  "face-id": ["face id", "faceid", "face unlock", "face recognition", "dot projector", "truedepth"],
  "ssd-flash": ["ssd", "flash memory", "nand", "solid state drive", "usb stick", "memory card"],
  "fiber-optics": ["fiber optic", "fibre optic", "optical fiber", "optical fibre", "fiber cable", "fibre cable", "undersea cable", "internet cable", "total internal reflection"],
  "qr-error-correction": ["qr code", "qr codes", "reed solomon", "reed-solomon"],
  "shazam-fingerprint": ["shazam", "song recognition", "audio fingerprint", "recognise a song", "recognize a song"],
  "bayer-filter": ["bayer", "colour filter array", "color filter array", "camera sensor colour", "camera sensor color", "one colour per pixel", "one color per pixel"],
  "phase-detect-autofocus": ["autofocus", "auto focus", "phase detect", "phase detection"],
  "e-ink": ["e ink", "eink", "e paper", "epaper", "e reader", "ereader", "kindle"],
  "microwave-oven": ["microwave"],
  "contactless-card": ["contactless", "tap to pay", "nfc", "rfid", "contactless card", "bank card"],
  accelerometer: ["accelerometer", "gyroscope", "mems", "which way is down", "screen rotation", "auto rotate"],
  "usb-c-power": ["usb c", "usb-c", "usb power delivery", "usb pd", "fast charging", "fast charger"],
  "oled-pixel": ["oled", "amoled", "perfect black"],
});

const INCIDENT_RE = /\b(?:19|20)\d\d\b|\b(?:outage|incident|postmortem|post-mortem|went down|go down|breach|hack(?:ed)?|recall(?:ed)?|bug|crash(?:ed)?)\b/i;
const normTopicText = (s: string) => ` ${String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * The curated topic a NAMED prompt is about ("how does the apple watch read my pulse?" → heartbeat-ppg), or null.
 * Deterministic: the longest alias (or slug) found as whole words, spaced or written together; ties go to the list
 * order. Vague prompts are not matched here (pickCuratedTopic handles them).
 */
export function matchCuratedTopic(prompt: string, list: readonly CuratedTopic[] = CURATED_TOPICS): CuratedTopic | null {
  // an incident prompt that merely mentions a device ("the 2024 GPS jamming outage") stays a root-cause reel
  if (INCIDENT_RE.test(String(prompt ?? ""))) return null;
  const p = normTopicText(prompt);
  if (p.trim().length < 2) return null;
  const compact = ` ${p.replace(/ /g, "")} `;
  let best: { t: CuratedTopic; len: number } | null = null;
  for (const t of list) {
    for (const a of [...(TOPIC_ALIASES[t.slug] ?? []), t.slug.replace(/-/g, " ")]) {
      const n = normTopicText(a);
      const hit = p.includes(n) || (n.trim().includes(" ") && compact.includes(n.replace(/ /g, "")));
      if (hit && (!best || n.length > best.len)) best = { t, len: n.length };
    }
  }
  return best?.t ?? null;
}

export interface JobTrack {
  track: ScriptTrack;
  /** Why (shown in refusals). */
  why: string;
  /** The curated topic the prompt resolved to (vague pick or named match). */
  topic?: CuratedTopic;
}

/** The job's track from the owner prompt: a vague prompt (curated pick), a prompt naming a curated topic, or a
 *  "how does / why does X work" question → how-it-works. Anything else: null (the script's own track decides). */
export function jobTrackOf(prompt: string, curated: CuratedTopic | null): JobTrack | null {
  if (curated) return { track: "how-it-works", why: `the prompt is the curated ${HOW_IT_WORKS_SERIES} topic "${curated.slug}"`, topic: curated };
  if (isHowQuestion(prompt)) return { track: "how-it-works", why: "the owner prompt asks how something works" };
  return null;
}

/** The script with its track filled in when absent: a story or a how-it-works job → "how-it-works", else as-is
 *  (absent = root-cause). An explicit track is never changed (trackGaps refuses a mismatch). */
export function withTrack<T extends Pick<ScriptV2, "track" | "story">>(s: T, jobTrack?: ScriptTrack): T {
  if (s.track) return s;
  if (s.story || jobTrack === "how-it-works") return { ...s, track: "how-it-works" };
  return s;
}

/** Script-level track problems (submit_script refuses on them, as format problems). `jobTrack` = the track the
 *  owner prompt decided (state.track); an explicit script.track that contradicts it is refused. */
export function trackGaps(
  s: Pick<ScriptV2, "track" | "series" | "mode" | "headerMode" | "story"> & Partial<Pick<ScriptV2, "phrases">>,
  env: NodeJS.ProcessEnv = process.env,
  jobTrack?: JobTrack | null,
): string[] {
  const labels = seriesLabels(env);
  const want = labels[trackOf(s)];
  const gaps: string[] = [];
  if (jobTrack && s.track && s.track !== jobTrack.track)
    gaps.push(`track "${s.track}" does not match this job: it is a "${jobTrack.track}" reel (${jobTrack.why}) — set track "${jobTrack.track}" (series "${labels[jobTrack.track]}", CTA "${TRACK_CTA[jobTrack.track]}")`);
  if (s.series && s.series !== want) gaps.push(`series "${s.series}" is not the ${trackOf(s)} track's label "${want}" — omit series (it follows the track) or set it to "${want}"`);
  const cta = s.phrases?.filter((p) => p.part === "cta").map((p) => p.text).join(" ") ?? "";
  if (cta) {
    const other: ScriptTrack = trackOf(s) === "how-it-works" ? "root-cause" : "how-it-works";
    const otherRe = other === "root-cause" ? /\broot[ -]?causes?\b/i : /\bhow (?:things|stuff|everyday \w+) works?\b/i;
    if (otherRe.test(cta)) gaps.push(`the CTA ${JSON.stringify(cta)} is the ${other} series' CTA — this is a ${trackOf(s)} reel: end with "${TRACK_CTA[trackOf(s)]}"`);
  }
  if (isHowItWorks(s)) {
    if (s.mode !== "concept") gaps.push(`track "how-it-works" is mode "concept" (got "${s.mode}") — a fundamentals reel explains how a thing works, not a dated event`);
    if (s.headerMode !== "SPEC") gaps.push(`track "how-it-works" uses headerMode "SPEC" (got "${s.headerMode}"): "<SOURCE ID> · STEP n/m"`);
    if (!s.story) gaps.push(`track "how-it-works" needs story {question, answer, answerFact, outline, terms} — commit the ONE question and ONE answer before writing the phrases`);
  }
  return gaps;
}

// ── vague prompts → a curated topic ────────────────────────────────────────────────────────────────────────────

const VAGUE_RE =
  /^(?:(?:please|pls|just|ok|okay|hey|yo)\s+)*(?:(?:make|do|give me|create|pick|choose|surprise me with|show me)\s+)?(?:(?:a|an|another|one|some|any|the next|next|new)\s+)?(?:(?:random|cool|interesting|fun|good|nice|fundamental|surprising|new|great|awesome|fascinating)\s+)*(?:(?:topic|reel|video|one|thing|idea|explainer|something|anything|how it works|fundamental)\s*)*(?:(?:you|u)\s+(?:like|want|pick|choose|decide))?[.!?]*$/i;
const FILLER = new Set("a an the some any something anything one another random cool interesting fun good nice new great awesome fascinating surprising fundamental fundamentals topic topics reel reels video videos idea ideas thing things explainer please pls just ok okay hey yo make do give me create pick choose show surprise with you u like want decide next how it works whatever idk dunno about on for of".split(" "));

/** True when the owner prompt names no topic ("", "surprise me", "something interesting", "you decide"). */
export function isVagueTopic(prompt: string): boolean {
  const p = String(prompt ?? "").replace(/[\s ]+/g, " ").trim();
  if (!p) return true;
  if (/\bsurprise me\b|\byou (?:decide|choose|pick)\b|\bwhatever\b|\bidk\b|\bdunno\b/i.test(p) && p.split(" ").length <= 8) return true;
  if (VAGUE_RE.test(p)) return true;
  const words = p.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  return words.length > 0 && words.length <= 8 && words.every((w) => FILLER.has(w));
}

/**
 * The curated topic for a vague prompt: pilots first, then by score, skipping topics already made (`used` = slugs or
 * titles of earlier jobs), rotating by `seed` among the best remaining ones so two vague prompts in a row differ.
 */
export function pickCuratedTopic(used: Iterable<string> = [], seed = 0, list: readonly CuratedTopic[] = CURATED_TOPICS): CuratedTopic {
  const seen = new Set([...used].map((u) => u.toLowerCase()));
  const fresh = list.filter((t) => !seen.has(t.slug) && !seen.has(t.title.toLowerCase()));
  const pool = (fresh.length ? fresh : list).slice().sort((a, b) => Number(b.pilot) - Number(a.pilot) || b.score - a.score);
  const top = pool.filter((t) => t.pilot === pool[0].pilot && t.score >= pool[0].score - 1);
  return top[Math.abs(Math.trunc(seed)) % top.length];
}

/** The draft-prompt block for a curated topic (leads for the director; nothing in it is pre-verified). */
export function curatedTopicBlock(t: CuratedTopic, env: NodeJS.ProcessEnv = process.env, o: { named?: boolean } = {}): string {
  const label = seriesLabels(env)["how-it-works"];
  const intro = o.named
    ? `The owner's prompt names the curated ${label} topic "${t.title}", so this reel is that topic (track "how-it-works"): use the leads below as for any curated topic; the owner prompt may narrow the angle, never switch the topic.`
    : `The owner gave no specific topic, so this reel is the curated ${label} topic "${t.title}" (track "how-it-works").`;
  return `${intro}
- track "how-it-works", series "${label}", headerMode SPEC with act labels ("STEP 1/4 · THE GLASS" … one per act, never a source or brand name), CTA "${TRACK_CTA["how-it-works"]}" (a CTA line in the scout outline is a lead only); at most ${HOW_IT_WORKS_MAX_SOURCES} cited PRIMARY sources — start with the two below
CURATED TOPIC (leads from a topic scout: verify everything yourself — web_fetch the sources before citing them; a beat marked [needs source] is sourced or cut; the title is a working title — your script.title may differ and is judged for physics like every line)
- one question: ${t.question}
- one answer: ${t.answer}
- primary sources to read first: ${t.sources.join(" , ")}
- scout outline:
${t.outline.map((b) => `  · ${b}`).join("\n")}${t.note ? `\n- note: ${t.note}` : ""}`;
}

/** The other curated topics, one line each (the director may suggest them in its final text, never switch to them). */
export function curatedTopicMenu(list: readonly CuratedTopic[] = CURATED_TOPICS): string {
  return list.map((t) => `- ${t.title}: ${t.question}`).join("\n");
}

// ── which curated topics were already picked (data/curated-topics.json) ─────────────────────────────────────────

export const CURATED_LEDGER_FILE = "curated-topics.json";

/** Slugs of curated topics already picked for a job (oldest first); missing / unreadable file = none. */
export async function loadUsedTopics(dataDir: string): Promise<string[]> {
  try {
    const o = JSON.parse(await readFile(path.join(dataDir, CURATED_LEDGER_FILE), "utf8")) as { picks?: Array<{ slug?: unknown }> };
    return (Array.isArray(o.picks) ? o.picks : []).map((p) => String(p?.slug ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** Book a pick (best effort: a failed write only means the topic may be picked again). */
export async function recordUsedTopic(dataDir: string, slug: string, jobId: string): Promise<void> {
  const file = path.join(dataDir, CURATED_LEDGER_FILE);
  let picks: Array<{ slug: string; jobId: string; at: string }> = [];
  try {
    const o = JSON.parse(await readFile(file, "utf8")) as { picks?: typeof picks };
    if (Array.isArray(o.picks)) picks = o.picks;
  } catch {
    /* first pick */
  }
  picks.push({ slug, jobId, at: new Date().toISOString() });
  await mkdir(dataDir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify({ picks: picks.slice(-200) }, null, 2) + "\n");
  await rename(tmp, file);
}
