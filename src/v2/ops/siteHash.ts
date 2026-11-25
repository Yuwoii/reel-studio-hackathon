// Deployed v2 site records (data/sites/<reel-studio-v2-* | reel-studio>/site.json) — L15 pinned hash + serveUrl.
// Moved from scripts/v2/site-hash.ts (W3 P2) so the container-bound director (rootDir=src) can use it; the script keeps
// the check/stamp CLI and re-exports these. Reads only data/sites/<name>/site.json — never data/site.json (the v1 bot's
// pointer to the live site "reel-studio"). W6: the LIVE site "reel-studio" also gets a v2 record,
// data/sites/reel-studio/site.json (deploy-dev.sh with REEL_V2_SITE_NAME=reel-studio stamps its libraryHash); the final
// v2 render reads it through liveServeUrl(). Review stills stay on reel-studio-v2-* (renderReviewStills refuses the live
// site itself). No secrets involved.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./root.js";

/** The v2 dev site (deploy-dev.sh / npm run v2:render-dev -- deploy). */
export const DEV_SITE = "reel-studio-v2-dev";
export const V2_SITE_RE = /^reel-studio-v2-[a-z0-9-]+$/;
/** W6: the live site (v1 Reel + v2 Explainer in one bundle); the v2 final render's default site. */
export const LIVE_SITE = "reel-studio";

export function siteJsonPath(siteName: string, root = ROOT): string {
  if (!V2_SITE_RE.test(siteName) && siteName !== LIVE_SITE) throw new Error(`refusing: "${siteName}" is not a reel-studio-v2-* site`);
  return path.join(root, "data", "sites", siteName, "site.json");
}

/** The libraryHash recorded for a deployed v2 site, or undefined (older deploys did not record one). */
export function pinnedSiteHash(siteName: string, root = ROOT): string | undefined {
  const f = siteJsonPath(siteName, root);
  if (!existsSync(f)) return undefined;
  const h = (JSON.parse(readFileSync(f, "utf8")) as { libraryHash?: unknown }).libraryHash;
  return typeof h === "string" && /^[0-9a-f]{64}$/.test(h) ? h : undefined;
}

/** serveUrl of a deployed reel-studio-v2-* site; throws unless site.json names that same v2 site. */
export function devServeUrl(siteName = DEV_SITE, root = ROOT): string {
  const f = siteJsonPath(siteName, root);
  if (!existsSync(f)) throw new Error(`${path.relative(root, f)} missing — run: npm run v2:render-dev -- deploy`);
  const s = JSON.parse(readFileSync(f, "utf8")) as { serveUrl?: unknown; siteName?: unknown };
  if (typeof s.siteName !== "string" || typeof s.serveUrl !== "string" || !/^reel-studio-v2-/.test(s.siteName) || s.siteName !== siteName || !s.serveUrl.includes(`/sites/${s.siteName}/`)) {
    throw new Error(`refusing: ${f} does not point at a reel-studio-v2-* site`);
  }
  return s.serveUrl;
}

/** serveUrl of the LIVE site from its v2 record data/sites/reel-studio/site.json (W6 final render); throws unless the
 *  record names that site and its serveUrl is that site's bundle. Never reads data/site.json. */
export function liveServeUrl(siteName = LIVE_SITE, root = ROOT): string {
  if (siteName !== LIVE_SITE && !V2_SITE_RE.test(siteName)) throw new Error(`refusing: "${siteName}" is neither ${LIVE_SITE} nor a reel-studio-v2-* site`);
  const f = siteJsonPath(siteName, root);
  if (!existsSync(f)) throw new Error(`${path.relative(root, f)} missing — deploy it: REEL_V2_SITE_NAME=${siteName} scripts/v2/deploy-dev.sh`);
  const s = JSON.parse(readFileSync(f, "utf8")) as { serveUrl?: unknown; siteName?: unknown };
  if (s.siteName !== siteName || typeof s.serveUrl !== "string" || !/^https:\/\//.test(s.serveUrl) || !s.serveUrl.includes(`/sites/${siteName}/`)) {
    throw new Error(`refusing: ${f} does not point at the site ${siteName}`);
  }
  return s.serveUrl;
}
