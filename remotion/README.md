# Reel Studio — Remotion component library (draft README section)

Remotion **4.0.534** project. The director never writes React: it emits `script.json` + `config.json`
(validated by `src/schema`), and this fixed library renders them. Entry: `remotion/index.ts`, composition id
**`Reel`** (1080×1920, 30 fps).

## inputProps contract

`ReelProps` from `src/schema/index.ts` (+ optional `debugSafeZone: boolean`, draws the safe zone + layout bands):

| field | notes |
|---|---|
| `script`, `config` | zod-parsed (defaults applied). The composition re-fills defaults defensively (`normalize.ts`), so hand-written JSON also renders. |
| `audio[i]` | one entry per beat, same order. `durationSec` = exact mp3 length (ffprobe). `words` = timings in ms relative to the beat's own audio. |
| `audio[i].url` | `https://…` / `http://…` / `data:` → used as-is (**Lambda: S3 URLs**). Anything else is a path inside the Remotion public dir → `staticFile()` (local dev). `""` = silent. |

- Duration: `calculateMetadata` → Σ `ceil((durationSec + 0.3) × 30)` per beat (`timing.ts`, kept identical to
  `src/schema` `beatFrames()` by `test/remotion-timing.test.ts`). A missing audio entry renders as a 3 s silent beat.
- Audio component: `Html5Audio` from `remotion` (the non-deprecated name of the classic `<Audio>`). During rendering the
  asset is downloaded server-side by the renderer, so plain https S3 URLs work on Lambda without CORS. (`@remotion/media`'s
  `<Audio>` decodes in the browser and would need CORS on the bucket.)
- Captions are the **exact** narration tokens (`narration.split(/\s+/)`, punctuation attached); `words` only supply timing
  (`captionAlign.ts` aligns differently tokenised TTS/whisper words and interpolates gaps).
- Fonts are bundled in `public/fonts/` (OFL, from github.com/google/fonts: Montserrat variable, Press Start 2P, Silkscreen)
  and loaded with `@remotion/fonts` + `staticFile` → work offline on Lambda. The site's `public/` must contain only fonts.

## Layout (`safeZone.ts`)

Safe zone: top 150, bottom 350, right 120 px (text keeps a 60 px left margin). Bands inside it:
HUD 166–300 · on-screen text 312–480 · **stage** 490–1230 (props/characters) · captions 1250–1554. Characters stand on
`GROUND_Y = 1185`. Prop `x`/`y` (0..1) map into the **stage** (= safe zone minus the text bands), so scene elements
never collide with text; every text element is clamped into `TEXT_BOX`.

**Camera-aware framing** (`safeZone.ts`, bottom): the camera pushes in (up to `zoom` × drift overscale × push) and drifts,
so a scene x that is on screen at frame 0 can be off screen later. `visibleSceneRange(cam)` gives the scene-space range
that stays visible for the WHOLE beat (worst-case `maxScale` + `amp` from `computeCamera`). Characters clamp their full
measured extent (`figureExtent()` per body plan: fluffy tail/scallops, raised arms, fx) into it and shrink if it is too
narrow; props (`placeProp()`) clamp into it too and step off character boxes (`characterLayout()`) to the nearer side or
above the head. Adding a species with a wider silhouette → update `figureExtent()`.

**recurring.values**: a `counter` HUD whose label matches `script.recurring.label` shows `values[round(value) − initial]`
instead of the number; if no counter matches, a `LABEL value` chip appears in the free top-centre slot, advancing evenly
over the beats (`hudValues.ts`).

**Captions** chunk at sentence punctuation, after commas (2+ words), else at `chunkSize`, carrying trailing function
words ("and the") into the next chunk so no chunk ends on one (`chunkTokens()` in `captionAlign.ts`).

## Structure

```
index.ts Root.tsx ReelComposition.tsx   entry, composition, per-beat <Sequence> + scene stack
timing.ts safeZone.ts normalize.ts      contracts mirrored from src/schema (types only imported)
captionAlign.ts hudValues.ts textFit.ts synthAudio.ts color.ts fonts.ts   pure helpers (unit-tested)
styles/{flat,pixel,types,index}.ts      style = 6-role palette + fonts + texture/render rules
components/  Background Props Character Particles HUD Captions OnScreenText Transition CameraDrift PixelLayer Texture SafeZoneDebug
```

Scene stack per beat: Background → Props → Characters → Particles (inside `CameraDrift`, inside `PixelLayer` for the
pixel style) → Texture → HUD → OnScreenText → Captions → transition overlays. Every random value uses remotion's seeded
`random()`; nothing uses `Math.random`.

**Pixel style** = an SVG filter on the scene layer (sample one pixel per 9×9 cell → dilate), screen-aligned, so all
shapes become real pixel art while text layers (pixel font) stay crisp.

## Adding things

Every catalogue list in `src/schema/library.ts` is consumed through an **exhaustive `switch` with
`const _x: never = v`** — add an entry there and `npx tsc --noEmit -p remotion/tsconfig.json` fails until it is drawn:

| catalogue | implement in |
|---|---|
| `STYLES` | new `styles/<name>.ts` (`StyleDef`) + `getStyle()` in `styles/index.ts`; font files → `public/fonts/` + `fonts.ts` |
| `BACKGROUNDS` | a preset function + `renderPreset()` in `components/Background.tsx` (use `<Parallax depth>` layers, `c.t()` for time-of-day tint, add ambient motion) |
| `SPECIES` | `anatomy()`, `headBack()`, `headFront()`, `bodyAndLimbs()` in `components/Character.tsx` |
| `ACCESSORIES` / `ACTIONS` | `accessoryBack/Front()` / `poseFor()` (+ `Fx`) in `Character.tsx` |
| `PROPS` / `PROP_ANIMATIONS` | `defaultColor()` + `drawProp()` (±50 unit box) / `animTransform()` in `components/Props.tsx` |
| `PARTICLES`, `TRANSITIONS`, `CAMERA_DRIFT`, `HUD_KINDS`, `HUD_SLOTS` | `Particles.tsx`, `Transition.tsx`, `CameraDrift.tsx`, `HUD.tsx` |

Then: typecheck, `npm test`, look at stills (below), and **redeploy the Lambda site** (`scripts/deploy-site.sh`).

## Dev loop

```bash
npm run studio                                              # Studio, defaultProps = snow sample, synthetic silent timings
npx tsx scripts/remotion-fake-props.ts samples/doodle-flat  # props.json + silent mp3s → jobs/_dev/remotion/doodle-flat/
npm run remotion:stills -- samples/doodle-flat [--debug] [--style=pixel] [--frames=45,300]
# one bundle + one browser; stills at 60 % of each beat + frame 45 + last frame → jobs/_dev/remotion/<sample>/stills*/
npm run remotion:gallery -- --style=flat|pixel                # every species/accessory/action/background/particle/prop
# → jobs/_dev/remotion/gallery-<style>/b<NN>-<preset>.png + sheet.png (look at it after touching a component)
D=jobs/_dev/remotion/snow-pixel; nice -n 19 npx remotion render remotion/index.ts Reel $D/seg.mp4 \
  --props=$D/props.json --public-dir=$D/public --frames=0-119 --concurrency=2
```

The fake-props dir has its own `public/` (fonts copy + `audio/`) because local audio must be served from the public dir;
never put dev audio into the repo's `public/` (it would be uploaded with the Lambda site).
