// Director-facing digest of the owner's style bible (the original style guide, read-only,
// never edited) as amended by research/STYLE_BIBLE_V2_AMENDMENTS.md and research/D1-DECISIONS.md. Where they
// conflict, the amendments and D1 win. Condensed for the system prompt: rules the director can act on, by section id.
//
// Rules for this file (tested by test/v2-director-prompt.test.ts):
//  - colours are named by TOKEN only (no hex, no rgb()): the storyboard cannot represent hex anyway (L2);
//  - no component catalogue here: it is generated from src/v2/registry.gen.ts (catalogue.ts), so planned components
//    can never leak into the prompt; only shipped names (KineticWord, Stamp, Figure) are referenced by rule;
//  - header labels never use the date the reel goes out (R7 §5); examples are real sourced dates or SPEC/CLOCK labels.

import { CTA_MAX_WORDS, DURATION_SEC, MAX_GLITCH, MAX_HARD_CUTS, WPS_BAND, MAX_FOCAL } from "../../v2/lints.js";
import { SERIES, TOKENS } from "../../schema/storyboard.v2.js";
import { RUBRIC_FLOORS, RUBRIC_MAX_TOTAL, RUBRIC_MIN_TOTAL } from "./rubric.js";
import { HOW_IT_WORKS_SERIES } from "./topics.js";

/** Target narration pace (amendments §1); the lint band is WPS_BAND. */
export const PACE_TARGET_WPS = { min: 2.7, max: 3.1 } as const;
/** R5 rubric gate (research/notes/R5-script-rubric.md §4.2), from the enforcing code (P1 src/director/v2/rubric.ts). */
export const RUBRIC_GATE = { minTotal: RUBRIC_MIN_TOTAL, maxTotal: RUBRIC_MAX_TOTAL, floors: RUBRIC_FLOORS as Readonly<Record<string, number>> } as const;
/** D1 #3 voice. */
export const VOICE_V2 = { name: "en-US-AndrewNeural", rate: "+8%", gapMs: 250 } as const;

export interface BibleSection {
  id: string;
  title: string;
  text: string;
}

/** R7 §3 topic families → datafield preset (schema `family` / `datafield.preset`). */
export const FAMILIES = [
  { id: "F1", family: "security", preset: "hex", topics: "exploits, breaches, supply chain, certificates, PKI, crypto", motif: "hex-dump rows; rows go danger when the attacker writes or controls memory, one row accent when found" },
  { id: "F2", family: "outage", preset: "logs", topics: "postmortems, incident response, reliability, bad deploys, retry storms", motif: "live log tail; error rows marked danger during the failure, one accent row on recovery" },
  { id: "F3", family: "network", preset: "nodes", topics: "protocols, routing, DNS, BGP, NAT, packet paths (a TLS/certificate topic keeps preset hex)", motif: "node lattice with doc-range prefixes; marked paths accent (legit) or danger (hijacked)" },
  { id: "F4", family: "systems", preset: "process", topics: "OS, runtimes, containers, databases, performance, CI/CD, Terraform", motif: "top-style process table; the victim row marked danger" },
  { id: "F5", family: "science", preset: "lattice", topics: "physics, sensors, chips, space, biology-as-mechanism", motif: "measurement crosshairs + baseline trace; measured region accent, noise source danger" },
  { id: "F6", family: "data", preset: "matrix", topics: "algorithms, ML, data structures; preset book for markets/order books", motif: "streaming numeric matrix (or order-book ladder, both sides greyscale); updated cells accent, NaN/overflow danger" },
] as const;

export const HEADER_MODES = [
  {
    mode: "EVENT",
    when: "a real, dated event (mode event)",
    format: "MMM DD YYYY · PHASE",
    examples: ["OCT 20 2026 · POWER LOST", "OCT 20 2026 · FAILOVER", "OCT 20 2026 · RESTORED", "AUG 28 2026 · HIJACK"],
    rule: "real dates from your sources only, monotonic, change only at section boundaries (reveal/context), at most 4 changes",
  },
  {
    mode: "SPEC",
    when: "an evergreen concept with a canonical origin (RFC, paper, kernel feature, standard)",
    format: "<SOURCE ID> · <YEAR|VERSION|STEP n/m>; how-it-works: STEP n/m · <ACT>",
    examples: ["RFC 8446 · 2018", "RFC 8446 · STEP 2/4", "LINUX · OOM KILLER", "K8S · CGROUP V2", "STEP 2/4 · THE GRID"],
    rule: "the source id must be one of your cited sources; the step advances on mechanism steps; every number, version or acronym in the label (\"8446\", \"V2\", \"K8S\") must be in a quote of headerSourceIds or the narration, or the board is refused",
  },
  {
    mode: "CLOCK",
    when: "a concept that is a process in time with no single origin (request lifetime, heartbeat, page fault, trade)",
    format: "T+<n> <unit> · <STAGE>",
    examples: ["T+0 MS · CLIENTHELLO", "T+48 MS · FINISHED", "T+0 S · RUNNING", "T+212 S · OOMKILLED"],
    rule: "clock values are sourced, or the beat that shows them is marked illustrative",
  },
] as const;

/** The 8-part structure (amendments §9) with times for a ~70 s reel. Part tags = storyboard/script `part`. */
export const STRUCTURE = [
  { n: 1, part: "hook", time: "0–4 s", rule: "1–2 phrases that ASK the reel's one question (story.question) in plain words, first sentence ≤12 words ideal (≤24): a concrete object or event plus real tension. Concept mode: \"you/your\" in the first two sentences. No banned openers (\"Did you know\", \"Have you ever wondered\", \"In this video\", \"Today we\")." },
  { n: 2, part: "stakes", time: "4–12 s", rule: "one sourced hero number, translated into something the viewer can picture (\"that's about…\", \"the size of…\"); at most 2 numbers." },
  { n: 3, part: "reveal", time: "by 20 s", rule: "the one-line answer seed (\"it isn't X, it's Y\"); the how stays open." },
  { n: 4, part: "twist", time: "12–30 s", rule: "a real second question ending in \"?\" (\"But why…?\") that re-hooks harder than the hook." },
  { n: 5, part: "mechanism", time: "to ~50 s", rule: "8–16 phrases; each phrase changes exactly ONE thing in the diagram; a causal chain built around one contrast image; no lists of definitions." },
  { n: 6, part: "context", time: "to ~62 s", rule: "event: who found it, a quote, the response. Concept: the edge case or the obvious follow-up (≤2 beats)." },
  { n: 7, part: "climax", time: "to ~72 s", rule: "a ≤6-word punch line first (R10 scores the FIRST climax phrase), then the ANSWER stated plainly ONCE (story.answer in its own words, one phrase; it must match what the source says the answer is); the only KineticWord moment." },
  { n: 8, part: "closure + cta", time: "last 3–8 s", rule: `closure answers or flips the hook (events: the implication); then the series CTA of ≤${CTA_MAX_WORDS} words as the very LAST phrase ("Follow for more root causes." / how-it-works: "Follow to see how things work."). No mid-roll follow ask (part "ask" is banned), never end on a bare question.` },
] as const;

const lines = (xs: readonly string[]) => xs.map((x) => `- ${x}`).join("\n");

export const BIBLE_SECTIONS: readonly BibleSection[] = [
  {
    id: "§0",
    title: "Premium look",
    text: lines([
      "A premium tech-explainer in motion graphics: dark UI, monospace data, precise diagrams, ONE continuous world and camera. Think a launch film or a data-journalism explainer, never a cartoon.",
      "Banned: mascots or characters (D1 #9), clip art, emoji, stock or AI video, decorative gradients, decorative particles (snow, sparkles, confetti), bouncy or wobbly easing, rainbow colours, giant centred captions.",
      "Every element shows a fact from the script; if it does not explain something, delete it. Restraint: 1–3 focal elements at any moment.",
      "Holds get life from micro-motion (camera drift, field re-roll, pulses) plus a SECOND layer (a callout, a field mark, a meter tick, a value scramble): never 3.0 s (90 f) without a visible change in the world.",
    ]),
  },
  {
    id: "§1",
    title: "Format",
    text: lines([
      `1080×1920, 30 fps. Length ${DURATION_SEC.min}–${DURATION_SEC.max} s, hard (≤2400 frames), and the LAST phrase is the CTA (≤${CTA_MAX_WORDS} words).`,
      `Pace ${PACE_TARGET_WPS.min}–${PACE_TARGET_WPS.max} words/s target (lint band ${WPS_BAND.min}–${WPS_BAND.max}); duration comes from the real TTS, not guesses.`,
      "Zones (screen px): header band 0–218 (screen-fixed); focal area y 218–1400; caption band ≈1406–1520 (subtitle card only); hairline 1560; footer 1560–1920 holds nothing important.",
      "Side margins 64 px: every focal footprint after the camera transform sits inside x 64–1016, y 218–1400; no text right of x 960 (platform buttons).",
    ]),
  },
  {
    id: "§2",
    title: "Colour and type",
    text: lines([
      `Colours are TOKEN NAMES only (${TOKENS.join(", ")}) or a Tone (accent, danger, neutral, dim). Never write a hex code or a CSS colour function: the schema rejects them (L2).`,
      "Meaning is strict: accent (lime) = highlight / success / \"the important thing\"; danger (red) = failure / attacker / errors / down; everything else greyscale. A hero number may be danger only when the number IS the failure (e.g. exit code 137).",
      "Every on-screen string uses printable ASCII, Latin-1 (· µ) and → ● — … ≥ only; anything else (✗, box drawing, emoji) is rejected (L19).",
      "Fonts are fixed by the library (Inter for headings/subtitles, JetBrains Mono for labels/data/header/pills); you never choose sizes below the library minimum.",
    ]),
  },
  {
    id: "§3",
    title: "Persistent world",
    text: lines([
      "Data field (always on): one faint monospace texture chosen by family (datafield.preset, see FAMILIES), deterministic from datafield.seed, in world space so camera moves reveal different parts.",
      "The preset follows what the topic's data LOOKS like (see DATA FIELD MATCHES THE TOPIC); the family only gives the default.",
      "Story reactivity: the `mark` action on target \"datafield\" tints rows danger or accent for its beat (props: tone accent|danger, rows 1–8, hold true to keep it); state \"clear\" clears. Use it when the narration talks about the thing the field represents.",
      `Header (screen-fixed): dot + "<series> · " + codename (accent) on the left (series "${SERIES}" or "${HOW_IT_WORKS_SERIES}", by track); the right label in one of the modes EVENT / SPEC / CLOCK (below), ≤24 chars, changed via beat.header.right (scrambles 6–8 f).`,
      `The series string comes from the track (config, never invented): "${SERIES}" for track root-cause, "${HOW_IT_WORKS_SERIES}" for track how-it-works — storyboard.series must equal it. Codename: 4–12 chars [A-Z0-9-], names the mechanism or event (OOMKILL, HANDSHAKE, SCHEMA-RACE), never the company or brand alone (RAIL404 says who, not what broke) and never a fake official CVE nickname; if the event has a public nickname, use it.`,
      "Header dot: dim by default; danger while the story is in a failure state; accent for ≤1 s on the resolution beat (beat.header.dot), and only when something is actually resolved (a fix, a recovery). A concept closure that names the cause of a failure (\"The whole footprint was not.\") resolves nothing: keep the dot danger or dim.",
      "The right label NEVER shows the day the reel goes out or today's date; episode numbers do not go in the header.",
    ]),
  },
  {
    id: "§4",
    title: "Camera",
    text: lines([
      "One World + one Camera: instances sit at fixed world coordinates (x/y = top-left, px); the camera puts its target at screen (540, 855). camera0 is the opening shot.",
      "Base zoom ≈0.88–1.0; push-in 1.0–2.2 when the narration focuses on one detail (chain zoom steps ×1.2–1.35); pull-out to reveal context; pan to move to the next station. Zoom range 0.6–2.2, optional tiltX 0–25.",
      "Eases: bible (12–20 f, short moves), longPan (≥22 f, REQUIRED for pans > 900 px), pushOut (push-ins). Never linear. Moves do not overlap. Peak screen speed ≤150 px/f (L9).",
      "Motion blur is automatic (velocity-adaptive tent shutter); you never configure it per move.",
      `Hard cuts ≤${MAX_HARD_CUTS} per reel (transition "hardCut"), only for a dramatic beat, placed at a phrase onset (at "phraseStart") or inside a TTS pause (L8).`,
      "Camera keys live on beats (≤2 per beat) and default to the keyword frame: the move starts when the word is said.",
    ]),
  },
  {
    id: "§5",
    title: "Subtitle card",
    text: lines([
      "Small card bottom-left above the hairline, one display phrase at a time, single line. Display phrases are 1–5 words (1 word only as a punch); beats longer than 5 words are split for display automatically, or by beat.display (each ≤5 words, joined = the phrase).",
      "Captions track the ACTIVE word (white, bold) with upcoming words dimmed (D1 #8), PLUS one semantic keyword per beat in keywordColor (accent or danger); a danger keyword stays red even while active.",
      "Exactly one keyword per beat, occurring exactly once in the phrase (copy it with its punctuation as it appears, e.g. \"137.\"), at most one per display phrase (L5, L5b).",
      "Subtitle text = the TTS tokens exactly: the phrase is what the voice says. Write numbers as digits the voice reads naturally (137, 512); avoid symbols the voice would spell out differently from the caption.",
      "The card never covers a focal element: keep focal content above y 1400. That includes the bottom node of a tall graph or chain: frame its centre, not its top.",
    ]),
  },
  {
    id: "§7",
    title: "Motion",
    text: lines([
      "Entrances: fast, critically damped spring (opacity, rise 24 px, scale 0.97→1); exits 8 f fade + blur, or let the camera move away. Stagger lists 3–4 f. Text that updates scrambles 6–8 f. Danger states pulse 0.7↔1 every 20 f, never faster.",
      "Every action and camera key lands within ±3 f of its keyword (actions default to at: \"keyword\"); each phrase has a visual change that lands on its keyword (L6).",
      `Glitch is optional: 0–${MAX_GLITCH} per reel (do "glitch"), on dramatic moments only; the Stamp's camera shake counts toward the same budget (L10).`,
      "Nothing moves without a reason. Flying elements stay on screen ≥8 f; objects parked off-station are hidden during pans.",
    ]),
  },
  {
    id: "§8",
    title: "Voice and sound",
    text: lines([
      `Voice: edge-tts ${VOICE_V2.name}, rate ${VOICE_V2.rate}, one file per beat with word boundaries, ${VOICE_V2.gapMs} ms gaps between beats (D1 #3). You never pick another voice.`,
      "Music is a synthesised bed (or none) chosen by the pipeline; no licensed tracks.",
      "SFX (tick, whoosh, thud, chatter, glitch, silenceHole), 1–3 per 10 s, on transitions and mechanism moments, not on every entrance; glitch SFX only with a visual glitch.",
    ]),
  },
  {
    id: "§9",
    title: "Script structure (8 parts, ~70 s)",
    text: [
      ...STRUCTURE.map((s) => `${s.n}. ${s.part} (${s.time}): ${s.rule}`),
      "Plain words, short sentences (2–14 words per phrase, no sentence > 20 words), no jargon without a visual (≤2 undefined acronyms beyond the topic terms). Write for the ear.",
      "Every number or date that is spoken or shown is on the fact sheet with a source (L16, rubric R9); example values are marked illustrative.",
      "Rubric (R5): see RUBRIC; a FRESH judge re-scores it.",
    ].join("\n"),
  },
  {
    id: "§10",
    title: "Storyboard is data",
    text: lines([
      "The storyboard is v2.1 DATA (stations, world instances, beats with camera keys and actions). You never write TSX, React, CSS or code: a fixed library renders it (D1 #7).",
      "Only registered components exist (see COMPONENTS). If the story needs something missing, use the closest component or a Figure, and add a componentRequest (≤3, with a fallback instance) — never invent a component name.",
      "Durations come from the TTS audio. Each beat starts when its first word is spoken; actions trigger on the keyword's timestamp by default (or phraseStart / phraseEnd / {word: n} / {ref, offsetF}).",
    ]),
  },
  {
    id: "§13",
    title: "Quality checklist (every item must pass)",
    text: lines([
      "Tokens only; lime and red carry meaning (red hero only when the number is the failure).",
      `≤${MAX_FOCAL} focal elements per keyword frame; nothing overlaps unintentionally.`,
      "Focal content inside y 218–1400 and x 64–1016; text x ≤960; the caption never covers a focal element.",
      "Every glyph on the allow-list; no blur except motion blur.",
      `≤${MAX_HARD_CUTS} hard cuts, placed in pauses/onsets; moves eased, ≤150 px/f.`,
      "Every beat has a visual change on its keyword (±3 f); no 3 s window without change.",
      "Captions = TTS tokens; active word tracked; one keyword per beat; ≤5 words per display phrase, single line.",
      "Header and data field present throughout; header label mode valid, dates sourced.",
      "Frame 0, the cover frame and every keyword still (keyword + 6 f) are settled: no scramble, count-up or state wave in progress. An all-or-nothing phrase (\"all\", \"every\") shows the whole set in its final state.",
      "Dated incidents are told in the past tense under an EVENT header. World labels use the sources' words; invented specifics only appear on illustrative instances, with generic labels.",
      "A Timeline's from/to mark the real window the phrase names (context ticks outside it); a NodeGraph fills ≥75 % of the focal width with labelled nodes; no two consecutive keyword stills look the same.",
      "Diagram states are claims: a node shown ok is healthy (a danger node returns to ok only on a stated recovery); an inner glyph abbreviates its own node; a quantity the hook showed against a limit is shown AT the limit when the narration says it gets there.",
      "The hook's first sentence is ≤12 words with real tension; the thesis names every cause the source names.",
      "Exaggerated or example visuals are marked illustrative; every number and date is sourced.",
      "SFX 1–3 per 10 s on visual events.",
      `${DURATION_SEC.min}–${DURATION_SEC.max} s, ends on the CTA.`,
    ]),
  },
];

function familiesText(): string {
  return FAMILIES.map((f) => `- ${f.id} ${f.family} (datafield.preset "${f.preset}"): ${f.topics}. Field: ${f.motif}.`).join("\n");
}

function headerModesText(): string {
  return HEADER_MODES.map((h) => `- ${h.mode} — ${h.when}. Format \`${h.format}\`, e.g. ${h.examples.map((e) => `"${e}"`).join(", ")}. Rule: ${h.rule}.`).join("\n");
}

/** The full digest as prompt text. */
export function bibleDigest(): string {
  const parts = BIBLE_SECTIONS.map((s) => `${s.id} ${s.title.toUpperCase()}\n${s.text}`);
  return [
    `SERIES: one label per track (headerMode and the field motif show the family): "${SERIES}" for incidents and failure mechanisms (track root-cause), "${HOW_IT_WORKS_SERIES}" for fundamentals — how an everyday thing actually works (track how-it-works).`,
    ...parts,
    `HEADER MODES (right label; headerMode + headerRight + beat.header.right)\n${headerModesText()}`,
    `TOPIC FAMILIES (storyboard.family → default datafield.preset)\n${familiesText()}`,
  ].join("\n\n");
}
