"use client";

import { useState, useRef, useCallback } from "react";
import type { TapResult, TempoRampConfig } from "@/lib/rhythm-constants";
import { TEMPO_RAMP_DEFAULTS } from "@/lib/rhythm-constants";

export type TempoRampState = {
  isActive: boolean;
  currentBpm: number;
  highestBpm: number;
  consecutiveMisses: number;
};

export function useTempoRamp(
  setBpm: (bpm: number) => void
) {
  const [config, setConfig] = useState<TempoRampConfig>(TEMPO_RAMP_DEFAULTS);
  const [state, setState] = useState<TempoRampState>({
    isActive: false,
    currentBpm: TEMPO_RAMP_DEFAULTS.startBpm,
    highestBpm: TEMPO_RAMP_DEFAULTS.startBpm,
    consecutiveMisses: 0,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const configRef = useRef(config);
  configRef.current = config;

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((prev) => ({ ...prev, isActive: false }));
  }, []);

  const start = useCallback(() => {
    const startBpm = configRef.current.startBpm;
    setBpm(startBpm);
    setState({
      isActive: true,
      currentBpm: startBpm,
      highestBpm: startBpm,
      consecutiveMisses: 0,
    });

    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      const s = stateRef.current;
      const c = configRef.current;
      if (!s.isActive) return;

      const nextBpm = s.currentBpm + c.incrementBpm;
      setBpm(nextBpm);
      setState((prev) => ({
        ...prev,
        currentBpm: nextBpm,
        highestBpm: Math.max(prev.highestBpm, nextBpm),
      }));
    }, configRef.current.intervalSeconds * 1000);
  }, [setBpm]);

  const onTapResult = useCallback(
    (result: TapResult) => {
      if (!stateRef.current.isActive) return;

      if (result.rating === "miss") {
        const next = stateRef.current.consecutiveMisses + 1;
        setState((prev) => ({ ...prev, consecutiveMisses: next }));
        if (next >= configRef.current.maxMisses) {
          stop();
        }
      } else {
        setState((prev) => ({ ...prev, consecutiveMisses: 0 }));
      }
    },
    [stop]
  );

  return {
    config,
    setConfig,
    state,
    start,
    stop,
    onTapResult,
  };
}
