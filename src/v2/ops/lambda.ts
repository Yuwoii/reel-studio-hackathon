// Shared v2 Lambda constants + pre-call guards (W3 P2, moved from scripts/v2/render-dev.ts). Pure: no AWS calls here.
// Credentials come from ./aws.env as REMOTION_AWS_* (sourced by the npm script / container env, never printed);
// AWS_PROFILE & co. must be unset so nothing falls back to another account or profile.

export const REGION = "eu-central-2" as const;
/** 900 s (Lambda max) since 2026-11-06: v3 60 fps renders of heavy boards run ~1.5–1.9× the 30 fps time (up to ~404 s
 *  measured at 30 fps), past the old 600 s function. The 600 s function stays deployed for the pre-w9 rollback images. */
export const FUNCTION = "remotion-render-4-0-534-mem3008mb-disk2048mb-900sec";
export const COMPOSITION = "Explainer";
export const GALLERY_COMPOSITION = "V2Gallery";

export const FORBIDDEN_AWS_ENV = ["AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"] as const;

/** Throws unless REMOTION_AWS_* are present, the region is eu-central-2 (or unset) and no AWS_* credential/profile is set. */
export function assertLambdaEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const k of FORBIDDEN_AWS_ENV) if (env[k]) throw new Error(`refusing: ${k} is set (use the npm script, which sources ./aws.env and unsets AWS_*)`);
  if (!env.REMOTION_AWS_ACCESS_KEY_ID || !env.REMOTION_AWS_SECRET_ACCESS_KEY) throw new Error("REMOTION_AWS_* credentials missing (run via npm run v2:render-dev)");
  if (env.REMOTION_AWS_REGION && env.REMOTION_AWS_REGION !== REGION) throw new Error(`REMOTION_AWS_REGION must be ${REGION}`);
}

/**
 * Frames must exist in the composition (0 ≤ f < durationF) — checked BEFORE any Lambda call: an out-of-range still
 * or range otherwise only fails inside Lambda, after the call has been paid for.
 */
export function validateFrames(kind: "still" | "media", frames: readonly number[], durationF: number): void {
  if (!(Number.isInteger(durationF) && durationF > 0)) throw new Error(`frames: invalid composition duration ${String(durationF)}`);
  const bad = frames.filter((f) => !(Number.isInteger(f) && f >= 0 && f < durationF));
  if (bad.length) throw new Error(`${kind}: frame(s) ${bad.join(", ")} outside the composition (0–${durationF - 1}, durationF ${durationF})`);
  if (kind === "media" && frames.length === 2 && frames[1] < frames[0]) throw new Error(`media: range ${frames[0]}-${frames[1]} is reversed`);
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 600);
