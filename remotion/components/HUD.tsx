// HUD: counter / bar / meter in the three top slots, all inside the safe zone. Values tween from→to across the
// beat (see hudValues.ts); a changing value gets a short pulse so the eye catches it.

import React from "react";
import { useCurrentFrame } from "remotion";
import type { HudDef } from "../../src/schema/index.js";
import { lighten, readableOn } from "../color";
import { hudValueAt, recurringChipValue, recurringCounterText, recurringHasCounter, type HudSpan, type Recurring } from "../hudValues";
import { BANDS, TEXT_BOX, clampTextRect } from "../safeZone";
import { cssFont, useTheme } from "../styles";

const SLOT_W = 280;
const SLOT_H = BANDS.hud.bottom - BANDS.hud.top;
const GAP = (TEXT_BOX.right - TEXT_BOX.left - 3 * SLOT_W) / 2;

function slotX(slot: HudDef["slot"]): number {
  switch (slot) {
    case "top-left":
      return TEXT_BOX.left;
    case "top-center":
      return TEXT_BOX.left + SLOT_W + GAP;
    case "top-right":
      return TEXT_BOX.right - SLOT_W;
    default: {
      const _x: never = slot;
      return TEXT_BOX.left;
    }
  }
}

const fmt = (v: number, d: number, unit: string) => `${v.toFixed(d)}${unit}`;

const HudItem: React.FC<{ def: HudDef; span: HudSpan; t: number; recurring?: Recurring }> = ({ def, span, t, recurring }) => {
  const frame = useCurrentFrame();
  const { palette, style } = useTheme();
  const v = hudValueAt(span, t);
  const changing = span.changes && t > 0.1 && t < 0.8;
  const pulse = changing ? 1 + 0.06 * Math.abs(Math.sin(frame / 3)) : 1;
  const r = clampTextRect(slotX(def.slot), BANDS.hud.top, SLOT_W, SLOT_H);
  const panel = palette.ink;
  const fg = readableOn(panel);
  const pixel = !!style.pixelSize;
  const label = style.title.uppercase ? def.label.toUpperCase() : def.label;
  const frac = Math.min(1, Math.max(0, (v - def.min) / (def.max - def.min)));
  const labelSize = pixel ? 18 : 26;
  const valueSize = pixel ? 40 : 58;

  let body: React.ReactNode;
  switch (def.kind) {
    case "counter": {
      const named = recurringCounterText(def, v, recurring);
      body = (
        <div style={{ fontFamily: cssFont(style.displayFont.family), fontWeight: style.displayFont.weight, fontSize: valueSize, color: palette.highlight, lineHeight: 1, transform: `scale(${pulse})`, transformOrigin: "left center" }}>
          {named ?? fmt(v, def.decimals ?? 0, def.unit ?? "")}
        </div>
      );
      break;
    }
    case "bar": {
      const barCol = frac < 0.25 ? palette.primary : palette.highlight;
      body = (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: pixel ? 30 : 32, background: lighten(panel, 0.18), borderRadius: pixel ? 0 : 16, overflow: "hidden", border: `4px solid ${fg}` }}>
            <div style={{ width: `${frac * 100}%`, height: "100%", background: barCol, borderRadius: pixel ? 0 : 12 }} />
          </div>
          <div style={{ fontFamily: cssFont(style.displayFont.family), fontWeight: style.displayFont.weight, fontSize: pixel ? 22 : 32, color: fg, minWidth: pixel ? 80 : 84, textAlign: "right", transform: `scale(${pulse})` }}>
            {fmt(v, def.decimals ?? 0, def.unit ?? "")}
          </div>
        </div>
      );
      break;
    }
    case "meter": {
      const a = -90 + 180 * frac;
      body = (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width={110} height={62} viewBox="-55 -55 110 62" shapeRendering={pixel ? "crispEdges" : undefined}>
            <path d="M-46,0 A46,46 0 0,1 46,0" stroke={lighten(panel, 0.25)} strokeWidth={14} fill="none" />
            <path d="M-46,0 A46,46 0 0,1 46,0" stroke={palette.highlight} strokeWidth={14} fill="none" strokeDasharray={`${Math.PI * 46 * frac} 999`} />
            <line x1={0} y1={0} x2={0} y2={-40} stroke={fg} strokeWidth={6} strokeLinecap="round" transform={`rotate(${a})`} />
            <circle r={7} fill={fg} />
          </svg>
          <div style={{ fontFamily: cssFont(style.displayFont.family), fontWeight: style.displayFont.weight, fontSize: pixel ? 24 : 36, color: fg, transform: `scale(${pulse})` }}>
            {fmt(v, def.decimals ?? 0, def.unit ?? "")}
          </div>
        </div>
      );
      break;
    }
    default: {
      const _x: never = def.kind;
      body = null;
    }
  }
  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        boxSizing: "border-box",
        padding: pixel ? "14px 16px" : "14px 20px",
        background: panel,
        opacity: 0.94,
        borderRadius: style.panelRadius,
        border: pixel ? `4px solid ${fg}` : "none",
        boxShadow: pixel ? `6px 6px 0 ${palette.primary}` : "0 8px 24px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ fontFamily: cssFont(style.labelFont.family), fontWeight: style.labelFont.weight, fontSize: labelSize, letterSpacing: pixel ? 1 : 2, color: fg, opacity: 0.85, whiteSpace: "nowrap" }}>{label}</div>
      {body}
    </div>
  );
};

/** recurring label chip (top-centre) when recurring.values exist but no counter HUD carries them. */
const RecurringChip: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const { palette, style } = useTheme();
  const pixel = !!style.pixelSize;
  const r = clampTextRect(slotX("top-center"), BANDS.hud.top + 18, SLOT_W, SLOT_H - 36);
  const fg = readableOn(palette.ink);
  const text = `${label} ${value}`;
  const size = Math.min(pixel ? 26 : 40, Math.floor((r.w - 40) / (text.length * (pixel ? 1.0 : 0.62))));
  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.ink,
        opacity: 0.94,
        borderRadius: style.panelRadius,
        border: pixel ? `4px solid ${fg}` : "none",
        fontFamily: cssFont(style.displayFont.family),
        fontWeight: style.displayFont.weight,
        fontSize: size,
        color: fg,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      {style.title.uppercase ? label.toUpperCase() : label}&nbsp;<span style={{ color: palette.highlight }}>{value}</span>
    </div>
  );
};

export const HUD: React.FC<{ defs: HudDef[]; visible: string[]; spans: Record<string, HudSpan>; t: number; recurring?: Recurring; beatIndex?: number; beatCount?: number }> = ({
  defs,
  visible,
  spans,
  t,
  recurring,
  beatIndex = 0,
  beatCount = 1,
}) => {
  const shown = defs.filter((d) => visible.includes(d.id));
  const chip = !recurringHasCounter({ hud: defs }, recurring) && !shown.some((d) => d.slot === "top-center") ? recurringChipValue(recurring, beatIndex, beatCount) : null;
  return (
    <>
      {shown.map((d) => (
        <HudItem key={d.id} def={d} span={spans[d.id] ?? { from: d.initial, to: d.initial, changes: false }} t={t} recurring={recurring} />
      ))}
      {chip && recurring && <RecurringChip label={recurring.label} value={chip} />}
    </>
  );
};
