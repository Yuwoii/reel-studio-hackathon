// v3lab theme extension (R3 proof build). Everything else comes from remotion/v2/theme.ts.
// FLAGGED for review: v2 has no green token; the watch LEDs need one (PROOF-SPEC §P2). The 3D material colours are
// three.js material inputs (linear-ish albedo), not UI colours, and live here so no component carries a raw hex.
import { color } from "../v2/theme";

/** Watch LED green at alpha a (0..1). The only new UI colour in v3lab. */
export const ledGreen = (a: number) => `rgba(72, 255, 120, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
export const LED_GREEN_HEX = "#48FF78";

/** three.js material colours (3D only). */
export const mat3d = {
  watchMetal: "#5a5a5a",
  watchBack: "#2a2a2a",
  watchSensorDark: "#101010",
  watchPhotodiode: "#4a4a4a",
  rackBody: "#1E1E1E",
  rackDoor: "#151515",
  rackGlass: "#9aa0a6",
  accent: color.accent,
  hemiSky: "#ffffff",
  hemiGround: "#202020",
} as const;

/** 72 bpm illustrative heartbeat: 0.35 + 0.65 * max(0, sin(2*pi*(f/30)*1.2))^3; 0 before `from`. */
export function heartPulse(frame: number, from: number): number {
  if (frame < from) return 0;
  const s = Math.max(0, Math.sin(2 * Math.PI * ((frame - from) / 30) * 1.2));
  return 0.35 + 0.65 * s * s * s;
}

export { color };
