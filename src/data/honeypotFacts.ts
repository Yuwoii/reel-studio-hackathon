// HONEYPOT WEEKLY FACTS (honeypot-weekly plan): the deterministic templates that turn one week's aggregate stats into
// the pack's quote-ready sentences (facts.txt), the Terminal lines, the caption, the topic/codename and the ranked story
// candidates. Pure functions: the host producer builds a pack with buildPack(); the container re-checks it with
// verifyRendered() (a pack whose rendered parts differ from what these templates make of its stats is refused).
//
// Sentence rules (fact checker never has to compute): every fact names its dates, states only what a column literally
// says (no "almost none are people"), and every number in it was computed here with integer maths, once. Countries
// are hosting locations (F12). Shares are Math.round(100*n/total); rounded forms round DOWN to 2 significant figures
// ("more than 33,000"). Weekday / month words come only from the pack's day labels.

import {
  CATEGORIES,
  CODENAMES,
  DataPackV1,
  HP_KIND,
  HP_SCHEMA_VERSION,
  HP_TZ,
  MONTHS,
  numberSet,
  SECRET_CATEGORIES,
  TERMINAL_MAX_CHARS,
  TOOL_FAMILIES,
  TOPIC_CATEGORIES,
  WEEK_KEY_RE,
  WEEKDAYS,
  type Category,
  type DataPackV1T,
  type DayStatT,
  type FactT,
  type HoneypotWeekStatsT,
  type Lure,
  type Provider,
  type StoryCandidateT,
  type StoryType,
  type ToolFamily,
  type TopicCategory,
} from "./honeypotPack.js";
import { normNumber, numbersIn } from "../director/v3/numbers.js";

// ── number formatting ───────────────────────────────────────────────────────────────────────────────────────────

/** 33104 → "33,104" (fixed en grouping, no locale data). */
export function fmtInt(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const g = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${g}` : g;
}

/** Round DOWN to 2 significant figures (33,104 → 33,000); null when that changes nothing or n < 1,000. */
export function roundedDown2sf(n: number): number | null {
  if (!Number.isInteger(n) || n < 1000) return null;
  const p = 10 ** (String(n).length - 2);
  const r = Math.floor(n / p) * p;
  return r === n ? null : r;
}

/** Math.round(100*n/total), 0 when total is 0. */
export const sharePct = (n: number, total: number): number => (total > 0 ? Math.round((100 * n) / total) : 0);
/** Math.round(100*(now-before)/before), null when before is 0. */
export const deltaPct = (now: number, before: number): number | null => (before > 0 ? Math.round((100 * (now - before)) / before) : null);

// ── ISO week window (Europe/Zurich) ─────────────────────────────────────────────────────────────────────────────

const ZURICH_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: HP_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Zurich UTC offset (minutes) at one instant. */
export function zurichOffsetMin(utcMs: number): number {
  const p = Object.fromEntries(ZURICH_PARTS.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** UTC instant of local Zurich midnight on y-m-d (midnight never falls in a Zurich DST gap). */
export function zurichMidnightUtc(y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d);
  const t = guess - zurichOffsetMin(guess) * 60000;
  return guess - zurichOffsetMin(t) * 60000;
}

/** "YYYY-MM-DD HH:MM:SS" (UTC), the hits.ts text form. */
export const utcText = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export interface WeekDayWindow {
  date: string; // YYYY-MM-DD (Zurich calendar day)
  weekday: (typeof WEEKDAYS)[number];
  day: number;
  month: (typeof MONTHS)[number];
  year: number;
  startUtc: string;
  endUtc: string;
}
export interface WeekWindow {
  weekKey: string;
  startUtc: string;
  endUtc: string;
  prevStartUtc: string;
  days: WeekDayWindow[]; // 7, Monday first
}

function isoWeeksInYear(y: number): number {
  const dow = (yy: number) => (new Date(Date.UTC(yy, 0, 1)).getUTCDay() + 6) % 7; // Mon=0
  return dow(y) === 3 || (dow(y) === 2 && new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1) ? 53 : 52;
}

/** The Zurich ISO week [Mon 00:00, next Mon 00:00) as UTC text + its 7 day windows + the previous week's start. */
export function isoWeekWindow(weekKey: string): WeekWindow {
  if (!WEEK_KEY_RE.test(weekKey)) throw new Error(`bad week key ${JSON.stringify(weekKey)} (YYYY-Www)`);
  const y = Number(weekKey.slice(0, 4));
  const w = Number(weekKey.slice(6));
  if (w > isoWeeksInYear(y)) throw new Error(`${weekKey}: ${y} has ${isoWeeksInYear(y)} ISO weeks`);
  const jan4 = Date.UTC(y, 0, 4);
  const mon1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
  const monday = mon1 + (w - 1) * 7 * 86400000; // UTC midnight of the Monday's calendar date
  const dayAt = (i: number) => new Date(monday + i * 86400000);
  const midnight = (i: number) => {
    const d = dayAt(i);
    return zurichMidnightUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };
  const days: WeekDayWindow[] = [];
  for (let i = 0; i < 7; i++) {
    const d = dayAt(i);
    days.push({
      date: d.toISOString().slice(0, 10),
      weekday: WEEKDAYS[i],
      day: d.getUTCDate(),
      month: MONTHS[d.getUTCMonth()],
      year: d.getUTCFullYear(),
      startUtc: utcText(midnight(i)),
      endUtc: utcText(midnight(i + 1)),
    });
  }
  return { weekKey, startUtc: days[0].startUtc, endUtc: days[6].endUtc, prevStartUtc: utcText(midnight(-7)), days };
}

/** ISO week key of a calendar date (UTC fields). */
export function isoWeekKeyOf(d: Date): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  const thu = new Date(t + (3 - dow) * 86400000);
  const y = thu.getUTCFullYear();
  const w = 1 + Math.floor((thu.getTime() - Date.UTC(y, 0, 4) + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7) * 86400000) / (7 * 86400000));
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** The last COMPLETE Zurich ISO week before `now` (Monday 02:30 UTC on 2026-11-16 → 2026-W46). */
export function lastFullIsoWeek(now: Date = new Date()): string {
  const off = zurichOffsetMin(now.getTime());
  const local = new Date(now.getTime() + off * 60000); // Zurich wall clock in UTC fields
  return isoWeekKeyOf(new Date(local.getTime() - 7 * 86400000));
}

// ── labels ──────────────────────────────────────────────────────────────────────────────────────────────────────

const SHORT_MONTH = (m: string) => m.slice(0, 3);

/** "9 to 15 November 2026" / "30 November to 6 December 2026" / "28 December 2026 to 3 January 2027". */
export function dateRangeText(a: Pick<DayStatT, "day" | "month" | "year">, b: Pick<DayStatT, "day" | "month" | "year">, sep = " to ", short = false): string {
  const mo = (m: string) => (short ? SHORT_MONTH(m) : m);
  if (a.year !== b.year) return `${a.day} ${mo(a.month)} ${a.year}${sep}${b.day} ${mo(b.month)} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${mo(a.month)}${sep}${b.day} ${mo(b.month)} ${b.year}`;
  return `${a.day}${sep}${b.day} ${mo(b.month)} ${b.year}`;
}

export const weekDateText = (s: Pick<HoneypotWeekStatsT, "daily">): string => dateRangeText(s.daily[0], s.daily[6]);
/** "9–15 Nov 2026". */
export const weekShortRange = (s: Pick<HoneypotWeekStatsT, "daily">): string => dateRangeText(s.daily[0], s.daily[6], "–", true);
/** "2026-W46 · 9–15 Nov 2026". */
export const weekLabel = (s: Pick<HoneypotWeekStatsT, "weekKey" | "daily">): string => `${s.weekKey} · ${weekShortRange(s)}`;
/** "Friday 13 November 2026". */
export const dayText = (d: Pick<DayStatT, "weekday" | "day" | "month" | "year">): string => `${d.weekday} ${d.day} ${d.month} ${d.year}`;

function shiftDay(d: DayStatT, days: number): Pick<DayStatT, "day" | "month" | "year"> {
  const t = new Date(`${d.date}T00:00:00Z`).getTime() + days * 86400000;
  const x = new Date(t);
  return { day: x.getUTCDate(), month: MONTHS[x.getUTCMonth()], year: x.getUTCFullYear() };
}

/** Index of the busiest day (earliest on a tie). */
export function peakIndex(s: Pick<HoneypotWeekStatsT, "daily">): number {
  let best = 0;
  s.daily.forEach((d, i) => {
    if (d.hits > s.daily[best].hits) best = i;
  });
  return best;
}

// ── phrase tables (public wording; closed enums in, fixed text out) ─────────────────────────────────────────────

export const CATEGORY_PHRASE: Readonly<Record<Category, string>> = {
  "env-files": "requests for .env settings files, where apps keep passwords and keys",
  "git-folder": "requests for the hidden .git folder of a code project",
  "cloud-keys": "requests for cloud key files such as .aws/credentials",
  wordpress: "requests for WordPress login and admin pages",
  "graphql-config": "requests for GraphQL endpoints and app config files",
  "ai-gateways": "requests for AI service endpoints and their keys",
  "admin-panels": "requests for admin and login panels",
  "nextjs-probes": "requests probing for Next.js app files",
  "path-traversal": "requests trying to climb out of the web folder with ../ tricks",
  "front-door": "requests for the front page and other ordinary files",
  other: "other requests",
};

export const TOOL_PHRASE: Readonly<Record<ToolFamily, string>> = {
  empty: "sent no software name at all",
  curl: "named curl, a command-line download tool, as their software",
  "python-requests": "named python-requests, a Python programming library, as their software",
  "go-http-client": "named Go-http-client, the Go language's built-in web client, as their software",
  googlebot: "named Googlebot, Google's search crawler, as their software",
  leakix: "named LeakIX, a scanner that indexes exposed services, as their software",
  "declared-bot": "named some other bot or crawler as their software",
  "browser-lookalike": "named an ordinary web browser as their software",
  "other-tool": "named some other tool as their software",
};

export const LURE_PHRASE: Readonly<Record<Lure, string>> = {
  env: "a fake .env file",
  git: "a fake .git/config file",
  wp_login_get: "a fake WordPress login page",
  wp_login_post: "a fake WordPress login answer",
  phpinfo: "a fake PHP info page",
  swagger: "a fake API description file",
  other: "another fake page",
};

/** "a Google server" … (provider = the hosting network's org, mapped in SQL). */
export const PROVIDER_PHRASE: Readonly<Record<Provider, string>> = {
  "Google Cloud": "a Google server",
  AWS: "an Amazon (AWS) server",
  "Microsoft Azure": "a Microsoft server",
  DigitalOcean: "a DigitalOcean server",
  "Oracle Cloud": "an Oracle Cloud server",
  Cloudflare: "a Cloudflare server",
  OVH: "an OVH server",
  Hetzner: "a Hetzner server",
  Alibaba: "an Alibaba Cloud server",
  Tencent: "a Tencent Cloud server",
  "other-hosting": "a server at another hosting company",
  "home-or-office": "a home or office internet connection",
};

/** One defensive line per topic (caption). No numbers, no payloads. */
export const TOPIC_ADVICE: Readonly<Record<TopicCategory, string>> = {
  "env-files": "Keep .env files out of the folder your web server hands out, and check that asking for one gets a 404.",
  "git-folder": "Never deploy the .git folder with your site, and check that asking for /.git/config gets a 404.",
  "cloud-keys": "Keep cloud key files off web servers entirely; use short-lived credentials instead.",
  wordpress: "Use a long unique password and two-factor login on WordPress, and limit login attempts.",
  "graphql-config": "Turn off GraphQL introspection in production and keep config files out of the web folder.",
  "ai-gateways": "Never put AI API keys in front-end code or public config files; rotate any that leaked.",
  "admin-panels": "Put admin panels behind a VPN or single sign-on instead of the open internet.",
  "nextjs-probes": "Keep your framework updated and never serve build or config files publicly.",
  "path-traversal": "Normalise paths on the server and never build file paths from raw request input.",
};

/** The fixed "about this honeypot" sentence (supports a hook-object-today claim for the pack's own week). */
export const ABOUT_SENTENCE = "This honeypot is a decoy server that pretends to be a cloud API and records every request it receives";
export const COUNTRY_CAVEAT = "Countries in this report are where the sending server is hosted, not who runs it.";

/** Country names that read with "the" inside a sentence. */
const THE_COUNTRIES = new Set(["United States", "United Kingdom", "Netherlands", "Czech Republic", "Philippines", "United Arab Emirates", "Russian Federation", "Dominican Republic", "Bahamas", "Maldives", "Seychelles", "Gambia"]);
export const countryInSentence = (c: string): string => (THE_COUNTRIES.has(c) ? `the ${c}` : c);

const SECRET_PATH_RE = /^\/(?:(?:api|admin)\/)?\.env|^\/\.git\/|^\/\.aws\//;

// ── facts ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fixed ids: F00–F24 singletons, F30+i categories (CATEGORIES order), F50+i tools, F60+i lures. */
export const FACT_ID = {
  about: "F00",
  total: "F01",
  ips: "F02",
  paths: "F03",
  peak: "F04",
  daily: "F05",
  secrets: "F06",
  topSecret: "F07",
  pathList: "F08",
  burst: "F09",
  burstCountry: "F10",
  hostingShare: "F11",
  countryCaveat: "F12",
  countries: "F13",
  delta: "F14",
  prevWeek: "F15",
  ownName: "F16",
  dictPw: "F17",
  wpLogins: "F18",
  novelWeek: "F19",
  novelCluster: "F20",
  topPasswords: "F21",
  topUsernames: "F22",
  yearPw: "F23",
  lureTotal: "F24",
} as const;
export const categoryFactId = (c: Category): string => `F${30 + CATEGORIES.indexOf(c)}`;
export const toolFactId = (t: ToolFamily): string => `F${50 + TOOL_FAMILIES.indexOf(t)}`;
const LURE_ORDER: readonly Lure[] = ["env", "git", "wp_login_get", "wp_login_post", "phpinfo", "swagger", "other"];
export const lureFactId = (l: Lure): string => `F${60 + LURE_ORDER.indexOf(l)}`;

const withRounded = (n: number): string => {
  const r = roundedDown2sf(n);
  return r === null ? fmtInt(n) : `${fmtInt(n)} (more than ${fmtInt(r)})`;
};
const times = (n: number) => (n === 1 ? "1 time" : `${fmtInt(n)} times`);

/** Share of the top burst (null without bursts). */
export const burstShare = (s: HoneypotWeekStatsT): number | null => (s.bursts.length ? sharePct(s.bursts[0].hits, s.totals.hits) : null);
export const secretHits = (s: HoneypotWeekStatsT): number => s.categories.filter((c) => (SECRET_CATEGORIES as readonly string[]).includes(c.category)).reduce((a, c) => a + c.hits, 0);

/** The week's quote-ready sentences, sorted by id. Deterministic: same stats → byte-identical facts. */
export function renderFacts(s: HoneypotWeekStatsT): FactT[] {
  const W = weekDateText(s);
  const from = `From ${W},`;
  const t = s.totals;
  const f: FactT[] = [];
  const add = (id: string, text: string) => f.push({ id, text });

  add(FACT_ID.about, `${ABOUT_SENTENCE}; this report covers ${W}.`);
  add(FACT_ID.total, `${from} the honeypot logged ${withRounded(t.hits)} requests.`);
  add(FACT_ID.ips, `${from} the requests came from ${fmtInt(t.ips)} different internet addresses.`);
  add(FACT_ID.paths, `${from} the requests asked for ${fmtInt(t.paths)} different paths.`);
  const pk = s.daily[peakIndex(s)];
  add(FACT_ID.peak, `The busiest day from ${W} was ${dayText(pk)}, with ${withRounded(pk.hits)} requests.`);
  add(FACT_ID.daily, `Requests per day from ${W}: ${s.daily.map((d) => `${d.weekday} ${d.day} ${d.month} ${fmtInt(d.hits)}`).join("; ")}.`);

  const sec = secretHits(s);
  if (sec > 0) add(FACT_ID.secrets, `${from} there were ${withRounded(sec)} requests for secret files such as .env, .git/config and .aws/credentials.`);
  const secretPaths = s.paths.filter((p) => SECRET_PATH_RE.test(p.path) && p.hits > 0).sort((a, b) => b.hits - a.hits);
  if (secretPaths.length) add(FACT_ID.topSecret, `The most requested secret file from ${W} was ${secretPaths[0].path}, asked for ${times(secretPaths[0].hits)}.`);
  const listed = s.paths.filter((p) => p.hits > 0);
  if (listed.length) add(FACT_ID.pathList, `${from} the most requested of the paths this report names were: ${listed.map((p) => `${p.path} ${times(p.hits)}`).join("; ")}.`);

  const b = s.bursts[0];
  const bs = burstShare(s);
  if (b && b.hits > 0) {
    const share = bs !== null && bs >= 20 ? `, ${bs} percent of the week's requests,` : "";
    add(FACT_ID.burst, `${from} the busiest single source sent ${fmtInt(b.hits)} requests${share} from ${PROVIDER_PHRASE[b.provider]}.`);
    add(FACT_ID.burstCountry, `The country listed for the busiest single source from ${W} is ${countryInSentence(b.country)}; that is where its server is hosted, not who runs it.`);
  }
  const hostingHits = s.hosting.filter((h) => h.provider !== "home-or-office").reduce((a, h) => a + h.hits, 0);
  if (t.hits > 0 && s.hosting.length) add(FACT_ID.hostingShare, `${from} ${sharePct(hostingHits, t.hits)} percent of the requests came from servers at hosting and cloud companies.`);
  add(FACT_ID.countryCaveat, COUNTRY_CAVEAT);
  const cs = s.countries.filter((c) => c.hits > 0);
  if (cs.length) add(FACT_ID.countries, `${from} the top hosting countries by requests were: ${cs.map((c) => `${c.country} ${fmtInt(c.hits)}`).join("; ")}.`);

  const prevRange = dateRangeText(shiftDay(s.daily[0], -7), shiftDay(s.daily[0], -1));
  const dp = deltaPct(t.hits, s.prevHits);
  if (dp !== null) {
    const rel = dp > 0 ? `${dp} percent more requests than` : dp < 0 ? `${-dp} percent fewer requests than` : "about the same number of requests as";
    add(FACT_ID.delta, `${from} the honeypot logged ${rel} in the week before, from ${prevRange}.`);
  }
  add(FACT_ID.prevWeek, `In the week before, from ${prevRange}, the honeypot logged ${fmtInt(s.prevHits)} requests.`);

  const c = s.creds;
  if (c.siteNamePw >= 5 && t.wpPosts >= 20) add(FACT_ID.ownName, `${from} ${fmtInt(c.siteNamePw)} login attempts on the fake WordPress login page used a password built from the site's own name.`);
  if (c.dictPw > 0) add(FACT_ID.dictPw, `${from} ${c.dictPw === 1 ? "1 login attempt" : `${fmtInt(c.dictPw)} login attempts`} on the fake WordPress login page used ${c.dictPw === 1 ? "a password" : "passwords"} from public lists of common passwords.`);
  if (t.wpPosts > 0) add(FACT_ID.wpLogins, `${from} the fake WordPress login page received ${t.wpPosts === 1 ? "1 login attempt" : `${fmtInt(t.wpPosts)} login attempts`}.`);
  if (s.novel.paths > 0) add(FACT_ID.novelWeek, `${from} the honeypot was asked for ${fmtInt(s.novel.paths)} different paths it had not seen in the 180 days before.`);
  const cl = s.novel.cluster;
  const clDay = cl ? s.daily.find((d) => d.date === cl.date) : undefined;
  if (cl && clDay && cl.paths > 0) {
    const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
    add(FACT_ID.novelCluster, `In one hour on ${dayText(clDay)}, between ${hh(cl.hour)} and ${hh((cl.hour + 1) % 24)} Zurich time, ${fmtInt(cl.ips)} different internet addresses asked for ${fmtInt(cl.paths)} paths the honeypot had not seen in the 180 days before.`);
  }
  const pw = c.passwords.filter((p) => p.n > 0);
  if (pw.length) add(FACT_ID.topPasswords, `The most common passwords tried on the fake WordPress login page from ${W} were: ${pw.map((p) => `${p.value} (${times(p.n)})`).join("; ")}.`);
  const us = c.usernames.filter((u) => u.n > 0);
  if (us.length) add(FACT_ID.topUsernames, `The most common usernames tried on the fake WordPress login page from ${W} were: ${us.map((u) => `${u.value} (${times(u.n)})`).join("; ")}.`);
  if (c.yearPw > 0) add(FACT_ID.yearPw, `${from} ${c.yearPw === 1 ? "1 login attempt" : `${fmtInt(c.yearPw)} login attempts`} on the fake WordPress login page used a password containing a year.`);
  if (t.lureHits > 0) add(FACT_ID.lureTotal, `${from} the honeypot answered ${fmtInt(t.lureHits)} requests with a fake file or page.`);

  for (const cat of s.categories) {
    if (cat.category === "other" || cat.hits <= 0) continue;
    add(categoryFactId(cat.category), `${from} there were ${fmtInt(cat.hits)} ${CATEGORY_PHRASE[cat.category]}, from ${fmtInt(cat.ips)} different internet addresses.`);
  }
  for (const tool of s.tools) {
    if (tool.hits <= 0) continue;
    add(toolFactId(tool.family), `${from} ${fmtInt(tool.hits)} requests ${TOOL_PHRASE[tool.family]}.`);
  }
  for (const l of s.lures) {
    if (l.hits <= 0 || l.lure === "wp_login_post" || l.lure === "other") continue;
    add(lureFactId(l.lure), `${from} the honeypot answered ${fmtInt(l.hits)} requests with ${LURE_PHRASE[l.lure]}.`);
  }
  return f.sort((a, b2) => a.id.localeCompare(b2.id));
}

// ── topic + stories ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The week's topic: the largest topic category (never front-door / other). A tie for first, or a repeat of last
 * week's topic, goes to the runner-up. No category with hits → env-files.
 */
export function pickTopic(s: Pick<HoneypotWeekStatsT, "categories">, lastTopic?: TopicCategory | null): TopicCategory {
  const ranked = TOPIC_CATEGORIES.map((c) => ({ c, hits: s.categories.find((x) => x.category === c)?.hits ?? 0 }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || TOPIC_CATEGORIES.indexOf(a.c) - TOPIC_CATEGORIES.indexOf(b.c));
  if (!ranked.length) return "env-files";
  const runnerUp = ranked[1];
  if (runnerUp && (runnerUp.hits === ranked[0].hits || ranked[0].c === lastTopic)) return runnerUp.c;
  return ranked[0].c;
}

/** Every eligible story, in fixed rank order (novel-cluster, burst, own-name, wp-logins). Fact ids exist in renderFacts. */
export function storyCandidates(s: HoneypotWeekStatsT): StoryCandidateT[] {
  const out: StoryCandidateT[] = [];
  const cl = s.novel.cluster;
  if (cl && cl.paths >= 20 && s.daily.some((d) => d.date === cl.date) && s.novel.paths > 0) out.push({ type: "novel-cluster", factIds: [FACT_ID.novelCluster, FACT_ID.novelWeek] });
  const bs = burstShare(s);
  if (bs !== null && bs >= 25) out.push({ type: "burst", factIds: [FACT_ID.burst, FACT_ID.burstCountry, FACT_ID.countryCaveat] });
  if (s.creds.siteNamePw >= 5 && s.totals.wpPosts >= 20) out.push({ type: "own-name", factIds: [FACT_ID.ownName, FACT_ID.wpLogins] });
  if (s.totals.wpPosts >= 20) {
    const ids: string[] = [FACT_ID.wpLogins];
    if (s.creds.dictPw > 0) ids.push(FACT_ID.dictPw);
    if (s.creds.passwords.some((p) => p.n > 0)) ids.push(FACT_ID.topPasswords);
    out.push({ type: "wp-logins", factIds: ids });
  }
  return out;
}

/**
 * Rotation: never the same lead story type 3 weeks running. `recentLeads` = the lead types of the last weeks, most
 * recent first. Returns ≤ 3 candidates.
 */
export function pickStories(cands: readonly StoryCandidateT[], recentLeads: readonly StoryType[] = []): StoryCandidateT[] {
  const list = [...cands];
  if (list.length > 1 && recentLeads.length >= 2 && recentLeads[0] === recentLeads[1] && list[0].type === recentLeads[0]) list.push(list.shift()!);
  return list.slice(0, 3);
}

// ── terminal + caption ──────────────────────────────────────────────────────────────────────────────────────────

/** ≤ 16 lines of ≤ 46 chars: a header + "GET <allowlisted path>  <count>" from the Q5 literals only. */
export function terminalLines(s: HoneypotWeekStatsT): string[] {
  const rows = s.paths.filter((p) => p.hits > 0).slice(0, 8);
  if (!rows.length) return [];
  const lines = [`# top requests, ${weekShortRange(s)}`];
  for (const p of rows) lines.push(`GET ${p.path.padEnd(TERMINAL_MAX_CHARS - 16)}${fmtInt(p.hits).padStart(12)}`);
  return lines.map((l) => l.slice(0, TERMINAL_MAX_CHARS));
}

/** The deterministic Instagram caption (+ a NUMBERS (verbatim) block). Every number is a fact number. */
export function renderCaption(s: HoneypotWeekStatsT, topic: TopicCategory): string {
  const pk = s.daily[peakIndex(s)];
  const topicCat = s.categories.find((c) => c.category === topic);
  const nums = [`${fmtInt(s.totals.hits)} requests in 7 days`, `busiest day: ${pk.weekday} ${pk.day} ${SHORT_MONTH(pk.month)}, ${fmtInt(pk.hits)} requests`];
  if (topicCat && topicCat.hits > 0) nums.push(`${fmtInt(topicCat.hits)} ${CATEGORY_PHRASE[topic]}`);
  const sec = secretHits(s);
  if (sec > 0 && !(SECRET_CATEGORIES as readonly string[]).includes(topic)) nums.push(`${fmtInt(sec)} requests for secret files (.env, .git/config, .aws/credentials)`);
  return [
    `My honeypot, ${weekShortRange(s)}.`,
    "",
    "A honeypot is a decoy server. Mine pretends to be a cloud API and writes down every request it gets.",
    "",
    "NUMBERS (verbatim):",
    ...nums.map((n) => `- ${n}`),
    COUNTRY_CAVEAT,
    "",
    TOPIC_ADVICE[topic],
    "",
    "#honeypot #cybersecurity #infosec #webdev #devops",
  ].join("\n");
}

// ── pack ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Numbers allowed beyond the facts: 404 (the payoff), 7 (days), the week's years and day-of-month labels. */
export function packConstants(s: HoneypotWeekStatsT): string[] {
  const c = new Set<string>(["404", "7"]);
  for (const d of s.daily) {
    c.add(String(d.year));
    c.add(String(d.day));
  }
  return [...c].sort((a, b) => Number(a) - Number(b));
}

/** Numbers in `text` that are not in the pack's numberSet (empty = every number is a pack number). */
export function foreignNumbers(text: string, set: ReadonlySet<string> | readonly string[]): string[] {
  const have = set instanceof Set ? set : new Set(set as readonly string[]);
  return [...new Set(numbersIn(text).map(normNumber))].filter((n) => !have.has(n));
}

export interface BuildPackOptions {
  /** Last week's topic (history.json), for the no-repeat rule. */
  lastTopic?: TopicCategory | null;
  /** Lead story types of the previous weeks, most recent first (history.json). */
  recentLeads?: readonly StoryType[];
}

/** stats → a complete, validated DataPackV1 (throws when the result would not validate, e.g. a deny hit). */
export function buildPack(stats: HoneypotWeekStatsT, opts: BuildPackOptions = {}): DataPackV1T {
  const facts = renderFacts(stats);
  const topic = pickTopic(stats, opts.lastTopic);
  const constants = packConstants(stats);
  const pack = {
    schema: HP_SCHEMA_VERSION,
    kind: HP_KIND,
    weekKey: stats.weekKey,
    label: weekLabel(stats),
    dateText: weekDateText(stats),
    topic,
    codename: CODENAMES[topic],
    stats,
    stories: pickStories(storyCandidates(stats), opts.recentLeads),
    facts,
    terminalLines: terminalLines(stats),
    caption: renderCaption(stats, topic),
    constants,
    numberSet: numberSet(facts.map((x) => x.text), constants),
  };
  const r = DataPackV1.safeParse(pack);
  if (!r.success) throw new Error(`pack invalid: ${r.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  const problems = verifyRendered(r.data);
  if (problems.length) throw new Error(`pack inconsistent: ${problems.join("; ")}`);
  return r.data;
}

/**
 * Re-render a pack's parts from its stats and compare (container side: a pack whose sentences, lines, caption,
 * constants or numbers differ from the templates is refused). Stories are checked against the eligible candidates
 * (rotation depends on history the container does not have). Returns problems (empty = consistent).
 */
export function verifyRendered(p: DataPackV1T): string[] {
  const out: string[] = [];
  const s = p.stats;
  if (JSON.stringify(renderFacts(s)) !== JSON.stringify(p.facts)) out.push("facts differ from the templates");
  if (JSON.stringify(terminalLines(s)) !== JSON.stringify(p.terminalLines)) out.push("terminalLines differ from the templates");
  if (renderCaption(s, p.topic) !== p.caption) out.push("caption differs from the template");
  if (weekLabel(s) !== p.label || weekDateText(s) !== p.dateText) out.push("label/dateText differ");
  if (JSON.stringify(packConstants(s)) !== JSON.stringify(p.constants)) out.push("constants differ");
  const cands = storyCandidates(s);
  for (const st of p.stories) if (!cands.some((c) => c.type === st.type && JSON.stringify(c.factIds) === JSON.stringify(st.factIds))) out.push(`story ${st.type} is not an eligible candidate`);
  const set = new Set(p.numberSet);
  const fn = [...p.terminalLines, p.caption, p.label].flatMap((t) => foreignNumbers(t, set));
  if (fn.length) out.push(`numbers outside the pack: ${[...new Set(fn)].join(", ")}`);
  // Dates: every day label must be the real weekday of its date.
  for (const d of s.daily) {
    const wd = WEEKDAYS[(new Date(`${d.date}T00:00:00Z`).getUTCDay() + 6) % 7];
    if (wd !== d.weekday || MONTHS[Number(d.date.slice(5, 7)) - 1] !== d.month || Number(d.date.slice(8, 10)) !== d.day || Number(d.date.slice(0, 4)) !== d.year) out.push(`day label ${d.date} is wrong`);
  }
  const win = isoWeekWindow(s.weekKey);
  if (JSON.stringify(s.daily.map((d) => d.date)) !== JSON.stringify(win.days.map((d) => d.date))) out.push(`daily dates are not the days of ${s.weekKey}`);
  if (s.window.startUtc !== win.startUtc || s.window.endUtc !== win.endUtc || s.window.prevStartUtc !== win.prevStartUtc) out.push(`window is not the Zurich ISO week ${s.weekKey}`);
  return out;
}
