// (a) BrowserWindow: a generic, unbranded browser window (no Chrome/Safari/Firefox marks) laid out at world (0,0),
// 960×1320 px. Named anchors are code constants in window px (WIN_ANCHORS) and normalised (winAnchorNorm).
// Optional `pageSrc` replaces the placeholder page with a real capture (option c). The certificate popover opens from
// the lock. Pure function of the frame.
import React from "react";
import { Img } from "remotion";
import { enterProgress } from "../../v2/motion";
import { plateFade } from "../../v2/components/plateFade";
import { color, font, radius, type } from "../../v2/theme";

export const WIN = { w: 960, h: 1320, titleH: 64, url: { x: 24, y: 88, w: 912, h: 72 }, pageTop: 184 } as const;
const CH = 18; // JetBrains Mono advance at 30 px (0.6 em)
const LOCK = { cx: 68, size: 40 } as const;
const TEXT_X = 104;
const URL_CY = WIN.url.y + WIN.url.h / 2;
export const POP = { x: 48, y: 176, w: 760, h: 470, pad: 36, labelCh: 12, rowTop: [132, 192, 252, 352] } as const;

export function winAnchors(host: string) {
  const schemeW = 8 * CH;
  return {
    lock: { x: LOCK.cx, y: URL_CY },
    scheme: { x: TEXT_X + schemeW / 2, y: URL_CY },
    host: { x: TEXT_X + schemeW + (host.length * CH) / 2, y: URL_CY },
    urlbar: { x: WIN.w / 2, y: URL_CY },
    page: { x: WIN.w / 2, y: (WIN.pageTop + WIN.h) / 2 },
    popover: { x: POP.x, y: POP.y },
    popoverCenter: { x: POP.x + POP.w / 2, y: POP.y + POP.h / 2 },
    protocolRow: { x: POP.x + POP.pad + POP.labelCh * CH + 7 * CH + 14, y: POP.y + POP.rowTop[0] + 20 },
  } as const;
}

export interface CertInfo {
  protocol: string;
  subject: string;
  issuer: string;
  validTo: string;
}

/** Padlock glyph: body + shackle, 3 px stroke; `accent` 0..1 cross-fades text → accent (no new colours). */
const Lock: React.FC<{ cx: number; cy: number; size: number; accent: number }> = ({ cx, cy, size, accent }) => {
  const s = size;
  const path = (stroke: string, op: number) => (
    <g opacity={op} fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <rect x={cx - s * 0.36} y={cy - s * 0.06} width={s * 0.72} height={s * 0.52} rx={s * 0.08} />
      <path d={`M ${cx - s * 0.22} ${cy - s * 0.06} V ${cy - s * 0.2} A ${s * 0.22} ${s * 0.22} 0 0 1 ${cx + s * 0.22} ${cy - s * 0.2} V ${cy - s * 0.06}`} />
      <line x1={cx} y1={cy + s * 0.12} x2={cx} y2={cy + s * 0.26} />
    </g>
  );
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={WIN.w} height={WIN.h}>
      {path(color.text, 1 - accent)}
      {path(color.accent, accent)}
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

export const CertPopover: React.FC<{ frame: number; openF: number; rowsF: number; cert: CertInfo }> = ({ frame, openF, rowsF, cert }) => {
  if (frame < openF) return null;
  const pf = plateFade(frame, openF, null);
  if (!pf.visible) return null;
  const rows: [string, string][] = [
    ["Protocol", cert.protocol],
    ["Issued to", cert.subject],
    ["Issued by", cert.issuer],
    ["Valid until", cert.validTo],
  ];
  const valueCh = Math.floor((POP.w - 2 * POP.pad) / CH) - POP.labelCh;
  return (
    <div style={{ position: "absolute", left: POP.x, top: POP.y, width: POP.w, height: POP.h, transformOrigin: "0 0", ...pf.group }}>
      <div style={{ position: "absolute", inset: 0, background: color.bgRaised, border: `2px solid ${color.borderStrong}`, borderRadius: radius.card, ...pf.plate }} />
      <div style={{ position: "absolute", inset: 0, ...pf.content }}>
        <div style={{ position: "absolute", left: POP.pad, top: 34, display: "flex", alignItems: "center", gap: 16, fontFamily: font.sans, fontWeight: type.cardTitle.weight, fontSize: type.cardTitle.size, color: color.text }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: color.accent }} />
          Connection is secure
        </div>
        <div style={{ position: "absolute", left: POP.pad, right: POP.pad, top: 104, height: 1, background: color.border }} />
        {rows.map(([k, v], i) => {
          const e = enterProgress(frame, rowsF + 4 * i);
          const wrapped = wrap(v, valueCh);
          return (
            <div key={k} style={{ position: "absolute", left: POP.pad, top: POP.rowTop[i], opacity: e, transform: `translateY(${(1 - e) * 10}px)`,
              fontFamily: font.mono, fontSize: type.field.size, lineHeight: "40px", whiteSpace: "pre" }}>
              {wrapped.map((line, j) => (
                <div key={j}><span style={{ color: color.textDim }}>{(j === 0 ? k : "").padEnd(POP.labelCh, " ")}</span><span style={{ color: color.text }}>{line}</span></div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function wrap(s: string, n: number): string[] {
  if (s.length <= n) return [s];
  const words = s.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > n) {
      out.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) out.push(cur);
  return out;
}

export const BrowserWindow: React.FC<{
  frame: number;
  host: string;
  path?: string;
  lockAccent: number;
  pageSrc?: string;
  popover?: { openF: number; rowsF: number; cert: CertInfo };
}> = ({ frame, host, path = "", lockAccent, pageSrc, popover }) => {
  const dot = (i: number) => <div key={i} style={{ position: "absolute", left: 32 + i * 26, top: 25, width: 14, height: 14, borderRadius: 7, background: color.textDim, opacity: 0.4 }} />;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: WIN.h, borderRadius: radius.card, background: color.bgRaised, border: `2px solid ${color.border}`, overflow: "hidden", boxSizing: "border-box" }}>
      {[0, 1, 2].map(dot)}
      <div style={{ position: "absolute", left: WIN.url.x, top: WIN.url.y, width: WIN.url.w, height: WIN.url.h, borderRadius: radius.pill, background: color.bgRaised2, border: `1px solid ${color.border}`, boxSizing: "border-box" }} />
      <div style={{ position: "absolute", left: TEXT_X, top: WIN.url.y, height: WIN.url.h, display: "flex", alignItems: "center", fontFamily: font.mono, fontSize: 30, whiteSpace: "pre" }}>
        <span style={{ color: color.textDim }}>https://</span>
        <span style={{ color: color.text }}>{host}</span>
        <span style={{ color: color.textDim }}>{path}</span>
      </div>
      <Lock cx={LOCK.cx} cy={URL_CY} size={LOCK.size} accent={lockAccent} />
      <div style={{ position: "absolute", left: 0, top: WIN.pageTop - 2, width: WIN.w, height: 2, background: color.border }} />
      <div style={{ position: "absolute", left: 0, top: WIN.pageTop, width: WIN.w, height: WIN.h - WIN.pageTop, overflow: "hidden" }}>
        {pageSrc ? <Img src={pageSrc} style={{ width: WIN.w, height: WIN.h - WIN.pageTop, objectFit: "cover", objectPosition: "50% 0%" }} /> : <Placeholder />}
      </div>
      {popover ? <CertPopover frame={frame} {...popover} /> : null}
    </div>
  );
};
