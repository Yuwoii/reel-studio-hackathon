// Child process for the LOCAL render fallback (spawned by local.ts under `nice -n 19`, so webpack, Chrome and
// ffmpeg all inherit the lowest CPU priority). Bundles remotion/index.ts with the job's public dir, renders the
// Reel composition with concurrency 2 and reports progress as JSON lines on stdout:
//   {"type":"progress","fraction":0.37}   {"type":"done"}   (errors → stderr + exit 1)
// argv[2] = path to a JSON job file {entry, publicDir, propsFile, outFile, concurrency, ffmpegThreads?}.
// SIGTERM/SIGINT (abort from local.ts) → cancel renderMedia via its cancelSignal (stops ffmpeg + frame capture),
// close Chrome in `finally`, exit 130. local.ts escalates to SIGKILL on the whole process group after a grace period.

import { readFileSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, openBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { COMPOSITION_ID } from "../schema/index.js";

interface WorkerJob {
  entry: string;
  publicDir: string;
  propsFile: string;
  outFile: string;
  concurrency: number;
}

const emit = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify(o) + "\n");

const { cancelSignal, cancel } = makeCancelSignal();
let cancelled = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (cancelled) return;
    cancelled = true;
    cancel();
    // Bundling / browser start are not cancellable — if we are not inside renderMedia, just leave.
    setTimeout(() => process.exit(130), 10_000).unref();
  });
}

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as WorkerJob;
  const inputProps = JSON.parse(readFileSync(job.propsFile, "utf8")) as Record<string, unknown>;
  emit({ type: "stage", stage: "bundle" });
  const serveUrl = await bundle({ entryPoint: job.entry, publicDir: job.publicDir });
  if (cancelled) process.exit(130);
  const browser = await openBrowser("chrome", { chromiumOptions: { gl: "swangle" } });
  try {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser });
    let lastPct = -1;
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      imageFormat: "jpeg",
      jpegQuality: 85,
      concurrency: job.concurrency,
      outputLocation: job.outFile,
      puppeteerInstance: browser,
      cancelSignal,
      chromiumOptions: { gl: "swangle" },
      timeoutInMilliseconds: 120_000,
      logLevel: "warn",
      onProgress: (p) => {
        const pct = Math.floor(p.progress * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          emit({ type: "progress", fraction: p.progress });
        }
      },
    });
  } finally {
    await browser.close({ silent: true });
  }
  emit({ type: "done" });
}

main().catch((e) => {
  if (cancelled) process.exit(130);
  process.stderr.write(`${(e as Error)?.stack ?? e}\n`);
  process.exit(1);
});
