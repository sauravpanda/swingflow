// --- Types ---

export type Feel = "straight" | "swung";
export type PracticeMode = "listen" | "tap" | "challenge";
export type TapRating = "perfect" | "good" | "ok" | "miss";

export type TapResult = {
  rating: TapRating;
  deltaMs: number;
  subdivisionIndex: number;
  timestamp: number;
};

export type SubdivisionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AccentPattern = {
  label: string;
  beats: boolean[];
};

// --- Constants ---

export const SUBDIVISION_LABELS = ["1", "e", "&", "a", "2", "e", "&", "a"] as const;

export const SUBDIVISION_COLORS: Record<number, string> = {
  0: "bg-red-500",    // 1 (downbeat)
  1: "bg-blue-500",   // e
  2: "bg-green-500",  // &
  3: "bg-yellow-500", // a
  4: "bg-red-500",    // 2 (downbeat)
  5: "bg-blue-500",   // e
  6: "bg-green-500",  // &
  7: "bg-yellow-500", // a
};

export const SUBDIVISION_TEXT_COLORS: Record<number, string> = {
  0: "text-red-500",
  1: "text-blue-500",
  2: "text-green-500",
  3: "text-yellow-500",
  4: "text-red-500",
  5: "text-blue-500",
  6: "text-green-500",
  7: "text-yellow-500",
};

export const ACCENT_PATTERNS: AccentPattern[] = [
  { label: "Downbeats", beats: [true, false, false, false, true, false, false, false] },
  { label: "All", beats: [true, true, true, true, true, true, true, true] },
  { label: "Ands", beats: [false, false, true, false, false, false, true, false] },
  { label: "Es", beats: [false, true, false, false, false, true, false, false] },
  { label: "As", beats: [false, false, false, true, false, false, false, true] },
];

export const BPM_MIN = 60;
export const BPM_MAX = 140;
export const BPM_DEFAULT = 90;

export const SCHEDULER_INTERVAL_MS = 25;
export const SCHEDULER_LOOKAHEAD_MS = 100;

export const TAP_THRESHOLD_PERFECT_MS = 20;
export const TAP_THRESHOLD_GOOD_MS = 50;
export const TAP_THRESHOLD_OK_MS = 100;

export const RATING_COLORS: Record<TapRating, string> = {
  perfect: "text-emerald-400",
  good: "text-blue-400",
  ok: "text-yellow-400",
  miss: "text-red-400",
};
