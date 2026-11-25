// The component-library catalogue: every preset the director may reference. This is the single source of truth —
// the zod schemas below are built from these lists, the Remotion library must implement EVERY entry, and
// list_library() returns them to the director. Adding an entry here = a developer task (implement it in remotion/,
// redeploy the Lambda site with scripts/deploy-site.sh).

export const STYLES = ["flat", "pixel"] as const;

export const BACKGROUNDS = [
  "meadow", // green hills, blue sky
  "snowy-hills",
  "mountains",
  "forest",
  "city",
  "desert",
  "ocean", // sea surface + horizon
  "underwater",
  "space", // stars, planet
  "indoor-room", // wall + floor + window
  "lab", // indoor, benches, screens
  "maze", // top-down-ish hedge maze walls
  "plain", // flat palette background + subtle texture
] as const;

export const TIMES_OF_DAY = ["day", "dusk", "night"] as const;

export const SPECIES = [
  "human",
  "dog", // generic dog; params (bodyColor/accentColor + accessories) make e.g. a sheepadoodle (fluffy=true)
  "cat",
  "bird",
  "bear",
  "fox",
  "rabbit",
  "penguin",
  "snowman",
  "robot",
  "fish",
  "creature", // generic blob creature: fallback for anything the library lacks (dragon, alien…)
] as const;

export const ACCESSORIES = ["scarf", "hat", "beanie", "glasses", "backpack", "bow", "crown", "collar", "cape"] as const;

export const ACTIONS = ["idle", "walk", "run", "jump", "wave", "happy", "sad", "think", "shiver", "surprised"] as const;

export const PROPS = [
  "sun",
  "moon",
  "cloud",
  "tree",
  "pine-tree",
  "house",
  "maze-wall",
  "snowflake",
  "thermometer",
  "globe",
  "arrow",
  "star",
  "heart",
  "question-mark",
  "exclamation",
  "flower",
  "rock",
  "door",
  "key",
  "clock",
  "water-drop",
  "fire",
  "lightning",
  "mountain",
  "lightbulb",
  "coin",
  "chart-up",
  "chart-down",
  "ski",
  "trophy",
] as const;

export const PROP_ANIMATIONS = ["none", "bob", "spin", "pulse", "grow", "shrink", "sway", "fall", "melt"] as const;

export const PARTICLES = ["none", "snow", "rain", "sparkles", "dust", "bubbles", "leaves"] as const;

export const TRANSITIONS = ["cut", "slide", "zoom-punch", "flash", "wipe"] as const;

export const CAMERA_DRIFT = ["none", "slow", "medium"] as const;

export const POSITIONS = ["left", "center", "right"] as const;

export const HUD_KINDS = ["counter", "bar", "meter"] as const;

export const HUD_SLOTS = ["top-left", "top-center", "top-right"] as const;

export const PALETTE_ROLES = ["sky", "ground", "primary", "accent", "highlight", "ink"] as const;

/** Voices per language for edge-tts (first = default). The director picks by `script.language`. */
export const VOICES: Record<string, readonly string[]> = {
  en: ["en-US-AndrewNeural", "en-US-GuyNeural", "en-US-AriaNeural", "en-GB-RyanNeural"],
  de: ["de-CH-JanNeural", "de-DE-ConradNeural", "de-DE-KatjaNeural"],
  fr: ["fr-FR-HenriNeural", "fr-FR-DeniseNeural"],
  it: ["it-IT-DiegoNeural", "it-IT-ElsaNeural"],
  es: ["es-ES-AlvaroNeural", "es-ES-ElviraNeural"],
};
