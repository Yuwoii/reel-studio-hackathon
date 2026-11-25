// PhotoCard renderer (meta: src/v3/components-meta/PhotoCard.ts). `PhotoFace` (photo or scrambled characters in a
// rounded card) is shared with LockBox and the Phone "post" screen.
import React from "react";
import { Img, interpolate } from "remotion";
import { meta, PC, type PhotoCardPropsT } from "../../../src/v3/components-meta/PhotoCard";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, squash } from "../../v2/motion";
import { color, font } from "../../v2/theme";
import { ASSET_URLS } from "../assetUrls.gen";
import { hash01 } from "./ppg";

const GLYPHS = "A7#xQ$k2%Zr9&Wm4@Jf8*Hv3+Lp6=Ys5?Dn0!Bt";

/** One row of scrambled characters, stable for 3 frames at a time. */
export function scrambleRow(cols: number, row: number, f: number, seed: number): string {
  let s = "";
  const tick = Math.floor(f / 3);
  for (let c = 0; c < cols; c++) s += GLYPHS[Math.floor(hash01(seed * 131 + row * 17 + c * 7 + tick * 29) * GLYPHS.length)];
  return s;
}

export interface PhotoFaceProps {
  photo: string;
  /** card side px */
  s: number;
  /** 0 = photo, 1 = fully scrambled (rows wipe top → bottom). */
  scramble: number;
  f: number;
  seed?: number;
  /** draw the raised card frame (false: photo only, rounded). */
  card?: boolean;
}

export const PhotoFace: React.FC<PhotoFaceProps> = ({ photo, s, scramble, f, seed = 1, card = true }) => {
  const pad = card ? Math.round(s * PC.pad) : 0;
  const inner = s - 2 * pad;
  const src = ASSET_URLS[photo];
  const rows = PC.glyphRows;
  const fs = Math.max(10, Math.round(inner / (rows * 1.25)));
  const cols = Math.max(4, Math.floor(inner / (fs * 0.6)) - 1);
  const covered = scramble * (rows + 1);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: s, height: s, borderRadius: s * PC.radius, background: card ? color.bgRaised2 : "transparent", border: card ? `${Math.max(2, Math.round(s * 0.01))}px solid ${color.borderStrong}` : undefined, boxSizing: "border-box", boxShadow: card ? "0 10px 30px rgba(0,0,0,0.45)" : undefined }}>
      <div style={{ position: "absolute", left: pad - (card ? Math.max(2, Math.round(s * 0.01)) : 0), top: pad - (card ? Math.max(2, Math.round(s * 0.01)) : 0), width: inner, height: inner, borderRadius: s * PC.radius * 0.6, overflow: "hidden", background: color.bg }}>
        {src && scramble < 1 ? <Img src={src} style={{ position: "absolute", left: 0, top: 0, width: inner, height: inner, objectFit: "cover" }} /> : null}
        {scramble > 0
          ? Array.from({ length: rows }, (_, r) => {
              const o = Math.max(0, Math.min(1, covered - r));
              if (o <= 0) return null;
              return (
                <div key={r} style={{ position: "absolute", left: 0, top: (r * inner) / rows, width: inner, height: inner / rows + 1, background: color.bgRaised, opacity: o, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.mono, fontWeight: 500, fontSize: fs, color: r % 2 ? color.textDim : color.text, whiteSpace: "pre", overflow: "hidden" }}>
                  {scrambleRow(cols, r, f, seed)}
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
};

const Render: React.FC<RenderProps<PhotoCardPropsT>> = ({ props: p, frame, f, state, last, id }) => {
  const sf = state.f;
  const t = sf === null ? 1 : interpolate(frame, [sf, sf + PC.scrambleF], [0, 1], clampX);
  const scramble = state.name === "scrambled" ? t : sf === null ? 0 : 1 - t;
  const bump = squash(frame, last("pulse"));
  let seed = 0;
  for (const c of id) seed = (seed * 31 + c.charCodeAt(0)) % 997;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: p.w, height: p.w, transform: `rotate(${p.tilt}deg) scale(${bump})` }}>
      <PhotoFace photo={p.photo} s={p.w} scramble={scramble} f={f} seed={seed + 1} />
    </div>
  );
};

export const PhotoCard = defineComponent({ ...meta, Render });
