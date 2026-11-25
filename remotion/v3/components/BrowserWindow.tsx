// BrowserWindow renderer (meta: src/v3/components-meta/BrowserWindow.ts). Promoted from remotion/v3lab (BrowserWindow +
// HookBrowser). Generic chrome only: three neutral dots, a pill address bar, no browser logos (D1 #2d).
import React from "react";
import { Img, interpolateColors } from "remotion";
import { BW, BrowserWindowProps, meta, POP_CH, popValueCh, urlLayout, type BrowserWindowPropsT } from "../../../src/v3/components-meta/BrowserWindow";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { plateFade } from "../../v2/components/plateFade";
import { enterProgress, flash } from "../../v2/motion";
import { color, font, radius, type } from "../../v2/theme";
import { ASSET_URLS } from "../assetUrls.gen";

void BrowserWindowProps;

const Padlock: React.FC<{ cx: number; cy: number; size: number; accent: number }> = ({ cx, cy, size: s, accent }) => {
  const stroke = interpolateColors(accent, [0, 1], [color.text, color.accent]);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={BW.w} height={BW.h}>
      <g fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <rect x={cx - s * 0.36} y={cy - s * 0.06} width={s * 0.72} height={s * 0.52} rx={s * 0.08} />
        <path d={`M ${cx - s * 0.22} ${cy - s * 0.06} V ${cy - s * 0.2} A ${s * 0.22} ${s * 0.22} 0 0 1 ${cx + s * 0.22} ${cy - s * 0.2} V ${cy - s * 0.06}`} />
        <line x1={cx} y1={cy + s * 0.12} x2={cx} y2={cy + s * 0.26} />
      </g>
    </svg>
  );
};

const Placeholder: React.FC = () => {
  const b = (x: number, y: number, w: number, h: number, r = 12) => <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: r, background: color.bgRaised2 }} />;
  return (
    <>
      {b(64, 64, 832, 300, radius.box)}
      {b(64, 420, 700, 28)}
      {b(64, 470, 780, 28)}
      {b(64, 520, 560, 28)}
      {b(64, 610, 240, 72, radius.pill)}
      {b(64, 760, 380, 260, radius.box)}
      {b(476, 760, 420, 260, radius.box)}
    </>
  );
};

function wrap(s: string, n: number): string[] {
  if (s.length <= n) return [s];
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) {
    if (cur && (cur + " " + w).length > n) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

const Popover: React.FC<{ frame: number; openF: number | null; p: BrowserWindowPropsT }> = ({ frame, openF, p }) => {
  const pf = plateFade(frame, openF, null);
  if (!pf.visible) return null;
  const P = BW.pop;
  const rows: [string, string][] = [
    ["Protocol", p.cert.protocol],
    ["Issued to", p.host],
    ["Issued by", p.cert.issuer],
    ["Valid until", p.cert.validTo],
  ];
  return (
    <div style={{ position: "absolute", left: P.x, top: P.y, width: P.w, height: P.h, transformOrigin: "0 0", ...pf.group }}>
      <div style={{ position: "absolute", inset: 0, background: color.bgRaised, border: `2px solid ${color.borderStrong}`, borderRadius: radius.card, ...pf.plate }} />
      <div style={{ position: "absolute", inset: 0, ...pf.content }}>
        <div style={{ position: "absolute", left: P.pad, top: 34, display: "flex", alignItems: "center", gap: 16, fontFamily: font.sans, fontWeight: type.cardTitle.weight, fontSize: type.cardTitle.size, color: color.text, whiteSpace: "pre" }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: color.accent }} />
          Connection is secure
        </div>
        <div style={{ position: "absolute", left: P.pad, right: P.pad, top: 104, height: 1, background: color.border }} />
        {rows.map(([k, v], i) => {
          const e = openF === null ? 1 : enterProgress(frame, openF + 6 + 4 * i);
          return (
            <div key={k} style={{ position: "absolute", left: P.pad, top: P.rowTop[i], opacity: e, transform: `translateY(${(1 - e) * 10}px)`, fontFamily: font.mono, fontSize: type.field.size, lineHeight: "40px", whiteSpace: "pre" }}>
              {wrap(v, popValueCh()).map((line, j) => (
                <div key={j} style={{ height: 40 }}>
                  <span style={{ color: color.textDim, display: "inline-block", width: P.labelCh * POP_CH }}>{j === 0 ? k : ""}</span>
                  <span style={{ color: color.text }}>{line}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Render: React.FC<RenderProps<BrowserWindowPropsT>> = ({ props: p, frame, f, state, last }) => {
  const L = urlLayout(p);
  const pulse = flash(frame, last("focus"), 8);
  const hl = (part: "s" | "lock" | "host") => (p.highlight === part ? Math.min(1, 0.85 + 0.15 * pulse) : 0);
  const sCol = interpolateColors(hl("s"), [0, 1], [color.text, color.accent]);
  const hostCol = interpolateColors(hl("host"), [0, 1], [color.text, color.accent]);
  const tapped = p.url === "tapped";
  const caretOn = tapped && Math.floor(f / 16) % 2 === 0;
  const dot = (i: number) => <div key={i} style={{ position: "absolute", left: 32 + i * 26, top: 25, width: 14, height: 14, borderRadius: 7, background: color.textDim, opacity: 0.4 }} />;
  const page = p.pageAsset !== "none" ? ASSET_URLS[p.pageAsset] : undefined;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: BW.w, height: BW.h, borderRadius: radius.card, background: color.bgRaised, border: `2px solid ${color.border}`, overflow: "hidden", boxSizing: "border-box" }}>
      {[0, 1, 2].map(dot)}
      <div style={{ position: "absolute", left: BW.bar.x, top: BW.bar.y, width: BW.bar.w, height: BW.bar.h, borderRadius: radius.pill, background: color.bgRaised2, border: `2px solid ${tapped ? color.borderStrong : color.border}`, boxSizing: "border-box", boxShadow: tapped ? `0 0 0 3px ${color.border}` : undefined }} />
      <div style={{ position: "absolute", left: L.x0, top: BW.bar.y, height: BW.bar.h, display: "flex", alignItems: "center", fontFamily: font.mono, fontSize: L.fs, whiteSpace: "pre" }}>
        {L.scheme.split("").map((c, i) => (
          <span key={i} style={{ display: "inline-block", width: L.ch, textAlign: "center", color: i === 4 ? sCol : color.text, ...(i === 4 && hl("s") > 0.5 ? { WebkitTextStroke: `1px ${sCol}` } : null) }}>{c}</span>
        ))}
        {p.host.split("").map((c, i) => (
          <span key={`h${i}`} style={{ display: "inline-block", width: L.ch, textAlign: "center", color: hostCol }}>{c}</span>
        ))}
        <span style={{ color: color.textDim }}>{L.path}</span>
        {tapped ? <span style={{ display: "inline-block", width: 3, height: L.fs + 6, marginLeft: 3, background: color.text, opacity: caretOn ? 0.9 : 0 }} /> : null}
      </div>
      {p.lock ? <Padlock cx={BW.lock.cx} cy={L.cy} size={BW.lock.size} accent={hl("lock")} /> : null}
      <div style={{ position: "absolute", left: 0, top: BW.pageTop - 2, width: BW.w, height: 2, background: color.border }} />
      <div style={{ position: "absolute", left: 0, top: BW.pageTop, width: BW.w, height: BW.h - BW.pageTop, overflow: "hidden", background: color.bg }}>
        {page ? <Img src={page} style={{ width: BW.w, height: BW.h - BW.pageTop, objectFit: "cover", objectPosition: "50% 0%" }} /> : <Placeholder />}
      </div>
      {state.name === "popover" ? <Popover frame={frame} openF={state.f} p={p} /> : null}
    </div>
  );
};

export const BrowserWindow = defineComponent({ ...meta, Render });
