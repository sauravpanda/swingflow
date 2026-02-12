"use client";

import { useState, useEffect, useCallback } from "react";

// --- Types ---

export type ReviewState = {
  patternId: string;
  easeFactor: number;
  interval: number; // days
  repetitions: number;
  nextReviewAt: string; // ISO date
  lastReviewAt: string | null;
  createdAt: string;
};

export type ReviewLogEntry = {
  patternId: string;
  quality: number;
  interval: number;
  easeFactor: number;
  createdAt: string;
};

export type ChecklistState = Record<string, boolean>; // templateId -> completed

export type PracticeSessionEntry = {
  id: string;
  duration: number; // seconds
  routineType: string;
  createdAt: string;
};

export type StreakState = {
  currentStreak: number;
  longestStreak: number;
  totalPracticeDays: number;
  lastPracticeDate: string | null; // ISO date
};

export type StoreData = {
  reviews: Record<string, ReviewState>; // patternId -> ReviewState
  reviewLogs: ReviewLogEntry[];
  checklist: ChecklistState;
  practiceSessions: PracticeSessionEntry[];
  streak: StreakState;
};

const DEFAULT_STORE: StoreData = {
  reviews: {},
  reviewLogs: [],
  checklist: {},
  practiceSessions: [],
  streak: {
    currentStreak: 0,
    longestStreak: 0,
    totalPracticeDays: 0,
    lastPracticeDate: null,
  },
};

const STORAGE_KEY = "swingflow-data";

// --- Storage helpers ---

function loadStore(): StoreData {
  if (typeof window === "undefined") return DEFAULT_STORE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STORE;
    return { ...DEFAULT_STORE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STORE;
  }
}

function saveStore(data: StoreData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// --- Hook ---

export function useStore() {
  const [data, setData] = useState<StoreData>(DEFAULT_STORE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setData(loadStore());
    setLoaded(true);
  }, []);

  const update = useCallback((updater: (prev: StoreData) => StoreData) => {
    setData((prev) => {
      const next = updater(prev);
      saveStore(next);
      return next;
    });
  }, []);

  // --- Review actions ---

  const addToReviewDeck = useCallback(
    (patternId: string) => {
      update((prev) => {
        if (prev.reviews[patternId]) return prev;
        return {
          ...prev,
          reviews: {
            ...prev.reviews,
            [patternId]: {
              patternId,
              easeFactor: 2.5,
              interval: 0,
              repetitions: 0,
              nextReviewAt: new Date().toISOString(),
              lastReviewAt: null,
              createdAt: new Date().toISOString(),
            },
          },
        };
      });
    },
    [update]
  );

  const isInDeck = useCallback(
    (patternId: string) => {
      return !!data.reviews[patternId];
    },
    [data.reviews]
  );

  const submitReview = useCallback(
    (patternId: string, quality: number, sm2Result: { easeFactor: number; interval: number; repetitions: number; nextReviewAt: Date }) => {
      update((prev) => {
        const review = prev.reviews[patternId];
        if (!review) return prev;
        return {
          ...prev,
          reviews: {
            ...prev.reviews,
            [patternId]: {
              ...review,
              easeFactor: sm2Result.easeFactor,
              interval: sm2Result.interval,
              repetitions: sm2Result.repetitions,
              nextReviewAt: sm2Result.nextReviewAt.toISOString(),
              lastReviewAt: new Date().toISOString(),
            },
          },
          reviewLogs: [
            ...prev.reviewLogs,
            {
              patternId,
              quality,
              interval: sm2Result.interval,
              easeFactor: sm2Result.easeFactor,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      });
    },
    [update]
  );

  const getDueReviews = useCallback(() => {
    const now = new Date();
    return Object.values(data.reviews).filter(
      (r) => new Date(r.nextReviewAt) <= now
    );
  }, [data.reviews]);

  // --- Checklist actions ---

  const toggleChecklist = useCallback(
    (templateId: string, completed: boolean) => {
      update((prev) => ({
        ...prev,
        checklist: { ...prev.checklist, [templateId]: completed },
      }));
    },
    [update]
  );

  const isChecklistCompleted = useCallback(
    (templateId: string) => {
      return !!data.checklist[templateId];
    },
    [data.checklist]
  );

  // --- Practice actions ---

  const logPractice = useCallback(
    (duration: number, routineType: string) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      update((prev) => {
        const session: PracticeSessionEntry = {
          id: crypto.randomUUID(),
          duration,
          routineType,
          createdAt: new Date().toISOString(),
        };

        const lastPractice = prev.streak.lastPracticeDate
          ? new Date(prev.streak.lastPracticeDate)
          : null;
        if (lastPractice) lastPractice.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const isToday = lastPractice?.getTime() === today.getTime();
        const isYesterday = lastPractice?.getTime() === yesterday.getTime();

        let streak = prev.streak;
        if (!isToday) {
          const newCurrent = isYesterday ? streak.currentStreak + 1 : 1;
          streak = {
            currentStreak: newCurrent,
            longestStreak: Math.max(streak.longestStreak, newCurrent),
            totalPracticeDays: streak.totalPracticeDays + 1,
            lastPracticeDate: new Date().toISOString(),
          };
        }

        return {
          ...prev,
          practiceSessions: [session, ...prev.practiceSessions],
          streak,
        };
      });
    },
    [update]
  );

  // --- Stats ---

  const getStats = useCallback(() => {
    const reviews = Object.values(data.reviews);
    const dueNow = reviews.filter((r) => new Date(r.nextReviewAt) <= new Date());
    const totalPracticeMinutes = Math.round(
      data.practiceSessions.reduce((sum, s) => sum + s.duration, 0) / 60
    );
    const completedChecklist = Object.values(data.checklist).filter(Boolean).length;

    return {
      totalReviews: reviews.length,
      reviewsDue: dueNow.length,
      totalReviewLogs: data.reviewLogs.length,
      streak: data.streak,
      recentSessions: data.practiceSessions.slice(0, 5),
      totalPracticeMinutes,
      completedChecklist,
    };
  }, [data]);

  return {
    loaded,
    data,
    addToReviewDeck,
    isInDeck,
    submitReview,
    getDueReviews,
    toggleChecklist,
    isChecklistCompleted,
    logPractice,
    getStats,
  };
}
