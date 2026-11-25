// Remotion entry of the v3 DEV site (W3b; ADR-002 §9.3): REEL_V2_SITE_NAME=reel-studio-v3-dev scripts/v2/deploy-dev.sh
// remotion/v3/index.ts. Only ExplainerV3 — the live site (remotion/index.ts) is untouched until the W6 cut-over.
import { registerRoot } from "remotion";
import { RemotionRootV3 } from "./Root";

registerRoot(RemotionRootV3);
