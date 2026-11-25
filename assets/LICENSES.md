# Third-party assets: licences and provenance

Every bundled asset is listed here with its source, licence and checksum. The licence text sits next to each font
file in `public/fonts/` (that directory is uploaded with the Lambda site by `scripts/deploy-site.sh`, which refuses
any file outside `public/fonts/`).

## Fonts (`public/fonts/`)

All fonts are SIL Open Font License 1.1. They are loaded locally with `@remotion/fonts` `loadFont()` + `staticFile()`,
so a render never fetches fonts from the network (v2 decision: D1 #11, RESEARCH.md §9 edit #7, R2 §3).

| File | Family / version | Used by | Source | Licence file | sha256 |
|---|---|---|---|---|---|
| `Inter-Variable.ttf` | Inter 4.001 (git-66647c0bb), variable axes opsz 14–32, wght 100–900 | v2 (sans: headings, subtitles) | The Inter Project, https://github.com/rsms/inter (copied from the R2 lab, `research/lab/public/fonts/`) | `OFL-Inter.txt` | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` |
| `JetBrainsMono-Variable.ttf` | JetBrains Mono 2.211, variable axis wght 100–800 | v2 (mono: labels, data, header, pills) | JetBrains, https://github.com/JetBrains/JetBrainsMono (copied from the R2 lab, `research/lab/public/fonts/`) | `OFL-JetBrainsMono.txt` | `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` |
| `Montserrat-Variable.ttf` | Montserrat (variable wght) | v1 | https://github.com/google/fonts | `OFL-Montserrat.txt` | `0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7` |
| `PressStart2P-Regular.ttf` | Press Start 2P | v1 | https://github.com/google/fonts | `OFL-PressStart2P.txt` | `034c77f1f05ec89421e4a63f0e3a4ca1ecf852cc6d2bf611f126f275728e017d` |
| `Silkscreen-Regular.ttf`, `Silkscreen-Bold.ttf` | Silkscreen | v1 | https://github.com/google/fonts | `OFL-Silkscreen.txt` | `c845473330b94c2079ce9af01c51ac8ba2d99c24f4d14c039843bbb8e642ebd8`, `768476aa712d4f5c3e18d3bce80f980a8bd3f72b7094d22ec5e768df3acfed61` |

**Glyph allow-list (lint L19).** On-screen text may only use printable ASCII, Latin-1 (U+00A0–U+00FF) and
`→ · ● — … ≥ µ`. Checked with fontTools on 2026-10-24: both v2 fonts map every one of these code points. Known gaps
(R2 §3): Inter has no `▮` (U+25AE) or `█` (U+2588); JetBrains Mono has no `✓` `✗` `▮`. Those characters are outside
the allow-list, so the lint rejects them before any render.

## SFX and music (`assets/sfx/`, `assets/music/`)

v2 SFX and the music bed are **synthesised in-house** with ffmpeg (D1 #4). No samples, presets, loops, recordings,
stock libraries or generative-AI audio are used, so there is **no third-party material** and no licence to comply
with: own work, licensed with the rest of this repository. Noise sources use fixed seeds (`anoisesrc seed=7/3`,
`adecorrelate seed=7`, `random(n)` expression state), so the files are reproducible.

- **Generator:** `scripts/v2/audio-assets.sh` (graphs ported from R4: `research/audio/music/make-bed.sh`,
  `research/audio/sfx/make-sfx.sh`), run in a throwaway container of the reel-studio image, ffmpeg
  5.1.9-0+deb12u1. **Commit:** the commit that adds these files (`git log -- assets/audio-manifest.json`).
- **Verify:** `scripts/v2/audio-assets.sh --check` regenerates everything and compares it byte-for-byte with
  `assets/`; `assets/audio-manifest.json` holds sha256, duration, sample rate and the measured loudness of every file;
  `test/v2-audio-assets.test.ts` checks the manifest against the files.
- **Format:** 48 kHz stereo 16-bit PCM WAV (source of truth). `assets/sfx/levels.json` is the per-SFX event loudness
  (max momentary LUFS) the mixer uses.

| File | Use | Generator recipe (`scripts/v2/audio-assets.sh`) | Length | sha256 |
|---|---|---|---|---|
| `music/dark-amin-100bpm-72s.wav` | music bed (default, `music.bed: "dark-amin-100bpm-72s"`) | `dark-amin-100bpm-72s.filtergraph.txt` (bed graph: A-min-7 drone, 100 BPM sub pulse, noise air, synthetic `afir` reverb; static gain to −20 LUFS) | 72.000 s, loop-seamless | `3b036fc0e395c2cef1b4a458f56c59fc538d0b3ae772f0dd29aae513e1906664` |
| `sfx/tick.wav` | SFX `tick` | `G_tick`: 2.8 kHz sine blip + 1 ms noise click; peak −1 dBFS | 0.060 s | `684f591ea4d2346b0cfb3f389044909d632182ec26a0e2d41e567b2ac358f9f3` |
| `sfx/whoosh.wav` | SFX `whoosh` | `G_whoosh`: pink noise (seed 3) through 3 enveloped band-passes; peak −1 dBFS | 0.600 s | `dd86ca19bfe6a771067ae924dfbaaa5d9e383c6aae88d364016226c3df079787` |
| `sfx/glitch.wav` | SFX `glitch` | `G_glitch`: pitch-hopping square tones, gated, 6-bit `acrusher`; peak −1 dBFS | 0.280 s | `4fdf9b6f7577b2e7908af1e925b8ef4e33b623d3cc5e8298c7b0966d0d0a173e` |
| `sfx/thud.wav` | SFX `thud` | `G_thud`: sine 120→38 Hz + low-passed noise transient; peak −1 dBFS | 0.800 s | `c1a4f80b7fb3b16888959296fc7719f51e86ceff2872b6ace3585f13bc7adbc8` |
| `sfx/chatter.wav` | SFX `chatter` | `G_chatter`: 25 ticks/s, 7-step pitch hops; peak −1 dBFS | 1.200 s | `16e6c6b6674c23982ca463fb1e9ea0c09f838d4f8e2718115fac962bf0b8f0c6` |
