// R6 lab: the v2 Explainer body rendered on an OUTPUT time base of fpsMul × 30 fps (time-base wrapper, QUALITY.md
// §2.2). The author timeline (storyboard, words, lints) stays 30 fps; output frame o shows author frame o/fpsMul via
// <Freeze>. Blur: samples looked up at author frame floor(o/fpsMul); at fpsMul 2 n60 = max(8, ceil(n30/2)) whenever
// n30 > 0 (thr3 model), and the shutter spans 1/fpsMul author frames. fpsMul 1 must equal Explainer pixel for pixel.
import React, { useMemo } from "react";
import { AbsoluteFill, Freeze, useCurrentFrame, type CalculateMetadataFunction } from "remotion";
import { samplesAt } from "../../../src/v2/timeline";
import { buildScene, type ExplainerProps } from "../../v2/Explainer";
import { useV2Fonts } from "../../v2/fonts";
import { Footer } from "../../v2/layers/Footer";
import { HeaderBar } from "../../v2/layers/HeaderBar";
import { SubtitleCard, type CaptionStyle } from "../../v2/layers/SubtitleCard";
import { Vignette } from "../../v2/layers/Vignette";
import { World } from "../../v2/layers/World";
import { color, FPS, H, W } from "../../v2/theme";
import { WeightedMotionBlurSpan } from "./WeightedMotionBlurSpan";

export const EXPLAINER_LAB_ID = "ExplainerLab";
export type ExplainerLabProps = ExplainerProps & { fpsMul?: 1 | 2 };

export const calculateExplainerLabMetadata: CalculateMetadataFunction<ExplainerLabProps> = ({ props }) => {
  const { tl } = buildScene(props.storyboard, props.words ?? null);
  const m = props.fpsMul ?? 1;
  return { durationInFrames: Math.max(1, tl.durationF * m), fps: FPS * m, width: W, height: H };
};

export function labSamples(n30: number, fpsMul: number): number {
  if (fpsMul === 1 || n30 <= 1) return n30;
  return Math.max(8, Math.ceil(n30 / fpsMul));
}

const Body: React.FC<{ props: ExplainerLabProps; n: number; span: number }> = ({ props, n, span }) => {
  const ready = useV2Fonts();
  const scene = useMemo(() => buildScene(props.storyboard, props.words ?? null), [props.storyboard, props.words]);
  const sb = scene.sb;
  const world = <World sb={sb} tl={scene.tl} {...scene.world} />;
  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      {n > 1 ? (
        <WeightedMotionBlurSpan samples={n} shutterAngle={sb.blur.shutterAngle} span={span}>
          {world}
        </WeightedMotionBlurSpan>
      ) : (
        world
      )}
      <Footer />
      <HeaderBar series={sb.series} codename={sb.codename} track={scene.header} />
      {props.cover ? null : <SubtitleCard tl={scene.tl} style={sb.captions.style as CaptionStyle} ready={ready} />}
      <Vignette />
    </AbsoluteFill>
  );
};

export const ExplainerLab: React.FC<ExplainerLabProps> = (props) => {
  const m = props.fpsMul ?? 1;
  const out = useCurrentFrame();
  const scene = useMemo(() => buildScene(props.storyboard, props.words ?? null), [props.storyboard, props.words]);
  const n = props.blur === false ? 0 : labSamples(samplesAt(scene.tl, Math.floor(out / m)), m);
  return (
    <Freeze frame={out / m}>
      <Body props={props} n={n} span={1 / m} />
    </Freeze>
  );
};
