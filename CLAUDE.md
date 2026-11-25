# Reel Studio (hackathon edition): instructions for Claude

This repo turns a **topic** ("how does a PCR test work") into a finished **vertical explainer reel** (1080×1920 MP4, ~45–75 s, narrated, captioned, animated diagrams, music bed and SFX). Everything runs on this laptop: a Claude-driven director (Claude Agent SDK) researches and writes the script, judges fact-check it, edge-tts records the voice, Remotion renders the video locally and ffmpeg mixes the audio. No servers, no AWS, no Discord.

## When the user says "start" (or "set it up", "let's go", …)

Do these in order and report briefly after each step:

1. **Setup.** If `node_modules/` or `.venv/` is missing, run `./setup.sh`. If it stops on a missing system tool, help install it (macOS: `brew install node@22 ffmpeg python`; Ubuntu/WSL: `sudo apt install ffmpeg python3-venv` + Node 22 via nvm). On native Windows, stop and tell them to use WSL2.
2. **Doctor.** Run `npm run doctor`. Fix every ✖ using the hint it prints (see Troubleshooting below). Re-run until everything is ✔. It makes one tiny Claude call and one 1-second voice synth.
3. **Topic.** Ask the team for a topic if they haven't given one. Good topics are "how does X work" for a mechanism you can draw: a test, a device, a molecule doing something, a process. Rules: the topic is sent to Claude and the director searches the **public web**, so **no confidential or internal company information** goes into the topic or the feedback. No real people, no brand logos.
4. **Make it.** Run `npm run reel -- make "<topic>" --slug <short-slug>` **in the background** (it takes 15–35 min: the director is 10–25 min, the render is 5–15 min depending on CPU). Every few minutes, tell the user what stage it's in. Read the console output or `out/jobs/<slug>/reel.log`. Stages: research → script → fact check/judges → voice → storyboard → board judges → frame check → render → mix.
5. **Show the result.** `out/<slug>.mp4` (the final file), `out/<slug>.preview.mp4` (small, easy to share in chat) and `out/<slug>.contact-sheet.png` (one frame every 2 s; open it so you can describe the reel). Print the script with `npm run reel -- status <slug>`. List any red badges (quality warnings from the judges) in plain words.
6. **Iterate.** For team feedback: `npm run reel -- revise <slug> "<feedback>"`. This resumes the same director session and re-renders. To re-render only (e.g. at 60 fps for the final demo): `npm run reel -- render <slug> --fps 60`.

## Commands

| Command | What it does |
|---|---|
| `npm run doctor` (`-- --quick` = no network) | readiness check |
| `npm run reel -- make "<topic>" [--slug s] [--fps 30\|60] [--no-frame-check]` | topic → final mp4 |
| `npm run reel -- draft "<topic>" [--slug s]` | director only (script + voice + storyboard), no video |
| `npm run reel -- render <slug> [--fps 30\|60]` | render a saved draft |
| `npm run reel -- revise <slug> "<feedback>" [--no-render]` | change a draft with feedback |
| `npm run reel -- status <slug>` | stage, script lines, badges |
| `npm run studio` | Remotion Studio (browser preview of the compositions, for hacking on visuals) |

Speed: `--fps 30` (default) is about half the render time of 60. `--no-frame-check` skips the local still render and vision judge inside the director (saves ~3–5 min, slightly lower visual QA). On a 4-core laptop a 60 s reel at 30 fps renders in roughly 15 min.

## Claude login (src/auth.ts)

The director and judges are separate Agent SDK subprocesses. They authenticate in this order:
1. `CLAUDE_CODE_OAUTH_TOKEN` if set (a `claude setup-token` subscription token);
2. else `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` / Bedrock (`CLAUDE_CODE_USE_BEDROCK=1` + AWS creds) / Vertex (`CLAUDE_CODE_USE_VERTEX=1` …) / Foundry env vars, passed through;
3. else **the Claude Code login of this user account**. This is the normal case: if `claude` works in this terminal, the reel pipeline works.

Proxy vars (`HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`) are passed through.

**Models.** The defaults are `claude-sonnet-5-5` (director, most judges) and `claude-opus-5-5` (physics judges). If the org's setup uses other ids (Bedrock `us.anthropic.…`, a gateway alias) or has no Opus, set `REEL_MODEL=<id>` (everything) and optionally `REEL_STRONG_MODEL=<id>`.

**Cost.** One reel is ~60–120 director turns plus ~15–30 judge calls. On a subscription seat that's usage quota, not money; with an API key, expect a few dollars per reel. The notional cap per job is `REEL_V3_MAX_USD_PER_JOB` (default 15).

## Troubleshooting

- **doctor: Claude call failed.** Run `claude` once and `/login`. Or export the org's API/Bedrock vars. "model not found" means set `REEL_MODEL`.
- **doctor: edge-tts failed.** The voice comes from Microsoft's Edge read-aloud endpoint (`speech.platform.bing.com`, websocket). Corporate networks sometimes block it: set `HTTPS_PROXY`, or use a phone hotspot or guest Wi-Fi.
- **Director "NOT saved".** Read the last errors it prints and `out/jobs/<slug>/reel.log`. Usually it ran out of turns on a hard topic. Run `revise <slug> "finish: simplify to one mechanism"`, or pick a narrower topic.
- **Red badges.** These are judge warnings (a fact the fact-checker couldn't confirm, a beat whose picture doesn't match the line). The reel still renders. Mention them, and fix with `revise` if they matter.
- **Render is slow or the machine is hot.** Use `--fps 30`. Close Chrome tabs. Concurrency is half the CPU cores.
- **"already exists".** Each slug is one job. Use a new `--slug`, use `revise`, or delete `out/jobs/<slug>/`.

## Layout (for hacking)

```
scripts/reel.ts        the CLI (director → local stills/frame check → local Remotion render → mix)
scripts/doctor.ts      readiness check
src/auth.ts            Claude auth + model overrides
src/director/v3/       the director: prompt.ts (system prompt), tools.ts (its MCP tools), judges (claims, factcheck,
                       physics*, nontech, critic, frames)
src/v3/                v3 lints, TTS (tts.ts → py/tts.py edge-tts), pacing, components-meta (what the director may draw)
src/pipeline/v3/render.ts   plan → media render → mix + mux (renderer injected by scripts/reel.ts)
src/audio/v2/          mix, loudness, QA
remotion/v3/           the ExplainerV3 composition + drawn components (React/Remotion)
assets/                music bed + SFX (made in-house), visual plates (licences in assets/visual/LICENSES.md)
research/v3/S2/tls-s2.board.json   the example board the director learns the format from
out/                   all output (git-ignored)
```

Notes: `src/director/v2/*`, `remotion/v2` and some `src/v2/*` are still imported by v3 (judges, timeline, lints). Don't delete them. The original also had a Discord bot, Instagram hand-off and AWS Lambda rendering; those were removed in this fork.

## Rules for you (Claude) in this repo

- Don't print or commit secrets. `out/` and `*.env` are git-ignored.
- Don't change `src/` or `remotion/` unless the team asks you to hack on the pipeline. For content changes, use `revise`.
- Long commands (`make`, `render`, `revise`) always run in the background. Report progress, don't sit blocked.
