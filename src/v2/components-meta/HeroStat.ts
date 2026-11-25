// HeroStat — bible §6.2 (+ amendments §2/§6: hero mono 600 / 220 px, tabular, tracking −0.03em; tone may be danger
// when the number IS the failure, e.g. 137 = OOMKilled; the count-up is optional, a settle-in scramble is allowed).
//
//   ┌──────────────────────────────────────────────┐
//   │ EXIT CODE                        ● SIGKILL   │  mono 500 26 px, textDim / tone (optional row)
//   │ 137                                          │  mono 600 220 px, tone colour, tabular-nums
//   │ kubectl describe pod · Last State            │  mono 400 26 px, textDim (optional row)
//   └──────────────────────────────────────────────┘  opaque plate (bgRaised / dangerSurface), radius.card
//
// Plate width: without an explicit `w` the plate hugs its content = max(label row, caption, hero text at 220 px) +
// padding (≥ 480), so a short number never sits on a half-empty card. Hero number, label row and caption share ONE
// left axis for the instance's whole life (W2 fix round 2: no centring, so a count-up 0 and a final 0 sit in the
// same place). The tag's "● " is always reserved (any state change may reach danger/accent), and an override may add a
// tag to a base that has a label row (the width check in propsTimeline still applies).
//
// Renderer: remotion/v2/components/HeroStat.tsx. Runtime imports: zod only.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

const HERO_MAX_CHARS = 11;

/** en-US grouping, locale-free (= motion.ts formatCount; duplicated: meta files have no relative runtime imports). */
export function formatValue(v: number | string, decimals: number): string {
  if (typeof v === "string") return v;
  const fixed = Math.abs(v).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  return `${v < 0 ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

/** Hero row text: prefix + formatted value + suffix. */
export function heroText(p: { prefix?: string; suffix?: string }, formatted: string): string {
  return `${p.prefix ?? ""}${formatted}${p.suffix ?? ""}`;
}

export const HeroStatProps = z
  .object({
    /** The number. A number counts up (`countUp`, 20 f ease-out); a numeric string ("137", "1,284,301", "0.62") counts
     *  up too and keeps its grouping/decimals; any other string ("v8.5", "T+6h") settles in with a scramble. */
    value: z.union([z.number().min(-99999).max(9999999), z.string().min(1).max(9)]),
    /** Decimals for a numeric `value` (numeric strings use their own). */
    decimals: z.number().int().min(0).max(3).default(0),
    /** Drawn in the hero size right before / after the number ("$", "%", "ms", "x"). */
    prefix: z.string().min(1).max(2).optional(),
    suffix: z.string().min(1).max(3).optional(),
    /** Top-left, mono 500 26 px, textDim, letter-spaced ("EXIT CODE"). */
    label: z.string().min(1).max(24).optional(),
    /** Top-right, mono 500 26 px in the tone colour, "● " added for danger/accent ("SIGKILL"). Pulses in danger. */
    tag: z.string().min(1).max(14).optional(),
    /** Under the number, mono 400 26 px textDim ("of websites run PHP · W3Techs"). */
    caption: z.string().min(1).max(48).optional(),
    /** Initial state. accent = lime number (default); danger = red number on dangerSurface (the number is the
     *  failure); neutral = white number; dim = de-emphasised. */
    tone: Tone.default("accent"),
  })
  .strict()
  .refine((p) => heroText(p, formatValue(p.value, p.decimals)).length <= HERO_MAX_CHARS, { message: `prefix + value + suffix must be ≤ 11 characters (the hero row never shrinks below 120 px)`, path: ["value"] });

export type HeroStatPropsT = z.output<typeof HeroStatProps>;

export const HERO_STAT = {
  defaultW: 860,
  minW: 480,
  maxW: 952,
  padTop: 34,
  padBottom: 38,
  padX: 44,
  border: 2,
  heroPx: 220, // amendments §2
  heroMinPx: 120,
  heroLine: 1.05,
  /** JetBrains Mono advance 0.6 em, tracking −0.03 em. */
  heroCharEm: 0.57,
  smallPx: 26,
  smallRowH: 34,
  labelGap: 10,
  captionGap: 14,
  countF: 20,
  scrambleF: 8,
} as const;

/** Mono 26 px with letter-spacing `trackEm` (0.6 em advance + tracking). */
const monoW = (chars: number, px: number, trackEm = 0) => chars * px * (0.6 + trackEm);

/** Numeric strings that count up: "137", "1,284,301", "0.62", "-3". */
export const NUMERIC_VALUE = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

/** Hero font size that fits `chars` characters in the inner width (never above 220 px; text stays at final size). */
export function heroPxFor(chars: number, w: number): number {
  const inner = w - 2 * HERO_STAT.padX - 2 * HERO_STAT.border;
  return Math.max(HERO_STAT.heroMinPx, Math.min(HERO_STAT.heroPx, Math.floor(inner / (Math.max(1, chars) * HERO_STAT.heroCharEm))));
}

export function heroStatHeight(p: Pick<HeroStatPropsT, "label" | "tag" | "caption">): number {
  const top = p.label || p.tag ? HERO_STAT.smallRowH + HERO_STAT.labelGap : 0;
  const cap = p.caption ? HERO_STAT.captionGap + HERO_STAT.smallRowH : 0;
  return 2 * HERO_STAT.border + HERO_STAT.padTop + top + Math.ceil(HERO_STAT.heroPx * HERO_STAT.heroLine) + cap + HERO_STAT.padBottom;
}

/** Hero text width (px) of `chars` characters at `px`. */
export const heroTextW = (chars: number, px: number) => chars * px * HERO_STAT.heroCharEm;

/** Plate width for the label/tag row, the caption, and the hero text at `heroPx` (default the minimum hero size). */
export function heroStatMinWidth(p: HeroStatPropsT, heroPx: number = HERO_STAT.heroMinPx): number {
  const chrome = 2 * HERO_STAT.padX + 2 * HERO_STAT.border;
  // "● " reserved whatever the initial tone: a state change to danger/accent adds it without resizing the box
  const dot = p.tag ? 2 : 0;
  const top = (p.label ? monoW(p.label.length, HERO_STAT.smallPx, 0.06) : 0) + (p.tag ? monoW(p.tag.length + dot, HERO_STAT.smallPx, 0.06) + 24 : 0);
  const cap = p.caption ? monoW(p.caption.length, HERO_STAT.smallPx, 0.02) : 0;
  const hero = heroTextW(heroText(p, formatValue(p.value, p.decimals)).length, heroPx);
  return Math.ceil(chrome + Math.max(top, cap, hero));
}

export const meta = {
  name: "HeroStat",
  version: 1,
  tier: "core",
  spec: "bible §6.2 + amendments §2/§6",
  summary: "One big tabular number on a plate (label row, caption): counts up 20 f or settles in; tone may be danger.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: HeroStatProps,
  propsSchemaName: "HeroStatProps",
  example: { value: 137, label: "EXIT CODE", caption: "kubectl describe pod · Last State", tone: "danger" },
  states: ["accent", "danger", "neutral", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: 13, does: "entrance spring, plate opaque first, content 3 f later; without any countUp action the digits settle in with an 8 f scramble (only when entering after f0)" },
    exit: { durF: 8, does: "content fades + blurs over 4 f on the still-opaque plate, then the plate fades + blurs over 4 f" },
    countUp: { durF: 20, does: "count from 0 to the value, 20 f ease-out cubic, tabular digits (shows 0 until the first countUp)" },
    state: { durF: 8, does: "tone change: plate cross-fades 6 f, number/tag colour snaps; a new value/label/tag/caption scrambles in 8 f (a tag needs the base's label row, a caption the base's caption)", props: ["value", "label", "tag", "caption"] },
    scramble: { durF: 8, does: "re-scramble the number (or settle into a new value)", props: ["value"] },
    focus: { durF: 10, does: "keyword kick on the number: scale 1 → 1.04 → 1" },
    pulse: { durF: 12, does: "one glow flash of the plate border in the state colour" },
    glitch: { durF: 4, does: "4 f red/white tinted-copy glitch with slice displacement (counts toward the 0–3 budget)" },
  },
  focal: true,
  // explicit w is honoured; otherwise the plate hugs its content at the full 220 px hero size
  footprint: (p, w) => ({ w: Math.min(HERO_STAT.maxW, Math.max(w ?? heroStatMinWidth(p, HERO_STAT.heroPx), HERO_STAT.minW, heroStatMinWidth(p))), h: heroStatHeight(p) }),
  sfx: { countUp: "chatter", state: "tick", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof HeroStatProps>;
