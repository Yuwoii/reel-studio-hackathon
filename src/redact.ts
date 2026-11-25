// Secret redaction for everything the bot posts to Discord and everything it logs.
// Literal env secret values (see config.SECRET_ENV_NAMES) + generic token shapes. Ported from homelab-agent/src/redact.ts
// (minus the rotating-file secrets, which reel-studio doesn't have) plus AWS-specific patterns.

const R = "[REDACTED]";

interface Rule {
  re: RegExp;
  replace: string | ((substring: string, ...args: string[]) => string);
}

const PATTERNS: Rule[] = [
  // PEM private keys
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: `-----${R} PRIVATE KEY-----` },
  // Discord webhook URLs (id + token)
  { re: /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+/gi, replace: `https://discord.com/api/webhooks/${R}` },
  // Authorization headers / bearer tokens
  { re: /\b(Bearer|Basic|Bot)\s+[A-Za-z0-9._~+/=-]{8,}/g, replace: (_m, kind) => `${kind} ${R}` },
  // Anthropic (API keys + OAuth tokens: sk-ant-api…/sk-ant-oat…)
  { re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g, replace: R },
  // ElevenLabs keys
  { re: /\bsk_[a-f0-9]{40,}\b/g, replace: R },
  // AWS access key ids (long-term + STS)
  { re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: R },
  // S3/MinIO presigned URL signature, credential and session token (Remotion/S3 audio + render URLs)
  { re: /([?&]X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s"'<>#]+/gi, replace: (_m, key) => `${key}${R}` },
  // Discord bot token shape
  { re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g, replace: R },
  // JWTs
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: R },
  // credentials embedded in URLs: scheme://user:pass@host
  { re: /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, replace: (_m, pre) => `${pre}${R}@` },
  // key=value / key: value / "key": "value" for sensitive key names (e.g. aws_secret_access_key = …)
  {
    re: /((?:"|')?[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|client[_-]?secret|passphrase|credential)[A-Za-z0-9_.-]*(?:"|')?\s*[:=]\s*(?:"|')?)([^\s"',;&}]{3,})/gi,
    replace: (_m, pre) => `${pre}${R}`,
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Redactor {
  private literals: RegExp | null;

  /** @param secrets literal secret values (from config.secretValues()) */
  constructor(secrets: string[] = []) {
    const uniq = [...new Set(secrets.filter((s) => s && s.length >= 4))].sort((a, b) => b.length - a.length);
    // Alphanumeric boundaries so a short secret doesn't shred ordinary text that merely contains it.
    this.literals = uniq.length ? new RegExp(`(?<![A-Za-z0-9])(?:${uniq.map(escapeRe).join("|")})(?![A-Za-z0-9])`, "g") : null;
  }

  redact(text: string): string {
    let out = String(text);
    if (this.literals) out = out.replace(this.literals, R);
    for (const p of PATTERNS) out = out.replace(p.re, p.replace as never);
    return out;
  }

  /** Deep-redact every string in a JSON-ish value (embeds, button labels…). Non-plain objects pass through. */
  redactDeep<T>(v: T): T {
    if (typeof v === "string") return this.redact(v) as T;
    if (Array.isArray(v)) return v.map((x) => this.redactDeep(x)) as T;
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = this.redactDeep(x);
      return out as T;
    }
    return v;
  }
}
