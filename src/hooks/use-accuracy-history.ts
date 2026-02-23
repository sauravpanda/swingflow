"use client";

import { useState, useCallback, useEffect } from "react";
import type { RhythmSession, SubdivisionAccuracy } from "@/lib/rhythm-constants";

const STORAGE_KEY = "swingflow-rhythm-history";
const MAX_SESSIONS = 100;

function loadSessions(): RhythmSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSessions(sessions: RhythmSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // storage full — silently ignore
  }
}

export function useAccuracyHistory() {
  const [sessions, setSessions] = useState<RhythmSession[]>([]);

  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  const saveSession = useCallback((session: RhythmSession) => {
    setSessions((prev) => {
      const next = [session, ...prev].slice(0, MAX_SESSIONS);
      persistSessions(next);
      return next;
    });
  }, []);

  const getRecentSessions = useCallback(
    (limit = 10) => sessions.slice(0, limit),
    [sessions]
  );

  const getAggregateAccuracy = useCallback(
    (patternId?: string | null): SubdivisionAccuracy[] => {
      const filtered = patternId
        ? sessions.filter((s) => s.patternId === patternId)
        : sessions;

      const map = new Map<number, { hits: number; total: number }>();

      for (const session of filtered) {
        for (const result of session.results) {
          const entry = map.get(result.subdivisionIndex) ?? { hits: 0, total: 0 };
          entry.total++;
          if (result.rating !== "miss") entry.hits++;
          map.set(result.subdivisionIndex, entry);
        }
      }

      return Array.from(map.entries()).map(([idx, { hits, total }]) => ({
        subdivisionIndex: idx,
        totalTaps: total,
        hits,
        accuracy: total > 0 ? Math.round((hits / total) * 100) : 0,
      }));
    },
    [sessions]
  );

  const getWeakSubdivisions = useCallback(
    (patternId?: string | null): number[] => {
      return getAggregateAccuracy(patternId)
        .filter((s) => s.accuracy < 50)
        .map((s) => s.subdivisionIndex);
    },
    [getAggregateAccuracy]
  );

  return {
    sessions,
    saveSession,
    getRecentSessions,
    getAggregateAccuracy,
    getWeakSubdivisions,
  };
}
