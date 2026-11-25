// VersusBadges renderer (bible §6.12 + neutral tones). Meta: src/v2/components-meta/VersusBadges.ts.
//
// Each side is a badge + label centred on x = w/4 and 3w/4. On enter both start side by side near the centre
// (slideStartGap apart, never overlapping) and slide apart (14 f, bible ease) inside the shared entrance; the labels
// fade in over the end of the slide and "vs" once they have parted. One shared badge type size for the pair. A state picks the winner
// (the loser dims by COLOUR only: border → border, glyph + label → textDim; its plate stays opaque so the field never
// shows through it, and lime never cross-fades into red). Labels and "vs" sit on small opaque bgRaised plates.
// W2.1: enterExit "self" (plateFade): every plate (badges, label and "vs" plates) is opaque before its text shows,
// and on exit the text fades + blurs first. A glitch tears the badge GLYPHS only, clipped to each badge's rounded
// plate, so no tinted plate copy spills out as a slab.
// W2.1 fix B r2: the loser's glyph + label are the textDim token itself (snapped at mid-change, never an olive /
// mauve mid-mix); a bg backing band fills the gap between the badges (field cells never butt against "vs"), and the
// "vs" chip has wider padding. Label / badge changes mask rolling digits (scrambleMask).
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { badgePx, meta, VERSUS as V, type VersusBadgesPropsT } from "../../../src/v2/components-meta/VersusBadges";
import { activeGlitch, clampX, easeBible, flash, stateMix } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { Glitch } from "./primitives";
import { scrambleRuns, ScrambleText, type ScrambleRun } from "./scrambleMask";

interface Look {
  border: ColorToken;
  surface: ColorToken;
  text: ColorToken;
  glow: ColorToken;
}

const LOOK: Record<string, Look> = {
  accent: { border: "accent", surface: "bgRaised", text: "accent", glow: "markAccent" },
  danger: { border: "danger", surface: "dangerSurface", text: "danger", glow: "markDanger" },
  neutral: { border: "borderStrong", surface: "bgRaised", text: "text", glow: "borderStrong" },
  dim: { border: "border", surface: "bgRaised", text: "textDim", glow: "border" },
};

const SCRAMBLE_F = motion.scrambleF[1];
type Side = "left" | "right";

function field(p: RenderProps<VersusBadgesPropsT>, key: "leftLabel" | "rightLabel" | "leftBadge" | "rightBadge"): ScrambleRun[] {
  const cur = p.props[key];
  const old = p.prev[key];
  if (p.changeF !== null && old !== cur && p.f < p.changeF + SCRAMBLE_F) return scrambleRuns(old, cur, p.f, p.changeF, SCRAMBLE_F, `${p.id}:${key}:${p.changeF}`);
  return [{ text: cur, masked: false }];
}

/** Dim amount of a side for a state: 1 = the loser. */
const sideDim = (state: string | null, side: Side) => (state === (side === "left" ? "right" : "left") ? 1 : 0);

/** A border pulled toward its dim token by `d` (0..1 × V.dimMix). Grey targets only, so lime never meets red. */
const dimmed = (token: ColorToken, to: ColorToken, d: number) => (d <= 0 || token === to ? color[token] : interpolateColors(d * V.dimMix, [0, 1], [color[token], color[to]]));
/** Glyph / label colour: a theme token, never a mix — the tone, or textDim once the side is (at least half) dimmed. */
const dimToken = (token: ColorToken, d: number): ColorToken => (d >= 0.5 ? "textDim" : token);

/** Small opaque plate behind a caption (labels, "vs"). */
const plate: React.CSSProperties = {
  display: "inline-block", boxSizing: "border-box", height: V.labelLh, padding: `0 ${V.platePadX}px`, borderRadius: V.plateRadius,
  border: `${V.plateBorder}px solid ${color.border}`, background: color.bgRaised, lineHeight: `${V.labelLh - 2 * V.plateBorder}px`,
};

const Render: React.FC<RenderProps<VersusBadgesPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const { w, h } = p.size;
  const t = stateMix(p.frame, p.state.f);
  const slide = p.enterF === null ? 1 : easeBible(interpolate(p.frame, [p.enterF, p.enterF + V.slideF], [0, 1], clampX));
  // small plates go opaque over the first half of their fade, their text over the second half (never on a see-through plate)
  const vsT = p.enterF === null ? 1 : interpolate(p.frame, [p.enterF + V.vsDelayF, p.enterF + V.vsDelayF + V.vsFadeF], [0, 1], clampX);
  const labelT = interpolate(slide, [V.labelFadeFrom, 1], [0, 1], clampX);
  const half = (x: number, second: boolean) => Math.min(1, Math.max(0, second ? 2 * x - 1 : 2 * x));
  const glitchAt = activeGlitch(p.events.filter((e) => e.do === "glitch").map((e) => e.f), p.frame);
  const px = Math.min(badgePx(p.props.leftBadge), badgePx(p.props.rightBadge));
  const glow = flash(p.frame, p.last("pulse"), 5);
  const kick = flash(p.frame, p.last("focus"), 4);

  const side = (s: Side) => {
    const look = LOOK[s === "left" ? p.props.leftTone : p.props.rightTone] ?? LOOK.neutral;
    const badge = field(p, s === "left" ? "leftBadge" : "rightBadge");
    const label = field(p, s === "left" ? "leftLabel" : "rightLabel");
    const finalCx = s === "left" ? w / 4 : (3 * w) / 4;
    const finalHalf = finalCx - w / 2; // ±w/4
    const startHalf = Math.sign(finalHalf) * Math.min(Math.abs(finalHalf), V.badge / 2 + V.slideStartGap / 2);
    const cx = w / 2 + startHalf + (finalHalf - startHalf) * slide;
    const d = sideDim(p.state.prev, s) + (sideDim(p.state.name, s) - sideDim(p.state.prev, s)) * t;
    const textC = color[dimToken(look.text, d)];
    return (
      <div key={s} data-side={s} style={{ position: "absolute", left: cx - w / 4, top: 0, width: w / 2, height: h }}>
        <div
          style={{
            position: "absolute", left: w / 4 - V.badge / 2, top: 0, width: V.badge, height: V.badge, boxSizing: "border-box", borderRadius: radius.card,
            border: `${V.border}px solid ${dimmed(look.border, "border", d)}`, background: color[look.surface], overflow: "hidden",
            boxShadow: glow * (1 - d) > 0 ? `inset 0 0 ${Math.round(40 * glow * (1 - d))}px ${color[look.glow]}` : undefined,
            ...fade.plate,
          }}
        >
          {/* glyph layer: the only thing a glitch tears; the badge's overflow + radius clip it */}
          <div style={{ position: "absolute", left: 0, top: 0, width: V.badge - 2 * V.border, height: V.badge - 2 * V.border, ...fade.content }}>
            <Glitch frame={p.frame} at={glitchAt} seed={`${p.id}:glitch:${s}`} w={V.badge - 2 * V.border} h={V.badge - 2 * V.border}>
              <div style={{ position: "absolute", left: 0, top: 0, width: V.badge - 2 * V.border, height: V.badge - 2 * V.border, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontFamily: font.mono, fontWeight: 600, fontSize: px, lineHeight: 1, letterSpacing: "-0.03em", color: textC, whiteSpace: "pre" }}>
                  <ScrambleText runs={badge} />
                </span>
              </div>
            </Glitch>
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, top: V.badge + V.labelGap, width: w / 2, height: V.labelLh, opacity: half(labelT, false) * fade.plate.opacity, filter: fade.plate.filter, textAlign: "center", fontFamily: font.mono, fontWeight: 500, fontSize: V.labelPx, lineHeight: `${V.labelLh}px`, color: textC, whiteSpace: "pre" }}>
          <span style={plate}>
            <span style={{ opacity: half(labelT, true) * fade.content.opacity, filter: fade.content.filter }}><ScrambleText runs={label} /></span>
          </span>
        </div>
      </div>
    );
  };

  // backing band: bg fill between the badges' inner edges (badge height), drawn under everything, so no field cell
  // meets the "vs" chip or runs out from under a badge edge into the gap
  const innerHalf = V.badge / 2 + V.slideStartGap / 2;
  const half4 = w / 4;
  const startHalf = Math.min(half4, innerHalf);
  const cxR = w / 2 + startHalf + (half4 - startHalf) * slide;
  const gapL = w - cxR + V.badge / 2;
  const gapR = cxR - V.badge / 2;
  const vsPlate: React.CSSProperties = { ...plate, padding: `0 ${V.vsPadX}px` };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined }}>
        {gapR > gapL ? <div data-band="" style={{ position: "absolute", left: gapL - 1, top: 0, width: gapR - gapL + 2, height: V.badge, background: color.bg, opacity: fade.plate.opacity, filter: fade.plate.filter }} /> : null}
        {side("left")}
        {side("right")}
        <div style={{ position: "absolute", left: 0, top: V.badge / 2 - V.labelLh / 2, width: w, height: V.labelLh, textAlign: "center", opacity: half(vsT, false) * fade.plate.opacity, filter: fade.plate.filter, fontFamily: font.mono, fontWeight: 500, fontSize: V.vsPx, lineHeight: `${V.labelLh}px`, color: color.textDim, whiteSpace: "pre" }}>
          <span style={vsPlate}>
            <span style={{ opacity: half(vsT, true) * fade.content.opacity, filter: fade.content.filter }}>{p.props.vs}</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export const VersusBadges = defineComponent({ ...meta, Render });
