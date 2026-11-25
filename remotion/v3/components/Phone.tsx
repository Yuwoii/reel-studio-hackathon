// Phone renderer (meta: src/v3/components-meta/Phone.ts). Generic: rounded body, inset screen, camera notch.
import React from "react";
import { Img, interpolate } from "remotion";
import { meta, PH, phoneUrlFs, phoneUrlX, type PhonePropsT } from "../../../src/v3/components-meta/Phone";
import { defineComponent, type RenderProps } from "../../v2/components/contract";
import { clampX, squash } from "../../v2/motion";
import { color, font, radius, type } from "../../v2/theme";
import { ASSET_URLS } from "../assetUrls.gen";
import { PadlockGlyph } from "./Padlock";
import { PhotoFace } from "./PhotoCard";

/** Browser address bar at the top of the phone screen (S2 hook). idle → tapped types "https://" in from the left. */
const UrlBar: React.FC<{ p: PhonePropsT; prev: PhonePropsT; changeF: number | null; frame: number }> = ({ p, prev, changeF, frame }) => {
  const B = PH.bar;
  const typed = p.bar === "tapped" && prev.bar === "idle" && changeF !== null ? Math.round(interpolate(frame, [changeF, changeF + PH.typeF], [0, 8], clampX)) : p.bar === "tapped" ? 8 : 0;
  const scheme = "https://".slice(0, typed);
  const tx = phoneUrlX(p.lock);
  const fs = phoneUrlFs(p.host, p.lock);
  const hiS = p.highlight === "s" && typed >= 5;
  return (
    <>
      <div style={{ position: "absolute", left: B.x, top: B.y, width: B.w, height: B.h, borderRadius: B.h / 2, background: color.bgRaised2, border: `2px solid ${p.bar === "tapped" ? color.textDim : color.border}`, boxSizing: "border-box" }} />
      {p.lock ? (
        <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={PH.w} height={PH.h}>
          <PadlockGlyph s={B.lockW} cx={B.x + B.padL + B.lockW / 2} cy={B.y + B.h / 2 + B.lockW * 0.14} open={0} tone={p.highlight === "lock" ? "accent" : "neutral"} />
        </svg>
      ) : null}
      <div style={{ position: "absolute", left: tx, top: B.y, height: B.h, display: "flex", alignItems: "center", fontFamily: font.mono, fontSize: fs, fontWeight: 500, whiteSpace: "pre", color: color.text }}>
        {scheme.length ? (
          <span style={{ color: color.textDim }}>
            {scheme.slice(0, 4)}
            {scheme.length >= 5 ? <span style={hiS ? { color: color.accent, fontWeight: 700 } : { color: color.text, fontWeight: 600 }}>{scheme[4]}</span> : null}
            {scheme.slice(5)}
          </span>
        ) : null}
        <span>{p.host}</span>
        {p.bar === "tapped" && Math.floor(frame / 15) % 2 === 0 ? <span style={{ display: "inline-block", width: 2, height: fs * 1.1, background: color.text, marginLeft: 2 }} /> : null}
      </div>
    </>
  );
};

const Render: React.FC<RenderProps<PhonePropsT>> = ({ props: p, prev, changeF, frame, f, last }) => {
  const S = PH.screen;
  const press = squash(frame, last("pulse"));
  const field = (y: number, children: React.ReactNode, active: boolean) => (
    <div style={{ position: "absolute", left: PH.field.x, top: y, width: PH.field.w, height: PH.field.h, borderRadius: radius.pill, background: color.bgRaised2, border: `2px solid ${active ? color.borderStrong : color.border}`, boxSizing: "border-box", display: "flex", alignItems: "center", paddingLeft: 24 }}>
      {children}
    </div>
  );
  const page = p.screen === "page" && p.pageAsset ? ASSET_URLS[p.pageAsset] : undefined;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: PH.w, height: PH.h }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 64, background: color.bgRaised, border: `3px solid ${color.borderStrong}`, boxSizing: "border-box" }} />
      <div style={{ position: "absolute", left: S.x, top: S.y, width: S.w, height: S.h, borderRadius: S.r, background: color.bg, overflow: "hidden" }}>
        {page ? <Img src={page} style={{ width: S.w, height: S.h, objectFit: "cover", objectPosition: "50% 0%" }} /> : null}
      </div>
      <div style={{ position: "absolute", left: PH.notch.x, top: PH.notch.y, width: PH.notch.w, height: PH.notch.h, borderRadius: 15, background: color.bgRaised }} />
      {p.screen === "login" ? (
        <>
          <div style={{ position: "absolute", left: PH.title.x, top: PH.title.y, fontFamily: font.sans, fontWeight: type.cardTitle.weight, fontSize: 52, color: color.text, whiteSpace: "pre" }}>Log in</div>
          {field(PH.field.user, <div style={{ width: 180, height: 22, borderRadius: 11, background: color.textFaint }} />, false)}
          {field(PH.field.password, <div style={{ display: "flex", gap: 14 }}>{Array.from({ length: p.dots }, (_, i) => <div key={i} style={{ width: 20, height: 20, borderRadius: 10, background: color.text }} />)}</div>, p.dots > 0 && p.dots < 8)}
          <div style={{ position: "absolute", left: PH.button.x, top: PH.button.y, width: PH.button.w, height: PH.button.h, borderRadius: radius.pill, background: color.accent, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.sans, fontWeight: 600, fontSize: 38, color: color.accentInk, transform: `scale(${press})`, whiteSpace: "pre" }}>Log in</div>
        </>
      ) : null}
      {p.screen === "post" ? (
        <>
          <div style={{ position: "absolute", left: PH.title.x, top: PH.post.title - 40, fontFamily: font.sans, fontWeight: type.cardTitle.weight, fontSize: 40, color: color.text, whiteSpace: "pre" }}>New post</div>
          <div style={{ position: "absolute", left: PH.post.photo.x, top: PH.post.photo.y, width: PH.post.photo.s, height: PH.post.photo.s }}>
            {p.photo === "none" ? (
              // S2 r1: the photo has lifted off as a card — an empty, dashed slot stays behind
              <div style={{ position: "absolute", left: 0, top: 0, width: PH.post.photo.s, height: PH.post.photo.s, borderRadius: 26, border: `4px dashed ${color.textFaint}`, boxSizing: "border-box" }} />
            ) : (
              <PhotoFace photo={p.photo} s={PH.post.photo.s} scramble={0} f={f} card={false} />
            )}
          </div>
          <div style={{ position: "absolute", left: PH.post.photo.x, top: PH.post.line, width: 230, height: 20, borderRadius: 10, background: color.textFaint }} />
          <div style={{ position: "absolute", left: PH.post.photo.x, top: PH.post.line + 34, width: 160, height: 20, borderRadius: 10, background: color.textFainter }} />
          <div style={{ position: "absolute", left: PH.post.button.x, top: PH.post.button.y, width: PH.post.button.w, height: PH.post.button.h, borderRadius: radius.pill, background: color.accent, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.sans, fontWeight: 600, fontSize: 38, color: color.accentInk, transform: `scale(${press})`, whiteSpace: "pre" }}>Post</div>
        </>
      ) : null}
      {p.bar !== "none" ? <UrlBar p={p} prev={prev} changeF={changeF} frame={frame} /> : null}
    </div>
  );
};

export const Phone = defineComponent({ ...meta, Render });
