"""West Coast Swing video scoring via Gemini's File API.

This is a self-contained reimplementation of the relevant parts of the
sibling `wcs-analyzer` project, scoped to a single sync entry point that
takes raw video bytes and returns a structured score JSON. We bundle the
logic here (rather than depending on wcs-analyzer as a package) so the
Railway image stays a single self-contained deploy.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from typing import Any

from google import genai

from ..settings import settings


WSDC_PROMPT = """You are scoring a West Coast Swing dance video using the WSDC competition rubric.

Watch the video carefully and return ONLY a single JSON object — no markdown fences, no commentary.

Required JSON shape (use these exact keys):
{
  "overall": {"score": <float 1-10>, "grade": "<A+|A|A-|B+|B|B-|C+|C|C-|D+|D|D-|F>"},
  "categories": {
    "timing":       {"score": <float 1-10>, "notes": "<one specific sentence>"},
    "technique":    {"score": <float 1-10>, "notes": "<one specific sentence>"},
    "teamwork":     {"score": <float 1-10>, "notes": "<one specific sentence>"},
    "presentation": {"score": <float 1-10>, "notes": "<one specific sentence>"}
  },
  "strengths":    ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"]
}

Scoring weights: Timing 30%, Technique 30%, Teamwork 20%, Presentation 20%.
Compute the overall score as the weighted average and round to one decimal.
Be specific — reference what you actually see in the video, not generic dance advice.
"""


class VideoAnalysisError(Exception):
    pass


def get_video_duration(path: str) -> float:
    """Returns duration in seconds via `ffprobe`. Raises VideoAnalysisError on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        )
    except FileNotFoundError as exc:
        raise VideoAnalysisError("ffprobe not installed on the server") from exc
    except subprocess.CalledProcessError as exc:
        raise VideoAnalysisError(f"ffprobe failed: {exc.stderr.strip()}") from exc
    except subprocess.TimeoutExpired as exc:
        raise VideoAnalysisError("ffprobe timed out") from exc

    data = json.loads(result.stdout or "{}")
    try:
        return float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError) as exc:
        raise VideoAnalysisError("could not parse video duration") from exc


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    # Drop the opening fence line, and the closing fence if present.
    lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines)


def _parse_score_json(text: str) -> dict[str, Any]:
    cleaned = _strip_code_fence(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise VideoAnalysisError(f"model did not return valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise VideoAnalysisError("model returned non-object JSON")
    return parsed


def analyze_video_path(video_path: str) -> dict[str, Any]:
    """Upload to Gemini File API, run WSDC scoring, return parsed JSON."""
    if not settings.gemini_api_key:
        raise VideoAnalysisError("GEMINI_API_KEY not configured")

    client = genai.Client(api_key=settings.gemini_api_key)

    uploaded = client.files.upload(file=video_path)

    # File API processes async — poll until ACTIVE.
    deadline = time.time() + 120
    while uploaded.state and uploaded.state.name == "PROCESSING":
        if time.time() > deadline:
            raise VideoAnalysisError("Gemini file processing timed out")
        time.sleep(1.5)
        uploaded = client.files.get(name=uploaded.name)

    if not uploaded.state or uploaded.state.name != "ACTIVE":
        state_name = uploaded.state.name if uploaded.state else "UNKNOWN"
        raise VideoAnalysisError(f"Gemini file upload state: {state_name}")

    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[uploaded, WSDC_PROMPT],
        )
    finally:
        # Best-effort cleanup of the Gemini-side file.
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass

    text = getattr(response, "text", None)
    if not text:
        raise VideoAnalysisError("Gemini returned an empty response")

    return _parse_score_json(text)


def analyze_video_bytes(
    video_bytes: bytes,
    filename: str = "video.mp4",
) -> tuple[dict[str, Any], float]:
    """Convenience wrapper: write to tempfile, ffprobe, analyze, return (result, duration)."""
    suffix = os.path.splitext(filename)[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        duration = get_video_duration(tmp_path)
        result = analyze_video_path(tmp_path)
        return result, duration
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
