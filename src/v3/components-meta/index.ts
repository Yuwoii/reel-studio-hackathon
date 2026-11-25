// v3 component metas (W3a), container side. The Remotion side is remotion/v3/components/index.ts.
import type { AnyV3Meta } from "./_types.js";
import { meta as AnchorRing } from "./AnchorRing.js";
import { meta as BrowserWindow } from "./BrowserWindow.js";
import { meta as Building } from "./Building.js";
import { meta as Envelope } from "./Envelope.js";
import { meta as Glow } from "./Glow.js";
import { meta as Headphones } from "./Headphones.js";
import { meta as LabelPill } from "./LabelPill.js";
import { meta as Model3D } from "./Model3D.js";
import { meta as Phone } from "./Phone.js";
import { meta as Plate } from "./Plate.js";
import { meta as Router } from "./Router.js";
import { meta as ServerRack } from "./ServerRack.js";
import { meta as Spotlight } from "./Spotlight.js";
import { meta as Trace } from "./Trace.js";
import { meta as WatchBack } from "./WatchBack.js";
import { meta as CaptionScrim } from "./CaptionScrim.js";
import { meta as LockBox } from "./LockBox.js";
import { meta as Padlock } from "./Padlock.js";
import { meta as PhotoCard } from "./PhotoCard.js";
import { meta as Snooper } from "./Snooper.js";
import { meta as WebsiteCluster } from "./WebsiteCluster.js";
import { meta as WifiSignal } from "./WifiSignal.js";
import { meta as SkinPPG } from "./SkinPPG.js";
import { meta as WaveCancel } from "./WaveCancel.js";
import { meta as WeeksPoster } from "./WeeksPoster.js";
import { meta as LeafSection } from "./LeafSection.js";
import { meta as Plant } from "./Plant.js";

export const V3_METAS: Readonly<Record<string, AnyV3Meta>> = {
  Plate, BrowserWindow, WatchBack, Phone, ServerRack, Building, Envelope, Router, Headphones,
  AnchorRing, LabelPill, Spotlight, Glow, Trace, Model3D,
  PhotoCard, Padlock, LockBox, WebsiteCluster, Snooper, WifiSignal, CaptionScrim,
  SkinPPG, WaveCancel,
  WeeksPoster,
  LeafSection, Plant,
};
export const V3_COMPONENT_IDS = Object.keys(V3_METAS);
