// The whole reel: one <Sequence> per beat (duration = ceil((audio + 0.3 s) × 30)), the beat's narration audio,
// and the scene stack: Background → Props → Characters → Particles (pixelated + camera drift), texture, then
// crisp text layers (HUD, on-screen text, captions) and the transition overlays on top.

import React, { useMemo } from "react";
import { AbsoluteFill, Html5Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import type { Beat, BeatAudio, Config, ReelProps } from "../src/schema/index.js";
import { Background } from "./components/Background";
import { CameraDrift, computeCamera } from "./components/CameraDrift";
import { Captions } from "./components/Captions";
import { Character, characterLayout, layoutCharacters } from "./components/Character";
import { HUD } from "./components/HUD";
import { OnScreenText } from "./components/OnScreenText";
import { Particles } from "./components/Particles";
import { PixelLayer } from "./components/PixelLayer";
import { Props } from "./components/Props";
import { SafeZoneDebug } from "./components/SafeZoneDebug";
import { Texture } from "./components/Texture";
import { inProgress, outProgress, useTransitionLook } from "./components/Transition";
import { ensureFonts } from "./fonts";
import { hudSpans, type HudSpan } from "./hudValues";
import { normalizeProps } from "./normalize";
import { getStyle, resolvePalette, ThemeContext, useTheme } from "./styles";
import { beatFrames, beatStarts } from "./timing";

/** inputProps of the "Reel" composition: ReelProps + an optional debug overlay. (Mapped type → index-signature compatible.) */
export type ReelCompositionProps = { [K in keyof ReelProps]: ReelProps[K] } & { debugSafeZone?: boolean };

ensureFonts();

/** https/http/data/blob URLs pass through (Lambda: S3 URLs); anything else is a path inside public/ (local dev). */
export function resolveAudioSrc(url: string): string | null {
  if (!url) return null;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return staticFile(url.replace(/^\/+/, ""));
}

const BeatScene: React.FC<{
  beat: Beat;
  index: number;
  isLast: boolean;
  audio: BeatAudio;
  durationInFrames: number;
  prevTransition: Beat["scene"]["transitionOut"] | null;
  config: Config;
  spans: Record<string, HudSpan>;
  recurring: ReelProps["script"]["recurring"];
  beatCount: number;
}> = ({ beat, index, isLast, audio, durationInFrames, prevTransition, config, spans, recurring, beatCount }) => {
  const frame = useCurrentFrame();
  const { style } = useTheme();
  const scene = beat.scene;
  // the last beat has no out-transition: the final frame must stay readable (and loop back cleanly)
  const outLook = useTransitionLook(isLast ? "cut" : scene.transitionOut, "out", outProgress(frame, durationInFrames));
  const inLook = useTransitionLook(prevTransition ?? "cut", "in", inProgress(frame));
  const sceneTransform = [inLook.scene, outLook.scene].filter(Boolean).join(" ");
  const placements = scene.characters.filter((p) => config.characters.some((c) => c.id === p.ref));
  const xs = layoutCharacters(placements);
  // worst-case camera framing is frame-independent → character boxes are constant over the beat
  const cam = computeCamera(0, durationInFrames, scene.camera.drift, scene.camera.zoom, index);
  const charBoxes = placements.map((p, i) => characterLayout(config.characters.find((c) => c.id === p.ref)!, p, xs[i], cam));
  const t = frame / Math.max(1, durationInFrames);

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: sceneTransform || undefined, transformOrigin: "50% 45%" }}>
        <PixelLayer size={style.pixelSize}>
          <CameraDrift drift={scene.camera.drift} zoom={scene.camera.zoom} durationInFrames={durationInFrames} seed={index}>
            <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              <Background preset={scene.background.preset} timeOfDay={scene.background.timeOfDay} />
              <Props props={scene.props} durationInFrames={durationInFrames} avoid={charBoxes} />
              {placements.map((p, i) => (
                <Character key={`${p.ref}-${i}`} def={config.characters.find((c) => c.id === p.ref)!} placement={p} index={i} xOverride={xs[i]} />
              ))}
              <Particles kind={scene.particles.kind} intensity={scene.particles.intensity} seed={index + 1} />
            </svg>
          </CameraDrift>
        </PixelLayer>
        <Texture style={style} />
      </AbsoluteFill>
      <HUD defs={config.hud} visible={scene.hud} spans={spans} t={t} recurring={recurring} beatIndex={index} beatCount={beatCount} />
      <OnScreenText text={beat.onScreenText} beatIndex={index} />
      <Captions narration={beat.narration} audio={audio} keyWord={beat.keyWord} mode={config.captions.mode} chunkSize={config.captions.chunkSize} />
      {inLook.overlay}
      {outLook.overlay}
    </AbsoluteFill>
  );
};

export const ReelComposition: React.FC<ReelCompositionProps> = (raw) => {
  const { debugSafeZone, ...rest } = raw;
  const props = useMemo(() => normalizeProps(rest as ReelProps), [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  const { script, config } = props;
  const style = getStyle(config.style);
  const palette = resolvePalette(style, config.palette);
  // one audio entry per beat; a missing entry gets a 3 s silent placeholder rather than crashing the render
  const audio: BeatAudio[] = script.beats.map((b, i) => props.audio[i] ?? { beatId: b.id, url: "", durationSec: 3, words: [] });
  const frames = beatFrames(audio);
  const starts = beatStarts(frames);
  const spans = useMemo(() => hudSpans(script, config), [script, config]);

  return (
    <ThemeContext.Provider value={{ style, palette }}>
      <AbsoluteFill style={{ backgroundColor: palette.ink, overflow: "hidden" }}>
        {script.beats.map((beat, i) => {
          const src = resolveAudioSrc(audio[i].url);
          return (
            <Sequence key={beat.id} from={starts[i]} durationInFrames={frames[i]} name={`Beat ${beat.id}`}>
              <BeatScene
                beat={beat}
                index={i}
                isLast={i === script.beats.length - 1}
                audio={audio[i]}
                durationInFrames={frames[i]}
                prevTransition={i > 0 ? script.beats[i - 1].scene.transitionOut : null}
                config={config}
                spans={spans[i]}
                recurring={script.recurring}
                beatCount={script.beats.length}
              />
              {src && <Html5Audio src={src} />}
            </Sequence>
          );
        })}
        {debugSafeZone && <SafeZoneDebug />}
      </AbsoluteFill>
    </ThemeContext.Provider>
  );
};
