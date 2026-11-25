#!/usr/bin/env python3
"""faster-whisper word timestamps for one audio file (fallback when edge-tts boundaries are missing/garbled, and
the timing source for ElevenLabs audio).

Input: one JSON object on stdin
    {"audio": "/abs/beat_01.mp3", "prompt": "known narration (initial_prompt)", "language": "en"}
Output: one JSON object on stdout
    {"words": [{"text": "What", "startMs": 120.0, "endMs": 300.0, "prob": 0.98}, ...],
     "language": "en", "durationMs": 4200.0, "model": "base"}

Env: REEL_WHISPER_MODEL (default "base"), REEL_WHISPER_DIR (model cache, default <repo>/data/whisper),
REEL_WHISPER_THREADS (default 2). CPU + int8 only (no GPU on NUC 1). The known narration goes in as
initial_prompt, which strongly biases spelling/numbers towards the script; reconciliation happens in Node.
Exit codes: 0 ok, 2 bad input, 1 failure.

Lead silence (v3 W2, R2 VOICE.md §1.4): with a long silent lead (v3 narration starts with a ~600 ms hook beat)
whisper pinned the first word to 0 ms (W2, 75 s TLS narration, full prompt: first word 570 ms early). R2 also saw it
skip the opening sentence with the full prompt (1-7 of 30 words matched); W2 did not reproduce that skip (194/197
matched with the old code). So a lead silence longer than LEAD_TRIM_MIN_MS is cut to LEAD_KEEP_MS before
transcription and every time is shifted back by the cut ("leadCutMs" in the output). This replaces ADR-002 §10's
"no full-narration prompt after a lead silence": the cause (the silent lead) is removed instead of the prompt. v2 beat files keep only a
50 ms lead, so they are never cut and behave exactly as before. "prompt": "" (or omitted) still means no prompt.
"""

import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE_RATE = 16000
LEAD_TRIM_MIN_MS = 300
LEAD_KEEP_MS = 100
LEAD_THRESH_DB = -45.0


def lead_silence_samples(x) -> int:
    """Samples before the first 10 ms frame whose RMS is above LEAD_THRESH_DB (0 if none / all silent)."""
    import numpy as np

    frame = SAMPLE_RATE // 100
    n = len(x) // frame
    if n == 0:
        return 0
    fr = x[: n * frame].reshape(n, frame)
    db = 20 * np.log10(np.sqrt((fr.astype(np.float64) ** 2).mean(axis=1)) + 1e-9)
    loud = np.where(db > LEAD_THRESH_DB)[0]
    return int(loud[0]) * frame if len(loud) else 0


def decode_audio(path: str):
    """ffmpeg → mono float32 @ 16 kHz numpy array.

    faster-whisper 1.2.1's own decoder calls av.open(metadata_errors=...), which PyAV >= 15 removed (the venv has
    av 19) → TypeError. Decoding with the ffmpeg binary we already depend on sidesteps the PyAV version entirely.
    """
    import numpy as np

    pcm = subprocess.run(
        [os.environ.get("REEL_FFMPEG") or "ffmpeg", "-nostdin", "-v", "error", "-i", path,
         "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
        check=True, capture_output=True, timeout=300,
    ).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def main() -> int:
    try:
        req = json.loads(sys.stdin.read())
        audio = req["audio"]
        assert isinstance(audio, str) and os.path.isfile(audio), "audio file not found"
    except Exception as e:  # noqa: BLE001
        print(f"align.py: bad input: {e}", file=sys.stderr)
        return 2

    from faster_whisper import WhisperModel  # imported late: slow import, keep bad-input path fast

    model_name = os.environ.get("REEL_WHISPER_MODEL") or "base"
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        cpu_threads=int(os.environ.get("REEL_WHISPER_THREADS") or "2"),
        download_root=os.environ.get("REEL_WHISPER_DIR") or os.path.join(REPO, "data", "whisper"),
    )
    lang = (req.get("language") or "")[:2] or None
    x = decode_audio(audio)
    lead = lead_silence_samples(x)
    cut = lead - LEAD_KEEP_MS * SAMPLE_RATE // 1000 if lead * 1000 // SAMPLE_RATE > LEAD_TRIM_MIN_MS else 0
    off_ms = cut * 1000 / SAMPLE_RATE
    segments, info = model.transcribe(
        x[cut:],
        language=lang,
        initial_prompt=req.get("prompt") or None,
        word_timestamps=True,
        beam_size=5,
        vad_filter=False,  # TTS audio has no noise; VAD would only risk clipping word edges
        condition_on_previous_text=False,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"text": text, "startMs": w.start * 1000 + off_ms, "endMs": w.end * 1000 + off_ms, "prob": w.probability})
    json.dump(
        {"words": words, "language": info.language, "durationMs": info.duration * 1000 + off_ms, "model": model_name, "leadCutMs": off_ms},
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
