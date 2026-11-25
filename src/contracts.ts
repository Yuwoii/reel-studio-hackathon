// Module seams. Each phase-1 builder implements one of these; the pipeline (src/pipeline/) wires them together.
// Keep implementations behind these signatures so the bot can be tested with fakes.

import type { BeatAudio, ReelProps, Config, Script } from "./schema/index.js";

// ── Paths (inside the container; host paths in parentheses) ────────────────────────────────────────────────────
// /app/data   (~/reel-studio/data)   bot state: state.json, usage.json, claude/ (SDK transcripts)
// /app/jobs   (~/reel-studio/jobs)   one dir per job: jobs/<jobId>/{prompt.txt,script.json,config.json,audio/,render/,stills/,preview.mp4,status.json}
// /app/out    (~/reel-studio/out)    finals: out/<slug>.mp4, out/<slug>_script.md
// /studio     (~/instagram/spool/studio) studio drops for ig-media: rs-<YYYYMMDD>-<slug>/{01.mp4,cover.jpg,caption.txt,.origin.json,READY}

export type Progress = (stage: string, detail?: string, fraction?: number) => void;

// ── Audio (src/audio/) ─────────────────────────────────────────────────────────────────────────────────────────
export interface TtsResult {
  /** Local mp3 per beat (jobDir/audio/beat_XX.mp3) + exact duration + word timings (relative to beat start). */
  beats: Array<{ beatId: number; file: string; durationSec: number; words: BeatAudio["words"] }>;
  /** "edge-tts" | "elevenlabs" | "whisper-aligned" — how word timings were obtained. */
  timingSource: string;
}
export interface AudioModule {
  synthesize(script: Script, jobDir: string, onProgress?: Progress, signal?: AbortSignal): Promise<TtsResult>;
  /** Two-pass loudnorm to −14 LUFS / −1.5 dBTP, keep video stream (copy), AAC 192k 48 kHz → outFile. */
  masterAudio(inMp4: string, outMp4: string, signal?: AbortSignal): Promise<void>;
  /** 720×1280 H.264 + AAC preview strictly < maxBytes (default 9 MB), retrying with lower bitrate. */
  makePreview(inMp4: string, outMp4: string, maxBytes?: number, signal?: AbortSignal): Promise<{ bytes: number }>;
  /** JPEG stills at the given seconds (default: 1.5 s, middle, end−1 s) → files. */
  extractStills(inMp4: string, outDir: string, atSec?: number[]): Promise<Array<{ file: string; atSec: number }>>;
  /** ffprobe + ebur128 + silencedetect report for acceptance + the thread summary. */
  measure(mp4: string): Promise<MediaReport>;
}
export interface MediaReport {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  videoCodec: string;
  audioCodec: string;
  integratedLufs: number;
  truePeakDbtp: number;
  /** silences longer than 0.7 s at −40 dB */
  silenceGaps: Array<{ startSec: number; endSec: number }>;
  bytes: number;
}

// ── Render (src/render/) ───────────────────────────────────────────────────────────────────────────────────────
export interface RenderResult {
  /** Local path of the rendered (un-mastered) MP4. */
  file: string;
  backend: "lambda" | "local";
  renderSec: number;
  /** Lambda only: Remotion's cost estimate in USD + billed GB-seconds if available. */
  costUsd?: number;
  gbSeconds?: number;
  lambdasInvoked?: number;
}
export interface RenderModule {
  /** Upload local beat audio so the renderer can fetch it; returns BeatAudio with fetchable URLs. */
  stageAudio(jobId: string, tts: TtsResult): Promise<BeatAudio[]>;
  render(jobId: string, props: ReelProps, outFile: string, onProgress?: Progress, signal?: AbortSignal): Promise<RenderResult>;
}

// ── Director (src/director/) ───────────────────────────────────────────────────────────────────────────────────
export interface DirectorDraft {
  script: Script;
  config: Config;
  /** Short notes for the thread (substitutions, research caveats). */
  notes: string[];
  turnsUsed: number;
  costUsd?: number;
  sessionId?: string;
}
export interface SelfCheckResult {
  ok: boolean;
  /** If !ok: a revised script/config to re-render (max 2 fix rounds, enforced by the pipeline). */
  revised?: { script: Script; config: Config };
  issues: string[];
}
export interface DirectorModule {
  /** First draft from the owner's prompt (untrusted → wrapped in <reel_prompt>). */
  draft(jobId: string, prompt: string, signal?: AbortSignal): Promise<DirectorDraft>;
  /** Revise after owner feedback (✏️ Edit → owner reply; untrusted → <owner_feedback>). Resumes the same session. */
  revise(jobId: string, feedback: string, signal?: AbortSignal): Promise<DirectorDraft>;
  /** Look at start/mid/end stills (view_stills tool) and decide whether to fix. */
  selfCheck(jobId: string, stills: string[], signal?: AbortSignal): Promise<SelfCheckResult>;
}

// ── Studio drop (src/pipeline/studioDrop.ts) — written from the 📤 button handler, no LLM ─────────────────────
export const STUDIO_FOLDER_RE = /^rs-\d{8}-[a-z0-9-]{3,60}$/;
export interface StudioOrigin {
  v: 1;
  kind: "studio";
  slug: string;
  jobId: string;
  guildId: string;
  channelId: string; // #reels
  threadId: string;
  messageId: string; // result message in the #reels thread
  createdAt: string;
}
