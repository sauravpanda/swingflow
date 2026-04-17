"""Beat + downbeat tracking.

Primary path: Beat This! (CPJKU, ISMIR 2024) — returns real downbeats,
not a heuristic. Solves the "2+4 backbeat louder than 1+3" problem
that breaks librosa's energy-offset heuristic on blues.

Fallback: librosa.beat.beat_track + an onset-energy offset picker
(our original implementation) when Beat This! fails to load or
infer. Import-time failures shouldn't break the service.

Model is lazy-loaded on first call so Railway cold starts don't eat
the ~2-5s model init up front when most requests don't need it (video
analysis calls this, music analysis calls this). Once loaded, held
on the module for subsequent calls in the same container.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from threading import Lock

logger = logging.getLogger(__name__)

_model = None
_model_lock = Lock()


@dataclass
class BeatResult:
    bpm: float
    beats: list[float]
    downbeats: list[float]
    source: str  # "beat_this" or "librosa"


def _load_beat_this():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            from beat_this.inference import File2Beats

            # dbn=False avoids the madmom dependency entirely. The
            # paper shows postprocessing-free inference is SOTA on
            # general music, so we don't need DBN for this use case.
            _model = File2Beats(device="cpu", dbn=False)
            logger.info("beat_tracker: loaded Beat This! (cpu, dbn=False)")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "beat_tracker: Beat This! failed to load, "
                "falling back to librosa: %s",
                exc,
            )
            _model = False  # sentinel: don't retry
    return _model


def _track_with_beat_this(wav_path: str) -> BeatResult | None:
    model = _load_beat_this()
    if not model:
        return None
    try:
        import numpy as np

        beats, downbeats = model(wav_path)
        beats_arr = np.asarray(beats, dtype=float)
        downbeats_arr = np.asarray(downbeats, dtype=float)
        if beats_arr.size < 2:
            return None
        bpm = 60.0 / float(np.median(np.diff(beats_arr)))
        return BeatResult(
            bpm=round(bpm, 2),
            beats=beats_arr.tolist(),
            downbeats=downbeats_arr.tolist(),
            source="beat_this",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("beat_tracker: Beat This! inference failed: %s", exc)
        return None


def _track_with_librosa(wav_path: str) -> BeatResult | None:
    """Original librosa beat_track + onset-offset heuristic. Kept as
    a fallback so the service degrades gracefully if Beat This! is
    unavailable for any reason.
    """
    try:
        import librosa
        import numpy as np

        y, sr = librosa.load(wav_path, sr=22050, mono=True)
        if y.size == 0:
            return None
        tempo_raw, beat_frames = librosa.beat.beat_track(
            y=y, sr=sr, units="frames"
        )
        if beat_frames.size < 4:
            return None
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        bpm = (
            float(tempo_raw)
            if not hasattr(tempo_raw, "__iter__")
            else float(list(tempo_raw)[0])
        )

        # Pick the 4-offset (0..3) whose beats carry the most
        # onset-strength energy, treat every 4th beat from there as
        # a downbeat. Works on clean 4/4 but fails on blues where
        # the backbeat (2+4) is louder than the downbeat (1+3) —
        # this is exactly the failure mode Beat This! fixes.
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        best_offset = 0
        scores: list[float] = []
        for off in range(4):
            idxs = np.asarray(beat_frames[off::4], dtype=int)
            idxs = idxs[idxs < len(onset_env)]
            scores.append(float(onset_env[idxs].sum()) if idxs.size else 0.0)
        best_offset = int(np.argmax(scores))
        downbeats = beat_times[best_offset::4]

        return BeatResult(
            bpm=round(bpm, 2),
            beats=beat_times,
            downbeats=downbeats,
            source="librosa",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("beat_tracker: librosa fallback failed: %s", exc)
        return None


def track_beats(wav_path: str) -> BeatResult | None:
    """Detect beats + downbeats on a WAV file at `wav_path`.

    Tries Beat This! first (SOTA, real downbeats), falls back to
    librosa + onset-offset heuristic. Returns None if both fail,
    which callers treat as "no beat context" and continue without.
    """
    result = _track_with_beat_this(wav_path)
    if result is not None:
        return result
    return _track_with_librosa(wav_path)
