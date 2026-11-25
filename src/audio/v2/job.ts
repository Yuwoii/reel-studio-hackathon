// One v2 job → master.m4a + mix-report.json (+ stems). Glue between the job files (storyboard.json, words.json,
// audio/beat_NN.{mp3,json}), resolveTimeline(), planSfx(), mixReel() and runQa(). Used by scripts/v2/mix-dev.ts now
// and by the W6 produce step later (direct ffmpeg in the container).

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseStoryboard, WordsFile, type Storyboard, type WordsFileT } from "../../schema/storyboard.v2.js";
import { LIBRARY_LOOKUP } from "../../v2/library.js";
import { registrySfxLookup } from "../../v2/sfx-anchors.js";
import { resolveTimeline, type Timeline } from "../../v2/timeline.js";
import type { FfExec } from "./ffexec.js";
import { mixReel, type MixResult } from "./mix.js";
import { runQa, type QaReport } from "./qa.js";
import { planSfx, SOUND_SFX, type SfxLevels, type SfxPlan } from "./sfx.js";

/**
 * Legacy storyboard bed ids → manifest ids. The director prompt (src/director/v2/prompt.ts) and every W3.3 storyboard
 * say "dark-pulse"; the asset packet named the same R4 bed "dark-amin-100bpm-72s". Reported as `bedAlias` in the report.
 */
export const BED_ALIASES: Readonly<Record<string, string>> = { "dark-pulse": "dark-amin-100bpm-72s" };

export interface AudioManifest {
  default_bed: string;
  beds: { id: string; file: string; integrated_lufs?: number }[];
  sfx: { id: string; file: string }[];
  levels: { file: string };
}

export interface AudioAssets {
  /** assets/ root (audio-manifest.json lives here). */
  dir: string;
  manifest: AudioManifest;
  /** Directory of levels.json + the SFX files. */
  sfxDir: string;
  levels: SfxLevels;
}

export async function loadAudioAssets(dir: string): Promise<AudioAssets> {
  const manifest = (await readJson(path.join(dir, "audio-manifest.json"))) as AudioManifest;
  if (!manifest?.beds?.length || !manifest.levels?.file) throw new Error(`${dir}/audio-manifest.json: no beds / levels`);
  const sfxDir = path.dirname(path.join(dir, manifest.levels.file));
  return { dir, manifest, sfxDir, levels: await loadLevels(sfxDir) };
}

/** Bed id (after aliasing) → absolute WAV path, via the manifest. */
export function bedFile(assets: Pick<AudioAssets, "dir" | "manifest">, id: string): { id: string; file: string; alias: string | null } {
  const real = BED_ALIASES[id] ?? id;
  const b = assets.manifest.beds.find((x) => x.id === real);
  if (!b) throw new Error(`unknown bed "${id}" (manifest: ${assets.manifest.beds.map((x) => x.id).join(", ")})`);
  return { id: real, file: path.join(assets.dir, b.file), alias: real !== id ? id : null };
}

export interface MixJobOptions {
  exec: FfExec;
  jobDir: string;
  outDir: string;
  /** assets/ root with audio-manifest.json (production: /app/assets). */
  assetsDir: string;
  /** "default" = the storyboard's music.bed (null → voice-only); "none" = voice-only; "manifest" = the manifest's
   *  default bed; else a bed id. */
  bed?: string;
  /** Keep stems/*.wav (voice, music, sfx, premix). QA always measures stems; without this they are deleted after. */
  keepStems?: boolean;
  /** Density fill with derived SFX (default true). */
  fill?: boolean;
  signal?: AbortSignal;
  log?: (s: string) => void;
}

export interface MixJobReport {
  slug: string;
  jobDir: string;
  bed: string | null;
  /** Storyboard bed id that was mapped through BED_ALIASES, if any. */
  bedAlias: string | null;
  durationF: number;
  fps: number;
  durationSec: number;
  timingSource: string;
  timelineIssues: Timeline["issues"];
  voice: { beat: string; file: string; startMs: number; durationMs: number }[];
  sfx: SfxPlan;
  mix: Omit<MixResult, "stems"> & { stems: string[] };
  qa: QaReport;
}

export async function loadLevels(dir: string): Promise<SfxLevels> {
  const j = JSON.parse(await readFile(path.join(dir, "levels.json"), "utf8")) as Partial<SfxLevels>;
  for (const t of SOUND_SFX) {
    const l = j[t];
    if (!l || typeof l.file !== "string" || !Number.isFinite(l.event_lufs_mmax)) throw new Error(`levels.json: missing/invalid entry for "${t}"`);
    if (!existsSync(path.join(dir, l.file))) throw new Error(`levels.json: ${t} file ${l.file} not found in ${dir}`);
  }
  return j as SfxLevels;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

/** storyboard.json + words.json of a job dir → parsed storyboard, words and the resolved timeline. */
export async function loadJobTimeline(jobDir: string): Promise<{ sb: Storyboard; words: WordsFileT; tl: Timeline }> {
  const parsed = parseStoryboard(await readJson(path.join(jobDir, "storyboard.json")));
  if (!parsed.ok || !parsed.value) throw new Error(`storyboard.json invalid: ${parsed.errors.slice(0, 3).join("; ")}`);
  const wf = path.join(jobDir, "words.json");
  const wp = WordsFile.safeParse(await readJson(existsSync(wf) ? wf : path.join(jobDir, "audio", "words.json")));
  if (!wp.success) throw new Error(`words.json invalid: ${wp.error.issues[0]?.message}`);
  const tl = resolveTimeline(parsed.value, wp.data, LIBRARY_LOOKUP);
  return { sb: parsed.value, words: wp.data, tl };
}

/** audio/beat_NN.mp3 per timeline beat; the beat_NN.json sidecar's durationSec must match words.json (stale-cache guard). */
export async function voiceFilesFor(jobDir: string, tl: Timeline): Promise<string[]> {
  const out: string[] = [];
  for (const b of tl.beats) {
    if (b.estimated) throw new Error(`${b.id}: no words.json timing (estimated) — synthesise TTS first`);
    const n = b.id.replace(/^b/, "");
    const mp3 = path.join(jobDir, "audio", `beat_${n}.mp3`);
    if (!existsSync(mp3)) throw new Error(`${b.id}: ${mp3} missing`);
    const side = path.join(jobDir, "audio", `beat_${n}.json`);
    if (existsSync(side)) {
      const d = Number(((await readJson(side)) as { durationSec?: unknown }).durationSec);
      if (Number.isFinite(d) && Math.abs(d * 1000 - b.durationMs) > 5) throw new Error(`${b.id}: ${side} durationSec ${d} ≠ words.json ${b.durationMs / 1000} (stale audio cache)`);
    }
    out.push(mp3);
  }
  return out;
}

/** --bed choice + storyboard → bed id (unaliased) or null for voice-only. */
export function resolveBed(choice: string | undefined, sb: Pick<Storyboard, "music">, manifest: Pick<AudioManifest, "default_bed">): string | null {
  const c = (choice ?? "default").trim();
  if (c === "none") return null;
  if (c === "manifest") return manifest.default_bed;
  return c === "default" ? sb.music.bed : c;
}

export async function mixJob(o: MixJobOptions): Promise<MixJobReport> {
  const log = o.log ?? (() => {});
  const { sb, tl } = await loadJobTimeline(o.jobDir);
  const voiceFiles = await voiceFilesFor(o.jobDir, tl);
  const assets = await loadAudioAssets(o.assetsDir);
  const want = resolveBed(o.bed, sb, assets.manifest);
  const bed = want === null ? null : bedFile(assets, want);
  if (bed && !existsSync(bed.file)) throw new Error(`bed ${bed.id}: ${bed.file} not found`);
  if (bed?.alias) log(`bed "${bed.alias}" → "${bed.id}" (alias)`);

  const plan = planSfx(tl, { levels: assets.levels, fill: o.fill ?? true, actionSfx: registrySfxLookup(sb.world) });
  log(`sfx: kept ${plan.report.kept} (${plan.report.keptDerived} derived), dropped ${plan.report.dropped}, ${plan.report.per10s}/10 s, holes ${plan.report.holes}`);

  const mix = await mixReel({ exec: o.exec, timeline: tl, plan, voiceFiles, bedFile: bed?.file ?? null, sfxDir: assets.sfxDir, outDir: o.outDir, stems: true, signal: o.signal, log });
  const qa = await runQa({ exec: o.exec, master: mix.master, stems: mix.stems, timeline: tl, placements: plan.placements, sfxDir: assets.sfxDir, workDir: o.outDir, signal: o.signal });

  if (!o.keepStems) {
    await rm(path.join(o.outDir, "stems"), { recursive: true, force: true });
  }
  const report: MixJobReport = {
    slug: path.basename(o.jobDir),
    jobDir: o.jobDir,
    bed: bed?.id ?? null,
    bedAlias: bed?.alias ?? null,
    durationF: tl.durationF,
    fps: tl.fps,
    durationSec: tl.durationF / tl.fps,
    timingSource: tl.timingSource,
    timelineIssues: tl.issues,
    voice: tl.beats.map((b, i) => ({ beat: b.id, file: path.relative(o.jobDir, voiceFiles[i]), startMs: b.audioStartMs, durationMs: b.durationMs })),
    sfx: plan,
    mix: { ...mix, stems: o.keepStems ? Object.values(mix.stems).map((f) => path.relative(o.outDir, f!)) : [] },
    qa,
  };
  await writeFile(path.join(o.outDir, "mix-report.json"), JSON.stringify(report, null, 1) + "\n");
  return report;
}
