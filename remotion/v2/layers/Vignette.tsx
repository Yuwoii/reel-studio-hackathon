// Radial vignette over everything (amendments §3c). No film grain: it was invisible after Instagram's H.264 and cost
// +114 % render time (R2).
import React from "react";
import { AbsoluteFill } from "remotion";
import { vignetteCss } from "../theme";

export const Vignette: React.FC = () => <AbsoluteFill style={{ pointerEvents: "none", background: vignetteCss }} />;
