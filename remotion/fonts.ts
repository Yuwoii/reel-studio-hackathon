// Bundled OFL fonts (public/fonts, from github.com/google/fonts) loaded via @remotion/fonts + staticFile so the
// Lambda site has them offline — no runtime CDN. loadFont() wraps itself in delayRender().

import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

let started = false;

export function ensureFonts(): void {
  if (started) return;
  started = true;
  // Variable font: one file covers 800/900.
  void loadFont({ family: "Montserrat", url: staticFile("fonts/Montserrat-Variable.ttf"), weight: "100 900" });
  void loadFont({ family: "Press Start 2P", url: staticFile("fonts/PressStart2P-Regular.ttf"), weight: "400" });
}
