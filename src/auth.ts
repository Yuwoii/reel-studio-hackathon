// Claude auth for every Agent SDK subprocess (director, judges, fact check, critics).
//
// The original Reel Studio passed ONE thing: CLAUDE_CODE_OAUTH_TOKEN (a subscription token from `claude setup-token`)
// plus an isolated CLAUDE_CONFIG_DIR. This fork accepts whatever the machine is logged in with:
//
//   1. CLAUDE_CODE_OAUTH_TOKEN set          → used as before, isolated config dir.
//   2. ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / Bedrock / Vertex / Foundry env vars set
//                                           → passed through to the subprocess (isolated config dir).
//   3. nothing set ("inherit")              → the subprocess uses the CLAUDE CODE LOGIN of this user account
//                                             (~/.claude, or the macOS keychain) — i.e. whatever `claude` is logged
//                                             into on this laptop. No isolated config dir in that case, because the
//                                             login lives in the user's own config dir.
//
// Corporate network variables (HTTPS_PROXY, NO_PROXY, NODE_EXTRA_CA_CERTS, …) are always passed through.

export const INHERIT = "inherit-login";

const PASS_ALWAYS = [
  "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE",
  "USER", "LOGNAME", "SHELL", "LANG", "XDG_CONFIG_HOME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL",
];
const PROVIDER_VARS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_BEDROCK_BASE_URL", "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK", "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE",
  "CLAUDE_CODE_USE_VERTEX", "ANTHROPIC_VERTEX_PROJECT_ID", "CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS", "ANTHROPIC_VERTEX_BASE_URL", "CLAUDE_CODE_SKIP_VERTEX_AUTH",
  "CLAUDE_CODE_USE_FOUNDRY", "ANTHROPIC_FOUNDRY_RESOURCE", "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_BASE_URL",
];

/** The "token" every caller checks for truthiness: the OAuth token when set, else a sentinel meaning "use env/login". */
export function defaultToken(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || INHERIT;
}

export type AuthMode = "oauth-token" | "provider-env" | "claude-login";
export function authMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return "oauth-token";
  if (PROVIDER_VARS.some((k) => k !== "AWS_REGION" && k !== "AWS_DEFAULT_REGION" && env[k]?.trim())) return "provider-env";
  return "claude-login";
}

/** Env entries for an SDK subprocess: replaces `{ CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: token }`. */
export function authEnv(token: string, isolatedConfigDir: string, env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of PASS_ALWAYS) if (env[k] !== undefined) out[k] = env[k];
  if (token && token !== INHERIT) {
    out.CLAUDE_CONFIG_DIR = isolatedConfigDir;
    out.CLAUDE_CODE_OAUTH_TOKEN = token;
    return out;
  }
  for (const k of PROVIDER_VARS) if (env[k] !== undefined) out[k] = env[k];
  const mode = authMode(env);
  if (mode === "provider-env") out.CLAUDE_CONFIG_DIR = isolatedConfigDir;
  else if (env.CLAUDE_CONFIG_DIR) out.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR; // the user's own login dir
  return out;
}

// ── model ids ───────────────────────────────────────────────────────────────────────────────────────────────────
// Defaults: claude-sonnet-5-5 (director + most judges), claude-opus-5-5 (physics judges). If your org exposes other
// ids (Bedrock "us.anthropic.…", a gateway alias), set REEL_MODEL (everything) and optionally REEL_STRONG_MODEL
// (the physics judges, default = REEL_MODEL). Individual REEL_V3_*_MODEL vars still win when set.
const ALL_MODEL_VARS = [
  "REEL_V3_MODEL", "REEL_V2_JUDGE_MODEL", "REEL_V2_FACTCHECK_MODEL", "REEL_V2_CLARITY_MODEL", "REEL_V2_CRITIC_MODEL", "REEL_V2_MECHANISM_MODEL",
  "REEL_V3_CLAIMS_MODEL", "REEL_V3_CRITIC_MODEL", "REEL_V3_FACTCHECK_MODEL", "REEL_V3_FRAME_MODEL", "REEL_V3_NONTECH_MODEL", "REEL_V3_NONTECH_COMPARE_MODEL",
];
const STRONG_MODEL_VARS = ["REEL_V2_PHYSICS_MODEL", "REEL_V3_PHYSICS_MODEL", "REEL_V3_PHYSICS_BOARD_MODEL"];
export function applyModelOverrides(env: NodeJS.ProcessEnv = process.env): void {
  const all = env.REEL_MODEL?.trim();
  const strong = env.REEL_STRONG_MODEL?.trim() || all;
  if (all) for (const k of ALL_MODEL_VARS) if (!env[k]?.trim()) env[k] = all;
  if (strong) for (const k of STRONG_MODEL_VARS) if (!env[k]?.trim()) env[k] = strong;
}
