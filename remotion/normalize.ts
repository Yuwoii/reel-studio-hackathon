// Defensive defaults. The pipeline passes zod-parsed props (defaults applied), but Studio, hand-written JSON and
// old Lambda payloads may not — so the composition fills every optional field itself instead of crashing.
// Mirrors the .default() values in src/schema (types only are imported).

import type { BeatAudio, Config, ReelProps, Scene, Script } from "../src/schema/index.js";

type Loose<T> = { [K in keyof T]?: unknown };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function normScene(sIn: unknown): Scene {
  const s = obj(sIn) as Loose<Scene>;
  const bg = obj(s.background);
  const parts = obj(s.particles);
  const cam = obj(s.camera);
  return {
    background: { preset: (bg.preset as Scene["background"]["preset"]) ?? "plain", timeOfDay: (bg.timeOfDay as Scene["background"]["timeOfDay"]) ?? "day" },
    characters: arr<Record<string, unknown>>(s.characters).map((c) => ({
      ref: String(c.ref ?? ""),
      action: (c.action as Scene["characters"][number]["action"]) ?? "idle",
      position: (c.position as Scene["characters"][number]["position"]) ?? "center",
      facing: (c.facing as "left" | "right") ?? "right",
      scale: typeof c.scale === "number" ? c.scale : 1,
      enter: (c.enter as Scene["characters"][number]["enter"]) ?? "none",
    })),
    props: arr<Record<string, unknown>>(s.props).map((p) => ({
      kind: p.kind as Scene["props"][number]["kind"],
      x: typeof p.x === "number" ? p.x : 0.5,
      y: typeof p.y === "number" ? p.y : 0.5,
      scale: typeof p.scale === "number" ? p.scale : 1,
      animation: (p.animation as Scene["props"][number]["animation"]) ?? "bob",
      colorRole: p.colorRole as Scene["props"][number]["colorRole"],
    })),
    particles: { kind: (parts.kind as Scene["particles"]["kind"]) ?? "none", intensity: typeof parts.intensity === "number" ? parts.intensity : 0.5 },
    hud: arr<string>(s.hud),
    camera: { drift: (cam.drift as Scene["camera"]["drift"]) ?? "slow", zoom: typeof cam.zoom === "number" ? cam.zoom : 1 },
    transitionOut: (s.transitionOut as Scene["transitionOut"]) ?? "slide",
  };
}

export function normalizeScript(sIn: unknown): Script {
  const s = obj(sIn) as Loose<Script>;
  return {
    ...(s as Script),
    beats: arr<Record<string, unknown>>(s.beats).map((b) => ({
      ...(b as unknown as Script["beats"][number]),
      narration: String(b.narration ?? ""),
      onScreenText: String(b.onScreenText ?? ""),
      stateChanges: arr(b.stateChanges),
      scene: normScene(b.scene),
    })),
    recurring: (s.recurring as Script["recurring"]) ?? { label: "" },
    sources: arr(s.sources),
    substitutions: arr(s.substitutions),
  };
}

export function normalizeConfig(cIn: unknown): Config {
  const c = obj(cIn) as Loose<Config>;
  const cap = obj(c.captions);
  return {
    version: 1,
    style: c.style === "pixel" ? "pixel" : "flat",
    palette: obj(c.palette) as Config["palette"],
    characters: arr<Record<string, unknown>>(c.characters).map((x) => ({
      ...(x as unknown as Config["characters"][number]),
      fluffy: x.fluffy === true,
      accessories: arr(x.accessories),
    })),
    hud: arr<Record<string, unknown>>(c.hud).map((h) => ({
      ...(h as unknown as Config["hud"][number]),
      unit: typeof h.unit === "string" ? h.unit : "",
      min: typeof h.min === "number" ? h.min : 0,
      max: typeof h.max === "number" ? h.max : 100,
      decimals: typeof h.decimals === "number" ? h.decimals : 0,
    })),
    captions: { mode: cap.mode === "word" ? "word" : "chunk", chunkSize: typeof cap.chunkSize === "number" ? cap.chunkSize : 3 },
  };
}

export function normalizeProps(p: ReelProps): ReelProps {
  const script = normalizeScript(p.script);
  const audio: BeatAudio[] = arr<BeatAudio>(p.audio).map((a) => ({ ...a, words: arr(a.words) }));
  return { ...p, script, config: normalizeConfig(p.config), audio };
}
