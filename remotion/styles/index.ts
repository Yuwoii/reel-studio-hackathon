// Style registry + theme context. getStyle() is an exhaustive switch over the schema's STYLES so adding a style
// to src/schema/library.ts fails the typecheck until it is implemented here.

import { createContext, useContext } from "react";
import type { Config, Palette } from "../../src/schema/index.js";
import { flat } from "./flat";
import { pixel } from "./pixel";
import type { StyleDef } from "./types";

export type { StyleDef } from "./types";

export function getStyle(id: Config["style"]): StyleDef {
  switch (id) {
    case "flat":
      return flat;
    case "pixel":
      return pixel;
    default: {
      const _x: never = id;
      return flat;
    }
  }
}

export function resolvePalette(style: StyleDef, overrides: Partial<Palette> | undefined): Palette {
  const out = { ...style.palette };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) out[k as keyof Palette] = v;
  }
  return out;
}

export interface Theme {
  style: StyleDef;
  palette: Palette;
}

export const ThemeContext = createContext<Theme>({ style: flat, palette: flat.palette });
export const useTheme = () => useContext(ThemeContext);

/** CSS font-family value. Family names must be quoted: "Press Start 2P" is invalid CSS unquoted (token "2P"). */
export const cssFont = (family: string) => `"${family}", ${/press start/i.test(family) ? "monospace" : "sans-serif"}`;
