// Plate renderer (meta: src/v3/components-meta/Plate.ts). One <Img> filling the instance box; <Img> holds the frame
// (delayRender) until the file has loaded. No CSS filter: treatment and brand masks are baked into the file.
import React from "react";
import { Img } from "remotion";
import { meta, PLATE_FEATHER, type PlatePropsT } from "../../../src/v3/components-meta/Plate";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { color, font } from "../../v2/theme";
import { ASSET_URLS } from "../assetUrls.gen";

const Render: React.FC<RenderProps<PlatePropsT>> = ({ props: p, size }) => {
  const src = ASSET_URLS[p.asset];
  if (!src)
    return (
      <div style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, border: `4px solid ${color.danger}`, boxSizing: "border-box", color: color.danger, fontFamily: font.mono, fontSize: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {`asset ${p.asset} not shipped`}
      </div>
    );
  // feather: two linear alpha ramps intersected (a soft rounded rectangle) — a mask, not a filter; the pixels inside
  // the safe area are untouched, so anchors and the baked treatment stay exact
  const fpx = Math.round(PLATE_FEATHER * Math.min(size.w, size.h));
  const ramp = (dir: string, len: number) => `linear-gradient(${dir}, transparent 0px, black ${fpx}px, black ${len - fpx}px, transparent ${len}px)`;
  const mask = p.edge === "feather" ? `${ramp("to right", size.w)}, ${ramp("to bottom", size.h)}` : undefined;
  return (
    <Img
      src={src}
      style={{
        position: "absolute", left: 0, top: 0, width: size.w, height: size.h, display: "block",
        ...(mask ? { maskImage: mask, WebkitMaskImage: mask, maskComposite: "intersect", WebkitMaskComposite: "source-in" } : null),
      }}
    />
  );
};

export const Plate = defineComponent({ ...meta, Render });
