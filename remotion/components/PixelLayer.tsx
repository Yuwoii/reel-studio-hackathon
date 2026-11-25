// Pixel-art look for the scene layer: an SVG filter samples one pixel per N×N cell and dilates it over the cell
// (feFlood→feTile grid mask → feComposite "in" → feMorphology dilate). N is odd so radius (N-1)/2 covers exactly
// one cell — no seams. The grid is screen-aligned (filter sits outside the camera transform). Text is rendered
// outside this layer and stays crisp.

import React, { useId } from "react";

export const PixelLayer: React.FC<{ size: number; children: React.ReactNode }> = ({ size, children }) => {
  const id = `px${useId().replace(/:/g, "")}`;
  if (!size) return <div style={{ position: "absolute", inset: 0 }}>{children}</div>;
  const n = size % 2 ? size : size + 1;
  const r = (n - 1) / 2;
  return (
    <>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
            <feFlood x={r} y={r} width={1} height={1} floodColor="#000" floodOpacity={1} result="dot" />
            <feComposite in="dot" in2="dot" operator="over" x={0} y={0} width={n} height={n} result="cell" />
            <feTile in="cell" result="grid" />
            <feComposite in="SourceGraphic" in2="grid" operator="in" result="sampled" />
            <feMorphology in="sampled" operator="dilate" radius={r} />
          </filter>
        </defs>
      </svg>
      <div style={{ position: "absolute", inset: 0, filter: `url(#${id})` }}>{children}</div>
    </>
  );
};
