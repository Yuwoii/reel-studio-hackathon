// WebsiteCluster renderer (meta: src/v3/components-meta/WebsiteCluster.ts). Drawn in the ServerRack's metal look so
// the front server and the computers read as the same family of machines.
import React from "react";
import { interpolate } from "remotion";
import { busY, computerBox, frontOutlet, meta, WC, type WebsiteClusterPropsT } from "../../../src/v3/components-meta/WebsiteCluster";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, flash } from "../../v2/motion";
import { color, font } from "../../v2/theme";

const Meter: React.FC<{ x: number; y: number; w: number; h: number; level: number; hot: boolean; horizontal?: boolean }> = ({ x, y, w, h, level, hot, horizontal }) => {
  const L = Math.max(0, Math.min(1, level));
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) / 2} fill={color.bg} stroke={color.borderStrong} strokeWidth={2} />
      {horizontal ? (
        <rect x={x + 3} y={y + 3} width={Math.max(0, (w - 6) * L)} height={h - 6} rx={(h - 6) / 2} fill={hot ? color.accent : color.textDim} />
      ) : (
        <rect x={x + 3} y={y + 3 + (h - 6) * (1 - L)} width={w - 6} height={Math.max(0, (h - 6) * L)} rx={(w - 6) / 2} fill={hot ? color.accent : color.textDim} />
      )}
    </g>
  );
};

/** A simple tower computer: case, two drive slots, vent dots, a power light. */
const Computer: React.FC<{ x: number; y: number; w: number; h: number; lit: boolean; gid: string; on: boolean }> = ({ x, y, w, h, lit, gid, on }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={14} fill={`url(#${gid})`} stroke={lit ? color.accent : color.borderStrong} strokeWidth={lit ? 4 : 2.5} />
    <line x1={x + 10} x2={x + w - 10} y1={y + 3} y2={y + 3} stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeLinecap="round" />
    {[0, 1].map((k) => <rect key={k} x={x + w * 0.14} y={y + 24 + k * 34} width={w * 0.72} height={22} rx={6} fill="#0f0f10" stroke={color.border} strokeWidth={2} />)}
    {Array.from({ length: 9 }, (_, k) => <circle key={k} cx={x + w * 0.3 + (k % 3) * w * 0.2} cy={y + h * 0.5 + Math.floor(k / 3) * 16} r={3} fill="#0c0c0d" />)}
    <circle cx={x + w / 2} cy={y + h - 26} r={7} fill={on ? color.accent : color.textDim} opacity={on ? 1 : 0.5} />
  </g>
);

const Render: React.FC<RenderProps<WebsiteClusterPropsT>> = ({ props: p, frame, state, last, id }) => {
  const sf = state.f;
  const split = state.name === "split" ? (sf === null ? 1 : interpolate(frame, [sf, sf + WC.splitF], [0, 1], clampX)) : 0;
  const hit = flash(frame, last("pulse"), 8);
  const O = WC.outline, F = WC.front;
  const gid = (n: string) => `wc-${n}-${id}`;
  const n = p.computers;
  const nameFs = 34;
  const name = p.name;
  const nameW = name.length * nameFs * 0.6 + 40;
  // the box (state "box") fades/shrinks away as the machines appear; the front server steps out from the row
  const boxO = 1 - split;
  const step = interpolate(split, [0.3, 1], [140, 0], clampX);
  const rowO = interpolate(split, [0.2, 0.8], [0, 1], clampX);
  const o = frontOutlet();
  const by = busY();
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={WC.w} height={WC.h}>
      <defs>
        <linearGradient id={gid("unit")} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2e2f32" /><stop offset="55%" stopColor="#222325" /><stop offset="100%" stopColor="#1a1a1c" /></linearGradient>
        <linearGradient id={gid("front")} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#36373b" /><stop offset="100%" stopColor="#1e1f21" /></linearGradient>
      </defs>
      {/* one-website outline (dashed) + name tag */}
      {p.outline || split < 1 ? (
        <rect x={O.x} y={O.y} width={O.w} height={O.h} rx={O.r} fill={boxO > 0 ? color.bgRaised : "none"} fillOpacity={boxO} stroke={split > 0.5 ? color.textDim : color.borderStrong} strokeWidth={3} strokeDasharray={split > 0.5 ? "18 12" : undefined} opacity={split > 0.5 && !p.outline ? 1 - split : 1} />
      ) : null}
      <g>
        <rect x={WC.name.x} y={WC.name.y} width={nameW} height={WC.name.h} rx={WC.name.h / 2} fill={color.bgRaised2} stroke={color.borderStrong} strokeWidth={2.5} />
        <text x={WC.name.x + nameW / 2} y={WC.name.y + WC.name.h / 2} dominantBaseline="central" textAnchor="middle" fontFamily={font.mono} fontWeight={600} fontSize={nameFs} fill={color.text}>{name}</text>
        {p.check ? (
          <g transform={`translate(${WC.name.x + nameW + 36} ${WC.name.y + WC.name.h / 2})`}>
            <circle r={26} fill={color.accent} />
            <path d="M -11 0 L -3 9 L 12 -9" fill="none" stroke={color.accentInk} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null}
      </g>
      {/* state "box": a page glyph in the middle of the single website box */}
      {boxO > 0 ? (
        <g opacity={boxO} transform={`translate(${O.x + O.w / 2} ${O.y + O.h / 2 + 30})`}>
          <rect x={-150} y={-110} width={300} height={220} rx={22} fill={color.bgRaised2} stroke={color.text} strokeWidth={3} />
          <rect x={-150} y={-110} width={300} height={44} rx={22} fill={color.borderStrong} />
          {[0, 1, 2].map((k) => <circle key={k} cx={-120 + k * 24} cy={-88} r={7} fill={color.textDim} />)}
          <rect x={-110} y={-40} width={220} height={22} rx={11} fill={color.textDim} />
          <rect x={-110} y={0} width={160} height={18} rx={9} fill={color.textFaint} />
          <rect x={-110} y={34} width={190} height={18} rx={9} fill={color.textFaint} />
        </g>
      ) : null}
      {split > 0 ? (
        <g opacity={rowO}>
          {/* inner lines: front server → bus → each computer */}
          <path d={`M ${o.x} ${o.y} L ${o.x + 70} ${o.y} L ${o.x + 70} ${by} L ${computerBox(n, n).x + computerBox(n, n).w / 2} ${by}`} fill="none" stroke={color.borderStrong} strokeWidth={4} strokeLinejoin="round" />
          {Array.from({ length: n }, (_, k) => {
            const b = computerBox(k + 1, n);
            const lit = p.active === k + 1;
            return <line key={k} x1={b.x + b.w / 2} x2={b.x + b.w / 2} y1={by} y2={b.y + b.h} stroke={lit ? color.accent : color.borderStrong} strokeWidth={lit ? 5 : 4} />;
          })}
          {p.active ? (() => {
            const b = computerBox(p.active, n);
            return <path d={`M ${o.x} ${o.y} L ${o.x + 70} ${o.y} L ${o.x + 70} ${by} L ${b.x + b.w / 2} ${by}`} fill="none" stroke={color.accent} strokeWidth={5} strokeLinejoin="round" />;
          })() : null}
          {Array.from({ length: n }, (_, k) => {
            const b = computerBox(k + 1, n);
            return (
              <g key={k}>
                <Computer x={b.x} y={b.y} w={b.w} h={b.h} lit={p.active === k + 1} gid={gid("unit")} on />
                {p.meters ? <Meter x={b.x + b.w * 0.15} y={b.y + b.h + 8} w={b.w * 0.7} h={24} level={p.backLoad} hot={p.backLoad > 0.6} horizontal /> : null}
              </g>
            );
          })}
        </g>
      ) : null}
      {split > 0 ? (
        <g opacity={interpolate(split, [0, 0.4], [0, 1], clampX)} transform={`translate(${step} 0)`}>
          {/* front server: wider and lighter than the row, accent strip on top, power light flashes on pulse */}
          <rect x={F.x} y={F.y} width={F.w} height={F.h} rx={20} fill={`url(#${gid("front")})`} stroke={color.text} strokeWidth={3.5} />
          <rect x={F.x + 16} y={F.y + 12} width={F.w - 32} height={8} rx={4} fill={color.accent} opacity={0.9} />
          <circle cx={F.x + 40} cy={F.y + 36} r={9 + 4 * hit} fill={color.accent} opacity={0.6 + 0.4 * hit} />
          {[0, 1, 2].map((k) => <rect key={k} x={F.x + F.w * 0.14} y={F.y + F.h * 0.52 + k * 38} width={F.w * 0.72} height={24} rx={7} fill="#0f0f10" stroke={color.border} strokeWidth={2} />)}
          {p.key ? (
            // key badge: a round tag with a drawn key (it holds the website's key)
            <g transform={`translate(${F.x + F.w / 2} ${F.y + F.h * 0.33})`}>
              <circle r={40} fill={color.bgRaised2} stroke={color.accent} strokeWidth={3} />
              <circle cx={-14} cy={0} r={12} fill="none" stroke={color.accent} strokeWidth={6} />
              <path d="M -2 0 L 24 0 M 16 0 L 16 10 M 24 0 L 24 12" fill="none" stroke={color.accent} strokeWidth={6} strokeLinecap="round" />
            </g>
          ) : null}
          {p.meters ? <Meter x={F.x + F.w + 18} y={F.y + F.h - WC.meterH} w={24} h={WC.meterH} level={p.frontLoad} hot={p.frontLoad > 0.6} /> : null}
        </g>
      ) : null}
    </svg>
  );
};

export const WebsiteCluster = defineComponent({ ...meta, Render });
