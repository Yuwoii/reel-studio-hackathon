// v3 dev-site root (W3b): registers "ExplainerV3" — the single v3 composition (remotion/v3/ExplainerV3.tsx), driven by a
// PARSED storyboard v3.0 + words.json. defaultProps = the TLS hook fixture (fixtures/tls-hook.json: research/v3/W3b/
// tls-hook.board.json parsed host-side + the W2 measured words for b01–b04), so `remotion studio remotion/v3/index.ts`
// shows the hook. W6 cut-over: ExplainerV3 is also registered in remotion/Root.tsx (ADR-002 §9.3), so the live site
// bundle (remotion/index.ts) carries it next to v1 Reel and v2 Explainer.
import React from "react";
import { Composition } from "remotion";
import { calculateExplainerV3Metadata, EXPLAINER_V3_ID, ExplainerV3, type ExplainerV3Props } from "./ExplainerV3";
import hookFixture from "./fixtures/tls-hook.json";

const defaultProps = { ...(hookFixture as unknown as ExplainerV3Props), blur: true, debug: false } satisfies ExplainerV3Props;

export const RemotionRootV3: React.FC = () => (
  <Composition id={EXPLAINER_V3_ID} component={ExplainerV3} width={1080} height={1920} fps={30} durationInFrames={2400} defaultProps={defaultProps} calculateMetadata={calculateExplainerV3Metadata} />
);
