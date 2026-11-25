// v2 audio mixer (ADR-001 §7; port of research/audio/mixer-prototype.ts + research/proof/mixer.ts). One ffmpeg 5.1
// filter graph per reel, driven by the same resolveTimeline() that drives the visuals:
//
//   voice    per-beat mp3 at its timeline offset (TimelineBeat.audioStartMs, sample-exact adelay) → one bus, gained to
//            REF −16 LUFS (measured alone in a first pass);
//   bed      optional synthesised bed, looped/trimmed to the reel, at REF −18 LU, 0.5 s fade-in, 1.5 s fade-out that ends
//            at the CTA beat's audio end, sidechaincompress keyed by the voice (thr 0.06, ratio 1.5, 20/900 ms, see DUCK);
//   sfx      planSfx() placements via adelay, each at REF −8 + event gain (levels.json event loudness);
//   holes    silenceHole gates (8 ms ramps) on the bed and the SFX bus, never on the voice;
//   bus      amix normalize=0 → 4× oversampled alimiter at −4.5 dBFS → 48 kHz;
//   master   v1 2-pass linear loudnorm to −14 (src/audio/media.ts parsers/targets) → AAC 192k, exactly
//            durationF / fps seconds (sample-exact pad/trim at 48 kHz).
//
// Every resample is followed by an explicit aformat (ffmpeg 5.1 "Cannot select channel layout"). Graphs carry no paths.

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEbur128Summary, parseLoudnormJson, TARGET_I, TARGET_LRA, TARGET_TP } from "../media.js";
import type { Timeline } from "../../v2/timeline.js";
import { ffmpeg, type FfExec } from "./ffexec.js";
import { VOICE_REF_LUFS, type SfxPlan } from "./sfx.js";

export const SAMPLE_RATE = 48_000;
export const FMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
export const BED_REL_DB = -18;
export const BED_FADE_IN_MS = 500;
export const BED_FADE_OUT_MS = 1500;
export const BUS_LIMIT_DB = -4.5;
export const HOLE_RAMP_MS = 8;
/**
 * Sidechain duck. Soft and slow so the reduction holds across word gaps instead of pumping per word (W4 fix round 1):
 * measured on the three W3.3 r2 jobs (music stem vs unducked bed, 50 ms windows) median 4.5–4.6 dB during speech,
 * p90 per-second swing 5.3–5.6 dB, voice − music 22.2–22.5 LU. The old 0.05 / 2 / 15 / 350 ducked 6.6–6.9 dB with
 * a 9.4 dB p90 swing.
 */
export const DUCK = { threshold: 0.06, ratio: 1.5, attack: 20, release: 900 } as const;
/** Master acceptance (QA gates): |I − (−14)| ≤ 0.5 LU, TP ≤ −1.5 dBTP. */
export const MASTER_I_TOL = 0.5;
export const MASTER_TP_MAX = -1.5;

export interface Duck {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
}

export interface MixSpec {
  /** Exact output length in samples at 48 kHz (= durationF · 48000 / fps). */
  totalSamples: number;
  voice: { file: string; startMs: number }[];
  voiceGainDb: number;
  bed: { file: string; gainDb: number; fadeInMs: number; fadeOutStartMs: number; fadeOutMs: number } | null;
  duck: Duck;
  sfx: { id: string; file: string; startMs: number; volumeDb: number }[];
  holes: { startMs: number; endMs: number }[];
  busLimitDb: number;
  /** Also output the voice / music / sfx stems (post-gain, pre-bus-limiter) and the unducked bed (QA duck reference). */
  stems: boolean;
}

/** "bed" = the music bus before the sidechain duck (same gain, fades and hole gates): QA's duck-depth reference. */
export type StemName = "premix" | "voice" | "music" | "sfx" | "bed";
export interface MixGraph {
  /** ffmpeg input argv (-i … in input-index order; the bed is looped with -stream_loop -1). */
  inputs: string[];
  graph: string;
  outputs: { label: string; name: StemName }[];
}

const f3 = (v: number) => v.toFixed(3);
const f2 = (v: number) => v.toFixed(2);
const samples = (ms: number) => Math.max(0, Math.round((ms * SAMPLE_RATE) / 1000));

/** volume expression (eval=frame) that ramps to 0 inside each hole: 1 outside, 0 in [start, end], 8 ms linear ramps. */
export function holeGateExpr(holes: readonly { startMs: number; endMs: number }[], rampMs = HOLE_RAMP_MS): string {
  const r = (rampMs / 1000).toFixed(4);
  return holes.map((h) => `max(0,max(min((${(h.startMs / 1000).toFixed(4)}-t)/${r},1),min((t-${(h.endMs / 1000).toFixed(4)})/${r},1)))`).join("*");
}

/** Gate chain appended to a bus: 2 ms frames so `t` steps finely enough for the ramps. Empty when there are no holes. */
export function holeGate(holes: readonly { startMs: number; endMs: number }[]): string {
  if (!holes.length) return "";
  return `,asetnsamples=n=96:p=0,volume=volume='${holeGateExpr(holes)}':eval=frame`;
}

function padTrim(n: number): string {
  return `apad=whole_len=${n},atrim=end_sample=${n}`;
}

function voiceBus(spec: MixSpec, lines: string[], inputs: string[]): string {
  if (!spec.voice.length) throw new Error("mix: no voice beats");
  const labels: string[] = [];
  spec.voice.forEach((v, i) => {
    inputs.push("-i", v.file);
    lines.push(`[${i}:a]${FMT},adelay=delays=${samples(v.startMs)}S:all=1[v${i}]`);
    labels.push(`[v${i}]`);
  });
  const join = labels.length > 1 ? `${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,` : `${labels[0]}anull,`;
  return `${join}${padTrim(spec.totalSamples)},volume=${f2(spec.voiceGainDb)}dB`;
}

/** Voice bus alone → ebur128 (pass 0: measure the voice so it can be gained to REF). Map "[out]" to -f null. */
export function buildVoiceMeasureGraph(spec: MixSpec): MixGraph {
  const inputs: string[] = [];
  const lines: string[] = [];
  lines.push(`${voiceBus({ ...spec, voiceGainDb: 0 }, lines, inputs)},ebur128=peak=true[out]`);
  return { inputs, graph: lines.join(";\n"), outputs: [{ label: "[out]", name: "voice" }] };
}

export function buildMixGraph(spec: MixSpec): MixGraph {
  const inputs: string[] = [];
  const lines: string[] = [];
  const N = spec.totalSamples;
  const outputs: MixGraph["outputs"] = [{ label: "[mix]", name: "premix" }];
  const mixIn: string[] = [];

  // voice: mix copy (+ stem copy) (+ sidechain key)
  const vb = voiceBus(spec, lines, inputs);
  const vOuts = ["[vmix]", ...(spec.stems ? ["[vstem]"] : []), ...(spec.bed ? ["[vkey]"] : [])];
  lines.push(vOuts.length > 1 ? `${vb},asplit=${vOuts.length}${vOuts.join("")}` : `${vb}[vmix]`);
  mixIn.push("[vmix]");
  if (spec.stems) outputs.push({ label: "[vstem]", name: "voice" });
  let idx = spec.voice.length;

  // bed
  if (spec.bed) {
    const b = spec.bed;
    inputs.push("-stream_loop", "-1", "-i", b.file);
    const fadeOutSt = Math.max(0, b.fadeOutStartMs);
    lines.push(
      `[${idx}:a]${FMT},atrim=end_sample=${N},asetpts=PTS-STARTPTS,${padTrim(N)},volume=${f2(b.gainDb)}dB,` +
        `afade=t=in:st=0:d=${f3(b.fadeInMs / 1000)},afade=t=out:st=${f3(fadeOutSt / 1000)}:d=${f3(b.fadeOutMs / 1000)}${spec.stems ? ",asplit=2[bed][bedraw]" : "[bed]"}`,
    );
    if (spec.stems) lines.push(`[bedraw]anull${holeGate(spec.holes)}[bstem]`);
    const d = spec.duck;
    const mOuts = ["[mmix]", ...(spec.stems ? ["[mstem]"] : [])];
    const duck = `[bed][vkey]sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}:detection=rms:link=average${holeGate(spec.holes)}`;
    lines.push(mOuts.length > 1 ? `${duck},asplit=${mOuts.length}${mOuts.join("")}` : `${duck}[mmix]`);
    mixIn.push("[mmix]");
    if (spec.stems) outputs.push({ label: "[mstem]", name: "music" }, { label: "[bstem]", name: "bed" });
    idx++;
  }

  // sfx: one input per distinct file, asplit per use
  if (spec.sfx.length) {
    const uses = new Map<string, number[]>();
    spec.sfx.forEach((s, k) => uses.set(s.file, [...(uses.get(s.file) ?? []), k]));
    const labels: string[] = [];
    for (const [file, ks] of uses) {
      inputs.push("-i", file);
      const raws = ks.map((k) => `[s${k}raw]`);
      lines.push(`[${idx}:a]${FMT}${ks.length > 1 ? `,asplit=${ks.length}${raws.join("")}` : raws[0]}`);
      for (const k of ks) {
        const s = spec.sfx[k];
        lines.push(`[s${k}raw]volume=${f2(s.volumeDb)}dB,adelay=delays=${samples(s.startMs)}S:all=1[s${k}]`);
      }
      idx++;
    }
    spec.sfx.forEach((_, k) => labels.push(`[s${k}]`));
    const sOuts = ["[smix]", ...(spec.stems ? ["[sstem]"] : [])];
    const join = labels.length > 1 ? `${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,` : `${labels[0]}anull,`;
    const bus = `${join}${padTrim(N)}${holeGate(spec.holes)}`;
    lines.push(sOuts.length > 1 ? `${bus},asplit=${sOuts.length}${sOuts.join("")}` : `${bus}[smix]`);
    mixIn.push("[smix]");
    if (spec.stems) outputs.push({ label: "[sstem]", name: "sfx" });
  }

  // bus: amix (duration=first → the voice bus, already exactly N samples) → 4× oversampled limiter → 48 kHz, N samples
  const lim = Math.pow(10, spec.busLimitDb / 20).toFixed(4);
  const head = mixIn.length > 1 ? `${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first,` : `${mixIn[0]}anull,`;
  lines.push(`${head}aresample=192000,aformat=sample_fmts=fltp:channel_layouts=stereo,alimiter=limit=${lim}:level=false:attack=5:release=50,${FMT},${padTrim(N)}[mix]`);
  return { inputs, graph: lines.join(";\n"), outputs };
}

// ── master ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const LN = `I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`;

export function masterWithin(i: number, tp: number): boolean {
  return Math.abs(i - TARGET_I) <= MASTER_I_TOL && tp <= MASTER_TP_MAX;
}

/** Second-pass filter: v1's linear loudnorm (+ in a corrective round: gain and the −2 dBFS 4× limiter, ALWAYS — even at
 *  0 dB gain, so a master that is on loudness but over the true-peak ceiling gets limited, as v1 masterAudio does)
 *  → 48 kHz, N samples. */
export function masterFilter(measured: ReturnType<typeof parseLoudnormJson>, totalSamples: number, correctiveGainDb = 0, corrective = correctiveGainDb !== 0): string {
  const m = `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}`;
  const fix = corrective
    ? `,volume=${f2(correctiveGainDb)}dB,aresample=192000,aformat=sample_fmts=fltp:channel_layouts=stereo,alimiter=limit=${Math.pow(10, (TARGET_TP - 0.5) / 20).toFixed(4)}:level=false:attack=5:release=50`
    : "";
  return `loudnorm=${LN}:${m}:linear=true:print_format=summary${fix},${FMT},${padTrim(totalSamples)}`;
}

export interface MasterResult {
  integratedLufs: number;
  truePeakDbtp: number;
  lra?: number;
  pass1: { I: number; TP: number; LRA: number };
  correctiveGainDb: number;
  rounds: number;
}

/** premix WAV → AAC 192k m4a at −14 LUFS (v1 two-pass linear loudnorm, corrective rounds as in v1 masterAudio). */
export async function masterV2(x: FfExec, premix: string, outM4a: string, totalSamples: number, signal?: AbortSignal, log?: (s: string) => void): Promise<MasterResult> {
  const p1 = await ffmpeg(x, ["-i", premix, "-af", `loudnorm=${LN}:print_format=json`, "-f", "null", "-"], { signal });
  const m = parseLoudnormJson(p1.stderr);
  log?.(`loudnorm pass1: I=${m.input_i} TP=${m.input_tp} LRA=${m.input_lra}`);
  const tmp = outM4a.replace(/\.m4a$/, "") + ".tmp.m4a";
  const encode = (af: string) => ffmpeg(x, ["-y", "-i", premix, "-af", af, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-threads", "2", "-movflags", "+faststart", "-f", "mp4", tmp], { signal });
  const measure = async () => parseEbur128Summary((await ffmpeg(x, ["-i", tmp, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], { signal })).stderr);
  await encode(masterFilter(m, totalSamples));
  let res = await measure();
  log?.(`master: I=${res.integratedLufs} TP=${res.truePeakDbtp}`);
  let gain = 0;
  let rounds = 0;
  while (rounds < 2 && !masterWithin(res.integratedLufs, res.truePeakDbtp)) {
    rounds++;
    gain += TARGET_I - res.integratedLufs;
    log?.(`corrective pass ${rounds}: gain ${gain.toFixed(2)} dB`);
    await encode(masterFilter(m, totalSamples, gain, true));
    res = await measure();
    log?.(`master (corrected): I=${res.integratedLufs} TP=${res.truePeakDbtp}`);
  }
  await rename(tmp, outM4a);
  return { integratedLufs: res.integratedLufs, truePeakDbtp: res.truePeakDbtp, lra: res.lra, pass1: { I: Number(m.input_i), TP: Number(m.input_tp), LRA: Number(m.input_lra) }, correctiveGainDb: Math.round(gain * 100) / 100, rounds };
}

// ── whole reel ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type MixTimeline = Pick<Timeline, "fps" | "durationF" | "durationMs" | "beats">;

export interface MixReelOptions {
  exec: FfExec;
  timeline: MixTimeline;
  plan: Pick<SfxPlan, "placements" | "holes">;
  /** One file per timeline beat, same order as timeline.beats. */
  voiceFiles: string[];
  /** Bed WAV, or null for voice-only. */
  bedFile: string | null;
  /** Directory holding the SFX files named in the plan (levels.json `file`). */
  sfxDir: string;
  outDir: string;
  /** Keep voice/music/sfx/bed stems in <outDir>/stems/*.wav (and the premix). */
  stems?: boolean;
  signal?: AbortSignal;
  log?: (s: string) => void;
}

export interface MixResult {
  master: string;
  graphFile: string;
  stems: Partial<Record<StemName, string>>;
  totalSamples: number;
  durationSec: number;
  gains: { voiceRawLufs: number; voiceDb: number; bedLufs: number | null; bedDb: number | null };
  bed: { file: string; fadeOutStartMs: number; fadeOutMs: number } | null;
  masterResult: MasterResult;
  timingsMs: { voicePass: number; mixPass: number; master: number };
}

/** End of the CTA beat's audio (fade-out target): the last `cta` beat, else the last beat. */
export function ctaEndMs(tl: Pick<Timeline, "beats">): number {
  const cta = [...tl.beats].reverse().find((b) => b.part === "cta") ?? tl.beats[tl.beats.length - 1];
  return cta ? cta.audioEndMs : 0;
}

export function totalSamplesFor(tl: Pick<Timeline, "durationF" | "fps">): number {
  return Math.round((tl.durationF * SAMPLE_RATE) / tl.fps);
}

/** Build the MixSpec for a reel (pure). Gains are filled in by mixReel after measuring. */
export function mixSpecFor(o: Pick<MixReelOptions, "timeline" | "plan" | "voiceFiles" | "bedFile" | "sfxDir" | "stems">, gains: { voiceDb: number; bedDb: number | null }): MixSpec {
  const tl = o.timeline;
  if (o.voiceFiles.length !== tl.beats.length) throw new Error(`mix: ${o.voiceFiles.length} voice files for ${tl.beats.length} beats`);
  const end = ctaEndMs(tl);
  const fadeOutMs = Math.min(BED_FADE_OUT_MS, Math.max(100, end));
  return {
    totalSamples: totalSamplesFor(tl),
    voice: tl.beats.map((b, i) => ({ file: o.voiceFiles[i], startMs: b.audioStartMs })),
    voiceGainDb: gains.voiceDb,
    bed: o.bedFile && gains.bedDb !== null ? { file: o.bedFile, gainDb: gains.bedDb, fadeInMs: BED_FADE_IN_MS, fadeOutStartMs: end - fadeOutMs, fadeOutMs } : null,
    duck: { ...DUCK },
    sfx: o.plan.placements.map((p) => ({ id: p.id, file: path.join(o.sfxDir, p.file), startMs: p.startMs, volumeDb: p.volumeDb })),
    holes: o.plan.holes.map((h) => ({ startMs: h.startMs, endMs: h.endMs })),
    busLimitDb: BUS_LIMIT_DB,
    stems: !!o.stems,
  };
}

async function integrated(x: FfExec, file: string, signal?: AbortSignal): Promise<number> {
  const r = await ffmpeg(x, ["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { signal });
  return parseEbur128Summary(r.stderr).integratedLufs;
}

export async function mixReel(o: MixReelOptions): Promise<MixResult> {
  const x = o.exec;
  const log = o.log ?? (() => {});
  await mkdir(o.outDir, { recursive: true });
  const stemDir = path.join(o.outDir, "stems");
  if (o.stems) await mkdir(stemDir, { recursive: true });

  // pass 0: voice alone → gain to REF; bed integrated → REF + BED_REL_DB
  let t0 = Date.now();
  const spec0 = mixSpecFor(o, { voiceDb: 0, bedDb: o.bedFile ? 0 : null });
  const vg = buildVoiceMeasureGraph(spec0);
  const vgFile = path.join(o.outDir, "voice.graph.txt");
  await writeFile(vgFile, vg.graph);
  const vr = await ffmpeg(x, [...vg.inputs, "-filter_complex_script", vgFile, "-map", "[out]", "-f", "null", "-"], { signal: o.signal });
  await rm(vgFile, { force: true });
  const voiceRaw = parseEbur128Summary(vr.stderr).integratedLufs;
  if (!Number.isFinite(voiceRaw)) throw new Error(`mix: voice bus loudness is ${voiceRaw} (silent voice?)`);
  const voiceDb = VOICE_REF_LUFS - voiceRaw;
  const bedLufs = o.bedFile ? await integrated(x, o.bedFile, o.signal) : null;
  const bedDb = bedLufs !== null ? VOICE_REF_LUFS + BED_REL_DB - bedLufs : null;
  const voicePass = Date.now() - t0;
  log(`voice raw I=${voiceRaw} LUFS → ${voiceDb.toFixed(2)} dB; bed ${bedLufs ?? "none"} LUFS → ${bedDb?.toFixed(2) ?? "-"} dB`);

  // pass 1: the graph
  const spec = mixSpecFor(o, { voiceDb, bedDb });
  const g = buildMixGraph(spec);
  const graphFile = path.join(o.outDir, "mix.graph.txt");
  await writeFile(graphFile, g.graph + "\n");
  const files: Partial<Record<StemName, string>> = {};
  for (const out of g.outputs) files[out.name] = out.name === "premix" && !o.stems ? path.join(o.outDir, "premix.wav") : path.join(stemDir, `${out.name}.wav`);
  const outArgs = g.outputs.flatMap((out) => ["-map", out.label, "-c:a", "pcm_f32le", files[out.name]!]);
  t0 = Date.now();
  await ffmpeg(x, ["-y", ...g.inputs, "-filter_complex_script", graphFile, "-threads", "2", ...outArgs], { signal: o.signal });
  const mixPass = Date.now() - t0;
  log(`mix pass ${(mixPass / 1000).toFixed(1)} s`);

  // pass 2: master
  t0 = Date.now();
  const master = path.join(o.outDir, "master.m4a");
  const mr = await masterV2(x, files.premix!, master, spec.totalSamples, o.signal, log);
  const masterMs = Date.now() - t0;
  if (!o.stems) await rm(files.premix!, { force: true });
  const stems = { ...files };
  if (!o.stems) delete stems.premix;

  return {
    master,
    graphFile,
    stems,
    totalSamples: spec.totalSamples,
    durationSec: spec.totalSamples / SAMPLE_RATE,
    gains: { voiceRawLufs: voiceRaw, voiceDb: Math.round(voiceDb * 100) / 100, bedLufs, bedDb: bedDb === null ? null : Math.round(bedDb * 100) / 100 },
    bed: spec.bed ? { file: spec.bed.file, fadeOutStartMs: spec.bed.fadeOutStartMs, fadeOutMs: spec.bed.fadeOutMs } : null,
    masterResult: mr,
    timingsMs: { voicePass, mixPass, master: masterMs },
  };
}
