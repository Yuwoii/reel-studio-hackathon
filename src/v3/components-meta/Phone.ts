// Phone — a generic, unbranded smartphone (front), 440 × 880. Promoted from remotion/v3lab/hook/devices.tsx (Phone).
// screen "login": a log-in form whose password field fills with `dots` (0–8); "page": a capture plate (pageAsset,
// e.g. capture-example-com-mobile@2) fills the screen; "blank": dark screen; "post" (S2): a "New post" screen with a
// real photo AS CONTENT (`photo`, default the cat picture — owner S1 #3: the only real image allowed) and a Post
// button; photo "none" (S2 r1) = an empty dashed slot (the photo has lifted off as a card). `pulse` presses the Log in /
// Post button.
// bar (S2 hook, "drawn phone browser"): a browser address bar at the top of the screen — "idle" shows the host only,
// "tapped" the full https://host with the S anchor (urlbar.schemeS) for the snap-zoom + ring; switching idle → tapped
// types "https://" in from the left (10 f); the URL text shrinks (phoneUrlFs) when "https://host" would not fit.
// `lock`: padlock glyph before the URL; highlight "s"/"lock" turns it accent.
import { z } from "zod";
import type { AnchorMap, V3MetaDef } from "./_types.js";

export const PH = {
  w: 440,
  h: 880,
  screen: { x: 24, y: 24, w: 392, h: 832, r: 44 },
  notch: { x: 160, y: 44, w: 120, h: 30 },
  title: { x: 52, y: 170 },
  field: { x: 52, w: 336, h: 84, user: 280, password: 392 },
  button: { x: 52, y: 530, w: 336, h: 92 },
  bar: { x: 36, y: 92, w: 368, h: 64, fs: 24, padL: 16, lockW: 24, gap: 10 },
  post: { title: 222, photo: { x: 52, y: 250, s: 336 }, line: 612, button: { x: 52, y: 690, w: 336, h: 92 } },
  typeF: 10,
} as const;
const MONO_ADV = 0.6;
/** Ink offset of lowercase "s" from its advance-box centre (JetBrains Mono, measured for BrowserWindow S_INK). */
const S_INK_EM = { x: 0.077, y: 0.186 } as const;
/** x of the URL text start in the phone bar. */
export const phoneUrlX = (lock: boolean) => PH.bar.x + PH.bar.padL + (lock ? PH.bar.lockW + PH.bar.gap : 0);
export const phoneUrl = (host: string, bar: "idle" | "tapped") => (bar === "tapped" ? `https://${host}` : host);
/** Text cursor after a tapped URL (2 px bar + 2 px margin, = the renderer). */
const CURSOR_W = 4;
/** Font size of the bar text: PH.bar.fs, shrunk so the FULL tapped URL "https://<host>" + cursor stays inside the bar
 *  (TLS pilot 2026-11-03: lock + "scam.example.com" ran 28 px past the bar edge at 24 px). Depends only on (host, lock),
 *  so idle → tapped typing never changes the size; renderer and anchors (urlbar.schemeS snap zoom) share it. */
export const phoneUrlFs = (host: string, lock: boolean) => {
  const room = PH.bar.x + PH.bar.w - PH.bar.padL - CURSOR_W - phoneUrlX(lock);
  return Math.min(PH.bar.fs, room / (("https://".length + host.length) * MONO_ADV));
};

export const PhoneProps = z
  .object({
    screen: z.enum(["login", "page", "blank", "post"]).default("login"),
    dots: z.number().int().min(0).max(8).default(0),
    pageAsset: z.string().regex(/^[a-z0-9-]+@\d+$/).optional(),
    photo: z.string().regex(/^(?:none|[a-z0-9-]+@\d+)$/).default("cat-photo@1"),
    bar: z.enum(["none", "idle", "tapped"]).default("none"),
    host: z.string().max(16).regex(/^(?:[a-z0-9-]{1,10}\.)?(?:example\.(?:com|org|net)|[a-z0-9-]{1,10}\.(?:example|test))$/, "host: reserved generic names only (D1 #2d), ≤ 16 chars to fit the phone bar").default("example.com"),
    lock: z.boolean().default(false),
    highlight: z.enum(["none", "s", "lock"]).default("none"),
  })
  .strict();
export type PhonePropsT = z.output<typeof PhoneProps>;

export const meta: V3MetaDef<typeof PhoneProps> = {
  name: "Phone",
  version: 1,
  tier: "p0",
  spec: "ADR-002 §3 (device a)",
  summary: "Generic smartphone: log-in form, captured page, blank, or a 'New post' screen with a photo; optional browser address bar (https S anchor).",
  families: ["security", "network"],
  propsSchema: PhoneProps,
  propsSchemaName: "PhoneProps",
  example: { screen: "login", dots: 5 },
  states: ["idle"],
  verbs: {
    enter: { durF: 12, does: "phone rises in" },
    exit: { durF: 8, does: "fades out" },
    state: { durF: 6, does: "changes the screen / types password dots", props: ["screen", "dots", "pageAsset", "photo", "bar", "host", "lock", "highlight"] },
    pulse: { durF: 8, does: "presses the Log in / Post button" },
  },
  focal: true,
  footprint: () => ({ w: PH.w, h: PH.h }),
  sfx: { enter: "whoosh", state: "tick", pulse: "tick" },
  v3kind: "device",
  assetIds: ["phone"],
  anchors: (p): AnchorMap => {
    const cx = PH.w / 2;
    const a: AnchorMap = {
      screen: { x: cx, y: PH.screen.y + PH.screen.h / 2, r: 200, label: "the phone screen", physical: "the display" },
      notch: { x: cx, y: PH.notch.y + PH.notch.h / 2, r: 64, label: "the top of the phone", physical: "camera notch" },
    };
    if (p.screen === "login") {
      a["field.user"] = { x: cx, y: PH.field.user + PH.field.h / 2, r: 170, label: "the name field", physical: "where you type your user name" };
      a["field.password"] = { x: cx, y: PH.field.password + PH.field.h / 2, r: 170, label: "the password field", physical: "where you type your password (shown as dots)" };
      a.button = { x: cx, y: PH.button.y + PH.button.h / 2, r: 170, label: "the Log in button", physical: "sends what you typed" };
    }
    if (p.screen === "post") {
      const P = PH.post;
      a["post.photo"] = { x: P.photo.x + P.photo.s / 2, y: P.photo.y + P.photo.s / 2, r: P.photo.s / 2, label: "your cat picture", physical: "the photo you are about to post" };
      a.button = { x: cx, y: P.button.y + P.button.h / 2, r: 170, label: "the Post button", physical: "sends the picture to the website" };
    }
    if (p.bar !== "none") {
      const B = PH.bar;
      const y = B.y + B.h / 2;
      const fs = phoneUrlFs(p.host, p.lock);
      const adv = fs * MONO_ADV;
      const tx = phoneUrlX(p.lock);
      a.urlbar = { x: B.x + B.w / 2, y, r: B.w / 2, box: { x0: B.x, y0: B.y, x1: B.x + B.w, y1: B.y + B.h }, label: "the address bar", physical: "shows the website's address" };
      const h0 = p.bar === "tapped" ? 8 : 0;
      a["urlbar.host"] = { x: tx + (h0 + p.host.length / 2) * adv, y, r: (p.host.length * adv) / 2 + 6, box: { x0: tx + h0 * adv, y0: y - fs * 0.6, x1: tx + (h0 + p.host.length) * adv, y1: y + fs * 0.6 }, edge: true, label: "the website's name", physical: p.host };
      if (p.lock) a["urlbar.lock"] = { x: B.x + B.padL + B.lockW / 2, y, r: B.lockW * 0.75, label: "the padlock", physical: "the browser's lock sign: the connection is locked (TLS)" };
      if (p.bar === "tapped") {
        a["urlbar.scheme"] = { x: tx + 2.5 * adv, y, r: 2.5 * adv + 6, box: { x0: tx, y0: y - fs * 0.6, x1: tx + 8 * adv, y1: y + fs * 0.6 }, edge: true, label: "https", physical: "the start of the address" };
        a["urlbar.schemeS"] = { x: tx + 4.5 * adv + S_INK_EM.x * fs, y: y + S_INK_EM.y * fs, r: 0.62 * fs, label: "the S of https", physical: "S = secure: the connection is locked (TLS)" };
      }
    }
    return a;
  },
  describe: (_s, p) => `Phone screen=${p.screen}${p.screen === "login" ? ` passwordDots=${p.dots}` : p.screen === "page" ? ` page=${p.pageAsset ?? "none"}` : p.screen === "post" ? ` photo=${p.photo} + Post button` : ""}${p.bar === "none" ? "" : ` bar="${phoneUrl(p.host, p.bar)}"${p.lock ? " +padlock" : ""}${p.highlight !== "none" ? ` highlight=${p.highlight}` : ""}`}`,
};
