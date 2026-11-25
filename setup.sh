#!/usr/bin/env bash
# One-time setup on a fresh laptop (macOS or Linux; on Windows run it inside WSL2 Ubuntu).
# Needs: Node 22+, Python 3.10+, ffmpeg (with ffprobe). Installs nothing system-wide.
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "✖ missing: $1 — $2" >&2; exit 1; }; }
need node    "install Node 22+ (macOS: brew install node@22 | Linux: https://nodejs.org or nvm)"
need npm     "comes with Node"
need python3 "install Python 3.10+ (macOS: brew install python | Ubuntu: sudo apt install python3 python3-venv)"
need ffmpeg  "install ffmpeg (macOS: brew install ffmpeg | Ubuntu: sudo apt install ffmpeg)"
need ffprobe "comes with ffmpeg"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || { echo "✖ Node $NODE_MAJOR found, need 22+" >&2; exit 1; }

echo "== npm ci (Remotion, Claude Agent SDK, …)"
npm ci --no-audit --no-fund

echo "== Python venv for the voice (edge-tts)"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet "edge-tts==7.3.1"

echo "== Chrome headless shell for Remotion (one download, ~100 MB)"
npx --no-install remotion browser ensure

echo "== doctor"
npm run --silent doctor
