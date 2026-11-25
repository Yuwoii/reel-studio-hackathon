// Style texture over the scene (under text): flat = faint static grain, pixel = CRT-ish scanlines on the grid.

import React from "react";
import type { StyleDef } from "../styles";

export const Texture: React.FC<{ style: StyleDef }> = ({ style }) => {
  switch (style.texture) {
    case "none":
      return null;
    case "grain":
      return (
        <svg width={1080} height={1920} style={{ position: "absolute", inset: 0, opacity: 0.07, mixBlendMode: "overlay", pointerEvents: "none" }}>
          <filter id="grain-noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain-noise)" />
        </svg>
      );
    case "scanlines": {
      const p = style.pixelSize || 9;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) ${p - 2}px, rgba(0,0,0,0.13) ${p - 2}px, rgba(0,0,0,0.13) ${p}px)`,
          }}
        />
      );
    }
    default: {
      const _x: never = style.texture;
      return null;
    }
  }
};
