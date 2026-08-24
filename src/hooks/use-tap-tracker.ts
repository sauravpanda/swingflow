"use client";

import { useState, useCallback, type RefObject } from "react";
import {
  type TapResult,
  type TapRating,
  type TimingDot,
  TAP_THRESHOLD_PERFECT_MS,
  TAP_THRESHOLD_GOOD_MS,
  TAP_THRESHOLD_OK_MS,
  HAPTIC_PATTERNS,
} from "@/lib/rhythm-constants";
import type { ScheduledBeat } from "@/hooks/use-metronome";

function rateDelta(ms: number): TapRating {
  if (ms < TAP_THRESHOLD_PERFECT_MS) return "perfect";
  if (ms < TAP_THRESHOLD_GOOD_MS) return "good";
  if (ms < TAP_THRESHOLD_OK_MS) return "ok";
  return "miss";
}

export function useTapTracker(
  audioContextRef: RefObject<AudioContext | null>,
  scheduledBeatsRef: RefObject<ScheduledBeat[]>,
  // When populated, taps are graded against these beats (real beats of a
  // loaded song, in AudioContext time) instead of the metronome's clock.
  songBeatsRef?: RefObject<ScheduledBeat[]>
) {
  const [results, setResults] = useState<TapResult[]>([]);

  const handleTap = useCallback(() => {
    const ctx = audioContextRef.current;
    const beats = songBeatsRef?.current?.length
      ? songBeatsRef.current
      : scheduledBeatsRef.current;
    if (!ctx || beats.length === 0) return;

    const tapTime = ctx.currentTime;

    // Find the nearest scheduled beat
    let nearestBeat = beats[0];
    let minDelta = Math.abs(tapTime - beats[0].time);

    for (let i = 1; i < beats.length; i++) {
      const delta = Math.abs(tapTime - beats[i].time);
      if (delta < minDelta) {
        minDelta = delta;
        nearestBeat = beats[i];
      }
    }

    const deltaMs = minDelta * 1000;
    const signedDeltaMs = (tapTime - nearestBeat.time) * 1000; // negative = early
    const rating = rateDelta(deltaMs);

    // Haptic feedback only — no audio. Rating tones over the music (or even
    // the bare metronome) were more distracting than helpful; the tap area
    // gives visual feedback instead.
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(HAPTIC_PATTERNS[rating]);
    }

    const result: TapResult = {
      rating,
      deltaMs,
      signedDeltaMs,
      subdivisionIndex: nearestBeat.subdivisionIndex,
      timestamp: tapTime,
    };

    setResults((prev) => [result, ...prev].slice(0, 50));

    return result;
  }, [audioContextRef, scheduledBeatsRef, songBeatsRef]);

  const getAccuracyPercent = useCallback(() => {
    if (results.length === 0) return 0;
    const maxDelta = TAP_THRESHOLD_OK_MS;
    const sum = results.reduce((acc, r) => {
      const clamped = Math.min(r.deltaMs, maxDelta);
      return acc + (1 - clamped / maxDelta);
    }, 0);
    return Math.round((sum / results.length) * 100);
  }, [results]);

  const getTimingDots = useCallback((): TimingDot[] => {
    return results.map((r) => ({
      beatIndex: Math.floor(r.subdivisionIndex / 4),
      signedDeltaMs: r.signedDeltaMs,
      rating: r.rating,
    }));
  }, [results]);

  const reset = useCallback(() => {
    setResults([]);
  }, []);

  return {
    results,
    handleTap,
    getAccuracyPercent,
    getTimingDots,
    reset,
  };
}
