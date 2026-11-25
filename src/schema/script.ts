// script.json — what the director writes per reel (via save_script). Validated with zod; errors go back to the
// director (max 3 tries). Remotion only consumes the inferred TYPES (import type), never this module at runtime.

import { z } from "zod";
import {
  ACTIONS,
  BACKGROUNDS,
  CAMERA_DRIFT,
  PALETTE_ROLES,
  PARTICLES,
  POSITIONS,
  PROP_ANIMATIONS,
  PROPS,
  TIMES_OF_DAY,
  TRANSITIONS,
} from "./library.js";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,59}$/;

const unit = z.number().min(0).max(1);

export const CharacterPlacementSchema = z.object({
  ref: z.string().min(1).describe("id of a character in config.characters"),
  action: z.enum(ACTIONS).default("idle"),
  position: z.enum(POSITIONS).default("center"),
  facing: z.enum(["left", "right"]).default("right"),
  scale: z.number().min(0.4).max(1.8).default(1),
  /** Optional entrance: the character walks/slides in from off-screen during the first ~0.6 s. */
  enter: z.enum(["none", "from-left", "from-right", "pop"]).default("none"),
});

export const PropPlacementSchema = z.object({
  kind: z.enum(PROPS),
  x: unit.describe("0 = left edge, 1 = right edge of the SAFE ZONE"),
  y: unit.describe("0 = top, 1 = bottom of the SAFE ZONE"),
  scale: z.number().min(0.3).max(3).default(1),
  animation: z.enum(PROP_ANIMATIONS).default("bob"),
  colorRole: z.enum(PALETTE_ROLES).optional(),
});

export const SceneSchema = z.object({
  background: z.object({
    preset: z.enum(BACKGROUNDS),
    timeOfDay: z.enum(TIMES_OF_DAY).default("day"),
  }),
  characters: z.array(CharacterPlacementSchema).max(3).default([]),
  props: z.array(PropPlacementSchema).max(8).default([]),
  particles: z
    .object({ kind: z.enum(PARTICLES), intensity: unit.default(0.5) })
    .default({ kind: "none", intensity: 0.5 }),
  /** ids from config.hud that are visible in this beat (values animate per stateChanges). */
  hud: z.array(z.string()).max(3).default([]),
  camera: z
    .object({ drift: z.enum(CAMERA_DRIFT).default("slow"), zoom: z.number().min(1).max(1.4).default(1) })
    .default({ drift: "slow", zoom: 1 }),
  transitionOut: z.enum(TRANSITIONS).default("slide"),
});

export const StateChangeSchema = z.object({
  hudId: z.string().min(1),
  from: z.number(),
  to: z.number(),
});

export const BeatSchema = z.object({
  id: z.number().int().min(1),
  narration: z.string().min(3).max(260).describe("1–2 short spoken sentences"),
  onScreenText: z
    .string()
    .min(1)
    .max(40)
    .refine((s) => {
      const n = s.trim().split(/\s+/).length;
      return n >= 1 && n <= 5;
    }, "onScreenText must be 1–5 words"),
  /** One word from the narration to highlight in the captions (case-insensitive match). */
  keyWord: z.string().max(30).optional(),
  visualDescription: z.string().min(3).max(300),
  stateChanges: z.array(StateChangeSchema).max(3).default([]),
  scene: SceneSchema,
});

export const SourceSchema = z.object({ title: z.string().min(1).max(200), url: z.string().url() });

export const FactSchema = z.object({
  claim: z.string().min(3).max(240),
  /** URL of the backing source; must be one of script.sources[].url. */
  source: z.string().url(),
});

export const ScriptSchema = z
  .object({
    version: z.literal(1),
    slug: z.string().regex(SLUG_RE, "slug: lowercase a-z0-9 and '-', 3–60 chars"),
    title: z.string().min(3).max(100),
    /** BCP-47 language of the narration, e.g. "en-US", "de-CH". */
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en-US"),
    /** edge-tts voice short name, e.g. "en-US-AndrewNeural" (see library VOICES). */
    voice: z.string().regex(/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/),
    /**
     * OPTIONAL recurring element that changes over time ("Day", "Turn", "Year"…), shown as a HUD/label. Only for
     * reels where tracking a quantity IS the story — most explainers and stories are better without one.
     */
    recurring: z.object({ label: z.string().min(1).max(20), values: z.array(z.string().max(20)).optional() }).optional(),
    hook: z.string().min(3).max(160).describe("must equal (or be the start of) beat 1's narration"),
    loopLine: z.string().min(3).max(200).describe("last line that leads back into the start"),
    beats: z.array(BeatSchema).min(6).max(10),
    sources: z.array(SourceSchema).max(8).default([]),
    /**
     * Research fact sheet: every concrete claim (number, date, name, causal statement) the narration relies on, each
     * tied to one of script.sources. Required in practice for factual topics (the director prompt enforces it);
     * empty for fiction. Goes into out/<slug>_script.md so claims can be checked before posting.
     */
    facts: z.array(FactSchema).max(15).default([]),
    /** Director's notes on library substitutions ("no dragon component — used creature"). Shown in the thread. */
    substitutions: z.array(z.string().max(200)).max(10).default([]),
  })
  .superRefine((s, ctx) => {
    s.beats.forEach((b, i) => {
      if (b.id !== i + 1) ctx.addIssue({ code: "custom", path: ["beats", i, "id"], message: `beat ids must be 1..n in order (expected ${i + 1})` });
      if (b.keyWord && !b.narration.toLowerCase().includes(b.keyWord.toLowerCase())) {
        ctx.addIssue({ code: "custom", path: ["beats", i, "keyWord"], message: `keyWord "${b.keyWord}" does not occur in the narration` });
      }
    });
    s.facts.forEach((f, i) => {
      if (!s.sources.some((src) => src.url === f.source)) {
        ctx.addIssue({ code: "custom", path: ["facts", i, "source"], message: "fact source must be one of script.sources[].url" });
      }
    });
    const totalWords = s.beats.reduce((n, b) => n + b.narration.trim().split(/\s+/).length, 0);
    // ~2.5 words/s narration → 45–75 s ≈ 105–190 words (beat padding adds ~0.3 s each)
    if (totalWords < 100 || totalWords > 195) {
      ctx.addIssue({ code: "custom", path: ["beats"], message: `total narration is ${totalWords} words; aim for 120–170 (45–75 s at ~2.5 words/s)` });
    }
  });

export type Script = z.infer<typeof ScriptSchema>;
export type ScriptInput = z.input<typeof ScriptSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type CharacterPlacement = z.infer<typeof CharacterPlacementSchema>;
export type PropPlacement = z.infer<typeof PropPlacementSchema>;
export type StateChange = z.infer<typeof StateChangeSchema>;
export type Fact = z.infer<typeof FactSchema>;
