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

import logging
import os
import tempfile
import time
from typing import Any

from google import genai

logger = logging.getLogger(__name__)

from ...settings import settings
from .gemini_client import (
    VideoAnalysisError,
    _call_gemini,
    _safe_parse_json,
)
from .media_context import (
    _detect_motion_floor,
    _extract_beat_context,
    _video_part_with_fps,
    get_video_duration,
)
from .prompts import (
    GEMINI_VIDEO_PROMPT,
    PATTERN_SEGMENTATION_PROMPT,
    _build_sanity_retry_prompt,
    _build_user_context,
    _format_pattern_timeline,
)
from .response_sanitizer import (
    _pattern_inside_window,
    _safe_float,
    _sanity_check,
    _shape_response,
)


# ─────────────────────────────────────────────────────────────────────
# Pattern pre-pass
# ─────────────────────────────────────────────────────────────────────

def _run_pattern_pre_pass(
    client: genai.Client,
    model: str,
    video_file: Any,
    first_downbeat_sec: float | None = None,
    motion_floor_sec: float | None = None,
    duration_sec: float | None = None,
    seed: int | None = 42,
) -> tuple[str | None, dict[str, Any] | None, float | None, float | None]:
    """Single-purpose Gemini call asking ONLY about the pattern timeline.

    Per wcs-analyzer's docstring: "the per-pattern focus consistently
    outperforms asking the main prompt to enumerate patterns while also
    scoring the dance." Failures here are non-fatal — we fall back to
    the main prompt enumerating patterns inline.

    `first_downbeat_sec` from Beat This! acts as a floor on
    dance_start_sec — the couple can't be dancing to music that hasn't
    started yet, so any value smaller than this is clamped up.

    Returns (prompt_context, usage, dance_start_sec, dance_end_sec).
    Any may be None on failure.
    """
    try:
        # Pattern ID benefits disproportionately from extra reasoning
        # — this is where "sugar push vs whip vs tuck turn" gets
        # disambiguated. Using HIGH thinking here and keeping MEDIUM
        # on the main scoring call trades some pre-pass cost for
        # noticeably better pattern accuracy downstream. Also pass a
        # null system_prompt so SYSTEM_PROMPT's full judging rubric
        # doesn't bias this pure-ID pass.
        raw, usage = _call_gemini(
            client,
            model,
            contents=[video_file, PATTERN_SEGMENTATION_PROMPT],
            system_prompt=(
                "You are a WCS pattern identification specialist. "
                "Your only task is to produce a beat-anchored pattern "
                "timeline. Do not score, do not judge, do not comment "
                "on quality — just identify WHAT happens WHEN."
            ),
            thinking_level_override="high",
            seed=seed,
        )
    except VideoAnalysisError as exc:
        logger.warning("video_analysis.pre_pass_failed error=%r", exc)
        return None, None, None, None
    data = _safe_parse_json(raw)
    if not data:
        logger.warning(
            "video_analysis.pre_pass_unparseable raw_prefix=%r",
            raw[:200] if raw else None,
        )
        return None, usage, None, None

    dance_start = _safe_float(data.get("dance_start_sec"))
    dance_end = _safe_float(data.get("dance_end_sec"))
    # Floor dance_start on the first detected downbeat — if the music
    # hasn't kicked in yet, nobody's dancing.
    if first_downbeat_sec is not None and dance_start is not None:
        if dance_start + 0.25 < first_downbeat_sec:
            dance_start = first_downbeat_sec
    # Floor on motion start — if no visible movement yet, still not
    # dancing regardless of what the pre-pass model said.
    if (
        motion_floor_sec is not None
        and motion_floor_sec > 0.5
        and (
            dance_start is None
            or dance_start + 0.25 < motion_floor_sec
        )
    ):
        dance_start = motion_floor_sec
    # Clamp dance_end to the video duration when we know it.
    if duration_sec is not None and dance_end is not None:
        dance_end = min(dance_end, duration_sec)

    patterns = data.get("patterns")
    if not isinstance(patterns, list) or not patterns:
        return None, usage, dance_start, dance_end
    # Defensively drop any pre-pass patterns that fell outside the
    # declared dance window — the pre-pass follows its own prompt, but
    # we still occasionally see stragglers.
    if dance_start is not None or dance_end is not None:
        patterns = [
            p for p in patterns
            if _pattern_inside_window(p, dance_start, dance_end)
        ]
        if not patterns:
            return None, usage, dance_start, dance_end
    return (
        _format_pattern_timeline(patterns, dance_start, dance_end),
        usage,
        dance_start,
        dance_end,
    )


# ─────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────

def analyze_video_path(
    video_path: str,
    duration_sec: float | None = None,
    context: dict[str, Any] | None = None,
    fresh: bool = False,
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

    `fresh=True` opts out of the pinned seed so the call returns a
    different result than previous runs on the same video. Used on
    Re-analyze — without this, seed=42 + temperature=0 gives
    near-identical output every run, which confuses users who expect
    a re-run to actually retry. Fresh runs keep temperature=0 so
    we're not introducing high variance — just enough seed jitter
    for the thinking path to diverge.
    """
    if not settings.gemini_api_key:
        raise VideoAnalysisError("GEMINI_API_KEY not configured")

    # Random seed on fresh runs; pinned on normal runs. Keep
    # (pre-pass, main, retry) all on the SAME seed for a given
    # analysis so they're internally consistent — a pre-pass that
    # reasoned one way shouldn't get contradicted by a main call on
    # a different seed.
    import secrets as _secrets

    seed: int | None = _secrets.randbelow(2**31) if fresh else 42

    client = genai.Client(api_key=settings.gemini_api_key)
    # Upload outside the try so `uploaded` is bound before we enter
    # cleanup territory; if the upload itself raises, there's nothing
    # to delete.
    uploaded = client.files.upload(file=video_path)

    # Aggregate token usage across pre-pass + main call so cost
    # tracking reflects the full billed spend for this analysis.
    total_prompt_tokens = 0
    total_response_tokens = 0

    sanity_warnings: list[str] = []

    try:
        # Poll until the file is ACTIVE on Gemini's side. Inside the
        # try block so a timeout or non-ACTIVE state still triggers
        # the cleanup in `finally`.
        deadline = time.time() + 120
        while uploaded.state and uploaded.state.name == "PROCESSING":
            if time.time() > deadline:
                raise VideoAnalysisError("Gemini file processing timed out")
            time.sleep(1.5)
            uploaded = client.files.get(name=uploaded.name)

        if not uploaded.state or uploaded.state.name != "ACTIVE":
            state_name = uploaded.state.name if uploaded.state else "UNKNOWN"
            raise VideoAnalysisError(f"Gemini file upload state: {state_name}")

        # Wrap the uploaded video with an explicit fps=2 sampling hint.
        # Default Gemini sampling is ~1 FPS; doubling it catches the
        # "&" counts between beats (kick-ball-changes, quick anchor
        # settles) that 1 FPS routinely misses. Video token cost ~2x,
        # still bounded because we only upload short clips.
        video_part = _video_part_with_fps(uploaded, fps=2.0)

        prompt = GEMINI_VIDEO_PROMPT

        # User-provided metadata (level, role, event, stage, tags)
        # sits at the top of the prompt so Gemini calibrates against
        # the stated tier. Empty string when no context was supplied.
        user_context = _build_user_context(context)
        if user_context:
            prompt = f"{user_context}\n{prompt}"

        # Prepend librosa-derived beat context to ground timing judgments.
        (
            beat_context,
            first_downbeat_sec,
            beat_grid,
        ) = _extract_beat_context(video_path)
        if beat_context:
            prompt = f"{beat_context}\n\n{prompt}"

        # Pre-compute a motion floor by sampling frame-to-frame pixel
        # change. When the first N seconds of the clip have low motion
        # (dancers in closed position), this floor floors dance_start_sec
        # above the pre-dance window, catching cases where Gemini would
        # hallucinate patterns over setup time.
        motion_floor_sec = _detect_motion_floor(video_path)
        if motion_floor_sec is not None and motion_floor_sec > 0.5:
            motion_note = (
                f"\n\nDETECTED MOTION FLOOR: "
                f"{motion_floor_sec:.2f}s — the video's first "
                "sustained movement begins here (frame-to-frame pixel "
                "change transitions from low to high at this "
                "timestamp). Use this as an additional floor on "
                "dance_start_sec: the couple cannot be dancing "
                "before there is measurable motion in the frame. "
                "dance_start_sec must be >= this value UNLESS you "
                "can clearly see weight changes happening before it "
                "(rare — usually means camera pan or an object "
                "moving in the background).\n"
            )
            prompt = f"{motion_note}\n{prompt}"

        dance_start_sec: float | None = None
        dance_end_sec: float | None = None
        if settings.enable_pattern_prepass:
            (
                pre_pass_context,
                pre_pass_usage,
                dance_start_sec,
                dance_end_sec,
            ) = _run_pattern_pre_pass(
                client,
                settings.gemini_model,
                video_part,
                first_downbeat_sec=first_downbeat_sec,
                motion_floor_sec=motion_floor_sec,
                duration_sec=duration_sec,
                seed=seed,
            )
            if pre_pass_context:
                prompt = f"{pre_pass_context}\n\n{prompt}"
            if pre_pass_usage:
                total_prompt_tokens += int(pre_pass_usage.get("prompt_tokens", 0))
                total_response_tokens += int(pre_pass_usage.get("response_tokens", 0))

        raw, main_usage = _call_gemini(
            client,
            settings.gemini_model,
            contents=[video_part, prompt],
            seed=seed,
        )
        total_prompt_tokens += int(main_usage.get("prompt_tokens", 0))
        total_response_tokens += int(main_usage.get("response_tokens", 0))

        parsed = _safe_parse_json(raw)
        if parsed is None:
            raise VideoAnalysisError(
                f"Gemini returned unparseable JSON: {raw[:200]}"
            )

        # Prefer the main model's dance_start / dance_end if it
        # returned them; fall back to pre-pass values; floor on the
        # first detected downbeat + motion floor so nothing slips
        # below the music or below the first visible movement.
        main_dance_start = _safe_float(parsed.get("dance_start_sec"))
        main_dance_end = _safe_float(parsed.get("dance_end_sec"))
        if main_dance_start is not None:
            dance_start_sec = main_dance_start
        if main_dance_end is not None:
            dance_end_sec = main_dance_end
        # Floor on audio first-downbeat.
        if (
            first_downbeat_sec is not None
            and dance_start_sec is not None
            and dance_start_sec + 0.25 < first_downbeat_sec
        ):
            dance_start_sec = first_downbeat_sec
        # Floor on motion start. Catches the "dancers are in closed
        # position holding frame" case where Gemini misreads the
        # setup as a starter step.
        if (
            motion_floor_sec is not None
            and motion_floor_sec > 0.5
            and (
                dance_start_sec is None
                or dance_start_sec + 0.25 < motion_floor_sec
            )
        ):
            dance_start_sec = motion_floor_sec
        if duration_sec is not None and dance_end_sec is not None:
            dance_end_sec = min(dance_end_sec, duration_sec)

        # Fallback: if neither the pre-pass nor the main call emitted
        # a dance window but the main call DID emit patterns with
        # start_time / end_time, derive the window from those. Without
        # this, a main call that silently drops dance_start_sec/
        # dance_end_sec (empirically common on the large schema we
        # send today) ships to the user with `dance_window=null`,
        # which breaks the timeline UI's window-clamping and the
        # sanitizer's pre-dance-pattern trimming.
        if dance_start_sec is None or dance_end_sec is None:
            pattern_times: list[tuple[float, float]] = []
            for p in parsed.get("patterns_identified") or []:
                if not isinstance(p, dict):
                    continue
                ps = _safe_float(p.get("start_time"))
                pe = _safe_float(p.get("end_time"))
                if ps is not None and pe is not None and pe > ps:
                    pattern_times.append((ps, pe))
            if pattern_times:
                if dance_start_sec is None:
                    dance_start_sec = min(s for s, _ in pattern_times)
                    logger.info(
                        "video_analysis.dance_start_fallback derived=%s",
                        dance_start_sec,
                    )
                if dance_end_sec is None:
                    dance_end_sec = max(e for _, e in pattern_times)
                    logger.info(
                        "video_analysis.dance_end_fallback derived=%s",
                        dance_end_sec,
                    )
            # Re-apply floors after the fallback.
            if (
                first_downbeat_sec is not None
                and dance_start_sec is not None
                and dance_start_sec + 0.25 < first_downbeat_sec
            ):
                dance_start_sec = first_downbeat_sec
            if (
                motion_floor_sec is not None
                and motion_floor_sec > 0.5
                and dance_start_sec is not None
                and dance_start_sec + 0.25 < motion_floor_sec
            ):
                dance_start_sec = motion_floor_sec
            if duration_sec is not None and dance_end_sec is not None:
                dance_end_sec = min(dance_end_sec, duration_sec)

        # Log load-bearing fields that the main call silently dropped.
        # These are the four lenses the UX advertises; missing them
        # in prod is how Sarah's feedback arrived as "horoscope".
        missing_fields = [
            f
            for f in (
                "dance_start_sec",
                "dance_end_sec",
                "musical_moments",
                "follower_initiative",
            )
            if parsed.get(f) in (None, [], {})
        ]
        if missing_fields:
            logger.warning(
                "video_analysis.main_call_missing_fields fields=%s",
                missing_fields,
            )

        # Sanity check: if the response has obvious implausibilities
        # (e.g. "intro lasted 60s" or only 2 patterns for a 2-minute
        # clip), do ONE corrective retry with the specific issues
        # fed back to the model. If the retry still has issues, we
        # accept it and surface the warnings in the response so the
        # frontend can display a "low confidence" badge.
        issues = _sanity_check(
            parsed,
            duration_sec,
            dance_start_sec=dance_start_sec,
            dance_end_sec=dance_end_sec,
        )
        if issues:
            retry_prompt = _build_sanity_retry_prompt(
                issues,
                raw,
                dance_start_sec=dance_start_sec,
                dance_end_sec=dance_end_sec,
            )
            try:
                retry_raw, retry_usage = _call_gemini(
                    client,
                    settings.gemini_model,
                    contents=[video_part, retry_prompt],
                    seed=seed,
                )
                total_prompt_tokens += int(retry_usage.get("prompt_tokens", 0))
                total_response_tokens += int(retry_usage.get("response_tokens", 0))
                retry_parsed = _safe_parse_json(retry_raw)
                if retry_parsed is not None:
                    # Only accept the retry if it's strictly better —
                    # otherwise keep the original + warnings.
                    retry_issues = _sanity_check(
                        retry_parsed,
                        duration_sec,
                        dance_start_sec=dance_start_sec,
                        dance_end_sec=dance_end_sec,
                    )
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

    from ..pricing import estimate_cost_micros, pricing_updated_on

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
        parsed,
        usage=usage,
        sanity_warnings=sanity_warnings,
        dance_start_sec=dance_start_sec,
        dance_end_sec=dance_end_sec,
        beat_grid=beat_grid,
    )


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
        # Pass duration through so sanity checks (pattern density,
        # gap detection) and dance_end_sec clamping work on this
        # byte-upload path the same way they do on the R2 path.
        result = analyze_video_path(tmp_path, duration_sec=duration)
        return result, duration
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
