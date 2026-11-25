// D1-hook composition group: own entry (remotion/v3lab/hook/index.ts) deployed to its own lab site, so the live/dev
// bundle (remotion/index.ts + remotion/Root.tsx, LIBRARY_HASH) and the R3/R6 lab bundles stay untouched.
import React from "react";
import { Composition } from "remotion";
import { HOOK_DEFAULTS, HOOK_DURATION_F, HookTLS } from "./HookTLS";

export const HookRoot: React.FC = () => (
  <Composition id="V3LabHookTLS" component={HookTLS} width={1080} height={1920} fps={30} durationInFrames={HOOK_DURATION_F} defaultProps={HOOK_DEFAULTS} />
);
