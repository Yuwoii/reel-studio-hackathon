// Figure renderer (ADR-001 §2.3): fixed code that draws the storyboard's capped vector nodes faithfully.
// Meta + node schema: src/v2/components-meta/Figure.ts.
//
//   kinds    rect (x,y,w,h, r = corner radius) · line (points, or x,y → x+w,y+h) · polyline (points) ·
//            arc (circle centre x,y radius r, traced clockwise from 12 o'clock) · path (d, M/L/A/Z) ·
//            text (top-left x,y; mono 500 / sans 600; label 26 · body 32 · title 44 px) ·
//            arrow (line/polyline + a filled head riding the drawn tip) · group (children relative to x,y)
//   colours  stroke / fill token names only (defaults: strokes borderStrong for rect/arc, text for lines; text fill text)
//   strokeW  hair 1 · thin 2 (default) · bold 4 px
//   enter    fade (entrance spring) · drawOn (stroke evolves 16 f, fill fades in over its last 6 f) ·
//            scaleIn (spring 0.4 → 1 about the node centre) · scramble (text settles over 8 f; other kinds fade)
//   exit     fade (8 f) · drawOff (fill fades 6 f, stroke retracts 12 f)
//   tracks   x / y / w / h / opacity / strokeDash (drawn fraction 0..1) / rotate (deg about the node centre);
//            each key eases from the value in force at its anchor to `value` over durF (bible/longPan/pushOut/
//            linear bezier; enter = the entrance spring)
//   fillTo   fill token changes: shapes cross-fade 6 f, text snaps (a lime↔red fade passes through orange)
//   morphTo  path d → d over durF (bible ease) when both have the same command structure (letters, argument
//            counts, arc flags); otherwise the d snaps half-way through the window
//   glitch   (W2.1 r2) over the figure CONTENT only: card-surface rects (surfaceIds) are drawn once, untouched. The
//            content keeps ONE crisp, full-opacity copy; behind it 2 ghosts — a danger copy +o px and a faint text
//            (white) copy −o px, o = 4/3/2/3 px over the 4 f (amendments §7 red/white tints; the white copy at low
//            opacity so a light card gets no white fringe) — and one slice band (seeded, ±4–6 px) backed by the card
//            surface fill, so the strip is displaced, not doubled. Ghosts and band are clipped to the CONTENT bounds
//            (a bar ghost never pokes past the track start / the card border).
//   plate    enterExit "self" (plateFade): surface rects are the plate — opaque (alpha 1 at spring progress 0.5, a
//            surface's own `fade` enter runs plate-first too) before any content shows (content spring +3 f); on exit
//            the content fades + blurs over the first 4 f while the plate stays opaque, then the plate goes (4 f).
//   scramble the enter scramble rolls word tokens only: tokens with a digit ("512Mi", "06:04") are drawn final from
//            the first frame, so a still never shows a plausible wrong value ("515Gx"); glyphs roll within their class
// Pure function of the frame. Discrete values (scramble glyphs, glitch frame) use the floored frame.
import React from "react";
import { getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";
import { Easing, interpolate, interpolateColors, random, spring } from "remotion";
import type { FigNodeT } from "../../../src/schema/storyboard.v2";
import { FIGURE, figureBounds, meta, type FigurePropsT } from "../../../src/v2/components-meta/Figure";
import { activeGlitch, clampX, drawOn, enterProgress, evolve, flash, scramble } from "../motion";
import { color, font, FPS, motion, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { PLATE_FADE, plateFade } from "./plateFade";

type AtT = NonNullable<FigNodeT["enter"]>["at"];
type TrackName = "x" | "y" | "w" | "h" | "opacity" | "strokeDash" | "rotate";
type TrackKeyIn = NonNullable<NonNullable<FigNodeT["tracks"]>["x"]>[number];

// ── anchors ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface AnchorCtx {
  keyword: number;
  phraseStart: number;
  phraseEnd: number;
  /** Word onset frames (empty in the gallery: {word: n} = phraseStart + 6 n). */
  words: number[];
}

/** The Figure's anchor beat: the beat containing its enter frame (no enter: first action, else 0). */
export function anchorContext(p: Pick<RenderProps, "enterF" | "exitF" | "events" | "tl">): AnchorCtx {
  const base = p.enterF ?? p.events[0]?.f ?? 0;
  const beats = p.tl?.beats ?? [];
  if (beats.length) {
    const b = beats.find((x) => base >= x.startF && base < x.endF) ?? (base < beats[0].startF ? beats[0] : beats[beats.length - 1]);
    return { keyword: b.keywordF, phraseStart: b.firstWordF, phraseEnd: b.lastWordEndF, words: b.words.map((w) => w.startF) };
  }
  const end = p.exitF ?? (p.tl ? p.tl.durationF : base + 90);
  return { keyword: base, phraseStart: base, phraseEnd: Math.max(base, end), words: [] };
}

/** Resolve a beat-relative anchor (= timeline.ts resolveAt, plus the gallery word rule). */
export function resolveAnchor(ctx: AnchorCtx, at: AtT): number {
  const ref = (r: "keyword" | "phraseStart" | "phraseEnd") => ctx[r];
  if (typeof at === "string") return ref(at);
  if ("word" in at) {
    if (!ctx.words.length) return ctx.phraseStart + at.word * FIGURE.galleryWordF;
    return ctx.words[at.word] ?? ctx.phraseEnd;
  }
  return Math.max(0, ref(at.ref) + at.offsetF);
}

// ── tracks ───────────────────────────────────────────────────────────────────────────────────────────────────

const EASE: Record<"bible" | "longPan" | "pushOut" | "linear", (t: number) => number> = {
  bible: Easing.bezier(0.65, 0, 0.35, 1),
  longPan: Easing.bezier(0.45, 0, 0.55, 1),
  pushOut: Easing.bezier(0.33, 1, 0.68, 1),
  linear: (t) => t,
};

function easeAt(key: { ease?: string; durF?: number }, frame: number, start: number): number {
  const durF = key.durF ?? 16;
  if (frame <= start) return 0;
  if (key.ease === "enter") return Math.min(1, spring({ frame: frame - start, fps: FPS, config: motion.enter, durationInFrames: durF }));
  const t = Math.min(1, (frame - start) / durF);
  return (EASE[(key.ease ?? "bible") as keyof typeof EASE] ?? EASE.bible)(t);
}

interface ResolvedKey {
  f: number;
  value: number;
  ease: string;
  durF: number;
}

/** Value of a keyframe track at `frame`: each key eases from the value in force at its anchor (pure, ≤ 8 keys). */
export function trackValue(keys: readonly ResolvedKey[], base: number, frame: number): number {
  let v = base;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (frame < k.f) break;
    const from = i === 0 ? base : trackValue(keys.slice(0, i), base, k.f);
    v = from + (k.value - from) * easeAt(k, frame, k.f);
  }
  return v;
}

const resolveKeys = (ctx: AnchorCtx, keys: readonly TrackKeyIn[] | undefined): ResolvedKey[] =>
  (keys ?? []).map((k) => ({ f: resolveAnchor(ctx, k.at), value: k.value, ease: k.ease ?? "bible", durF: k.durF ?? 16 })).sort((a, b) => a.f - b.f);

// ── path morph ───────────────────────────────────────────────────────────────────────────────────────────────

interface PathCmd {
  c: string;
  n: number[];
}

/** Parse an M/L/A/Z path (schema-restricted) into commands with numeric arguments. */
export function parsePath(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  for (const m of d.matchAll(/([MLAZmlaz])([^MLAZmlaz]*)/g)) out.push({ c: m[1], n: (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number) });
  return out;
}

/** Same command letters, argument counts and arc flags → the two paths can be interpolated number by number. */
export function morphCompatible(a: string, b: string): boolean {
  const pa = parsePath(a);
  const pb = parsePath(b);
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) {
    if (pa[i].c !== pb[i].c || pa[i].n.length !== pb[i].n.length) return false;
    if (pa[i].c === "A" || pa[i].c === "a") for (let j = 0; j < pa[i].n.length; j += 7) if (pa[i].n[j + 3] !== pb[i].n[j + 3] || pa[i].n[j + 4] !== pb[i].n[j + 4]) return false;
  }
  return true;
}

const fmt = (x: number) => String(Math.round(x * 100) / 100);
const serialize = (cmds: PathCmd[]) => cmds.map((c) => `${c.c}${c.n.length ? " " + c.n.map(fmt).join(" ") : ""}`).join(" ");

export function lerpPath(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = parsePath(a);
  const pb = parsePath(b);
  return serialize(pa.map((c, i) => ({ c: c.c, n: c.n.map((v, j) => ((c.c === "A" || c.c === "a") && (j % 7 === 3 || j % 7 === 4) ? v : v + (pb[i].n[j] - v) * t)) })));
}

function pathAt(d: string, morphs: readonly { f: number; d: string; durF: number }[], frame: number): string {
  let cur = d;
  for (const m of morphs) {
    if (frame < m.f) break;
    const t = Math.min(1, (frame - m.f) / m.durF);
    if (t >= 1) cur = m.d;
    else if (morphCompatible(cur, m.d)) return lerpPath(cur, m.d, EASE.bible(t));
    else return t >= 0.5 ? m.d : cur;
  }
  return cur;
}

// ── geometry helpers ─────────────────────────────────────────────────────────────────────────────────────────

const ptsPath = (pts: readonly (readonly [number, number])[], dx = 0, dy = 0) => pts.map((p, i) => `${i ? "L" : "M"} ${fmt(p[0] + dx)} ${fmt(p[1] + dy)}`).join(" ");

function rectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (rr <= 0) return `M ${fmt(x)} ${fmt(y)} L ${fmt(x + w)} ${fmt(y)} L ${fmt(x + w)} ${fmt(y + h)} L ${fmt(x)} ${fmt(y + h)} Z`;
  return [
    `M ${fmt(x + rr)} ${fmt(y)}`, `L ${fmt(x + w - rr)} ${fmt(y)}`, `A ${fmt(rr)} ${fmt(rr)} 0 0 1 ${fmt(x + w)} ${fmt(y + rr)}`,
    `L ${fmt(x + w)} ${fmt(y + h - rr)}`, `A ${fmt(rr)} ${fmt(rr)} 0 0 1 ${fmt(x + w - rr)} ${fmt(y + h)}`,
    `L ${fmt(x + rr)} ${fmt(y + h)}`, `A ${fmt(rr)} ${fmt(rr)} 0 0 1 ${fmt(x)} ${fmt(y + h - rr)}`,
    `L ${fmt(x)} ${fmt(y + rr)}`, `A ${fmt(rr)} ${fmt(rr)} 0 0 1 ${fmt(x + rr)} ${fmt(y)}`, "Z",
  ].join(" ");
}

const circlePath = (cx: number, cy: number, r: number) =>
  `M ${fmt(cx)} ${fmt(cy - r)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx)} ${fmt(cy + r)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx)} ${fmt(cy - r)}`;

const DEFAULT_RECT_R = 0;

/** High-chroma tokens: never part of the card surface (surfaceIds). */
const CHROMA: ReadonlySet<string> = new Set<ColorToken>(["danger", "accent"]);

/** Enter scramble (W2.1 r2): word tokens roll (class-preserving); tokens containing a digit are final from the start. */
export function enterScramble(full: string, f: number, start: number, seed: string): string {
  const held = full.replace(/\S+/g, (t) => (/\d/.test(t) ? t : " ".repeat(t.length)));
  if (held === full) return full;
  if (f < start) return full;
  return scramble(held, full, f, start, motion.scrambleF[1], seed, { keepSame: true });
}

// ── node rendering ───────────────────────────────────────────────────────────────────────────────────────────

interface Ctx {
  anchors: AnchorCtx;
  frame: number;
  f: number;
  id: string;
  /** Surface (plate) layer: a node's own `fade` enter reaches alpha 1 at plateFade's plateBy (plate-first). */
  plate: boolean;
}

interface NodeTiming {
  /** Own or drawOn-derived enter. */
  enter: { f: number; how: "fade" | "drawOn" | "scaleIn" | "scramble" } | null;
  exit: { f: number; how: "fade" | "drawOff" } | null;
}

const isStroked = (n: FigNodeT) => n.kind !== "text" && n.kind !== "group";

function defaultStroke(n: FigNodeT): ColorToken | null {
  if (n.stroke) return n.stroke;
  if (n.kind === "rect" || n.kind === "arc") return n.fill ? null : "borderStrong";
  if (n.kind === "line" || n.kind === "polyline" || n.kind === "arrow") return "text";
  if (n.kind === "path") return n.fill ? null : "text";
  return null;
}

function fillAt(n: FigNodeT, c: Ctx, base: ColorToken | null): string | null {
  const changes = (n.fillTo ?? []).map((x) => ({ f: resolveAnchor(c.anchors, x.at), token: x.token as ColorToken })).sort((a, b) => a.f - b.f);
  let cur = base;
  for (const ch of changes) {
    if (c.frame < ch.f) break;
    const snap = n.kind === "text" || cur === null;
    const t = interpolate(c.frame, [ch.f, ch.f + motion.markF], [0, 1], clampX);
    if (!snap && t < 1 && cur !== ch.token) return interpolateColors(t, [0, 1], [color[cur!], color[ch.token]]);
    cur = ch.token;
  }
  return cur ? color[cur] : null;
}

/** Visible fraction (0..1) of a stroke and opacity factors from enter/exit. */
function lifeAt(t: NodeTiming, frame: number, plate = false): { opacity: number; draw: number; fill: number; scale: number } {
  let opacity = 1, draw = 1, fill = 1, scale = 1;
  if (t.enter) {
    const s = t.enter.f;
    if (frame < s) return { opacity: 0, draw: 0, fill: 0, scale: 1 };
    if (t.enter.how === "drawOn") {
      draw = drawOn(frame, s, 16);
      fill = interpolate(frame, [s + 10, s + 16], [0, 1], clampX);
    } else if (t.enter.how === "scaleIn") {
      const e = enterProgress(frame, s);
      opacity = e;
      scale = 0.4 + 0.6 * e;
    } else if (t.enter.how === "fade") opacity = plate ? Math.min(1, enterProgress(frame, s) / PLATE_FADE.plateBy) : enterProgress(frame, s);
  }
  if (t.exit && frame >= t.exit.f) {
    const x = t.exit.f;
    if (t.exit.how === "drawOff") {
      fill *= 1 - interpolate(frame, [x, x + 6], [0, 1], clampX);
      draw *= 1 - drawOn(frame, x, 12);
      if (draw <= 0.001) opacity = 0;
    } else opacity *= 1 - interpolate(frame, [x, x + motion.exitF], [0, 1], clampX);
  }
  return { opacity, draw, fill, scale };
}

function StrokePath({ d, stroke, width, draw, cap = "round", dashKey }: { d: string; stroke: string; width: number; draw: number; cap?: "round" | "butt"; dashKey: string }) {
  if (draw <= 0) return null;
  if (draw >= 1) return <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap={cap} strokeLinejoin="round" />;
  const ev = evolve(draw, d);
  return <path key={dashKey} d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
}

function ArrowHead({ d, draw, stroke, width }: { d: string; draw: number; stroke: string; width: number }) {
  if (draw <= 0) return null;
  const len = getLength(d);
  if (len <= 0) return null;
  const at = Math.min(len, Math.max(0, len * draw));
  const p = getPointAtLength(d, at);
  const t = getTangentAtLength(d, Math.max(0.01, Math.min(len - 0.01, at)));
  if (!p || !t) return null;
  const hl = 6 + width * 3.5;
  const hw = 4 + width * 2.5;
  const bx = p.x - t.x * hl;
  const by = p.y - t.y * hl;
  const nx = -t.y;
  const ny = t.x;
  const pts = `${fmt(p.x)},${fmt(p.y)} ${fmt(bx + nx * hw)},${fmt(by + ny * hw)} ${fmt(bx - nx * hw)},${fmt(by - ny * hw)}`;
  return <polygon points={pts} fill={stroke} />;
}

function renderNode(n: FigNodeT, c: Ctx, timing: (n: FigNodeT) => NodeTiming, keyPath: string): React.ReactNode {
  const tm = timing(n);
  const life = lifeAt(tm, c.frame, c.plate);
  const tracks = n.tracks ?? {};
  const tv = (k: TrackName, base: number) => (tracks[k]?.length ? trackValue(resolveKeys(c.anchors, tracks[k]), base, c.frame) : base);
  const opacity = life.opacity * Math.max(0, Math.min(1, tv("opacity", 1)));
  if (opacity <= 0.001) return null;
  const g = n.geom;
  const X = tv("x", g.x);
  const Y = tv("y", g.y);
  const Wd = tv("w", g.w ?? 0);
  const Ht = tv("h", g.h ?? 0);
  const dx = X - g.x;
  const dy = Y - g.y;
  const rot = tv("rotate", 0);
  const draw = life.draw * Math.max(0, Math.min(1, tv("strokeDash", 1)));
  const sw = FIGURE.strokePx[n.strokeW ?? "thin"];
  const strokeTok = defaultStroke(n);
  const stroke = strokeTok ? color[strokeTok] : null;
  const k = `${c.id}:${keyPath}`;

  let body: React.ReactNode = null;
  let centre: [number, number] = [X, Y];
  switch (n.kind) {
    case "group": {
      const kids = (n.children ?? []).map((ch, i) => <React.Fragment key={ch.id}>{renderNode(ch, c, timing, `${keyPath}/${i}`)}</React.Fragment>);
      body = <g transform={`translate(${fmt(X)} ${fmt(Y)})`}>{kids}</g>;
      centre = [X, Y];
      break;
    }
    case "text": {
      const sz = g.size ?? "label";
      const px = FIGURE.textPx[sz];
      const lineH = Ht || FIGURE.lineH[sz];
      const full = g.text ?? "";
      const text = tm.enter?.how === "scramble" ? enterScramble(full, c.f, tm.enter.f, `${k}:scr`) : full;
      const fill = fillAt(n, c, (n.fill as ColorToken | undefined) ?? "text") ?? color.text;
      const isSans = g.font === "sans";
      body = (
        <text x={fmt(X)} y={fmt(Y + (lineH - px) / 2 + px * 0.8)} fill={fill} fontFamily={isSans ? font.sans : font.mono} fontWeight={isSans ? 600 : 500} fontSize={px} style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "pre" }}>
          {text}
        </text>
      );
      centre = [X + (Wd || full.length * FIGURE.charW[isSans ? "sans" : "mono"][sz]) / 2, Y + lineH / 2];
      break;
    }
    default: {
      let d: string;
      if (n.kind === "rect") {
        d = rectPath(X, Y, Wd, Ht, g.r ?? DEFAULT_RECT_R);
        centre = [X + Wd / 2, Y + Ht / 2];
      } else if (n.kind === "arc") {
        d = circlePath(X, Y, g.r ?? 0);
      } else if (n.kind === "path") {
        const morphs = (n.morphTo ?? []).map((m) => ({ f: resolveAnchor(c.anchors, m.at), d: m.d, durF: m.durF })).sort((a, b) => a.f - b.f);
        d = pathAt(g.d ?? "", morphs, c.frame);
        const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
        centre = nums.length >= 2 ? [nums[0] + dx, nums[1] + dy] : [X, Y];
      } else if (g.points && g.points.length >= 2) {
        d = ptsPath(g.points, dx, dy);
        const xs = g.points.map((p) => p[0] + dx);
        const ys = g.points.map((p) => p[1] + dy);
        centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      } else {
        d = `M ${fmt(X)} ${fmt(Y)} L ${fmt(X + Wd)} ${fmt(Y + Ht)}`;
        centre = [X + Wd / 2, Y + Ht / 2];
      }
      const closed = n.kind === "rect" || n.kind === "arc" || /[zZ]\s*$/.test(d);
      const fill = closed || n.kind === "path" ? fillAt(n, c, (n.fill as ColorToken | undefined) ?? null) : null;
      const pathTransform = n.kind === "path" && (dx || dy) ? `translate(${fmt(dx)} ${fmt(dy)})` : undefined;
      body = (
        <g transform={pathTransform}>
          {fill && life.fill > 0 ? <path d={d} fill={fill} fillOpacity={life.fill} stroke="none" /> : null}
          {stroke ? <StrokePath d={d} stroke={stroke} width={sw} draw={draw} cap={n.kind === "arrow" ? "butt" : "round"} dashKey={k} /> : null}
          {n.kind === "arrow" && stroke ? <ArrowHead d={d} draw={draw} stroke={stroke} width={sw} /> : null}
        </g>
      );
    }
  }
  const tf: string[] = [];
  if (rot) tf.push(`rotate(${fmt(rot)} ${fmt(centre[0])} ${fmt(centre[1])})`);
  if (life.scale !== 1) tf.push(`translate(${fmt(centre[0])} ${fmt(centre[1])}) scale(${fmt(life.scale)}) translate(${fmt(-centre[0])} ${fmt(-centre[1])})`);
  return (
    <g opacity={opacity < 1 ? fmt(opacity) : undefined} transform={tf.length ? tf.join(" ") : undefined} data-node={n.id}>
      {body}
    </g>
  );
}

/** The figure as an SVG whose viewBox is the node bounds (1:1 px with the footprint). Pure; exported for tests. */
export const FigureSvg: React.FC<{ nodes: readonly FigNodeT[]; frame: number; anchors: AnchorCtx; id: string; drawOnF?: number; bounds?: { x: number; y: number; w: number; h: number }; drawOrder?: readonly FigNodeT[]; plate?: boolean }> = ({ nodes, frame, anchors, id, drawOnF, bounds, drawOrder, plate = false }) => {
  // bounds / drawOrder: a subset of the figure (plate / content split) keeps the whole figure's viewBox and drawOn stagger
  const b = bounds ?? figureBounds(nodes) ?? { x: 0, y: 0, ...FIGURE.fallback };
  const c: Ctx = { anchors, frame, f: Math.floor(frame), id, plate };
  // drawOn verb: top-level nodes without their own enter draw on in order (children inherit their group's timing)
  const pending = (drawOrder ?? nodes).filter((n) => !n.enter);
  const order = new Map(pending.map((n, i) => [n, i]));
  const step = pending.length > 1 ? Math.min(FIGURE.drawStaggerF, FIGURE.drawStaggerMaxF / (pending.length - 1)) : 0;
  const timing = (n: FigNodeT): NodeTiming => {
    let enter: NodeTiming["enter"] = n.enter ? { f: resolveAnchor(anchors, n.enter.at), how: n.enter.how } : null;
    if (n.enter?.how === "scramble" && n.kind !== "text") enter = { f: enter!.f, how: "fade" };
    if (!enter && drawOnF !== undefined && order.has(n)) {
      const f = Math.round(drawOnF + step * order.get(n)!);
      enter = { f, how: n.kind === "text" ? "scramble" : isStroked(n) && defaultStroke(n) ? "drawOn" : "fade" };
    }
    const exit = n.exit ? { f: resolveAnchor(anchors, n.exit.at), how: n.exit.how } : null;
    return { enter, exit };
  };
  return (
    <svg width={Math.max(1, Math.ceil(b.w))} height={Math.max(1, Math.ceil(b.h))} viewBox={`${fmt(b.x)} ${fmt(b.y)} ${fmt(Math.max(1, Math.ceil(b.w)))} ${fmt(Math.max(1, Math.ceil(b.h)))}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {nodes.map((n, i) => (
        <React.Fragment key={n.id}>{renderNode(n, c, timing, String(i))}</React.Fragment>
      ))}
    </svg>
  );
};

/** Glitch geometry for frame `i` (0..3) of a glitch: ghost offset (px) and the slice band (fractions of the content box). */
export const FIGURE_GLITCH = {
  /** ghost offset per glitch frame (≤ 4 px: review W2.1 r1 — ±8 px tripled the 26 px labels into mush) */
  offsetPx: [4, 3, 2, 3],
  /** amendments §7 red/white: danger ghost, then a faint text (white) ghost (low opacity: no white fringe) */
  ghosts: [
    { tint: "danger", sign: 1, opacity: 0.55 },
    { tint: "text", sign: -1, opacity: 0.22 },
  ],
  bandH: [0.18, 0.24],
  bandDx: [4, 6],
} as const;

export interface FigureGlitchFrame {
  i: number;
  ghosts: { tint: "danger" | "text"; dx: number; opacity: number }[];
  band: { y: number; h: number; dx: number };
}

/** Pure glitch frame for content box `area` (null outside the 4 f window). */
export function figureGlitchAt(frame: number, at: number | undefined, seed: string, area: { x: number; y: number; w: number; h: number }): FigureGlitchFrame | null {
  if (at === undefined) return null;
  const i = Math.floor(frame) - at;
  if (i < 0 || i >= motion.glitch.f) return null;
  const G = FIGURE_GLITCH;
  const o = G.offsetPx[i];
  const r = (tag: string) => random(`${seed}:fg${i}:${tag}`);
  const bh = Math.round(area.h * (G.bandH[0] + (G.bandH[1] - G.bandH[0]) * r("h")));
  const y = area.y + Math.round(r("y") * Math.max(0, area.h - bh));
  const mag = G.bandDx[0] + Math.round(r("m") * (G.bandDx[1] - G.bandDx[0]));
  return { i, ghosts: G.ghosts.map((g) => ({ tint: g.tint, dx: g.sign * o, opacity: g.opacity })), band: { y, h: bh, dx: r("s") < 0.5 ? -mag : mag } };
}

const hexRgb01 = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)!;
  return [1, 2, 3].map((k) => parseInt(m[k], 16) / 255);
};

/** Content glitch: crisp base on top, 2 tinted ghosts behind, one surface-backed slice band; all clipped to `area`. */
const FigureGlitch: React.FC<{ g: FigureGlitchFrame; seed: string; w: number; h: number; area: { x: number; y: number; w: number; h: number }; bandFill: string | null; children: React.ReactNode }> = ({ g, seed, w, h, area, bandFill, children }) => {
  const id = `fgx-${seed.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const clipBox = (key: string, style: React.CSSProperties, inner: React.ReactNode) => (
    <div key={key} style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, overflow: "hidden", ...style }}>
      <div style={{ position: "absolute", left: -area.x, top: -area.y, width: w, height: h }}>{inner}</div>
    </div>
  );
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        {g.ghosts.map((x) => {
          const [r, gg, b] = hexRgb01(color[x.tint]);
          return (
            <filter key={x.tint} id={`${id}-${x.tint}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={`0 0 0 0 ${r}  0 0 0 0 ${gg}  0 0 0 0 ${b}  0 0 0 1 0`} />
            </filter>
          );
        })}
      </svg>
      {g.ghosts.map((x) =>
        clipBox(`g-${x.tint}`, {}, <div data-glitch-tint={x.tint} style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `translateX(${x.dx}px)`, opacity: x.opacity, filter: `url(#${id}-${x.tint})` }}>{children}</div>),
      )}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>{children}</div>
      <div data-glitch-slice={0} style={{ position: "absolute", left: area.x, top: g.band.y, width: area.w, height: g.band.h, overflow: "hidden", background: bandFill ?? undefined }}>
        <div style={{ position: "absolute", left: -area.x, top: -g.band.y, width: w, height: h, transform: `translateX(${g.band.dx}px)` }}>{children}</div>
      </div>
    </div>
  );
};

// The storyboard's nodes arrive as RenderProps.figure (Slot passes Instance.figure); props.nodes is the gallery/test
// channel. The Figure draws at its node bounds and ignores p.size (see the meta header: its World box is figureBox).
/** plateFade style with the opacity rounded (and dropped once it is ≈ 1). */
const tidyR = (x: number) => Math.round(x * 1000) / 1000;
const tidy = <T extends React.CSSProperties & { opacity: number }>(st: T): React.CSSProperties => ({ ...st, opacity: st.opacity >= 0.999 ? undefined : tidyR(st.opacity) });

const Render: React.FC<RenderProps<FigurePropsT>> = (p) => {
  const nodes = p.figure ?? p.props.nodes ?? [];
  if (!nodes.length) return null;
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const anchors = anchorContext(p);
  const drawOnF = p.events.find((e) => e.do === "drawOn")?.f;
  const kick = flash(p.frame, p.last("focus"), 4);
  const glitches = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  const b = figureBounds(nodes) ?? { x: 0, y: 0, ...FIGURE.fallback };
  const w = Math.max(1, Math.ceil(b.w));
  const h = Math.max(1, Math.ceil(b.h));
  const kickTf = kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined;
  // plate = the card-surface rects; everything else is content (drawn only over an opaque plate)
  const surf = surfaceIds(nodes, b);
  const surface = nodes.filter((n) => surf.has(n.id));
  const content = nodes.filter((n) => !surf.has(n.id));
  const contentSvg = <FigureSvg nodes={content} frame={p.frame} anchors={anchors} id={p.id} drawOnF={drawOnF} bounds={b} drawOrder={nodes} />;
  const cb = figureBounds(content);
  const area = cb ? { x: Math.floor(cb.x - b.x), y: Math.floor(cb.y - b.y), w: Math.ceil(cb.w) + 1, h: Math.ceil(cb.h) + 1 } : { x: 0, y: 0, w, h };
  const g = figureGlitchAt(p.frame, activeGlitch(glitches, p.frame), `${p.id}:glitch`, area);
  const bandTok = surface.find((n) => n.fill)?.fill as ColorToken | undefined;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kickTf }}>
        {surface.length ? (
          <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...tidy(fade.plate) }}>
            <FigureSvg nodes={surface} frame={p.frame} anchors={anchors} id={p.id} drawOnF={drawOnF} bounds={b} drawOrder={nodes} plate />
          </div>
        ) : null}
        {content.length ? (
          <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...tidy(fade.content) }}>
            {g ? (
              <FigureGlitch g={g} seed={`${p.id}:glitch`} w={w} h={h} area={area} bandFill={bandTok ? color[bandTok] : null}>
                {contentSvg}
              </FigureGlitch>
            ) : (
              contentSvg
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Card-surface nodes: top-level, non-chroma, untracked rects that cover the whole figure box (the panel a Figure is
 * drawn on). They stay out of the glitch so the card surface never changes colour or shifts.
 */
export function surfaceIds(nodes: readonly FigNodeT[], b: { x: number; y: number; w: number; h: number }): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.kind !== "rect" || n.tracks || n.fillTo?.length) continue;
    if ([n.fill, n.stroke].some((t) => t !== undefined && CHROMA.has(t))) continue;
    const g = n.geom;
    if (Math.abs(g.x - b.x) <= 1 && Math.abs(g.y - b.y) <= 1 && Math.abs((g.w ?? 0) - b.w) <= 1 && Math.abs((g.h ?? 0) - b.h) <= 1) out.add(n.id);
  }
  return out;
}

export const Figure = defineComponent({ ...meta, Render });
