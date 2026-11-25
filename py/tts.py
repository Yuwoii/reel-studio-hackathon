#!/usr/bin/env python3
"""edge-tts for one beat: text -> mp3 + word boundaries.

Input: one JSON object on stdin
    {"text": "...", "voice": "en-US-AndrewNeural", "out": "/abs/beat_01.mp3",
     "rate": "+0%" (optional), "volume": "+0%" (optional), "pitch": "+0Hz" (optional)}
Output: the mp3 at `out` (written to a temp file, then renamed) and one JSON object on stdout
    {"boundaries": [{"text": "What", "startMs": 100.0, "endMs": 187.5}, ...], "bytes": 12345, "attempts": 1}

edge-tts 7.x defaults to SentenceBoundary - WordBoundary must be requested explicitly. Offsets/durations come in
100-ns ticks. Network errors (websocket drops, NoAudioReceived which the service returns transiently) are retried
3x with backoff. Exit codes: 0 ok, 2 bad input, 1 synthesis failed after retries.
"""

import asyncio
import json
import os
import sys

import aiohttp
import edge_tts
from edge_tts import exceptions as edge_exc

TICKS_PER_MS = 10_000
ATTEMPTS = 3
RETRYABLE = (
    edge_exc.NoAudioReceived,
    edge_exc.WebSocketError,
    edge_exc.UnexpectedResponse,
    edge_exc.UnknownResponse,
    aiohttp.ClientError,
    asyncio.TimeoutError,
    ConnectionError,
    OSError,
)


async def synth_once(req: dict, tmp: str) -> list:
    comm = edge_tts.Communicate(
        req["text"],
        req["voice"],
        rate=req.get("rate") or "+0%",
        volume=req.get("volume") or "+0%",
        pitch=req.get("pitch") or "+0Hz",
        boundary="WordBoundary",
        connect_timeout=15,
        receive_timeout=60,
    )
    boundaries = []
    with open(tmp, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_MS
                boundaries.append(
                    {"text": chunk["text"], "startMs": start, "endMs": start + chunk["duration"] / TICKS_PER_MS}
                )
    return boundaries


async def main() -> int:
    try:
        req = json.loads(sys.stdin.read())
        assert isinstance(req.get("text"), str) and req["text"].strip(), "text required"
        assert isinstance(req.get("voice"), str) and req["voice"], "voice required"
        assert isinstance(req.get("out"), str) and os.path.isabs(req["out"]), "out must be an absolute path"
    except Exception as e:  # noqa: BLE001 - any malformed input is a usage error
        print(f"tts.py: bad input: {e}", file=sys.stderr)
        return 2

    out = req["out"]
    tmp = out + ".tmp"
    last_err = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            boundaries = await synth_once(req, tmp)
            size = os.path.getsize(tmp)
            if size == 0:
                raise edge_exc.NoAudioReceived("empty audio")
            os.replace(tmp, out)
            json.dump({"boundaries": boundaries, "bytes": size, "attempts": attempt}, sys.stdout)
            return 0
        except RETRYABLE as e:
            last_err = e
            print(f"tts.py: attempt {attempt}/{ATTEMPTS} failed: {type(e).__name__}: {e}", file=sys.stderr)
            if attempt < ATTEMPTS:
                await asyncio.sleep(2 * attempt)  # 2 s, 4 s
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    print(f"tts.py: giving up: {type(last_err).__name__}: {last_err}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
