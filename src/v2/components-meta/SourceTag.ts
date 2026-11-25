// SourceTag / Quote — bible §6.9: one component, three variants.
//
//   pill   [ Wiz Research · found Aug 19 ]      mono 500 30 px (type.pill), text + " · detail" in textDim,
//                                               radius.pill, 1 px borderStrong outline, opaque bgRaised plate
//   stack  [ GPT-5 ]                            outline pills of model / vendor names, 14 px apart, staggered in
//          [ Claude ]                           3 f each; `highlight` = one pill in accent
//          [ Gemini ]
//   quote  ┃ "We patched it within hours."      3 px accent rule, white sans 500 40 px (≤ 4 lines), 52 px rows;
//          ┃ — OpenAI                           attribution mono 400 26 px textDim; opaque bg plate
//
// Renderer: remotion/v2/components/SourceTag.tsx.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const SOURCE_TAG = {
  pillPx: 30, // type.pill
  pillLh: 36,
  pillPadX: 24,
  pillPadY: 14,
  pillBorder: 1,
  /** accent / danger tone dot: a fixed 10 px circle + 12 px gap before the text (never a "●" text glyph). */
  dotPx: 10,
  dotGap: 12,
  stackGap: 14,
  quotePx: 40,
  quoteLh: 52,
  quoteWeight: 500,
  ruleW: 3,
  ruleGap: 28,
  quotePadY: 8,
  attrPx: 26,
  attrLh: 34,
  attrGap: 18,
  quoteDefaultW: 860,
  quoteMinW: 420,
  maxW: 952,
  maxQuoteLines: 4,
  /** Inter 500 average advance incl. caps and punctuation (conservative: the footprint must not be short). */
  quoteEm: 0.58,
} as const;

export const SourceTagProps = z
  .object({
    variant: z.enum(["pill", "stack", "quote"]).default("pill"),
    /** pill: the source ("Wiz Research", "LINUX KERNEL · OOM KILLER", ≤ 40); quote: the quote (≤ 140). */
    text: z.string().min(1).max(140).optional(),
    /** pill: a secondary part in textDim after " · " (e.g. "found Aug 19"); scrambles when it changes. */
    detail: z.string().min(1).max(24).optional(),
    /** stack: the pill labels (model names, vendors), top to bottom. */
    items: z.array(z.string().min(1).max(24)).min(1).max(6).optional(),
    /** stack: index of the pill drawn in accent (set later with `mark` props.highlight). */
    highlight: z.number().int().min(0).max(5).optional(),
    /** quote: attribution without the dash ("OpenAI"); rendered as "— OpenAI". */
    attribution: z.string().min(1).max(28).optional(),
    /** pill/stack outline tone: neutral (grey), accent (lime outline + ● dot), danger (red outline + ● dot,
     *  dangerSurface), dim. Quote: the rule is accent unless tone is danger. */
    tone: Tone.default("neutral"),
  })
  .strict()
  .superRefine((p, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (p.variant === "pill") {
      need(!!p.text, "text", "pill needs text");
      need(!p.text || p.text.length <= 40, "text", "pill text ≤ 40 characters");
      need(!p.text || !p.detail || p.text.length + 3 + p.detail.length <= 46, "detail", "pill text + detail ≤ 46 characters");
    } else if (p.variant === "stack") {
      need(!!p.items, "items", "stack needs items");
      need(p.highlight === undefined || (!!p.items && p.highlight < p.items.length), "highlight", "highlight must index an item");
    } else {
      need(!!p.text, "text", "quote needs text");
      need(!!p.text && quoteLines(p.text, SOURCE_TAG.maxW).length <= SOURCE_TAG.maxQuoteLines, "text", "quote wraps to more than 4 lines at the widest box");
    }
  });

export type SourceTagPropsT = z.output<typeof SourceTagProps>;

const S = SOURCE_TAG;
const monoW = (n: number, px: number) => n * px * 0.6;
const dotted = (tone: string) => tone === "accent" || tone === "danger";

/** Width of the pill's text run (JetBrains Mono: every glyph advances exactly 0.6 em; checked against the TTF). */
export const pillTextWidth = (text: string, detail: string | undefined) => monoW(text.length + (detail ? 3 + detail.length : 0), S.pillPx);
/** Width the dot slot takes (circle + gap), 0 without a dot. */
export const pillDotWidth = (dot: boolean) => (dot ? S.dotPx + S.dotGap : 0);
export const isDottedTone = dotted;

/** Pill width for this text/detail. `tone` = a tone name (dot for accent/danger) or a boolean "has a dot". */
export function pillWidth(text: string, detail: string | undefined, tone: string | boolean): number {
  const dot = typeof tone === "boolean" ? tone : dotted(tone);
  return Math.ceil(2 * S.pillPadX + 2 * S.pillBorder + pillDotWidth(dot) + pillTextWidth(text, detail));
}
export const pillHeight = S.pillLh + 2 * S.pillPadY + 2 * S.pillBorder;

/** Greedy word wrap with the conservative advance estimate (same function for footprint and Render line breaks). */
export function quoteLines(text: string, boxW: number): string[] {
  const inner = boxW - S.ruleW - S.ruleGap;
  const per = Math.max(8, Math.floor(inner / (S.quotePx * S.quoteEm)));
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= per || !cur) cur = next;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function quoteWidth(p: Pick<SourceTagPropsT, "text" | "attribution">, w: number | undefined): number {
  const attr = p.attribution ? S.ruleW + S.ruleGap + monoW(p.attribution.length + 2, S.attrPx) : 0;
  return Math.min(S.maxW, Math.max(w ?? S.quoteDefaultW, S.quoteMinW, Math.ceil(attr)));
}

export function sourceTagSize(p: SourceTagPropsT, w: number | undefined): { w: number; h: number } {
  // the box always reserves the dot: any state can switch a neutral pill to accent / danger (the pill itself is drawn
  // at its current width, left-aligned, and springs between widths)
  if (p.variant === "pill") return { w: Math.min(S.maxW, pillWidth(p.text ?? "", p.detail, true)), h: pillHeight };
  if (p.variant === "stack") {
    const items = p.items ?? [];
    // every pill reserves the dot so a later `mark` highlight never widens it
    return { w: Math.min(S.maxW, Math.max(...items.map((t) => pillWidth(t, undefined, true)))), h: items.length * pillHeight + (items.length - 1) * S.stackGap };
  }
  const qw = quoteWidth(p, w);
  const lines = quoteLines(p.text ?? "", qw).length;
  return { w: qw, h: 2 * S.quotePadY + lines * S.quoteLh + (p.attribution ? S.attrGap + S.attrLh : 0) };
}

export const meta = {
  name: "SourceTag",
  version: 1,
  tier: "core",
  spec: "bible §6.9 (SourceTag / Quote)",
  summary: "Source pill (\"Wiz Research · found Aug 19\"), a stack of outline name pills, or a pull-quote with a 3 px lime rule and a mono attribution.",
  families: ["security", "outage", "network", "systems", "science", "data"],
  propsSchema: SourceTagProps,
  propsSchemaName: "SourceTagProps",
  example: { text: "Wiz Research", detail: "found Aug 19" },
  states: ["neutral", "accent", "danger", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: 13, does: "plate-first entrance (plateFade: spring y 24→0, scale 0.97→1, plate opaque before its text); stack pills stagger in 3 f each, the quote rule grows top → bottom over 10 f" },
    exit: { durF: 8, does: "content-first exit (plateFade): text fades + blurs 4 f on the opaque plate(s), then the plates 4 f" },
    state: { durF: 8, does: "tone change of the outline/dot (snap) and plate (6 f); a new detail scrambles 8 f (pill; the box keeps the base width, so keep it no longer than the base detail)", props: ["detail"] },
    scramble: { durF: 8, does: "pill: settle a new detail (dates!) left to right over 8 f", props: ["detail"] },
    mark: { durF: 6, does: "stack: move the accent highlight to props.highlight (outline + text snap, 6 f plate fade)", props: ["highlight"] },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
  },
  focal: false,
  footprint: (p, w) => sourceTagSize(p, w),
  sfx: { scramble: "tick", mark: "tick" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof SourceTagProps>;
