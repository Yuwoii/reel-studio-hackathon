// R6 quality lab root (own entry remotion/v3lab/quality/index.ts, lab site reel-studio-v2-v3lab). Registers the
// UNMODIFIED v2 Explainer (baseline, same bundle) and ExplainerLab (time-base wrapper, fpsMul 1|2).
import React from "react";
import { Composition } from "remotion";
import { calculateExplainerMetadata, Explainer, EXPLAINER_ID, type ExplainerProps } from "../../v2/Explainer";
import explainerFixture from "../../v2/fixtures/oomkill.json";
import { calculateExplainerLabMetadata, ExplainerLab, EXPLAINER_LAB_ID, type ExplainerLabProps } from "./ExplainerLab";

const base = { ...(explainerFixture as unknown as ExplainerProps), blur: true, debug: false } satisfies ExplainerProps;

export const QualityLabRoot: React.FC = () => (
  <>
    <Composition id={EXPLAINER_ID} component={Explainer} width={1080} height={1920} fps={30} durationInFrames={2400} defaultProps={base} calculateMetadata={calculateExplainerMetadata} />
    <Composition id={EXPLAINER_LAB_ID} component={ExplainerLab} width={1080} height={1920} fps={30} durationInFrames={2400} defaultProps={{ ...base, fpsMul: 1 } as ExplainerLabProps} calculateMetadata={calculateExplainerLabMetadata} />
  </>
);
