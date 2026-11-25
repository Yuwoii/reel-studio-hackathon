// HeroStat renderer (bible §6.2 + amendments §2/§6). Meta: src/v2/components-meta/HeroStat.ts.
//
//   label row (mono 500 26, textDim, + tone tag)  ·  hero number (mono 600 ≤ 220 px, tabular, −0.03em)  ·  caption
//
// Number logic, all on the floored frame `f` (blur sub-samples agree; L20 checks the last digit):
//   - any countUp action on the instance → shows 0 until the first one, then counts 0 → value over 20 f (ease-out
//     cubic); numeric strings keep their grouping / decimals; a non-numeric string settles in with a scramble;
//   - no countUp at all → the digits settle in with an 8 f scramble from the entrance (only when it enters after f0);
//   - a state/scramble override of `value` scrambles from the old text over 8 f; the latest of these wins.
// Plate (border + surface) cross-fades 6 f on a state change, text colours snap (lime → red never passes orange).
// One alignment axis for the instance's whole life: the hero number is LEFT-aligned with the label and caption rows
// (D1 proof, ref3), so a count-up 0, the final 137 and a later 0 all start at the same x (W2 fix round 2).
// enterExit "self" (plateFade): the plate is opaque before the content appears, and on exit the content fades/blurs
// first while the plate stays opaque. The tag slot exists whenever the label row does (an override may add a tag).
// Scrambles are class-preserving and change-only (W2.1); the glitch (W2.1 r2) copies only the content,
// clipped to the plate's rounded inner rect, with danger / accent tints; the plate itself is never copied or tinted.
import React from "react";
import { interpolateColors } from "remotion";
import { formatValue, HERO_STAT, heroPxFor, heroText, meta, NUMERIC_VALUE, type HeroStatPropsT } from "../../../src/v2/components-meta/HeroStat";
import { activeGlitch, countUp, flash, formatCount, pulse, scramble, stateMix } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { Glitch } from "./primitives";

interface Look {
  border: ColorToken;
  surface: ColorToken;
  number: ColorToken;
  dot: boolean;
  glow: ColorToken;
}

const LOOK: Record<string, Look> = {
  accent: { border: "borderStrong", surface: "bgRaised", number: "accent", dot: true, glow: "markAccent" },
  danger: { border: "danger", surface: "dangerSurface", number: "danger", dot: true, glow: "markDanger" },
  neutral: { border: "borderStrong", surface: "bgRaised", number: "text", dot: false, glow: "markAccent" },
  dim: { border: "border", surface: "bgRaised", number: "textDim", dot: false, glow: "markAccent" },
};

const SCR = HERO_STAT.scrambleF;

const mixed = (t: number, from: Look, to: Look, key: "border" | "surface") =>
  t >= 1 || from[key] === to[key] ? color[to[key]] : interpolateColors(t, [0, 1], [color[from[key]], color[to[key]]]);

interface Num {
  n: number;
  dec: number;
  group: boolean;
}

function numeric(v: number | string, decimals: number): Num | null {
  if (typeof v === "number") return { n: v, dec: decimals, group: true };
  if (!NUMERIC_VALUE.test(v)) return null;
  const frac = v.split(".")[1];
  return { n: Number(v.replace(/,/g, "")), dec: frac ? frac.length : 0, group: v.includes(",") };
}

/** The number text (without prefix/suffix) at this frame. Exported for tests. */
export function heroValueText(p: RenderProps<HeroStatPropsT>): string {
  const target = formatValue(p.props.value, p.props.decimals);
  const num = numeric(p.props.value, p.props.decimals);
  const cus = p.events.filter((e) => e.do === "countUp");
  const seed = `${p.id}:hero`;
  if (cus.length && p.f < cus[0].f) return num ? formatCount(0, num.dec, num.group) : target;
  // the most recent animation start wins
  type Cand = { f: number; text: () => string };
  const cands: Cand[] = [];
  const lc = p.last("countUp");
  if (lc !== undefined) cands.push({ f: lc, text: () => (num ? formatCount(countUp(num.n, p.f, lc, HERO_STAT.countF, 0, num.dec), num.dec, num.group) : scramble(target, target, p.f, lc, SCR, `${seed}:cu${lc}`)) });
  const sc = p.last("scramble");
  if (sc !== undefined) cands.push({ f: sc, text: () => scramble(target, target, p.f, sc, SCR, `${seed}:sc${sc}`) });
  const old = formatValue(p.prev.value, p.prev.decimals);
  if (p.changeF !== null && old !== target) {
    const cf = p.changeF;
    cands.push({ f: cf, text: () => scramble(old, target, p.f, cf, SCR, `${seed}:ch${cf}`, { changedOnly: true }) });
  }
  if (!cus.length && p.enterF !== null && p.enterF > 0) {
    const ef = p.enterF;
    cands.push({ f: ef, text: () => scramble(target, target, p.f, ef, SCR, `${seed}:in${ef}`) });
  }
  if (!cands.length) return target;
  let best = cands[0];
  for (const c of cands) if (c.f >= best.f) best = c;
  return best.text();
}

/** A label/caption/tag that an override changed scrambles in over 8 f. */
function smallText(p: RenderProps<HeroStatPropsT>, key: "label" | "tag" | "caption"): string | undefined {
  const cur = p.props[key];
  const old = p.prev[key];
  if (cur === undefined) return undefined;
  if (p.changeF !== null && old !== cur && p.f < p.changeF + SCR) return scramble(old ?? "", cur, p.f, p.changeF, SCR, `${p.id}:${key}:${p.changeF}`, { changedOnly: true });
  return cur;
}

const Render: React.FC<RenderProps<HeroStatPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const look = LOOK[p.state.name] ?? LOOK.accent;
  const from = p.state.prev ? (LOOK[p.state.prev] ?? look) : look;
  const t = stateMix(p.frame, p.state.f);
  const { w, h } = p.size;
  const settle = p.state.f === null ? 0 : p.state.f + SCR;
  const tagOpacity = p.state.name === "danger" && p.frame >= settle ? pulse(p.frame, settle) : 1;
  const glow = flash(p.frame, p.last("pulse"), 5);
  const kick = flash(p.frame, p.last("focus"), 4);
  // font size from the longest of the base and the current text, so a count-up never resizes the row
  const chars = Math.max(heroText(p.base, formatValue(p.base.value, p.base.decimals)).length, heroText(p.props, formatValue(p.props.value, p.props.decimals)).length);
  const heroPx = heroPxFor(chars, w);
  // rows follow the BASE props (the footprint is fixed for the instance's life); overrides only change their text.
  // The tag slot belongs to the label row: an override may add a tag to a base that only had a label.
  const hasTopRow = Boolean(p.base.label || p.base.tag);
  const label = hasTopRow ? (smallText(p, "label") ?? "") : undefined;
  const tag = hasTopRow ? smallText(p, "tag") : undefined;
  const caption = p.base.caption ? (smallText(p, "caption") ?? "") : undefined;
  const small = (track: string, weight: number, token: ColorToken): React.CSSProperties => ({
    fontFamily: font.mono, fontWeight: weight, fontSize: HERO_STAT.smallPx, lineHeight: `${HERO_STAT.smallRowH}px`, height: HERO_STAT.smallRowH,
    color: color[token], letterSpacing: track, whiteSpace: "pre", fontVariantNumeric: "tabular-nums",
  });
  const plate = (
      <div
        style={{
          position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box",
          borderRadius: radius.card, border: `${HERO_STAT.border}px solid ${mixed(t, from, look, "border")}`, background: mixed(t, from, look, "surface"),
          boxShadow: glow > 0 ? `inset 0 0 ${Math.round(40 * glow)}px ${color[look.glow]}` : undefined,
          ...fade.plate,
        }}
      />
  );
  const content = (
      <div
        style={{
          position: "absolute", left: 0, top: 0, width: w, height: h, boxSizing: "border-box",
          padding: `${HERO_STAT.padTop + HERO_STAT.border}px ${HERO_STAT.padX + HERO_STAT.border}px ${HERO_STAT.padBottom + HERO_STAT.border}px`,
          display: "flex", flexDirection: "column", ...fade.content,
        }}
      >
        {label !== undefined ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: HERO_STAT.labelGap }}>
            <span style={small("0.06em", 500, "textDim")}>{label}</span>
            {tag ? (
              <span style={{ ...small("0.06em", 500, look.number), opacity: tagOpacity }}>
                {look.dot ? "● " : ""}
                {tag}
              </span>
            ) : null}
          </div>
        ) : null}
        <div style={{ height: Math.ceil(HERO_STAT.heroPx * HERO_STAT.heroLine), display: "flex", alignItems: "center" }}>
          <span
            style={{
              fontFamily: font.mono, fontWeight: 600, fontSize: heroPx, lineHeight: 1, letterSpacing: "-0.03em", color: color[look.number],
              fontVariantNumeric: "tabular-nums", whiteSpace: "pre", transformOrigin: "0% 50%", transform: kick > 0 ? `scale(${1 + 0.04 * kick})` : undefined,
            }}
          >
            {heroText(p.props, heroValueText(p))}
          </span>
        </div>
        {caption !== undefined ? <div style={{ ...small("0.02em", 400, "textDim"), marginTop: HERO_STAT.captionGap }}>{caption}</div> : null}
      </div>
  );
  const glitches = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <Glitch frame={p.frame} at={activeGlitch(glitches, p.frame)} seed={`${p.id}:glitch`} w={w} h={h} clip={{ r: radius.card, inset: HERO_STAT.border }} plate={plate}>
        {content}
      </Glitch>
    </div>
  );
};

export const HeroStat = defineComponent({ ...meta, Render });
