// Reel Studio, hackathon edition: ONE command, topic in, vertical explainer reel out. No Discord, no AWS, no servers.
//
//   npm run reel -- make  "how do noise-cancelling headphones work"            (director → voice → render → mix)
//   npm run reel -- make  "how does an mRNA vaccine work" --slug mrna --fps 30
//   npm run reel -- draft "<topic>" [--slug s]          director only (script + voice + storyboard), no video
//   npm run reel -- render <slug>                       render a saved draft → out/<slug>.mp4
//   npm run reel -- revise <slug> "make the hook punchier, drop the analogy"   resume the director, then re-render
//   npm run reel -- status <slug>                       what the director saved (stage, script, badges)
//
// Flags: --slug <a-z0-9->  --fps 30|60 (default 30: laptop CPU)  --max-turns <n> (default 80)
//        --no-frame-check  (skip the local frame self-check: faster, no vision judge)  --no-render (make = draft only)
//
// Everything lands in out/: out/jobs/<slug>/ (director files, voice, render/), out/<slug>.mp4 (final),
// out/<slug>.preview.mp4 (< 9 MB), out/<slug>.contact-sheet.png. Claude auth: see src/auth.ts (token, API key /
// Bedrock / Vertex env, or simply the Claude Code login of this user account).

import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyModelOverrides, authMode } from "../src/auth.js";
applyModelOverrides();

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "out");
const JOBS = path.join(OUT, "jobs");
const DATA = path.join(OUT, ".data");
process.chdir(ROOT); // the director resolves assets + the example board relative to the repo root

// ── args ────────────────────────────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith("--") && ["slug", "fps", "max-turns"].includes(a.slice(2))) (flags.set(a.slice(2), v), i++);
    else flags.set(a.slice(2), true);
  } else pos.push(a);
}
const cmd = pos[0];
const USAGE = `usage:
  npm run reel -- make   "<topic>" [--slug s] [--fps 30|60] [--no-frame-check] [--no-render]
  npm run reel -- draft  "<topic>" [--slug s]
  npm run reel -- render <slug> [--fps 30|60]
  npm run reel -- revise <slug> "<feedback>" [--no-render]
  npm run reel -- status <slug>`;

const slugify = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").filter((w) => !["how", "does", "do", "a", "an", "the", "what", "is", "are", "work", "works"].includes(w)).slice(0, 5).join("-") || "reel";
const checkSlug = (s: string) => {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(s)) throw new Error(`bad slug "${s}" (a-z, 0-9, -; 2–41 chars)`);
  return s;
};
const fps = (() => {
  const v = String(flags.get("fps") ?? process.env.REEL_V3_OUTPUT_FPS ?? "30");
  if (v !== "30" && v !== "60") throw new Error(`--fps must be 30 or 60 (got ${v})`);
  return Number(v) as 30 | 60;
})();

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`;
const say = (s: string) => console.log(`${stamp()}  ${s}`);
const quiet = (s: string) => {
  // the director logs a lot; show the interesting lines, keep the rest in out/jobs/<slug>/reel.log
  if (/tool_use|refus|error|badge|saved|judge.*(pass|fail)|frame check|fact.?check|synth|turn cap/i.test(s)) console.log(`${stamp()}    · ${s.slice(0, 220)}`);
};

// ── local Remotion (bundle once per process, render stills + media on this machine) ────────────────────────────────

let bundleP: Promise<string> | null = null;
function localBundle(): Promise<string> {
  bundleP ??= (async () => {
    say("bundling the Remotion project (first time ~1 min)…");
    const { bundle } = await import("@remotion/bundler");
    const dir = await bundle({ entryPoint: path.join(ROOT, "remotion/v3/index.ts"), publicDir: path.join(ROOT, "public"), outDir: path.join(DATA, "bundle") });
    say("bundle ready");
    return dir;
  })();
  return bundleP;
}

const concurrency = () => Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));

async function localStillRenderer(req: { serveUrl: string; composition: string; inputProps: Record<string, unknown>; frame: number; outFile: string; signal?: AbortSignal }) {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const composition = await selectComposition({ serveUrl: req.serveUrl, id: req.composition, inputProps: req.inputProps, logLevel: "error" });
  await renderStill({ serveUrl: req.serveUrl, composition, inputProps: req.inputProps, frame: req.frame, output: req.outFile, imageFormat: "jpeg", jpegQuality: 90, logLevel: "error", timeoutInMilliseconds: 120_000 });
  return { costUsd: 0 };
}

async function localMediaRenderer(req: { serveUrl: string; composition: string; inputProps: Record<string, unknown>; outFile: string; onProgress?: (f: number, d: string) => void; signal?: AbortSignal; timeoutMs?: number }) {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const t = Date.now();
  const composition = await selectComposition({ serveUrl: req.serveUrl, id: req.composition, inputProps: req.inputProps, logLevel: "error" });
  let last = -1;
  await renderMedia({
    serveUrl: req.serveUrl, composition, inputProps: req.inputProps, outputLocation: req.outFile,
    codec: "h264", crf: 14, x264Preset: "medium", colorSpace: "bt709", imageFormat: "jpeg", jpegQuality: 90, muted: true,
    concurrency: concurrency(), timeoutInMilliseconds: req.timeoutMs ?? 120_000, logLevel: "error",
    onProgress: ({ progress, renderedFrames }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= last + 10) {
        last = pct;
        say(`  render ${pct}% (${renderedFrames} frames)`);
      }
    },
  });
  return { costUsd: 0, renderSec: (Date.now() - t) / 1000 };
}

// ── director ────────────────────────────────────────────────────────────────────────────────────────────────────

async function director(slug: string, logLines: string[]) {
  const { createDirectorV3 } = await import("../src/director/v3/index.js");
  const noFrames = flags.has("no-frame-check");
  let frames: { render: unknown; unavailable?: string };
  if (noFrames) frames = { render: null, unavailable: "--no-frame-check" };
  else {
    const { runStillBatch } = await import("../src/v2/ops/stills.js");
    frames = {
      render: async (r: { jobId: string; inputProps: Record<string, unknown>; frames: number[]; outDir: string; name: string; propsInfo?: Record<string, unknown>; log?: (s: string) => void; signal?: AbortSignal }) => {
        const serveUrl = await localBundle();
        const b = await runStillBatch({
          serveUrl, site: "local", composition: "ExplainerV3", inputProps: r.inputProps, frames: r.frames, tag: `local-frames-${slug}`, tagCapUsd: 1e9, globalCapUsd: null,
          outDir: r.outDir, name: r.name, propsInfo: r.propsInfo as never, parallel: 2, renderImpl: localStillRenderer, ledgerFile: path.join(DATA, "ledger.jsonl"), log: r.log, signal: r.signal,
        } as never);
        return { stills: b.stills.map((s) => ({ frame: s.frame, file: s.file, usd: 0 })), failed: b.failed.map((f) => ({ frame: f.frame, error: f.error, usd: 0 })), spentUsd: 0 };
      },
    };
  }
  const log = (l: string) => {
    logLines.push(`${new Date().toISOString().slice(11, 19)} ${l}`);
    quiet(l);
  };
  return createDirectorV3({
    jobsDir: JOBS,
    dataDir: DATA,
    log,
    frames: frames as never,
    // notional $ cap per job (subscription logins report a notional cost too); generous for a hackathon
    maxUsdPerJob: Number(process.env.REEL_V3_MAX_USD_PER_JOB ?? 15),
    ...(flags.get("max-turns") ? { maxTurnsPerJob: Number(flags.get("max-turns")) } : {}),
  });
}

async function writeLog(slug: string, lines: string[]) {
  const { appendFile } = await import("node:fs/promises");
  await mkdir(path.join(JOBS, slug), { recursive: true });
  await appendFile(path.join(JOBS, slug, "reel.log"), lines.join("\n") + "\n");
}

function summarize(r: { saved: boolean; stage: string; badges: string[]; turns: number; wallSec: number; lastErrors: string[]; text?: string }) {
  say(`director: ${r.saved ? "SAVED ✔" : `NOT saved (stage ${r.stage})`} — ${r.turns} turns, ${Math.round(r.wallSec)} s`);
  if (r.badges.length) console.log(`        red badges (quality warnings, the reel still renders):\n${r.badges.map((b) => `          - ${b.slice(0, 200)}`).join("\n")}`);
  if (!r.saved && r.lastErrors.length) console.log(`        last errors:\n${r.lastErrors.slice(0, 5).map((e) => `          - ${e.slice(0, 300)}`).join("\n")}`);
}

async function draft(topic: string, slug: string) {
  const dir = path.join(JOBS, slug);
  if (existsSync(path.join(dir, "director-v3.json"))) throw new Error(`out/jobs/${slug} already exists — pick another --slug, use "revise ${slug}", or delete that folder`);
  say(`director: "${topic}" → out/jobs/${slug}  (auth: ${authMode()})`);
  say("research → script → fact check + judges → voice → storyboard → board judges → frame check (typically 10–25 min)");
  const lines: string[] = [];
  const d = await director(slug, lines);
  try {
    const r = await d.draft(slug, topic);
    summarize(r);
    return r.saved;
  } finally {
    await writeLog(slug, lines);
  }
}

async function revise(slug: string, feedback: string) {
  if (!existsSync(path.join(JOBS, slug, "director-v3.json"))) throw new Error(`no saved job out/jobs/${slug}`);
  const lines: string[] = [];
  const d = await director(slug, lines);
  const rev = (d as unknown as { revise?: (id: string, fb: string) => Promise<Parameters<typeof summarize>[0]> }).revise;
  if (!rev) throw new Error("this director has no revise()");
  say(`revise ${slug}: "${feedback.slice(0, 120)}"`);
  try {
    const r = await rev(slug, feedback);
    summarize(r);
    return r.saved;
  } finally {
    await writeLog(slug, lines);
  }
}

// ── render ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function render(slug: string) {
  const { planJobV3, renderMediaV3, mixAndMuxV3, resynthVoiceV3, sameBytes } = await import("../src/pipeline/v3/render.js");
  const { directExec } = await import("../src/audio/v2/ffexec.js");
  const jobDir = path.join(JOBS, slug);
  let { plan, narrative, sb, words } = await planJobV3({ jobDir, outputFps: fps });
  say(`render ${slug}: ${plan.board.beats} beats, ${plan.durationSec.toFixed(1)} s → ${plan.outputFrames} frames @ ${fps} fps on ${concurrency()} threads`);
  if (plan.badges.length) say(`(${plan.badges.length} red badge(s) on this draft — rendering anyway)`);
  if (plan.words.source !== "job") {
    say(`voice: re-synthesising (${plan.words.reason})`);
    await resynthVoiceV3(plan, narrative, { log: quiet });
    ({ plan, narrative, sb, words } = await planJobV3({ jobDir, resynth: true, outputFps: fps }));
  }
  const serveUrl = await localBundle();
  const video = path.join(plan.renderDir, "video.mp4");
  await renderMediaV3({
    plan, site: "local", serveUrl, tag: `local-render-${slug}`, tagCapUsd: 1e9, globalCapUsd: null, monthlyCapUsd: 1e9,
    inputProps: { storyboard: sb, words, blur: true, debug: false }, outFile: video, renderImpl: localMediaRenderer as never,
    ledgerFile: path.join(DATA, "ledger.jsonl"), root: ROOT, log: quiet,
  });
  if (!sameBytes(plan)) throw new Error("the board or words changed during the render — run render again");
  say("mix: music bed + SFX + voice → −14 LUFS master → mux");
  const m = await mixAndMuxV3({ plan, sb, words, video, exec: directExec({ ffmpeg: process.env.REEL_FFMPEG ?? "ffmpeg", ffprobe: process.env.REEL_FFPROBE ?? "ffprobe" }), assetsDir: path.join(ROOT, "assets"), log: quiet });
  if (!m.qa.ready) say(`audio QA warnings: ${m.qa.failed.map((g) => g.id).join(", ")} (the file is fine to watch)`);
  const final = path.join(OUT, `${slug}.mp4`);
  await copyFile(m.finalMp4, final);
  await copyFile(m.previewFile, path.join(OUT, `${slug}.preview.mp4`));
  await copyFile(m.contactSheet, path.join(OUT, `${slug}.contact-sheet.png`));
  say(`DONE → out/${slug}.mp4  (${m.durationSec.toFixed(1)} s; also out/${slug}.preview.mp4 and out/${slug}.contact-sheet.png)`);
}

async function status(slug: string) {
  const dir = path.join(JOBS, slug);
  const j = (f: string) => {
    try {
      return JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    } catch {
      return null;
    }
  };
  const st = j("director-v3.json");
  if (!st) throw new Error(`no job out/jobs/${slug}`);
  const n = j("narrative.v3.json");
  console.log(`job ${slug}: stage ${st.stage}, turns ${st.turnsUsed}, badges ${st.badges?.length ?? 0}`);
  if (n?.title) console.log(`title: ${n.title}`);
  for (const l of n?.lines ?? []) console.log(`  ${l.id} [${l.act}] ${l.text}`);
  for (const b of st.badges ?? []) console.log(`  ⚠ ${b}`);
  const final = path.join(OUT, `${slug}.mp4`);
  console.log(existsSync(final) ? `video: out/${slug}.mp4` : `no video yet: npm run reel -- render ${slug}`);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(DATA, { recursive: true });
  if (cmd === "make" || cmd === "draft") {
    const topic = pos.slice(1).join(" ").trim();
    if (!topic) throw new Error(USAGE);
    const slug = checkSlug(String(flags.get("slug") ?? slugify(topic)));
    const ok = await draft(topic, slug);
    if (!ok) {
      process.exitCode = 1;
      say(`the director did not save a storyboard. Look at out/jobs/${slug}/reel.log, then try: npm run reel -- revise ${slug} "<what to fix>"`);
      return;
    }
    if (cmd === "make" && !flags.has("no-render")) await render(slug);
    else say(`draft saved. Review: npm run reel -- status ${slug}   Render: npm run reel -- render ${slug}`);
  } else if (cmd === "render") {
    await render(checkSlug(pos[1] ?? ""));
  } else if (cmd === "revise") {
    const slug = checkSlug(pos[1] ?? "");
    const fb = pos.slice(2).join(" ").trim();
    if (!fb) throw new Error(USAGE);
    const ok = await revise(slug, fb);
    if (ok && !flags.has("no-render")) await render(slug);
  } else if (cmd === "status") {
    await status(checkSlug(pos[1] ?? ""));
  } else {
    console.log(USAGE);
    process.exitCode = cmd ? 2 : 0;
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);

