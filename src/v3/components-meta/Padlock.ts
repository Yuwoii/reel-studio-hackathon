// Padlock — a drawn padlock (the TLS lock in the S2 "cat picture" reel; owner S1 feedback 2026-11-02). Footprint
// w × 1.1 w: shackle on top, body below with a keyhole. state "locked" (8 f): the shackle drops and clicks shut;
// "open" (8 f): the shackle lifts and swings out. Colour: locked = `tone` (accent = brand lime, neutral = white
// outline); OPEN IS ALWAYS NEUTRAL — the website opening its own lock is normal, never styled as an attack (no red,
// owner S2 brief). `key`: a key sits in the keyhole; `pulse` turns it a quarter turn (the front server's key).
// The drawing is shared with LockBox (remotion/v3/components/Padlock.tsx `PadlockGlyph`).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const PL = { aspect: 1.1, turnF: 8, stateF: 8 } as const;

/** Geometry of a padlock of width s whose BODY centre is (cx, cy): shared by Padlock and LockBox. */
export function padlockGeom(s: number, cx: number, cy: number) {
  const bw = s * 0.8, bh = s * 0.6;
  const bodyTop = cy - bh / 2;
  const shW = s * 0.5, shH = s * 0.42, shT = s * 0.1;
  return { bw, bh, bodyTop, bodyX: cx - bw / 2, shW, shH, shT, keyhole: { x: cx, y: cy - bh * 0.06, r: s * 0.075 }, lift: s * 0.16 };
}

export const PadlockProps = z
  .object({
    w: z.number().int().min(60).max(600).default(240),
    tone: z.enum(["accent", "neutral"]).default("accent"),
    key: z.boolean().default(false),
  })
  .strict();
export type PadlockPropsT = z.output<typeof PadlockProps>;

export function padlockBox(w: number) {
  const H = Math.round(PL.aspect * w);
  // body centre: the body (0.6 w tall) sits at the bottom with a small margin
  return { W: w, H, cx: w / 2, cy: H - w * 0.06 - (w * 0.6) / 2 };
}

export const meta: V3MetaDef<typeof PadlockProps> = {
  name: "Padlock",
  version: 1,
  tier: "p0",
  spec: "S2 brief 2026-11-02 (drawn lock; open = neutral, never red)",
  summary: "Drawn padlock: shackle clicks shut (locked, accent) or lifts open (neutral, never red); optional key that turns.",
  families: ["security", "network"],
  propsSchema: PadlockProps,
  propsSchemaName: "PadlockProps",
  example: { w: 240, tone: "accent" },
  states: ["locked", "open"],
  verbs: {
    enter: { durF: 12, does: "padlock pops in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: PL.stateF, does: "locked ↔ open: the shackle drops and clicks shut / lifts and swings out (open is neutral)", props: ["tone", "key"] },
    pulse: { durF: PL.turnF, does: "the key in the keyhole turns a quarter turn (needs key)" },
  },
  focal: true,
  footprint: (p) => ({ w: p.w, h: Math.round(PL.aspect * p.w) }),
  sfx: { enter: "tick", state: "tick", pulse: "tick" },
  v3kind: "device",
  assetIds: ["padlock"],
  anchors: (p): AnchorMap => {
    const b = padlockBox(p.w);
    const g = padlockGeom(p.w, b.cx, b.cy);
    const a: AnchorMap = {
      lock: { x: b.cx, y: b.cy, r: p.w * 0.42, label: "the lock", physical: "the padlock (TLS: only the right side can open it)" },
      body: { x: b.cx, y: b.cy, r: g.bw / 2, label: "the lock body", physical: "the padlock's body" },
      shackle: { x: b.cx, y: g.bodyTop - g.shH * 0.55, r: g.shW * 0.6, label: "the shackle", physical: "the U-shaped bar that clicks shut" },
      keyhole: { x: g.keyhole.x, y: g.keyhole.y, r: p.w * 0.1, label: "the keyhole", physical: "where the key goes" },
    };
    if (p.key) a.key = { x: g.keyhole.x, y: g.keyhole.y, r: p.w * 0.2, label: "the key", physical: "the key that opens this lock" };
    return a;
  },
  describe: (state, p) => `Padlock ${state === "open" ? "OPEN (neutral, normal opening)" : `LOCKED (${p.tone})`}${p.key ? ", key in the keyhole" : ""}`,
};
