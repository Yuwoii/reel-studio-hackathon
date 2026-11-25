// canUseTool for the v2 director: DEFAULT-DENY, exactly like v1 (src/director/permissions.ts). Only our in-process
// `reel` MCP tools (served by an sdk-source server named "reel") plus the SDK's server-side WebSearch.
//
// Research window (W3 fix round 1, one rule for BOTH research tools): WebSearch and mcp__reel__web_fetch are allowed
// only while `researchOpen()` is true, so no new untrusted web content enters the director after the board. The
// director decides it (index.ts): open while the stage is before "boarded", and in a revise also from the start of
// the run until the revise's first accepted storyboard (a revise may need a new source; submit_script refuses
// unread sources, so the director must be able to search AND fetch).
// Everything else (Bash, Read, Write, WebFetch, Agent, other MCP servers, unknown names) is refused: the owner prompt
// and fetched pages are untrusted, so the tool surface is the security boundary.

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

export const REEL_MCP_SERVER_NAME = "reel";
export const REEL_PREFIX = `mcp__${REEL_MCP_SERVER_NAME}__`;
export const WEB_SEARCH_TOOL = "WebSearch";

export const V2_TOOLS = [
  "list_components",
  "web_fetch",
  "submit_script",
  "score_script",
  "synthesize_tts",
  "submit_storyboard",
  "render_stills",
  "view_stills",
  "save_job",
] as const;
export type V2ToolName = (typeof V2_TOOLS)[number];

/** `query` = the WebSearch query (allowed searches are booked with it: the freshness rule looks for a recency search). */
export type Decision = { tool: string; decision: "allow" | "deny"; why: string; toolUseID?: string; query?: string };

/** Tools that bring new web content in; gated by the research window. */
export const RESEARCH_TOOLS = [WEB_SEARCH_TOOL, `${REEL_PREFIX}web_fetch`] as const;

export interface CanUseToolV2Options {
  /** Live check: is the research window open (WebSearch + web_fetch)? Default: open, unless `boarded` says closed. */
  researchOpen?: () => boolean;
  /** Back-compat: true once a storyboard has been saved → research closed (used when researchOpen is not given). */
  boarded?: () => boolean;
  /** Live job caps (turns incl. judge turns, notional $): non-null = reached → every tool is denied except
   *  mcp__reel__save_job (so a finished board can still be delivered). The run is also aborted by index.ts. */
  budget?: () => string | null;
  onDecision?: (d: Decision) => void;
}

const CLOSED = "Research is closed: a storyboard is saved. Use the facts and sources you already have.";

export function makeCanUseToolV2(opts: CanUseToolV2Options = {}): CanUseTool {
  const allowed = new Set<string>(V2_TOOLS);
  const open = (): boolean => (opts.researchOpen ? opts.researchOpen() : !opts.boarded?.());
  return async (toolName, input, options): Promise<PermissionResult> => {
    const deny = (why: string): PermissionResult => {
      opts.onDecision?.({ tool: toolName, decision: "deny", why });
      return { behavior: "deny", message: why };
    };
    const allow = (why: string): PermissionResult => {
      const q = toolName === WEB_SEARCH_TOOL && typeof (input as { query?: unknown })?.query === "string" ? String((input as { query: string }).query).slice(0, 300) : undefined;
      opts.onDecision?.({ tool: toolName, decision: "allow", why, ...(options?.toolUseID ? { toolUseID: options.toolUseID } : {}), ...(q !== undefined ? { query: q } : {}) });
      return { behavior: "allow", updatedInput: input };
    };
    const cap = opts.budget?.() ?? null;
    const capped = () => deny(`Job cap reached: ${cap}. Call save_job if a storyboard is saved, else end your turn.`);
    if (toolName === WEB_SEARCH_TOOL) {
      // Built-in, server-side search (no local side effects). Must not arrive dressed up as an MCP tool.
      if (options?.mcpServer) return deny("WebSearch must be the built-in tool.");
      if (cap) return capped();
      if (!open()) return deny(CLOSED);
      return allow("built-in server-side web search");
    }
    if (!toolName.startsWith(REEL_PREFIX)) {
      return deny(`Tool ${toolName || "(empty)"} does not exist for the director. Only: ${[...allowed].map((t) => REEL_PREFIX + t).join(", ")}, ${WEB_SEARCH_TOOL}.`);
    }
    // If the CLI says where the tool came from, it must be our in-process (sdk) server.
    if (options?.mcpServer && (options.mcpServer.source !== "sdk" || options.mcpServer.name !== REEL_MCP_SERVER_NAME)) {
      return deny("Only the in-process reel tool server is trusted.");
    }
    const short = toolName.slice(REEL_PREFIX.length);
    if (!allowed.has(short)) return deny(`Tool ${short || "(empty)"} does not exist on the reel server.`);
    if (cap && short !== "save_job") return capped();
    if (short === "web_fetch" && !open()) return deny(CLOSED);
    return allow("reel tool (v2)");
  };
}
