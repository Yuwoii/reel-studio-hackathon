// Envelope — a sealed letter (the TLS carrier analogy), promoted from remotion/v3lab/hook/devices.tsx (Envelope).
// Footprint w × 1.28 w: the envelope body (h = 0.66 w) sits at the bottom; the space above holds the note when it
// rises out on "open". state "open" (18 f): the flap flips up, the seal splits (danger halves fly apart), the note
// with password dots rises. `glow`: accent halo around the intact seal.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const ENV = { bodyH: 0.66, headroom: 0.62, sealR: 0.11, openF: 18 } as const;

export const EnvelopeProps = z
  .object({
    w: z.number().int().min(160).max(600).default(300),
    glow: z.boolean().default(false),
  })
  .strict();
export type EnvelopePropsT = z.output<typeof EnvelopeProps>;

export function envelopeBox(w: number) {
  const H = ENV.bodyH * w;
  const top = ENV.headroom * w;
  return { W: w, H, top, cx: w / 2, sealY: top + H * 0.55 };
}

export const meta: V3MetaDef<typeof EnvelopeProps> = {
  name: "Envelope",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3; R1 TLS analogy (sealed letter)",
  summary: "Sealed envelope (the encrypted message): glowing seal; opens (seal splits, note with password dots rises).",
  families: ["security", "network"],
  propsSchema: EnvelopeProps,
  propsSchemaName: "EnvelopeProps",
  example: { w: 300 },
  states: ["sealed", "open"],
  verbs: {
    enter: { durF: 12, does: "envelope pops in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: ENV.openF, does: "sealed → open: flap flips, seal splits, the note rises out", props: ["glow"] },
    pulse: { durF: 10, does: "seal glow pulse" },
  },
  focal: true,
  footprint: (p) => ({ w: p.w, h: Math.round((ENV.bodyH + ENV.headroom) * p.w) }),
  sfx: { enter: "whoosh", state: "glitch" },
  v3kind: "device",
  assetIds: ["envelope"],
  anchors: (p, _size, _ctx, state): AnchorMap => {
    const b = envelopeBox(p.w);
    const a: AnchorMap = {
      envelope: { x: b.cx, y: b.top + b.H / 2, r: p.w / 2, label: "the sealed letter", physical: "the message, sealed (encrypted) for the trip" },
      seal: { x: b.cx, y: b.sealY, r: ENV.sealR * p.w * 1.4, label: "the seal", physical: "the lock on the letter: only the right recipient can open it (TLS)" },
      flap: { x: b.cx, y: b.top + b.H * 0.22, r: p.w * 0.3, label: "the flap", physical: "envelope flap" },
    };
    // the note exists on screen only once opened (it rises out of the envelope); sealed, its anchor would be empty space
    if (state === "open") a.note = { x: b.cx, y: b.top + b.H * 0.48 - b.H * 0.78, r: p.w * 0.38, label: "the letter inside", physical: "the readable message (e.g. your password) once opened" };
    return a;
  },
  describe: (state, p) => `Envelope ${state === "open" ? "OPEN: seal broken, note with password dots readable" : `sealed${p.glow ? " (seal glowing)" : ""}`}`,
};
