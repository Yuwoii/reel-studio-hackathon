// The director's in-process MCP server "reel". Every tool is bound (in closure) to ONE job dir and one run: no tool
// takes a path, so nothing the model says can point a write or read anywhere else.
//   list_library  catalogue + layout rules (read-only, static)
//   web_fetch     SSRF-guarded https fetch → untrusted <web_content> (webfetch.ts)
//   save_script   validateReel → atomic script.json + config.json in the job dir; 3 failed saves end the run
//   view_stills   the job's stills, downscaled (longest side ≤ 768 px) → MCP image content
//   report_check  self-check verdict; `fixed:true` only after a successful save_script in the same run

import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { run as runProc } from "../audio/proc.js";
import { validateReel, type Config, type Script } from "../schema/index.js";
import { libraryCatalogue } from "./catalogue.js";
import { REEL_MCP_SERVER_NAME, type ReelToolName } from "./permissions.js";
import { MAX_GATE_REJECTIONS, isFactual, recordFetch, researchGaps, saveLedger, type ResearchLedger } from "./research.js";
import { atomicWrite, type DirectorPhase } from "./state.js";
import { FetchBlockedError, formatWebContent, safeFetch, type SafeFetchOptions } from "./webfetch.js";

export const MAX_FAILED_SAVES = 3;
export const MAX_STILLS = 4;
export const STILL_MAX_PX = 768;

/** Mutable per-run record the tools write and the director reads after the SDK query ends. */
export interface RunRecord {
  saved?: { script: Script; config: Config };
  failedSaves: number;
  lastErrors: string[];
  report?: { ok: boolean; issues: string[]; fixed: boolean };
  /** Set when the run must end (3rd failed save) — the director aborts the query and throws this. */
  fatal?: string;
  /** Research-gate rejections this run (they do NOT count as failed saves). */
  gateRejections?: number;
  /** Set when a factual script was accepted below the research floor (gate gave up) — surfaced as an owner note. */
  researchWarning?: string;
}

export interface ToolContext {
  jobDir: string;
  phase: DirectorPhase;
  /** selfCheck only: still files supplied by the pipeline (else <jobDir>/stills/*). */
  stills?: string[];
  fetch?: SafeFetchOptions;
  record: RunRecord;
  /** Called once when record.fatal is set. */
  onFatal?: () => void;
  ffmpeg?: string;
  log?: (line: string) => void;
  /** Job research ledger (searches counted by the director, pages by web_fetch). Absent → no research gate. */
  research?: ResearchLedger;
}

export interface CallResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

export interface ToolSpec {
  name: ReelToolName;
  description: string;
  shape: z.ZodRawShape;
  handler: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<CallResult>;
}

const text = (t: string, isError = false): CallResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** Models sometimes pass the JSON documents as strings; accept both. */
function asJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function saveScript(ctx: ToolContext, scriptIn: unknown, configIn: unknown): Promise<CallResult> {
  const r = ctx.record;
  if (r.fatal) return text(r.fatal, true);
  const v = validateReel(asJson(scriptIn), asJson(configIn));
  if (!v.ok || !v.value) {
    r.failedSaves++;
    r.lastErrors = v.errors.slice(0, 40);
    const left = MAX_FAILED_SAVES - r.failedSaves;
    if (left <= 0) {
      r.fatal = `save_script failed ${MAX_FAILED_SAVES} times; last errors: ${r.lastErrors.slice(0, 8).join(" | ")}`;
      ctx.onFatal?.();
      return text(`${r.fatal}\nNo attempts left — stop now.`, true);
    }
    return text(`Validation failed (${left} attempt${left === 1 ? "" : "s"} left). Fix exactly these and call save_script again with the COMPLETE script and config:\n- ${r.lastErrors.join("\n- ")}`, true);
  }
  const { script, config } = v.value;
  if (ctx.research && ctx.phase !== "selfcheck" && isFactual(script)) {
    const gaps = researchGaps(script, ctx.research);
    if (gaps.length) {
      r.gateRejections = (r.gateRejections ?? 0) + 1;
      if (r.gateRejections <= MAX_GATE_REJECTIONS) {
        ctx.log?.(`save_script research gate ${r.gateRejections}/${MAX_GATE_REJECTIONS}: ${gaps.length} gap(s)`);
        return text(`Not saved — research is below the floor for a factual reel (this does not count as a failed save). Do more research, then call save_script again with the COMPLETE script and config:\n- ${gaps.join("\n- ")}`, true);
      }
      r.researchWarning = `Research below the usual floor: ${gaps.join("; ")}`.slice(0, 400);
      ctx.log?.("save_script research gate gave up — saving with a warning");
    }
  }
  // Bound to the job dir from the closure; the filenames are constants.
  await atomicWrite(path.join(ctx.jobDir, "script.json"), JSON.stringify(script, null, 2) + "\n");
  await atomicWrite(path.join(ctx.jobDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
  r.saved = { script, config };
  r.lastErrors = [];
  const words = script.beats.reduce((n, b) => n + b.narration.trim().split(/\s+/).length, 0);
  ctx.log?.(`save_script ok: ${script.slug} (${script.beats.length} beats, ${words} words)`);
  return text(`Saved "${script.title}" (slug ${script.slug}, ${script.beats.length} beats, ${words} words, ~${Math.round(words / 2.5 + script.beats.length * 0.3)} s, style ${config.style}).${ctx.phase === "selfcheck" ? " Now call report_check." : " Finish with your short notes for the owner."}`);
}

async function listStills(ctx: ToolContext): Promise<string[]> {
  if (ctx.stills?.length) return ctx.stills.slice(0, MAX_STILLS);
  const dir = path.join(ctx.jobDir, "stills");
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => /^[\w.-]+\.(jpe?g|png)$/i.test(n)).sort();
  } catch {
    return [];
  }
  return names.slice(0, MAX_STILLS).map((n) => path.join(dir, n));
}

export async function viewStills(ctx: ToolContext, signal?: AbortSignal): Promise<CallResult> {
  const files = await listStills(ctx);
  if (!files.length) return text("No stills available for this job.", true);
  const tmp = await mkdtemp(path.join(tmpdir(), "reel-stills-"));
  try {
    const out: CallResult["content"] = [{ type: "text", text: `${files.length} stills (start → end), downscaled to ≤ ${STILL_MAX_PX} px:` }];
    for (const [i, f] of files.entries()) {
      const st = await stat(f);
      if (!st.isFile() || st.size > 30 * 1024 * 1024) continue;
      const dst = path.join(tmp, `s${i}.jpg`);
      const vf = `scale='if(gt(iw,ih),min(${STILL_MAX_PX},iw),-2)':'if(gt(iw,ih),-2,min(${STILL_MAX_PX},ih))'`;
      await runProc([ctx.ffmpeg ?? "ffmpeg", "-v", "error", "-y", "-i", f, "-vf", vf, "-frames:v", "1", "-q:v", "4", dst], { timeoutMs: 60_000, signal });
      out.push({ type: "text", text: `still ${i + 1}/${files.length}` });
      out.push({ type: "image", data: (await readFile(dst)).toString("base64"), mimeType: "image/jpeg" });
    }
    return { content: out };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export function reportCheck(ctx: ToolContext, args: { ok: boolean; issues: string[]; fixed: boolean }): CallResult {
  const r = ctx.record;
  if (r.report) return text("report_check was already called — end your turn.", true);
  if (args.fixed && !r.saved) return text("fixed:true requires a successful save_script call with the revised script+config FIRST. Call save_script, then report_check again.", true);
  if (args.ok && args.fixed) return text("ok:true and fixed:true contradict each other; report ok:false with the issues you fixed.", true);
  r.report = { ok: args.ok, issues: args.issues.map((s) => s.slice(0, 200)).slice(0, 10), fixed: args.fixed };
  return text("Recorded. End your turn now.");
}

export function buildToolSpecs(ctx: ToolContext): ToolSpec[] {
  return [
    {
      name: "list_library",
      description: "The full component catalogue (styles, palette roles, backgrounds, species, accessories, actions, props, prop animations, particles, transitions, HUD kinds/slots, voices per language) and the layout rules.",
      shape: {},
      handler: async () => text(JSON.stringify(libraryCatalogue())),
    },
    {
      name: "web_fetch",
      description: "Fetch a PUBLIC https web page (port 443 only) and return its text (≤ 20k chars) inside <web_content>. Private/internal addresses are refused. Use to read the authoritative pages behind your facts (search snippets are not enough).",
      shape: { url: z.string().max(2000).describe("https:// URL") },
      handler: async (a, signal) => {
        try {
          const r = await safeFetch(String(a.url ?? ""), { ...ctx.fetch, signal });
          ctx.log?.(`web_fetch ok ${r.url} (${r.text.length} chars)`);
          if (ctx.research) {
            recordFetch(ctx.research, String(a.url ?? ""), r.url);
            await saveLedger(ctx.jobDir, ctx.research).catch(() => {});
          }
          return text(formatWebContent(r));
        } catch (e) {
          const msg = e instanceof FetchBlockedError ? `refused: ${e.message}` : `fetch failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
          ctx.log?.(`web_fetch ${msg}`);
          return text(msg, true);
        }
      },
    },
    {
      name: "save_script",
      description: `Validate and save script.json + config.json for THIS job (the only way to deliver your work). Returns validation errors to fix; after ${MAX_FAILED_SAVES} failed attempts the job fails.`,
      shape: {
        script: z.any().describe("the complete script.json object"),
        config: z.any().describe("the complete config.json object"),
      },
      handler: async (a) => saveScript(ctx, a.script, a.config),
    },
    {
      name: "view_stills",
      description: "Self-check only: returns the rendered stills of this job (start / middle / end) as images.",
      shape: {},
      handler: async (_a, signal) => viewStills(ctx, signal),
    },
    {
      name: "report_check",
      description: "Self-check only: report your verdict once. fixed:true only after save_script succeeded with the revised script/config.",
      shape: {
        ok: z.boolean().describe("true = no real defects"),
        issues: z.array(z.string().max(200)).max(10).describe("concrete defects seen in the stills (empty if ok)"),
        fixed: z.boolean().describe("true = you already saved a revised script/config that fixes them"),
      },
      handler: async (a) => reportCheck(ctx, { ok: !!a.ok, issues: Array.isArray(a.issues) ? a.issues.map(String) : [], fixed: !!a.fixed }),
    },
  ];
}

export function buildMcpServer(specs: ToolSpec[]): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: REEL_MCP_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    timeout: 60_000,
    tools: specs.map((s) =>
      tool(
        s.name,
        s.description,
        s.shape,
        async (args: Record<string, unknown>, extra: unknown) => {
          const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
          return (await s.handler(args, signal)) as never;
        },
        { alwaysLoad: true },
      ),
    ),
  });
}
