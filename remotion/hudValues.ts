// HUD value timeline. Each HUD starts at config.hud[].initial; a beat's stateChange tweens from→to over that beat
// and the end value carries into later beats. Pure → unit-tested in test/remotion-hud.test.ts.

import type { Config, Script } from "../src/schema/index.js";

export interface HudSpan {
  from: number;
  to: number;
  /** true if this beat has an explicit stateChange for the HUD (animate + flash). */
  changes: boolean;
}

/** spans[beatIndex][hudId] */
export function hudSpans(script: Pick<Script, "beats">, config: Pick<Config, "hud">): Record<string, HudSpan>[] {
  const cur: Record<string, number> = {};
  for (const h of config.hud) cur[h.id] = h.initial;
  return script.beats.map((b) => {
    const out: Record<string, HudSpan> = {};
    for (const h of config.hud) out[h.id] = { from: cur[h.id], to: cur[h.id], changes: false };
    for (const sc of b.stateChanges ?? []) {
      if (!(sc.hudId in out)) continue;
      out[sc.hudId] = { from: sc.from, to: sc.to, changes: sc.from !== sc.to };
      cur[sc.hudId] = sc.to;
    }
    return out;
  });
}

/** Eased value at beat progress t (0..1): holds 10 %, tweens until 75 %, then holds. */
export function hudValueAt(span: HudSpan, t: number): number {
  const k = Math.min(1, Math.max(0, (t - 0.1) / 0.65));
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
  return span.from + (span.to - span.from) * e;
}

// ── script.recurring.values ─────────────────────────────────────────────────────────────────────────────────────
// recurring.values are the named states of the recurring element in order ("Mon","Tue"… / "2025","2050"…),
// values[0] being the initial state. Two ways they reach the screen:
//  1. a COUNTER HUD whose label matches recurring.label shows values[round(value) − initial] instead of the number;
//  2. otherwise a small label chip (label + value) sits in the free top-centre slot, advancing evenly over the beats.

const normLabel = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export type Recurring = Script["recurring"];

/** Text a counter shows for `value`, or null to show the number. */
export function recurringCounterText(def: Pick<Config["hud"][number], "kind" | "label" | "initial">, value: number, recurring: Recurring | undefined): string | null {
  const vals = recurring?.values;
  if (!vals?.length || def.kind !== "counter" || normLabel(def.label) !== normLabel(recurring!.label)) return null;
  const i = Math.min(vals.length - 1, Math.max(0, Math.round(value) - Math.round(def.initial)));
  return vals[i];
}

/** True if some counter HUD carries the recurring values (then no chip is needed). */
export function recurringHasCounter(config: Pick<Config, "hud">, recurring: Recurring | undefined): boolean {
  if (!recurring?.values?.length) return false;
  return config.hud.some((h) => h.kind === "counter" && normLabel(h.label) === normLabel(recurring.label));
}

/** Chip value for beat `beatIndex` of `beatCount` (values spread evenly over the beats). */
export function recurringChipValue(recurring: Recurring | undefined, beatIndex: number, beatCount: number): string | null {
  const vals = recurring?.values;
  if (!vals?.length) return null;
  const i = Math.min(vals.length - 1, Math.floor((beatIndex * vals.length) / Math.max(1, beatCount)));
  return vals[i];
}
