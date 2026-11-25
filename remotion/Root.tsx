// Registers the single "Reel" composition: 1080×1920 @ 30 fps; calculateMetadata sizes it from the beat audio.
// defaultProps = the snow-pixel sample with synthetic (silent) timings so `npm run studio` works out of the box.
// v2 (Phase B): also registers "Explainer" — the single ROOT CAUSE composition (remotion/v2/Explainer.tsx), driven by a
// parsed storyboard v2.1 + words.json; defaultProps = the W0 OOMKILL fixture (remotion/v2/fixtures/oomkill.json).
// W2: "V2Gallery" renders ONE library component standalone from a component fixture (test/fixtures/v2/components/
// <Name>.json passed as inputProps; default = StatusCard) — see remotion/v2/components/README.md.
// v3 W6 cut-over (ADR-002 §9.3): also registers "ExplainerV3" (remotion/v3/ExplainerV3.tsx, the v3 real-object
// composition; defaultProps = the TLS hook fixture), so ONE live bundle carries v1 Reel + v2 Explainer + v3
// ExplainerV3 and REEL_PIPELINE can be flipped v2 ⇄ v3 without a redeploy.

import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import snowConfig from "../samples/snow-pixel/config.json";
import snowScript from "../samples/snow-pixel/script.json";
import { normalizeConfig, normalizeScript } from "./normalize";
import { ReelComposition, type ReelCompositionProps } from "./ReelComposition";
import { synthBeatAudio } from "./synthAudio";
import { COMPOSITION_ID, FPS, HEIGHT, totalFrames, WIDTH } from "./timing";
import { calculateExplainerMetadata, Explainer, EXPLAINER_ID, type ExplainerProps } from "./v2/Explainer";
import explainerFixture from "./v2/fixtures/oomkill.json";
import { calculateGalleryMetadata, Gallery, GALLERY_ID } from "./v2/Gallery";
import { galleryDefaultProps } from "./v2/galleryDefaults";
import { calculateExplainerV3Metadata, EXPLAINER_V3_ID, ExplainerV3, type ExplainerV3Props } from "./v3/ExplainerV3";
import explainerV3Fixture from "./v3/fixtures/tls-hook.json";

const sampleScript = normalizeScript(snowScript);

export const defaultReelProps: ReelCompositionProps = {
  script: sampleScript,
  config: normalizeConfig(snowConfig),
  audio: synthBeatAudio(sampleScript.beats),
  debugSafeZone: false,
};

export const calculateReelMetadata: CalculateMetadataFunction<ReelCompositionProps> = ({ props }) => {
  const n = props.script?.beats?.length ?? 0;
  // fall back to 3 s per beat when audio is missing (same placeholder ReelComposition uses)
  const audio = Array.from({ length: n }, (_, i) => props.audio?.[i] ?? { durationSec: 3 });
  return { durationInFrames: Math.max(1, totalFrames(audio)), fps: FPS, width: WIDTH, height: HEIGHT };
};

const defaultExplainerProps = { ...(explainerFixture as unknown as ExplainerProps), blur: true, debug: false } satisfies ExplainerProps;
const defaultExplainerV3Props = { ...(explainerV3Fixture as unknown as ExplainerV3Props), blur: true, debug: false } satisfies ExplainerV3Props;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id={COMPOSITION_ID}
      component={ReelComposition}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={Math.max(1, totalFrames(defaultReelProps.audio))}
      defaultProps={defaultReelProps}
      calculateMetadata={calculateReelMetadata}
    />
    <Composition
      id={EXPLAINER_ID}
      component={Explainer}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={2400}
      defaultProps={defaultExplainerProps}
      calculateMetadata={calculateExplainerMetadata}
    />
    <Composition
      id={GALLERY_ID}
      component={Gallery}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={160}
      defaultProps={galleryDefaultProps}
      calculateMetadata={calculateGalleryMetadata}
    />
    <Composition
      id={EXPLAINER_V3_ID}
      component={ExplainerV3}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={2400}
      defaultProps={defaultExplainerV3Props}
      calculateMetadata={calculateExplainerV3Metadata}
    />
  </>
);
