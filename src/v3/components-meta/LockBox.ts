// LockBox — the locked box the cat picture travels in (S2 "cat picture" reel; replaces S1's sealed letter, owner
// feedback 2026-11-02). Footprint w × 1.42 w: headroom on top for the card when it is out, the box below.
//
//   front: a padlock on the right of the front (hasp on the lid), an ADDRESS LABEL "to: <address>" across the bottom
//          that stays readable in every state (a snooper sees where it is going).
//   states (all transitions from the state event's frame; an initial state is drawn settled):
//     open      lid up, padlock open, the card stands out of the box (photo visible).
//     locked    (20 f) the card drops in, the lid closes, the shackle clicks shut (lock = lockTone).
//     peek      (8 f) x-ray view of the LOCKED box: the front goes see-through and the card inside shows as scrambled
//               characters — label still crisp, lock still shut ("can see where it's going, not what's inside").
//     unlocked  (22 f) the shackle lifts (lock turns NEUTRAL — never red: the website opening its own box is normal),
//               the lid opens, the card rises out (photo visible). With `key`, a key sits in the lock and turns first.
//   pulse: the box bumps (arrives / hops a stop).
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

// Metas may import only zod at runtime (the Remotion bundle cannot resolve "./X.js" → X.ts), so these are copies;
// test/v3-s2-components.test.ts checks they equal BrowserWindow.GENERIC_HOST, Padlock.padlockGeom and PhotoCard's.
export const GENERIC_HOST = /^(?:[a-z0-9-]{1,20}\.)?(?:example\.(?:com|org|net)|[a-z0-9-]{1,20}\.(?:example|test))$/;
export const DEFAULT_PHOTO = "cat-photo@1";
export const PHOTO_REF = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}@\d{1,3}$/;
/** = Padlock.padlockGeom (keyhole / body only). */
export function padlockGeom(s: number, cx: number, cy: number) {
  const bw = s * 0.8, bh = s * 0.6;
  return { bw, bh, bodyTop: cy - bh / 2, keyhole: { x: cx, y: cy - bh * 0.06, r: s * 0.075 } };
}

export const LB = { aspect: 1.42, lockF: 20, unlockF: 22, peekF: 8 } as const;

export const LockBoxProps = z
  .object({
    w: z.number().int().min(200).max(800).default(420),
    address: z.string().max(24).regex(GENERIC_HOST, "address must be a reserved generic name (example.com/.org/.net, *.example, *.test)").default("example.com"),
    photo: z.string().regex(PHOTO_REF).default(DEFAULT_PHOTO),
    lockTone: z.enum(["accent", "neutral"]).default("accent"),
    key: z.boolean().default(false),
  })
  .strict();
export type LockBoxPropsT = z.output<typeof LockBoxProps>;

/** All parts in footprint px for width w. */
export function lockBoxGeom(w: number) {
  const top = 0.62 * w;
  const body = { x: 0.05 * w, y: top, w: 0.9 * w, h: 0.74 * w };
  const lid = { x: 0.03 * w, y: top - 0.09 * w, w: 0.94 * w, h: 0.11 * w };
  const cardS = 0.46 * w;
  const cardOut = { x: 0.5 * w, y: top - 0.2 * w };
  const cardIn = { x: 0.43 * w, y: top + 0.36 * w };
  const xray = { x: 0.4 * w, y: top + 0.27 * w, s: 0.4 * w };
  const lockS = 0.24 * w;
  const lock = { cx: 0.8 * w, cy: top + 0.06 * w + 0.3 * lockS + 0.06 * w, s: lockS };
  const label = { x: 0.1 * w, y: top + 0.52 * w, w: 0.8 * w, h: 0.15 * w };
  return { W: w, H: Math.round(LB.aspect * w), top, body, lid, cardS, cardOut, cardIn, xray, lock, label, pl: padlockGeom(lockS, lock.cx, lock.cy) };
}

export const labelText = (address: string) => `to: ${address}`;

export const meta: V3MetaDef<typeof LockBoxProps> = {
  name: "LockBox",
  version: 1,
  tier: "p0",
  spec: "S2 brief 2026-11-02 (locked box with a readable address; open = neutral)",
  summary: "Box carrying the cat picture: padlock clicks shut, address label readable outside, x-ray shows scrambled contents, opens neutrally.",
  families: ["security", "network"],
  propsSchema: LockBoxProps,
  propsSchemaName: "LockBoxProps",
  example: { w: 420, address: "example.com" },
  states: ["open", "locked", "peek", "unlocked"],
  verbs: {
    enter: { durF: 12, does: "box pops in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: LB.unlockF, does: "open → locked (card drops in, lid shuts, padlock clicks) → peek (x-ray: contents scrambled, label readable) → unlocked (lock opens neutral, card rises out)", props: ["lockTone", "key", "address", "photo"] },
    pulse: { durF: 10, does: "box bumps (arrives / hops a stop)" },
  },
  focal: true,
  footprint: (p) => ({ w: p.w, h: Math.round(LB.aspect * p.w) }),
  sfx: { enter: "whoosh", state: "tick", pulse: "tick" },
  v3kind: "device",
  assetIds: ["lock-box"],
  anchors: (p, _s, _c, state): AnchorMap => {
    const g = lockBoxGeom(p.w);
    const shut = state === "locked" || state === "peek";
    const a: AnchorMap = {
      box: { x: g.body.x + g.body.w / 2, y: g.body.y + g.body.h / 2, r: g.body.w / 2, label: "the locked box", physical: "your picture, packed for the trip" },
      lid: { x: g.lid.x + g.lid.w / 2, y: g.lid.y + g.lid.h / 2, r: g.lid.w / 2, label: "the lid", physical: "closes over the picture" },
      padlock: { x: g.lock.cx, y: g.lock.cy, r: g.lock.s * 0.55, label: shut ? "the lock (shut)" : "the lock (open)", physical: "TLS: the lock only the website can open" },
      keyhole: { x: g.pl.keyhole.x, y: g.pl.keyhole.y, r: g.lock.s * 0.12, label: "the keyhole", physical: "where the website's key goes" },
      label: { x: g.label.x + g.label.w / 2, y: g.label.y + g.label.h / 2, r: g.label.w / 2, label: "the address label", physical: "where it's going (the website's name) - readable from outside" },
    };
    if (state === "peek") a.contents = { x: g.xray.x, y: g.xray.y, r: g.xray.s / 2, label: "what's inside (scrambled)", physical: "to a snooper the picture is just random characters" };
    if (!shut) a.card = { x: g.cardOut.x, y: g.cardOut.y, r: g.cardS / 2, label: "the cat picture", physical: "the photo you post, out of the box" };
    if (p.key) a.key = { x: g.pl.keyhole.x, y: g.pl.keyhole.y, r: g.lock.s * 0.22, label: "the key", physical: "the website's key in the lock" };
    return a;
  },
  describe: (state, p) => {
    const lock = state === "locked" || state === "peek" ? `LOCKED (${p.lockTone})` : "lock OPEN (neutral)";
    const inside = state === "peek" ? "x-ray: contents SCRAMBLED, address readable" : state === "locked" ? "picture inside, hidden" : "picture OUT of the box, visible";
    return `LockBox "${labelText(p.address)}" ${lock}; ${inside}${p.key ? "; key in the lock" : ""}`;
  },
};
