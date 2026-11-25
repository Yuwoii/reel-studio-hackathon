// The ONE fixed v2 composition (ADR-001 §2.2): every ROOT CAUSE reel is this component + data.
//
//   props { storyboard (PARSED v2.1, zod output), words (words.json), audio?, blur?, debug? }
//     → resolveTimeline() (the same module the linter uses: lint frame N = rendered frame N)
//     → World(Camera(DataField + library slots: components/Slot.tsx → the shipped component, else PlaceholderCard)) [tent motion blur only inside blur windows]
//       + Footer/hairline + HeaderBar + SubtitleCard + Vignette.
//
// The storyboard must already be parsed (defaults filled): Remotion's webpack cannot load the zod schema module (its
// NodeNext ".js" runtime specifiers), so parsing happens host-side (scripts/v2/render-dev.ts, the director's save).
// Lambda renders are muted; `audio` only exists for Studio previews.
import React, { useMemo } from "react";
import { AbsoluteFill, Freeze, Html5Audio, useCurrentFrame, type CalculateMetadataFunction } from "remotion";
import type { Storyboard, WordsFileT } from "../../src/schema/storyboard.v2";
import { fitStoryboard, resolveTimeline, samplesAt, type FootprintLookup, type StageFit, type Timeline } from "../../src/v2/timeline";
import { onScreenStrings as sharedOnScreenStrings } from "../../src/v2/glyphs";
import { findBadGlyphs, useV2Fonts } from "./fonts";
import { Footer } from "./layers/Footer";
import { HeaderBar } from "./layers/HeaderBar";
import { fieldGeometry } from "./layers/DataField";
import { PRESETS } from "./layers/fieldPresets";
import { SubtitleCard, type CaptionStyle } from "./layers/SubtitleCard";
import { Vignette } from "./layers/Vignette";
import { World, type WorldProps } from "./layers/World";
import { LIBRARY_LOOKUP } from "./components/Slot";
import { color, FPS, H, layout, W } from "./theme";
import { samplesForSpan, WeightedMotionBlur } from "./WeightedMotionBlur";
import { fieldMarks, headerTrack, instanceTracks, worldExtent, type HeaderTrack } from "./world";

export const EXPLAINER_ID = "Explainer";

export type ExplainerProps = {
  storyboard: Storyboard;
  words: WordsFileT | null;
  /** Studio preview only (Lambda renders are muted; the container mixes audio from the same timeline). */
  audio?: { src: string } | null;
  /** false = never blur (review stills: amendments §12). Default true (velocity-adaptive). */
  blur?: boolean;
  /** Draw the layout zones + frame number (dev only). */
  debug?: boolean;
  /** Cover / thumbnail still (W2.1): render WITHOUT the SubtitleCard. The cover frame sits mid-phrase (r3 f1996 showed
   *  "Exit code 137 was" under the "find the leak." hero), and a caption fragment on a thumbnail reads as an accident.
   *  Only for the separate cover still — the reel's own frames always keep their caption. */
  cover?: boolean;
  /** W0 (v3 ADR-002 §10): OUTPUT frame rate. Absent / 30 = the v2 composition exactly (author rate). 60 = the time-base
   *  wrapper: the author timeline stays 30 fps, output frame o shows author frame o/2 via <Freeze>, blur shutter spans
   *  half an author frame. Only the final render passes it (src/pipeline/v2/render.ts OUTPUT_FPS); stills never do. */
  outputFps?: 30 | 60;
};

/** Output frames per author frame (1 unless props.outputFps is 60). */
export function outputMul(outputFps: unknown): 1 | 2 {
  return outputFps === 60 ? 2 : 1;
}

/** Registry + shipped metas (props-aware footprints): the same boxes the lints compute (src/v2/library.ts). */
const LIB: FootprintLookup = LIBRARY_LOOKUP;

export interface Scene {
  /** The storyboard as rendered: the library's stage-fill pass applied (src/v2/timeline.ts fitStoryboard, W5.1). */
  sb: Storyboard;
  fits: StageFit[];
  tl: Timeline;
  world: Omit<WorldProps, "sb" | "tl">;
  header: HeaderTrack;
}

/** Fail fast on a raw (unparsed) storyboard: defaults such as beat.camera / blur.minSamples must be present. */
function assertParsed(sb: Storyboard): void {
  const ok = sb && Array.isArray(sb.beats) && sb.beats.every((b) => Array.isArray(b.camera) && Array.isArray(b.sfx) && Array.isArray(b.sourceIds)) && typeof sb.blur?.minSamples === "number" && typeof sb.captions?.style === "string";
  if (!ok) throw new Error("Explainer: storyboard is not in parsed form — run parseStoryboard() (src/schema/storyboard.v2.ts) before rendering");
}

/**
 * Every string the composition can put on screen (L19 render-side guard): the SAME list the lint checks
 * (src/v2/glyphs.ts onScreenStrings — incl. Figure node text and action props).
 */
export function onScreenStrings(sb: Storyboard): { where: string; text: string }[] {
  return sharedOnScreenStrings(sb);
}

export function buildScene(sb: Storyboard, words: WordsFileT | null): Scene {
  assertParsed(sb);
  const bad = findBadGlyphs(onScreenStrings(sb));
  if (bad.length) throw new Error(`L19: glyphs outside the allow-list: ${bad.slice(0, 6).map((b) => `${b.where} ${b.codePoint} "${b.char}"`).join("; ")}`);
  // W5.1 stage fill: ONE large subject — graphs draw bigger nodes / use their canvas, sole subjects zoom with their
  // satellites; checked against the director's own camera on every review frame (lint frame N = rendered frame N)
  const fit = fitStoryboard(sb, words, LIB);
  sb = fit.sb;
  const tl = resolveTimeline(sb, words, LIB, FPS);
  const preset = PRESETS[sb.datafield.preset];
  const extent = worldExtent(sb, LIB);
  const stationsMinX = Math.min(...sb.stations.map((s) => s.x));
  return {
    sb,
    fits: fit.fits,
    tl,
    header: headerTrack(sb, tl),
    world: {
      tracks: instanceTracks(sb, tl, LIB),
      field: { preset: preset.id, seed: sb.datafield.seed, geometry: fieldGeometry(preset, extent, stationsMinX, tl.durationF), marks: fieldMarks(sb, tl) },
    },
  };
}

export const calculateExplainerMetadata: CalculateMetadataFunction<ExplainerProps> = ({ props }) => {
  const { tl } = buildScene(props.storyboard, props.words ?? null);
  for (const i of tl.issues) console.warn(`[timeline] ${i.code}: ${i.message}`);
  const m = outputMul(props.outputFps);
  return { durationInFrames: Math.max(1, tl.durationF * m), fps: FPS * m, width: W, height: H };
};

const DebugZones: React.FC = () => {
  const frame = useCurrentFrame();
  const line = (y: number, c: string) => <div style={{ position: "absolute", left: 0, top: y, width: W, height: 1, background: c }} />;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {line(layout.headerBand.solidTo, color.danger)}
      {line(layout.focal.top, color.accent)}
      {line(layout.focal.bottom, color.accent)}
      <div style={{ position: "absolute", left: layout.rightSafeX, top: 0, width: 1, height: H, background: color.danger }} />
      <div style={{ position: "absolute", left: layout.margin, top: 0, width: 1, height: H, background: color.accent }} />
      <div style={{ position: "absolute", left: layout.contentRightX, top: 0, width: 1, height: H, background: color.accent }} />
      <div style={{ position: "absolute", right: 24, bottom: 24, color: color.text, fontFamily: "monospace", fontSize: 28 }}>f{Math.floor(frame)}</div>
    </AbsoluteFill>
  );
};

export const Explainer: React.FC<ExplainerProps> = (props) => {
  const m = outputMul(props.outputFps);
  if (m === 1) return <ExplainerBody {...props} />;
  // W0 60 fps wrapper: every layer sees the fractional author frame o/m (as inside the blur already); audio (Studio
  // preview only — Lambda renders are muted) stays outside the Freeze, which would pause it.
  return <ExplainerAtOutputRate {...props} m={m} />;
};

const ExplainerAtOutputRate: React.FC<ExplainerProps & { m: 2 }> = ({ m, audio, ...props }) => {
  const out = useCurrentFrame();
  return (
    <>
      <Freeze frame={out / m}>
        <ExplainerBody {...props} span={1 / m} />
      </Freeze>
      {audio?.src ? <Html5Audio src={audio.src} /> : null}
    </>
  );
};

/** The v2 composition body. span = author frames per output frame (1 = the v2 30 fps render, unchanged). */
const ExplainerBody: React.FC<ExplainerProps & { span?: number }> = ({ storyboard, words, audio, blur = true, debug = false, cover = false, span = 1 }) => {
  const ready = useV2Fonts();
  const frame = useCurrentFrame();
  const scene = useMemo(() => buildScene(storyboard, words ?? null), [storyboard, words]);
  const sb = scene.sb;
  const n = blur ? samplesForSpan(samplesAt(scene.tl, Math.floor(frame)), span) : 0;
  const world = <World sb={sb} tl={scene.tl} {...scene.world} />;
  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      {n > 1 ? (
        <WeightedMotionBlur samples={n} shutterAngle={sb.blur.shutterAngle} span={span}>
          {world}
        </WeightedMotionBlur>
      ) : (
        world
      )}
      <Footer />
      <HeaderBar series={sb.series} codename={sb.codename} track={scene.header} />
      {cover ? null : <SubtitleCard tl={scene.tl} style={sb.captions.style as CaptionStyle} ready={ready} />}
      <Vignette />
      {debug ? <DebugZones /> : null}
      {audio?.src ? <Html5Audio src={audio.src} /> : null}
    </AbsoluteFill>
  );
};
