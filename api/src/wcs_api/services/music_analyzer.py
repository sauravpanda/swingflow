from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass

import librosa
import numpy as np


@dataclass
class MusicAnalysis:
    bpm: float
    duration: float
    beats: list[float]
    downbeats: list[float]
    phrases: list[list[float]]
    anchor_beats: list[float]


def _round_list(values: list[float], ndigits: int = 4) -> list[float]:
    return [round(float(v), ndigits) for v in values]


def analyze_music(audio_bytes: bytes, filename: str = "audio") -> MusicAnalysis:
    suffix = os.path.splitext(filename)[1].lower() or ".bin"
    # librosa needs a real file path for MP3 / formats libsndfile can't handle
    # in-memory. Write to a tempfile and let librosa pick the backend.
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        try:
            y, sr = librosa.load(tmp_path, sr=22050, mono=True)
        except Exception as exc:
            raise ValueError(f"could not decode audio: {exc}") from exc

        if y.size == 0:
            raise ValueError("decoded audio is empty")

        duration = float(librosa.get_duration(y=y, sr=sr))

        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
        bpm_val = float(np.asarray(tempo).ravel()[0]) if np.asarray(tempo).size else 0.0

        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

        # Downbeat heuristic: librosa has no real downbeat tracker, so we pick the
        # offset (0..3) whose beats carry the most onset-strength energy and treat
        # every 4th beat from there as a downbeat. Works well for 4/4 WCS music.
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        best_offset = 0
        if beat_frames.size >= 4:
            scores: list[float] = []
            for off in range(4):
                idxs = np.asarray(beat_frames[off::4], dtype=int)
                idxs = idxs[idxs < len(onset_env)]
                scores.append(float(onset_env[idxs].sum()) if idxs.size else 0.0)
            best_offset = int(np.argmax(scores))

        downbeat_times = beat_times[best_offset::4]

        # 8-count phrases: WCS music is counted in 8s, two downbeats per phrase.
        phrases: list[list[float]] = []
        idx = best_offset
        while idx + 8 <= len(beat_times):
            phrases.append(beat_times[idx : idx + 8])
            idx += 8

        # Anchors: beats 5 and 6 of each 8-count (zero-indexed 4 and 5).
        anchor_beats: list[float] = []
        for phrase in phrases:
            anchor_beats.append(phrase[4])
            anchor_beats.append(phrase[5])

        return MusicAnalysis(
            bpm=round(bpm_val, 2),
            duration=round(duration, 3),
            beats=_round_list(beat_times),
            downbeats=_round_list(downbeat_times),
            phrases=[_round_list(p) for p in phrases],
            anchor_beats=_round_list(anchor_beats),
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
