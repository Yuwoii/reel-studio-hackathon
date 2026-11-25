// Pre-flight: is this machine ready to make a reel? Every check prints ✔ / ✖ with the fix. Exit 1 if any ✖.
//   npm run doctor            (all checks, incl. one tiny Claude call and one 1-second voice synth)
//   npm run doctor -- --quick (no network calls)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyModelOverrides, authEnv, authMode, defaultToken } from "../src/auth.js";
applyModelOverrides();

const ROOT = path.resolve(import.meta.dirname, "..");
process.chdir(ROOT);
const quick = process.argv.includes("--quick");
let bad = 0;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const no = (s: string, fix: string) => (bad++, console.log(`  ✖ ${s}\n      fix: ${fix}`));
const sh = (cmd: string, args: string[], input?: string) => spawnSync(cmd, args, { encoding: "utf8", input, timeout: 120_000 });

console.log("Reel Studio doctor");
const nodeMajor = Number(process.versions.node.split(".")[0]);
nodeMajor >= 22 ? ok(`node ${process.versions.node}`) : no(`node ${process.versions.node}`, "install Node 22+");
os.platform() === "win32" ? no("native Windows", "run inside WSL2 (Ubuntu) — the voice + render scripts expect a POSIX shell") : ok(`platform ${os.platform()} ${os.arch()}, ${os.cpus().length} CPUs, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM`);

const ff = process.env.REEL_FFMPEG ?? "ffmpeg";
const v = sh(ff, ["-hide_banner", "-version"]);
if (v.status !== 0) no("ffmpeg not found", "macOS: brew install ffmpeg | Ubuntu: sudo apt install ffmpeg");
else {
  ok(v.stdout.split("\n")[0]);
  const f = sh(ff, ["-hide_banner", "-filters"]).stdout;
  const miss = ["ebur128", "loudnorm", "alimiter", "sidechaincompress", "amix", "apad", "silencedetect"].filter((x) => !new RegExp(`\\b${x}\\b`).test(f));
  miss.length ? no(`ffmpeg lacks filters: ${miss.join(", ")}`, "install a full ffmpeg build (brew / apt ffmpeg are fine)") : ok("ffmpeg audio filters present");
}
sh(process.env.REEL_FFPROBE ?? "ffprobe", ["-version"]).status === 0 ? ok("ffprobe") : no("ffprobe not found", "comes with ffmpeg");

const py = process.env.REEL_PYTHON ?? path.join(ROOT, ".venv", "bin", "python");
const e = sh(py, ["-c", "import edge_tts; print(edge_tts.__version__)"]);
e.status === 0 ? ok(`edge-tts ${e.stdout.trim()} (${path.relative(ROOT, py) || py})`) : no("edge-tts venv missing", "./setup.sh  (or: python3 -m venv .venv && .venv/bin/pip install edge-tts==7.3.1)");

const chrome = path.join(ROOT, "node_modules", ".remotion", "chrome-headless-shell");
existsSync(chrome) ? ok("Remotion chrome-headless-shell") : no("Remotion browser not downloaded", "npx remotion browser ensure");
existsSync(path.join(ROOT, "node_modules", "@anthropic-ai", "claude-agent-sdk")) ? ok("Claude Agent SDK installed") : no("node_modules missing", "npm ci");

const mode = authMode();
const desc = { "oauth-token": "CLAUDE_CODE_OAUTH_TOKEN (subscription token)", "provider-env": "API key / Bedrock / Vertex env vars", "claude-login": "this user's Claude Code login (~/.claude or keychain)" }[mode];
console.log(`  · Claude auth: ${desc}`);

if (!quick) {
  // one real Claude call through the same SDK + env path the director uses
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-doctor-"));
    const model = process.env.REEL_V3_MODEL?.trim() || process.env.REEL_MODEL?.trim() || "claude-sonnet-5-5";
    let text = "";
    let err = "";
    for await (const m of query({
      prompt: "Reply with exactly: READY",
      options: { model, maxTurns: 1, cwd: dir, tools: [], settingSources: [], permissionMode: "default", persistSession: false, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? "/tmp", ...authEnv(defaultToken(), dir), DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1" }, stderr: (d) => (err += d) },
    })) {
      const r = m as { type: string; subtype?: string; result?: string; is_error?: boolean };
      if (r.type === "result") {
        text = r.result ?? "";
        if (r.is_error || r.subtype !== "success") err += ` ${r.subtype} ${r.result ?? ""}`;
      }
    }
    rmSync(dir, { recursive: true, force: true });
    /READY/.test(text) && !err.trim() ? ok(`Claude answers (${model})`) : no(`Claude call failed: ${(err || text).replace(/sk-ant-[\w-]+/g, "[REDACTED]").slice(0, 300)}`, mode === "claude-login" ? "run `claude` once and log in (or /login), or export ANTHROPIC_API_KEY / Bedrock vars" : `check the auth env vars; if your org only offers other model ids, set REEL_MODEL=<id> (see README "Models")`);
  } catch (x) {
    no(`Claude call threw: ${String((x as Error)?.message ?? x).slice(0, 300)}`, "see README \"Claude login\"");
  }
  // one tiny edge-tts synth (the voice service is on the public internet; corporate proxies sometimes block it)
  if (e.status === 0) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-tts-"));
    const out = path.join(dir, "t.mp3");
    const r = sh(py, [path.join(ROOT, "py", "tts.py")], JSON.stringify({ text: "Ready.", voice: "en-US-AvaMultilingualNeural", out }));
    r.status === 0 && existsSync(out) && statSync(out).size > 1000 ? ok("edge-tts voice reachable") : no(`edge-tts synth failed: ${(r.stderr || r.stdout).slice(-300)}`, "the Microsoft Edge read-aloud endpoint (speech.platform.bing.com) must be reachable; try a phone hotspot or set HTTPS_PROXY");
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(bad ? `\n${bad} problem(s) — fix them, then npm run doctor again.` : "\nAll good. Make a reel:  npm run reel -- make \"how do noise-cancelling headphones work\"");
process.exit(bad ? 1 : 0);
