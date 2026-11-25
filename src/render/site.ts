// Where the deployed Remotion site lives: REEL_SITE_URL env, else data/site.json (written by scripts/deploy-site.sh).

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SiteInfo {
  serveUrl: string;
  siteName: string;
  bucketName?: string;
  deployedAt: string;
  remotionVersion: string;
  functionName?: string;
}

export function siteFile(dataDir: string): string {
  return path.join(dataDir, "site.json");
}

/** null when nothing is configured (→ Lambda "not-configured"). */
export function resolveServeUrl(env: NodeJS.ProcessEnv, dataDir: string): string | null {
  const fromEnv = env.REEL_SITE_URL?.trim();
  if (fromEnv) return fromEnv;
  const f = siteFile(dataDir);
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as Partial<SiteInfo>;
    return typeof j.serveUrl === "string" && /^https:\/\//.test(j.serveUrl) ? j.serveUrl : null;
  } catch {
    return null;
  }
}

export async function writeSiteInfo(dataDir: string, info: SiteInfo): Promise<string> {
  await mkdir(dataDir, { recursive: true });
  const f = siteFile(dataDir);
  const tmp = `${f}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(info, null, 2) + "\n");
  await rename(tmp, f);
  return f;
}
