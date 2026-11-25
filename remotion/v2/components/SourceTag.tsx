// SourceTag / Quote renderer (bible §6.9). Meta: src/v2/components-meta/SourceTag.ts.
//
// pill: one outline pill ([10 px dot circle] text + " · detail"), drawn at its current width (detail springs) inside a
// box that always reserves the dot; a pill that ever lights its dot keeps the slot in every state (unlit = borderStrong),
// so the label never slides sideways; stack: outline pills staggered in 3 f; quote: 3 px rule that grows
// top → bottom over 10 f after enter, sans 500 40 px lines (line breaks from the same quoteLines() the footprint
// uses), "— attribution" in mono textDim. Text colours snap on a state change; only the plates cross-fade.
// enterExit "self" (plateFade, W2.1): every plate (the pill, each stack pill with its 3 f stagger, the quote's bg box)
// is opaque before its text fades in; on exit the text fades + blurs 4 f first while the plates stay opaque.
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { meta, pillDotWidth, pillHeight, pillTextWidth, quoteLines, SOURCE_TAG as S, type SourceTagPropsT } from "../../../src/v2/components-meta/SourceTag";
import { clampX, easeBible, flash, stateMix } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade, type PlateFade } from "./plateFade";
import { runsText, scrambleRuns, ScrambleText, type ScrambleRun } from "./scrambleMask";

interface Look {
  border: ColorToken;
  surface: ColorToken;
  text: ColorToken;
  dot: ColorToken | null;
}

const LOOK: Record<string, Look> = {
  neutral: { border: "borderStrong", surface: "bgRaised", text: "text", dot: null },
  accent: { border: "accent", surface: "bgRaised", text: "text", dot: "accent" },
  danger: { border: "danger", surface: "dangerSurface", text: "text", dot: "danger" },
  dim: { border: "border", surface: "bgRaised", text: "textDim", dot: null },
};

const SCRAMBLE_F = motion.scrambleF[1];
const RULE_F = 10;

function mixed(t: number, from: ColorToken, to: ColorToken): string {
  const clash = (from === "accent" && to === "danger") || (from === "danger" && to === "accent");
  return t >= 1 || from === to || clash ? color[to] : interpolateColors(t, [0, 1], [color[from], color[to]]);
}

/** The detail on screen: a scramble / change rolls letters within their class and MASKS rolling digits (a still never
 *  shows a real-looking wrong date such as "found Aug 27"). */
function detailRuns(p: RenderProps<SourceTagPropsT>): ScrambleRun[] | undefined {
  const cur = p.props.detail;
  if (cur === undefined) return undefined;
  const old = p.prev.detail ?? cur;
  const sc = p.last("scramble");
  const changing = p.changeF !== null && old !== cur && p.f < p.changeF + SCRAMBLE_F;
  if (sc !== undefined && p.f < sc + SCRAMBLE_F && (!changing || sc > (p.changeF ?? -1))) return scrambleRuns(cur, cur, p.f, sc, SCRAMBLE_F, `${p.id}:detail:sc${sc}`, true);
  if (changing) return scrambleRuns(old, cur, p.f, p.changeF!, SCRAMBLE_F, `${p.id}:detail:ch${p.changeF}`);
  return [{ text: cur, masked: false }];
}

/** "Off" status dot for neutral / dim pills that light up at some point (the slot is reserved, so text never moves). */
const DOT_OFF: ColorToken = "borderStrong";

/**
 * Does this pill ever show a lit dot (base tone or any later state / highlight)? Then the dot slot is reserved in
 * EVERY state — an unlit dot is drawn in DOT_OFF — so a state change never reflows the label sideways.
 */
function reservesDot(p: RenderProps<SourceTagPropsT>): boolean {
  const lit = (s: unknown) => s === "accent" || s === "danger";
  if (lit(p.base.tone)) return true;
  if (p.base.variant === "stack" && p.base.highlight !== undefined) return true;
  return p.events.some((e) => lit(e.state) || (p.base.variant === "stack" && (e.props as { highlight?: unknown } | undefined)?.highlight !== undefined));
}

/** Dot colour between two looks: lit ↔ off fades, lime ↔ red snaps. */
const dotColor = (t: number, from: Look, to: Look) => mixed(t, from.dot ?? DOT_OFF, to.dot ?? DOT_OFF);

/** Pill outer width for a text run of `textW` px and a dot slot `dotK` (0..1). */
const pillOuter = (textW: number, dotK: number) => Math.ceil(2 * S.pillPadX + 2 * S.pillBorder + pillDotWidth(true) * dotK + textW);

const Pill: React.FC<{ text: string; detail?: readonly ScrambleRun[]; dot: string | null; textToken: ColorToken; border: string; surface: string; w: number; fade: PlateFade; top?: number }> = ({ text, detail, dot, textToken, border, surface, w, fade, top = 0 }) => (
  <div style={{ position: "absolute", left: 0, top, width: w, height: pillHeight, ...fade.group, transformOrigin: "0% 50%" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: pillHeight, boxSizing: "border-box", borderRadius: radius.pill, border: `${S.pillBorder}px solid ${border}`, background: surface, ...fade.plate }} />
    <div
      style={{
        position: "absolute", left: 0, top: 0, width: w, height: pillHeight, boxSizing: "border-box", borderRadius: radius.pill,
        padding: `0 ${S.pillPadX + S.pillBorder}px`, display: "flex", alignItems: "center",
        overflow: "hidden", whiteSpace: "pre", fontFamily: font.mono, fontWeight: 500, fontSize: S.pillPx, lineHeight: `${S.pillLh}px`, ...fade.content,
      }}
    >
    {dot ? (
      <span style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", width: S.dotPx, height: S.dotPx, marginRight: S.dotGap }}>
        <span style={{ flex: "none", width: S.dotPx, height: S.dotPx, borderRadius: "50%", background: dot }} />
      </span>
    ) : null}
    <span style={{ flex: "none", color: color[textToken] }}>{text}</span>
    {detail ? <span style={{ flex: "none", color: color.textDim, fontVariantNumeric: "tabular-nums" }}>{" · "}<ScrambleText runs={detail} maskToken="textFaint" /></span> : null}
    </div>
  </div>
);

const Render: React.FC<RenderProps<SourceTagPropsT>> = (p) => {
  const look = LOOK[p.state.name] ?? LOOK.neutral;
  const from = p.state.prev ? (LOOK[p.state.prev] ?? look) : look;
  const t = stateMix(p.frame, p.state.f);
  const { w, h } = p.size;
  const kick = flash(p.frame, p.last("focus"), 4);
  const wrap = (children: React.ReactNode) => (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>{children}</div>
  );

  if (p.base.variant === "pill") {
    const text = p.base.text ?? "";
    const shownRuns = detailRuns(p);
    const shown = shownRuns === undefined ? undefined : runsText(shownRuns);
    const reserve = reservesDot(p);
    const dotK = reserve ? 1 : 0;
    // text run: springs from the old detail's width to the new one (never narrower than what is on screen)
    const cur = p.props.detail;
    const old = p.prev.detail ?? cur;
    const dt = p.changeF === null ? 1 : easeBible(interpolate(p.frame, [p.changeF, p.changeF + SCRAMBLE_F], [0, 1], clampX));
    const textW = Math.max(pillTextWidth(text, old) + (pillTextWidth(text, cur) - pillTextWidth(text, old)) * dt, pillTextWidth(text, shown));
    const pw = Math.min(w, pillOuter(textW, dotK));
    const fade = plateFade(p.frame, p.enterF, p.exitF);
    if (!fade.visible) return null;
    return wrap(<Pill text={text} detail={shownRuns} dot={reserve ? dotColor(t, from, look) : null} textToken={look.text} border={mixed(t, from.border, look.border)} surface={mixed(t, from.surface, look.surface)} w={pw} fade={fade} />);
  }

  if (p.base.variant === "stack") {
    const items = p.base.items ?? [];
    const hi = p.props.highlight;
    const hiPrev = p.prev.highlight;
    const ht = p.changeF === null ? 1 : stateMix(p.frame, p.changeF);
    const reserve = reservesDot(p);
    return wrap(
      items.map((it, i) => {
        // each pill runs its own plate-first entrance, 3 f after the previous one
        const fade = plateFade(p.frame, p.enterF === null ? null : p.enterF + 3 * i, p.exitF);
        if (!fade.visible) return null;
        const on = hi === i;
        const was = hiPrev === i;
        const lk: Look = on ? LOOK.accent : look;
        const lkFrom: Look = was ? LOOK.accent : look;
        const tt = on !== was ? ht : t;
        const pw = Math.min(w, pillOuter(pillTextWidth(it, undefined), reserve ? 1 : 0));
        return (
          <Pill
            key={i}
            text={it}
            dot={reserve ? dotColor(tt, on !== was ? lkFrom : from, lk) : null}
            textToken={lk.text}
            border={mixed(tt, on !== was ? lkFrom.border : from.border, lk.border)}
            surface={mixed(tt, on !== was ? lkFrom.surface : from.surface, lk.surface)}
            w={pw}
            fade={fade}
            top={i * (pillHeight + S.stackGap)}
          />
        );
      }),
    );
  }

  // quote
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const lines = quoteLines(p.base.text ?? "", w);
  const textH = lines.length * S.quoteLh;
  const ruleT = p.enterF === null ? 1 : easeBible(interpolate(p.frame, [p.enterF, p.enterF + RULE_F], [0, 1], clampX));
  const ruleToken: ColorToken = p.state.name === "danger" ? "danger" : p.state.name === "dim" ? "textDim" : "accent";
  const ruleH = h - 2 * S.quotePadY;
  return wrap(
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, background: color.bg, ...fade.plate }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.content }}>
      <div style={{ position: "absolute", left: 0, top: S.quotePadY, width: S.ruleW, height: ruleH * ruleT, background: color[ruleToken] }} />
      <div style={{ position: "absolute", left: S.ruleW + S.ruleGap, top: S.quotePadY, width: w - S.ruleW - S.ruleGap, height: textH, fontFamily: font.sans, fontWeight: S.quoteWeight, fontSize: S.quotePx, lineHeight: `${S.quoteLh}px`, color: color[p.state.name === "dim" ? "textDim" : "text"] }}>
        {lines.map((l, i) => (
          <div key={i} style={{ whiteSpace: "pre" }}>
            {l}
          </div>
        ))}
      </div>
      {p.base.attribution ? (
        <div style={{ position: "absolute", left: S.ruleW + S.ruleGap, top: S.quotePadY + textH + S.attrGap, height: S.attrLh, fontFamily: font.mono, fontWeight: 400, fontSize: S.attrPx, lineHeight: `${S.attrLh}px`, color: color.textDim, whiteSpace: "pre" }}>
          {`— ${p.base.attribution}`}
        </div>
      ) : null}
      </div>
    </div>,
  );
};

export const SourceTag = defineComponent({ ...meta, Render });
