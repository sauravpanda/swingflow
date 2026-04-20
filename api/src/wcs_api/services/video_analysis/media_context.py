from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from typing import Any

from google.genai import types as genai_types

from .gemini_client import VideoAnalysisError

logger = logging.getLogger(__name__)


def _detect_motion_floor(video_path: str) -> float | None:
    """Find the first timestamp in the video where sustained motion
    appears, as a floor for dance_start_sec.

    Dancers standing in closed position have low frame-to-frame pixel
    variance (small sways, breathing). Active dancing has 3-10x higher
    motion from traveling feet + body position changes. We sample at
    2 FPS, compute per-frame motion scores, find the baseline (early
    frames' motion), and return the first timestamp where smoothed
    motion sustains above a multiplier over baseline.

    Returns None when motion detection fails (ffmpeg error, numpy not
    available, or no clear transition detected). Caller treats None
    as "no motion floor available" and falls back to beat-based floor
    alone. This is best-effort enrichment.
    """
    try:
        import numpy as np

        # Extract grayscale frames at 2 FPS, 64x48 resolution. That's
        # ~3KB per frame, small enough to buffer a 10-minute clip
        # entirely in RAM (~3.6MB) without worrying.
        with tempfile.TemporaryDirectory() as tmp_dir:
            raw_path = os.path.join(tmp_dir, "frames.raw")
            subprocess.run(
                [
                    "ffmpeg",
                    "-i",
                    video_path,
                    "-vf",
                    "fps=2,scale=64:48",
                    "-pix_fmt",
                    "gray",
                    "-f",
                    "rawvideo",
                    raw_path,
                ],
                capture_output=True,
                check=True,
                timeout=60,
            )
            size = os.path.getsize(raw_path)
            frame_bytes = 64 * 48
            n_frames = size // frame_bytes
            if n_frames < 6:
                return None
            with open(raw_path, "rb") as f:
                data = f.read()
            frames = np.frombuffer(data, dtype=np.uint8).reshape(
                n_frames, 48, 64
            )

        # Per-frame motion = mean absolute difference from previous
        # frame. Compute in int32 to avoid uint8 overflow.
        motions = np.abs(
            frames[1:].astype(np.int32) - frames[:-1].astype(np.int32)
        ).mean(axis=(1, 2))

        # 2-second smoothing window (4 samples at 2 FPS) — averages
        # out transient blips (camera jitter, flash, a passerby in
        # frame) while preserving the transition into dancing.
        window = 4
        if len(motions) < window * 2:
            return None
        smoothed = np.convolve(
            motions, np.ones(window) / window, mode="valid"
        )

        # Baseline from first 2 seconds of smoothed signal. If the
        # baseline is already high (clip is already dancing from
        # frame 1 — a mid-song cut), return 0 so nothing gets
        # clamped unexpectedly.
        baseline = float(smoothed[: min(4, len(smoothed))].mean())
        # Guard: if the baseline is high (>20/255 mean pixel change),
        # the clip has no clear "waiting" period. Trust the LLM.
        if baseline > 20.0:
            return 0.0
        # Multiplier of 2.5x baseline catches real dance motion
        # without flagging camera pans / audience applause motion.
        threshold = max(baseline * 2.5, baseline + 5.0)

        # Find first sustained crossing — require 3 consecutive
        # smoothed samples (~1.5s) above threshold so a brief flash
        # doesn't count.
        streak_needed = 3
        streak = 0
        for i, m in enumerate(smoothed):
            if m > threshold:
                streak += 1
                if streak >= streak_needed:
                    # Smoothed index i corresponds to motions index
                    # i + window - 1, which is the START of the 4-
                    # sample window (i.e. the frame-transition at
                    # time i/2 seconds into the video, since motions
                    # starts at frame 1 at 2 FPS).
                    crossing_idx = i - streak_needed + 1
                    return float(crossing_idx) / 2.0
            else:
                streak = 0
        return None
    except Exception:
        return None


def _extract_beat_context(
    video_path: str,
) -> tuple[str | None, float | None, dict[str, Any] | None]:
    """Pull audio out of the video, run beat tracking (Beat This!
    preferred, librosa fallback), and return a prompt-ready string
    plus the first detected downbeat (seconds) plus a compact
    beat-grid dict for the frontend metronome.

    Gemini's native audio understanding is good, but a STRUCTURED
    beat grid — especially one with real downbeats, not a heuristic
    pick — gives the model an authoritative timing reference it can
    snap pattern boundaries to.

    The first downbeat doubles as a lower bound on when dancing
    can plausibly start — the couple can't be dancing to music
    that hasn't begun — which the pre-pass uses to reject
    hallucinated pre-dance pattern windows.

    The beat-grid dict exposes `{bpm, beats, downbeats}` for the
    frontend visual metronome so users can see whether the detected
    pulse matches what they hear — a fast diagnostic when the
    pattern timing feels off.

    Silent-fail on any error — this is a best-effort enrichment,
    not a blocker on the analysis itself.
    """
    try:
        from ..beat_tracker import (
            classify_song_style,
            detect_swing_ratio,
            track_beats,
        )

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
            result = track_beats(wav_path)
            if result is None or len(result.beats) < 4:
                return None, None, None
            bpm = result.bpm
            # Swing-ratio heuristic: tells us whether eighth notes are
            # swung (blues, shuffle) or straight (contemporary, pop).
            # This informs triple-step timing — in swung tracks the "&"
            # of a triple lands ~2/3 through the beat, not halfway.
            # Runs on the already-extracted wav so there's no extra
            # ffmpeg cost.
            swing_ratio = detect_swing_ratio(wav_path, result.beats)
            detected_style = classify_song_style(swing_ratio)
            # WCS-typical BPM is roughly 65-160. When Beat This! reports
            # something far outside that — usually because a busy
            # subdivision (hi-hats on 8ths, breakbeats) got picked up
            # as the pulse — halve or double the reported tempo so the
            # prompt's beat-grid narrative matches what a human would
            # count. We keep the raw beats array intact (the model can
            # still use the fine-grained timestamps) but flag the tempo
            # mismatch in the prompt so it treats every 2nd beat as a
            # "real" beat if needed.
            bpm_adjustment_note = ""
            if bpm > 160:
                bpm_adjustment_note = (
                    f"\n- WARNING: raw BPM {bpm:.0f} is unusually fast "
                    "for WCS (typical 65-160). The tracker may have "
                    "picked up 8th-note subdivisions; treat every OTHER "
                    f"detected beat as the actual pulse (~{bpm / 2:.0f} BPM)."
                )
            elif bpm < 55 and bpm > 0:
                bpm_adjustment_note = (
                    f"\n- WARNING: raw BPM {bpm:.0f} is unusually slow "
                    "for WCS (typical 65-160). The tracker may have "
                    "detected only downbeats; consider the actual pulse "
                    f"to be ~{bpm * 2:.0f} BPM."
                )
            first_downbeat_sec = (
                float(result.downbeats[0])
                if result.downbeats
                else float(result.beats[0])
            )
            # Prefer real downbeats when Beat This! is in use. Fall
            # back to "every 4 beats from onset-offset pick" when on
            # librosa path. The prompt below flags which source we
            # used so downstream sanity checks can trust Beat This!
            # output more.
            beat_times = result.beats
            downbeat_set = set(result.downbeats)
            source = result.source
            # FULL beat timeline with phrase-1/5 markers. WCS clips
            # (especially blues and contemporary) often have tempo
            # shifts or breaks mid-song, so passing only the first
            # portion + relying on BPM extrapolation would miss real
            # timing drift. Cost is small — ~1000 tokens for a full
            # 2-min clip — vs. the accuracy gain from a grid that's
            # valid end-to-end.
            all_beats = beat_times
            lines: list[str] = []
            # With Beat This! we know which beats are actual downbeats
            # (real bar-1 of the 4/4). We label those as the phrase
            # starts and count onward from there. With librosa fallback,
            # downbeat_set has the heuristic-picked offset beats and
            # we do the same, but it's less reliable.
            last_downbeat_idx = 0
            for i, t in enumerate(all_beats):
                is_downbeat = t in downbeat_set
                if is_downbeat:
                    last_downbeat_idx = i
                    # First downbeat of a pair = phrase start in WCS
                    # (2 musical bars = 1 8-count phrase). Model will
                    # also understand "downbeat" generically.
                phrase_beat = ((i - last_downbeat_idx) % 8) + 1
                marker = ""
                if is_downbeat:
                    marker = "  ← DOWNBEAT (bar 1)"
                    if phrase_beat == 1:
                        marker += " · phrase start"
                elif phrase_beat == 5:
                    marker = "  ← anchor region (beats 5-6)"
                lines.append(f"  {t:6.2f}s  beat {phrase_beat}{marker}")
            grid = "\n".join(lines)
            total_beats = len(all_beats)
            total_downbeats = len(downbeat_set)
            # Flag tempo shifts: compute rolling inter-beat-interval
            # and note any windows where it deviates >15% from the
            # average. Gives the model an explicit heads-up instead
            # of forcing it to re-detect BPM shifts itself.
            shift_notes = ""
            if total_beats >= 16:
                ibis = [
                    all_beats[i + 1] - all_beats[i]
                    for i in range(total_beats - 1)
                ]
                avg_ibi = sum(ibis) / len(ibis)
                shifts: list[str] = []
                for i, ibi in enumerate(ibis):
                    if avg_ibi > 0 and abs(ibi - avg_ibi) / avg_ibi > 0.15:
                        shifts.append(
                            f"  near {all_beats[i]:.1f}s (ibi {ibi:.2f}s vs avg {avg_ibi:.2f}s)"
                        )
                if shifts:
                    shift_notes = (
                        "\n- Tempo shifts detected (interval deviates >15% from average):\n"
                        + "\n".join(shifts[:8])
                        + ("\n  …" if len(shifts) > 8 else "")
                    )
            source_note = (
                "Beat This! (ISMIR 2024) with real downbeat detection"
                if source == "beat_this"
                else "librosa (heuristic downbeats — treat with skepticism)"
            )
            # Swing-vs-straight narrative so the model calibrates
            # triple-step timing to the actual feel of the song. Empty
            # string when the detector couldn't commit.
            swing_note = ""
            if detected_style == "blues" and swing_ratio is not None:
                swing_note = (
                    f"\n- SONG FEEL: swung eighths (triplet-based) — "
                    f"detected swing ratio {swing_ratio:.2f}. Triple "
                    "steps should land LONG-short (eighth lands at "
                    "~2/3 of the beat), not straight halfway eighths. "
                    "On-time triples here will SOUND swung, not even. "
                    "Do not penalize the dancer for slightly late "
                    "'&' counts if the music is swung — that's correct."
                )
            elif (
                detected_style == "contemporary-light-swing"
                and swing_ratio is not None
            ):
                swing_note = (
                    f"\n- SONG FEEL: mostly straight with light "
                    f"swing (ratio {swing_ratio:.2f}). Modern WCS "
                    "covers often blend — triples can land slightly "
                    "past halfway without being 'late'."
                )
            elif detected_style == "contemporary" and swing_ratio is not None:
                swing_note = (
                    f"\n- SONG FEEL: straight eighths "
                    f"(ratio {swing_ratio:.2f}). Triples land evenly "
                    "on the halfway point of each beat."
                )
            prompt_text = (
                f"DETECTED MUSIC CONTEXT (from {source_note}):\n"
                f"- Estimated average BPM: {bpm:.1f}"
                f"{bpm_adjustment_note}\n"
                f"- Total beats detected: {total_beats} "
                f"({total_downbeats} real downbeats)\n"
                f"- FIRST DOWNBEAT at {first_downbeat_sec:.2f}s "
                "(dancing cannot start earlier than this)"
                f"{swing_note}"
                f"{shift_notes}\n"
                "- Full beat grid (use this as the AUTHORITATIVE timeline):\n"
                f"{grid}\n\n"
                "Use this grid as a STRONG PRIOR. Every pattern boundary "
                "should snap to the nearest DOWNBEAT (start) and end on "
                "beat 6 (6-count patterns) or beat 8 (8-count patterns) "
                "of the phrase that started at a downbeat. A dancer's "
                "weight change within ~100ms of a detected beat counts "
                "as on-beat. Anchor steps should land near beats 5 and 6 "
                "of each 8-count phrase. Do NOT invent times between "
                "beats — align to the grid. When tempo shifts (see "
                "flagged regions), re-anchor to the actual beat "
                "timestamps rather than extrapolating.\n"
            )
            # Compact grid for the frontend metronome. Round to
            # milliseconds to keep the payload small — sub-ms
            # precision doesn't matter for a visual pulse.
            # Sort downbeats chronologically — `downbeat_set` is a
            # plain set, so iterating it yields arbitrary order, and
            # the frontend metronome does a binary search that assumes
            # sorted input.
            beat_grid = {
                "bpm": round(float(bpm), 1),
                "beats": [round(float(t), 3) for t in all_beats],
                "downbeats": [round(float(t), 3) for t in sorted(downbeat_set)],
                "source": source,
                "swing_ratio": swing_ratio,
                "detected_style": detected_style,
            }
            return prompt_text, first_downbeat_sec, beat_grid
        finally:
            try:
                os.unlink(wav_path)
            except OSError:
                pass
    except Exception as exc:  # noqa: BLE001
        # Silent failure here cascades into an empty `beat_grid` and a
        # missing `first_downbeat_sec` floor on the analyzer, which
        # then lets pre-dance hallucinations through. Log loud enough
        # that Railway logs show why the beat context is absent when
        # a real analysis ships with beat_grid={}.
        logger.warning(
            "video_analysis.beat_context_failed video=%s error=%r",
            video_path,
            exc,
        )
        return None, None, None


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

    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise VideoAnalysisError("could not parse video duration") from exc
    try:
        return float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError) as exc:
        raise VideoAnalysisError("could not parse video duration") from exc


def _video_part_with_fps(uploaded: Any, fps: float = 2.0) -> genai_types.Part:
    """Wrap an uploaded Gemini File as a Part with explicit video
    sampling FPS. Default is 2 FPS — twice the temporal resolution
    of Gemini's ~1 FPS default, which matters for dance moves that
    happen on the & counts (roughly 2-3 FPS at typical WCS tempos).
    """
    return genai_types.Part(
        file_data=genai_types.FileData(
            file_uri=uploaded.uri,
            mime_type=getattr(uploaded, "mime_type", None) or "video/mp4",
        ),
        video_metadata=genai_types.VideoMetadata(fps=fps),
    )
