// list_library() payload + its one-paragraph summary for the system prompt. Built from src/schema/library.ts (the
// single source of truth), so a new preset shows up here automatically.

import {
  ACCESSORIES,
  ACTIONS,
  BACKGROUNDS,
  CAMERA_DRIFT,
  HUD_KINDS,
  HUD_SLOTS,
  PALETTE_ROLES,
  PARTICLES,
  POSITIONS,
  PROP_ANIMATIONS,
  PROPS,
  SPECIES,
  STYLES,
  TIMES_OF_DAY,
  TRANSITIONS,
  VOICES,
} from "../schema/index.js";

export const LAYOUT_RULES = {
  canvas: "1080×1920 px, 30 fps, 9:16",
  safeZone: "top 150 px, bottom 350 px, right 120 px are reserved for Instagram UI; the renderer clamps everything into the safe zone",
  propCoordinates: "prop x/y are 0..1 inside the STAGE (safe zone minus the text bands): x 0 = left, 1 = right; y 0 = top, 1 = bottom. Keep props away from characters (characters stand on the ground around y≈0.75; left/center/right ≈ x 0.2/0.5/0.8)",
  textBands: "HUD row at the top, onScreenText below it, captions near the bottom of the safe zone — never put important props at y < 0.1 or y > 0.9",
  beats: "6–10 beats; each beat = one scene = 1–2 short spoken sentences; scene length = narration audio + 0.3 s",
  wordCount: "total narration 120–170 words (≈ 45–75 s at ~2.5 words/s; validator hard limits 100–195)",
  hook: "beat 1's narration must START with script.hook (question or bold claim, spoken within 2 s)",
  onScreenText: "2–5 punchy words per beat (validator: 1–5), ideally UPPERCASE",
  keyWord: "optional; one word that literally occurs in that beat's narration (highlighted in captions)",
  hud: "OPTIONAL, default none (config.hud = []). Only when one changing quantity IS the story: ≤ 2 elements, each in its own slot, label ≤ 10 characters (e.g. YEAR, SNOWPACK); scene.hud lists the ids visible in a beat; stateChanges {hudId, from, to} animate them. Every HUD element must be shown in ≥ 1 beat and change at least once, or the validator rejects it",
  facts: "factual topics: script.facts = [{claim, source}] for every concrete claim in the narration; source must be one of script.sources[].url",
  characters: "≤ 3 in config.characters (id lowercase), referenced by scene.characters[].ref; ≤ 3 per scene; idle bob + blink are automatic",
  props: "≤ 8 per scene",
  style: "exactly one style per video (config.style); palette overrides optional (#rrggbb per role) — keep 4–6 colours, high contrast",
  language: "script.language BCP-47 (en-US default); script.voice must be one of VOICES for that language",
} as const;

export function libraryCatalogue() {
  return {
    styles: STYLES,
    paletteRoles: {
      roles: PALETTE_ROLES,
      meaning: { sky: "background/sky", ground: "ground/floor", primary: "main shapes", accent: "secondary shapes", highlight: "caption key word (must contrast)", ink: "outlines + text stroke" },
    },
    backgrounds: BACKGROUNDS,
    timesOfDay: TIMES_OF_DAY,
    species: SPECIES,
    speciesNote: "dog + fluffy:true + colours makes poodle mixes/sheepadoodles; creature = generic blob for anything missing (dragon, alien…)",
    accessories: ACCESSORIES,
    actions: ACTIONS,
    characterEnter: ["none", "from-left", "from-right", "pop"],
    positions: POSITIONS,
    props: PROPS,
    propAnimations: PROP_ANIMATIONS,
    particles: PARTICLES,
    transitions: TRANSITIONS,
    cameraDrift: CAMERA_DRIFT,
    hudKinds: HUD_KINDS,
    hudSlots: HUD_SLOTS,
    captionModes: ["word", "chunk (chunkSize 2–4)"],
    voices: VOICES,
    layout: LAYOUT_RULES,
  };
}

/** Compact one-line-per-list summary for the system prompt (the full catalogue is one list_library call away). */
export function catalogueSummary(): string {
  const v = Object.entries(VOICES)
    .map(([l, vs]) => `${l}: ${vs.join(", ")}`)
    .join("; ");
  return [
    `styles: ${STYLES.join(", ")}`,
    `backgrounds: ${BACKGROUNDS.join(", ")} (timeOfDay: ${TIMES_OF_DAY.join("/")})`,
    `species: ${SPECIES.join(", ")}`,
    `accessories: ${ACCESSORIES.join(", ")}`,
    `actions: ${ACTIONS.join(", ")}`,
    `character placement: position ${POSITIONS.join("/")}, facing left/right, scale 0.4–1.8, enter none/from-left/from-right/pop (ONLY these)`,
    `camera: drift ${CAMERA_DRIFT.join("/")} (ONLY these), zoom 1–1.4`,
    `props: ${PROPS.join(", ")}`,
    `prop animations: ${PROP_ANIMATIONS.join(", ")}`,
    `particles: ${PARTICLES.join(", ")}`,
    `transitions: ${TRANSITIONS.join(", ")}`,
    `HUD kinds: ${HUD_KINDS.join(", ")}; slots: ${HUD_SLOTS.join(", ")}; HUD label ≤ 10 characters (longer labels get clipped in the box)`,
    `palette roles: ${PALETTE_ROLES.join(", ")}`,
    `voices: ${v}`,
  ].join("\n");
}
