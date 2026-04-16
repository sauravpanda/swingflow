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


def _extract_beat_context(video_path: str) -> str | None:
    """Pull audio out of the video, run librosa beat tracking, and return a
    prompt-ready string. Gemini's native audio understanding is good, but
    giving it actual beat timestamps as context consistently tightens up
    timing judgments (the canonical wcs-analyzer behavior).

    Silent-fail on any error — this is a best-effort enrichment, not a
    blocker.
    """
    try:
        import librosa  # lazy import — heavy module

        wav_path = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    video_path,
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "22050",
                    wav_path,
                ],
                capture_output=True,
                check=True,
                timeout=60,
            )
            y, sr = librosa.load(wav_path, sr=22050, mono=True)
            tempo_raw, beat_times = librosa.beat.beat_track(
                y=y, sr=sr, units="time"
            )
            if beat_times is None or len(beat_times) < 4:
                return None
            bpm = (
                float(tempo_raw)
                if not hasattr(tempo_raw, "__iter__")
                else float(list(tempo_raw)[0])
            )
            # Show first ~12 seconds of beats as a prior (~24 beats at 120 BPM).
            preview = [t for t in beat_times[:24].tolist()]
            beats_str = ", ".join(f"{t:.2f}" for t in preview)
            return (
                "DETECTED MUSIC CONTEXT (from librosa beat tracking):\n"
                f"- Estimated BPM: {bpm:.1f}\n"
                f"- First beat times in seconds: {beats_str}\n"
                "Use this as a strong prior for timing judgments — when a "
                "dancer's weight change or anchor settle lands within "
                "~100ms of a detected beat, count it as on-beat. Anchor "
                "steps should land near beats 5 and 6 of each 8-count "
                "phrase.\n"
            )
        finally:
            try:
                os.unlink(wav_path)
            except OSError:
                pass
    except Exception:
        return None


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

For `patterns_identified`, walk through the entire video chronologically and \
commit to a contiguous list of pattern windows that cover the dance from start \
to end. Every pattern the dancers execute must appear as its own entry — do \
NOT merge consecutive repeats of the same pattern into one window. If the \
couple performs three sugar pushes in a row, emit three separate entries. A \
typical WCS pattern is 6 or 8 beats, which at 90–130 BPM is roughly 3–6 \
seconds; windows longer than ~10 seconds almost always mean you collapsed \
repeats. A 90-second routine usually contains 15-25 pattern windows. \
Common WCS patterns: sugar push, left side pass, right side pass, tuck turn, \
whip (and variants: basket whip, reverse whip, apache whip), underarm turn, \
inside turn, free spin, starter step, basic in closed position, anchor step \
variations.

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
      "start_time": <seconds from video start, float>,
      "end_time": <seconds from video start, float>,
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

Constraints on patterns_identified:
- Cover the full video end-to-end with non-overlapping contiguous time ranges, in chronological order.
- Each entry is ONE occurrence of ONE pattern — emit separate entries for repeated patterns.
- Windows should be 3–8 seconds typical, rarely longer than 10 seconds.
- For a 90-second clip expect 15–25 entries; scale proportionally for shorter/longer clips.
- If a segment is truly unclear, name it "unknown", keep it short (≤8s), and explain in notes.
- start_time and end_time are decimal seconds from the video start.
- Use the beat grid in the context (if provided) to anchor window boundaries near anchor steps (beats 5–6).

Only output valid JSON, no other text. Do not include // comments inside the JSON.\
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
    cleaned = _strip_code_fence(text).strip()

    # Happy path
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    # Tolerant fallback: try to extract the first complete top-level JSON
    # object by depth-counting braces. Handles trailing garbage, markdown
    # fragments, or partial truncation past a valid object.
    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(cleaned)):
        ch = cleaned[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(cleaned[start : i + 1])
                    return parsed if isinstance(parsed, dict) else None
                except json.JSONDecodeError:
                    return None
    return None


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
        # Rich schema (reasoning + sub-scores + off-beat moments +
        # patterns + lead/follow) produces long outputs. 8192 was
        # truncating mid-JSON on real dance videos with many events.
        "max_output_tokens": 32768,
        "temperature": 0.0,
        "response_mime_type": "application/json",
        # HIGH media resolution (~768 tokens/frame) vs the default
        # MEDIUM (~256). For dance analysis this is the difference
        # between "I can see there are dancers" and "I can see heel-
        # toe rolling and a collapsed anchor." wcs-analyzer uses
        # HIGH by default and it's critical for technique scoring.
        # Cost: ~3x the per-frame token billing, but Gemini samples
        # only ~1 frame per second of video anyway, so total spend
        # per clip stays bounded.
        "media_resolution": genai_types.MediaResolution.MEDIA_RESOLUTION_HIGH,
    }
    # Extended thinking. The SDK accepts a ThinkingConfig on both
    # Gemini 3.x and 2.5 models, but the fields differ:
    #   - Gemini 3.x: thinking_level ("low"|"medium"|"high")
    #   - Gemini 2.5: thinking_budget (int token budget; -1 = auto)
    # We pass the right shape per model family on a best-effort basis
    # and fall back silently if the SDK rejects the field.
    if "gemini-3" in model:
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                thinking_level="high",  # type: ignore[arg-type]
            )
        except (TypeError, AttributeError):
            pass
    elif "gemini-2.5" in model:
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                thinking_budget=-1,  # auto — let 2.5 decide how much to think
            )
        except (TypeError, AttributeError):
            pass
    return genai_types.GenerateContentConfig(**config_kwargs)


def _extract_usage(response: Any, model: str) -> dict[str, Any]:
    """Pull token counts from a Gemini response's usage_metadata.

    Returns a dict with prompt_tokens, response_tokens, total_tokens,
    model. Thinking tokens are folded into response_tokens so cost
    reflects actual billed spend. Safe to call on any response — fields
    default to 0 when missing.
    """
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return {
            "prompt_tokens": 0,
            "response_tokens": 0,
            "total_tokens": 0,
            "model": model,
        }
    prompt = int(getattr(meta, "prompt_token_count", 0) or 0)
    candidates = int(getattr(meta, "candidates_token_count", 0) or 0)
    thinking = int(getattr(meta, "thoughts_token_count", 0) or 0)
    response_tokens = candidates + thinking
    return {
        "prompt_tokens": prompt,
        "response_tokens": response_tokens,
        "total_tokens": prompt + response_tokens,
        "model": model,
    }


def _call_gemini(
    client: genai.Client,
    model: str,
    contents: list,
) -> tuple[str, dict[str, Any]]:
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=_build_gen_config(model),
    )
    text = getattr(response, "text", None)
    if not text:
        raise VideoAnalysisError("Gemini returned an empty response")
    return text, _extract_usage(response, model)


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
) -> tuple[str | None, dict[str, Any] | None]:
    """Single-purpose Gemini call asking ONLY about the pattern timeline.

    Per wcs-analyzer's docstring: "the per-pattern focus consistently
    outperforms asking the main prompt to enumerate patterns while also
    scoring the dance." Failures here are non-fatal — we fall back to
    the main prompt enumerating patterns inline.

    Returns (prompt_context, usage). Either may be None on failure.
    """
    try:
        raw, usage = _call_gemini(
            client,
            model,
            contents=[video_file, PATTERN_SEGMENTATION_PROMPT],
        )
    except VideoAnalysisError:
        return None, None
    data = _safe_parse_json(raw)
    if not data:
        return None, usage
    patterns = data.get("patterns")
    if not isinstance(patterns, list) or not patterns:
        return None, usage
    return _format_pattern_timeline(patterns), usage


# ─────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────

def _build_user_context(context: dict[str, Any] | None) -> str:
    """Turn the optional tag/role/level/event metadata from the
    upload form into a short context block for Gemini. Keeps the
    model grounded on what the user *says* they are (and is at),
    while still scoring against the objective WSDC rubric.

    Also includes a DANCER IDENTIFICATION paragraph when
    `dancer_description` is set — critical for practice-floor or
    social-dance clips where multiple couples share the frame.
    """
    if not context:
        return ""

    # Defensive cap in case the request body bypassed the pydantic
    # validator (older clients, direct REST hits, etc.). Matches the
    # max_length on VideoAnalyzeBody.dancer_description.
    dancer = (context.get("dancer_description") or "").strip()[:200]
    dancer_block = ""
    if dancer:
        dancer_block = (
            "DANCER IDENTIFICATION: "
            f"{dancer}\n"
            "Focus your analysis ONLY on these dancers. There may be "
            "other people visible in the video (other couples, "
            "spectators, judges, instructors) — ignore them entirely. "
            "Every pattern you identify, every score you give, and "
            "every observation you make must refer exclusively to the "
            "identified dancer(s). If you can't confidently tell which "
            "dancer matches the description at any given moment, say so "
            "in the reasoning rather than guessing.\n\n"
        )

    fields = []
    if context.get("role"):
        fields.append(f"- Role: {context['role']}")
    if context.get("competition_level"):
        fields.append(f"- Self-reported level: {context['competition_level']}")
    if context.get("event_name"):
        event_line = f"- Event: {context['event_name']}"
        if context.get("stage"):
            event_line += f" ({context['stage']})"
        fields.append(event_line)
    elif context.get("stage"):
        fields.append(f"- Stage: {context['stage']}")
    if context.get("event_date"):
        fields.append(f"- Event date: {context['event_date']}")
    if context.get("tags"):
        tags = context["tags"]
        if isinstance(tags, (list, tuple)) and tags:
            fields.append(f"- Tags: {', '.join(str(t) for t in tags)}")

    if not fields and not dancer_block:
        return ""

    context_block = ""
    if fields:
        context_block = (
            "USER-PROVIDED CONTEXT:\n"
            + "\n".join(fields)
            + "\n\nCalibrate your scoring against the self-reported level — "
            "a Novice scoring 6/10 is different from a Champion scoring 6/10, "
            "and your reasoning should reflect the dancer's stated tier. "
            "If the video clearly shows a dancer at a different level than "
            "what they self-report, score based on what you observe and say "
            "so in the reasoning. Use the event / stage info to decide how "
            "formal the scoring should feel (Finals on the floor vs. a "
            "practice social).\n"
        )

    # Dancer identification comes first so the model knows WHO to
    # score before anything about how to score them.
    return dancer_block + context_block


def _build_sanity_retry_prompt(
    issues: list[str], previous_raw: str
) -> str:
    """Construct a correction prompt for a second Gemini pass when
    the first response tripped sanity checks. We include the prior
    response so the model can patch it rather than start over.
    """
    issue_lines = "\n".join(f"- {i}" for i in issues)
    return (
        "SANITY CHECK FAILED on your previous response. "
        "The following issues were detected:\n"
        f"{issue_lines}\n\n"
        "Revise your response to fix these specific issues. "
        "Non-dance labels like 'intro', 'waiting', 'starter step', "
        "or 'unknown' should be 1-8 seconds — if one of yours is "
        "longer, what's actually happening in that span? Walking "
        "on, counting beats, and the first real pattern are "
        "different entries. Every pattern window should be 3-8 "
        "seconds — if yours is longer, it's a merge of repeats. "
        "Cover the full video with no gaps larger than ~8 seconds. "
        "Return the complete revised JSON in the same format as "
        "before.\n\n"
        f"YOUR PREVIOUS RESPONSE (for reference, do not copy blindly):\n"
        f"{previous_raw[:6000]}\n"
    )


def analyze_video_path(
    video_path: str,
    duration_sec: float | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Upload video → optional pattern pre-pass → WSDC scoring call → parse.

    Returns a dict shaped for the Swingflow frontend plus rich audit
    fields (reasoning, score_low/high, off_beat_moments, patterns).

    `context` is optional user-provided metadata (role, level, event,
    stage, tags) from the upload form. When present, it's prepended
    to the prompt so Gemini can calibrate scoring against the
    self-reported tier.

    `duration_sec` feeds the post-hoc sanity check (pattern density
    expectation + gap detection). When a sanity issue is found, we
    do ONE retry with the issues as corrective feedback. Retries
    cost one extra Gemini call (~$0.30 on 3.x Pro) but fix the
    "intro lasted 60s" class of hallucination without user intervention.
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

    # Aggregate token usage across pre-pass + main call so cost
    # tracking reflects the full billed spend for this analysis.
    total_prompt_tokens = 0
    total_response_tokens = 0

    sanity_warnings: list[str] = []

    try:
        prompt = GEMINI_VIDEO_PROMPT

        # User-provided metadata (level, role, event, stage, tags)
        # sits at the top of the prompt so Gemini calibrates against
        # the stated tier. Empty string when no context was supplied.
        user_context = _build_user_context(context)
        if user_context:
            prompt = f"{user_context}\n{prompt}"

        # Prepend librosa-derived beat context to ground timing judgments.
        beat_context = _extract_beat_context(video_path)
        if beat_context:
            prompt = f"{beat_context}\n\n{prompt}"

        if settings.enable_pattern_prepass:
            pre_pass_context, pre_pass_usage = _run_pattern_pre_pass(
                client, settings.gemini_model, uploaded
            )
            if pre_pass_context:
                prompt = f"{pre_pass_context}\n\n{prompt}"
            if pre_pass_usage:
                total_prompt_tokens += int(pre_pass_usage.get("prompt_tokens", 0))
                total_response_tokens += int(pre_pass_usage.get("response_tokens", 0))

        raw, main_usage = _call_gemini(
            client, settings.gemini_model, contents=[uploaded, prompt]
        )
        total_prompt_tokens += int(main_usage.get("prompt_tokens", 0))
        total_response_tokens += int(main_usage.get("response_tokens", 0))

        parsed = _safe_parse_json(raw)
        if parsed is None:
            raise VideoAnalysisError(
                f"Gemini returned unparseable JSON: {raw[:200]}"
            )

        # Sanity check: if the response has obvious implausibilities
        # (e.g. "intro lasted 60s" or only 2 patterns for a 2-minute
        # clip), do ONE corrective retry with the specific issues
        # fed back to the model. If the retry still has issues, we
        # accept it and surface the warnings in the response so the
        # frontend can display a "low confidence" badge.
        issues = _sanity_check(parsed, duration_sec)
        if issues:
            retry_prompt = _build_sanity_retry_prompt(issues, raw)
            try:
                retry_raw, retry_usage = _call_gemini(
                    client,
                    settings.gemini_model,
                    contents=[uploaded, retry_prompt],
                )
                total_prompt_tokens += int(retry_usage.get("prompt_tokens", 0))
                total_response_tokens += int(retry_usage.get("response_tokens", 0))
                retry_parsed = _safe_parse_json(retry_raw)
                if retry_parsed is not None:
                    # Only accept the retry if it's strictly better —
                    # otherwise keep the original + warnings.
                    retry_issues = _sanity_check(retry_parsed, duration_sec)
                    if len(retry_issues) < len(issues):
                        parsed = retry_parsed
                        sanity_warnings = retry_issues
                    else:
                        sanity_warnings = issues
                else:
                    sanity_warnings = issues
            except VideoAnalysisError:
                sanity_warnings = issues
    finally:
        # Best-effort cleanup of the Gemini-side file.
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass

    from .pricing import estimate_cost_micros, pricing_updated_on

    usage = {
        "model": settings.gemini_model,
        "prompt_tokens": total_prompt_tokens,
        "response_tokens": total_response_tokens,
        "total_tokens": total_prompt_tokens + total_response_tokens,
        "cost_usd_micros": estimate_cost_micros(
            settings.gemini_model, total_prompt_tokens, total_response_tokens
        ),
        "pricing_updated_on": pricing_updated_on(),
        "sanity_retry": bool(sanity_warnings),
    }

    return _shape_response(
        parsed, usage=usage, sanity_warnings=sanity_warnings
    )


def _sanitize_patterns(
    raw: list[Any] | None,
    *,
    max_window_sec: float = 12.0,
) -> list[dict[str, Any]]:
    """Clean Gemini's patterns_identified output.

    - Drops entries with missing/invalid times.
    - Splits any window longer than `max_window_sec` into ~6s chunks
      sharing the same metadata (prevents the "45s Sugar Push" bug
      even when the model slips past the prompt guidance).
    - Keeps all other fields untouched.
    """
    if not isinstance(raw, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            start = float(entry.get("start_time"))
            end = float(entry.get("end_time"))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        span = end - start
        if span <= max_window_sec:
            cleaned.append(entry)
            continue
        # Model likely merged repeats. Split into ~6s slices sharing
        # the original metadata. Label subsequent slices so we don't
        # silently inflate the pattern count UI — caller sees the
        # same occurrences but time ranges are sane.
        n_splits = max(2, int(round(span / 6.0)))
        slice_len = span / n_splits
        base_name = entry.get("name", "unknown")
        for i in range(n_splits):
            clone = dict(entry)
            clone["start_time"] = start + i * slice_len
            clone["end_time"] = start + (i + 1) * slice_len
            clone["name"] = base_name
            if i > 0:
                existing_notes = (clone.get("notes") or "").strip()
                marker = "(split from a long merged window)"
                clone["notes"] = (
                    f"{existing_notes} {marker}".strip()
                    if existing_notes
                    else marker
                )
            cleaned.append(clone)
    return cleaned


def _normalize_pattern_name(name: str) -> str:
    """Lowercase + collapse whitespace for aggregation key."""
    return " ".join((name or "").lower().split())


def _summarize_patterns(
    patterns: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Aggregate a flat pattern timeline into per-pattern counts.

    Returns a list like:
      [{"name": "sugar push", "count": 5, "quality": "needs_work",
        "timing": "on_beat", "notes": "…"}]

    Keeps the display name from the first occurrence, picks the
    most common quality/timing (ties broken by first seen), and
    joins unique notes with " · " for compact rendering.
    """
    from collections import Counter, defaultdict

    counts: Counter[str] = Counter()
    display_names: dict[str, str] = {}
    qualities: dict[str, list[str]] = defaultdict(list)
    timings: dict[str, list[str]] = defaultdict(list)
    notes: dict[str, list[str]] = defaultdict(list)

    for p in patterns:
        raw_name = (p.get("name") or "").strip()
        if not raw_name:
            continue
        key = _normalize_pattern_name(raw_name)
        counts[key] += 1
        display_names.setdefault(key, raw_name)
        q = p.get("quality")
        if isinstance(q, str) and q:
            qualities[key].append(q)
        t = p.get("timing")
        if isinstance(t, str) and t:
            timings[key].append(t)
        n = (p.get("notes") or "").strip()
        if n and n not in notes[key]:
            notes[key].append(n)

    def _most_common(items: list[str]) -> str | None:
        return Counter(items).most_common(1)[0][0] if items else None

    summary: list[dict[str, Any]] = []
    for key, cnt in counts.most_common():
        summary.append(
            {
                "name": display_names[key],
                "count": cnt,
                "quality": _most_common(qualities[key]),
                "timing": _most_common(timings[key]),
                "notes": " · ".join(notes[key][:3]) if notes[key] else None,
            }
        )
    return summary


def _sanity_check(
    parsed: dict[str, Any],
    duration_sec: float | None,
) -> list[str]:
    """Return a human-readable list of implausibility issues in
    Gemini's response. Empty list = response looks reasonable.

    The goal is to catch "model hallucinated a 60s intro" or
    "claimed there's only 2 patterns in a 2-minute clip" before
    we persist the result. Callers should use the issue list as
    a correction prompt for a single retry.
    """
    issues: list[str] = []

    patterns = parsed.get("patterns_identified") or []
    if not isinstance(patterns, list):
        return ["patterns_identified is missing or not a list"]

    # 1. Non-dance labels that are suspiciously long. A real WCS
    # intro / starter step / anchor-only moment is a few seconds;
    # 15s+ means the model grouped 'walking onstage' or 'waiting'
    # into one block and probably missed actual dancing inside it.
    NON_DANCE = {
        "intro",
        "introduction",
        "waiting",
        "wait",
        "unknown",
        "starter step",
        "pause",
        "break",
        "setup",
        "preparation",
    }
    MAX_NON_DANCE_SEC = 15.0
    MAX_ANY_PATTERN_SEC = 15.0

    for p in patterns:
        if not isinstance(p, dict):
            continue
        name = (p.get("name") or "").strip().lower()
        try:
            start = float(p.get("start_time"))
            end = float(p.get("end_time"))
        except (TypeError, ValueError):
            continue
        span = end - start
        if span <= 0:
            continue
        if name in NON_DANCE and span > MAX_NON_DANCE_SEC:
            issues.append(
                f'"{name}" from {start:.0f}s to {end:.0f}s is '
                f"{span:.0f}s long — too long for a non-dance segment; "
                "something is actually happening in that window"
            )
        elif span > MAX_ANY_PATTERN_SEC:
            issues.append(
                f'pattern "{name}" at {start:.0f}s spans {span:.0f}s '
                "— way too long for a single WCS window; likely merged repeats"
            )

    # 2. Not enough patterns for the video length. WCS runs at
    # roughly one pattern per 4-6 seconds, so a 90s clip should
    # have ~15-25 entries. Flag if we're under half that density.
    if duration_sec and duration_sec > 30:
        expected_min = max(5, int(duration_sec / 10))
        if len(patterns) < expected_min:
            issues.append(
                f"only {len(patterns)} patterns identified for "
                f"{int(duration_sec)}s of video — expected at least "
                f"{expected_min} based on typical WCS pattern density"
            )

    # 3. Large uncovered gaps in the timeline. If the model skipped
    # a 20-second stretch, it almost certainly missed patterns.
    MAX_GAP_SEC = 10.0
    timed = []
    for p in patterns:
        if not isinstance(p, dict):
            continue
        try:
            timed.append(
                (float(p.get("start_time")), float(p.get("end_time")))
            )
        except (TypeError, ValueError):
            continue
    timed.sort()
    prev_end = 0.0
    for start, end in timed:
        gap = start - prev_end
        if gap > MAX_GAP_SEC:
            issues.append(
                f"{gap:.0f}s gap between {prev_end:.0f}s and {start:.0f}s "
                "has no pattern labeled"
            )
        prev_end = max(prev_end, end)
    if duration_sec and duration_sec - prev_end > MAX_GAP_SEC:
        issues.append(
            f"last {duration_sec - prev_end:.0f}s of the video "
            "(from ~{prev:.0f}s onwards) has no pattern labeled".format(
                prev=prev_end
            )
        )

    return issues


def _shape_response(
    parsed: dict[str, Any],
    *,
    usage: dict[str, Any] | None = None,
    sanity_warnings: list[str] | None = None,
) -> dict[str, Any]:
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

    patterns_identified = _sanitize_patterns(parsed.get("patterns_identified"))
    pattern_summary = _summarize_patterns(patterns_identified)

    return {
        "overall": {
            "score": overall_score,
            "grade": grade,
            "confidence": confidence,
            "impression": parsed.get("overall_impression"),
        },
        "categories": categories,
        "patterns_identified": patterns_identified,
        "pattern_summary": pattern_summary,
        "strengths": strengths,
        "improvements": improvements,
        "lead": parsed.get("lead"),
        "follow": parsed.get("follow"),
        "estimated_bpm": parsed.get("estimated_bpm"),
        "song_style": parsed.get("song_style"),
        "sanity_warnings": sanity_warnings or [],
        "usage": usage,
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
