"""West Coast Swing video scoring via Gemini's File API.

Self-contained reimplementation of the relevant parts of the sibling
`wcs-analyzer` project, scoped to a single sync entry point that takes
raw video bytes and returns a structured WSDC score. We bundle the
logic here (rather than depending on wcs-analyzer as a package) so the
Railway image stays a single self-contained deploy.

Prompt structure, calibration anchors, uncertainty bounds, reasoning
fields, off-beat moment tracking, and the pattern pre-pass architecture
are all ported from wcs-analyzer's `prompts.py` + `gemini_analyzer.py`
to ensure scoring consistency with the canonical research tool.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from typing import Any

from google import genai
from google.genai import types as genai_types

from ..settings import settings


# ─────────────────────────────────────────────────────────────────────
# Prompts — ported from wcs-analyzer/src/wcs_analyzer/prompts.py
# ─────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert West Coast Swing (WCS) dance judge with decades of experience \
evaluating dancers at WSDC (World Swing Dance Council) competitions. You analyze \
dance videos frame-by-frame and provide detailed, constructive feedback.

You evaluate dancers on four WSDC categories:

1. **Timing & Rhythm** (30% weight)
   - Dancing on beat with the music
   - Proper timing of syncopations (triple steps, kick-ball-changes)
   - Musical breaks and pauses executed on time
   - Anchor steps landing on the correct beats
   - Maintaining consistent rhythm throughout patterns

2. **Technique** (30% weight)
   - Posture: upright frame, engaged core, neutral spine
   - Extension: full arm and body extension through the slot
   - Footwork: heel leads, toe leads, rolling through feet properly
   - Anchor steps: proper settle, compression, triple rhythm in place
   - Slot maintenance: dancing in a straight line (the slot)
   - Connection frame: arms at proper angles, elbows in

3. **Teamwork** (20% weight)
   - Lead/follow connection quality
   - Shared weight and counterbalance
   - Responsiveness to partner's movements
   - Matched energy and intent
   - Proper leverage and compression

4. **Presentation** (20% weight)
   - Musicality: interpreting the music beyond basic rhythm
   - Styling: personal expression, body rolls, arm styling
   - Confidence and stage presence
   - Performance quality and engagement
   - Creativity in movement choices

Score each category from 1 to 10:
- 1-3: Novice level, fundamental issues
- 4-5: Intermediate, basics present but inconsistent
- 6-7: Advanced, solid technique with room for improvement
- 8-9: All-Star/Champion level, polished and consistent
- 10: Exceptional, professional quality

Use these calibration examples to anchor your scale:

**Novice example (~3):** Social-dance couple. Lead drops the follow's arm \
mid-pattern and loses the slot line; triple steps are flat-footed without \
rolling through the foot. Follow's posture collapses at the anchor. An \
off-beat moment happens roughly every 8-count. Typical scoring: timing 3.5, \
technique 3.0, teamwork 4.0, presentation 3.5.

**Intermediate example (~6):** Novice-division competitor. Consistent basics, \
clean sugar pushes and side passes. Anchor steps mostly settle on beat but \
occasionally rush into the next pattern. Some forward lean on tuck turns. \
Teamwork is clean but reactive rather than conversational; styling is minimal. \
Typical scoring: timing 6.5, technique 6.0, teamwork 6.5, presentation 5.5.

**Champion example (~9):** Champion-tier routine. Musicality drives every \
movement — dancers hit breaks precisely, stretch the anchor into the blues \
pocket, layer body rolls into triples. Frame is immaculate, extension is full, \
the slot is razor-straight. Lead shapes the music through the follow's path. \
Typical scoring: timing 9.0, technique 9.0, teamwork 9.5, presentation 9.5.

Before committing to a score for a category, you MUST write a one-sentence \
`reasoning` field walking through the specific evidence you observed. The \
score should follow directly from that reasoning, not the other way around.

Be specific and constructive. Reference exact moments when possible. \
Note both strengths and areas for improvement.

For every category score you give, also return a `score_low` and `score_high` \
expressing your uncertainty — the range you'd still defend if pressed. A confident \
score has a tight interval (e.g., 7.3-7.7); a shaky or obstructed view has a wide \
one (e.g., 5.5-8.0). Keep `score_low <= score <= score_high`, all within 1-10.

IMPORTANT: If the video contains multiple couples or bystanders, focus \
ONLY on the specified dancers. Ignore all other people in the frame.\
"""


PATTERN_SEGMENTATION_PROMPT = """\
You are segmenting a West Coast Swing dance video into its constituent \
patterns. Watch the video carefully and identify the sequence of patterns \
the couple performs.

Common WCS patterns:
- sugar push (6-count, in-place)
- left side pass, right side pass (6-count)
- tuck turn (6-count)
- whip (8-count, rotational)
- basket whip, reverse whip
- starter step, anchor-only / in-place variations

Return a JSON timeline. Each entry covers a contiguous time range; the \
ranges must not overlap and should cover the entire video from start to end.

Respond in this exact JSON format. No prose, no markdown:
{
  "patterns": [
    {"start_time": 0.0, "end_time": 3.2, "name": "sugar push", "confidence": 0.8},
    {"start_time": 3.2, "end_time": 7.0, "name": "left side pass", "confidence": 0.7}
  ]
}

Confidence is 0-1; use 1.0 when you're certain, ~0.5 when you can only \
narrow it down to a family, and < 0.3 when the pattern is unclear.\
"""


GEMINI_VIDEO_PROMPT = """\
Watch and listen to this entire West Coast Swing dance video carefully. \
Pay attention to both the visual movement AND the music/audio to judge timing accuracy.

Analyze the full performance and provide a comprehensive evaluation. \
Since you can hear the music, evaluate whether the dancers are truly on beat — \
listen for anchors landing on the downbeat, triples matching the rhythm, \
and whether styling choices align with musical accents and breaks.

Respond in this exact JSON format. Fill `reasoning` BEFORE `score` in each category:
{
  "timing": {
    "reasoning": "<one sentence walking through what you heard and saw before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "on_beat": <true/false for overall>,
    "off_beat_moments": [
      {"timestamp_approx": "<time>", "description": "<what happened>", "beat_count": "<e.g., 3&4>"}
    ],
    "rhythm_consistency": "<assessment of timing throughout>",
    "notes": "<detailed timing observations referencing what you heard in the music>"
  },
  "technique": {
    "reasoning": "<one sentence weighing posture, extension, footwork, slot before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "posture": {"score": <1-10>, "notes": "<detail: frame alignment, core engagement, forward lean, head position, shoulder tension>"},
    "extension": {"score": <1-10>, "notes": "<detail: arm reach, body stretch through slot, line quality>"},
    "footwork": {"score": <1-10>, "notes": "<detail: heel leads, toe leads, rolling through feet, triple step clarity>"},
    "slot": {"score": <1-10>, "notes": "<detail: staying in the slot line, drifting, lane discipline>"},
    "notes": "<overall technique observations>"
  },
  "teamwork": {
    "reasoning": "<one sentence on connection, responsiveness, shared weight before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "connection": "<observations about lead/follow connection>",
    "notes": "<overall teamwork observations>"
  },
  "presentation": {
    "reasoning": "<one sentence on musicality, styling, stage presence before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "musicality": "<observations — reference specific musical moments>",
    "styling": "<observations>",
    "notes": "<overall presentation observations>"
  },
  "patterns_identified": [
    {
      "name": "<e.g., sugar push, left side pass, whip>",
      "quality": "<strong|solid|needs_work|weak>",
      "timing": "<on_beat|slightly_off|off_beat>",
      "notes": "<what was good or needs improvement in this pattern>"
    }
  ],
  "highlights": ["<notable positive moments with approximate timestamps>"],
  "improvements": ["<specific actionable suggestions>"],
  "lead": {
    "technique_score": <1-10>,
    "presentation_score": <1-10>,
    "notes": "<lead-specific observations>"
  },
  "follow": {
    "technique_score": <1-10>,
    "presentation_score": <1-10>,
    "notes": "<follow-specific observations>"
  },
  "overall_impression": "<1-2 sentence overall assessment>",
  "estimated_bpm": <estimated BPM from the music>,
  "song_style": "<e.g., blues, contemporary, lyrical>"
}

Only output valid JSON, no other text.\
"""


class VideoAnalysisError(Exception):
    pass


# ─────────────────────────────────────────────────────────────────────
# ffprobe
# ─────────────────────────────────────────────────────────────────────

def get_video_duration(path: str) -> float:
    """Return duration in seconds via `ffprobe`. Raises VideoAnalysisError."""
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


# ─────────────────────────────────────────────────────────────────────
# JSON parsing helpers
# ─────────────────────────────────────────────────────────────────────

def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines)


def _safe_parse_json(text: str) -> dict[str, Any] | None:
    cleaned = _strip_code_fence(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


# ─────────────────────────────────────────────────────────────────────
# Score aggregation
# ─────────────────────────────────────────────────────────────────────

_WEIGHTS = {
    "timing": 0.30,
    "technique": 0.30,
    "teamwork": 0.20,
    "presentation": 0.20,
}

_GRADE_THRESHOLDS: list[tuple[float, str]] = [
    (9.5, "A+"),
    (9.0, "A"),
    (8.5, "A-"),
    (8.0, "B+"),
    (7.5, "B"),
    (7.0, "B-"),
    (6.5, "C+"),
    (6.0, "C"),
    (5.5, "C-"),
    (5.0, "D+"),
    (4.5, "D"),
    (4.0, "D-"),
]


def _grade_letter(score: float) -> str:
    for threshold, letter in _GRADE_THRESHOLDS:
        if score >= threshold:
            return letter
    return "F"


def _compute_overall(categories: dict[str, dict[str, Any]]) -> float:
    total = 0.0
    for key, weight in _WEIGHTS.items():
        try:
            total += float(categories[key]["score"]) * weight
        except (KeyError, TypeError, ValueError):
            pass
    return round(total, 1)


def _max_interval(categories: dict[str, dict[str, Any]]) -> float:
    """Largest score_high - score_low across categories. Used to flag low-
    confidence results per wcs-analyzer's heuristic."""
    widest = 0.0
    for cat in categories.values():
        try:
            low = float(cat.get("score_low", cat["score"]))
            high = float(cat.get("score_high", cat["score"]))
            widest = max(widest, high - low)
        except (KeyError, TypeError, ValueError):
            continue
    return widest


# ─────────────────────────────────────────────────────────────────────
# Gemini call
# ─────────────────────────────────────────────────────────────────────

def _build_gen_config(model: str) -> genai_types.GenerateContentConfig:
    config_kwargs: dict[str, Any] = {
        "system_instruction": SYSTEM_PROMPT,
        "max_output_tokens": 8192,
        "temperature": 0.0,
    }
    # Extended thinking — Gemini 3.x accepts thinking_config. We pass it
    # on a best-effort basis and fall back silently for older models.
    if "gemini-3" in model:
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                thinking_level="high",  # type: ignore[arg-type]
            )
        except (TypeError, AttributeError):
            pass
    return genai_types.GenerateContentConfig(**config_kwargs)


def _call_gemini(
    client: genai.Client,
    model: str,
    contents: list,
) -> str:
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=_build_gen_config(model),
    )
    text = getattr(response, "text", None)
    if not text:
        raise VideoAnalysisError("Gemini returned an empty response")
    return text


# ─────────────────────────────────────────────────────────────────────
# Pattern pre-pass
# ─────────────────────────────────────────────────────────────────────

def _format_pattern_timeline(patterns: list[dict[str, Any]]) -> str:
    lines = ["DETECTED PATTERN TIMELINE (from a dedicated pattern pre-pass):"]
    for i, seg in enumerate(patterns, 1):
        start = float(seg.get("start_time") or 0.0)
        end = float(seg.get("end_time") or 0.0)
        name = seg.get("name", "unknown")
        conf = seg.get("confidence")
        conf_str = (
            f" (confidence {conf:.1f})"
            if isinstance(conf, (int, float))
            else ""
        )
        lines.append(f"  {i}. {start:.1f}s - {end:.1f}s: {name}{conf_str}")
    lines.append(
        "\nUse this timeline as a strong prior when filling "
        "`patterns_identified` in your response. You can add patterns the "
        "pre-pass missed or correct obvious errors, but default to "
        "trusting it."
    )
    return "\n".join(lines)


def _run_pattern_pre_pass(
    client: genai.Client,
    model: str,
    video_file: Any,
) -> str | None:
    """Single-purpose Gemini call asking ONLY about the pattern timeline.

    Per wcs-analyzer's docstring: "the per-pattern focus consistently
    outperforms asking the main prompt to enumerate patterns while also
    scoring the dance." Failures here are non-fatal — we fall back to
    the main prompt enumerating patterns inline.
    """
    try:
        raw = _call_gemini(
            client,
            model,
            contents=[video_file, PATTERN_SEGMENTATION_PROMPT],
        )
    except VideoAnalysisError:
        return None
    data = _safe_parse_json(raw)
    if not data:
        return None
    patterns = data.get("patterns")
    if not isinstance(patterns, list) or not patterns:
        return None
    return _format_pattern_timeline(patterns)


# ─────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────

def analyze_video_path(video_path: str) -> dict[str, Any]:
    """Upload video → optional pattern pre-pass → WSDC scoring call → parse.

    Returns a dict shaped for the Swingflow frontend plus rich audit
    fields (reasoning, score_low/high, off_beat_moments, patterns).
    """
    if not settings.gemini_api_key:
        raise VideoAnalysisError("GEMINI_API_KEY not configured")

    client = genai.Client(api_key=settings.gemini_api_key)
    uploaded = client.files.upload(file=video_path)

    # Poll until the file is ACTIVE on Gemini's side.
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
        prompt = GEMINI_VIDEO_PROMPT
        if settings.enable_pattern_prepass:
            pre_pass_context = _run_pattern_pre_pass(
                client, settings.gemini_model, uploaded
            )
            if pre_pass_context:
                prompt = f"{pre_pass_context}\n\n{prompt}"

        raw = _call_gemini(
            client, settings.gemini_model, contents=[uploaded, prompt]
        )
    finally:
        # Best-effort cleanup of the Gemini-side file.
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass

    parsed = _safe_parse_json(raw)
    if parsed is None:
        raise VideoAnalysisError(
            f"Gemini returned unparseable JSON: {raw[:200]}"
        )

    return _shape_response(parsed)


def _shape_response(parsed: dict[str, Any]) -> dict[str, Any]:
    """Map Gemini's rich response into the API's return shape.

    Preserves rich audit fields (reasoning, score_low/high,
    off_beat_moments, sub-scores, patterns) while also providing the
    simplified fields the current frontend renders.
    """
    categories = {
        key: (parsed.get(key) or {}) if isinstance(parsed.get(key), dict) else {}
        for key in ("timing", "technique", "teamwork", "presentation")
    }
    overall_score = _compute_overall(categories)
    grade = _grade_letter(overall_score)
    max_interval = _max_interval(categories)
    # Flag a result as low-confidence when any category interval is wider
    # than 2 points — matches wcs-analyzer's scoring.py heuristic.
    confidence = "low" if max_interval > 2.0 else "high"

    strengths = parsed.get("highlights") or parsed.get("strengths") or []
    improvements = parsed.get("improvements") or []

    return {
        "overall": {
            "score": overall_score,
            "grade": grade,
            "confidence": confidence,
            "impression": parsed.get("overall_impression"),
        },
        "categories": categories,
        "patterns_identified": parsed.get("patterns_identified") or [],
        "strengths": strengths,
        "improvements": improvements,
        "lead": parsed.get("lead"),
        "follow": parsed.get("follow"),
        "estimated_bpm": parsed.get("estimated_bpm"),
        "song_style": parsed.get("song_style"),
    }


def analyze_video_bytes(
    video_bytes: bytes,
    filename: str = "video.mp4",
) -> tuple[dict[str, Any], float]:
    """Convenience wrapper: write → ffprobe → analyze → return (result, duration)."""
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
