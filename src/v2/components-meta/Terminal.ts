// Terminal — bible §6.8 (+ amendments §6 / R7: tail mode for log streams).
//
//   ┌────────────────────────────────────────────┐
//   │ ○ ○ ○  bash · node-3                       │  64 px title bar, mono 400 26 px textDim, 1 px `border` rule
//   ├────────────────────────────────────────────┤
//   │ $ echo $((137 - 128))                      │  type mode: mono 30 px / 46 px rows; cmd lines type 2 chars/f
//   │ 9                                          │  with a caret (solid while typing, blinks 16 f after); output
//   │ $ kill -l 9█                               │  lines pop 3 f apart, 4 f after their command finished
//   │ KILL                                       │
//   └────────────────────────────────────────────┘  radius.card, 1 px borderStrong, opaque bgRaised plate
//
// Reveal: `shown` lines (default all) play from enter + 6 f; a later `mark` with props.shown reveals more (the reel
// syncs each command to its phrase). W5.1: in type mode the panel is only as tall as the lines shown so far (it grows
// one row per revealed line over 4 f, top edge fixed); the footprint still reserves every line. Tail mode: lines print one every `every` frames from enter + 6 f in mono
// 26 px / 40 px rows; once more than `rows` lines are out the list scrolls up one row (4 f, bible ease).
// Line kinds: cmd (prompt textDim + text white), out (white), bad (danger), ok (accent), dim (textDim). State dim:
// every line textDim (dim lines, prompt and title textFaint) on the same opaque plate.
// Renderer: remotion/v2/components/Terminal.tsx.
import { z } from "zod";
import type { ComponentMetaDef } from "./_types.js";

const Tone = z.enum(["accent", "danger", "neutral", "dim"]);

export const TerminalLine = z
  .object({
    text: z.string().max(46),
    kind: z.enum(["cmd", "out", "bad", "ok", "dim"]).default("out"),
  })
  .strict();

export const TERMINAL = {
  defaultW: 860,
  maxW: 952,
  titleH: 64,
  titlePx: 26,
  dot: 12,
  dotGap: 10,
  padX: 32,
  padY: 24,
  border: 1,
  type: { px: 30, lh: 46 },
  tail: { px: 26, lh: 40 },
  caretW: 22,
  /** Max characters on one row (prompt + space + text for commands): fits 952 px at 30 px mono. */
  maxChars: 46,
  startDelayF: 6,
  cmdToOutF: 4,
  outStaggerF: 3,
  scrollF: 4,
  fadeF: 3,
} as const;

export const TerminalProps = z
  .object({
    /** Title bar text, mono 26 px textDim ("attacker@internet", "bash · node-3", "kubectl logs -f"). */
    title: z.string().min(1).max(36),
    /** Command prompt (textDim), e.g. "$" or "attacker@internet:~$". */
    prompt: z.string().min(1).max(22).default("$"),
    lines: z.array(TerminalLine).min(1).max(16),
    /** type: commands type 2 chars/f with a caret; tail: log lines print one by one and scroll. */
    mode: z.enum(["type", "tail"]).default("type"),
    /** type mode: lines revealed (default all). Raise it later with `mark` props.shown. */
    shown: z.number().int().min(0).max(16).optional(),
    /** tail mode: visible rows (default min(lines, 6)). */
    rows: z.number().int().min(2).max(8).optional(),
    /** tail mode: frames between printed lines. */
    every: z.number().int().min(2).max(30).default(6),
    /** Initial state: neutral (grey frame), danger (red frame + red title), accent (lime frame), dim. */
    tone: Tone.default("neutral"),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.mode === "type" && p.lines.length > 8) ctx.addIssue({ code: "custom", path: ["lines"], message: "type mode shows at most 8 lines (tail mode up to 16)" });
    p.lines.forEach((l, i) => {
      const n = l.kind === "cmd" && p.mode === "type" ? p.prompt.length + 1 + l.text.length : l.text.length;
      if (n > TERMINAL.maxChars) ctx.addIssue({ code: "custom", path: ["lines", i, "text"], message: `line ${i} is ${n} characters with its prompt (max ${TERMINAL.maxChars})` });
    });
  });

export type TerminalPropsT = z.output<typeof TerminalProps>;

export const terminalRows = (p: Pick<TerminalPropsT, "mode" | "lines" | "rows">): number =>
  p.mode === "tail" ? Math.min(p.rows ?? Math.min(p.lines.length, 6), p.lines.length) : p.lines.length;

export function terminalMinWidth(p: TerminalPropsT): number {
  const T = TERMINAL;
  const m = p.mode === "tail" ? T.tail : T.type;
  const chars = Math.max(...p.lines.map((l) => (l.kind === "cmd" && p.mode === "type" ? p.prompt.length + 1 : 0) + l.text.length));
  const body = 2 * T.padX + chars * m.px * 0.6 + (p.mode === "type" ? T.caretW + 2 : 0);
  const title = 2 * T.padX + 3 * T.dot + 2 * T.dotGap + 24 + p.title.length * T.titlePx * 0.6;
  return Math.ceil(Math.max(body, title) + 2 * T.border);
}

export function terminalHeight(p: TerminalPropsT): number {
  return terminalHeightFor(p, terminalRows(p));
}

/** Panel height for `rows` body rows (fractional while a row grows in). */
export function terminalHeightFor(p: Pick<TerminalPropsT, "mode">, rows: number): number {
  const T = TERMINAL;
  const m = p.mode === "tail" ? T.tail : T.type;
  return T.titleH + 2 * T.padY + rows * m.lh + 2 * T.border;
}

/**
 * W5.1 type mode: rows the panel is TALL at `frame` (it follows the shown lines instead of reserving every line): the
 * lines the enter plays (base `shown`, ≥ 1) from the start, then each later revealed line grows its row in over
 * TERMINAL.scrollF frames from its start (bible ease). `starts` = the renderer's lineStarts(). Tail mode: all rows.
 */
export function terminalRowsAt(p: Pick<TerminalPropsT, "mode" | "lines" | "rows" | "shown">, starts: readonly number[], frame: number, ease: (t: number) => number = (t) => t): number {
  if (p.mode === "tail") return terminalRows(p);
  const base = Math.max(1, Math.min(p.lines.length, p.shown ?? p.lines.length));
  let rows = base;
  for (let i = base; i < starts.length; i++) {
    const s = starts[i];
    if (!Number.isFinite(s) || s > frame) break;
    rows += ease(Math.min(1, Math.max(0, (frame - s) / TERMINAL.scrollF)));
  }
  return rows;
}

export const meta = {
  name: "Terminal",
  version: 2,
  tier: "core",
  spec: "bible §6.8 + amendments §6 (tail mode)",
  summary: "Dark terminal: commands type 2 chars/f with a blinking caret and their output pops in; tail mode streams log lines that scroll.",
  families: ["security", "outage", "systems", "network", "data"],
  propsSchema: TerminalProps,
  propsSchemaName: "TerminalProps",
  example: { title: "bash · node-3", lines: [{ text: "kill -l 9", kind: "cmd" }, { text: "KILL", kind: "bad" }] },
  states: ["neutral", "danger", "accent", "dim"],
  initialState: (p) => p.tone,
  verbs: {
    enter: { durF: 13, does: "plate-first entrance (plateFade: spring y 24→0, scale 0.97→1, plate opaque before the content); the first `shown` lines start playing 6 f after enter" },
    exit: { durF: 8, does: "content-first exit (plateFade): lines + title fade and blur 4 f on the opaque plate, then the plate 4 f" },
    mark: { durF: 12, does: "reveal more lines from this frame (props.shown = total lines shown); the panel grows one row per new line (4 f, top edge fixed — it is only as tall as what it shows); commands type 2 chars/f, outputs follow", props: ["shown"] },
    state: { durF: 8, does: "frame tone: border cross-fades 6 f, title colour snaps (danger = red frame for a failing command); dim pushes it back: every line → textDim (dim lines, prompt and title → textFaint), the plate stays opaque" },
    focus: { durF: 10, does: "keyword kick: scale 1 → 1.03 → 1" },
    glitch: { durF: 4, does: "subtle red/white tinted-copy split on the body only, first 2 f of the 4 f window (copies ±5 px, slices ±10 px: lines stay readable; counts toward the 0–3 budget)" },
  },
  focal: true,
  footprint: (p, w) => ({ w: Math.min(TERMINAL.maxW, Math.max(w ?? TERMINAL.defaultW, terminalMinWidth(p))), h: terminalHeight(p) }),
  sfx: { mark: "chatter", enter: "chatter", glitch: "glitch" },
  enterExit: "self",
} satisfies ComponentMetaDef<typeof TerminalProps>;
