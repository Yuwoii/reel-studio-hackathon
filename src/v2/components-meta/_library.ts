// Library-level inputs for scripts/v2/gen-registry.ts (no imports; renderer-free).
//
// LIBRARY_ORDER is the stable id order of the generated LIBRARY_IDS (Instance.component enum). PLANNED holds the
// W0 placeholder metadata for ids that have no src/v2/components-meta/<Name>.ts yet: the generator emits them with
// `planned: true` and the Explainer renders them with PlaceholderCard. When a component ships, add its meta file —
// the meta wins over the stub automatically; leave the stub here (it is ignored) or delete it, either is fine.
// A brand-new id (not in LIBRARY_ORDER) is appended after these, alphabetically.

/** Bumped on every supervised library release; the release deploys as Lambda site `reel-studio-lib-<version>`. */
export const LIBRARY_VERSION = "v0";

export const LIBRARY_ORDER = [
  // bible §6 core 13 (ProcessBox → ContainerBox)
  "StatusCard", "HeroStat", "UnitGrid", "Timeline", "ContainerBox", "RequestPill", "PointerArrow", "Terminal",
  "SourceTag", "VersionPills", "Stamp", "VersusBadges", "KineticWord",
  // in-reel escape hatch
  "Figure",
  // R7 P0 additions
  "Callout", "NodeGraph", "MetricChart", "Meter",
] as const;

export interface PlannedStub {
  tier: "core" | "figure" | "p0" | "p1" | "p2" | "p3";
  focal: boolean;
  /** Conservative guess (lab/proof prototype size) until the real footprint() ships; null = unknown. */
  footprint: { w: number; h: number } | null;
  verbs: readonly string[];
  states: readonly string[];
}

const S = (tier: PlannedStub["tier"], focal: boolean, footprint: PlannedStub["footprint"], verbs: readonly string[] = [], states: readonly string[] = []): PlannedStub => ({ tier, focal, footprint, verbs, states });

export const PLANNED: Record<string, PlannedStub> = {
  StatusCard: S("core", true, { w: 860, h: 120 }, ["state", "pulse", "focus"], ["neutral", "danger", "ok"]),
  HeroStat: S("core", true, { w: 860, h: 400 }, ["countUp", "scramble", "state"], ["accent", "danger"]),
  UnitGrid: S("core", true, { w: 600, h: 600 }, ["state", "mark"]),
  Timeline: S("core", true, { w: 900, h: 260 }, ["drawOn", "mark", "state"]),
  ContainerBox: S("core", true, { w: 560, h: 620 }, ["state", "pulse", "mark"], ["ok", "filling", "full", "killed", "freed"]),
  RequestPill: S("core", false, { w: 420, h: 64 }, ["state"]),
  PointerArrow: S("core", false, { w: 400, h: 120 }, ["drawOn"]),
  Terminal: S("core", true, { w: 860, h: 340 }, ["state", "scramble"]),
  SourceTag: S("core", false, { w: 520, h: 64 }, []),
  VersionPills: S("core", false, { w: 860, h: 160 }, ["state"]),
  Stamp: S("core", true, { w: 700, h: 200 }, []),
  VersusBadges: S("core", true, { w: 760, h: 320 }, ["state"]),
  KineticWord: S("core", true, { w: 900, h: 300 }, []),
  Figure: S("figure", true, null, ["drawOn", "state", "mark"]),
  Callout: S("p0", false, { w: 520, h: 140 }, ["drawOn"]),
  NodeGraph: S("p0", true, { w: 900, h: 700 }, ["state", "mark", "pulse"]),
  MetricChart: S("p0", true, { w: 900, h: 520 }, ["drawOn", "mark", "state"]),
  Meter: S("p0", false, { w: 560, h: 90 }, ["state", "countUp"], ["ok", "warn", "full"]),
};
