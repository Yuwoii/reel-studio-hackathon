// Pure scene model for the Explainer: instance tracks, header track and field marks, all derived from the ONE
// resolved timeline (src/v2/timeline.ts). No React here; layers and component slots read these.
import type { Storyboard } from "../../src/schema/storyboard.v2";
import type { TrackEvent } from "../../src/v2/components-meta/_lookup";
import { instanceBox, type Box, type FootprintLookup, type Timeline } from "../../src/v2/timeline";
import { header as headerCfg } from "./theme";

export type { TrackEvent };

export type HeaderDotT = "dim" | "danger" | "accent";

export interface InstanceTrack {
  id: string;
  /** First `enter` action frame; null = present from frame 0 (no enter action). */
  enterF: number | null;
  exitF: number | null;
  states: { f: number; state: string }[];
  pulses: number[];
  focus: number[];
  marks: { f: number; state?: string }[];
  countUps: number[];
  scrambles: number[];
  drawOns: number[];
  glitches: number[];
  /** Every resolved action on this instance in frame order, with its state/props (W2 component contract). */
  events: TrackEvent[];
  /** World box (footprint × scale), null when unknown. */
  box: Box | null;
}

/**
 * One instance track from its resolved actions (frame order is restored here). Shared by the Explainer (events from
 * resolveTimeline) and the V2Gallery (events from a component fixture), so both render a component identically.
 */
export function buildTrack(id: string, box: Box | null, events: readonly TrackEvent[]): InstanceTrack {
  const t: InstanceTrack = { id, enterF: null, exitF: null, states: [], pulses: [], focus: [], marks: [], countUps: [], scrambles: [], drawOns: [], glitches: [], events: [], box };
  // stable sort: same-frame actions keep their storyboard order
  t.events = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.f - b.e.f || a.i - b.i).map(({ e }) => e);
  for (const e of t.events) {
    switch (e.do) {
      case "enter":
        if (t.enterF === null || e.f < t.enterF) t.enterF = e.f;
        break;
      case "exit":
        if (t.exitF === null || e.f < t.exitF) t.exitF = e.f;
        break;
      case "state":
        if (e.state) t.states.push({ f: e.f, state: e.state });
        break;
      case "pulse":
        t.pulses.push(e.f);
        break;
      case "focus":
        t.focus.push(e.f);
        break;
      case "mark":
        t.marks.push({ f: e.f, state: e.state });
        break;
      case "countUp":
        t.countUps.push(e.f);
        break;
      case "scramble":
        t.scrambles.push(e.f);
        break;
      case "drawOn":
        t.drawOns.push(e.f);
        break;
      case "glitch":
        t.glitches.push(e.f);
        break;
    }
  }
  return t;
}

export function instanceTracks(sb: Storyboard, tl: Timeline, lib: FootprintLookup): Map<string, InstanceTrack> {
  const evs = new Map<string, TrackEvent[]>(sb.world.map((inst) => [inst.id, []]));
  for (const e of tl.events) {
    if (e.kind !== "action") continue;
    evs.get(e.target)?.push({ f: e.frame, do: e.do, state: e.state, props: e.props });
  }
  const m = new Map<string, InstanceTrack>();
  for (const inst of sb.world) m.set(inst.id, buildTrack(inst.id, instanceBox(inst, lib), evs.get(inst.id) ?? []));
  return m;
}

// ── header ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface HeaderTrack {
  /** Right-label changes, first entry at frame 0 = storyboard headerRight. */
  right: { f: number; text: string }[];
  /** Dot colour changes; an `accent` entry is followed by an automatic revert (≤ 1 s, amendments §3b). */
  dot: { f: number; dot: HeaderDotT }[];
  pulses: number[];
  scrambles: number[];
}

export function headerTrack(sb: Storyboard, tl: Timeline): HeaderTrack {
  const right: HeaderTrack["right"] = [{ f: 0, text: sb.headerRight }];
  const dotRaw: HeaderTrack["dot"] = [{ f: 0, dot: sb.headerDot }];
  const pulses: number[] = [];
  const scrambles: number[] = [];
  for (const e of tl.events) {
    if (e.kind === "header") {
      if (e.right !== undefined) right.push({ f: e.frame, text: e.right });
      if (e.dot !== undefined) dotRaw.push({ f: e.frame, dot: e.dot });
    } else if (e.kind === "action" && e.target === "header") {
      if (e.do === "pulse") pulses.push(e.frame);
      else if (e.do === "scramble") scrambles.push(e.frame);
      else if (e.do === "state" && (e.state === "dim" || e.state === "danger" || e.state === "accent")) dotRaw.push({ f: e.frame, dot: e.state });
    }
  }
  right.sort((a, b) => a.f - b.f);
  dotRaw.sort((a, b) => a.f - b.f);
  // accent is a ≤1 s resolution flash: revert to the last non-accent dot (dim if none) unless something else follows sooner
  const maxF = Math.round(headerCfg.accentDotMaxS * tl.fps);
  const dot: HeaderTrack["dot"] = [];
  let base: HeaderDotT = "dim";
  dotRaw.forEach((d, i) => {
    dot.push(d);
    if (d.dot !== "accent") base = d.dot;
    else {
      const next = dotRaw[i + 1];
      const revertF = d.f + maxF;
      if (!next || next.f > revertF) dot.push({ f: revertF, dot: base === "danger" ? "dim" : base });
    }
  });
  return { right, dot, pulses: pulses.sort((a, b) => a - b), scrambles: scrambles.sort((a, b) => a - b) };
}

// ── data field marks ────────────────────────────────────────────────────────────────────────────────────────

export interface FieldMark {
  f: number;
  /** true = clear every earlier mark (state "clear"). */
  clear: boolean;
  tone: "danger" | "accent";
  /** Number of rows to mark (1–8, default 3). */
  rows: number;
  /** Explicit field row offsets relative to the viewport centre row (optional). */
  offsets?: number[];
  /** Fade-out start: the end of the mark's beat, or null with props.hold (kept until a "clear"). */
  until: number | null;
  seed: string;
}

export function fieldMarks(sb: Storyboard, tl: Timeline): FieldMark[] {
  const out: FieldMark[] = [];
  for (const e of tl.events) {
    if (e.kind !== "action" || e.target !== "datafield" || e.do !== "mark") continue;
    const p = (e.props ?? {}) as Record<string, unknown>;
    const beat = sb.beats[e.beatIndex];
    const tone = p.tone === "danger" || p.tone === "accent" ? p.tone : (beat?.keywordColor ?? "danger");
    const rowsRaw = typeof p.rows === "number" ? p.rows : 3;
    const offsets = Array.isArray(p.offsets) ? p.offsets.filter((x): x is number => typeof x === "number" && Number.isInteger(x)).slice(0, 8) : undefined;
    // R7 restraint: a mark is part of its beat (lime ≤ one region per beat) unless it is explicitly held
    const until = p.hold === true ? null : (tl.beats[e.beatIndex]?.endF ?? null);
    out.push({ f: e.frame, clear: e.state === "clear" || p.clear === true, tone, rows: Math.max(1, Math.min(8, Math.round(rowsRaw))), offsets, until, seed: `${e.beatId}:${e.index}` });
  }
  return out.sort((a, b) => a.f - b.f);
}

/** World extent the field must cover: all stations and instance boxes plus a margin. */
export function worldExtent(sb: Storyboard, lib: FootprintLookup, margin = 900): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (b: Box) => {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  };
  sb.stations.forEach(add);
  for (const inst of sb.world) {
    const b = instanceBox(inst, lib);
    if (b) add(b);
  }
  if (!Number.isFinite(x0)) return { x0: -margin, y0: -margin, x1: 1080 + margin, y1: 1920 + margin };
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
}
