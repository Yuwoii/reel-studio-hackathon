// config.json — per-reel look: style, palette overrides, the cast, HUD definitions, caption mode.

import { z } from "zod";
import { ACCESSORIES, HUD_KINDS, HUD_SLOTS, SPECIES, STYLES } from "./library.js";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colour must be #rrggbb");

export const PaletteSchema = z.object({
  sky: hex,
  ground: hex,
  primary: hex,
  accent: hex,
  highlight: hex, // caption key-word colour; must contrast with the caption fill
  ink: hex, // outlines, text stroke
});

export const CharacterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
  name: z.string().min(1).max(30),
  species: z.enum(SPECIES),
  bodyColor: hex,
  accentColor: hex,
  /** Curly/fluffy coat outline (poodle mixes, sheep, fluffy cats). */
  fluffy: z.boolean().default(false),
  accessories: z.array(z.enum(ACCESSORIES)).max(3).default([]),
});

export const HudSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
  kind: z.enum(HUD_KINDS),
  label: z.string().min(1).max(18),
  unit: z.string().max(6).default(""),
  min: z.number().default(0),
  max: z.number().default(100),
  initial: z.number(),
  decimals: z.number().int().min(0).max(2).default(0),
  slot: z.enum(HUD_SLOTS),
});

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    style: z.enum(STYLES),
    /** Partial override of the style's default palette (4–6 colours total stay in use). */
    palette: PaletteSchema.partial().default({}),
    characters: z.array(CharacterSchema).max(3).default([]),
    hud: z.array(HudSchema).max(3).default([]),
    captions: z
      .object({ mode: z.enum(["word", "chunk"]).default("chunk"), chunkSize: z.number().int().min(2).max(4).default(3) })
      .default({ mode: "chunk", chunkSize: 3 }),
  })
  .superRefine((c, ctx) => {
    const slots = new Set<string>();
    c.hud.forEach((h, i) => {
      if (slots.has(h.slot)) ctx.addIssue({ code: "custom", path: ["hud", i, "slot"], message: `two HUD elements in slot ${h.slot}` });
      slots.add(h.slot);
      if (h.min >= h.max) ctx.addIssue({ code: "custom", path: ["hud", i], message: "hud min must be < max" });
    });
    const ids = c.characters.map((x) => x.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["characters"], message: "duplicate character id" });
  });

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export type Palette = z.infer<typeof PaletteSchema>;
export type CharacterDef = z.infer<typeof CharacterSchema>;
export type HudDef = z.infer<typeof HudSchema>;
