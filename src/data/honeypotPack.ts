// HONEYPOT WEEKLY DATA PACK v1 (honeypot-weekly plan, owner 2026-11-17: all default decisions). The ONE contract shared
// by the host producer (scripts/honeypot/weekly-pack.ts, which builds a pack from the VPS's aggregate-only SQL rows)
// and the container (src/bot/inbox.ts watcher, read_data_pack tool, DP-NUM / DP-LEAK data lints).
//
//   DataPackV1     strict zod: schema:1, closed enums, integers only (floats refused), allowlisted literals, every
//                  string deny-scanned (DENY_RES) — a pack that fails is never written / never turned into a job
//   numberSet      every number in the pack's facts, normalised exactly like the SRC1 gate (director/v3/numbers.ts)
//   HP_DATA_URL    the reserved page URL the pack's facts.txt is seeded under (host *.reel-studio.invalid: web_fetch
//                  can never fetch it, so a page stored under it can only come from the sha-verified ro pack)
//   verifyPackDir  READY + pack.sha256 == sha256(pack.json) + zod + deny scan + facts.txt byte-identical to the pack
//
// Producer and image are versioned together through `schema: 1`: a v2 pack is refused by a v1 image and vice versa.
// Free text NEVER enters a pack: paths, tool names, hosting providers, passwords and usernames are closed enums; the
// only open strings are country names (shape-checked + deny-scanned) and the rendered sentences built from enums.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normNumber, numbersIn } from "../director/v3/numbers.js";

export const HP_SCHEMA_VERSION = 1 as const;
export const HP_KIND = "honeypot-weekly" as const;
/** Reserved host: decided in code by hostOf(url) (src/director/research.ts), never fetchable (.invalid, RFC 6761). */
export const HP_DATA_HOST = "honeypot-data.reel-studio.invalid";
export const HP_DATA_URL = (weekKey: string): string => `https://${HP_DATA_HOST}/${weekKey}/facts.txt`;
/** The ClaimSource id the director cites the pack under. */
export const HP_SOURCE_ID = "honeypot-data";
export const HP_TZ = "Europe/Zurich";

/** Files of one pack folder (<REEL_HP_PACK_DIR>/<YYYY-Www>/), written in this order, READY last. */
export const HP_FILES = { pack: "pack.json", facts: "facts.txt", sha: "pack.sha256", ready: "READY" } as const;

export const WEEK_KEY_RE = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
/** UTC timestamp text as stored in hits.ts and accepted by the VPS forced command. */
export const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── closed enums (scripts/honeypot/allowlists.ts maps raw columns onto these, in SQL, on the VPS) ─────────────────

export const LURES = ["env", "git", "wp_login_get", "wp_login_post", "phpinfo", "swagger", "other"] as const;
export type Lure = (typeof LURES)[number];

export const CATEGORIES = ["env-files", "git-folder", "cloud-keys", "wordpress", "graphql-config", "ai-gateways", "admin-panels", "nextjs-probes", "path-traversal", "front-door", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
/** Categories a week's topic can be (never the front page, never "other"). */
export const TOPIC_CATEGORIES = ["env-files", "git-folder", "cloud-keys", "wordpress", "graphql-config", "ai-gateways", "admin-panels", "nextjs-probes", "path-traversal"] as const satisfies readonly Category[];
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
/** The "secret files" group of F06. */
export const SECRET_CATEGORIES = ["env-files", "git-folder", "cloud-keys"] as const satisfies readonly Category[];

/** Topic → storyboard codename (storyboard.v2 codename /^[A-Z0-9-]{4,12}$/; names the mechanism, never a week). */
export const CODENAMES: Readonly<Record<TopicCategory, string>> = {
  "env-files": "ENV-HUNT",
  "git-folder": "GIT-LEAK",
  "cloud-keys": "KEY-SWEEP",
  wordpress: "WP-LOGIN",
  "graphql-config": "GRAPH-PROBE",
  "ai-gateways": "AI-KEYS",
  "admin-panels": "ADMIN-DOOR",
  "nextjs-probes": "NEXT-PROBE",
  "path-traversal": "DOT-DOT",
};
export const CODENAME_VALUES = [...new Set(Object.values(CODENAMES))] as [string, ...string[]];

/** The only literal paths that may leave the VPS (Q5). Public, generic scanner targets. */
export const ALLOWED_PATHS = [
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.env.backup",
  "/.env.bak",
  "/.env.old",
  "/.env.save",
  "/api/.env",
  "/admin/.env",
  "/.git/config",
  "/.git/HEAD",
  "/.aws/credentials",
  "/.aws/config",
  "/wp-login.php",
  "/wp-admin/index.php",
  "/robots.txt",
  "/config.json",
  "/graphql",
] as const;
export type AllowedPath = (typeof ALLOWED_PATHS)[number];

export const TOOL_FAMILIES = ["empty", "curl", "python-requests", "go-http-client", "googlebot", "leakix", "declared-bot", "browser-lookalike", "other-tool"] as const;
export type ToolFamily = (typeof TOOL_FAMILIES)[number];

export const PROVIDERS = ["Google Cloud", "AWS", "Microsoft Azure", "DigitalOcean", "Oracle Cloud", "Cloudflare", "OVH", "Hetzner", "Alibaba", "Tencent", "other-hosting", "home-or-office"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Public top-list passwords: the only password literals that may leave the VPS (everything else = a count). */
export const DICT = ["admin", "123456", "123456789", "12345678", "password", "admin123", "admin@123", "qwerty", "111111", "root", "test"] as const;
export type DictPassword = (typeof DICT)[number];
export const GENERIC_USERNAMES = ["admin", "administrator", "root", "webmaster", "test", "user"] as const;
export type GenericUsername = (typeof GENERIC_USERNAMES)[number];

export const STORY_TYPES = ["novel-cluster", "burst", "own-name", "wp-logins"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export type Month = (typeof MONTHS)[number];

// ── deny set (DP-LEAK; host zod; watcher) ───────────────────────────────────────────────────────────────────────

/**
 * Patterns that must never appear in anything public. Matches are reported by id only (never the matched text, so a
 * leak is not re-leaked into logs or Discord). `entropy` is a separate check (highEntropyTokens).
 */
export const DENY_RES: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "ipv4", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { id: "ipv6", re: /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|(?:\b[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}\b)/i },
  { id: "tailscale", re: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./ },
  { id: "lan", re: /\b192\.168\./ },
  { id: "domain-stem", re: /api[\s._-]*gateway|eu[\s._-]*central|apigatewayeucentral/i },
  { id: "zone", re: /gay[\s._-]*nigga/i },
  { id: "domain", re: /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|dev|app|ch|de|info|store|xyz|co|cloud|ai|invalid|arpa|internal)\b/i },
  { id: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { id: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
];
const ENTROPY_MIN_LEN = 12;
const ENTROPY_MAX_BITS = 3.5;

export function shannonBits(s: string): number {
  const n = s.length;
  if (!n) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) h -= (c / n) * Math.log2(c / n);
  return h;
}

/**
 * Secret-looking tokens: ≥ 12 chars of [A-Za-z0-9+/=_-] mixing at least two of lower / upper / digit, with Shannon
 * entropy > 3.5 bits per char. Single-case words ("python-requests", "/credentials") are never flagged.
 */
export function highEntropyTokens(text: string): number {
  let hits = 0;
  for (const m of String(text).matchAll(/[A-Za-z0-9+/=_-]{12,}/g)) {
    const t = m[0];
    const classes = Number(/[a-z]/.test(t)) + Number(/[A-Z]/.test(t)) + Number(/\d/.test(t));
    if (classes >= 2 && shannonBits(t) > ENTROPY_MAX_BITS) hits++;
  }
  return hits;
}

/** Deny-pattern ids found in one string (empty = clean). */
export function denyHits(text: string): string[] {
  const s = String(text ?? "");
  const out = DENY_RES.filter((d) => d.re.test(s)).map((d) => d.id);
  if (s.length >= ENTROPY_MIN_LEN && highEntropyTokens(s)) out.push("entropy");
  return out;
}

/** Every string value in a JSON-like value with its path (keys are not scanned: they are fixed by the schema). */
export function stringsIn(v: unknown, at = ""): Array<{ path: string; value: string }> {
  if (typeof v === "string") return [{ path: at || "(root)", value: v }];
  if (Array.isArray(v)) return v.flatMap((x, i) => stringsIn(x, `${at}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => stringsIn(x, at ? `${at}.${k}` : k));
  return [];
}

/** Deny-scan every string in a value → "<path>: <ids>" findings (no matched text). */
export function leakFindings(v: unknown): string[] {
  return stringsIn(v).flatMap(({ path: p, value }) => {
    const ids = denyHits(value);
    return ids.length ? [`${p}: ${ids.join(",")}`] : [];
  });
}

// ── schema ──────────────────────────────────────────────────────────────────────────────────────────────────────

const count = z.int().min(0);
const ts = z.string().regex(TS_RE);
/** Country NAME from ip_geo (never a code, city or org): needs a lower-case letter, so "US" / "DE" cannot pass;
 *  "Private/Tailscale" cannot pass (slash). */
export const CountryName = z.string().regex(/^[A-Z][A-Za-z .'(),&-]{2,47}$/).regex(/[a-z]/);

export const DayStat = z.strictObject({
  date: z.string().regex(DATE_RE),
  weekday: z.enum(WEEKDAYS),
  day: z.int().min(1).max(31),
  month: z.enum(MONTHS),
  year: z.int().min(2000).max(2100),
  hits: count,
});
export type DayStatT = z.infer<typeof DayStat>;

/** The week's aggregate numbers (the producer's derive step input + the pack's raw section). */
export const HoneypotWeekStats = z.strictObject({
  weekKey: z.string().regex(WEEK_KEY_RE),
  window: z.strictObject({ tz: z.literal(HP_TZ), startUtc: ts, endUtc: ts, prevStartUtc: ts }),
  totals: z.strictObject({ hits: count, ips: count, paths: count, lureHits: count, wpPosts: count, posts: count }),
  prevHits: count,
  /** Private/Tailscale hits left out of every number (card only, never the reel). */
  excludedInternal: count,
  daily: z.array(DayStat).length(7),
  lures: z.array(z.strictObject({ lure: z.enum(LURES), hits: count })).max(LURES.length),
  categories: z.array(z.strictObject({ category: z.enum(CATEGORIES), hits: count, ips: count })).max(CATEGORIES.length),
  paths: z.array(z.strictObject({ path: z.enum(ALLOWED_PATHS), hits: count })).max(8),
  novel: z.strictObject({
    /** Distinct paths not seen in the 180 days before the week. */
    paths: count,
    byCategory: z.array(z.strictObject({ category: z.enum(CATEGORIES), paths: count })).max(CATEGORIES.length),
    /** The busiest hour of novel paths (Zurich clock), or null when there were none. */
    cluster: z
      .strictObject({ paths: count, ips: count, category: z.enum(CATEGORIES), date: z.string().regex(DATE_RE), hour: z.int().min(0).max(23) })
      .nullable(),
  }),
  tools: z.array(z.strictObject({ family: z.enum(TOOL_FAMILIES), hits: count })).max(TOOL_FAMILIES.length),
  hosting: z.array(z.strictObject({ provider: z.enum(PROVIDERS), hits: count })).max(PROVIDERS.length),
  countries: z.array(z.strictObject({ country: CountryName, hits: count })).max(6),
  /** The busiest single sources (no address: the SQL never selects src_ip). */
  bursts: z.array(z.strictObject({ hits: count, provider: z.enum(PROVIDERS), country: CountryName, paths: count })).max(3),
  creds: z.strictObject({
    siteNamePw: count,
    yearPw: count,
    dictPw: count,
    passwords: z.array(z.strictObject({ value: z.enum(DICT), n: count })).max(5),
    usernames: z.array(z.strictObject({ value: z.enum(GENERIC_USERNAMES), n: count })).max(5),
  }),
});
export type HoneypotWeekStatsT = z.infer<typeof HoneypotWeekStats>;

export const FactId = z.string().regex(/^F\d{2}$/);
export const Fact = z.strictObject({ id: FactId, text: z.string().min(1).max(400) });
export type FactT = z.infer<typeof Fact>;

export const StoryCandidate = z.strictObject({ type: z.enum(STORY_TYPES), factIds: z.array(FactId).min(1).max(4) });
export type StoryCandidateT = z.infer<typeof StoryCandidate>;

const TERMINAL_MAX_LINES = 16;
export const TERMINAL_MAX_CHARS = 46;

export const DataPackV1 = z
  .strictObject({
    schema: z.literal(HP_SCHEMA_VERSION),
    kind: z.literal(HP_KIND),
    weekKey: z.string().regex(WEEK_KEY_RE),
    /** "2026-W46 · 9–15 Nov 2026" (card / anchor; never the reel header). */
    label: z.string().min(1).max(60),
    /** "9 to 15 November 2026" (spoken/fact form). */
    dateText: z.string().min(1).max(60),
    topic: z.enum(TOPIC_CATEGORIES),
    codename: z.enum(CODENAME_VALUES),
    stats: HoneypotWeekStats,
    /** Ranked, rotation-filtered story candidates (≤ 3). */
    stories: z.array(StoryCandidate).max(3),
    facts: z.array(Fact).min(1).max(80),
    terminalLines: z.array(z.string().min(1).max(TERMINAL_MAX_CHARS)).max(TERMINAL_MAX_LINES),
    caption: z.string().min(1).max(2200),
    /** numbers allowed on screen / in the voice beyond the facts ("404", the year, the week's day-of-month labels). */
    constants: z.array(z.string().regex(/^\d+$/)).max(40),
    /** normNumber() of every number in facts + constants (sorted, unique). */
    numberSet: z.array(z.string().regex(/^\d[\d.]*$/)).max(600),
  })
  .superRefine((p, ctx) => {
    if (p.stats.weekKey !== p.weekKey) ctx.addIssue({ code: "custom", path: ["stats", "weekKey"], message: "stats.weekKey ≠ weekKey" });
    if (CODENAMES[p.topic] !== p.codename) ctx.addIssue({ code: "custom", path: ["codename"], message: `codename must be ${CODENAMES[p.topic]} for topic ${p.topic}` });
    const ids = p.facts.map((f) => f.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["facts"], message: "duplicate fact id" });
    for (const [i, s] of p.stories.entries()) {
      for (const id of s.factIds) if (!ids.includes(id)) ctx.addIssue({ code: "custom", path: ["stories", i, "factIds"], message: `unknown fact ${id}` });
    }
    const want = numberSet(p.facts.map((f) => f.text), p.constants);
    if (want.join(" ") !== p.numberSet.join(" ")) ctx.addIssue({ code: "custom", path: ["numberSet"], message: "numberSet does not match facts + constants" });
    for (const f of leakFindings(p)) ctx.addIssue({ code: "custom", path: [], message: `deny pattern: ${f}` });
  });
export type DataPackV1T = z.infer<typeof DataPackV1>;

/** The job-side pointer (store.ts Job.dataPack). */
export interface JobDataPack {
  kind: typeof HP_KIND;
  weekKey: string;
  sha256: string;
}

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every number token in `texts`, normalised exactly as the SRC1 gate does (numbersIn + normNumber from
 * director/v3/numbers.ts: "33,104" → "33104", "seven" → "7"), plus the extra constants. Sorted (numeric, then
 * lexical), unique.
 */
export function numberSet(texts: readonly string[], constants: readonly string[] = []): string[] {
  const s = new Set<string>();
  for (const t of texts) for (const tok of numbersIn(t)) s.add(normNumber(tok));
  for (const c of constants) s.add(normNumber(c));
  return [...s].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

// ── files + sha ─────────────────────────────────────────────────────────────────────────────────────────────────

export const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** The facts.txt page text (byte-exact; the director's source quotes are matched against it). */
export function factsText(pack: Pick<DataPackV1T, "weekKey" | "label" | "facts">): string {
  const head = `Honeypot weekly data pack ${pack.label}. Owner-measured counts from the honeypot's own request log; every sentence below is a measured figure for the stated dates.`;
  return `${[head, ...pack.facts.map((f) => `${f.id}: ${f.text}`)].join("\n")}\n`;
}

/** pack.sha256 content (sha256sum-compatible). */
export const shaFileText = (hex: string): string => `${hex}  ${HP_FILES.pack}\n`;
/** The hex digest from a pack.sha256 file, or null when it is not one. */
export function parseShaFile(text: string): string | null {
  const m = /^([0-9a-f]{64})(?:\s+\*?pack\.json)?\s*$/.exec(text.trim());
  return m ? m[1] : null;
}

/** Fixed reason codes (notices print these, never raw error text). */
export type PackVerifyCode = "HP_MISSING" | "HP_SHA" | "HP_SCHEMA" | "HP_LEAK" | "HP_FACTS";
export type PackVerifyResult = { ok: true; pack: DataPackV1T; sha256: string; facts: string } | { ok: false; code: PackVerifyCode; detail: string };

/** Parse + validate a pack.json text (no file access). `detail` never contains pack values, only paths/ids. */
export function parsePack(json: string): { ok: true; pack: DataPackV1T } | { ok: false; code: "HP_SCHEMA" | "HP_LEAK"; detail: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, code: "HP_SCHEMA", detail: "pack.json is not JSON" };
  }
  const r = DataPackV1.safeParse(raw);
  if (r.success) return { ok: true, pack: r.data };
  const leak = r.error.issues.filter((i) => i.message.startsWith("deny pattern:"));
  if (leak.length) return { ok: false, code: "HP_LEAK", detail: leak.slice(0, 8).map((i) => i.message).join("; ") };
  return { ok: false, code: "HP_SCHEMA", detail: r.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`).join("; ") };
}

/**
 * Verify one pack folder: READY present, pack.sha256 == sha256(pack.json) (== `expectSha` when given, e.g. the inbox
 * request's sha), DataPackV1 + deny scan, and facts.txt byte-identical to factsText(pack).
 */
export async function verifyPackDir(dir: string, expectSha?: string): Promise<PackVerifyResult> {
  const rd = async (f: string): Promise<Buffer | null> => readFile(path.join(dir, f)).catch(() => null);
  const [ready, packBuf, shaBuf, factsBuf] = await Promise.all([rd(HP_FILES.ready), rd(HP_FILES.pack), rd(HP_FILES.sha), rd(HP_FILES.facts)]);
  if (!ready || !packBuf || !shaBuf || !factsBuf) return { ok: false, code: "HP_MISSING", detail: "pack folder incomplete (READY / pack.json / pack.sha256 / facts.txt)" };
  const sha = sha256Hex(packBuf);
  const pinned = parseShaFile(shaBuf.toString("utf8"));
  if (!pinned || pinned !== sha) return { ok: false, code: "HP_SHA", detail: "pack.sha256 does not match pack.json" };
  if (expectSha !== undefined && expectSha !== sha) return { ok: false, code: "HP_SHA", detail: "request sha does not match pack.json" };
  const p = parsePack(packBuf.toString("utf8"));
  if (!p.ok) return p;
  const facts = factsText(p.pack);
  if (factsBuf.toString("utf8") !== facts) return { ok: false, code: "HP_FACTS", detail: "facts.txt is not the pack's facts" };
  return { ok: true, pack: p.pack, sha256: sha, facts };
}
