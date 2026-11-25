// Component fixture format = the V2Gallery composition's inputProps (remotion/v2/Gallery.tsx). One file per shipped
// component: test/fixtures/v2/components/<Name>.json. Renderer-free (zod only at runtime; no relative runtime imports).
//
// A fixture renders ONE instance standalone on the persistent layers (data field, header, footer, vignette) under a
// static camera, with a frame-based verb timeline instead of words/beats. `stills` are the golden review frames
// (W2 release gate: 3 golden Lambda stills per component are picked from them).
import { z } from "zod";
import type { AnyComponentMeta } from "./_types.js";

const VERBS = ["enter", "exit", "state", "focus", "pulse", "scramble", "drawOn", "countUp", "mark", "glitch"] as const;
const PRESETS = ["hex", "logs", "process", "nodes", "lattice", "matrix", "book"] as const;

export const GalleryEvent = z
  .object({
    f: z.number().int().min(0),
    do: z.enum(VERBS),
    state: z.string().max(40).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * W7: a second (or third) instance on the gallery stage, stacked under the main one (e.g. a Meter that MIRRORS the
 * ContainerBox: `mirrors: true` derives its value events from the main instance's timeline, exactly like
 * Instance.mirrors in a reel — ContainerBox meta mirrorMeterEvents).
 */
export const GalleryCompanion = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,15}$/),
    component: z.string().regex(/^[A-Z][A-Za-z0-9]{2,30}$/),
    props: z.record(z.string(), z.unknown()),
    w: z.number().min(60).max(1000).optional(),
    timeline: z.array(GalleryEvent).max(40).default([]),
    mirrors: z.boolean().default(false),
  })
  .strict();

export const GalleryFixture = z
  .object({
    component: z.string().regex(/^[A-Z][A-Za-z0-9]{2,30}$/),
    /** Raw instance props (parsed by the component's propsSchema, exactly like a storyboard instance). */
    props: z.record(z.string(), z.unknown()),
    /** Instance width (Instance.w); omitted = the component's default width. */
    w: z.number().min(60).max(1000).optional(),
    scale: z.number().min(0.5).max(2).default(1),
    timeline: z.array(GalleryEvent).max(40),
    /** Composition length; default = last event + 30 f. */
    durationF: z.number().int().min(1).max(900).optional(),
    preset: z.enum(PRESETS).default("logs"),
    seed: z.string().max(40).default("gallery"),
    /** Static camera zoom (the stage centre stays at screen 540,855). */
    zoom: z.number().min(0.6).max(2.2).default(1),
    /** >1 wraps the world in WeightedMotionBlur with this many samples on every frame (flight components). */
    blurSamples: z.number().int().min(0).max(24).default(0),
    /** Golden review frames. */
    stills: z.array(z.number().int().min(0)).max(12).default([]),
    /** Draw the footprint outline + frame number. */
    debug: z.boolean().default(false),
    note: z.string().max(400).optional(),
    /** W7: extra instances stacked under the main one (gap 40 px; the group is centred on the stage). */
    companions: z.array(GalleryCompanion).max(2).default([]),
  })
  .strict();

export type GalleryFixtureIn = z.input<typeof GalleryFixture>;
export type GalleryFixtureT = z.output<typeof GalleryFixture>;

export function galleryDurationF(fx: Pick<GalleryFixtureT, "durationF" | "timeline">): number {
  return fx.durationF ?? Math.max(30, ...fx.timeline.map((e) => e.f + 30));
}

/** Contract checks of a fixture against its component meta (tests + the gallery's calculateMetadata). */
export function validateFixture(fx: GalleryFixtureT, meta: AnyComponentMeta | undefined): string[] {
  const e: string[] = [];
  if (!meta) return [`no shipped component "${fx.component}"`];
  const p = meta.propsSchema.safeParse(fx.props);
  if (!p.success) e.push(`props: ${p.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`);
  const dur = galleryDurationF(fx);
  for (const ev of fx.timeline) {
    if (!(ev.do in meta.verbs)) e.push(`f${ev.f}: ${meta.name} has no verb "${ev.do}"`);
    if (ev.do === "state" && (!ev.state || !meta.states.includes(ev.state))) e.push(`f${ev.f}: state "${ev.state ?? ""}" not in ${meta.states.join(", ")}`);
    if (ev.f >= dur) e.push(`f${ev.f}: past durationF ${dur}`);
    for (const k of Object.keys(ev.props ?? {})) if (!(meta.verbs[ev.do]?.props ?? []).includes(k)) e.push(`f${ev.f}: "${ev.do}" does not accept props.${k}`);
  }
  for (const s of fx.stills) if (s >= dur) e.push(`still ${s} past durationF ${dur}`);
  return e;
}
