// v3 component tokens on top of remotion/v2/theme.ts (the v2 bible tokens stay the single source for everything else).
// The ONE new UI colour is the watch LED green (v2 has no green; flagged in R3 PROOF-SPEC §P2): it is only ever used
// for light that is physically green (PPG LEDs and the light they return), never as a UI accent.
import { color } from "../../v2/theme";

export const LED_GREEN = { r: 72, g: 255, b: 120 } as const;
export const LED_GREEN_HEX = "#48FF78";
export const ledGreen = (a: number) => `rgba(${LED_GREEN.r}, ${LED_GREEN.g}, ${LED_GREEN.b}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Drawn tissue + blood of the SkinPPG cross-section (2026-11-03 mechanism components). PHYSICAL colours like the LED
 *  green: blood is red only because blood is red (the "red soaks up green" point), never a UI danger colour; the
 *  tissue layers are dark, desaturated warm greys so the skin reads as skin on the #131313 stage without a photo. */
export const tissue = {
  epidermis: "#3A302D",
  dermis: "#2A2220",
  fat: "#2E2A22",
  fatCell: "rgba(255,240,200,0.07)",
  line: "rgba(255,255,255,0.14)",
  /** blood in the vessels (cut across: discs) */
  blood: "#B3263A",
  bloodDeep: "#6E1424",
  bloodHi: "rgba(255,170,180,0.35)",
  /** "red" label text in the callout (blood red lifted for 26 px text on bgRaised) */
  bloodText: "#FF8A96",
  /** room light leaking under a loose strap (plain white, low alpha) */
  ambient: (a: number) => `rgba(255, 248, 230, ${Math.max(0, Math.min(1, a)).toFixed(3)})`,
} as const;

/** The printed WeeksPoster (2026-11-10): PHYSICAL paper and print inks on a physical poster, like the LED green and
 *  the tissue — never UI colours. The empty-box highlight is the theme's own color.accent (a highlighter on paper),
 *  you-are-here is color.danger. */
export const poster = {
  paper: "#EEEAE1",
  paperLow: "#E4DFD3",
  edge: "#D9D3C6",
  gridLine: "rgba(38,36,31,0.32)",
  text: "#26241F",
  textDim: "rgba(38,36,31,0.62)",
  shadow: (a: number) => `rgba(0, 0, 0, ${Math.max(0, Math.min(1, a)).toFixed(3)})`,
  tape: "rgba(240,236,220,0.55)",
  tapeEdge: "rgba(120,110,90,0.18)",
} as const;
export const posterInk = {
  ink: "#26241F",
  red: "#C8374A",
  blue: "#2E5E8E",
  ochre: "#C58A1A",
  teal: "#23877A",
  plum: "#7B4B8A",
} as const;

/** three.js material inputs (3D only; linear-ish albedo, not UI colours). */
export const mat3d = {
  watchMetal: "#7c7f85",
  watchStrap: "#3a3c40",
  watchBack: "#2a2a2a",
  watchSensorDark: "#101010",
  watchPhotodiode: "#4a4a4a",
  hemiSky: "#ffffff",
  hemiGround: "#202020",
  /** rim lights behind the subject (camera-fixed): separate the dark case/strap from the #131313 ground */
  rim: "#dfe6ff",
} as const;

/** Golden-still probe colour (W3a gallery only, never in a reel): pure magenta, detectable on any plate. */
export const PROBE = "#FF00FF";

export { color };

/** Plants (2026-11-10 LeafSection / Plant): PHYSICAL colours like the LED green and the tissue — leaf green because
 *  leaves are green, sky and soil because they are sky and soil; never UI colours. Carbon dioxide = a dark carbon atom
 *  between two red oxygens (the usual molecule-model colours), water = blue, sugar = amber, the cam acid store = plum,
 *  the c4 4-carbon acid = orange. */
export const plant = {
  leaf: "#3E7A3A",
  leafHi: "#5C9E52",
  leafDeep: "#24502A",
  cell: "#4F8F45",
  cellWall: "#7DBA6B",
  cellDim: "#365F33",
  spongy: "#3F6F3A",
  airSpace: "#18231A",
  skin: "#8DBB7A",
  cuticle: "rgba(220,240,200,0.55)",
  guard: "#6FA85F",
  guardEdge: "#A8D892",
  vein: "#9C8F5A",
  veinEdge: "#C4B677",
  stem: "#4C8A44",
  stemRib: "#2F5E2C",
  spine: "#E8E1C8",
  wheat: "#C9A94E",
  wheatDeep: "#9A7E30",
  soil: "#3A2E24",
  soilHi: "#4A3B2E",
  sand: "#7A6446",
  daySky: "#2B4660",
  nightSky: "#141A2C",
  sun: "#FFD45E",
  moon: "#E6E8F0",
  star: "rgba(235,240,255,0.8)",
  carbon: "#2A2A2A",
  carbonEdge: "#9A9A9A",
  oxygen: "#D9493E",
  water: "#4FA3E0",
  sugar: "#F2B33D",
  store: "#8E5BB0",
  acid4: "#F08A3C",
} as const;
