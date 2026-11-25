// v2 component catalogue for the director. GENERATED at runtime from src/v2/registry.gen.ts (COMPONENTS) plus the
// storyboard schema's enums (TOKENS, Tone, verbs, SFX, eases, anchors) — nothing about components is hand-written
// here, so when a supervised library release regenerates the registry the prompt and the list_components tool follow
// automatically. Planned entries (no shipped renderer) are skipped: the director must never plan around them.
//
//   componentCatalogueV2()   structured data
//   componentCatalogueText() compact text for the system prompt
//   componentCatalogueJson() JSON string for the list_components tool (P3)
//
// W3.1: IDEA_PATTERNS (idea type → which components show the MECHANISM) is the one hand-written part. Each pattern
// names the components it needs; a pattern is only emitted when every one of them is shipped in the registry passed
// in, so a pattern can never steer the director to a planned or removed component. craftChecks() is the code side
// of the same guidance (StatusCard stacking, unsettled keyword frames, field preset vs topic) for the dry harness
// and, if P3 wants it, submit_storyboard.

import { ACTION_VERBS, AtRef, EASES, CameraEase, SFX_TYPES, Tone, TOKENS } from "../../schema/storyboard.v2.js";
import { COMPONENTS, LIBRARY_VERSION, type ComponentMeta } from "../../v2/registry.gen.js";
import { NODE_GRAPH, nodeCentre } from "../../v2/components-meta/NodeGraph.js";

type Registry = Readonly<Record<string, ComponentMeta>>;

export interface CatalogueComponent {
  name: string;
  tier: string;
  summary: string;
  families: string[];
  focal: boolean;
  footprint: { w: number; h: number } | null;
  props: Record<string, string>;
  states: string[];
  verbs: string[];
  verbTiming: Record<string, number>;
  sfx: Record<string, string>;
  flight: { verbs: string[]; durF: number; peakPxPerF: number } | null;
}

export interface CatalogueLayer {
  target: "datafield" | "header";
  summary: string;
  verbs: string[];
  props: Record<string, string>;
}

export interface CatalogueV2 {
  libraryVersion: string;
  components: CatalogueComponent[];
  layers: CatalogueLayer[];
  tokens: string[];
  tones: string[];
  verbs: string[];
  sfx: string[];
  eases: { all: string[]; camera: string[] };
  anchors: string[];
  /** family → shipped components whose meta lists that family. */
  byFamily: Record<string, string[]>;
  /** idea type → components that show it (only patterns whose components are all shipped). */
  ideas: IdeaPattern[];
}

/** One idea type and the components that SHOW its mechanism (W3.1: the director stacked StatusCards instead). */
export interface IdeaPattern {
  id: string;
  /** The kind of story idea, in the director's words. */
  idea: string;
  /** Every component the pattern uses (all must be shipped for the pattern to be emitted). */
  components: string[];
  /** How to stage it, with the verbs/props that drive it. */
  how: string;
}

/** Soft cap on StatusCards per reel and per station (W3.1: 11 of 20 instances were StatusCards in evergreen-tls). */
export const STATUSCARD_MAX_PER_REEL = 4;
export const STATUSCARD_MAX_PER_STATION = 2;
/** W3.2 (evergreen-tls b16/b18): a node state is a claim about that node. */
export const NODE_STATE_RULE =
  "Node states are claims: \"ok\" asserts the node is healthy, so a node that went \"danger\" (the expired root) never goes back to \"ok\" unless the phrase states a recovery (renewed, replaced, fixed). \"degraded\" (dashed ghost) = not there yet / pending / missing; \"danger\" = present and failing: the service that runs the failing query is danger (or accent while it acts), the columns it cannot find are degraded. To de-emphasise a path, set its edges \"idle\" and KEEP its nodes' last true state in every later nodeStates map (there is no per-node dim; state \"dim\" dims the whole graph). A node left out of a map falls back to its base state from nodes[] (usually \"ok\"), so a danger node you leave out turns healthy again: repeat it in every map.";
/** W3.2 (evergreen-tls client inner "PEER", evergreen-oom "USED"/"DATA"/"CODE"): the inner glyph names the node itself. */
export const NODE_INNER_RULE =
  "inner = an abbreviation of the node's OWN role (CLI, SRV, CA; HEAP, CACH, INOD, OFFH) or empty (an inner dot): never a second concept or another node's role (\"PEER\" on the client when the peer is the server; \"USED\" on page cache; \"CODE\" on off-heap, which is more than code).";
/** W3.2 (evergreen-oom b01 vs b16-b17): the hook's quantity comes back where the mechanism says it hits the limit. */
export const METER_RETURN_RULE =
  "Bring the hook's Meter BACK at the beat whose phrase says the total reaches the limit (camera back to it, or re-enter it next to the cgroup/ContainerBox): countUp value to its limit and state \"full\" on the keyword, so the picture shows the bar AT the limit tick. A Meter has one bar (no segments): show the parts as separate labelled Meters whose values add up (heap 2GB + off-heap 2GB under a 4GB total), or ContainerBox cells (accent = heap, danger = off-heap) filling all 20. A callout label alone (\"usage reaches memory.max\") is not the mechanism.";

// ── W3.3: draw the mechanism (W3.2 r3: evergreen-oom's 20 grey cells, event-recent's static NodeGraph) ─────────────

/** ContainerBox cell kinds used as categories (registry: empty|filled|freed|danger|accent). */
export const CELL_CATEGORY_KINDS = ["filled", "accent", "danger"] as const;
/** W3.3 (evergreen-oom r3 b07–b12): what memory.current counts was never drawn — every cell the same grey. */
export const CELL_CODING_RULE =
  "Colour-code what is COUNTED. A ContainerBox's 20 cells are categories, not decoration: pass props.cells (20 entries) on `state` or `mark` so each category has its own kind — \"filled\" (grey) = the part the viewer already knows (heap), \"accent\" = the part the story reveals (page cache), \"danger\" = the part that cannot be given back (tmpfs, kernel memory, thread stacks), \"freed\" (dashed) = reclaimed, \"empty\" = headroom. Give the same `state`/`mark` a value = non-empty, non-freed cells ÷ 20 (or omit it: with cells the bar is drawn FROM the cells, segmented in their colours), so the bar and the cells tell one number and a reclaim visibly LOWERS the bar. Tie every category to its cells with a legend in the same tone: a Callout (tone accent/danger) whose dot sits on those cells, or a SourceTag pill with the same tone touching the box edge — never a grey list floating beside the box. A UnitGrid shows one category per grid (tone = its colour, caption = its name); two categories = two grids, both framed inside the focal area.";
/** W3.3 (event-recent r3 b06–b16 graph-only beats, b08 ≡ b10; evergreen-oom b07–b11). */
export const STATIC_STRETCH_MAX = 2;
export const STATIC_STRETCH_RULE =
  `Every beat changes something VISIBLE on its keyword, and no more than ${STATIC_STRETCH_MAX} beats in a row may show the same picture with only a colour flip: by the third beat bring a camera move (push in on the node or cells the phrase names, pull out to the whole), a new element (a Callout on the node, a legend pill, a packet \`mark\` along the path), or a change of path. Two beats whose node/edge maps are identical are one picture: merge the phrases or change the map.`;
/** W3.3 (event-recent r3 b09/b10/b20: serial and parallel looked the same). */
export const ORDERING_RULE =
  "Order is drawn, not said: sequential = one edge active at a time, each later beat activating the next edge (or a packet `mark` along \"a>b>c\"); parallel = both edges \"active\" in the SAME map on one beat; a fix that restores order shows the serial path again (first edge active, the second idle until the first is done). Paths that change from beat to beat are the mechanism; a graph whose maps stop changing is a still photo.";
/** W3.3 (evergreen-oom r3 b16 and event-recent r3 b22: the KineticWord repeated the subtitle word for word). */
export const KINETIC_RULE =
  "The climax KineticWord never repeats the subtitle verbatim and is never a cut-off line: a complete 2–4-word noun phrase or clause in the climax phrase's own words (\"every page.\" for \"The kernel counts every page.\"; never \"Sound erases\" for \"Sound erases sound.\"), on screen ≤3 beats and gone before the CTA; accentWord = the beat's keyword exactly, tone = the beat's keywordColor.";
/** W3.3 (event-recent r3 L3: the graph reached x 991–999 at zoom 1.05). NodeGraph right edge on screen ≤ 960. */
export const TEXT_MAX_X = 960;
export const NODEGRAPH_FRAME_RULE =
  `Keep the whole NodeGraph left of x ${TEXT_MAX_X} on screen (the platform buttons sit to the right): with the camera on the graph's centre its right edge is 540 + w × zoom ÷ 2, so w × zoom ≤ ${2 * (TEXT_MAX_X - 540)} (w 840 at zoom 1, w 880 at zoom 0.95). Put the rightmost node at x ≤ 0.88 so its label plate stays inside. A push-in may go past that canvas width only while every drawn node and label stays inside x 64–${TEXT_MAX_X}.`;
/** W3.3: the TLS chain topology (W3.1/W3.2 evergreen-tls kept drawing a single chain, or a present-tense 2021 story). */
export const TLS_TOPOLOGY_RULE =
  "Certificate chains are a GRAPH with two paths, not one line: leaf (your cert, inner CRT) → intermediate (inner INT) → EITHER the self-signed root that clients trust today (accent) OR the cross-signed copy of that root (inner XS) → the older root that signed it (danger once expired). Both paths exist from the graph's enter; the beat that says which path the client builds activates that path's edges, the expired root goes danger on the expiry beat and STAYS danger. Dates on the expiry are past events: \"expired on September 30, 2021\", \"the cross-sign expired in 2024\" (never \"will/would expire\" for a date that has passed), and one line says what is true NOW (from a current source: which chain is served or trusted today). Names and dates only from your fetched pages.";

// ── W5: composition, legends, drawn state changes, numbers (W3.3 r2 sheets vs ref3: half-width TLS graph, a DNS graph
//    at 13 % of the focal height, unlabelled heap cells, a reclaim that works and then a fresh all-danger box, a full
//    'pod cgroup' Meter reading '400 MB') ─────────────────────────────────────────────────────────────────────────

/** W5: ref3 keeps one large, centred subject; the W3.3 r2 graphs filled about half the width, off-centre. */
export const COMPOSITION_RULE =
  "ONE LARGE CENTRED SUBJECT: through the mechanism the frame holds one big subject in the middle of the focal area (centre near screen x 540, y 760–860) spanning most of x 64–1016, with at most two small satellites touching it (a legend chip, a Callout) — never a small diagram off-centre in an empty field, never a stack of pills standing in for the picture. Spread a graph across the stage (node x from about 0.06 to 0.88, use the height too) so the subject itself is wide, then move the camera to the region the phrase names: on at least half of the mechanism beats push in (target that node, the edge's midpoint or those cells, zoom ≈1.4× the establishing shot; see the NodeGraph frame rule) and back out to the whole at the next section. A Terminal or log is evidence, not a second subject: swap it in for the graph (pan to it and back) or show it for one beat under the graph, with only the lines it will show (lines[] sets its height); never more than one beat in a row whose only change is a terminal line.";
/** W5 (oom r2: grey heap cells with no chip, lime cache cells under a white pill, every unreclaimable pill one red). */
export const LEGEND_RULE =
  "A LEGEND IS THE COLOUR OF WHAT IT NAMES: every colour category on the subject (cells, nodes, bars) has exactly one chip in the SAME tone, touching those cells — neutral for the grey \"filled\" part the viewer already knows (HEAP), accent for the accent cells, danger for the danger cells — in the sources' words. A chip whose tone differs from its cells, a drawn category with no chip, or two categories under one chip is a defect. When a line calls the accent part reclaimable or harmless, that beat turns its cells \"freed\" (the reclaim drawn), it never stays lit as \"the thing\". A NodeGraph that shows more than two non-ok states (danger, degraded, accent nodes; active, broken edges) carries one compact legend row in those tones (\"red = cut off · dashed = unreachable · lime = still works\"), and every state on screen is a fact a line says by that beat: drop a state no line names.";
/** W5 (oom r2 b12–b20 reclaim succeeds then a fresh box2; tls b04 ≡ b10; dns b10 a broken edge for a cache hit). */
export const STATE_CHANGE_RULE =
  "DRAW THE CAUSAL STATE CHANGE, DO NOT CAPTION IT: a line that says something changes (reclaims, grows, prefers, skips, caches, expires, kills) changes the SAME subject in that direction on its keyword, and the picture keeps going until the outcome the narration names. Reclaim then kill = one box: freed cells stay dashed while the cells that cannot be reclaimed grow beat by beat until the bar reaches the limit, then full / killed — never a reclaim that visibly works followed by a fresh all-danger box. A preference or choice = the chosen path active and the other idle, a picture different from the earlier beat that only showed the path. A cached value = a chip ON the node that holds it (the record and its TTL) that stays stale while the source already has the new one. \"Does not ask\" = an idle edge, never \"broken\" (broken = tried and failed). A pill that says the change is not the change.";
/** W5 (oom r2 b19: Meter 'pod cgroup' full at 1 Gi with valueLabel '400 MB', the heap claim shown as the total). */
export const NUMBER_AGREEMENT_RULE =
  "NUMBERS AGREE ON SCREEN: every value label, HeroStat, Meter readout and cell count shows the quantity the narration names on that beat, and it matches the drawn fill — a bar or box at its limit reads the limit (\"1 Gi\") or splits it (\"heap 400 MB + rest\"), never a smaller earlier figure. When a Meter or ContainerBox goes \"full\", set its value (and a Meter's valueLabel) in that same `state` action. One label names one quantity: the hook's figure is never relabelled as the total that crossed the limit, and a number keeps the unit it is spoken in.";

/** W5 fix 1 (vswitch-mac r1: the post-fix secondary network drawn as an idle WRK–DB edge from b04, so "couldn't reach
 *  the database" sat next to a working direct path; every vSwitch edge lime through "dropping connections"; the Oct 1
 *  incident drawn as fresh breaks on the Oct 20 graph; the cache beat kept CDN>WRK lit). */
export const PATH_TIMING_RULE =
  "A DRAWN PATH EXISTS NOW: an edge on screen claims the link exists then, and lime \"active\" claims it works. Before the fix the graph holds only the routes the narration says traffic uses; a route added by the fix (a second network, a failover link) is NOT in edges[] before its beat — on that beat swap in a second NodeGraph at the same x/y (same nodes plus the new hub or edges; the old one exits at phraseStart), linked to EVERY node the source says it reaches, then light it and send the packet over it; never relabel an old idle edge as the fix. Loss words (drops, delayed, unanswered, packet loss, cut off, lost) turn the edges they name \"broken\" (or their node degraded) on that keyword; a line that says requests are answered elsewhere (from a cache) idles the edge they skip and lights only the node that answers. A past incident told on today's graph is a dated pill, never fresh live breaks; two losses the source does not tie to one node never land on the same node.";
/** W5 fix 1 (vswitch-mac r1 b20: the only lime node at the climax was the CDN, not the switch; b22 = b21's frame). */
export const CLIMAX_FRAME_RULE =
  "THE CLIMAX FRAME IS THE CAUSE: on the climax push the camera in on the node or cells the climax names, and make it the only highlighted element (no accent anywhere else: a lit bystander pulls the eye). The CTA beat gets its own picture — pull out to the whole subject with the remedy lit, or a clean end plate — never the closure's frame held.";

/** The NodeGraph size hint in list_components (the prompt's NODEGRAPH SIZE gate states it in full). */
export const NODEGRAPH_SIZE_HINT = "Size it to fill the frame (w ≥ 800, w × zoom ≥ 75 % of the focal width) with a short role glyph inside every node.";

/** Rules printed in full elsewhere in the system prompt; the catalogue TEXT points at them instead of repeating them
 *  (W5 trim: CELL_CODING_RULE was printed three times). The JSON form (list_components) keeps the full `how`. */
const PROMPT_RULE_REFS: ReadonlyArray<readonly [string, string]> = [
  [NODEGRAPH_SIZE_HINT, "(size: see the NODEGRAPH SIZE gate)"],
  [NODE_STATE_RULE, "(node states: see the NODE STATES gate)"],
  [NODE_INNER_RULE, "(inner glyphs: see the NODEGRAPH SIZE gate)"],
  [NODEGRAPH_FRAME_RULE, "(right edge: see the NodeGraph frame rule)"],
  [ORDERING_RULE, "(order: see the ordering rule)"],
  [CELL_CODING_RULE, "(cell colours, value and legend: see the colour-coding rule)"],
  [METER_RETURN_RULE, "(see the METER RETURN gate)"],
  [TLS_TOPOLOGY_RULE, "(see TOPIC SHAPES)"],
];
/** An idea's `how` for the prompt text: shared rules become a pointer. */
export function compactHow(how: string): string {
  let t = how;
  for (const [rule, ref] of PROMPT_RULE_REFS) t = t.split(rule).join(ref);
  return t;
}

/** Components that can carry a whole mechanism on screen across several beats. */
export const MECHANISM_COMPONENTS = ["NodeGraph", "Figure", "Timeline", "MetricChart", "ContainerBox", "Terminal", "UnitGrid", "SignalTrace", "LayerStack", "SensorGrid"] as const;

export const IDEA_PATTERNS: readonly IdeaPattern[] = [
  {
    id: "alternative-path",
    idea: "two candidate paths / a choice between branches (chain building, routing, failover, fallback)",
    components: ["NodeGraph"],
    how: "ONE NodeGraph holds BOTH branches from its enter (nodes + edges for each path). Each mechanism beat drives a `state` action (state \"live\") with props {nodeStates, edgeStates} on its keyword: the path being described goes \"active\", the alternative stays idle, the failing hop goes \"broken\" / its node \"danger\", the safe node \"accent\". The props replace the previous maps, so repeat earlier entries you want to keep. `mark` (props.packet \"a>b>c\") sends a packet down the chosen route. The graph stays on screen for the whole branch story; push the camera in on a node instead of adding cards. " +
      NODEGRAPH_SIZE_HINT +
      " " +
      NODE_STATE_RULE +
      " " +
      NODE_INNER_RULE +
      " " +
      NODEGRAPH_FRAME_RULE,
  },
  {
    id: "causal-chain",
    idea: "a cause → effect chain through components (request path, dependency, cascade)",
    components: ["NodeGraph", "Callout"],
    how: "NodeGraph with the hops in order; light edges active one per beat; the failing node danger on its keyword; a Callout pinned on the node names the detail instead of a new card. " + ORDERING_RULE,
  },
  {
    id: "time-window",
    idea: "something that happens over time (an incident window, backoff, expiry, a deadline)",
    components: ["Timeline"],
    how: "Timeline (scale clock for minutes/seconds, years for dates) with drawOn on the keyword; marks for the events; the real times from your sources, never the data field's texture clock. from/to are tick INDICES: the bar covers exactly the window the phrase names (ticks 07:29, 07:35, 07:40, 07:47 with a 07:35–07:40 outage → from 1, to 2), context ticks stay outside, the pill names that window.",
  },
  {
    id: "metric-breach",
    idea: "a measured value crossing a limit (latency spike, error rate, memory over a threshold)",
    components: ["MetricChart"],
    how: "MetricChart drawOn, threshold + thresholdLabel, window for the incident span, spike on the peak; state breach on the keyword.",
  },
  {
    id: "resource-limit",
    idea: "a process/container filling a resource until something enforces the limit",
    components: ["ContainerBox"],
    how: "ContainerBox through its states (cgroup → reclaim → full → killed → freed), one state per mechanism beat, with props.cells colour-coding each category and value = used cells ÷ 20. " + CELL_CODING_RULE,
  },
  {
    id: "quantity-to-limit",
    idea: "the hook shows a quantity against a limit (heap 2GB of a 4GB container) and the mechanism explains how the TOTAL reaches that limit",
    components: ["Meter"],
    how: METER_RETURN_RULE,
  },
  {
    id: "command-evidence",
    idea: "what an engineer would type or see (exit codes, a log line, a CLI result)",
    components: ["Terminal"],
    how: "Terminal with the real command/output lines; `mark` reveals the next line on the keyword; kind bad/ok colours the result. Evidence, not the mechanism: only the lines it will show, swapped in for the diagram (see ONE LARGE CENTRED SUBJECT).",
  },
  {
    id: "before-after",
    idea: "a version / config difference (old vs new client, before vs after a fix)",
    components: ["VersionPills", "StatusCard"],
    how: "VersionPills with the versions, `highlight` on the one that matters, plus at most ONE StatusCard pair (old → result, new → result) in the same station.",
  },
  {
    id: "contrast",
    idea: "two sides in one picture (attacker vs defender, valid vs expired, A vs B)",
    components: ["VersusBadges"],
    how: "VersusBadges; state left/right picks the winner on the keyword.",
  },
  {
    id: "custom-diagram",
    idea: "a structure nothing else draws (a certificate with its fields, a packet header, a memory layout)",
    components: ["Figure"],
    how: "Figure with ≤80 token-coloured nodes; drawOn on the keyword; keep it on screen and push the camera in on parts.",
  },
  {
    id: "share-of-whole",
    idea: "a share or count of a whole (N of 100, all regions, every customer)",
    components: ["UnitGrid"],
    how: "UnitGrid filled = the sourced share; for \"all\" the whole grid is filled and in its final tone on the keyword frame.",
  },
  {
    id: "counted-categories",
    idea: "what a total is MADE OF (what memory.current counts, which parts of a bill, which requests hit the limit)",
    components: ["ContainerBox", "Callout"],
    how: CELL_CODING_RULE,
  },
  {
    id: "signal",
    idea: "a physical signal over time (pulse, sound wave, noise vs anti-noise, a sampler catching or missing peaks)",
    components: ["SignalTrace"],
    how: 'SignalTrace, one per station. Spoken numbers DRIVE it: rate "72 bpm" + span "5 s" draws exactly 6 beats (never set cycles then). States raw → filtered → sampled (samples n: dots + what the sensor sees) → summed (combine "sum": noise + its invert twin → a small residual). E.g. {title:"LIGHT AT THE SENSOR", traces:[{id:"ppg", shape:"ppg", polarity:"returned", noise:0.3}], rate:"72 bpm", span:"5 s", peaks:true}; state filtered on "clean", mark sweep on "every beat", phaseMark "auto" on "180°", final at the CTA.',
  },
  {
    id: "cross-section",
    idea: "what happens INSIDE a layered thing (light into skin, a finger on glass, a battery, a sensor stack)",
    components: ["LayerStack"],
    how: 'LayerStack: 2–6 labelled layers top → bottom, probes on the edge (emitter / detector / contact), rays emitter → depth layer → detector (strength = light that comes back), flows between layers (label = the quantity). State props.active on the keyword lights the layer the phrase names; `pulse` (one beat) or prop swelled:true (held) swells the swell:true layer and dims the returned light. E.g. layers [{id:"skin", label:"SKIN"}, {id:"blood", label:"BLOOD VESSEL", kind:"liquid", swell:true}], probes [{id:"led", label:"GREEN LED", role:"emitter", at:0.3}, {id:"pd", label:"SENSOR", role:"detector", at:0.7}], rays [{from:"led", to:"pd", depth:"blood", strength:0.5}].',
  },
  {
    id: "sensor-grid",
    idea: "a grid of sensors that finds WHERE something is (touch screen, camera pixels, a keyboard matrix)",
    components: ["SensorGrid"],
    how: 'SensorGrid: states idle → scan (rows light in turn) → touch (levels bump around props.touches, computed, never typed) → located (outline + centroid + readout "auto") → zoom (zoomAt {col,row}: ONE crossing close up, its own station). A finger LOWERS capacitance: measure "delta". E.g. {rowLabel:"drive", colLabel:"sense", touches:[{x:0.42, y:0.4}], measure:"delta", readout:"auto"}; state scan on "scans", touch on "finger", located on "here", zoom on "each crossing", final at the CTA. A spoken touch count must equal touches.length.',
  },
  {
    id: "cert-chain",
    idea: "a certificate chain / trust path with a cross-sign (TLS, PKI, code signing)",
    components: ["NodeGraph"],
    how: TLS_TOPOLOGY_RULE + " " + NODEGRAPH_FRAME_RULE,
  },
];

/** Patterns whose components are all shipped in `components`. */
export function ideaPatterns(components: Registry = COMPONENTS): IdeaPattern[] {
  const shipped = new Set(Object.values(components).filter((c) => !c.planned).map((c) => c.name));
  return IDEA_PATTERNS.filter((p) => p.components.every((c) => shipped.has(c))).map((p) => ({ ...p, components: [...p.components] }));
}

/** Action targets that are persistent layers, not instances. Verb lists mirror the L1 check in src/v2/lints.ts. */
export const LAYER_TARGETS: readonly CatalogueLayer[] = [
  {
    target: "datafield",
    summary: "The persistent background texture (preset from datafield.preset, deterministic from datafield.seed; logs: seed \"<slug>@HH:MM\" sets its clock, e.g. \"rail404@07:35\"). `mark` tints rows for the beat.",
    verbs: ["mark", "state", "glitch", "pulse"],
    props: { "tone?": "accent|danger (default: the beat's keywordColor)", "rows?": "integer 1–8 = 3", "hold?": "boolean (keep past the beat)", "clear?": "boolean (or state \"clear\")" },
  },
  {
    target: "header",
    summary: "The screen-fixed header bar. Change its right label / dot with beat.header {right, dot, at}; actions only animate it.",
    verbs: ["state", "scramble", "pulse", "glitch"],
    props: {},
  },
];


/** W5.1 (+ W7.3 fillH / canvasH height fill): props the library's stage-fill pass sets (timeline.ts fitWorld) — never shown to the director. */
const LIBRARY_SET_PROPS: ReadonlySet<string> = new Set(["layout?", "reveal?", "fillH?", "canvasH?"]);

export function componentCatalogueV2(components: Registry = COMPONENTS): CatalogueV2 {
  const shipped = Object.values(components).filter((c) => !c.planned);
  const list: CatalogueComponent[] = shipped.map((c) => ({
    name: c.name,
    tier: c.tier,
    summary: c.summary ?? "",
    families: [...c.families],
    focal: c.focal,
    footprint: c.footprint ? { w: c.footprint.w, h: c.footprint.h } : null,
    props: Object.fromEntries(Object.entries(c.props).filter(([k]) => !LIBRARY_SET_PROPS.has(k))),
    states: [...c.states],
    verbs: [...c.verbs],
    verbTiming: { ...c.verbTiming },
    sfx: { ...c.sfx },
    flight: c.flight ? { verbs: [...c.flight.verbs], durF: c.flight.durF, peakPxPerF: c.flight.peakPxPerF } : null,
  }));
  const byFamily: Record<string, string[]> = {};
  for (const c of list) for (const f of c.families) (byFamily[f] ??= []).push(c.name);
  return {
    libraryVersion: LIBRARY_VERSION,
    components: list,
    layers: LAYER_TARGETS.map((l) => ({ ...l, verbs: [...l.verbs], props: { ...l.props } })),
    tokens: [...TOKENS],
    tones: [...Tone.options],
    verbs: [...ACTION_VERBS],
    sfx: [...SFX_TYPES],
    eases: { all: [...EASES], camera: [...CameraEase.options] },
    anchors: [...AtRef.options, "{word: n}", "{ref, offsetF: -15..45}"],
    byFamily,
    ideas: ideaPatterns(components),
  };
}

const kv = (o: Record<string, string | number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");

/** Compact text form for the system prompt (one block per component). */
export function componentCatalogueText(components: Registry = COMPONENTS): string {
  const cat = componentCatalogueV2(components);
  const comp = cat.components.map((c) => {
    const parts = [
      `${c.name}${c.focal ? " [focal]" : ""}${c.footprint ? ` ~${c.footprint.w}×${c.footprint.h}px` : ""} — ${c.summary}`,
      `  props: ${kv(c.props) || "(none)"}`,
      `  states: ${c.states.join("|") || "(none)"} · verbs: enter, exit${c.verbs.length ? `, ${c.verbs.join(", ")}` : ""} · settle frames: ${kv(c.verbTiming)}`,
    ];
    if (Object.keys(c.sfx).length) parts.push(`  sfx: ${kv(c.sfx)}`);
    if (c.flight) parts.push(`  flight on ${c.flight.verbs.join("/")}: ${c.flight.durF} f, ≤${c.flight.peakPxPerF} px/f`);
    return parts.join("\n");
  });
  const layers = cat.layers.map((l) => `target "${l.target}" — ${l.summary} verbs: ${l.verbs.join(", ")}${Object.keys(l.props).length ? ` · props: ${kv(l.props)}` : ""}`);
  return [
    `Library ${cat.libraryVersion}: ${cat.components.length} components (instance.component must be one of these names exactly).`,
    ...comp,
    "LAYER TARGETS (action.target, not instances)",
    ...layers,
    `TOKENS: ${cat.tokens.join(", ")}`,
    `TONES: ${cat.tones.join(", ")}`,
    `VERBS (action.do): ${cat.verbs.join(", ")} — only the verbs a component lists (enter/exit always).`,
    `SFX: ${cat.sfx.join(", ")}`,
    `EASES: camera ${cat.eases.camera.join(", ")}; tracks ${cat.eases.all.join(", ")}`,
    `ANCHORS (at): ${cat.anchors.join(", ")}`,
    // W7.3: a family that holds most components prints its complement ("all but …"): same data, ~1 k chars less
    `BY FAMILY: ${Object.entries(cat.byFamily)
      .map(([f, xs]) => {
        const rest = cat.components.map((c) => c.name).filter((n) => !xs.includes(n));
        return `${f}: ${rest.length === 0 ? "all" : rest.length < xs.length ? `all but ${rest.join(", ")}` : xs.join(", ")}`;
      })
      .join(" | ")}`,
    `IDEA → COMPONENT (show the mechanism; StatusCard is a label, not a diagram: ≤${STATUSCARD_MAX_PER_REEL} per reel, ≤${STATUSCARD_MAX_PER_STATION} per station)`,
    ...cat.ideas.map((p) => `- ${p.idea} → ${p.components.join(" + ")}: ${compactHow(p.how)}`),
  ].join("\n");
}

/** JSON form for the list_components tool. */
export function componentCatalogueJson(components: Registry = COMPONENTS): string {
  return JSON.stringify(componentCatalogueV2(components));
}

// ── craft checks (W3.1) ──────────────────────────────────────────────────────────────────────────────────────────

export interface CraftFinding {
  id:
    | "statuscard-reel"
    | "statuscard-station"
    | "statuscard-mechanism"
    | "unsettled-keyword"
    | "field-preset"
    | "node-recovery"
    | "node-inner"
    | "weak-change"
    | "meter-return"
    | "static-stretch"
    | "uncoded-cells"
    | "cells-value"
    | "kinetic-duplicate"
    | "kinetic-accent"
    | "nodegraph-right"
    | "premature-edge"
    | "loss-edge"
    | "graph-legend"
    | "terminal-run"
    | "climax-focus"
    | "cta-repeat"
    | "push-in-share";
  severity: "warn";
  message: string;
  beatId?: string;
}

/** Minimal storyboard shape craftChecks reads (a parsed Storyboard or the director's input both fit). */
export interface CraftStoryboard {
  datafield?: { preset?: string };
  codename?: string;
  sources?: ReadonlyArray<{ title?: string }>;
  world: ReadonlyArray<{ id: string; component: string; station?: string; props?: unknown; x?: number; y?: number; w?: number }>;
  /** W3.3 (nodegraph-right): stations and the opening shot, for the camera estimate. */
  stations?: ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }>;
  camera0?: { target?: unknown; zoom?: number };
  beats: ReadonlyArray<{
    id: string;
    part?: string;
    phrase: string;
    keyword: string;
    actions?: ReadonlyArray<{ target: string; do: string; at?: unknown; state?: string; props?: unknown }>;
    camera?: ReadonlyArray<unknown>;
  }>;
}

/** Still frame offset after the keyword (amendments §13: review stills and the cover are judged at keyword + 6). */
export const STILL_OFFSET_F = 6;
/** Frames per spoken word for the static lead estimate (≈ 2.9 words/s at 30 fps). */
const FRAMES_PER_WORD = 10;
/** Verbs that rewrite a value or recolour a whole set: they must be finished on the keyword still. */
const VALUE_VERBS: Readonly<Record<string, readonly string[]>> = {
  HeroStat: ["enter", "countUp", "scramble"],
  VersionPills: ["enter", "state"],
  UnitGrid: ["countUp", "state"],
};
/** "all-or-nothing" words: the picture must show the whole set in its final state on the keyword frame. */
export const ALL_OR_NOTHING_RE = /\b(all|every|everything|everyone|each|both|none|no one|nothing|entire|whole)\b/i;
/** Topic words for certificates / crypto: the field should be "hex" (DER bytes), never the IP/ASN lattice. */
export const CRYPTO_TOPIC_RE = /\b(TLS|SSL|X\.?509|certificates?|certs?|PKI|root CA|intermediate CA|cross-sign(?:ed)?|ciphers?|crypto(?:graphy)?|signatures?|private key|public key|key exchange)\b/i;

const tokens = (s: string) => s.split(/\s+/).filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Word index of the keyword in the phrase (first token of the keyword), or -1. */
export function keywordWordIndex(phrase: string, keyword: string): number {
  const ws = tokens(phrase).map(norm);
  const k = tokens(keyword).map(norm);
  if (!k.length) return -1;
  for (let i = 0; i + k.length <= ws.length; i++) if (k.every((t, j) => ws[i + j] === t)) return i;
  return -1;
}

/** Estimated frames between the action's start and the keyword (positive = starts before it); null = unknown/after. */
export function leadBeforeKeywordF(at: unknown, kwIndex: number): number | null {
  if (at === undefined || at === "keyword") return 0;
  if (at === "phraseStart") return kwIndex >= 0 ? kwIndex * FRAMES_PER_WORD : null;
  if (at === "phraseEnd") return null;
  if (at && typeof at === "object") {
    const o = at as { word?: number; ref?: string; offsetF?: number };
    if (typeof o.word === "number") return kwIndex >= 0 ? (kwIndex - o.word) * FRAMES_PER_WORD : null;
    if (o.ref === "keyword" && typeof o.offsetF === "number") return -o.offsetF;
    if (o.ref === "phraseStart" && typeof o.offsetF === "number" && kwIndex >= 0) return kwIndex * FRAMES_PER_WORD - o.offsetF;
  }
  return null;
}

/**
 * Static craft checks for a storyboard (warnings, never blocking): StatusCard stacking, mechanism beats told only
 * with StatusCards, value/all-or-nothing animations still running on the keyword still, and a crypto topic on a
 * non-hex data field. Frame leads are estimated from word positions (no TTS needed); the lints stay authoritative.
 */
export function craftChecks(sb: CraftStoryboard, components: Registry = COMPONENTS): CraftFinding[] {
  const out: CraftFinding[] = [];
  const comp = new Map(sb.world.map((w) => [w.id, w.component]));
  const cards = sb.world.filter((w) => w.component === "StatusCard");
  if (cards.length > STATUSCARD_MAX_PER_REEL)
    out.push({ id: "statuscard-reel", severity: "warn", message: `${cards.length} StatusCards (≤${STATUSCARD_MAX_PER_REEL} per reel): show the mechanism with a NodeGraph/Figure/Timeline/MetricChart/ContainerBox and drive its states instead` });
  const perStation = new Map<string, number>();
  for (const c of cards) if (c.station) perStation.set(c.station, (perStation.get(c.station) ?? 0) + 1);
  for (const [st, n] of perStation)
    if (n > STATUSCARD_MAX_PER_STATION) out.push({ id: "statuscard-station", severity: "warn", message: `station "${st}" has ${n} StatusCards (≤${STATUSCARD_MAX_PER_STATION} per station)` });

  const mech = sb.beats.filter((b) => b.part === "mechanism");
  const cardOnly = mech.filter((b) => {
    const targets = (b.actions ?? []).map((a) => comp.get(a.target)).filter((c): c is string => !!c);
    return targets.length > 0 && targets.every((c) => c === "StatusCard");
  });
  if (cardOnly.length > 2)
    out.push({ id: "statuscard-mechanism", severity: "warn", message: `${cardOnly.length} of ${mech.length} mechanism beats only touch StatusCards (${cardOnly.map((b) => b.id).join(", ")}): keep one mechanism visual on screen and change IT on each keyword` });

  for (const b of sb.beats) {
    const kw = keywordWordIndex(b.phrase, b.keyword);
    const allOrNothing = ALL_OR_NOTHING_RE.test(b.keyword) || ALL_OR_NOTHING_RE.test(b.phrase);
    for (const a of b.actions ?? []) {
      const c = comp.get(a.target);
      if (!c) continue;
      const verbs = VALUE_VERBS[c] ?? (allOrNothing && c === "NodeGraph" ? ["state"] : []);
      if (!verbs.includes(a.do)) continue;
      const settle = (components[c] as ComponentMeta | undefined)?.verbTiming?.[a.do as keyof ComponentMeta["verbTiming"]];
      if (typeof settle !== "number") continue;
      const lead = leadBeforeKeywordF(a.at, kw);
      if (lead === null || lead + STILL_OFFSET_F >= settle) continue;
      const why = allOrNothing && (a.do === "state" || c === "UnitGrid") ? `"${b.keyword}" is all-or-nothing, but` : "the keyword still";
      out.push({
        id: "unsettled-keyword",
        severity: "warn",
        beatId: b.id,
        message: `${b.id}: ${why} ${a.target} (${c}) ${a.do} takes ${settle} f and starts ~${Math.max(0, lead)} f before the keyword, so keyword + ${STILL_OFFSET_F} catches it mid-animation: anchor it at phraseStart (or ≥ ${settle - STILL_OFFSET_F} f before the keyword) and keep a smaller change on the keyword`,
      });
    }
  }

  out.push(...nodeGraphChecks(sb), ...weakChangeChecks(sb), ...meterReturnChecks(sb));
  out.push(...staticStretchChecks(sb), ...cellCodingChecks(sb), ...kineticChecks(sb), ...nodeGraphFrameChecks(sb, components));

  const preset = sb.datafield?.preset;
  const topicText = [sb.codename ?? "", ...(sb.sources ?? []).map((s) => s.title ?? ""), ...sb.beats.map((b) => b.phrase)].join(" \n ");
  if (preset && preset !== "hex" && CRYPTO_TOPIC_RE.test(topicText))
    out.push({ id: "field-preset", severity: "warn", message: `certificate/crypto topic on datafield.preset "${preset}": use "hex" (certificate/DER bytes), not the ${preset === "nodes" ? "IP/ASN lattice" : preset} texture` });
  return out;
}

// ── W3.2 craft checks: node states as claims, inner glyphs, weak beats, the hook's meter ────────────────────────────

/** Words that let a node go from danger back to ok: the phrase states a recovery. */
export const RECOVERY_RE = /\b(fix(?:ed|es)?|restor\w*|recover\w*|renew\w*|replac\w*|rotat\w*|patch\w*|resolv\w*|reissu\w*|resum\w*|healthy|normal again|up again|came back|valid again|works? again|back (?:up|online)|no longer)\b/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
interface GraphNode {
  id: string;
  label?: string;
  inner?: string;
  state?: string;
}
const graphNodes = (props: unknown): GraphNode[] => (isObj(props) && Array.isArray(props.nodes) ? (props.nodes as unknown[]).filter(isObj).filter((n) => typeof n.id === "string") as unknown as GraphNode[] : []);
const baseEdgeState = (props: unknown): Record<string, string> =>
  Object.fromEntries(isObj(props) && Array.isArray(props.edges) ? (props.edges as unknown[]).filter(isObj).map((e) => [`${String(e.from)}>${String(e.to)}`, typeof e.state === "string" ? e.state : "idle"]) : []);

/** The renderer's replace semantics (remotion/v2/components/NodeGraph.tsx stateHistory): a `state` action carrying a
 *  nodeStates (edgeStates) object sets every node (edge) to its entry or else its base state; without it, no change. */
export function applyGraphMap(base: Readonly<Record<string, string>>, cur: Readonly<Record<string, string>>, raw: unknown): Record<string, string> {
  if (!isObj(raw)) return { ...cur };
  const next: Record<string, string> = {};
  for (const k of Object.keys(base)) next[k] = typeof raw[k] === "string" ? (raw[k] as string) : base[k];
  return next;
}

/** Is `glyph` an in-order subsequence of `text` (letters/digits only, case-insensitive)? CACH ⊂ "page cache". */
function subsequenceOf(glyph: string, text: string): boolean {
  const g = glyph.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  let i = 0;
  for (const ch of t) if (ch === g[i]) i++;
  return i === g.length;
}

/**
 * NodeGraph checks: (1) node-recovery — a node goes danger → ok on a beat whose phrase states no recovery (W3.1 r2
 * evergreen-tls b16: the expired DST root shown healthy again; b18: left out of the map, so back to its base "ok");
 * (2) node-inner — an inner glyph of ≥4 letters that is not an abbreviation of the node's own id/label (client
 * "PEER", page cache "USED", inodes "DATA", off-heap "CODE"). Warnings only.
 */
export function nodeGraphChecks(sb: CraftStoryboard): CraftFinding[] {
  const out: CraftFinding[] = [];
  for (const g of sb.world.filter((w) => w.component === "NodeGraph")) {
    const nodes = graphNodes(g.props);
    for (const n of nodes) {
      const inner = typeof n.inner === "string" ? n.inner.trim() : "";
      if (/^[A-Za-z]{4,}$/.test(inner) && !subsequenceOf(inner, `${n.id} ${n.label ?? ""}`))
        out.push({ id: "node-inner", severity: "warn", message: `${g.id}: node "${n.id}" (${n.label ?? n.id}) has inner "${inner}", which is not an abbreviation of its own role: use one (e.g. ${suggestGlyph(n)}) or leave inner empty, never a second concept` });
    }
    const base: Record<string, string> = Object.fromEntries(nodes.map((n) => [n.id, typeof n.state === "string" ? n.state : "ok"]));
    let cur = { ...base };
    for (const b of sb.beats) {
      for (const a of b.actions ?? []) {
        if (a.target !== g.id || a.do !== "state" || !isObj(a.props)) continue;
        const next = applyGraphMap(base, cur, a.props.nodeStates);
        for (const id of Object.keys(base)) {
          if (cur[id] === "danger" && next[id] === "ok" && !RECOVERY_RE.test(b.phrase)) {
            const omitted = !(isObj(a.props.nodeStates) && id in (a.props.nodeStates as Obj));
            out.push({
              id: "node-recovery",
              severity: "warn",
              beatId: b.id,
              message: `${b.id}: ${g.id} node "${id}" goes danger → ok${omitted ? " (left out of nodeStates, so it falls back to its base state)" : ""}, but "${b.phrase}" states no recovery: "ok" shows it healthy again. Keep it "danger" and idle its edges to de-emphasise it`,
            });
          }
        }
        cur = next;
      }
    }
  }
  return out;
}

function suggestGlyph(n: GraphNode): string {
  return `"${n.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase()}"`;
}

/** Verbs that only flash or remove something: on their own they leave the keyword still looking like the last one. */
const WEAK_VERBS: ReadonlySet<string> = new Set(["pulse", "focus", "glitch", "exit"]);

/**
 * weak-change — a beat after the first whose keyword still will look like the previous one: no camera key, and every
 * action is a flash (pulse / focus / glitch), an exit, a whole-instance "dim", a data-field or header tint, or a
 * NodeGraph state map that changes nothing (W3.1 r2 evergreen-oom b14/b15, b17/b18; evergreen-tls b13). Merge it
 * into its neighbour or give it a real change (a node/edge state, an enter, a drawOn, a push-in). CTA exempt.
 */
export function weakChangeChecks(sb: CraftStoryboard): CraftFinding[] {
  const out: CraftFinding[] = [];
  const comp = new Map(sb.world.map((w) => [w.id, w]));
  const graphs = new Map<string, { nb: Record<string, string>; eb: Record<string, string>; n: Record<string, string>; e: Record<string, string> }>();
  for (const w of sb.world)
    if (w.component === "NodeGraph") {
      const nb = Object.fromEntries(graphNodes(w.props).map((n) => [n.id, typeof n.state === "string" ? n.state : "ok"]));
      const eb = baseEdgeState(w.props);
      graphs.set(w.id, { nb, eb, n: { ...nb }, e: { ...eb } });
    }
  sb.beats.forEach((b, i) => {
    let strong = (b.camera ?? []).length > 0;
    const acts = b.actions ?? [];
    for (const a of acts) {
      const g = graphs.get(a.target);
      if (g && a.do === "state" && a.state !== "dim" && isObj(a.props)) {
        const n = applyGraphMap(g.nb, g.n, a.props.nodeStates);
        const e = applyGraphMap(g.eb, g.e, a.props.edgeStates);
        if (JSON.stringify(n) !== JSON.stringify(g.n) || JSON.stringify(e) !== JSON.stringify(g.e)) strong = true;
        g.n = n;
        g.e = e;
        continue;
      }
      if (a.target === "datafield" || a.target === "header" || !comp.has(a.target)) continue;
      if (WEAK_VERBS.has(a.do) || (a.do === "state" && a.state === "dim")) continue;
      strong = true;
    }
    if (i === 0 || b.part === "cta" || !acts.length || strong) return;
    out.push({
      id: "weak-change",
      severity: "warn",
      beatId: b.id,
      message: `${b.id}: its keyword still will look like ${sb.beats[i - 1].id}'s (only ${acts.map((a) => `${a.target} ${a.do}${a.state ? ` ${a.state}` : ""}`).join(", ")}, no camera): merge the phrase into its neighbour's picture or give it a real change (a node/edge state, an enter, a drawOn, a push-in)`,
    });
  });
  return out;
}

/** A phrase that says a quantity reaches / exceeds its limit. */
export const LIMIT_RE = /\b(reach(?:es|ed)?|hits?|exceed(?:s|ed)?|fills?|filled|full|over the limit|past the limit|memory\.max)\b/i;

/**
 * meter-return — the hook puts a Meter on screen (heap 2GB of 4GB) and a later mechanism/climax phrase says the total
 * reaches the limit, but that Meter (or any Meter) gets no action on or after that beat (W3.1 r2 evergreen-oom: the
 * mechanism never showed the total at the limit).
 */
export function meterReturnChecks(sb: CraftStoryboard): CraftFinding[] {
  const meters = new Set(sb.world.filter((w) => w.component === "Meter").map((w) => w.id));
  if (!meters.size) return [];
  const hookMeter = sb.beats.some((b) => b.part === "hook" && (b.actions ?? []).some((a) => meters.has(a.target)));
  if (!hookMeter) return [];
  const limitIdx = sb.beats.findIndex((b) => (b.part === "mechanism" || b.part === "climax") && LIMIT_RE.test(b.phrase));
  if (limitIdx < 0) return [];
  const back = sb.beats.slice(limitIdx).some((b) => (b.actions ?? []).some((a) => meters.has(a.target) && a.do !== "exit"));
  if (back) return [];
  const b = sb.beats[limitIdx];
  return [
    {
      id: "meter-return",
      severity: "warn",
      beatId: b.id,
      message: `${b.id}: "${b.phrase}" says the total reaches the limit, but the hook's Meter never comes back: bring it (or labelled part Meters that add up to the limit) back on this beat, countUp to the limit and state "full" on the keyword`,
    },
  ];
}

// ── W3.3 craft checks: static stretches, colour-coded cells, the climax KineticWord, NodeGraph right edge ─────────────

/**
 * static-stretch — more than STATIC_STRETCH_MAX consecutive beats show the same picture: no camera key, nothing
 * enters, and every changed instance is one and the same (a NodeGraph flipping one node per beat; W3.2 r3
 * event-recent b06–b09 and b11–b16). Exits, pulses and data-field/header tints do not break the stretch. One warning
 * per stretch, on its third beat.
 */
export function staticStretchChecks(sb: CraftStoryboard): CraftFinding[] {
  const out: CraftFinding[] = [];
  const ids = new Set(sb.world.map((w) => w.id));
  let run: string[] = [];
  let subject: string | null = null;
  const flush = () => {
    if (run.length > STATIC_STRETCH_MAX)
      out.push({
        id: "static-stretch",
        severity: "warn",
        beatId: run[STATIC_STRETCH_MAX],
        message: `${run[0]}–${run[run.length - 1]}: ${run.length} beats in a row show the same picture (only ${subject} changes, no camera move, nothing enters): by ${run[STATIC_STRETCH_MAX]} push in on the part the phrase names, add a Callout or a packet mark, or change the path`,
      });
    run = [];
    subject = null;
  };
  sb.beats.forEach((b, i) => {
    const acts = (b.actions ?? []).filter((a) => ids.has(a.target) && a.do !== "exit" && !WEAK_VERBS.has(a.do));
    const targets = new Set(acts.map((a) => a.target));
    const still = i > 0 && b.part !== "cta" && !(b.camera ?? []).length && !acts.some((a) => a.do === "enter") && targets.size === 1;
    const t = still ? [...targets][0] : null;
    if (!still || (subject !== null && t !== subject)) flush();
    if (still) {
      subject = t;
      run.push(b.id);
    }
  });
  flush();
  return out;
}

const CELLS_N = 20;
const usedCells = (cells: readonly unknown[]): number => cells.filter((k) => k !== "empty" && k !== "freed").length;

/**
 * uncoded-cells — a ContainerBox that carries ≥2 mechanism beats but never shows ≥2 cell categories (W3.2 r3
 * evergreen-oom: 20 identical grey cells while the narration listed page cache, inodes, buffers). cells-value — a
 * state/mark that sets 20 cells whose used count disagrees with the bar value (> 2 cells off).
 */
export function cellCodingChecks(sb: CraftStoryboard): CraftFinding[] {
  const out: CraftFinding[] = [];
  for (const box of sb.world.filter((w) => w.component === "ContainerBox")) {
    const base = isObj(box.props) ? box.props : {};
    let value = typeof base.value === "number" ? base.value : undefined;
    const kinds = new Set<string>();
    const addKinds = (cells: unknown) => {
      if (Array.isArray(cells)) for (const k of cells) if ((CELL_CATEGORY_KINDS as readonly unknown[]).includes(k)) kinds.add(String(k));
    };
    addKinds(base.cells);
    let mechBeats = 0;
    for (const b of sb.beats) {
      const acts = (b.actions ?? []).filter((a) => a.target === box.id);
      if (acts.length && b.part === "mechanism") mechBeats++;
      for (const a of acts) {
        const p = isObj(a.props) ? a.props : {};
        if (typeof p.value === "number") value = p.value;
        if (!Array.isArray(p.cells)) continue;
        addKinds(p.cells);
        if (p.cells.length === CELLS_N && value !== undefined) {
          const used = usedCells(p.cells);
          if (Math.abs(used - value * CELLS_N) > 2)
            out.push({ id: "cells-value", severity: "warn", beatId: b.id, message: `${b.id}: ${box.id} shows ${used} used cells of ${CELLS_N} but its bar says ${Math.round(value * 100)} %: set value ${(used / CELLS_N).toFixed(2)} in the same action so the bar and the cells tell one number` });
        }
      }
    }
    if (mechBeats >= 2 && kinds.size < 2)
      out.push({ id: "uncoded-cells", severity: "warn", message: `${box.id}: the ContainerBox carries ${mechBeats} mechanism beats but its cells are one colour: give props.cells categories (filled = heap, accent = what the story reveals, danger = what cannot be reclaimed) and a legend in the same tones` });
  }
  return out;
}

const normPhrase = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * kinetic-duplicate — the KineticWord's text is the phrase of the beat it enters on, word for word (W3.2 r3
 * evergreen-oom b16, event-recent b22): the caption already shows it. kinetic-accent — its accentWord is not the
 * beat's keyword (evergreen-oom b16 "page." vs keyword "every").
 */
export function kineticChecks(sb: CraftStoryboard): CraftFinding[] {
  const out: CraftFinding[] = [];
  const kins = new Map(sb.world.filter((w) => w.component === "KineticWord").map((w) => [w.id, isObj(w.props) ? w.props : {}]));
  for (const b of sb.beats) {
    for (const a of b.actions ?? []) {
      const p = kins.get(a.target);
      if (!p || a.do !== "enter") continue;
      const text = typeof p.text === "string" ? p.text : "";
      if (text && normPhrase(text) === normPhrase(b.phrase))
        out.push({ id: "kinetic-duplicate", severity: "warn", beatId: b.id, message: `${b.id}: KineticWord ${a.target} repeats the subtitle "${b.phrase}" word for word: show the 2–4-word core instead (the words around "${b.keyword}")` });
      const acc = typeof p.accentWord === "string" ? p.accentWord : "";
      if (acc && normPhrase(acc) !== normPhrase(b.keyword))
        out.push({ id: "kinetic-accent", severity: "warn", beatId: b.id, message: `${b.id}: KineticWord ${a.target} accents "${acc}" but the caption's keyword is "${b.keyword}": accentWord = the keyword, tone = the keywordColor` });
    }
  }
  return out;
}

/** World point a camera target resolves to (src/v2/timeline.ts targetPoint, x only), or null when unknown. */
function targetX(t: unknown, sb: CraftStoryboard, components: Registry): number | null {
  if (!isObj(t)) return null;
  if (typeof t.station === "string") {
    const s = (sb.stations ?? []).find((x) => x.id === t.station);
    return s ? s.x + s.w / 2 : null;
  }
  if (typeof t.instance === "string") {
    const w = sb.world.find((x) => x.id === t.instance);
    if (!w || typeof w.x !== "number") return null;
    const width = typeof w.w === "number" ? w.w : (components[w.component] as ComponentMeta | undefined)?.footprint?.w;
    return typeof width === "number" ? w.x + width / 2 : w.x;
  }
  return typeof t.x === "number" ? t.x : null;
}

/** A camera zoom this many times the graph's establishing zoom is a push-in (judged by its drawn extent). */
export const PUSH_IN_RATIO = 1.2;

/** Horizontal extent (component px) of what a NodeGraph draws: node squares / dots and their label plates. */
export function graphDrawnX(props: unknown, w: number): { left: number; right: number } | null {
  const W = Math.min(NODE_GRAPH.maxW, Math.max(NODE_GRAPH.minW, w));
  const nodes = graphNodes(props);
  if (!nodes.length) return null;
  let left = Infinity;
  let right = -Infinity;
  for (const n of nodes) {
    const raw = n as unknown as { x?: number; y?: number; shape?: string; label?: string };
    if (typeof raw.x !== "number") return null;
    const cx = nodeCentre({ x: raw.x, y: raw.y ?? 0 }, W, NODE_GRAPH.h.wide).x;
    const half = Math.max((raw.shape === "dot" ? NODE_GRAPH.dot : NODE_GRAPH.node) / 2, ((raw.label ?? n.id).length * NODE_GRAPH.charW) / 2 + NODE_GRAPH.labelPadX);
    left = Math.min(left, cx - half);
    right = Math.max(right, cx + half);
  }
  return { left, right };
}

/**
 * nodegraph-right — on a beat where a NodeGraph is on screen, the camera puts its right edge past x TEXT_MAX_X
 * (W3.2 r3 event-recent: graph x 2430 w 860 at zoom 1.05 on its centre → x ≈ 991). The camera is followed key by key
 * (the key in force on the beat = its last key); one warning per graph listing the beats.
 */
export function nodeGraphFrameChecks(sb: CraftStoryboard, components: Registry = COMPONENTS): CraftFinding[] {
  const graphs = sb.world.filter((w) => w.component === "NodeGraph" && typeof w.x === "number");
  if (!graphs.length) return [];
  let camX = targetX(sb.camera0?.target, sb, components);
  let zoom = typeof sb.camera0?.zoom === "number" ? sb.camera0.zoom : 1;
  const visible = new Set<string>();
  const hits = new Map<string, { beats: string[]; max: number; min: number }>();
  // W5 fix 1: a push-in (zoom ≥ PUSH_IN_RATIO × the graph's establishing zoom) is judged by what it DRAWS (nodes +
  // label plates, like L3), so a centred ≈1.4× push-in on a wide graph is not a canvas overflow.
  const establish = new Map<string, number>();
  for (const b of sb.beats) {
    for (const k of b.camera ?? []) {
      if (!isObj(k)) continue;
      const x = targetX(k.target, sb, components);
      if (x !== null) camX = x;
      if (typeof k.zoom === "number") zoom = k.zoom;
    }
    for (const a of b.actions ?? []) {
      if (a.do === "enter") visible.add(a.target);
      if (a.do === "exit") visible.delete(a.target);
    }
    if (camX === null) continue;
    for (const g of graphs) {
      if (!visible.has(g.id)) continue;
      const w = typeof g.w === "number" ? g.w : ((components.NodeGraph as ComponentMeta | undefined)?.footprint?.w ?? 900);
      if (!establish.has(g.id)) establish.set(g.id, zoom);
      const drawn = zoom >= PUSH_IN_RATIO * (establish.get(g.id) as number) ? graphDrawnX(g.props, w) : null;
      const right = 540 + ((g.x as number) + (drawn ? drawn.right : w) - camX) * zoom;
      const left = 540 + ((g.x as number) + (drawn ? drawn.left : 0) - camX) * zoom;
      if (drawn ? right <= TEXT_MAX_X + 0.5 && left >= 63.5 : right <= TEXT_MAX_X + 0.5 || left >= 1080) continue;
      const h = hits.get(g.id) ?? { beats: [], max: 0, min: Infinity };
      h.beats.push(b.id);
      h.max = Math.max(h.max, right);
      h.min = Math.min(h.min, left);
      hits.set(g.id, h);
    }
  }
  return [...hits].map(([id, h]) => ({
    id: "nodegraph-right" as const,
    severity: "warn" as const,
    beatId: h.beats[0],
    message: `${id}: the NodeGraph reaches x ${Math.round(h.max)} on screen${h.min < 63.5 ? ` (left edge x ${Math.round(h.min)})` : ""} (${h.beats.length > 4 ? `${h.beats.slice(0, 4).join(", ")} … ${h.beats.length} beats` : h.beats.join(", ")}), past the ${TEXT_MAX_X} text limit: aim the camera at its centre with w × zoom ≤ ${2 * (TEXT_MAX_X - 540)}, or narrow w`,
  }));
}

// ── W5 fix 1 craft checks (vswitch-mac r1): a path drawn before it exists, failure told on lime edges, graph states
//    with no legend, terminal-only runs, the climax frame and the CTA ─────────────────────────────────────────────────

/**
 * The W5 fix-1 visual checks (warnings). Kept out of craftChecks() so the dry harness's recorded craft counts stay
 * comparable across waves; the dry summary / lints can adopt them by calling this next to craftChecks().
 */
export function visualStoryChecks(sb: CraftStoryboard): CraftFinding[] {
  return [...pathTimingChecks(sb), ...graphLegendChecks(sb), ...terminalRunChecks(sb), ...pushInShareChecks(sb), ...climaxFrameChecks(sb)];
}

/** A phrase that introduces a remedy path (a route that did not exist before). */
export const REMEDY_RE = /\b(add(?:s|ed|ing)?|introduc\w*|secondary|second (?:route|network|path|link)|failover|backup (?:route|network|path|link)|workaround|mitigat\w*|reroute\w*|redundan\w*)\b/i;
/** A phrase that says traffic is lost or late on a path. */
export const LOSS_RE = /\b(drop(?:s|ped|ping)?|delay(?:s|ed)?|unanswered|loss|lost|cut off|unreachable|time(?:s|d)? ?out|(?:couldn'?t|can'?t|cannot|could not) reach|stop(?:s|ped)? hearing|fail(?:s|ed|ing)?)\b/i;
/** Parts where a failure line describes the live mechanism (context/closure retell it). */
const LIVE_PARTS: ReadonlySet<string> = new Set(["reveal", "twist", "mechanism"]);

interface GraphTrack {
  id: string;
  nb: Record<string, string>;
  eb: Record<string, string>;
  n: Record<string, string>;
  e: Record<string, string>;
  visible: boolean;
}

/** Per-beat NodeGraph state after the beat's actions (replace semantics, enter/exit visibility, packet hops). */
function graphTimeline(sb: CraftStoryboard): Array<{ beat: CraftStoryboard["beats"][number]; i: number; graphs: Array<{ id: string; visible: boolean; n: Record<string, string>; e: Record<string, string>; packets: string[] }> }> {
  const tracks: GraphTrack[] = sb.world
    .filter((w) => w.component === "NodeGraph")
    .map((w) => {
      const nb = Object.fromEntries(graphNodes(w.props).map((n) => [n.id, typeof n.state === "string" ? n.state : "ok"]));
      const eb = baseEdgeState(w.props);
      return { id: w.id, nb, eb, n: { ...nb }, e: { ...eb }, visible: false };
    });
  return sb.beats.map((beat, i) => {
    const packets = new Map<string, string[]>();
    for (const a of beat.actions ?? []) {
      const g = tracks.find((t) => t.id === a.target);
      if (!g) continue;
      if (a.do === "enter" || a.do === "drawOn") g.visible = true;
      if (a.do === "exit") g.visible = false;
      if (a.do === "state" && a.state !== "dim" && isObj(a.props)) {
        g.n = applyGraphMap(g.nb, g.n, a.props.nodeStates);
        g.e = applyGraphMap(g.eb, g.e, a.props.edgeStates);
      }
      if (a.do === "mark" && isObj(a.props) && typeof a.props.packet === "string") {
        const hops = a.props.packet.split(">");
        const keys: string[] = [];
        for (let k = 0; k + 1 < hops.length; k++) {
          const fwd = `${hops[k]}>${hops[k + 1]}`;
          const rev = `${hops[k + 1]}>${hops[k]}`;
          keys.push(fwd in g.eb ? fwd : rev);
        }
        packets.set(g.id, [...(packets.get(g.id) ?? []), ...keys]);
      }
    }
    return { beat, i, graphs: tracks.map((t) => ({ id: t.id, visible: t.visible, n: { ...t.n }, e: { ...t.e }, packets: packets.get(t.id) ?? [] })) };
  });
}

const beatList = (ids: string[]) => (ids.length > 4 ? `${ids.slice(0, 4).join(", ")} … ${ids.length} beats` : ids.join(", "));

/**
 * premature-edge — an edge drawn (idle) on screen for beats before it is first used (active, broken or a packet), and
 * first used on a remedy line ("added a secondary network"): the post-fix route was on screen all along, so the
 * failure beats show a working-looking direct path (vswitch-mac r1 WRK–DB from b03 to b18).
 * loss-edge — on reveal/twist/mechanism beats whose phrase says traffic is lost or late, the graph on screen shows
 * lime active edges and no broken one (vswitch-mac r1 b04–b10: "dropping connections" on an all-lime switch).
 */
export function pathTimingChecks(sb: CraftStoryboard): CraftFinding[] {
  const out: CraftFinding[] = [];
  const tl = graphTimeline(sb);
  const ids = tl[0]?.graphs.map((g) => g.id) ?? [];
  for (const [gi, gid] of ids.entries()) {
    const keys = Object.keys(tl[0].graphs[gi].e);
    for (const k of keys) {
      let shownIdle = 0;
      for (const { beat, graphs } of tl) {
        const g = graphs[gi];
        const used = g.e[k] === "active" || g.e[k] === "broken" || g.packets.includes(k);
        if (used) {
          if (shownIdle > 0 && REMEDY_RE.test(beat.phrase))
            out.push({
              id: "premature-edge",
              severity: "warn",
              beatId: beat.id,
              message: `${beat.id}: ${gid} edge ${k} is first used on "${beat.phrase}", but it was drawn idle on ${shownIdle} earlier beats, so the failure beats show that path as if it already existed: leave it out of edges[] and on ${beat.id} swap in a second NodeGraph (same nodes and layout plus the new link or hub, linked to every node the source names), then light it`,
            });
          break;
        }
        if (g.visible) shownIdle++;
      }
    }
    const hits: string[] = [];
    for (const { beat, graphs } of tl) {
      const g = graphs[gi];
      if (!g.visible || !LIVE_PARTS.has(beat.part ?? "") || !LOSS_RE.test(beat.phrase)) continue;
      const states = Object.values(g.e);
      if (states.includes("active") && !states.includes("broken")) hits.push(beat.id);
    }
    if (hits.length)
      out.push({
        id: "loss-edge",
        severity: "warn",
        beatId: hits[0],
        message: `${gid}: ${beatList(hits)} say traffic is lost or late, but every lit edge stays lime "active" and none is "broken": the picture says the network is healthy. Break (or degrade) the edges the phrase names on its keyword; keep "active" only for paths the line says still work`,
      });
  }
  return out;
}

/** A legend instance: a SourceTag / Callout whose text maps a colour or style to a meaning ("red = cut off"). */
const LEGEND_TEXT_RE = /=|\blegend\b/i;
const NON_OK_NODE = ["danger", "degraded", "accent"];
const NON_IDLE_EDGE = ["active", "broken"];

/**
 * graph-legend — a NodeGraph shows more than two non-ok states (node danger / degraded / accent, edge active / broken)
 * over the reel but no legend instance ("red = cut off · dashed = unreachable") is ever placed (vswitch-mac r1: seven
 * visual states, no legend; MGR "degraded" for a fact no line said).
 */
export function graphLegendChecks(sb: CraftStoryboard): CraftFinding[] {
  const legend = sb.world.some((w) => (w.component === "SourceTag" || w.component === "Callout") && isObj(w.props) && [w.props.text, w.props.label, w.props.body].some((t) => typeof t === "string" && LEGEND_TEXT_RE.test(t)));
  if (legend) return [];
  const out: CraftFinding[] = [];
  const tl = graphTimeline(sb);
  for (const [gi, gid] of (tl[0]?.graphs.map((g) => g.id) ?? []).entries()) {
    const used = new Set<string>();
    let first: string | undefined;
    for (const { beat, graphs } of tl) {
      const g = graphs[gi];
      if (!g.visible) continue;
      for (const s of Object.values(g.n)) if (NON_OK_NODE.includes(s)) used.add(`node ${s}`);
      for (const s of Object.values(g.e)) if (NON_IDLE_EDGE.includes(s)) used.add(`edge ${s}`);
      if (used.size > 2 && !first) first = beat.id;
    }
    if (first)
      out.push({ id: "graph-legend", severity: "warn", beatId: first, message: `${gid} shows ${used.size} states (${[...used].join(", ")}) with no legend: add one compact legend row in those tones ("red = cut off · dashed = unreachable · lime = still works"), and drop any state no line names` });
  }
  return out;
}

/**
 * terminal-run — two or more beats in a row whose only change is a Terminal line (mark / enter on a Terminal, no
 * camera key): the mechanism is being told as text beside the picture (vswitch-mac r1 b07–b10).
 */
export function terminalRunChecks(sb: CraftStoryboard): CraftFinding[] {
  const comp = new Map(sb.world.map((w) => [w.id, w.component]));
  const out: CraftFinding[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1)
      out.push({ id: "terminal-run", severity: "warn", beatId: run[1], message: `${run[0]}–${run[run.length - 1]}: ${run.length} beats in a row only add a terminal line: the mechanism is told as text. Change the subject on these keywords (edge / node states, cells) and keep the Terminal as a swapped-in satellite with only the lines it shows` });
    run = [];
  };
  for (const b of sb.beats) {
    const acts = (b.actions ?? []).filter((a) => comp.has(a.target) && !WEAK_VERBS.has(a.do));
    const termOnly = !(b.camera ?? []).length && acts.length > 0 && acts.every((a) => comp.get(a.target) === "Terminal") && acts.some((a) => a.do === "mark" || a.do === "enter");
    if (termOnly) run.push(b.id);
    else flush();
  }
  flush();
  return out;
}

/** Share of the mechanism beats (with a NodeGraph on screen) that must push in on the part that changes. */
export const PUSH_IN_MIN_SHARE = 0.5;

/**
 * push-in-share — fewer than half of the mechanism beats that show a NodeGraph carry a camera key zooming to ≥
 * PUSH_IN_RATIO × the graph's establishing zoom (vswitch-mac r1: the camera held x 540 at zoom 0.88–1.0 through all
 * nine mechanism beats, so the graph never got closer than ~52 % of the width).
 */
export function pushInShareChecks(sb: CraftStoryboard): CraftFinding[] {
  const tl = graphTimeline(sb);
  let zoom = typeof sb.camera0?.zoom === "number" ? sb.camera0.zoom : 1;
  let establish: number | null = null;
  const mech: string[] = [];
  const pushed: string[] = [];
  for (const { beat, graphs } of tl) {
    const keys = (beat.camera ?? []).filter(isObj).map((k) => (typeof k.zoom === "number" ? k.zoom : zoom));
    const on = graphs.some((g) => g.visible);
    if (on && establish === null) establish = zoom;
    if (on && beat.part === "mechanism") {
      mech.push(beat.id);
      if (keys.some((z) => z >= PUSH_IN_RATIO * (establish as number) - 1e-9)) pushed.push(beat.id);
    }
    if (keys.length) zoom = keys[keys.length - 1];
  }
  if (!mech.length || pushed.length >= Math.ceil(PUSH_IN_MIN_SHARE * mech.length)) return [];
  return [
    {
      id: "push-in-share",
      severity: "warn",
      beatId: mech[0],
      message: `${mech[0]}–${mech[mech.length - 1]}: ${pushed.length} of ${mech.length} mechanism beats push in on the graph (need ≥ ${Math.ceil(PUSH_IN_MIN_SHARE * mech.length)}): on the keyword target the node, edge midpoint or cells that change at ≈1.4× the establishing zoom (${establish}), every drawn node and label inside x 64–${TEXT_MAX_X}, then pull back out`,
    },
  ];
}

/** CTA: a camera zoom change smaller than this share is "the same frame". */
const CTA_MIN_ZOOM_DELTA = 0.15;

/**
 * climax-focus — on the climax the NodeGraph has an accent node next to its danger cause (the eye goes to the lit
 * bystander), or the camera does not push in (vswitch-mac r1 b20: CDN the only lime node, no camera key).
 * cta-repeat — the CTA beat changes nothing on a world instance and the camera barely moves (b22 ≡ b21).
 */
export function climaxFrameChecks(sb: CraftStoryboard): CraftFinding[] {
  const out: CraftFinding[] = [];
  const tl = graphTimeline(sb);
  const comp = new Set(sb.world.map((w) => w.id));
  let zoom = typeof sb.camera0?.zoom === "number" ? sb.camera0.zoom : 1;
  for (const { beat, graphs } of tl) {
    const before = zoom;
    for (const k of beat.camera ?? []) if (isObj(k) && typeof k.zoom === "number") zoom = k.zoom;
    if (beat.part === "climax") {
      const why: string[] = [];
      for (const g of graphs.filter((x) => x.visible)) {
        const states = Object.entries(g.n);
        const lit = states.filter(([, s]) => s === "accent").map(([id]) => id);
        if (lit.length && states.some(([, s]) => s === "danger")) why.push(`${g.id} lights ${lit.join(", ")} in accent next to the danger cause`);
      }
      if (!(zoom > before + 1e-9) && graphs.some((g) => g.visible)) why.push("the camera does not push in");
      if (why.length) out.push({ id: "climax-focus", severity: "warn", beatId: beat.id, message: `${beat.id} (climax): ${why.join("; ")} — push in on the node the climax names and make it the only highlighted element` });
    }
    if (beat.part === "cta") {
      const changes = (beat.actions ?? []).some((a) => comp.has(a.target) && !WEAK_VERBS.has(a.do));
      if (!changes && Math.abs(zoom - before) < CTA_MIN_ZOOM_DELTA * before)
        out.push({ id: "cta-repeat", severity: "warn", beatId: beat.id, message: `${beat.id} (CTA): the frame is the closure's frame held (no world change, zoom ${before}→${zoom}): pull out to the whole subject with the remedy lit, or end on a clean plate` });
    }
  }
  return out;
}
