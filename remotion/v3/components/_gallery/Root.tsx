// W3a golden-still entry (own site bundle, deploy-dev.sh with REEL_V2_SITE_NAME=reel-studio-v2-v3dev-w3a). Not the
// live entry and not ExplainerV3 (W3b). Compositions: V3W3aGallery (golden stills) and V3W3aSnapProbe (40-frame snap blur probe).
import React from "react";
import { Composition } from "remotion";
import { GALLERY_V3_DURATION, GALLERY_V3_ID, V3Gallery } from "./Gallery";
import type { GalleryInput } from "../../../../src/v3/components-meta/_gallery";
import { SNAP_PROBE_F } from "../../../../src/v3/components-meta/_gallery";
import { SNAP_PROBE_ID, type SnapProbeInput, V3SnapProbe } from "./SnapProbe";

const defaults: GalleryInput = { layer: { component: "BrowserWindow", props: { host: "example.com", url: "tapped", highlight: "s" } }, probe: true, title: "BrowserWindow" };

const snapDefaults: SnapProbeInput = { component: "BrowserWindow", props: { url: "tapped", highlight: "s" }, keys: [{ f: 0, zoom: 1, focus: "" }, { f: 10, zoom: 1, focus: "" }, { f: 20, zoom: 3.2, focus: "urlbar.schemeS" }, { f: 26, zoom: 3.2, focus: "urlbar.schemeS" }, { f: 38, zoom: 1.2, focus: "urlbar" }] };

export const V3W3aRoot: React.FC = () => (
  <>
  <Composition id={SNAP_PROBE_ID} component={V3SnapProbe as unknown as React.FC<Record<string, unknown>>} width={1080} height={1920} fps={30} durationInFrames={SNAP_PROBE_F} defaultProps={snapDefaults as unknown as Record<string, unknown>} />
  <Composition id={GALLERY_V3_ID} component={V3Gallery as unknown as React.FC<Record<string, unknown>>} width={1080} height={1920} fps={30} durationInFrames={GALLERY_V3_DURATION} defaultProps={defaults as unknown as Record<string, unknown>} />
  </>
);
