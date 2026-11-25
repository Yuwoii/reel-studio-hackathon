// V2Gallery defaultProps: ONLY the fixture keys every fixture must carry. Remotion shallow-merges inputProps over
// defaultProps, so an optional key here (the StatusCard fixture's `w: 760`) leaked into every fixture that omits it —
// W2 r1/r2 rendered 12 components at w = 760 instead of their own footprint (test/v2-gallery-defaults.test.ts).
import type { GalleryFixtureIn } from "../../src/v2/components-meta/_fixture";
import statusCardFixture from "../../test/fixtures/v2/components/StatusCard.json";

export const galleryDefaultProps: GalleryFixtureIn = {
  component: statusCardFixture.component,
  props: statusCardFixture.props,
  timeline: statusCardFixture.timeline as GalleryFixtureIn["timeline"],
  stills: statusCardFixture.stills,
};
