// Stamp — bible §6.11 (danger only, R7: non-danger climaxes use KineticWord). A red outlined box, rotated −4°, heavy
// sans uppercase (Inter 800, 56 px, +0.04em), on an opaque dangerSurface plate. Slams in: scale 1.4 → 1 over 6 f
// (accelerating, blur 4 → 0 px over the first 2 f; the plate is opaque from its first frame — W2.1, no opacity ramp). Text wraps to ≤ 3 lines inside a ≤ 640 px box.
//
// The footprint is the axis-aligned bounding box of the rotated box AT THE SLAM SCALE (1.4), so the Render never draws
// outside it, even on the first (blurred) slam frames (L3/L4 stay honest). The box sits centred in it.
//
// Camera shake (bible §6.11: 3 f, ±6 px): a component cannot move the camera itself. `STAMP_CAMERA_REQUEST` below is
// the request the director/lints read: put `shake: true` on the camera key of the beat whose action enters the Stamp,
// timed to the impact (enter + 6 f). The shake counts toward the 0–3 glitch/shake budget (L10).
//
// Renderer: remotion/v2/components/Stamp.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

export const StampProps = z
  .object({
    /** Rendered uppercase. Printable ASCII only (uppercasing Latin-1 can leave the glyph allow-list). */
    text: z.string().min(1).max(28).regex(/^[\x20-\x7E]*[\x21-\x7E][\x20-\x7E]*$/, "printable ASCII only, not blank"),
  })
  .strict()
  .refine((p) => stampLines(p.text).every((l) => l.length <= maxLineChars), { message: "a single word is longer than one stamp line (12 characters)", path: ["text"] })
  .refine((p) => stampLines(p.text).length <= STAMP.maxLines, { message: "text wraps to more than 3 stamp lines", path: ["text"] });

export type StampPropsT = z.output<typeof StampProps>;

export const STAMP = {
  px: 56,
  weight: 800,
  trackEm: 0.04,
  lineH: 1.1,
  /** Conservative Inter 800 uppercase advance (0.74 em) + tracking. */
  charEm: 0.78,
  padX: 40,
  padY: 26,
  border: 6,
  minW: 320,
  maxContentW: 640,
  maxLines: 3,
  rotateDeg: -4, // theme motion.stamp
  slamFrom: 1.4,
  slamF: 6,
  /** Slam blur 4 → 0 px over the first fadeInF frames (no opacity ramp: the plate is opaque from the first frame). */
  fadeInF: 2,
  slamBlurPx: 4,
} as const;

/** Characters that fit on one line of the widest box (12). */
const maxLineChars = Math.floor((STAMP.maxContentW - 2 * STAMP.padX - 2 * STAMP.border) / (STAMP.px * STAMP.charEm));
export const STAMP_MAX_LINE_CHARS = maxLineChars;

/** Greedy word wrap (uppercase) into lines of ≤ 12 characters. */
export function stampLines(text: string): string[] {
  const words = text.replace(/[a-z]/g, (c) => c.toUpperCase()).trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    if (!cur) cur = wd;
    else if (cur.length + 1 + wd.length <= maxLineChars) cur += ` ${wd}`;
    else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The unrotated box (content size at scale 1). */
export function stampBox(text: string): { w: number; h: number } {
  const lines = stampLines(text);
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.max(STAMP.minW, Math.ceil(longest * STAMP.px * STAMP.charEm + 2 * STAMP.padX + 2 * STAMP.border));
  const h = Math.ceil(lines.length * STAMP.px * STAMP.lineH + 2 * STAMP.padY + 2 * STAMP.border);
  return { w, h };
}

/** Axis-aligned bbox of a w × h box rotated by `deg` and scaled by `s`. */
export function rotatedBox(w: number, h: number, deg: number, s: number): { w: number; h: number } {
  const r = (Math.abs(deg) * Math.PI) / 180;
  return { w: Math.ceil(s * (w * Math.cos(r) + h * Math.sin(r))), h: Math.ceil(s * (w * Math.sin(r) + h * Math.cos(r))) };
}

/** The camera request a Stamp entrance makes (read by the director catalogue / lints; the camera key carries it). */
export const STAMP_CAMERA_REQUEST = { verb: "enter", shake: true, atOffsetF: STAMP.slamF, shakePx: 6, shakeF: 3 } as const;

export const meta = {
  name: "Stamp",
  version: 2,
  tier: "core",
  spec: "bible §6.11 (danger only, R7)",
  summary: "Rotated −4° red outlined box, heavy sans uppercase; slams 1.4 → 1 in 6 f. Pair with a camera key shake: true.",
  families: ["security", "outage", "network", "systems", "data"],
  propsSchema: StampProps,
  propsSchemaName: "StampProps",
  example: { text: "NOT A CRASH" },
  states: [],
  verbs: {
    enter: { durF: 6, does: "slam: scale 1.4 → 1 over 6 f (ease-in, blur 4 → 0 px in 2 f, opaque plate from the first frame), rotated −4°; requests a 3 f ±6 px camera shake at impact (+6 f): set shake: true on that beat's camera key" },
    exit: { durF: 8, does: "text fades + blurs over 4 f on the still-opaque plate, then the plate fades + blurs over 4 f (rotation kept)" },
    pulse: { durF: 12, does: "one inset glow flash of the red box" },
    glitch: { durF: 4, does: "4 f red/white tinted-copy glitch with slice displacement (counts toward the 0–3 budget)" },
  },
  focal: true,
  footprint: (p, w) => {
    const b = stampBox(p.text);
    const r = rotatedBox(b.w, b.h, STAMP.rotateDeg, STAMP.slamFrom);
    // + the slam blur's spread on both sides (the 1.4× first frame is blurred 4 px)
    const m = 2 * STAMP.slamBlurPx;
    return { w: Math.min(952, Math.max(w ?? 0, r.w + m)), h: r.h + m };
  },
  sfx: { enter: "thud", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof StampProps>;
