// R6 lab copy of remotion/v2/WeightedMotionBlur.tsx with a `span` prop (author frames covered by one OUTPUT frame:
// 1 at 30 fps, 0.5 at 60 fps). Sub-sample k freezes at f + span·(1 − shutter·(k+1)/N); tent weights are the
// original's (imported, unchanged). span = 1 is identical to the v2 component.
import React from "react";
import { AbsoluteFill, Freeze, useCurrentFrame } from "remotion";
import { blur } from "../../v2/theme";
import { BlurSampleContext, sampleOffsets, tentWeights } from "../../v2/WeightedMotionBlur";

export const WeightedMotionBlurSpan: React.FC<{ children: React.ReactNode; samples: number; shutterAngle?: number; span?: number }> = ({ children, samples, shutterAngle = blur.shutterAngle, span = 1 }) => {
  const frame = useCurrentFrame();
  if (samples <= 1) return <>{children}</>;
  const weights = tentWeights(samples);
  const offsets = sampleOffsets(samples, shutterAngle);
  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {weights.map((w, k) => (
        <AbsoluteFill key={k} style={{ mixBlendMode: "plus-lighter", filter: `opacity(${w})` }}>
          <BlurSampleContext.Provider value={k}>
            <Freeze frame={frame + span * offsets[k]}>{children}</Freeze>
          </BlurSampleContext.Provider>
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};
