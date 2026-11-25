// BrowserWindow — a generic, unbranded browser window (D1 #2d: no Chrome/Safari/Firefox chrome). Promoted from
// remotion/v3lab/devices/BrowserWindow.tsx + hook/devices.tsx (HookBrowser). 960 × 1320 at the footprint origin.
//
//   url "tapped" (D1 #2b, default): the address bar in its tapped/expanded editing state — full "https://host/path",
//        bigger mono text, focus border and a blinking caret, so the camera can zoom onto the S of https.
//   url "idle": what a browser shows at rest — host only (no scheme), dim path.
//   highlight: "s" turns the S of https accent (stroke-thickened), "lock" the padlock, "host" the site name.
//   state "popover": the connection panel opens under the bar. The issuer is ALWAYS the generic one (D1 #2c,
//        data/asset-policy.json realIssuerNames:false → genericIssuer): the schema accepts only GENERIC_ISSUER, so no
//        director prop can draw a real CA name (test/v3-w3a-components checks the constant equals the policy).
//   host: generic reserved names only (D1 #2d — no real brand in the chrome): example.com/.org/.net, their
//        subdomains, or *.example / *.test (RFC 2606).
//   pageAsset: a capture plate ref fills the page area. Default = the neutral sign-in page capture (a real page layout
//        with a heading and form, so the window reads as "a website"); "none" = neutral placeholder blocks.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const BW = {
  w: 960,
  h: 1320,
  titleH: 64,
  bar: { x: 24, y: 88, w: 912, h: 72 },
  pageTop: 184,
  lock: { cx: 68, size: 40 },
  /** text x: after the padlock, or at the bar's left padding without it */
  textX: { lock: 104, none: 56 },
  /** mono font size per url mode; JetBrains Mono advance = 0.6 em */
  fs: { tapped: 34, idle: 30 },
  pop: { x: 48, y: 176, w: 760, h: 470, pad: 36, labelCh: 12, rowTop: [132, 192, 252, 352] as const },
} as const;
export const MONO_ADVANCE = 0.6;
/** Ink centre of the lowercase "s" relative to its advance-box centre on the bar's centre line, in em (JetBrains Mono):
 *  x-height glyphs sit below the line-box centre. Measured on the W3a Lambda golden BrowserWindow-c (zoom 3.03 ×):
 *  accent-ink centroid 7.9 / 19.1 screen px right / below the advance centre → 0.077 / 0.186 em at 34 px. */
export const S_INK = { x: 0.077, y: 0.186 } as const;
export const GENERIC_ISSUER = "a certificate authority";
/** RFC 2606 reserved names only: example.com/.org/.net (+ subdomains) and *.example / *.test. */
export const GENERIC_HOST = /^(?:[a-z0-9-]{1,20}\.)?(?:example\.(?:com|org|net)|[a-z0-9-]{1,20}\.(?:example|test))$/;
export const DEFAULT_PAGE = "capture-generic-signin@1";
/** Popover rows: mono type.field 30 px → 18 px advance; values wrap at popValueCh() chars. */
export const POP_CH = 30 * MONO_ADVANCE;
export const popValueCh = () => Math.floor((BW.pop.w - 2 * BW.pop.pad) / POP_CH) - BW.pop.labelCh;

export const BrowserWindowProps = z
  .object({
    host: z.string().max(28).regex(GENERIC_HOST, "host must be a reserved generic name (example.com/.org/.net, *.example, *.test): no real brands in the chrome (D1 #2d)").default("example.com"),
    path: z.string().regex(/^(\/[a-z0-9._/-]{0,20})?$/).default("/"),
    url: z.enum(["tapped", "idle"]).default("tapped"),
    lock: z.boolean().default(false),
    highlight: z.enum(["none", "s", "lock", "host"]).default("none"),
    pageAsset: z.union([z.string().regex(/^[a-z0-9-]+@\d+$/), z.literal("none")]).default(DEFAULT_PAGE),
    cert: z
      .object({
        protocol: z.string().max(12).default("TLS 1.3"),
        issuer: z.literal(GENERIC_ISSUER).default(GENERIC_ISSUER),
        validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-12-25"),
      })
      .strict()
      .default({ protocol: "TLS 1.3", issuer: GENERIC_ISSUER, validTo: "2026-12-25" }),
  })
  .strict();
export type BrowserWindowPropsT = z.output<typeof BrowserWindowProps>;

/** Pure URL-bar text layout (shared by Render and anchors). */
export function urlLayout(p: Pick<BrowserWindowPropsT, "url" | "lock" | "host" | "path">) {
  const fs = BW.fs[p.url];
  const ch = fs * MONO_ADVANCE;
  const x0 = p.lock ? BW.textX.lock : BW.textX.none;
  const scheme = p.url === "tapped" ? "https://" : "";
  const cy = BW.bar.y + BW.bar.h / 2;
  return { fs, ch, x0, cy, scheme, host: p.host, path: p.path === "/" && p.url === "idle" ? "" : p.path, hostX: x0 + scheme.length * ch };
}

export const meta: V3MetaDef<typeof BrowserWindowProps> = {
  name: "BrowserWindow",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3 (device a); D1 #2b–2d",
  summary: "Generic browser window: address bar (tapped state shows https:// so the S can be zoomed), padlock, page, connection popover.",
  families: ["security", "network"],
  propsSchema: BrowserWindowProps,
  propsSchemaName: "BrowserWindowProps",
  example: { host: "example.com", url: "tapped" },
  states: ["closed", "popover"],
  verbs: {
    enter: { durF: 12, does: "window rises in (shared spring)" },
    exit: { durF: 8, does: "window fades out" },
    state: { durF: 14, does: "closed ↔ popover (connection panel opens under the bar); may switch url/highlight", props: ["url", "highlight", "host", "path", "lock"] },
    focus: { durF: 18, does: "pulses the highlighted part (S / lock / host) once" },
  },
  focal: true,
  footprint: () => ({ w: BW.w, h: BW.h }),
  sfx: { enter: "whoosh", state: "tick", focus: "tick" },
  v3kind: "device",
  assetIds: ["browser-generic"],
  anchors: (p): AnchorMap => {
    const L = urlLayout(p);
    const a: AnchorMap = {
      urlbar: { x: BW.bar.x + BW.bar.w / 2, y: L.cy, r: BW.bar.w / 2, box: { x0: BW.bar.x, y0: BW.bar.y, x1: BW.bar.x + BW.bar.w, y1: BW.bar.y + BW.bar.h }, label: "the address bar", physical: "the field showing the web address" },
      "urlbar.host": { x: L.hostX + (p.host.length * L.ch) / 2, y: L.cy, r: (p.host.length * L.ch) / 2 + 8, box: { x0: L.hostX, y0: L.cy - L.fs * 0.6, x1: L.hostX + p.host.length * L.ch, y1: L.cy + L.fs * 0.6 }, edge: true, label: "the site name", physical: "the domain; stays visible to the network even with HTTPS" },
      page: { x: BW.w / 2, y: (BW.pageTop + BW.h) / 2, r: 380, label: "the page", physical: "the website content" },
      popover: { x: BW.pop.x + BW.pop.w / 2, y: BW.pop.y + BW.pop.h / 2, r: 300, label: "the connection panel", physical: "connection details: protocol, site, who vouches for it, expiry" },
      "popover.issuer": { x: BW.pop.x + BW.pop.pad + BW.pop.labelCh * POP_CH + (Math.min(p.cert.issuer.length, popValueCh()) * POP_CH) / 2, y: BW.pop.y + BW.pop.rowTop[2] + 20, r: 40, label: "who vouches for the site", physical: "the issuer: the certificate authority that signed the site's certificate" },
    };
    if (p.url === "tapped") {
      a["urlbar.scheme"] = { x: L.x0 + 4 * L.ch, y: L.cy, r: 4 * L.ch + 6, box: { x0: L.x0, y0: L.cy - L.fs * 0.6, x1: L.x0 + 8 * L.ch, y1: L.cy + L.fs * 0.6 }, edge: true, label: "https://", physical: "the scheme part of the address" };
      a["urlbar.schemeS"] = { x: L.x0 + 4.5 * L.ch + S_INK.x * L.fs, y: L.cy + S_INK.y * L.fs, r: Math.round(L.fs * 0.62), label: "the S of https", physical: "the letter s: secure — the trip to the site is sealed with TLS" };
    }
    if (p.lock) a.lock = { x: BW.lock.cx, y: L.cy, r: 26, label: "the padlock", physical: "padlock icon (some browsers no longer show it)" };
    return a;
  },
  describe: (state, p) => {
    const L = urlLayout(p);
    const shown = p.url === "tapped" ? `${L.scheme}${p.host}${p.path}` : `${p.host}${L.path}`;
    return `BrowserWindow bar=${p.url} shows "${shown}"${p.lock ? " +padlock" : ""} highlight=${p.highlight} page=${p.pageAsset === "none" ? "placeholder" : p.pageAsset} popover=${state === "popover" ? `open (issuer "${p.cert.issuer}")` : "closed"}`;
  },
};
