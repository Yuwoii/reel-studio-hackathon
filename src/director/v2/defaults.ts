// Production wiring for the v2 director: the real fresh judge (P1 runJudge), the claim fact check (W3.2: P1's v3
// checker as the drop-in runNarrationFactCheck — quotes-only support, offending words, convergence on its own rewrites;
// REEL_V2_FACTCHECK=v1 falls back to research.ts runFactCheck), the rewrite shortener (research.ts runShortenFix),
// on-screen text: P1 runFactCheckV3, props only), the whole-reel mechanism check (W3.3, research.ts
// runMechanismCheck), edge-tts (P2 ttsWords), Lambda review stills on the DEV site (P2 renderReviewStills,
// ledger-guarded; never the live "reel-studio" site), the L15 pin of the dev site and the P4 catalogue. Tests never import this file (they inject fakes into createDirectorV2).

import path from "node:path";
import { renderReviewStills } from "../../v2/ops/stills.js";
import { DEV_SITE, pinnedSiteHash } from "../../v2/ops/siteHash.js";
import { ROOT } from "../../v2/ops/root.js";
import { ttsWords } from "../../v2/ops/tts.js";
import { componentCatalogueV2 } from "./catalogue.js";
import type { DirectorV2Module } from "./contracts.js";
import { createDirectorV2, type DirectorV2Options } from "./index.js";
import { runJudge } from "./judge.js";
import { runFactCheck, runMechanismCheck, runShortenFix } from "./research.js";
import { runFactCheckV3, runNarrationFactCheck } from "./factcheck.js";
import { runCritic } from "./critic.js";
import { runClarityCheck } from "./clarity.js";
import { runPhysicsCheck } from "./physics.js";

export interface DefaultDirectorV2Options extends Partial<DirectorV2Options> {
  env?: NodeJS.ProcessEnv;
}

export function createDefaultDirectorV2(o: DefaultDirectorV2Options = {}): DirectorV2Module {
  const env = o.env ?? process.env;
  const dataDir = o.dataDir ?? path.resolve(env.DATA_DIR?.trim() || path.join(ROOT, "data"));
  const jobsDir = o.jobsDir ?? path.resolve(env.JOBS_DIR?.trim() || path.join(ROOT, "jobs"));
  return createDirectorV2({
    judge: runJudge,
    factCheck: env.REEL_V2_FACTCHECK?.trim().toLowerCase() === "v1" ? runFactCheck : runNarrationFactCheck,
    propFactCheck: runFactCheckV3,
    shortenFix: runShortenFix,
    // W3.3: whole-reel causal-chain check after the line fact check (fail closed; tools.ts checkMechanism)
    // W5: production requires the entity-identity + climax tables (the recorded W3.3 replays predate them)
    mechanismCheck: (a) => runMechanismCheck({ ...a, requireStructure: true }),
    // W5: the independent §13 vision critic in save_job (critic.ts runCritic)
    critic: runCritic,
    // W7: the fresh plain-language gate in score_script (scripts with a story)
    clarity: runClarityCheck,
    // W7.1: the physics judge for how-it-works reels (submit_storyboard + save_job)
    physics: runPhysicsCheck,
    tts: ttsWords,
    stills: (s) => renderReviewStills({ ...s, site: DEV_SITE, env }),
    pinnedLibraryHash: () => pinnedSiteHash(DEV_SITE),
    catalogue: () => componentCatalogueV2(),
    env,
    ...o,
    jobsDir,
    dataDir,
  });
}

export { createDefaultDirectorV2 as createDirectorV2Default };
