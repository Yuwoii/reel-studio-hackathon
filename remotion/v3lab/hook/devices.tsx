// D1-hook devices (Reel Studio v3, Phase R): generic, unbranded real-object illustrations for the 15 s TLS hook.
// World-space (laid out at fixed world px, moved by the shot camera): HookBrowser, Building, Phone, Router, CableRun.
// Screen-space (keeps its pixel size while the camera moves): Envelope. All colours are v2 theme tokens.
import React from "react";
import { interpolate, interpolateColors } from "remotion";
import { clampX } from "../../v2/motion";
import { color, font, radius, type } from "../../v2/theme";

// ── browser ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const HB = { w: 960, h: 1320, url: { x: 24, y: 88, w: 912, h: 72 }, pageTop: 184 } as const;
const CH = 18; // JetBrains Mono advance at 30 px (0.6 em)
const URL_CY = HB.url.y + HB.url.h / 2;
const LOCK = { cx: 68, size: 40 } as const;

export type HookVariant = "s" | "lock";

/** URL text starts after the padlock (lock variant) or right at the bar's left padding (S variant: no padlock). */
const textX = (v: HookVariant) => (v === "lock" ? 104 : 56);

/** Named anchors in world px (the browser is laid out at world (0,0)). */
export function hookAnchors(v: HookVariant) {
  const tx = textX(v);
  return {
    schemeS: { x: tx + 4 * CH + CH / 2, y: URL_CY },
    scheme: { x: tx + 4 * CH, y: URL_CY },
    lock: { x: LOCK.cx, y: URL_CY },
    urlbar: { x: HB.w / 2, y: URL_CY },
  } as const;
}

const Padlock: React.FC<{ cx: number; cy: number; size: number; accent: number }> = ({ cx, cy, size: s, accent }) => {
  const stroke = interpolateColors(accent, [0, 1], [color.text, color.accent]);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={HB.w} height={HB.h}>
      <g fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <rect x={cx - s * 0.36} y={cy - s * 0.06} width={s * 0.72} height={s * 0.52} rx={s * 0.08} />
        <path d={`M ${cx - s * 0.22} ${cy - s * 0.06} V ${cy - s * 0.2} A ${s * 0.22} ${s * 0.22} 0 0 1 ${cx + s * 0.22} ${cy - s * 0.2} V ${cy - s * 0.06}`} />
        <line x1={cx} y1={cy + s * 0.12} x2={cx} y2={cy + s * 0.26} />
      </g>
    </svg>
  );
};

const PagePlaceholder: React.FC = () => {
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

/**
 * Generic browser window, URL bar in its focused/editing state (full "https://host" visible, caret after the host —
 * Chrome shows the scheme only once the bar is clicked). `sAccent` 0..1 turns the "s" of https accent; `lockAccent`
 * the padlock (lock variant only).
 */
export const HookBrowser: React.FC<{ frame: number; variant: HookVariant; host: string; sAccent: number; lockAccent: number }> = ({ frame, variant, host, sAccent, lockAccent }) => {
  const f = Math.floor(frame);
  const caretOn = Math.floor(f / 16) % 2 === 0;
  const dot = (i: number) => <div key={i} style={{ position: "absolute", left: 32 + i * 26, top: 25, width: 14, height: 14, borderRadius: 7, background: color.textDim, opacity: 0.4 }} />;
  const sColor = interpolateColors(sAccent, [0, 1], [color.text, color.accent]);
  const chars = "https://".split("");
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: HB.w, height: HB.h, borderRadius: radius.card, background: color.bgRaised, border: `2px solid ${color.border}`, overflow: "hidden", boxSizing: "border-box" }}>
      {[0, 1, 2].map(dot)}
      <div style={{ position: "absolute", left: HB.url.x, top: HB.url.y, width: HB.url.w, height: HB.url.h, borderRadius: radius.pill, background: color.bgRaised2, border: `2px solid ${color.borderStrong}`, boxSizing: "border-box" }} />
      <div style={{ position: "absolute", left: textX(variant), top: HB.url.y, height: HB.url.h, display: "flex", alignItems: "center", fontFamily: font.mono, fontSize: 30, whiteSpace: "pre" }}>
        {chars.map((c, i) => (
          <span key={i} style={{ color: i === 4 ? sColor : color.text, ...(i === 4 && sAccent > 0.5 ? { WebkitTextStroke: `1px ${sColor}` } : null) }}>{c}</span>
        ))}
        <span style={{ color: color.text }}>{host}</span>
        <span style={{ display: "inline-block", width: 3, height: 38, marginLeft: 3, background: color.text, opacity: caretOn ? 0.9 : 0 }} />
      </div>
      {variant === "lock" ? <Padlock cx={LOCK.cx} cy={URL_CY} size={LOCK.size} accent={lockAccent} /> : null}
      <div style={{ position: "absolute", left: 0, top: HB.pageTop - 2, width: HB.w, height: 2, background: color.border }} />
      <div style={{ position: "absolute", left: 0, top: HB.pageTop, width: HB.w, height: HB.h - HB.pageTop, overflow: "hidden" }}>
        <PagePlaceholder />
      </div>
    </div>
  );
};

// ── building (world px; laid out in the same world as the browser) ─────────────────────────────────────────────

export const BLD = { x: 160, y: 1560, w: 640, h: 800, door: { x: 400, y: 2140, w: 160, h: 220 } } as const;
export const DOOR_ANCHOR = { x: BLD.door.x + BLD.door.w / 2, y: BLD.door.y + BLD.door.h * 0.45 } as const;

/** Generic office building: body, roof ledge, 4×4 window grid, a door that lights up (`doorGlow` 0..1). */
export const Building: React.FC<{ doorGlow: number; opacity?: number }> = ({ doorGlow, opacity = 1 }) => {
  const wins: React.ReactNode[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const lit = (r * 7 + c * 3) % 5 === 0;
      wins.push(<rect key={`${r}-${c}`} x={BLD.x + 70 + c * 135} y={BLD.y + 90 + r * 120} width={90} height={72} rx={8} fill={lit ? color.textFaint : color.bgRaised2} stroke={color.border} strokeWidth={2} />);
    }
  const d = BLD.door;
  const doorStroke = interpolateColors(doorGlow, [0, 1], [color.borderStrong, color.accent]);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity }} width={1} height={1}>
      <rect x={BLD.x - 30} y={BLD.y - 26} width={BLD.w + 60} height={30} rx={8} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={3} />
      <rect x={BLD.x} y={BLD.y} width={BLD.w} height={BLD.h} rx={12} fill={color.bgRaised} stroke={color.borderStrong} strokeWidth={3} />
      {wins}
      <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={10} fill={color.bg} stroke={doorStroke} strokeWidth={4} />
      <rect x={d.x + 8} y={d.y + 8} width={d.w - 16} height={d.h - 8} rx={6} fill={color.accent} opacity={0.12 * doorGlow} />
      <line x1={d.x + d.w / 2} y1={d.y} x2={d.x + d.w / 2} y2={d.y + d.h} stroke={color.border} strokeWidth={2} />
      <line x1={BLD.x - 80} y1={BLD.y + BLD.h} x2={BLD.x + BLD.w + 80} y2={BLD.y + BLD.h} stroke={color.borderStrong} strokeWidth={3} />
    </svg>
  );
};

// ── envelope (screen space) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Sealed envelope centred at (x, y), `w` wide (h = 0.66 w). `glow` 0..1 = seal halo; `open` 0..1 = flap flips up,
 * the seal splits into two danger halves that fly apart, and a note with password dots rises out.
 */
export const Envelope: React.FC<{ x: number; y: number; w: number; scale?: number; glow: number; open: number; opacity?: number }> = ({ x, y, w, scale = 1, glow, open, opacity = 1 }) => {
  const W = w;
  const H = w * 0.66;
  const l = -W / 2;
  const t = -H / 2;
  const flapY = interpolate(open, [0, 1], [1, -1], clampX); // y-scale of the flap about the top edge
  const half = interpolate(open, [0, 1], [0, W * 0.42], clampX);
  const sealO = interpolate(open, [0, 0.7, 1], [1, 1, 0.85], clampX);
  const noteRise = interpolate(open, [0.25, 1], [0, H * 0.78], clampX);
  const sealR = W * 0.11;
  const sealFill = open > 0 ? color.danger : color.accent;
  const flap = (
    <g transform={`translate(0 ${t}) scale(1 ${flapY}) translate(0 ${-t})`}>
      <path d={`M ${l} ${t} L 0 ${t + H * 0.55} L ${-l} ${t} Z`} fill={color.bgRaised} stroke={color.text} strokeWidth={3} strokeLinejoin="round" />
    </g>
  );
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity }} width={1080} height={1920}>
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        {/* flap behind everything once it has flipped up (open ≥ 0.5) */}
        {open >= 0.5 ? flap : null}
        {/* note (behind the front panel, in front of the opened flap) */}
        {open > 0.25 ? (
          <g transform={`translate(0 ${-noteRise})`}>
            <rect x={l + W * 0.12} y={t + H * 0.08} width={W * 0.76} height={H * 0.8} rx={8} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={2} />
            {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={l + W * 0.24 + i * W * 0.1} cy={t + H * 0.22} r={W * 0.03} fill={color.text} />)}
          </g>
        ) : null}
        <rect x={l} y={t} width={W} height={H} rx={10} fill={color.bgRaised2} stroke={color.text} strokeWidth={3} />
        <path d={`M ${l + 4} ${t + H - 4} L 0 ${t + H * 0.45} L ${-l - 4} ${t + H - 4}`} fill="none" stroke={color.borderStrong} strokeWidth={2} />
        {open < 0.5 ? flap : null}
        {/* seal: glow halo, then the wax disc; on open it splits in two halves */}
        <circle cx={0} cy={t + H * 0.55} r={sealR * (1.6 + 0.5 * glow)} fill={color.accent} opacity={0.18 * glow * sealO * (open > 0 ? 0 : 1)} />
        <g opacity={sealO}>
          <path d={`M ${-half} ${t + H * 0.55 - sealR} A ${sealR} ${sealR} 0 0 0 ${-half} ${t + H * 0.55 + sealR} Z`} fill={sealFill} />
          <path d={`M ${half} ${t + H * 0.55 - sealR} A ${sealR} ${sealR} 0 0 1 ${half} ${t + H * 0.55 + sealR} Z`} fill={sealFill} />
        </g>
      </g>
    </svg>
  );
};

// ── phone / Wi-Fi / router / cables (shot B world) ─────────────────────────────────────────────────────────────

export const PHONE = { x: 320, y: 120, w: 440, h: 880 } as const;
export const WIFI_ANCHOR = { x: 540, y: 1235 } as const;
export const ROUTER = { x: 280, y: 1485, w: 520, h: 150 } as const;
export const ROUTER_ANCHOR = { x: ROUTER.x + ROUTER.w / 2, y: ROUTER.y + ROUTER.h / 2 } as const;
export const BOX = { x: 700, y: 2150, w: 200, h: 240 } as const;
export const BOX_ANCHOR = { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 } as const;
/** Cable polyline from the router to the street cabinet and on out of frame (world px). */
export const CABLE: readonly { x: number; y: number }[] = [
  { x: 540, y: 1635 }, { x: 540, y: 1840 }, { x: 800, y: 1960 }, { x: 800, y: BOX.y },
];
export const CABLE_OUT: readonly { x: number; y: number }[] = [
  { x: 800, y: BOX.y + BOX.h }, { x: 800, y: 2900 },
];

/** Phone with a login form: title "Log in", an empty field, a password field filling with `dots` (0..8) dots. */
export const Phone: React.FC<{ dots: number; press: number }> = ({ dots, press }) => {
  const p = PHONE;
  const sx = p.x + 24;
  const sw = p.w - 48;
  const field = (y: number, children?: React.ReactNode, active = false) => (
    <div style={{ position: "absolute", left: sx + 28, top: y, width: sw - 56, height: 84, borderRadius: radius.pill, background: color.bgRaised2, border: `2px solid ${active ? color.borderStrong : color.border}`, boxSizing: "border-box", display: "flex", alignItems: "center", paddingLeft: 24 }}>
      {children}
    </div>
  );
  const n = Math.max(0, Math.min(8, Math.floor(dots)));
  return (
    <div style={{ position: "absolute", left: 0, top: 0 }}>
      <div style={{ position: "absolute", left: p.x, top: p.y, width: p.w, height: p.h, borderRadius: 64, background: color.bgRaised, border: `3px solid ${color.borderStrong}`, boxSizing: "border-box" }} />
      <div style={{ position: "absolute", left: sx, top: p.y + 24, width: sw, height: p.h - 48, borderRadius: 44, background: color.bg }} />
      <div style={{ position: "absolute", left: p.x + p.w / 2 - 60, top: p.y + 44, width: 120, height: 30, borderRadius: 15, background: color.bgRaised }} />
      <div style={{ position: "absolute", left: sx + 28, top: p.y + 170, fontFamily: font.sans, fontWeight: type.cardTitle.weight, fontSize: 52, color: color.text, whiteSpace: "pre" }}>Log in</div>
      {field(p.y + 280, <div style={{ width: 180, height: 22, borderRadius: 11, background: color.textFaint }} />)}
      {field(p.y + 392, <div style={{ display: "flex", gap: 14 }}>{Array.from({ length: n }, (_, i) => <div key={i} style={{ width: 20, height: 20, borderRadius: 10, background: color.text }} />)}</div>, n > 0 && n < 8)}
      <div style={{ position: "absolute", left: sx + 28, top: p.y + 530, width: sw - 56, height: 92, borderRadius: radius.pill, background: color.accent, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: font.sans, fontWeight: 600, fontSize: 38, color: color.accentInk, transform: `scale(${1 - 0.05 * press})` }}>Log in</div>
    </div>
  );
};

/** Wi-Fi symbol (three arcs + dot) centred on WIFI_ANCHOR; `hit` 0..1 lights it accent. */
export const WifiArcs: React.FC<{ hit: number }> = ({ hit }) => {
  const c = interpolateColors(hit, [0, 1], [color.textDim, color.accent]);
  const { x, y } = WIFI_ANCHOR;
  const arc = (r: number) => `M ${x - r * 0.8} ${y - r * 0.6} A ${r} ${r} 0 0 1 ${x + r * 0.8} ${y - r * 0.6}`;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
      {[60, 110, 160].map((r) => <path key={r} d={arc(r)} transform={`translate(0 ${r * 0.6})`} fill="none" stroke={c} strokeWidth={12} strokeLinecap="round" />)}
      <circle cx={x} cy={y + 36} r={12} fill={c} />
    </svg>
  );
};

/** Home router box with two antennas and 4 status LEDs; `hit` 0..1 blinks the LEDs accent. */
export const Router: React.FC<{ hit: number; frame: number }> = ({ hit, frame }) => {
  const r = ROUTER;
  const blink = hit > 0 ? 0.5 + 0.5 * Math.cos((Math.floor(frame) / 3) * Math.PI) : 0;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
      <line x1={r.x + 90} y1={r.y} x2={r.x + 60} y2={r.y - 120} stroke={color.borderStrong} strokeWidth={12} strokeLinecap="round" />
      <line x1={r.x + r.w - 90} y1={r.y} x2={r.x + r.w - 60} y2={r.y - 120} stroke={color.borderStrong} strokeWidth={12} strokeLinecap="round" />
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={28} fill={color.bgRaised} stroke={color.borderStrong} strokeWidth={3} />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={r.x + 110 + i * 70} cy={r.y + r.h / 2} r={12} fill={hit > 0 && (i + Math.floor(frame / 3)) % 2 === 0 ? color.accent : color.textDim} opacity={hit > 0 ? 0.6 + 0.4 * blink : 0.5} />
      ))}
      <rect x={r.x + r.w - 150} y={r.y + r.h / 2 - 8} width={90} height={16} rx={8} fill={color.bgRaised2} />
    </svg>
  );
};

const poly = (pts: readonly { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");

/** Cable run (router → street cabinet → on) with the cabinet; `lit` 0..1 = how far the accent has run along the cable. */
export const CableRun: React.FC<{ lit: number; boxHit: number }> = ({ lit, boxHit }) => {
  const d = poly(CABLE);
  const len = CABLE.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - CABLE[i].x, p.y - CABLE[i].y), 0);
  const b = BOX;
  const boxStroke = interpolateColors(boxHit, [0, 1], [color.borderStrong, color.accent]);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
      <path d={d} fill="none" stroke={color.bgRaised2} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color.borderStrong} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color.accent} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${len}`} strokeDashoffset={len * (1 - lit)} opacity={0.85} />
      <path d={poly(CABLE_OUT)} fill="none" stroke={color.borderStrong} strokeWidth={4} strokeLinecap="round" />
      <path d={`M ${b.x + b.w} ${b.y + 80} L 1300 ${b.y + 80}`} fill="none" stroke={color.borderStrong} strokeWidth={4} strokeLinecap="round" />
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={14} fill={color.bgRaised} stroke={boxStroke} strokeWidth={4} />
      {[0, 1, 2].map((i) => <rect key={i} x={b.x + 30} y={b.y + 40 + i * 56} width={b.w - 60} height={14} rx={7} fill={color.bgRaised2} />)}
    </svg>
  );
};
