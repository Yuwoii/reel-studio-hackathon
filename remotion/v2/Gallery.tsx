// "V2Gallery": ONE library component rendered standalone on the persistent layers, for review in isolation (W2).
//
//   inputProps = a component fixture (test/fixtures/v2/components/<Name>.json, format src/v2/components-meta/_fixture.ts):
//     { component, props, w?, scale?, timeline: [{ f, do, state?, props? }], durationF?, preset?, seed?, zoom?,
//       blurSamples?, stills?, debug?, note? }
//
// The instance is centred on the stage (world = screen at zoom 1: its box centre sits on the camera anchor 540,855)
// under a static camera with the usual +2 % hold drift, and goes through the SAME World → Slot → component path as
// the Explainer (buildTrack(), the library lookup, the shared entrance/exit), so a gallery frame is what the reel
// shows for the same verbs. Header: "ROOT CAUSE · GALLERY", right label = component + version. No subtitle card
// (there are no words); the caption band stays empty so footprint/caption clearance is easy to judge.
// Planned ids (no shipped component) render their PlaceholderCard. Renders are Lambda-only (no local renders).
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, type CalculateMetadataFunction } from "remotion";
import type { Storyboard } from "../../src/schema/storyboard.v2";
import { GalleryFixture, galleryDurationF, validateFixture, type GalleryFixtureIn, type GalleryFixtureT } from "../../src/v2/components-meta/_fixture";
import { mirrorMeterEvents } from "../../src/v2/components-meta/ContainerBox";
import { CAM_ANCHOR, expandFinalStates, FINAL_STATE, toScreen, type Box, type Timeline } from "../../src/v2/timeline";
import { cameraAt } from "./camera";
import { componentFor, LIBRARY_LOOKUP } from "./components/Slot";
import { collectStrings, findBadGlyphs, useV2Fonts } from "./fonts";
import { fieldGeometry } from "./layers/DataField";
import { PRESETS } from "./layers/fieldPresets";
import { Footer } from "./layers/Footer";
import { HeaderBar } from "./layers/HeaderBar";
import { Vignette } from "./layers/Vignette";
import { World, type WorldProps } from "./layers/World";
import { COMPONENTS, LIBRARY_IDS } from "./registry.gen";
import { color, FPS, H, header as hdr, W } from "./theme";
import { WeightedMotionBlur } from "./WeightedMotionBlur";
import { buildTrack, type HeaderTrack } from "./world";

export const GALLERY_ID = "V2Gallery";
export type GalleryProps = GalleryFixtureIn;

const INSTANCE_ID = "gallery";

/** A timeline with no beats/words: static camera on the stage centre for `durationF` frames. */
export function galleryTimeline(durationF: number, zoom: number): Timeline {
  return {
    fps: FPS, durationMs: (durationF * 1000) / FPS, durationF, timingSource: "gallery",
    beats: [], words: [], displayPhrases: [], events: [],
    camera0: { x: CAM_ANCHOR.x, y: CAM_ANCHOR.y, zoom, tiltX: 0 },
    cameraSegments: [], hardCuts: [], blurWindows: [], coverF: 0, issues: [],
  };
}

export interface GalleryScene {
  fx: GalleryFixtureT;
  durationF: number;
  box: Box;
  sb: Storyboard;
  tl: Timeline;
  world: Omit<WorldProps, "sb" | "tl">;
  header: HeaderTrack;
}

/** W7.1: a fixture timeline with `state: "final"` resolved exactly as resolveTimeline does for a reel. */
function finalResolved<E extends { f: number; do: string; state?: string; props?: Record<string, unknown> }>(component: string, props: Record<string, unknown>, timeline: readonly E[]): E[] {
  const m = componentFor(component)?.meta;
  if (!m || !m.states.includes(FINAL_STATE) || !timeline.some((e) => e.state === FINAL_STATE)) return [...timeline];
  return expandFinalStates([...timeline].sort((a, b) => a.f - b.f), m.states[0], props, m.verbs.state?.props ?? []);
}

export function buildGalleryScene(input: GalleryFixtureIn): GalleryScene {
  const fx = GalleryFixture.parse(input);
  if (!(LIBRARY_IDS as readonly string[]).includes(fx.component)) throw new Error(`V2Gallery: unknown component "${fx.component}"`);
  const comp = componentFor(fx.component);
  if (comp) {
    const errs = validateFixture(fx, comp.meta);
    if (errs.length) throw new Error(`V2Gallery ${fx.component}: ${errs.join("; ")}`);
  }
  const bad = findBadGlyphs(collectStrings({ props: fx.props, timeline: fx.timeline.map((e) => e.props ?? {}), companions: fx.companions.map((c) => ({ props: c.props, timeline: c.timeline.map((e) => e.props ?? {}) })) }, fx.component));
  if (bad.length) throw new Error(`L19: glyphs outside the allow-list: ${bad.slice(0, 6).map((b) => `${b.where} ${b.codePoint} "${b.char}"`).join("; ")}`);
  const durationF = galleryDurationF(fx);
  const sizeOf = (component: string, props: Record<string, unknown>, w: number | undefined) => {
    const entry = LIBRARY_LOOKUP[component];
    const fp = entry?.footprint ?? { w: 600, h: 160 };
    return entry?.sizeFor?.(props, w) ?? (w !== undefined ? { w, h: (fp.h * w) / fp.w } : fp);
  };
  const size = sizeOf(fx.component, fx.props, fx.w);
  const bw = size.w * fx.scale;
  const bh = size.h * fx.scale;
  // W7 companions: stacked under the main instance (40 px gap), the whole group centred on the camera anchor
  const GAP = 40;
  const extra = fx.companions.map((c) => {
    const comp2 = componentFor(c.component);
    if (comp2) {
      const errs = validateFixture({ ...fx, component: c.component, props: c.props, timeline: c.timeline, stills: [] }, comp2.meta);
      if (errs.length) throw new Error(`V2Gallery companion ${c.id}: ${errs.join("; ")}`);
    }
    return { c, size: sizeOf(c.component, c.props, c.w) };
  });
  const groupH = bh + extra.reduce((a, e) => a + GAP + e.size.h, 0);
  const top = CAM_ANCHOR.y - groupH / 2;
  const box: Box = { x: CAM_ANCHOR.x - bw / 2, y: top, w: bw, h: bh };
  const inst = { id: INSTANCE_ID, component: fx.component, station: "gallery", x: box.x, y: box.y, w: fx.w, scale: fx.scale, z: 1, plate: true, props: fx.props };
  const tracks = new Map([[INSTANCE_ID, buildTrack(INSTANCE_ID, box, finalResolved(fx.component, fx.props, fx.timeline))]]);
  const world: Record<string, unknown>[] = [inst];
  let y = box.y + bh;
  for (const { c, size: cs } of extra) {
    y += GAP;
    const cbox: Box = { x: CAM_ANCHOR.x - cs.w / 2, y, w: cs.w, h: cs.h };
    let props = c.props;
    let events = c.timeline;
    if (c.mirrors && fx.component === "ContainerBox") {
      const m = componentFor("ContainerBox")?.meta;
      const parsed = m?.propsSchema.safeParse(fx.props);
      const initial = parsed?.success && m?.initialState ? m.initialState(parsed.data) : "neutral";
      const mir = mirrorMeterEvents(fx.props, initial, fx.timeline);
      props = { ...c.props, value: mir.base };
      events = [...c.timeline, ...mir.events];
    }
    world.push({ id: c.id, component: c.component, station: "gallery", x: cbox.x, y: cbox.y, w: c.w, scale: 1, z: 1, plate: true, props });
    tracks.set(c.id, buildTrack(c.id, cbox, finalResolved(c.component, props, events)));
    y += cs.h;
  }
  const sb = { world } as unknown as Storyboard; // World reads sb.world only
  const tl = galleryTimeline(durationF, fx.zoom);
  const preset = PRESETS[fx.preset];
  const extent = { x0: -900, y0: -900, x1: W + 900, y1: H + 900 };
  const meta = COMPONENTS[fx.component as keyof typeof COMPONENTS];
  const right = `${fx.component.toUpperCase().slice(0, 18)} V${meta?.version ?? 0}`.slice(0, hdr.maxRightChars);
  return {
    fx, durationF, box, sb, tl,
    world: {
      tracks,
      field: { preset: preset.id, seed: fx.seed, geometry: fieldGeometry(preset, extent, box.x, durationF), marks: [] },
    },
    header: { right: [{ f: 0, text: right }], dot: [{ f: 0, dot: "dim" }], pulses: [], scrambles: [] },
  };
}

export const calculateGalleryMetadata: CalculateMetadataFunction<GalleryProps> = ({ props }) => {
  const s = buildGalleryScene(props);
  return { durationInFrames: s.durationF, fps: FPS, width: W, height: H };
};

/** Footprint outline (screen space) + frame number. Dev only. */
const FootprintOutline: React.FC<{ s: GalleryScene }> = ({ s }) => {
  const frame = useCurrentFrame();
  const b = toScreen(s.box, cameraAt(s.tl, frame));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, boxSizing: "border-box", border: `1px dashed ${color.danger}` }} />
      <div style={{ position: "absolute", right: 24, bottom: 24, color: color.text, fontFamily: "monospace", fontSize: 28 }}>
        f{Math.floor(frame)} · {Math.round(s.box.w)}×{Math.round(s.box.h)}
      </div>
    </AbsoluteFill>
  );
};

export const Gallery: React.FC<GalleryProps> = (props) => {
  useV2Fonts();
  const s = useMemo(() => buildGalleryScene(props), [props]);
  const world = <World sb={s.sb} tl={s.tl} {...s.world} />;
  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      {s.fx.blurSamples > 1 ? (
        <WeightedMotionBlur samples={s.fx.blurSamples} shutterAngle={180}>
          {world}
        </WeightedMotionBlur>
      ) : (
        world
      )}
      <Footer />
      <HeaderBar series={hdr.series} codename="GALLERY" track={s.header} />
      <Vignette />
      {s.fx.debug ? <FootprintOutline s={s} /> : null}
    </AbsoluteFill>
  );
};
