// Which visual events an SFX may sit on (bible: SFX are "synced to visual events"; ADR-001 §7). Shared by the director
// lint (L36, src/v2/lints.ts) and the mixer's re-anchor step (src/audio/v2/sfx.ts planSfx), so both agree on what
// "on a visual event" means. Pure; the registry `sfx` map (verb → suggested SFX per component) is the source of truth,
// plus a few verbs that read as the sound regardless of the component:
//
//   whoosh   a camera key start (move or hard cut) in the beat, or an action whose registry sfx is whoosh
//            (PointerArrow drawOn, Timeline drawOn, RequestPill enter, NodeGraph mark, …)
//   tick     state / enter / focus, a hard cut, or registry sfx tick
//   thud     state / enter / focus, a hard cut or a camera key with shake, or registry sfx thud
//   glitch   a glitch action, a hard cut, or registry sfx glitch
//   chatter  enter / countUp / mark, or registry sfx chatter (count-ups, terminal lines, data-field marks)

import { COMPONENTS } from "./registry.gen.js";
import type { CameraSegment, TimelineEvent } from "./timeline.js";

export type AnchoredSfx = "tick" | "whoosh" | "glitch" | "thud" | "chatter";

/** An SFX within this many frames of one of its anchors is on its visual event. */
export const SFX_ANCHOR_TOL_F = 3;

const VERB_ANCHORS: Record<AnchoredSfx, readonly string[]> = {
  whoosh: [],
  tick: ["state", "enter", "focus"],
  thud: ["state", "enter", "focus"],
  glitch: ["glitch"],
  chatter: ["enter", "countUp", "mark"],
};

/** Data-field verbs (the data field is a layer, not a registry component). */
const DATAFIELD_SFX: Readonly<Record<string, string>> = { mark: "chatter", glitch: "glitch" };

/** (target, verb) → the registry's suggested SFX type, or undefined. */
export type ActionSfxLookup = (target: string, verb: string) => string | undefined;

export function registrySfxLookup(world: readonly { id: string; component: string }[]): ActionSfxLookup {
  const comp = new Map(world.map((i) => [i.id, i.component]));
  const reg = COMPONENTS as unknown as Readonly<Record<string, { sfx: Readonly<Record<string, string>> }>>;
  return (target, verb) => {
    if (target === "datafield") return DATAFIELD_SFX[verb];
    const c = comp.get(target);
    return c ? reg[c]?.sfx[verb] : undefined;
  };
}

export interface SfxAnchor {
  frame: number;
  /** "camera hardCut", "camera longPan", "term mark", … */
  what: string;
}

/** The visual events in one beat an SFX of `type` may sit on, by frame. */
export function sfxAnchors(
  tl: { events: readonly TimelineEvent[]; cameraSegments: readonly Pick<CameraSegment, "beatIndex" | "startF" | "transition" | "shake" | "ease">[] },
  beatIndex: number,
  type: AnchoredSfx,
  sfxFor?: ActionSfxLookup,
): SfxAnchor[] {
  const out: SfxAnchor[] = [];
  for (const s of tl.cameraSegments) {
    if (s.beatIndex !== beatIndex) continue;
    const cut = s.transition === "hardCut";
    if (type === "whoosh" || (type !== "chatter" && cut) || (type === "thud" && s.shake)) out.push({ frame: s.startF, what: `camera ${s.transition === "hardCut" ? "hardCut" : (s.ease ?? "move")}` });
  }
  for (const e of tl.events) {
    if (e.kind !== "action" || e.beatIndex !== beatIndex) continue;
    if (VERB_ANCHORS[type].includes(e.do) || sfxFor?.(e.target, e.do) === type) out.push({ frame: e.frame, what: `${e.target} ${e.do}` });
  }
  return out.sort((a, b) => a.frame - b.frame || (a.what < b.what ? -1 : a.what > b.what ? 1 : 0));
}

/** Nearest anchor to `frame` (ties → the earlier one), or null when the beat has none. */
export function nearestAnchor(anchors: readonly SfxAnchor[], frame: number): SfxAnchor | null {
  let best: SfxAnchor | null = null;
  for (const a of anchors) if (!best || Math.abs(a.frame - frame) < Math.abs(best.frame - frame)) best = a;
  return best;
}
