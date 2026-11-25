// Instagram Reels safe zone + the vertical layout bands every component uses. Text (HUD, on-screen text,
// captions) must stay inside SAFE; the "stage" (props/characters) is the safe zone minus the text bands so
// scene elements never collide with text. Props' x/y (0..1) map into STAGE.

export const FRAME = { width: 1080, height: 1920 } as const;

/** Reels UI covers the top 150 px, bottom 350 px and right 120 px. */
export const SAFE = { top: 150, bottom: 1920 - 350, left: 0, right: 1080 - 120 } as const;

/** Horizontal margin kept for text on the left edge (left inset is 0, but text touching the edge looks broken). */
export const TEXT_MARGIN_X = 60;

/** Text box: safe zone minus the text margin. Every text element is clamped into this rectangle. */
export const TEXT_BOX = { left: SAFE.left + TEXT_MARGIN_X, right: SAFE.right - 24, top: SAFE.top + 16, bottom: SAFE.bottom - 16 } as const;

/** Vertical bands (px) inside the safe zone. */
export const BANDS = {
  hud: { top: TEXT_BOX.top, bottom: 300 },
  title: { top: 312, bottom: 480 },
  stage: { top: 490, bottom: 1230 },
  captions: { top: 1250, bottom: TEXT_BOX.bottom },
} as const;

/** y (px) where characters stand; backgrounds put their ground surface around here. */
export const GROUND_Y = 1185;

/** Horizontal centre of the safe zone (text is centred here, not at 540, because the right inset is 120 px). */
export const SAFE_CX = (SAFE.left + SAFE.right) / 2;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Map a prop's 0..1 coordinates into the stage, keeping a `radius` px box fully inside it. */
export function stagePoint(x: number, y: number, radius = 0): { x: number; y: number } {
  const l = SAFE.left + radius;
  const r = SAFE.right - radius;
  const t = BANDS.stage.top + radius;
  const b = BANDS.stage.bottom - radius;
  return {
    x: l <= r ? clamp(SAFE.left + clamp(x, 0, 1) * (SAFE.right - SAFE.left), l, r) : SAFE_CX,
    y: t <= b ? clamp(BANDS.stage.top + clamp(y, 0, 1) * (BANDS.stage.bottom - BANDS.stage.top), t, b) : (BANDS.stage.top + BANDS.stage.bottom) / 2,
  };
}

/** Clamp a text rectangle (x = left, y = top) so it lies inside TEXT_BOX. */
export function clampTextRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const ww = Math.min(w, TEXT_BOX.right - TEXT_BOX.left);
  const hh = Math.min(h, TEXT_BOX.bottom - TEXT_BOX.top);
  return { x: clamp(x, TEXT_BOX.left, TEXT_BOX.right - ww), y: clamp(y, TEXT_BOX.top, TEXT_BOX.bottom - hh), w: ww, h: hh };
}

// ── camera-aware framing (shared by the camera, characters and props) ──────────────────────────────────────────
// Which scene-space region stays on screen for a whole beat given the camera's worst-case push-in + drift, and
// where a prop may sit.

/** The part of the camera state framing needs (worst case over the beat). */
export interface CameraBounds {
  maxScale: number;
  amp: number;
}

/** Vertical origin of the camera's scale (stage centre). */
export const CAM_ORIGIN_Y = (BANDS.stage.top + BANDS.stage.bottom) / 2;

/** Like visibleSceneRange, vertically (vertical drift amplitude is amp/2). */
export function visibleSceneRangeY(cam: CameraBounds, screenT: number, screenB: number): [number, number] {
  const s = Math.max(1, cam.maxScale);
  const a = cam.amp * 0.5;
  return [CAM_ORIGIN_Y + (screenT - CAM_ORIGIN_Y + a) / s, CAM_ORIGIN_Y + (screenB - CAM_ORIGIN_Y - a) / s];
}

/** Horizontal origin of the camera's scale (screen x = CAM_ORIGIN_X + (x - CAM_ORIGIN_X) * scale + camera x). */
export const CAM_ORIGIN_X = SAFE_CX;

/**
 * Scene-space x range that stays on screen inside [screenL, screenR] for the whole beat, whatever the drift
 * phase and push-in. Characters clamp against this so a zoomed / drifting camera never crops them.
 */
export function visibleSceneRange(cam: CameraBounds, screenL: number, screenR: number): [number, number] {
  const s = Math.max(1, cam.maxScale);
  return [CAM_ORIGIN_X + (screenL - CAM_ORIGIN_X + cam.amp) / s, CAM_ORIGIN_X + (screenR - CAM_ORIGIN_X - cam.amp) / s];
}


/** Axis-aligned box a prop should not sit on (characters). */
export interface AvoidBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Final prop centre: inside the stage, inside what the (zoomed, drifting) camera shows for the whole beat, and
 * nudged off any character box (to the nearer free side, else above the head) so props never sit on a face.
 */
export function placeProp(x: number, y: number, r: number, cam: CameraBounds, avoid: AvoidBox[]): { x: number; y: number } {
  const pos = stagePoint(x, y, r);
  const [visL, visR] = visibleSceneRange(cam, 16, SAFE.right);
  const lo = visL + r;
  const hi = visR - r;
  let px = lo <= hi ? clamp(pos.x, lo, hi) : (visL + visR) / 2;
  // vertically: keep the prop's top inside the stage band as the camera pushes in (don't crowd the title)
  const [visT, visB] = visibleSceneRangeY(cam, BANDS.stage.top, BANDS.stage.bottom);
  let py = visT + r <= visB - r ? clamp(pos.y, visT + r, visB - r) : pos.y;
  const rr = r * 0.8; // drawing is ~±50 units of the 60-unit radius
  for (const b of avoid) {
    const hit = px + rr > b.left && px - rr < b.right && py + rr > b.top && py - rr < b.bottom;
    if (!hit) continue;
    const cands: { x: number; y: number }[] = [];
    if (b.left - rr >= lo) cands.push({ x: b.left - rr, y: py });
    if (b.right + rr <= hi) cands.push({ x: b.right + rr, y: py });
    if (b.top - rr >= BANDS.stage.top + r * 0.5) cands.push({ x: px, y: b.top - rr });
    if (cands.length === 0) continue;
    const best = cands.reduce((a, c) => (Math.hypot(c.x - px, c.y - py) < Math.hypot(a.x - px, a.y - py) ? c : a));
    px = best.x;
    py = best.y;
  }
  return { x: px, y: py };
}

