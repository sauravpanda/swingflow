from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass

import librosa
import numpy as np

from .beat_tracker import track_beats


@dataclass
class MusicAnalysis:
    bpm: float
    duration: float
    beats: list[float]
    downbeats: list[float]
    phrases: list[list[float]]
    anchor_beats: list[float]
    source: str = "librosa"  # which tracker produced the beat grid


def _round_list(values: list[float], ndigits: int = 4) -> list[float]:
    return [round(float(v), ndigits) for v in values]


def analyze_music(audio_bytes: bytes, filename: str = "audio") -> MusicAnalysis:
    suffix = os.path.splitext(filename)[1].lower() or ".bin"
    # librosa needs a real file path for MP3 / formats libsndfile can't
    # handle in-memory. Write to a tempfile so both librosa's duration
    # probe and Beat This!'s file-based inference can read it.
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        # Duration via librosa (cheap). We reuse librosa's codec
        # compatibility which has seen the most field time.
        try:
            y, sr = librosa.load(tmp_path, sr=22050, mono=True)
        except Exception as exc:
            raise ValueError(f"could not decode audio: {exc}") from exc
        if y.size == 0:
            raise ValueError("decoded audio is empty")
        duration = float(librosa.get_duration(y=y, sr=sr))

        # Beats + downbeats via the shared tracker (Beat This! primary,
        # librosa fallback). Beat This! returns real downbeats; librosa
        # path uses an onset-offset heuristic documented in beat_tracker.
        result = track_beats(tmp_path)
        if result is None or len(result.beats) < 4:
            raise ValueError("beat tracking failed — no usable beat grid")

        beat_times = result.beats
        downbeat_times = result.downbeats

        # Build 8-count phrases by grouping 2 bars together, starting
        # from the first downbeat. 4/4 music at 2 bars per phrase = 8
        # beats per phrase. For the librosa path downbeat_times comes
        # from an offset pick (every 4th beat); for Beat This! they're
        # actual bar-1 markers.
        phrases: list[list[float]] = []
        if downbeat_times:
            first_down_t = downbeat_times[0]
            try:
                first_idx = beat_times.index(first_down_t)
            except ValueError:
                # Not an exact match (float compare); find nearest
                first_idx = int(
                    np.argmin(np.abs(np.array(beat_times) - first_down_t))
                )
            idx = first_idx
            while idx + 8 <= len(beat_times):
                phrases.append(beat_times[idx : idx + 8])
                idx += 8

        # Anchors: beats 5 and 6 of each 8-count phrase (zero-indexed 4 and 5).
        anchor_beats: list[float] = []
        for phrase in phrases:
            anchor_beats.append(phrase[4])
            anchor_beats.append(phrase[5])

        return MusicAnalysis(
            bpm=round(result.bpm, 2),
            duration=round(duration, 3),
            beats=_round_list(beat_times),
            downbeats=_round_list(downbeat_times),
            phrases=[_round_list(p) for p in phrases],
            anchor_beats=_round_list(anchor_beats),
            source=result.source,
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
