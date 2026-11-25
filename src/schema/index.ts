// Shared contracts between director, audio, render and the Remotion library.

import { z } from "zod";
import { ConfigSchema, type Config } from "./config.js";
import { ScriptSchema, type Script } from "./script.js";

export * from "./config.js";
export * from "./library.js";
export * from "./script.js";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
/** Silence appended after each beat's narration (scene duration = audio + BEAT_PAD_SEC). */
export const BEAT_PAD_SEC = 0.3;
/** Remotion composition id. */
export const COMPOSITION_ID = "Reel";

/** One spoken word, times in ms RELATIVE TO THE START OF ITS BEAT's audio file. */
export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

export interface BeatAudio {
  beatId: number;
  /** URL Remotion can fetch: https (S3, Lambda) or http://localhost/staticFile path (local render). */
  url: string;
  /** Exact duration of the mp3, seconds (from ffprobe). */
  durationSec: number;
  words: WordTiming[];
}

/** Remotion inputProps — the whole contract between the pipeline and ReelComposition. */
export interface ReelProps {
  config: Config;
  script: Script;
  audio: BeatAudio[];
  /** Optional: SFX URLs keyed by transition kind (absent in v1 unless assets/sfx/ exists). */
  sfx?: Partial<Record<string, string>>;
}

/** Frames for each beat: ceil((durationSec + BEAT_PAD_SEC) * FPS). Shared by calculateMetadata and the pipeline. */
export function beatFrames(audio: BeatAudio[]): number[] {
  return audio.map((a) => Math.ceil((a.durationSec + BEAT_PAD_SEC) * FPS));
}

export function totalFrames(audio: BeatAudio[]): number {
  return beatFrames(audio).reduce((a, b) => a + b, 0);
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  /** Human/LLM-readable error lines: "beats.3.onScreenText: must be 1–5 words". */
  errors: string[];
}

function fmt(e: z.ZodError): string[] {
  return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Validate script + config together (cross-refs: character refs, HUD ids, stateChanges, voice/language). */
export function validateReel(scriptIn: unknown, configIn: unknown): ValidationResult<{ script: Script; config: Config }> {
  const s = ScriptSchema.safeParse(scriptIn);
  const c = ConfigSchema.safeParse(configIn);
  const errors = [...(s.success ? [] : fmt(s.error).map((x) => `script.${x}`)), ...(c.success ? [] : fmt(c.error).map((x) => `config.${x}`))];
  if (!s.success || !c.success) return { ok: false, errors };
  const script = s.data;
  const config = c.data;
  const chars = new Set(config.characters.map((x) => x.id));
  const huds = new Set(config.hud.map((x) => x.id));
  script.beats.forEach((b, i) => {
    b.scene.characters.forEach((ch, j) => {
      if (!chars.has(ch.ref)) errors.push(`script.beats.${i}.scene.characters.${j}.ref: unknown character "${ch.ref}" (config has: ${[...chars].join(", ") || "none"})`);
    });
    b.scene.hud.forEach((h, j) => {
      if (!huds.has(h)) errors.push(`script.beats.${i}.scene.hud.${j}: unknown hud id "${h}"`);
    });
    b.stateChanges.forEach((sc, j) => {
      if (!huds.has(sc.hudId)) errors.push(`script.beats.${i}.stateChanges.${j}.hudId: unknown hud id "${sc.hudId}"`);
    });
  });
  // A HUD must earn its place: shown in at least one beat AND actually changing at least once. A static or never-shown
  // counter is clutter on top of the frame — remove it from config.hud instead.
  for (const h of config.hud) {
    const shown = script.beats.some((b) => b.scene.hud.includes(h.id));
    const changes = script.beats.some((b) => b.stateChanges.some((sc) => sc.hudId === h.id && sc.from !== sc.to));
    if (!shown || !changes) {
      errors.push(`config.hud "${h.id}": ${!shown ? "never shown in any beat" : "never changes (no stateChanges with from ≠ to)"} — a HUD is optional; remove it unless the changing value is central to the story`);
    }
  }
  if (!script.voice.toLowerCase().startsWith(script.language.slice(0, 2))) {
    errors.push(`script.voice: voice ${script.voice} does not match language ${script.language}`);
  }
  if (!script.beats[0].narration.toLowerCase().startsWith(script.hook.toLowerCase().slice(0, 20))) {
    errors.push("script.hook: beat 1's narration must start with the hook");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { script, config }, errors: [] };
}
