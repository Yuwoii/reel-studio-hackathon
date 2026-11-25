// Terminal renderer (bible §6.8 + tail mode). Meta: src/v2/components-meta/Terminal.ts.
//
// Every typed character, every printed line and the caret blink are discrete on `f` (typing() floors the frame), so
// motion-blur sub-samples never show half-typed ghosts. The tail scroll and the line fade-ins are continuous.
// W2.1: the dim state dims the CONTENT by colour (lines → textDim, dim lines / prompt / title → textFaint; danger and
// accent lines lose their colour) while the plate stays opaque, like the other packet-B components. enterExit "self"
// (plateFade): the plate is opaque before the title and lines fade in; on exit they fade + blur first. The glitch is a
// subtle 2 f split (copies ±5 px, slices ±10 px, body only) so the danger line stays readable.
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { meta, TERMINAL as T, terminalHeightFor, terminalRows, terminalRowsAt, type TerminalPropsT } from "../../../src/v2/components-meta/Terminal";
import { activeGlitch, clampX, easeBible, flash, glitchAt, stateMix, typing } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { Caret } from "./primitives";

type Kind = "cmd" | "out" | "bad" | "ok" | "dim";
interface Look {
  border: ColorToken;
  title: ColorToken;
  prompt: ColorToken;
  caret: ColorToken;
  /** Text colour per line kind (cmd = the typed command after the prompt). */
  kind: Record<Kind, ColorToken>;
}
const KIND: Record<Kind, ColorToken> = { cmd: "text", out: "text", bad: "danger", ok: "accent", dim: "textDim" };
/** dim: every line one step down (white → textDim, red/lime → textDim, textDim → textFaint); the plate stays opaque. */
const KIND_DIM: Record<Kind, ColorToken> = { cmd: "textDim", out: "textDim", bad: "textDim", ok: "textDim", dim: "textFaint" };
const FRAME: Record<string, Look> = {
  neutral: { border: "borderStrong", title: "textDim", prompt: "textDim", caret: "text", kind: KIND },
  danger: { border: "danger", title: "danger", prompt: "textDim", caret: "text", kind: KIND },
  accent: { border: "accent", title: "textDim", prompt: "textDim", caret: "text", kind: KIND },
  dim: { border: "border", title: "textFaint", prompt: "textFaint", caret: "textDim", kind: KIND_DIM },
};

/** Glitch caps for the terminal (W2.1 minor: the shared ±8 px / ±24 px split made the danger line unreadable). */
export const TERM_GLITCH = { frames: 2, copyPx: 5, slicePx: 10, copyOpacity: 0.45 } as const;

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
/** "#RRGGBB" token → feColorMatrix row values (opaque hex tokens only). */
function tokenRgb01(token: ColorToken): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color[token]);
  if (!m) throw new Error(`glitch tint token ${token} must be an opaque hex token`);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/**
 * The terminal's glitch: the shared glitchAt() frame (same seeded slices + fixed danger/text tints), but only its
 * first TERM_GLITCH.frames frames, with the copy offset capped at ±copyPx and slice shifts at ±slicePx. Discrete on f.
 */
const TermGlitch: React.FC<{ frame: number; at: number | undefined; seed: string; w: number; h: number; children: React.ReactNode }> = ({ frame, at, seed, w, h, children }) => {
  const g = glitchAt(frame, at, seed);
  if (!g || g.i >= TERM_GLITCH.frames) return <>{children}</>;
  const cap = (v: number, c: number) => Math.max(-c, Math.min(c, v));
  const id = `tglx-${sanitize(seed)}`;
  const layer = (style: React.CSSProperties, key: string) => (
    <div key={key} style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...style }}>
      {children}
    </div>
  );
  const sliceH = 100 / 6;
  return (
    <div style={{ position: "relative", width: w, height: h }}>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        {(["danger", "text"] as const).map((t) => {
          const [r, gg, b] = tokenRgb01(t);
          return (
            <filter key={t} id={`${id}-${t}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={`0 0 0 0 ${r}  0 0 0 0 ${gg}  0 0 0 0 ${b}  0 0 0 1 0`} />
            </filter>
          );
        })}
      </svg>
      {g.copies.map((c, k) => layer({ transform: `translateX(${cap(c.dx, TERM_GLITCH.copyPx)}px)`, opacity: Math.min(c.opacity, TERM_GLITCH.copyOpacity), filter: `url(#${id}-${c.tint})` }, `c${k}`))}
      {Array.from({ length: 6 }, (_, k) => {
        const top = k * sliceH;
        const s = g.slices.find((x) => Math.abs(x.top - top) < 0.01);
        return layer({ clipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - sliceH)}% 0)`, transform: s ? `translateX(${cap(s.dx, TERM_GLITCH.slicePx)}px)` : undefined, opacity: g.opacity }, `s${k}`);
      })}
    </div>
  );
};

/**
 * Frame each line starts (Infinity = not revealed). Type mode: `shown` lines from enter + 6 f, then each `mark` with
 * props.shown reveals up to that many more, never before the previous reveal finished. Tail mode: one line per
 * `every` frames from enter + 6 f. No enter action = already on screen (lines start at -Infinity, fully typed).
 */
export function lineStarts(p: Pick<RenderProps<TerminalPropsT>, "base" | "events" | "enterF">): number[] {
  const { lines, mode, every } = p.base;
  if (p.enterF === null && mode === "type") {
    const n = p.base.shown ?? lines.length;
    return lines.map((_, i) => (i < n ? -Infinity : Infinity));
  }
  const t0 = (p.enterF ?? 0) + T.startDelayF;
  if (mode === "tail") return lines.map((_, i) => t0 + i * every);
  const triggers: { f: number; n: number }[] = [{ f: t0, n: p.base.shown ?? lines.length }];
  for (const e of p.events) {
    const n = e.do === "mark" ? e.props?.shown : undefined;
    if (typeof n === "number" && Number.isInteger(n) && n >= 0) triggers.push({ f: e.f, n: Math.min(n, lines.length) });
  }
  triggers.sort((a, b) => a.f - b.f);
  const out = lines.map(() => Infinity);
  let revealed = 0;
  let cursor = -Infinity;
  for (const tr of triggers) {
    if (tr.n <= revealed) continue;
    let c = Math.max(tr.f, cursor);
    for (let i = revealed; i < tr.n; i++) {
      out[i] = c;
      c += lines[i].kind === "cmd" ? Math.ceil(lines[i].text.length / 2) + T.cmdToOutF : T.outStaggerF;
    }
    revealed = tr.n;
    cursor = c;
  }
  return out;
}

const Render: React.FC<RenderProps<TerminalPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const look = FRAME[p.state.name] ?? FRAME.neutral;
  const from = p.state.prev ? (FRAME[p.state.prev] ?? look) : look;
  const t = stateMix(p.frame, p.state.f);
  const border = t >= 1 || from.border === look.border ? color[look.border] : interpolateColors(t, [0, 1], [color[from.border], color[look.border]]);
  const { w, h: fullH } = p.size;
  const tail = p.base.mode === "tail";
  const m = tail ? T.tail : T.type;
  const rows = terminalRows(p.base);
  const starts = lineStarts(p);
  // W5.1: type mode is only as tall as the lines shown so far (top edge fixed, inside the footprint)
  const h = tail ? fullH : Math.min(fullH, terminalHeightFor(p.base, terminalRowsAt(p.base, starts, p.frame, easeBible)));
  const lines = p.base.lines;
  const visible = lines.map((_, i) => starts[i] <= p.f);
  const lastVisible = visible.lastIndexOf(true);

  // tail: scroll so the newest line sits on the last row (4 f bible ease per new line beyond `rows`)
  let offset = 0;
  if (tail && lastVisible >= rows) {
    const s = starts[lastVisible];
    offset = lastVisible - rows + easeBible(Math.min(1, Math.max(0, (p.frame - s) / T.scrollF)));
  }

  const kick = flash(p.frame, p.last("focus"), 4);
  const bodyW = w - 2 * T.border;
  const bodyH = h - 2 * T.border - T.titleH;
  const glitches = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  const row = (i: number) => {
    if (!visible[i]) return null;
    const l = lines[i];
    const s = starts[i];
    const fadeOp = Number.isFinite(s) && l.kind !== "cmd" ? interpolate(p.frame, [s, s + T.fadeF], [0, 1], clampX) : 1;
    const style: React.CSSProperties = { position: "absolute", left: T.padX, top: T.padY + i * m.lh, height: m.lh, width: bodyW - 2 * T.padX, display: "flex", alignItems: "center", whiteSpace: "pre", overflow: "hidden", opacity: fadeOp };
    if (l.kind === "cmd" && !tail) {
      const ty = Number.isFinite(s) ? typing(l.text, p.f, s, 2) : { shown: l.text, done: true, caretOn: false };
      const caret = i === lastVisible && Number.isFinite(s);
      return (
        <div key={i} style={style}>
          <span style={{ color: color[look.prompt] }}>{p.base.prompt} </span>
          <span style={{ color: color[look.kind.cmd] }}>{ty.shown}</span>
          {caret ? <Caret on={ty.caretOn} px={m.px} token={look.caret} /> : null}
        </div>
      );
    }
    return (
      <div key={i} style={{ ...style, color: color[look.kind[l.kind as Kind] ?? look.kind.out] }}>
        {l.kind === "cmd" ? <span style={{ color: color[look.prompt] }}>{p.base.prompt} </span> : null}
        {l.text}
      </div>
    );
  };

  const term = (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
      {/* opaque plate: surface, frame border and the title-bar rule (plateFade: opaque before the content shows) */}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box", borderRadius: radius.card, border: `${T.border}px solid ${border}`, background: color.bgRaised, ...fade.plate }}>
        <div style={{ position: "absolute", left: 0, top: T.titleH - 1, width: bodyW, height: 1, background: color.border }} />
      </div>
      {/* content = the plate's padding box (rounded clip), so title + body keep their coordinates */}
      <div style={{ position: "absolute", left: T.border, top: T.border, width: bodyW, height: h - 2 * T.border, borderRadius: radius.card - T.border, overflow: "hidden", ...fade.content }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: bodyW, height: T.titleH, boxSizing: "border-box", display: "flex", alignItems: "center", padding: `0 ${T.padX}px`, gap: 24 }}>
        <span style={{ display: "inline-flex", gap: T.dotGap }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: T.dot, height: T.dot, borderRadius: T.dot / 2, boxSizing: "border-box", background: color.bgRaised2, border: `1px solid ${color.borderStrong}` }} />
          ))}
        </span>
        <span style={{ fontFamily: font.mono, fontWeight: 400, fontSize: T.titlePx, letterSpacing: "0.02em", color: color[look.title], whiteSpace: "pre" }}>{p.base.title}</span>
      </div>
      {/* the glitch tears the CONTENT only: the frame, border and title bar stay intact, and the body clips it */}
      <div style={{ position: "absolute", left: 0, top: T.titleH, width: bodyW, height: bodyH, overflow: "hidden" }}>
        <TermGlitch frame={p.frame} at={activeGlitch(glitches, p.frame)} seed={`${p.id}:glitch`} w={bodyW} h={bodyH}>
          <div style={{ position: "absolute", left: 0, top: 0, width: bodyW, height: T.padY * 2 + lines.length * m.lh, transform: offset > 0 ? `translateY(${-offset * m.lh}px)` : undefined, fontFamily: font.mono, fontWeight: 400, fontSize: m.px, fontVariantNumeric: "tabular-nums" }}>
            {lines.map((_, i) => row(i))}
          </div>
        </TermGlitch>
      </div>
      </div>
      </div>
    </div>
  );
  return term;
};

export const Terminal = defineComponent({ ...meta, Render });
