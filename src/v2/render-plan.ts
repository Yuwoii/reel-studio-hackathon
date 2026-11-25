// Lambda render layout shared by the L18 prediction (src/v2/lints.ts) and the actual renders
// (scripts/v2/render-dev.ts, later the production renderer). One source of truth so the gate predicts the chunks
// that really run. Pure, no imports (bundles in Remotion and compiles under rootDir src).

/** ≤ 8 concurrent lambdas in total: 7 renderers + the orchestrator (Lambda concurrency quota is 10). */
export const MAX_RENDERERS = 7;
export const MIN_FRAMES_PER_LAMBDA = 20;

/** Frames per renderer chunk for a render of `frames` frames. */
export function framesPerLambda(frames: number): number {
  return Math.max(MIN_FRAMES_PER_LAMBDA, Math.ceil(frames / MAX_RENDERERS));
}
