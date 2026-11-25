// Bundle side of the v3 library (W3b): the v2 library lookup ∪ the v3 components (W3a), the v3 metas and the generated
// asset index, as the LowerLib that src/v3/lower.ts takes. The container builds the SAME thing from src/v3/components-meta
// (src/v3/lints.ts v3Lib), so lints, digest and render lower a board identically.
// Extensionless imports only (Remotion's webpack cannot resolve NodeNext ".js" specifiers).
import { buildFootprintLookup, type LookupEntry } from "../../src/v2/components-meta/_lookup";
import type { AnyComponentMeta } from "../../src/v2/components-meta/_types";
import type { FootprintLookup } from "../../src/v2/timeline";
import { ASSETS } from "../../src/v3/assets.gen";
import type { AnyV3Meta } from "../../src/v3/components-meta/_types";
import { makeLowerLib, v3RegistryEntries, type LookupLike, type LowerLib } from "../../src/v3/lower";
import { LIBRARY } from "../v2/components";
import type { LibraryComponent } from "../v2/components/contract";
import { LIBRARY_LOOKUP } from "../v2/components/Slot";
import { V3_COMPONENTS } from "./components";

export const V3_METAS_BUNDLE: Readonly<Record<string, AnyV3Meta>> = Object.fromEntries(Object.entries(V3_COMPONENTS).map(([k, c]) => [k, c.meta as unknown as AnyV3Meta]));

/** v2 + v3 props-aware footprints (resolveTimeline, culling, instance boxes). */
export const LOOKUP_V3: FootprintLookup = {
  ...LIBRARY_LOOKUP,
  ...buildFootprintLookup(v3RegistryEntries(V3_METAS_BUNDLE) as unknown as Record<string, LookupEntry>, V3_METAS_BUNDLE as unknown as Record<string, AnyComponentMeta>),
} as FootprintLookup;

export const LOWER_LIB: LowerLib = makeLowerLib(LOOKUP_V3 as unknown as Record<string, LookupLike>, V3_METAS_BUNDLE, ASSETS);

/** v3 component first, then the v2 library. */
export function componentForV3(id: string): LibraryComponent | undefined {
  return (V3_COMPONENTS as unknown as Record<string, LibraryComponent>)[id] ?? LIBRARY[id];
}
export function ownsEnterExitV3(id: string): boolean {
  return componentForV3(id)?.meta.enterExit === "self";
}
export function exitDurFV3(id: string): number {
  return componentForV3(id)?.meta.verbs.exit.durF ?? 8;
}
