// StatusCard renderer (bible §6.1) — the W2 template component. Meta: src/v2/components-meta/StatusCard.ts.
//
//   [ checkout-api        ● OOMKilled ]   120 px row, radius.card, 2 px border, opaque plate hugging its content
//
// States (= Tone): neutral (borderStrong / bgRaised / "● status" lime), danger (danger / dangerSurface / "● status" in
// danger, pulsing 0.7↔1 per 20 f once settled), accent (accent border, "● status" lime), dim (all textDim, no dot).
// Every state change cross-fades the plate (border + surface, both opaque tokens) over 6 f and snaps the text colours;
// a status/label override on the same action scrambles in over 8 f (class-preserving, change-only) while the plate
// width tweens to the new text over 6 f. pulse = inset glow flash, focus = 3 % kick, glitch = 4 f tinted-copy glitch
// of the TEXT only (danger / accent copies, W2.1 r2) clipped inside the plate, which is never copied or tinted,
// scramble = re-settle.
// enterExit "self" (plateFade, W2.1): the plate is opaque before the texts appear; on exit the texts fade + blur first
// on the still-opaque plate, then the plate. The plate is centred in the footprint (statusCardHugWidth).
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { meta, STATUS_CARD, statusCardHugWidth, type StatusCardPropsT } from "../../../src/v2/components-meta/StatusCard";
import { activeGlitch, clampX, easeBible, flash, pulse, scramble, stateMix } from "../motion";
import { color, font, motion, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { Glitch } from "./primitives";

interface Look {
  border: ColorToken;
  surface: ColorToken;
  label: ColorToken;
  status: ColorToken;
  dot: boolean;
  glow: ColorToken;
}

const LOOK: Record<string, Look> = {
  neutral: { border: "borderStrong", surface: "bgRaised", label: "text", status: "accent", dot: true, glow: "markAccent" },
  danger: { border: "danger", surface: "dangerSurface", label: "text", status: "danger", dot: true, glow: "markDanger" },
  accent: { border: "accent", surface: "bgRaised", label: "text", status: "accent", dot: true, glow: "markAccent" },
  dim: { border: "border", surface: "bgRaised", label: "textDim", status: "textDim", dot: false, glow: "markAccent" },
};

const SCRAMBLE_F = motion.scrambleF[1]; // 8 f

/**
 * Plate colours (border, surface) cross-fade from the previous state's look over 6 f. Text colours SNAP on the change
 * frame: a lime → red text fade would pass through orange (off-palette), and the status scramble covers the swap.
 */
const mixed = (t: number, from: Look, to: Look, key: "border" | "surface") =>
  t >= 1 || from[key] === to[key] ? color[to[key]] : interpolateColors(t, [0, 1], [color[from[key]], color[to[key]]]);

/** Text shown for one field: a props override scrambles from the old text; a scramble verb re-settles in place. */
function fieldText(p: RenderProps<StatusCardPropsT>, key: "label" | "status"): string {
  const cur = p.props[key];
  const old = p.prev[key];
  const sc = key === "status" ? p.last("scramble") : undefined;
  const changing = p.changeF !== null && old !== cur && p.f < p.changeF + SCRAMBLE_F;
  // the later of the two wins
  if (sc !== undefined && p.f < sc + SCRAMBLE_F && (!changing || sc >= (p.changeF ?? -1))) return scramble(cur, cur, p.f, sc, SCRAMBLE_F, `${p.id}:${key}:sc${sc}`);
  if (changing) return scramble(old, cur, p.f, p.changeF!, SCRAMBLE_F, `${p.id}:${key}:ch${p.changeF}`, { changedOnly: true });
  return cur;
}

/** Plate width at this frame: hugs the current texts, tweening 6 f from the previous ones after an override. */
export function statusPlateWidth(p: RenderProps<StatusCardPropsT>): number {
  const w = p.size.w;
  const cur = statusCardHugWidth(p.props, w);
  if (p.changeF === null) return cur;
  const old = statusCardHugWidth(p.prev, w);
  if (old === cur) return cur;
  const t = easeBible(interpolate(p.frame, [p.changeF, p.changeF + STATUS_CARD.hugF], [0, 1], clampX));
  return old + (cur - old) * t;
}

const Render: React.FC<RenderProps<StatusCardPropsT>> = (p) => {
  const fade = plateFade(p.frame, p.enterF, p.exitF);
  if (!fade.visible) return null;
  const look = LOOK[p.state.name] ?? LOOK.neutral;
  const from = p.state.prev ? (LOOK[p.state.prev] ?? look) : look;
  const t = stateMix(p.frame, p.state.f);
  const showDot = p.props.dot ?? look.dot;
  // danger pulse (bible §7: 0.7↔1 / 20 f) starts once the change has settled (initial danger: from frame 0)
  const pulseFrom = p.state.f === null ? 0 : p.state.f + SCRAMBLE_F;
  const statusOpacity = p.state.name === "danger" && p.frame >= pulseFrom ? pulse(p.frame, pulseFrom) : 1;
  const glow = flash(p.frame, p.last("pulse"), 5);
  const kick = flash(p.frame, p.last("focus"), 4);
  const glitches = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  const { w, h } = p.size;
  const pw = statusPlateWidth(p);
  const px = (w - pw) / 2;
  const plate = (
      <div
        style={{
          position: "absolute", left: px, top: 0, width: pw, height: h, boxSizing: "border-box",
          borderRadius: radius.card, border: `${STATUS_CARD.border}px solid ${mixed(t, from, look, "border")}`,
          background: mixed(t, from, look, "surface"),
          boxShadow: glow > 0 ? `inset 0 0 ${Math.round(36 * glow)}px ${color[look.glow]}` : undefined,
          ...fade.plate,
        }}
      />
  );
  const content = (
      <div
        style={{
          position: "absolute", left: px, top: 0, width: pw, height: h, boxSizing: "border-box",
          padding: `0 ${STATUS_CARD.padX + STATUS_CARD.border}px`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: STATUS_CARD.gap,
          ...fade.content,
        }}
      >
        <span style={{ fontFamily: font.sans, fontWeight: 600, fontSize: STATUS_CARD.labelPx, color: color[look.label], whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
          {fieldText(p, "label")}
        </span>
        <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: STATUS_CARD.statusPx, color: color[look.status], opacity: statusOpacity, whiteSpace: "pre", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {showDot ? "● " : ""}
          {fieldText(p, "status")}
        </span>
      </div>
  );
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, ...fade.group }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined, transformOrigin: "50% 50%" }}>
        <Glitch frame={p.frame} at={activeGlitch(glitches, p.frame)} seed={`${p.id}:glitch`} w={w} h={h} clip={{ x: px, w: pw, r: radius.card, inset: STATUS_CARD.border }} plate={plate}>
          {content}
        </Glitch>
      </div>
    </div>
  );
};

export const StatusCard = defineComponent({ ...meta, Render });
