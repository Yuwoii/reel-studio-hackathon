// D1-hook: the first ~15 s of the TLS-termination reel (R1 r2 tls-hook-15s.json, L01–L04) as a real-object proof.
//   Shot A (L01–L03, one world): browser with the URL bar in its editing state → snap zoom to the "s" of https (or the
//   padlock, variant "lock") → a sealed envelope peels off the URL bar and travels to a building → seal pops just
//   inside the door on "always".
//   Shot B (L04, hard cut): phone login (password dots) → Wi-Fi → router → cables to a street cabinet; the same sealed
//   envelope hops across the three stops, each labelled with its spoken word.
// Captions: the v2 SubtitleCard (W7.3 active word white + bold, one keyword per line) driven by the edge-tts word
// boundaries in timing.<variant>.json. Header/footer/vignette = v2 layers. Muted: audio is muxed after the render.
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { type DisplayPhrase, splitDisplay, type Timeline, type TimelineWord } from "../../../src/v2/timeline";
import { useV2Fonts } from "../../v2/fonts";
import { Footer } from "../../v2/layers/Footer";
import { HeaderBar } from "../../v2/layers/HeaderBar";
import { SubtitleCard } from "../../v2/layers/SubtitleCard";
import { Vignette } from "../../v2/layers/Vignette";
import { clampX, enterProgress } from "../../v2/motion";
import { blurSamples, camera, color, FPS, layout } from "../../v2/theme";
import { WeightedMotionBlur } from "../../v2/WeightedMotionBlur";
import type { HeaderTrack } from "../../v2/world";
import { type Cam, toScreen, worldTransform } from "../camera";
import { AnchorRing, LabelPill } from "../overlays";
import {
  BLD, BOX_ANCHOR, Building, CABLE, CableRun, DOOR_ANCHOR, Envelope, HB, HookBrowser, hookAnchors, type HookVariant,
  Phone, Router, ROUTER, ROUTER_ANCHOR, WIFI_ANCHOR, WifiArcs,
} from "./devices";
import timingLock from "./timing.lock.json";
import timingS from "./timing.s.json";

export type HookProps = {
  variant: HookVariant;
  /** Debug: draw no captions (cover-style frame). */
  noCaptions?: boolean;
};
export const HOOK_DEFAULTS: HookProps = { variant: "s" };

interface TimingWord { text: string; startMs: number; endMs: number }
interface TimingLine { id: string; text: string; keywordIndex: number; keywordColor: string; words: TimingWord[] }
interface Timing { variant: string; durationF: number; audioMs: number; lines: TimingLine[] }

export const TIMINGS: Record<HookVariant, Timing> = { s: timingS as Timing, lock: timingLock as Timing };
export const HOOK_DURATION_F = Math.max(timingS.durationF, timingLock.durationF);

const msF = (ms: number) => Math.round((ms * FPS) / 1000);

/** Minimal v2 Timeline (words + display phrases only — all SubtitleCard reads), same split/swap rules as resolveTimeline. */
export function captionTimeline(t: Timing): Timeline {
  const words: TimelineWord[] = [];
  const display: DisplayPhrase[] = [];
  t.lines.forEach((l, bi) => {
    const g0 = words.length;
    l.words.forEach((w, i) => words.push({ text: w.text, beatIndex: bi, index: i, globalIndex: g0 + i, startMs: w.startMs, endMs: w.endMs, startF: msF(w.startMs), endF: msF(w.endMs), isKeyword: i === l.keywordIndex }));
    const sizes = splitDisplay(l.words.map((w) => w.text), l.keywordIndex, 1);
    let p = 0;
    sizes.forEach((n, k) => {
      const ws = words.slice(g0 + p, g0 + p + n);
      const text = ws.map((w) => w.text).join(" ");
      const kw = l.keywordIndex >= p && l.keywordIndex < p + n ? g0 + l.keywordIndex : null;
      display.push({ id: `${l.id}.${k}`, beatId: l.id, beatIndex: bi, text, firstWord: g0 + p, lastWord: g0 + p + n - 1, wordCount: n, startF: ws[0].startF, endF: ws[n - 1].endF, showF: 0, hideF: 0, keywordWord: kw, keywordColor: l.keywordColor === "danger" ? "danger" : "accent", widthPx: text.length * 24 });
      p += n;
    });
  });
  display.forEach((d, i) => (d.showF = i === 0 ? 0 : Math.max(display[i - 1].showF + 1, d.startF - 3)));
  display.forEach((d, i) => (d.hideF = i + 1 < display.length ? display[i + 1].showF : t.durationF));
  return { words, displayPhrases: display } as unknown as Timeline;
}

/** Frame marks from the word boundaries (so both variants keep picture locked to the voice). */
export function marks(t: Timing) {
  const L = t.lines;
  const w = (li: number, wi: number) => msF(L[li].words[wi].startMs);
  const wEnd = (li: number, wi: number) => msF(L[li].words[wi < 0 ? L[li].words.length + wi : wi].endMs);
  const idx = (li: number, word: string) => L[li].words.findIndex((x) => x.text.replace(/[^A-Za-z-]/g, "") === word);
  return {
    hookKw: w(0, L[0].keywordIndex),
    l1End: wEnd(0, -1),
    l2: w(1, 0),
    sealed: w(1, idx(1, "sealed")),
    l2End: wEnd(1, -1),
    l3: w(2, 0),
    always: w(2, idx(2, "always")),
    l3End: wEnd(2, -1),
    l4: w(3, 0),
    password: w(3, idx(3, "password")),
    hops: w(3, idx(3, "hops")),
    wifi: w(3, idx(3, "Wi-Fi")),
    routers: w(3, idx(3, "routers")),
    cables: w(3, idx(3, "cables")),
    own: w(3, idx(3, "own")),
    l4End: wEnd(3, -1),
  };
}
export type Marks = ReturnType<typeof marks>;

// ── camera (pure function of the frame; world px of the shot) ──────────────────────────────────────────────────

type Ease = "bible" | "longPan" | "linear" | "out";
interface Key { f: number; zoom: number; cx: number; cy: number; ease?: Ease }
const EASE: Record<Ease, (t: number) => number> = {
  bible: Easing.bezier(...camera.ease.bible),
  longPan: Easing.bezier(...camera.ease.longPan),
  linear: (t) => t,
  out: Easing.bezier(0.16, 1, 0.3, 1),
};
function camAt(keys: readonly Key[], frame: number): Cam {
  if (frame <= keys[0].f) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (frame <= b.f) {
      const t = EASE[b.ease ?? "bible"]((frame - a.f) / Math.max(1, b.f - a.f));
      // zoom interpolates geometrically so a 3× snap-zoom feels even
      const zoom = a.zoom * Math.pow(b.zoom / a.zoom, t);
      return { zoom, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
    }
  }
  return keys[keys.length - 1];
}
const drift = (k: Key, f: number): Key => ({ f, zoom: k.zoom * (1 + camera.holdDriftZoom), cx: k.cx, cy: k.cy, ease: "linear" });

export function shotAKeys(m: Marks, v: HookVariant): Key[] {
  const A = hookAnchors(v);
  const target = v === "lock" ? A.lock : A.schemeS;
  // f0: the URL bar already fills the upper stage (first concrete image at frame 0), slow push toward the scheme
  const k0: Key = { f: 0, zoom: 1.3, cx: 420, cy: 430 };
  const k1: Key = { f: m.hookKw - 1, zoom: 1.6, cx: 330, cy: 330, ease: "linear" };
  const k2: Key = { f: m.hookKw + 10, zoom: 3.2, cx: target.x + 25, cy: target.y + 24, ease: "out" };
  const k3 = drift(k2, m.l2);
  const k4: Key = { f: m.l2 + 30, zoom: 0.42, cx: 480, cy: 1250, ease: "longPan" };
  const k5 = drift(k4, m.l3 - 4);
  const k6: Key = { f: m.always, zoom: 1.15, cx: DOOR_ANCHOR.x, cy: DOOR_ANCHOR.y - 90, ease: "bible" };
  const k7 = drift(k6, m.l4 - 2);
  return [k0, k1, k2, k3, k4, k5, k6, k7];
}

export function shotBKeys(m: Marks): Key[] {
  const k0: Key = { f: m.l4 - 2, zoom: 1.05, cx: 540, cy: 600 };
  const k1 = drift(k0, m.hops);
  const k2: Key = { f: m.wifi + 4, zoom: 0.92, cx: 540, cy: 1060, ease: "bible" };
  const k3: Key = { f: m.routers + 4, zoom: 0.88, cx: 560, cy: 1560, ease: "bible" };
  const k4: Key = { f: m.cables + 8, zoom: 0.85, cx: 690, cy: 2000, ease: "bible" };
  const k5 = drift(k4, HOOK_DURATION_F);
  return [k0, k1, k2, k3, k4, k5];
}

/** Fastest screen motion (px/f) of the stage corners between f−1 and f (blur sample count input, like v2). */
function camSpeed(keys: readonly Key[], f: number): number {
  if (f < 1) return 0;
  const a = camAt(keys, f - 1);
  const b = camAt(keys, f);
  let v = 0;
  for (const [sx, sy] of [[0, layout.stage.top], [1080, layout.stage.top], [0, layout.stage.bottom], [1080, layout.stage.bottom], [540, 855]]) {
    const wx = (sx - layout.stage.cx) / a.zoom + a.cx;
    const wy = (sy - layout.stage.cy) / a.zoom + a.cy;
    const p = toScreen(b, wx, wy);
    v = Math.max(v, Math.hypot(p.x - sx, p.y - sy));
  }
  return v;
}

// ── envelope path (shot A, world px): cubic from the URL-bar anchor out to the right and down to the door ─────

function bez(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

// ── shot A world ──────────────────────────────────────────────────────────────────────────────────────────────────

const ShotA: React.FC<{ v: HookVariant; m: Marks }> = ({ v, m }) => {
  const frame = useCurrentFrame();
  const cam = camAt(shotAKeys(m, v), frame);
  const accent = interpolate(frame, [m.hookKw, m.hookKw + 6], [0, 1], clampX);
  const doorGlow = interpolate(frame, [m.l3 - 6, m.always], [0, 1], clampX);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: worldTransform(cam) }}>
      <HookBrowser frame={frame} variant={v} host="example.com" sAccent={v === "s" ? accent : 0} lockAccent={v === "lock" ? accent : 0} />
      <Building doorGlow={doorGlow} />
    </div>
  );
};

/** Screen-space overlays of shot A (ring, envelope + its trail): same camera, own pixel sizes. */
const ShotAOverlay: React.FC<{ v: HookVariant; m: Marks }> = ({ v, m }) => {
  const frame = useCurrentFrame();
  const cam = camAt(shotAKeys(m, v), frame);
  const A = hookAnchors(v);
  const anchor = v === "lock" ? A.lock : A.schemeS;
  const s = (p: { x: number; y: number }) => toScreen(cam, p.x, p.y);
  const P0 = anchor;
  const P1 = { x: 1250, y: 260 };
  const P2 = { x: 1150, y: 1900 };
  const P3 = DOOR_ANCHOR;
  const t0 = m.l2 + 6;
  const t1 = m.l3 - 2;
  const p = interpolate(frame, [t0, t1], [0, 1], { ...clampX, easing: Easing.bezier(...camera.ease.bible) });
  const peel = enterProgress(frame, m.l2);
  const pos = bez(P0, P1, P2, P3, p);
  const sp = s(pos);
  const trail: string[] = [];
  if (p > 0) for (let i = 0; i <= 48; i++) {
    const q = s(bez(P0, P1, P2, P3, (p * i) / 48));
    trail.push(`${i ? "L" : "M"} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
  }
  const sealGlow = 0.55 + 0.45 * interpolate(frame, [m.sealed, m.sealed + 5, m.sealed + 30], [0, 1, 0.4], clampX);
  const open = interpolate(frame, [m.always, m.always + 9], [0, 1], { ...clampX, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const ringR = v === "lock" ? 64 : 58;
  const envW = interpolate(p, [0, 1], [190, 150], clampX);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AnchorRing at={s({ x: anchor.x + 1, y: anchor.y + 4 })} r={ringR * Math.min(1, cam.zoom / 3.2) + 14} frame={frame} enterF={m.hookKw + 4} exitF={m.l2 - 2} />
      {frame >= m.l2 ? (
        <>
          <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1080} height={1920}>
            <path d={trail.join(" ")} fill="none" stroke={color.accent} strokeWidth={4} strokeDasharray="14 12" strokeLinecap="round" opacity={0.55} />
          </svg>
          <Envelope x={sp.x} y={sp.y - (1 - peel) * 30 - 40 * open} w={envW} scale={(0.4 + 0.6 * peel) * (1 + 0.5 * open)} glow={sealGlow} open={open} opacity={Math.min(1, peel * 1.4)} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

// ── shot B world ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Packet path (world px) with the frame it reaches each stop: phone → Wi-Fi → router → cable → cabinet → out. */
function packetAt(m: Marks, f: number): { x: number; y: number; on: boolean } {
  const pts: { f: number; x: number; y: number; hop?: boolean }[] = [
    { f: m.hops, x: 540, y: 880 },
    { f: m.wifi, x: WIFI_ANCHOR.x, y: WIFI_ANCHOR.y - 60, hop: true },
    { f: m.routers, x: ROUTER_ANCHOR.x, y: ROUTER.y - 30, hop: true },
    { f: m.routers + 8, x: CABLE[1].x, y: CABLE[1].y },
    { f: m.routers + 14, x: CABLE[2].x, y: CABLE[2].y },
    { f: m.cables, x: BOX_ANCHOR.x, y: BOX_ANCHOR.y - 140 },
    { f: m.own + 10, x: BOX_ANCHOR.x, y: 2700 },
  ];
  if (f < pts[0].f) return { ...pts[0], on: false };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (f <= b.f) {
      const t = Easing.bezier(...camera.ease.bible)((f - a.f) / Math.max(1, b.f - a.f));
      const bulge = b.hop ? Math.sin(Math.PI * t) * 110 : 0; // hop: an arc to the side
      return { x: a.x + (b.x - a.x) * t + bulge, y: a.y + (b.y - a.y) * t, on: true };
    }
  }
  const z = pts[pts.length - 1];
  return { x: z.x, y: z.y, on: true };
}

const ShotB: React.FC<{ m: Marks }> = ({ m }) => {
  const frame = useCurrentFrame();
  const cam = camAt(shotBKeys(m), frame);
  const dots = interpolate(frame, [m.password - 6, m.password + 12], [0, 8], clampX);
  const press = interpolate(frame, [m.hops - 6, m.hops - 2, m.hops + 3], [0, 1, 0], clampX);
  const wifiHit = interpolate(frame, [m.wifi - 3, m.wifi + 2, m.wifi + 30], [0, 1, 0.35], clampX);
  const routerHit = frame >= m.routers - 2 ? 1 : 0;
  const lit = interpolate(frame, [m.routers, m.cables], [0, 1], clampX);
  const boxHit = interpolate(frame, [m.cables - 2, m.cables + 3], [0, 1], clampX);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: worldTransform(cam) }}>
      <Phone dots={dots} press={press} />
      <WifiArcs hit={wifiHit} />
      <CableRun lit={lit} boxHit={boxHit} />
      <Router hit={routerHit} frame={frame} />
    </div>
  );
};

const ShotBOverlay: React.FC<{ m: Marks }> = ({ m }) => {
  const frame = useCurrentFrame();
  const cam = camAt(shotBKeys(m), frame);
  const s = (p: { x: number; y: number }) => toScreen(cam, p.x, p.y);
  const pk = packetAt(m, frame);
  const sp = s(pk);
  const peel = enterProgress(frame, m.hops - 2);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {pk.on ? <Envelope x={sp.x} y={sp.y} w={130} scale={0.5 + 0.5 * peel} glow={0.8} open={0} opacity={Math.min(1, peel * 1.4)} /> : null}
      <LabelPill at={s({ x: WIFI_ANCHOR.x + 170, y: WIFI_ANCHOR.y + 10 })} text="Wi-Fi" offset={{ x: 170, y: 0 }} frame={frame} enterF={m.wifi} exitF={m.routers + 12} />
      <LabelPill at={s({ x: ROUTER.x + ROUTER.w, y: ROUTER_ANCHOR.y })} text="router" offset={{ x: 0, y: 150 }} frame={frame} enterF={m.routers} exitF={m.own + 6} />
      <LabelPill at={s({ x: CABLE[2].x - 130, y: CABLE[1].y + 60 })} text="cables" offset={{ x: -190, y: 120 }} frame={frame} enterF={m.cables} />
    </AbsoluteFill>
  );
};

// ── composition ──────────────────────────────────────────────────────────────────────────────────────────────────

const HEADER: HeaderTrack = { right: [{ f: 0, text: "HTTPS" }], dot: [{ f: 0, dot: "dim" }], pulses: [], scrambles: [] };

export const HookTLS: React.FC<HookProps> = ({ variant, noCaptions }) => {
  const ready = useV2Fonts();
  const frame = useCurrentFrame();
  const t = TIMINGS[variant] ?? TIMINGS.s;
  const m = React.useMemo(() => marks(t), [t]);
  const tl = React.useMemo(() => captionTimeline(t), [t]);
  const cut = m.l4 - 2;
  const inA = frame < cut;
  const keys = inA ? shotAKeys(m, variant) : shotBKeys(m);
  const n = blurSamples(camSpeed(keys, Math.floor(frame)));
  const world = inA ? <ShotA v={variant} m={m} /> : <ShotB m={m} />;
  const overlay = inA ? <ShotAOverlay v={variant} m={m} /> : <ShotBOverlay m={m} />;
  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: layout.stage.bottom, overflow: "hidden" }}>
        {n > 1 && frame !== cut ? <WeightedMotionBlur samples={n}>{world}{overlay}</WeightedMotionBlur> : <>{world}{overlay}</>}
      </div>
      <Footer />
      <HeaderBar series="HOW IT WORKS" codename="TLS-TERM" track={HEADER} />
      {noCaptions ? null : <SubtitleCard tl={tl} style="activeWordKeyword" ready={ready} />}
      <Vignette />
    </AbsoluteFill>
  );
};
