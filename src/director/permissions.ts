// canUseTool for the director: DEFAULT-DENY. Only our in-process `reel` MCP tools for the current phase, plus the
// SDK's server-side WebSearch while drafting/revising. Everything else (Bash, Read, Write, WebFetch, other MCP
// servers, unknown names) is refused — the owner prompt is untrusted, so the tool surface is the security boundary.

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { DirectorPhase } from "./state.js";

export const REEL_MCP_SERVER_NAME = "reel";
export const REEL_PREFIX = `mcp__${REEL_MCP_SERVER_NAME}__`;
export const WEB_SEARCH_TOOL = "WebSearch";

export const REEL_TOOLS = ["list_library", "web_fetch", "save_script", "view_stills", "report_check"] as const;
export type ReelToolName = (typeof REEL_TOOLS)[number];

/** Per-phase allowlist. Research only while writing; stills/report only during a self-check. */
export const PHASE_TOOLS: Record<DirectorPhase, { reel: readonly ReelToolName[]; webSearch: boolean }> = {
  draft: { reel: ["list_library", "web_fetch", "save_script"], webSearch: true },
  revise: { reel: ["list_library", "web_fetch", "save_script"], webSearch: true },
  selfcheck: { reel: ["list_library", "view_stills", "save_script", "report_check"], webSearch: false },
};

export type Decision = { tool: string; decision: "allow" | "deny"; why: string };

export function makeCanUseTool(phase: DirectorPhase, onDecision?: (d: Decision) => void): CanUseTool {
  const allowed = new Set<string>(PHASE_TOOLS[phase].reel);
  const webSearch = PHASE_TOOLS[phase].webSearch;
  return async (toolName, input, options): Promise<PermissionResult> => {
    const deny = (why: string): PermissionResult => {
      onDecision?.({ tool: toolName, decision: "deny", why });
      return { behavior: "deny", message: why };
    };
    const allow = (why: string): PermissionResult => {
      onDecision?.({ tool: toolName, decision: "allow", why });
      return { behavior: "allow", updatedInput: input };
    };
    if (toolName === WEB_SEARCH_TOOL) {
      // Built-in, server-side search (no local side effects). Must not arrive dressed up as an MCP tool.
      if (!webSearch) return deny(`${WEB_SEARCH_TOOL} is not available during ${phase}.`);
      if (options?.mcpServer) return deny("WebSearch must be the built-in tool.");
      return allow("built-in server-side web search");
    }
    if (!toolName.startsWith(REEL_PREFIX)) {
      return deny(`Tool ${toolName} does not exist for the director. Only: ${[...allowed].map((t) => REEL_PREFIX + t).join(", ")}${webSearch ? `, ${WEB_SEARCH_TOOL}` : ""}.`);
    }
    // If the CLI says where the tool came from, it must be our in-process (sdk) server.
    if (options?.mcpServer && (options.mcpServer.source !== "sdk" || options.mcpServer.name !== REEL_MCP_SERVER_NAME)) {
      return deny("Only the in-process reel tool server is trusted.");
    }
    const short = toolName.slice(REEL_PREFIX.length);
    if (!allowed.has(short)) return deny(`Tool ${short} is not available during ${phase}.`);
    return allow(`reel tool (${phase})`);
  };
}
