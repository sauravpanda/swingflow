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
  scheduledBeatsRef: RefObject<ScheduledBeat[]>
) {
  const [results, setResults] = useState<TapResult[]>([]);

  const playFeedback = useCallback(
    (rating: TapRating) => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      const freqMap: Record<TapRating, number> = {
        perfect: 1200,
        good: 900,
        ok: 600,
        miss: 300,
      };

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.value = freqMap[rating];
      osc.type = "sine";

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.start(now);
      osc.stop(now + 0.08);
    },
    [audioContextRef]
  );

  const handleTap = useCallback(() => {
    const ctx = audioContextRef.current;
    const beats = scheduledBeatsRef.current;
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

    playFeedback(rating);

    // Haptic feedback
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
  }, [audioContextRef, scheduledBeatsRef, playFeedback]);

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
