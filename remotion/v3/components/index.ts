// v3 library components (W3a): real-object devices, the Plate, Model3D and the screen-space overlays. Each is a v2
// LibraryComponent (defineComponent) so the v2 slot renders it; its v3 meta (anchors/describe) lives in
// src/v3/components-meta/<Name>.ts. W3b registers these next to the v2 registry for ExplainerV3.
import { AnchorRing } from "./AnchorRing";
import { BrowserWindow } from "./BrowserWindow";
import { Building } from "./Building";
import { Envelope } from "./Envelope";
import { Glow } from "./Glow";
import { Headphones } from "./Headphones";
import { LabelPill } from "./LabelPill";
import { Model3D } from "./Model3D";
import { Phone } from "./Phone";
import { Plate } from "./Plate";
import { Router } from "./Router";
import { ServerRack } from "./ServerRack";
import { Spotlight } from "./Spotlight";
import { Trace } from "./Trace";
import { WatchBack } from "./WatchBack";
import { CaptionScrim } from "./CaptionScrim";
import { LockBox } from "./LockBox";
import { Padlock } from "./Padlock";
import { PhotoCard } from "./PhotoCard";
import { Snooper } from "./Snooper";
import { WebsiteCluster } from "./WebsiteCluster";
import { WifiSignal } from "./WifiSignal";
import { SkinPPG } from "./SkinPPG";
import { WaveCancel } from "./WaveCancel";
import { WeeksPoster } from "./WeeksPoster";
import { LeafSection } from "./LeafSection";
import { Plant } from "./Plant";

export const V3_COMPONENTS = { Plate, BrowserWindow, WatchBack, Phone, ServerRack, Building, Envelope, Router, Headphones, AnchorRing, LabelPill, Spotlight, Glow, Trace, Model3D,
  // S2 (2026-11-02): the cat-picture TLS reel
  PhotoCard, Padlock, LockBox, WebsiteCluster, Snooper, WifiSignal, CaptionScrim,
  // 2026-11-03 mechanism components (W4 watch-hr / anc review)
  SkinPPG, WaveCancel,
  // 2026-11-10 concept-topic device (rs-20261109-25f1a4 memento mori)
  WeeksPoster,
  // 2026-11-10 plants (rs-20261110-61f00b C3 / C4 / CAM)
  LeafSection, Plant } as const;
export type V3ComponentId = keyof typeof V3_COMPONENTS;
