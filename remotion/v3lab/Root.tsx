// v3lab composition group (R3 proofs). Own entry (remotion/v3lab/index.ts) so the live/dev bundle (remotion/index.ts,
// remotion/Root.tsx) and LIBRARY_HASH are untouched. All 1080×1920, 30 fps, 300 frames, muted.
import React from "react";
import { Composition } from "remotion";
import { ProofP1 } from "./ProofP1";
import { P2_DEFAULTS, ProofP2 } from "./ProofP2";
import { P3_DEFAULTS, ProofP3 } from "./ProofP3";
import { ProofP4 } from "./ProofP4";

const base = { width: 1080, height: 1920, fps: 30, durationInFrames: 300 } as const;

export const V3LabRoot: React.FC = () => (
  <>
    <Composition id="V3LabP1" component={ProofP1} {...base} />
    <Composition id="V3LabP2" component={ProofP2} {...base} defaultProps={P2_DEFAULTS} />
    <Composition id="V3LabP3" component={ProofP3} {...base} defaultProps={P3_DEFAULTS} />
    <Composition id="V3LabP4" component={ProofP4} {...base} />
  </>
);
