// Reel Studio v3 visual-asset registry: manifest + D1 policy schemas (ADR-002 §2, promoted from
// research/v3/R4/sketch/asset-manifest.ts in W3a). Container-safe: runtime import of `zod` only.
//
// One directory per asset (assets/visual/<id>/):
//   manifest.json   this schema — the ONLY thing the container, director and lints read
//   ingest.json     the ingest spec that reproduces plate/preview/anchors from source/ (scripts/v3/assets/ingest.ts)
//   plate.jpg|png   treated derivative (photo / capture), bundled into the Lambda site — anonymously readable, so brand
//                   masks are BAKED into this file (D1 #2a), never applied at render time
//   model.glb       model3d (live 3D, --gl=swangle)
//   preview.jpg     ≤ 540 px wide; what view_asset returns to the director
//   anchors.jpg     plate / device / model still with anchors, safe crop and masks drawn (owner review evidence)
//   source/         original download; git-ignored (assets/visual/.gitignore); sha256 in licence.sourceSha256
// Device assets (kind "device") have no file: they name the library component whose meta exports anchors()/describe().

import { z } from "zod";

export const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/;
/** "lock", "urlbar.schemeS", "led.left" — dotted lowerCamel, ≤ 3 segments. */
export const ANCHOR_NAME = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,2}$/;
/** Storyboard pin: "watch-back-photo@2". */
export const ASSET_REF = /^([a-z0-9]+(?:-[a-z0-9]+){0,5})@(\d{1,3})$/;

/** Gate D1 #1 source classes: a illustration, b 3D, c capture, d photo, e AI still. */
export const SOURCE_CLASSES = ["a", "b", "c", "d", "e"] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];
export const ASSET_KINDS = ["device", "photo", "capture", "model3d", "clip"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const KIND_CLASS: Record<AssetKind, readonly SourceClass[]> = {
  device: ["a"],
  photo: ["d", "e"],
  capture: ["c"],
  model3d: ["b"],
  clip: ["b", "d"],
};
export const PROVENANCES = ["photograph", "screen-capture", "hand-illustration", "hand-3d", "ai-draft-3d", "ai-generated", "unknown-3d"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** Licences the library accepts. Share-alike (CC BY-SA) and Unsplash+ are unrepresentable on purpose (R3 §1, D1 #1). */
export const LICENCES = ["own-work", "CC0-1.0", "CC-BY-4.0", "Pexels", "Unsplash", "example-domain"] as const;
export type LicenceId = (typeof LICENCES)[number];
/** Canonical licence URLs (ingest refuses a different URL for the same id). */
export const LICENCE_URLS: Record<Exclude<LicenceId, "own-work">, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  Pexels: "https://www.pexels.com/license/",
  Unsplash: "https://unsplash.com/license",
  "example-domain": "https://www.iana.org/help/example-domains",
};
/** Licence words that must never enter the library (checked on the raw ingest form before zod). */
export const REFUSED_LICENCE_PATTERNS: readonly RegExp[] = [/\bBY[- ]?SA\b/i, /share[- ]?alike/i, /unsplash\s*\+|unsplash\s*plus/i, /\bNC\b|non[- ]?commercial/i, /\bND\b|no[- ]?deriv/i];

export const NormPt = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
export const NormRect = z
  .object({ x0: z.number().min(0).max(1), y0: z.number().min(0).max(1), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1) })
  .strict()
  .refine((r) => r.x1 > r.x0 && r.y1 > r.y0, "rect: x1 > x0 and y1 > y0");
export type NormRectT = z.output<typeof NormRect>;

/**
 * A NAMED physical part of the depicted object. photo/capture: normalised to plate pixels (x = px / w, y = px / h, not
 * aspect-corrected; `r` normalised to plate width). device: listed for the director's index only — the component meta
 * computes them from props. model3d: `xyz` in model metres (after the manifest's pivot), projected per frame.
 */
export const Anchor = z
  .object({
    label: z.string().min(2).max(60),
    physical: z.string().min(3).max(200),
    at: NormPt.optional(),
    xyz: z.tuple([z.number(), z.number(), z.number()]).optional(),
    r: z.number().min(0.002).max(0.5).optional(),
    box: NormRect.optional(),
  })
  .strict()
  .refine((a) => (a.at ? 1 : 0) + (a.xyz ? 1 : 0) <= 1, "anchor: at OR xyz, not both");
export type AnchorT = z.output<typeof Anchor>;

/** Named, versioned host-side treatments (scripts/v3/assets/treat.ts). Baked into plate.*, never at render time. */
export const TREATMENTS = ["none", "dark-photo@1", "dark-photo-strong@1", "capture-dark@1", "content-photo@1"] as const;
export type Treatment = (typeof TREATMENTS)[number];
export const TREATMENT_RECIPES: Record<Treatment, string> = {
  none: "copy; strip metadata",
  "dark-photo@1": "crop (default 9:16 centred) → scale 1620w lanczos → eq=brightness=-0.10:contrast=1.1:saturation=0.35 → curves all '0/0 0.5/0.28 1/0.85' → strip metadata → JPEG q3",
  "dark-photo-strong@1": "[baked masks] → crop → scale 1620w lanczos → eq=brightness=-0.12:saturation=0.3 → backdrop luminance key to #1E1E1E outside the subject radius → strip → JPEG q3",
  "capture-dark@1": "crop → pad with the page's own background → curves highlight cap (white → 0.84) → PNG (text stays lossless)",
  "content-photo@1": "crop (required) → scale outW (default 1080) lanczos → eq=brightness=-0.03:saturation=0.7 → curves all '0/0 0.5/0.42 1/0.84' → strip metadata → JPEG q3 (a photo shown AS CONTENT on a drawn screen/card, owner S1 #3: lighter than the backdrop presets, still inside the A6 tone gate)",
};

/** A brand-mark mask baked into plate.* (D1 #2a). Coordinates normalised to the SOURCE image (before crop/scale). */
export const BakedMask = z
  .object({
    covers: z.array(z.string().min(2).max(60)).min(1).max(8),
    shape: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("annulus"), cx: z.number().min(0).max(1), cy: z.number().min(0).max(1), rIn: z.number().min(0).max(1), rOut: z.number().min(0).max(1) }).strict(),
      z.object({ kind: z.literal("rect"), x0: z.number().min(0).max(1), y0: z.number().min(0).max(1), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1) }).strict(),
    ]),
    /** How the masked pixels were filled: radial = case texture smeared in from just outside the annulus;
     *  solid-local = the rect's own border colour (median) plus grain matched to the surrounding pixels. */
    fill: z.enum(["radial", "solid-local"]),
  })
  .strict();

/** Human/agent check recorded at ingest (people, brand marks): who looked at which file, when, and what they saw. */
export const ReviewCheck = z
  .object({ by: z.string().min(2).max(60), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), file: z.string().max(60), result: z.enum(["pass", "fail"]), note: z.string().max(300) })
  .strict();

/** model3d only: how the model is staged (pivot so it rotates about its own centre; nodes hidden for underside shots). */
export const ModelSetup = z
  .object({
    pivot: z.tuple([z.number(), z.number(), z.number()]),
    hideNodes: z.array(z.string().max(60)).max(16).default([]),
    /** Parts we add in code (e.g. LED discs on the sensor window); anchors may point at them. Truthfulness → caveats. */
    added: z.array(z.string().max(120)).max(8).default([]),
    gl: z.literal("swangle"),
  })
  .strict();

export const FAMILIES = ["security", "outage", "network", "systems", "science", "data"] as const;

export const AssetManifest = z
  .object({
    id: z.string().regex(ASSET_ID),
    version: z.number().int().min(1),
    kind: z.enum(ASSET_KINDS),
    sourceClass: z.enum(SOURCE_CLASSES),
    title: z.string().min(3).max(80),
    depicts: z.string().min(5).max(160),
    tags: z.array(z.string().regex(/^[a-z0-9-]{2,24}$/)).min(1).max(16),
    families: z.array(z.enum(FAMILIES)).min(1),
    file: z
      .object({
        path: z.string().regex(/^(plate\.(jpg|png)|model\.glb|clip\.mp4)$/),
        w: z.number().int().min(1).optional(),
        h: z.number().int().min(1).optional(),
        bytes: z.number().int().min(1).max(8_000_000),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict()
      .optional(),
    /** device: the library component that draws it; model3d: the component that renders it (Model3D). */
    component: z.string().regex(/^[A-Z][A-Za-z0-9]{2,30}$/).optional(),
    licence: z
      .object({
        id: z.enum(LICENCES),
        /** Licence text URL (canonical per id); own-work: the component source path instead. */
        url: z.string().url().optional(),
        author: z.string().min(2).max(120),
        sourceUrl: z.string().url().optional(),
        retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        attribution: z.string().max(200).optional(),
        modified: z.boolean(),
        changes: z.string().max(300).optional(),
        sourceSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      })
      .strict(),
    provenance: z.enum(PROVENANCES),
    /** Where the provenance claim comes from (a quote or the page that states it). */
    provenanceNote: z.string().max(300).optional(),
    brandMarks: z
      .object({
        /** Marks visible in the SHIPPED file ([] = none). */
        inFile: z.array(z.string().max(60)).max(8),
        handling: z.enum(["none-present", "baked-mask", "cropped-out", "owner-allowed"]),
        /** What the source showed and the ingest removed (baked-mask / cropped-out). */
        removed: z.array(z.string().max(60)).max(8).default([]),
        masks: z.array(BakedMask).max(10).default([]),
        notes: z.string().max(300).optional(),
      })
      .strict(),
    people: z.literal(false),
    review: z.object({ people: ReviewCheck.optional(), brandMarks: ReviewCheck.optional(), anchors: ReviewCheck.optional() }).strict().default({}),
    anchors: z.record(z.string().regex(ANCHOR_NAME), Anchor),
    safeCrop: NormRect.optional(),
    defaultAnchor: z.string().regex(ANCHOR_NAME).optional(),
    treatment: z.object({ preset: z.enum(TREATMENTS), crop: NormRect.optional(), extra: z.string().max(300).optional() }).strict(),
    tone: z.object({ meanLuma: z.number().min(0).max(1), p99Luma: z.number().min(0).max(1), meanSat: z.number().min(0).max(1) }).strict().optional(),
    model: ModelSetup.optional(),
    /** Capture only: values measured at capture time (real TLS fields) — shown only per policy (realIssuerNames). */
    captured: z.record(z.string().max(40), z.union([z.string().max(200), z.number()])).optional(),
    caveats: z.array(z.string().max(200)).max(6).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    const bad = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
    if (!KIND_CLASS[m.kind].includes(m.sourceClass)) bad(`kind ${m.kind} cannot be source class ${m.sourceClass}`, ["sourceClass"]);
    if (m.kind === "device" ? !m.component || m.file : !m.file) bad(m.kind === "device" ? "device: component, no file" : `${m.kind}: file required`);
    if ((m.kind === "photo" || m.kind === "capture") && !(m.file?.w && m.file?.h)) bad("plate needs w/h", ["file"]);
    if ((m.kind === "photo" || m.kind === "capture") && !/^plate\./.test(m.file?.path ?? "")) bad("photo/capture ship plate.*", ["file", "path"]);
    if (m.kind === "model3d" && (m.file?.path !== "model.glb" || !m.model || m.component !== "Model3D")) bad("model3d: model.glb + model setup + component Model3D", ["file"]);
    if (m.licence.id === "CC-BY-4.0" && !m.licence.attribution) bad("CC BY needs an attribution line", ["licence", "attribution"]);
    if (m.licence.id === "CC-BY-4.0" && m.licence.modified && !m.licence.changes) bad("CC BY + modified needs a changes notice", ["licence", "changes"]);
    if (m.licence.id !== "own-work" && !m.licence.sourceUrl) bad("non-own work needs sourceUrl", ["licence", "sourceUrl"]);
    if (m.licence.id === "own-work" && m.kind === "device" && !m.component) bad("own-work device names its component", ["component"]);
    // own-work capture: a neutral page WE wrote (assets/visual/<id>/page.html), captured via file:// — never a live site
    if (m.licence.id === "own-work" && m.kind === "capture" && !/^file:[\w.-]+\.html$/.test(String(m.captured?.url ?? ""))) bad("own-work capture: captured.url must be file:<page>.html (our own page next to the manifest)", ["captured", "url"]);
    if (m.licence.id !== "own-work" && m.licence.url !== LICENCE_URLS[m.licence.id]) bad(`licence url must be ${LICENCE_URLS[m.licence.id]}`, ["licence", "url"]);
    if (m.licence.id === "own-work" && m.kind !== "device" && m.kind !== "capture") bad("own-work is for drawn devices and captures of our own pages only", ["licence", "id"]);
    if (m.brandMarks.inFile.length && m.brandMarks.handling !== "owner-allowed") bad("brand marks in the shipped file: bake a mask / crop, or owner-allowed at D1 #2", ["brandMarks"]);
    if (m.brandMarks.handling === "baked-mask" && !m.brandMarks.masks.length) bad("baked-mask needs the mask record", ["brandMarks", "masks"]);
    if (m.brandMarks.handling === "baked-mask" || m.brandMarks.handling === "cropped-out") {
      if (!m.brandMarks.removed.length) bad("say what was removed", ["brandMarks", "removed"]);
      if (m.review.brandMarks?.result !== "pass") bad("a masked/cropped file needs a passed brand-mark review of the shipped file", ["review", "brandMarks"]);
    }
    if (m.kind !== "device" && m.review.people?.result !== "pass") bad("a file asset needs a passed people check", ["review", "people"]);
    // every photo / page capture gets a brand-mark + identifying-text check of the SHIPPED file (W3a review: a label
    // with real hostnames slipped through on a photo that was never checked)
    if ((m.kind === "photo" || m.kind === "capture") && m.review.brandMarks?.result !== "pass") bad("photo/capture needs a passed brand-mark check of the shipped file (research/v3/W3a/tools/brandcheck.ts)", ["review", "brandMarks"]);
    for (const [name, a] of Object.entries(m.anchors)) {
      if (m.kind === "model3d" ? !a.xyz : m.kind !== "device" && !a.at && !a.box) bad(`anchor ${name}: ${m.kind === "model3d" ? "xyz" : "at/box"} required`, ["anchors", name]);
      if (a.at && m.safeCrop && (a.at.x < m.safeCrop.x0 || a.at.x > m.safeCrop.x1 || a.at.y < m.safeCrop.y0 || a.at.y > m.safeCrop.y1)) bad(`anchor ${name} outside safeCrop`, ["anchors", name]);
    }
    if (m.defaultAnchor && !m.anchors[m.defaultAnchor]) bad(`defaultAnchor ${m.defaultAnchor} unknown`, ["defaultAnchor"]);
    if ((m.kind === "photo" || m.kind === "capture") && !m.tone) bad("plate needs measured tone", ["tone"]);
  });
export type AssetManifestT = z.output<typeof AssetManifest>;

/** Assets the OWNER named in the D1 decisions as allowed despite their provenance class (D1 #1b: "Original Innerscene
 *  model, released CC0"). A policy exception for any other id is refused: exceptions cannot be added by an agent. */
export const D1_NAMED_EXCEPTION_IDS: readonly string[] = ["watch-generic-3d"];

/** Gate D1 policy (data/asset-policy.json): the owner's 2026-10-31 decisions, read by genRegistry, search and lint A1. */
export const AssetPolicy = z
  .object({
    decidedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().max(200),
    allowedClasses: z.array(z.enum(SOURCE_CLASSES)),
    allowedProvenance: z.array(z.enum(PROVENANCES)),
    /** Named exceptions to allowedProvenance (D1 #1b: the owner named the Innerscene watch as clear-origin 3D). */
    provenanceExceptions: z.array(z.object({ assetId: z.string().regex(ASSET_ID), provenance: z.enum(PROVENANCES), reason: z.string().max(300) }).strict()).default([]),
    /** Hosts whose files are refused outright (Grab3D: "Many models start as an AI-generated draft"). */
    refusedSourceHosts: z.array(z.string().max(60)).default([]),
    /** Assets the OWNER took out of use after a review (S1 owner feedback 2026-11-02 #3: no real photos of places or
     *  things — server rooms, mailrooms, lobbies; photos only as on-screen content). Kept on disk with their manifest
     *  for the record; never in search, never shipped, refused by lint A1. */
    ownerWithdrawn: z.array(z.object({ assetId: z.string().regex(ASSET_ID), decided: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().max(300) }).strict()).default([]),
    allowedLicences: z.array(z.enum(LICENCES)),
    brandMarksAllowed: z.boolean(),
    realIssuerNames: z.boolean(),
    genericIssuer: z.string().min(3).max(60),
    annotationGlowOnPhotos: z.boolean(),
    live3d: z.boolean(),
    gl3d: z.literal("swangle"),
    tone: z.object({ maxP99Luma: z.number().min(0).max(1), maxMeanSat: z.number().min(0).max(1) }).strict(),
    attribution: z.enum(["caption", "caption+footer"]),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const [i, e] of p.provenanceExceptions.entries())
      if (!D1_NAMED_EXCEPTION_IDS.includes(e.assetId))
        ctx.addIssue({ code: "custom", path: ["provenanceExceptions", i, "assetId"], message: `provenance exception for ${e.assetId}: only assets the owner named at D1 (${D1_NAMED_EXCEPTION_IDS.join(", ")}) may be excepted` });
  });
export type AssetPolicyT = z.output<typeof AssetPolicy>;

/** Max zoom of a plate shot so no source pixel is stretched beyond `upscale` (lint A4). */
export function plateMaxZoom(m: Pick<AssetManifestT, "file">, layoutW: number, upscale = 1.25): number {
  const w = m.file?.w ?? 0;
  return w ? (w / layoutW) * upscale : Infinity;
}

/** The refused host a URL belongs to (policy refusedSourceHosts), or null. Ingest calls it BEFORE fetching. */
export function refusedHost(u: string, p: Pick<AssetPolicyT, "refusedSourceHosts">): string | null {
  const host = hostOf(u);
  return host && p.refusedSourceHosts.some((h) => host === h || host.endsWith(`.${h}`)) ? host : null;
}

function hostOf(u: string | undefined): string {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

/** Whether an asset may be used under a policy (lint A1, registry filter for search_assets). */
export function allowedBy(m: AssetManifestT, p: AssetPolicyT): { ok: boolean; why?: string } {
  const wd = p.ownerWithdrawn.find((w) => w.assetId === m.id);
  if (wd) return { ok: false, why: `withdrawn by the owner ${wd.decided}: ${wd.reason}` };
  if (!p.allowedClasses.includes(m.sourceClass)) return { ok: false, why: `source class ${m.sourceClass} not allowed at D1` };
  if (!p.allowedLicences.includes(m.licence.id)) return { ok: false, why: `licence ${m.licence.id} not allowed` };
  const host = hostOf(m.licence.sourceUrl);
  if (host && p.refusedSourceHosts.some((h) => host === h || host.endsWith(`.${h}`))) return { ok: false, why: `source host ${host} refused at D1` };
  const exc = D1_NAMED_EXCEPTION_IDS.includes(m.id) && p.provenanceExceptions.some((e) => e.assetId === m.id && e.provenance === m.provenance);
  if (!p.allowedProvenance.includes(m.provenance) && !exc) return { ok: false, why: `provenance ${m.provenance} not allowed` };
  if ((m.brandMarks.handling === "owner-allowed" || m.brandMarks.inFile.length) && !p.brandMarksAllowed) return { ok: false, why: "brand marks in the file are not allowed (D1 #2a: bake the mask)" };
  if (m.kind === "model3d" && !p.live3d) return { ok: false, why: "live 3D off" };
  if (m.tone && (m.tone.p99Luma > p.tone.maxP99Luma || m.tone.meanSat > p.tone.maxMeanSat)) return { ok: false, why: `tone p99 ${m.tone.p99Luma} / sat ${m.tone.meanSat} over the A6 limits` };
  return { ok: true };
}

/** "Photo: X, CC BY 4.0, via …" lines for every CC BY asset used (A12: they go in the post caption). */
export function captionCredits(ms: readonly AssetManifestT[]): string[] {
  return [...new Set(ms.filter((m) => m.licence.id === "CC-BY-4.0" && m.licence.attribution).map((m) => m.licence.attribution as string))];
}

export function parseAssetRef(ref: string): { id: string; version: number } | null {
  const m = ASSET_REF.exec(ref);
  return m ? { id: m[1], version: Number(m[2]) } : null;
}
