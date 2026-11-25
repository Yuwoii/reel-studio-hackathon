// Glow — a light annotation on a bound anchor (D1 #2e: a LABELLED green glow over the real watch photo is allowed).
//   light "led" = physically green light (LED green token); "accent" = UI emphasis.
//   mode "steady": constant; "shimmer": steady + fast per-frame shimmer (what PPG LEDs look like — they flash hundreds of
//   times a second); "returned": dips once per heartbeat at `bpm` (the light coming BACK to the sensors). Use shimmer on
//   LEDs and returned on the sensors/skin — never "returned" on an LED (R1 facts review W02; physics judge reads describe()).
//   label: mono caption under the glow. REQUIRED when `onPhoto` (D1 #2e: only a LABELLED glow over a real photo).
//   target: the anchor name the glow is bound to (the lowering fills it from the binding). The schema refuses
//   mode "returned" on an LED target (/(^|\.)leds?(\.|$)/): a heartbeat-pulsing LED is the physics error the R1 facts
//   review blocked (W02). describe() prints the target so the physics judge sees what glows.
//   onPhoto: bound to a photo Plate anchor — the glow is kept tight (spread 1.5 × r instead of 2.4 ×) and at 60 %
//   strength, so it reads as light at the lenses, not as a glowing case (W3a review).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

/** An anchor name that is an LED (or the LED group): "led.left", "leds", "unit3.leds", "led.2". */
export const LED_ANCHOR = /(^|\.)leds?(\.|$)/;
export const GLOW = { spread: 2.4, spreadPhoto: 1.5, photoAlpha: 0.6, labelGap: 46, labelPx: 26, labelCh: 15.6, labelH: 46 } as const;
export const GlowProps = z
  .object({
    r: z.number().min(10).max(300).default(60),
    light: z.enum(["led", "accent"]).default("led"),
    mode: z.enum(["steady", "shimmer", "returned"]).default("shimmer"),
    bpm: z.number().int().min(40).max(180).default(72),
    dip: z.number().min(0.15).max(0.5).default(0.35),
    label: z.string().min(2).max(24).optional(),
    target: z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+){0,2}$/).optional(),
    onPhoto: z.boolean().default(false),
  })
  .strict()
  .refine((p) => !(p.mode === "returned" && p.target && LED_ANCHOR.test(p.target)), {
    message: "Glow mode 'returned' (dips once per heartbeat) cannot sit on an LED: LEDs flash hundreds of times a second and look steady — use mode 'shimmer' on LEDs and 'returned' on the light sensors / skin (R1 facts W02)",
    path: ["mode"],
  })
  .refine((p) => !p.onPhoto || !!p.label, { message: "a Glow over a real photo must be labelled (D1 #2e: annotation glow on photos only when labelled)", path: ["label"] });
export type GlowPropsT = z.output<typeof GlowProps>;

export function glowGeom(p: Pick<GlowPropsT, "r" | "label"> & { onPhoto?: boolean }) {
  const R = p.r * (p.onPhoto ? GLOW.spreadPhoto : GLOW.spread);
  const lw = p.label ? p.label.length * GLOW.labelCh + 40 : 0;
  const w = Math.max(2 * R, lw + 16);
  const h = 2 * R + (p.label ? Math.max(0, p.r + GLOW.labelGap + GLOW.labelH - R) : 0);
  return { w, h, ax: w / 2, ay: R, R, label: p.label ? { x: w / 2 - lw / 2, y: R + p.r + GLOW.labelGap - GLOW.labelH / 2, w: lw, h: GLOW.labelH } : null };
}

export const meta: V3MetaDef<typeof GlowProps> = {
  name: "Glow",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §4.3; D1 #2e; R1 facts review W02",
  summary: "Light glow on a named part: LED shimmer (steady), or returned light that dips once per heartbeat; optional label.",
  families: ["science", "systems"],
  propsSchema: GlowProps,
  propsSchemaName: "GlowProps",
  example: { r: 60, light: "led", mode: "shimmer", label: "green light" },
  states: [],
  verbs: { enter: { durF: 10, does: "glow fades in" }, exit: { durF: 8, does: "glow fades out" }, state: { durF: 6, does: "changes mode / label", props: ["mode", "label", "bpm", "dip"] } },
  focal: false,
  footprint: (p) => {
    const g = glowGeom(p);
    return { w: g.w, h: g.h };
  },
  anchor: (p) => {
    const g = glowGeom(p);
    return { x: g.ax, y: g.ay };
  },
  sfx: {},
  enterExit: "self",
  v3kind: "overlay",
  anchors: (p): AnchorMap => {
    const g = glowGeom(p);
    return { centre: { x: g.ax, y: g.ay, r: p.r, label: "glow centre", physical: "sits on the bound anchor" } };
  },
  describe: (_s, p) =>
    `GLOW${p.target ? ` on ${p.target}` : " (target unknown)"}${p.onPhoto ? " over a real photo" : ""} ${p.light === "led" ? "green light" : "accent"} ${p.mode === "returned" ? `returned light, dips ${Math.round(p.dip * 100)}% once per beat @${p.bpm}bpm` : p.mode === "shimmer" ? "steady with fast shimmer (not heart rate)" : "steady"}${p.label ? ` label "${p.label}"` : " UNLABELLED"}`,
};
