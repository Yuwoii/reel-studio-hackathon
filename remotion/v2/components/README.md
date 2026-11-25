# v2 component library — the W2 contract

Every ROOT CAUSE reel is the fixed `Explainer` composition fed with data (D1 #7, ADR-001 §2). The look is bounded by
this library: a storyboard instance names a component id + props, and actions (`enter`, `state`, `pulse`, …) drive
it on frames that `resolveTimeline()` resolves. New components only arrive through a supervised library release.

**StatusCard is the worked template.** Copy its four files when you add a component.

| File | What | Runtime imports allowed |
|---|---|---|
| `src/v2/components-meta/<Name>.ts` | `export const meta = {…} satisfies ComponentMetaDef<typeof Props>` + the zod props schema (+ layout constants shared with the Render) | **`zod` only** (+ `import type` from `./_types.js`) |
| `remotion/v2/components/<Name>.tsx` | `export const <Name> = defineComponent({ ...meta, Render })` | `react`, `remotion`, `@remotion/paths`, `../motion`, `../theme`, `./contract`, `./primitives`, the meta file (extensionless) |
| `test/fixtures/v2/components/<Name>.json` | gallery fixture (enter, ≥1 state/verb change, exit, ≥3 golden `stills`) | — |
| `test/v2-components.test.ts` (extend) or `test/v2-component-<name>.test.ts` | meta / footprint / RenderProps / markup unit tests | — |

Then run `npm run v2:gen-registry` (regenerates `src/v2/registry.gen.ts`, `src/v2/components-meta/index.ts`,
`remotion/v2/components/index.ts`), `npm run typecheck`, `npm test`. `npm test` fails while the generated files are
stale (the hash covers every library source), so a component edit always ends with a regenerate.

## 1. The meta (`ComponentMetaDef`, `src/v2/components-meta/_types.ts`)

| Field | Rule |
|---|---|
| `name` | PascalCase, = file name = `Instance.component`. New ids are appended to `LIBRARY_IDS`; ids in `_library.ts` `LIBRARY_ORDER` keep their slot. |
| `version` | Integer ≥ 1; bump on any visual or behaviour change. |
| `tier`, `spec`, `summary`, `families` | Tier per ADR §5 (`core`, `figure`, `p0`…`p3`); spec source (`bible §6.1`, `R7 N-6`); one-line summary for the director; R7 families. |
| `propsSchema` | A **strict** `z.object` of **content + Tone only** — strings, numbers, enums, small arrays. Never a colour, size or position (colours come from states/Tone → theme tokens; position from the instance). Bound every string (`max`) so the footprint can be honest. Tone props use exactly `["accent","danger","neutral","dim"]` (redeclare it: no relative runtime imports; the generator checks the values). |
| `propsSchemaName`, `example` | Exported schema name; a minimal valid props object (drives the generated static footprint and the tests). |
| `states`, `initialState` | Named states for `do: "state"`; first = default unless `initialState(props)` says otherwise. Every state change animates. |
| `verbs` | `{ verb: { durF, does, props? } }`. `enter` and `exit` are required. `durF` = frames from the action's anchor until the verb has settled (L20 / review stills use it). `props` = the action-`props` keys this verb may override (e.g. `state` swaps `status`). A shipped component gets an **L1 error** for any verb it does not declare. |
| `focal` | Counts toward the ≤ 3 focal budget (L4). Focal components draw an opaque plate. |
| `footprint(props, w)` | Unscaled world box for these props at instance width `w` (undefined = default width). **Must be honest:** the Render never draws outside it (L3 safe zone, L4 overlap, culling and the camera's `{instance}` targets all use it). Widen for long text rather than letting it overflow; cap at 952 (x 64–1016). The box is computed from the **base** props and stays fixed for the instance's life — size it for the longest text an override may bring. |
| `flight?` | Only for components that move themselves through the world (RequestPill, NodeGraph packets): `verbs`, `durF`, `peakPxPerF` (blur windows, L9, L21). These are the **bounds**: with `flightFor` they cap it; without it they ARE the flight. `samplePx` (W2.1 r1) is **not honoured** — the timeline ignores it and every blur window keeps the 1 px sub-sample rule (`BLUR_PX_PER_SAMPLE`, cap 32); do not set it. |
| `flightFor?(props, w)` | Optional, props-aware (W2.1): the own speed (unscaled world px/f, index k = anchor + k → k + 1) of ONE flight-verb action, given the props in force at that action (base + accepted overrides, its own included) and the instance `w`. `[]` = this action does not fly (e.g. a NodeGraph `mark` without a packet). Every value ≤ `flight.peakPxPerF`, length ≤ `flight.durF`; requires `flight`. Pure. Blur windows and L21 use it instead of the static profile. |
| `sfx` | Suggested SFX per verb (`tick`, `whoosh`, `thud`, `chatter`, `glitch`, `silenceHole`). The director places them; nothing adds SFX automatically. |
| `enterExit` | `"wrapper"` (default: the slot applies the shared spring entrance + 8 f exit) or `"self"` (the Render animates its own; the slot only culls before `enterF` and after `exitF + verbs.exit.durF`). A `"self"` component on an **opaque plate** must use `plateFade()` (plate first in, content first out — never fade the plate and its text together over the field). |

The generator (`scripts/v2/gen-registry.ts`, `validateMeta`) rejects a meta that breaks any of these.

## 2. The Render (`remotion/v2/components/contract.ts`)

`Render: React.FC<RenderProps<P>>` is a **pure function of its props** — no `useCurrentFrame`, no state, no effects.
The slot (`Slot.tsx`) passes:

| RenderProps | Meaning |
|---|---|
| `props`, `prev`, `changeF` | props in force at this frame (base + accepted overrides), the props before the latest override, and its frame → `scramble(prev.x, props.x, f, changeF, 8, seed)` |
| `base` | parsed base props |
| `frame`, `f` | fractional frame (blur sub-samples: continuous motion) and `Math.floor(frame)` (**every discrete value**: digits, typed chars, scramble glyphs, glitch frames) |
| `size` | `meta.footprint(base, inst.w)` — draw inside `0..size.w × 0..size.h` |
| `state` | `{ name, f, prev }` — `f` = frame the state was entered (`null` = initial) |
| `events`, `last(verb)` | all resolved actions in frame order; latest frame ≤ f of a verb |
| `enterF`, `exitF` | for `enterExit: "self"` components |
| `id` | the instance id — prefix every `random()` seed with it |

House rules (amendments §2/§7, ADR §5): theme tokens only (`color.*`, `type.*`, `radius.*` from `../theme`; no hex,
`rgb()` or named colours anywhere in component code), text at its final px size (≥ 26 px; never scale text to fit),
no `Math.random` / `Date`, no `will-change` / `translateZ`, opaque plates for focal elements (`dangerSurface`, never
`dangerBg` over the field), text colours snap rather than fade between lime and red (a fade passes through orange).

Motion vocabulary — use these, never a local variant (`../motion.ts`, `./primitives.tsx`):

| Need | Helper | Spec |
|---|---|---|
| entrance / exit | slot wrapper (`enterExitStyle`); `enterProgress`, `exitProgress` for self-animated parts | spring d200 s180 m0.6 (99 % ≈ f12); 8 f opacity + blur 0→8 px |
| plate-first entrance / content-first exit | `plateFade()` (`components/plateFade.ts`) for opaque-plate components with `enterExit: "self"` | plate opaque by spring 0.5 (≈ 3 f), content 3 f later; exit: content fades + blurs 4 f on the opaque plate, then the plate 4 f (total 8 f) |
| lists | `stagger(i, startF, 3)`, `staggerEnter` | 3–4 f |
| label/number changes | `scramble(from, to, f, startF, 8, seed, opts)` — the ONE scramble (`textScramble.ts` `diffScramble` is a compat shim over it) | 6–8 f left-to-right; class-preserving (A–Z / a–z / 0–9 roll in their own class; punctuation and spaces never). **Value overrides use `{ changedOnly: true }`** (the default for `prev.x → props.x`): the common prefix/suffix and unchanged glyphs hold, only the changed span rolls. `{ align: "right" }` pads on the left (right-aligned labels); `{ keepSame: true }` holds equal glyphs after alignment; `{ holdDigits: true }` never rolls a digit (an unsettled digit shows the old one, then steps once: header "STEP n/4"). `from === to` = in-place re-scramble (everything but held digits rolls). |
| glitch | `activeGlitch(frames, frame)` + `<Glitch>` (`glitchAt`) | 4 f; fixed `danger` / `text` tinted copies ±8 px; 6 slices ±24 px; flicker. `clip` (`GlitchClip`: `inset`, `r`, optional x/y/w/h) confines copies and slices to the plate's rounded inner rect; with `plate` only the content layer is glitched (PLATE_GLITCH tints danger / accent) and the plate surface never changes. `<TokenGlitch>` (per-token glitch): `tints` swaps the danger / text pair (e.g. danger / accent on a light card), `clip` keeps copies and bands inside its w × h box. |
| count-up | `countUp(to, frame, startF, 20)` + `formatCount` | ease-out cubic, discrete, en-US grouping, `tabular-nums` |
| draw-on | `drawOn(frame, startF, 16)` + `<DrawPath>` (`evolve`) | bible bezier; dashed strokes through a mask |
| danger pulse | `pulse(frame, fromF)` | 0.7↔1 per 20 f, never faster |
| impact | `squash(frame, atF)` | 1 → 0.96 → 1 over 6 f |
| terminal typing | `typing(text, frame, startF, 2)` + `<Caret>` | 2 chars/f; caret solid while typing, blinks 16 f |
| state colours | `stateMix(frame, state.f)` | 6 f plate cross-fade |
| keyword kick / glow | `flash(frame, last("focus"), 4)` | decays ≈ 10 f |

## 3. Slot wiring (Explainer)

`World` renders every instance through `<Slot>`: it looks the id up in the generated `LIBRARY` map
(`components/index.ts`), parses `inst.props` with `propsSchema` (defaults filled), folds action `props` overrides
into a props timeline (only keys the verb allows; dropped overrides are L1 errors in the lints), resolves the state,
and calls the Render inside the shared enter/exit wrapper and `inst.scale`. Ids without a shipped component
(`planned: true` in the registry) and instances whose props fail their schema render **PlaceholderCard** (with a
console warning for the latter). Boxes everywhere — lints (`src/v2/library.ts`), `resolveTimeline`, the World — come
from the same props-aware lookup (`components-meta/_lookup.ts buildFootprintLookup`).

## 4. Fixtures and the V2Gallery composition

`V2Gallery` (`remotion/v2/Gallery.tsx`, registered in `remotion/Root.tsx`) renders ONE component standalone on the
persistent layers — data field, header (`ROOT CAUSE · GALLERY`, right label `<NAME> V<version>`), footer, vignette —
under a static camera (+2 % hold drift). The instance's box centre sits on the camera anchor (540, 855), so at zoom 1
world = screen. It uses the same World → Slot path and track builder (`world.ts buildTrack`) as the Explainer.

Fixture = the composition's inputProps (`src/v2/components-meta/_fixture.ts`):

```json
{
  "component": "StatusCard",
  "props": { "label": "checkout-api", "status": "Running", "tone": "neutral" },
  "w": 760,
  "timeline": [
    { "f": 6, "do": "enter" },
    { "f": 48, "do": "state", "state": "danger", "props": { "status": "OOMKilled" } },
    { "f": 146, "do": "exit" }
  ],
  "durationF": 160,
  "preset": "logs",
  "seed": "statuscard",
  "stills": [24, 52, 70],
  "note": "what each still shows"
}
```

Optional: `scale` (0.5–2), `zoom` (static camera, 0.6–2.2), `blurSamples` (> 1 wraps the world in the tent
`WeightedMotionBlur` on every frame — for flight components), `debug` (dashed footprint outline + frame number).
A fixture must: parse, use only declared verbs/states/override keys, cover enter + at least one change + exit, and
list ≥ 3 golden `stills` (the release gate renders 3 of them as Lambda stills). The gallery throws on an unknown id,
an invalid fixture, or a glyph outside the L19 allow-list.

Review renders run on Lambda only (no local renders on NUC 1), with a fixture as inputProps of composition
`V2Gallery` on the dev site, e.g. stills at the fixture's `stills` frames. Open every still you make a claim about.

## 5. Checklist for a packet

1. `src/v2/components-meta/<Name>.ts` — schema (strict, bounded strings, Tone only), meta, layout constants.
2. `remotion/v2/components/<Name>.tsx` — `defineComponent({ ...meta, Render })`, tokens only, pure.
3. `test/fixtures/v2/components/<Name>.json` — enter, a state/verb change, exit, ≥ 3 stills with a `note`.
4. Tests: footprint (default, `w`, long text), props rejects colours/unknown keys, props/state timeline, server markup
   at the still frames (`react-dom/server` `renderToStaticMarkup` of `Render` with `renderPropsAt()`; see the
   StatusCard tests), determinism (`frame` and `frame + 0.4` give identical discrete text).
5. `npm run v2:gen-registry && npm run typecheck && npm test` — all green. Don't hand-edit generated files.
