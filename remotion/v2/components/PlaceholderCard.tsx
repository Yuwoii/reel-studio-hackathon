// W1 placeholder for every library slot: a token-only card at the instance's footprint, so a storyboard renders end to
// end before W2 ships the real components. It honours the shared verbs (enter/exit, state, pulse, focus, mark,
// countUp/scramble, drawOn) generically. Since W2 it is the Slot's fallback (components/Slot.tsx): planned ids with no
// shipped component, and instances whose props fail their component's propsSchema.
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { clampX, dangerPulse, flash, latest, scramble } from "../motion";
import { color, font, motion, radius, type } from "../theme";
import type { SlotProps } from "./types";

const DANGER_STATES = new Set(["danger", "full", "killed", "oom", "down", "failed", "error", "broken", "bad"]);
const ACCENT_STATES = new Set(["ok", "accent", "resolved", "recovered", "up", "fixed"]);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);

/** Primary + secondary strings of free-form props (W2's propsSchema will make this explicit). */
function texts(component: string, props: Record<string, unknown>): { main: string; sub: string | null; big: boolean } {
  const value = str(props.value);
  if (value) return { main: value, sub: str(props.label) ?? str(props.caption), big: true };
  const main = str(props.text) ?? str(props.label) ?? str(props.title) ?? component;
  const sub = str(props.status) ?? str(props.subtitle) ?? str(props.caption) ?? str(props.limitLabel) ?? (Array.isArray(props.ticks) ? props.ticks.filter((x) => typeof x === "string").join(" · ") : null);
  return { main, sub: sub === main ? null : sub, big: false };
}

export const PlaceholderCard: React.FC<SlotProps> = ({ inst, track, size }) => {
  const frame = useCurrentFrame();
  const f = Math.floor(frame);
  const box = size;
  const props = inst.props as Record<string, unknown>;
  const st = latest(track.states, f);
  const toneProp = str(props.tone);
  const danger = st ? DANGER_STATES.has(st.state) : toneProp === "danger";
  const accent = !danger && (st ? ACCENT_STATES.has(st.state) : false);
  const { main, sub, big } = texts(inst.component, props);
  // countUp / scramble: settle the main value left-to-right over 6 f (discrete; settled by the keywordF+6 review still)
  const sc = latest([...track.countUps, ...track.scrambles].sort((a, b) => a - b).map((x) => ({ f: x })), f);
  const shown = sc && f < sc.f + motion.scrambleF[0] ? scramble(main, main, f, sc.f, motion.scrambleF[0], `ph:${inst.id}:${sc.f}`) : main;
  const pulseAt = latest(track.pulses.map((x) => ({ f: x })), f)?.f;
  const glow = flash(frame, pulseAt, 5);
  const focusAt = latest(track.focus.map((x) => ({ f: x })), f)?.f;
  const kick = flash(frame, focusAt, 4);
  const markAt = latest(track.marks.map((m) => ({ f: m.f })), f)?.f;
  const markL = markAt === undefined ? 0 : interpolate(frame, [markAt, markAt + 6], [0, 1], clampX);
  const drawAt = latest(track.drawOns.map((x) => ({ f: x })), f)?.f;
  const draw = drawAt === undefined ? null : interpolate(frame, [drawAt, drawAt + 16], [0, 1], clampX);
  const tone = danger ? color.danger : accent ? color.accent : color.text;
  const borderC = danger ? color.danger : markL > 0 || accent ? color.accent : color.borderStrong;
  const pill = box.h < 140;
  const stateLabel = st?.state ? st.state.toUpperCase() : null;
  const statusPulse = danger && st ? dangerPulse(frame, st.f + 13) : 1;
  const bigSize = Math.max(type.cardTitle.size, Math.min(type.hero.size, Math.round((box.h - 120) * 0.9)));
  return (
    <div
      style={{
        position: "absolute", left: 0, top: 0, width: box.w, height: box.h, boxSizing: "border-box", overflow: "hidden",
        borderRadius: pill ? radius.pill : radius.card, border: `${danger || markL > 0 ? 2 : 1}px solid ${borderC}`,
        background: danger ? color.dangerSurface : color.bgRaised,
        padding: pill ? "0 28px" : "28px 40px", display: "flex", flexDirection: pill ? "row" : "column", alignItems: pill ? "center" : "stretch",
        justifyContent: pill ? "space-between" : "flex-start", gap: pill ? 24 : 10,
        transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined,
        boxShadow: glow > 0 ? `0 0 ${Math.round(40 * glow)}px ${danger ? color.markDanger : color.markAccent}` : undefined,
      }}
    >
      {pill ? null : (
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: font.mono, fontWeight: 500, fontSize: type.cardSub.size, letterSpacing: type.cardSub.tracking, color: color.textDim, textTransform: "uppercase" }}>
          <span>{inst.component}</span>
          {stateLabel ? <span style={{ color: danger ? color.danger : accent ? color.accent : color.textDim, opacity: statusPulse }}>● {stateLabel}</span> : null}
        </div>
      )}
      <div
        style={{
          fontFamily: big ? font.mono : font.sans, fontWeight: 600, fontSize: big ? bigSize : pill ? type.pill.size : type.cardTitle.size,
          lineHeight: big ? 1.0 : 1.2, letterSpacing: big ? type.hero.tracking : undefined, fontVariantNumeric: "tabular-nums",
          color: big ? tone : color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
        }}
      >
        {shown}
      </div>
      {sub ? (
        <div style={{ fontFamily: font.mono, fontWeight: 400, fontSize: type.cardSub.size, letterSpacing: type.cardSub.tracking, color: pill && danger ? color.danger : color.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>
          {sub}
        </div>
      ) : null}
      {draw !== null && !pill ? (
        <div style={{ marginTop: "auto", height: 8, borderRadius: 4, background: color.bgRaised2 }}>
          <div style={{ width: `${draw * 100}%`, height: "100%", borderRadius: 4, background: danger ? color.danger : color.accent }} />
        </div>
      ) : null}
    </div>
  );
};
