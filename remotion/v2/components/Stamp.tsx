// Stamp renderer (bible §6.11). Meta: src/v2/components-meta/Stamp.ts. enterExit "self".
//
// A 6 px danger-outlined box on the opaque dangerSurface plate (radius.pill), Inter 800 56 px uppercase in danger,
// rotated −4°, centred in a footprint that already holds the 1.4× slam frame. Enter: scale 1.4 → 1 over 6 f with an
// ease-in (it accelerates into the impact) and a 4 → 0 px blur over the first 2 f — NO opacity ramp (W2.1): the plate
// is opaque from the first visible frame, so the field never shows through behind the slam. The 3 f ±6 px shake is the camera's
// (STAMP_CAMERA_REQUEST); the Stamp itself never moves after landing. Exit (plateFade): the text fades + blurs 4 f on
// the still-opaque plate, then the plate fades + blurs 4 f.
import React from "react";
import { Easing, interpolate } from "remotion";
import { meta, STAMP, stampBox, stampLines, type StampPropsT } from "../../../src/v2/components-meta/Stamp";
import { activeGlitch, clampX, flash } from "../motion";
import { color, font, radius } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";
import { Glitch } from "./primitives";

/** Slam scale at this frame (1.4 → 1 over 6 f, ease-in), 1 when there is no entrance. Exported for tests. */
export function slamScale(frame: number, enterF: number | null): number {
  if (enterF === null) return 1;
  return interpolate(frame, [enterF, enterF + STAMP.slamF], [STAMP.slamFrom, 1], { ...clampX, easing: Easing.in(Easing.quad) });
}

const Render: React.FC<RenderProps<StampPropsT>> = (p) => {
  const { w, h } = p.size;
  const box = stampBox(p.props.text);
  const lines = stampLines(p.props.text);
  if (p.enterF !== null && p.frame < p.enterF) return null;
  const out = plateFade(p.frame, null, p.exitF);
  const opacity = out.plate.opacity;
  if (opacity <= 0.001) return null;
  // slam blur (scale + blur only; the plate stays at alpha 1)
  const slamBlur = p.enterF === null ? 0 : interpolate(p.frame, [p.enterF, p.enterF + STAMP.fadeInF], [STAMP.slamBlurPx, 0], clampX);
  const filter = [slamBlur > 0.01 ? `blur(${slamBlur}px)` : "", out.plate.filter ?? ""].filter(Boolean).join(" ") || undefined;
  const s = slamScale(p.frame, p.enterF);
  const glow = flash(p.frame, p.last("pulse"), 5);
  const glitches = p.events.filter((e) => e.do === "glitch").map((e) => e.f);
  const iw = box.w - 2 * STAMP.border;
  const ih = box.h - 2 * STAMP.border;
  const text = (
    <div style={{ position: "absolute", left: 0, top: 0, width: iw, height: ih, boxSizing: "border-box", padding: `${STAMP.padY}px ${STAMP.padX}px`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontFamily: font.sans, fontWeight: STAMP.weight, fontSize: STAMP.px, lineHeight: STAMP.lineH, letterSpacing: `${STAMP.trackEm}em`, color: color.danger, whiteSpace: "pre", textAlign: "center", opacity: out.content.opacity, filter: out.content.filter }}>
          {l}
        </div>
      ))}
    </div>
  );
  // The glitch (W2.1 r2) lives INSIDE the rotated plate and copies only the text: the plate is never copied or tinted,
  // and the copies / slices are clipped to the plate's rounded inner rect (rotated with it), so nothing leaves its edge.
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, opacity, filter }}>
      <div
        style={{
          position: "absolute", left: (w - box.w) / 2, top: (h - box.h) / 2, width: box.w, height: box.h, boxSizing: "border-box",
          border: `${STAMP.border}px solid ${color.danger}`, borderRadius: radius.pill, background: color.dangerSurface,
          transform: `rotate(${STAMP.rotateDeg}deg) scale(${s})`, transformOrigin: "50% 50%",
          boxShadow: glow > 0 ? `inset 0 0 ${Math.round(40 * glow)}px ${color.markDanger}` : undefined,
        }}
      >
        <Glitch frame={p.frame} at={activeGlitch(glitches, p.frame)} seed={`${p.id}:glitch`} w={iw} h={ih} clip={{ r: Math.max(0, radius.pill - STAMP.border) }} plate={null}>
          {text}
        </Glitch>
      </div>
    </div>
  );
};

export const Stamp = defineComponent({ ...meta, Render });
