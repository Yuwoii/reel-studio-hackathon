# Reel Studio: hackathon edition

**Topic in, explainer reel out.** `npm run reel -- make "how does a PCR test work"` → `out/pcr.mp4`: a 1080×1920
narrated, captioned, animated explainer (~45–75 s) with music and sound design.

Pipeline (all local): a Claude director (Claude Agent SDK) researches the topic on the public web and writes a script →
fact-check and "would a non-expert get this?" judges → edge-tts voice (per sentence, word timings) → storyboard of
drawn components → board judges + a frame self-check (renders stills, a vision judge compares picture vs. line) →
Remotion renders the video on your CPU → ffmpeg mixes voice, music bed and SFX to −14 LUFS.

## Quick start

```bash
./setup.sh                 # npm ci, Python venv with edge-tts, Remotion's headless Chrome, then doctor
npm run doctor             # checks ffmpeg, voice, and that Claude answers
npm run reel -- make "how do noise-cancelling headphones work" --slug anc
```

Needs Node 22+, Python 3.10+, ffmpeg. macOS or Linux (Windows: WSL2). Claude: works with the Claude Code login of your
user account, an API key, Bedrock or Vertex (see `CLAUDE.md` → "Claude login").

**Using Claude Code?** Open this folder and say **"start"**. `CLAUDE.md` tells it what to do.

## Commands

```bash
npm run reel -- make   "<topic>" [--slug s] [--fps 30|60] [--no-frame-check]
npm run reel -- draft  "<topic>" [--slug s]          # script + voice + storyboard only
npm run reel -- render <slug> [--fps 60]             # render a saved draft
npm run reel -- revise <slug> "<feedback>"           # change it, re-render
npm run reel -- status <slug>
```

Time: director 10–25 min, render 5–15 min (30 fps, 4–8 cores).

## Licences

Code: private, all rights reserved by the repository owner. Remotion is free for individuals and companies with
≤ 3 employees; anything beyond a hackathon demo inside a larger company needs a
[Remotion company licence](https://www.remotion.dev/license). Fonts are SIL OFL (`public/fonts/`). Music and SFX are
synthesised in-house (`assets/LICENSES.md`). Visual plates are CC0/Pexels/Unsplash/own captures
(`assets/visual/LICENSES.md`). The voice uses Microsoft Edge's read-aloud service via `edge-tts`.
