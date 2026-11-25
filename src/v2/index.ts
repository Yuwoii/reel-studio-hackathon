// Reel Studio v2 data core: storyboard schema, the single timing resolver, and the render-free lints.
// Container-side entry (NodeNext). Remotion code imports src/v2/timeline extensionless instead (see timeline.ts).

export * from "../schema/storyboard.v2.js";
export * from "./timeline.js";
export * from "./lints.js";
export { COMPONENTS, LAYER_IDS, LIBRARY_HASH, LIBRARY_IDS, LIBRARY_VERSION, type ComponentId, type ComponentMeta } from "./registry.gen.js";
