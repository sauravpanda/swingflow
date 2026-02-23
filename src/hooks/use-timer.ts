"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type TimerState = "idle" | "running" | "paused" | "finished";

export function useTimer(totalSeconds: number) {
  const [elapsed, setElapsed] = useState(0);
  const [state, setState] = useState<TimerState>("idle");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const remaining = Math.max(0, totalSeconds - elapsed);
  const progress = totalSeconds > 0 ? (elapsed / totalSeconds) * 100 : 0;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    setState("running");
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= totalSeconds) {
          clearTimer();
          setState("finished");
          return totalSeconds;
        }
        return next;
      });
    }, 1000);
  }, [totalSeconds, clearTimer]);

  const pause = useCallback(() => {
    clearTimer();
    setState("paused");
  }, [clearTimer]);

  const resume = useCallback(() => {
    setState("running");
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= totalSeconds) {
          clearTimer();
          setState("finished");
          return totalSeconds;
        }
        return next;
      });
    }, 1000);
  }, [totalSeconds, clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setElapsed(0);
    setState("idle");
  }, [clearTimer]);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  return {
    elapsed,
    remaining,
    progress,
    state,
    start,
    pause,
    resume,
    reset,
  };
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
