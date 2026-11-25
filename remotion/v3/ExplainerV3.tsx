// ExplainerV3 (ADR-002 §4.3, W3b): the ONE v3 composition = the v2 Explainer + lowering + OverlayLayer.
//
//   props { storyboard (PARSED v3.0, zod output — parseAnyStoryboard host-side; v2.1 boards arrive upgraded), words,
//           audio?, blur?, debug?, cover?, outputFps? }
//     → lowerToV21() (src/v3/lower.ts, the SAME function the lints and digest call) → v2.1 board + screen overlays +
//       travels + locked real objects
//     → stage fill (fitStoryboard) ONLY when nothing is locked: the v2 path for upgraded v2 boards, so they render as
//       the v2 Explainer does. Boards with real objects skip it until W4 teaches frameCamera/fitWorld to skip locked
//       instances and anchor-aimed keys (ADR-002 §4.3) — otherwise the stage fill would re-aim the hook's snap zoom.
//     → resolveTimeline() (lint frame N = rendered frame N)
//     → WorldV3 (v2 world + v3 slot + travel; no field on datafield "none") + OverlayLayer, both inside the tent motion
//       blur; then the v2 Footer, HeaderBar (series: HOW IT WORKS / ROOT CAUSE), SubtitleCard (white active word),
//       Vignette. Lambda renders are muted; the container mixes the audio from the same timeline (W4 audio kept).
// Extensionless imports only (Remotion's webpack cannot load NodeNext ".js" specifiers); the zod schema module stays
// host-side.
import React, { useMemo } from "react";
import { AbsoluteFill, Freeze, Html5Audio, useCurrentFrame, type CalculateMetadataFunction } from "remotion";
import type { Storyboard, WordsFileT } from "../../src/schema/storyboard.v2";
import type { StoryboardV3T } from "../../src/schema/storyboard.v3";
import { onScreenStrings } from "../../src/v2/glyphs";
import { fitStoryboard, resolveTimeline, samplesAt, type StageFit, type Timeline } from "../../src/v2/timeline";
import { lowerToV21, resolveTravels, type Lowered, type ResolvedTravel } from "../../src/v3/lower";
import { outputMul } from "../v2/Explainer";
import { findBadGlyphs, useV2Fonts } from "../v2/fonts";
import { fieldGeometry } from "../v2/layers/DataField";
import { PRESETS } from "../v2/layers/fieldPresets";
import { Footer } from "../v2/layers/Footer";
import { HeaderBar } from "../v2/layers/HeaderBar";
import { SubtitleCard, type CaptionStyle } from "../v2/layers/SubtitleCard";
import { Vignette } from "../v2/layers/Vignette";
import { color, FPS, H, layout, W } from "../v2/theme";
import { samplesForSpan, WeightedMotionBlur } from "../v2/WeightedMotionBlur";
import { buildTrack, fieldMarks, headerTrack, instanceTracks, worldExtent, type HeaderTrack, type InstanceTrack } from "../v2/world";
import { CaptionBandScrim } from "./components/CaptionScrim";
import { LOOKUP_V3, LOWER_LIB } from "./library";
import { OverlayLayer } from "./OverlayLayer";
import { WorldV3, type WorldV3Props } from "./WorldV3";

export const EXPLAINER_V3_ID = "ExplainerV3";

export type ExplainerV3Props = {
  storyboard: StoryboardV3T;
  words: WordsFileT | null;
  audio?: { src: string } | null;
  blur?: boolean;
  debug?: boolean;
  cover?: boolean;
  outputFps?: 30 | 60;
};

export interface SceneV3 {
  lowered: Lowered;
  sb: Storyboard;
  fits: StageFit[];
  tl: Timeline;
  travels: ResolvedTravel[];
  tracks: Map<string, InstanceTrack>;
  field: WorldV3Props["field"];
  header: HeaderTrack;
}

function assertParsedV3(sb: StoryboardV3T): void {
  const ok = sb && sb.schema === "v3.0" && Array.isArray(sb.beats) && sb.beats.every((b) => Array.isArray(b.camera) && Array.isArray(b.sfx) && Array.isArray(b.actions) && Array.isArray(b.sourceIds) && typeof b.act === "string") && Array.isArray(sb.shots) && Array.isArray(sb.assets) && typeof sb.blur?.minSamples === "number" && typeof sb.captions?.style === "string";
  if (!ok) throw new Error("ExplainerV3: storyboard is not a PARSED v3.0 board — run parseAnyStoryboard() (src/schema/storyboard.v3.ts) host-side");
}

export function buildSceneV3(input: StoryboardV3T, words: WordsFileT | null): SceneV3 {
  assertParsedV3(input);
  const lowered = lowerToV21(input, LOWER_LIB);
  if (lowered.issues.length) throw new Error(`ExplainerV3: lowering failed: ${lowered.issues.slice(0, 6).map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  let sb = lowered.board;
  const strings = [...onScreenStrings(sb), ...lowered.screenOverlays.flatMap((o) => Object.entries(o.props).filter(([, v]) => typeof v === "string").map(([k, v]) => ({ where: `${o.id}.props.${k}`, text: v as string })))];
  const bad = findBadGlyphs(strings);
  if (bad.length) throw new Error(`L19: glyphs outside the allow-list: ${bad.slice(0, 6).map((b) => `${b.where} ${b.codePoint} "${b.char}"`).join("; ")}`);
  let fits: StageFit[] = [];
  if (!lowered.locked.length) {
    const fit = fitStoryboard(sb, words, LOOKUP_V3);
    sb = fit.sb;
    fits = fit.fits;
  }
  const tl = resolveTimeline(sb, words, LOOKUP_V3, FPS);
  const travels = resolveTravels(lowered.travels, tl);
  const tracks = instanceTracks(sb, tl, LOOKUP_V3);
  for (const o of lowered.screenOverlays) {
    const evs = tl.events.flatMap((e) => (e.kind === "action" && e.target === o.id ? [{ f: e.frame, do: e.do, state: e.state, props: e.props }] : []));
    tracks.set(o.id, buildTrack(o.id, null, evs));
  }
  let field: WorldV3Props["field"] = null;
  if (!lowered.datafieldNone) {
    const preset = PRESETS[sb.datafield.preset];
    const extent = worldExtent(sb, LOOKUP_V3);
    const stationsMinX = Math.min(...sb.stations.map((s) => s.x));
    field = { preset: preset.id, seed: sb.datafield.seed, geometry: fieldGeometry(preset, extent, stationsMinX, tl.durationF), marks: fieldMarks(sb, tl) };
  }
  return { lowered, sb, fits, tl, travels, tracks, field, header: headerTrack(sb, tl) };
}

export const calculateExplainerV3Metadata: CalculateMetadataFunction<ExplainerV3Props> = ({ props }) => {
  const { tl } = buildSceneV3(props.storyboard, props.words ?? null);
  for (const i of tl.issues) console.warn(`[timeline] ${i.code}: ${i.message}`);
  const m = outputMul(props.outputFps);
  return { durationInFrames: Math.max(1, tl.durationF * m), fps: FPS * m, width: W, height: H };
};

const DebugZones: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: layout.focal.top, width: W, height: 1, background: color.accent }} />
      <div style={{ position: "absolute", left: 0, top: layout.focal.bottom, width: W, height: 1, background: color.accent }} />
      <div style={{ position: "absolute", right: 24, bottom: 24, color: color.text, fontFamily: "monospace", fontSize: 28 }}>f{Math.floor(frame)}</div>
    </AbsoluteFill>
  );
};

export const ExplainerV3: React.FC<ExplainerV3Props> = (props) => {
  const m = outputMul(props.outputFps);
  if (m === 1) return <BodyV3 {...props} />;
  return <AtOutputRate {...props} m={m} />;
};

const AtOutputRate: React.FC<ExplainerV3Props & { m: 2 }> = ({ m, audio, ...props }) => {
  const out = useCurrentFrame();
  return (
    <>
      <Freeze frame={out / m}>
        <BodyV3 {...props} span={1 / m} />
      </Freeze>
      {audio?.src ? <Html5Audio src={audio.src} /> : null}
    </>
  );
};

const BodyV3: React.FC<ExplainerV3Props & { span?: number }> = ({ storyboard, words, audio, blur = true, debug = false, cover = false, span = 1 }) => {
  const ready = useV2Fonts();
  const frame = useCurrentFrame();
  const scene = useMemo(() => buildSceneV3(storyboard, words ?? null), [storyboard, words]);
  const sb = scene.sb;
  const n = blur ? samplesForSpan(samplesAt(scene.tl, Math.floor(frame)), span) : 0;
  const moving = (
    <>
      <WorldV3 sb={sb} tl={scene.tl} tracks={scene.tracks} travels={scene.travels} field={scene.field} />
      <OverlayLayer overlays={scene.lowered.screenOverlays} tracks={scene.tracks} travels={scene.travels} tl={scene.tl} />
    </>
  );
  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      {n > 1 ? (
        <WeightedMotionBlur samples={n} shutterAngle={sb.blur.shutterAngle} span={span}>
          {moving}
        </WeightedMotionBlur>
      ) : (
        moving
      )}
      {/* S1 reviews: zoomed world content must not fight the caption card (src/v3/components-meta/CaptionScrim.ts) */}
      <CaptionBandScrim />
      <Footer />
      <HeaderBar series={sb.series} codename={sb.codename} track={scene.header} />
      {cover ? null : <SubtitleCard tl={scene.tl} style={sb.captions.style as CaptionStyle} ready={ready} />}
      <Vignette />
      {debug ? <DebugZones /> : null}
      {audio?.src ? <Html5Audio src={audio.src} /> : null}
    </AbsoluteFill>
  );
};
