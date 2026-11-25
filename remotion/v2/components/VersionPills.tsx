// VersionPills renderer (bible §6.10). Meta: src/v2/components-meta/VersionPills.ts. enterExit "self".
//
// Pills at the meta's fixed layout (equal widths, balanced centred grid, 16 px gaps), mono 500 30 px, radius.pill.
// Entrance: pill i pops at enterF + 3·i (shared spring: scale 0.9 → 1; the opaque plate is full by progress 0.5,
// the text fades in after it, so no field glyph ever shows through). Exit (plateFade): texts fade + blur 4 f on the
// still-opaque pills, then the pills fade + blur 4 f. State: the tone sweeps left → right 3 f per pill (colours snap
// per pill); danger text pulses once swept. Accent with > 2 pills = outline pills, only `highlight` solid lime.
import React from "react";
import { accentSolid, meta, pillH, VERSION_PILLS, versionPillsLayout, type VersionPillsPropsT } from "../../../src/v2/components-meta/VersionPills";
import { flash, pulse, stagger, staggerEnter } from "../motion";
import { color, font, radius, type ColorToken } from "../theme";
import { defineComponent, type RenderProps } from "./contract";
import { plateFade } from "./plateFade";

interface Look {
  bg: ColorToken;
  border: ColorToken;
  text: ColorToken;
  glow: ColorToken;
}

const LOOK: Record<string, Look> = {
  accent: { bg: "accent", border: "accent", text: "accentInk", glow: "markAccent" },
  accentOutline: { bg: "bgRaised", border: "accent", text: "accent", glow: "markAccent" },
  danger: { bg: "dangerSurface", border: "danger", text: "danger", glow: "markDanger" },
  neutral: { bg: "bgRaised", border: "borderStrong", text: "text", glow: "borderStrong" },
  dim: { bg: "bgRaised", border: "border", text: "textDim", glow: "border" },
};

/** Look name of pill i at this frame (the state sweeps 3 f per pill). Exported for tests. */
export function pillState(p: RenderProps<VersionPillsPropsT>, i: number): string {
  const st = p.state;
  if (st.f === null || !st.prev) return st.name;
  return p.f >= stagger(i, st.f, VERSION_PILLS.staggerF) ? st.name : st.prev;
}

const Render: React.FC<RenderProps<VersionPillsPropsT>> = (p) => {
  const { w, h } = p.size;
  const { boxes } = versionPillsLayout(p.base.items, w);
  const out = plateFade(p.frame, null, p.exitF);
  const glow = flash(p.frame, p.last("pulse"), 5);
  const kick = flash(p.frame, p.last("focus"), 4);
  const n = p.base.items.length;
  const swept = p.state.f === null ? 0 : stagger(n - 1, p.state.f, VERSION_PILLS.staggerF) + 1;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: kick > 0 ? `scale(${1 + 0.03 * kick})` : undefined, transformOrigin: "50% 50%" }}>
      {boxes.map((b, i) => {
        const e = staggerEnter(p.frame, p.enterF, i, VERSION_PILLS.staggerF);
        const plateIn = Math.min(1, e / VERSION_PILLS.plateBy);
        const textIn = Math.max(0, Math.min(1, (e - VERSION_PILLS.plateBy) / (1 - VERSION_PILLS.plateBy)));
        const opacity = plateIn * out.plate.opacity;
        if (opacity <= 0.001) return null;
        const name = pillState(p, i);
        const look = name === "accent" && !accentSolid(p.base, i) ? LOOK.accentOutline : (LOOK[name] ?? LOOK.accent);
        const textOpacity = name === "danger" && p.frame >= swept ? pulse(p.frame, swept) : 1;
        const s = VERSION_PILLS.popFrom + (1 - VERSION_PILLS.popFrom) * e;
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: b.x, top: b.y, width: b.w, height: pillH, boxSizing: "border-box", borderRadius: radius.pill,
              background: color[look.bg], border: `${VERSION_PILLS.border}px solid ${color[look.border]}`,
              display: "flex", alignItems: "center", justifyContent: "center", opacity,
              transform: s < 1 ? `scale(${s})` : undefined, filter: out.plate.filter,
              boxShadow: glow > 0 ? `inset 0 0 ${Math.round(24 * glow)}px ${color[look.glow]}` : undefined,
            }}
          >
            <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: VERSION_PILLS.px, lineHeight: `${VERSION_PILLS.lineH}px`, color: color[look.text], whiteSpace: "pre", fontVariantNumeric: "tabular-nums", opacity: textOpacity * textIn * out.content.opacity, filter: out.content.filter }}>
              {p.props.items[i] ?? p.base.items[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const VersionPills = defineComponent({ ...meta, Render });
