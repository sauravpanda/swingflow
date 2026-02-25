// --- Types ---

export type Feel = "straight" | "swung";
export type PracticeMode = "listen" | "tap" | "challenge";
export type TapRating = "perfect" | "good" | "ok" | "miss";

export type TapResult = {
  rating: TapRating;
  deltaMs: number;
  signedDeltaMs: number;
  subdivisionIndex: number;
  timestamp: number;
};

export type SubdivisionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AccentPattern = {
  label: string;
  beats: boolean[];
};

// --- WCS Pattern Types ---

export type StepType = "walk" | "triple" | "anchor";

export type StepEvent = {
  subdivisionIndex: number;
  countLabel: string;
  type: StepType;
};

export type WCSPatternPreset = {
  id: string;
  name: string;
  category: "basic" | "intermediate" | "advanced";
  difficulty: "counts" | "eighths";
  beatCount: 6 | 8;
  totalSubdivisions: number;
  stepEvents: StepEvent[];
  accentBeats: boolean[];
};

export type ChallengeType = "tap-walks" | "tap-triples" | "tap-anchors" | "cycle-pattern" | "random-subdivision";

export type RhythmSession = {
  id: string;
  patternId: string | null;
  bpm: number;
  feel: Feel;
  totalTaps: number;
  results: TapResult[];
  accuracy: number;
  timestamp: number;
};

export type SubdivisionAccuracy = {
  subdivisionIndex: number;
  totalTaps: number;
  hits: number;
  accuracy: number;
};

export type TempoRampConfig = {
  startBpm: number;
  incrementBpm: number;
  intervalSeconds: number;
  maxMisses: number;
};

export type TimingDot = {
  beatIndex: number;
  signedDeltaMs: number;
  rating: TapRating;
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

// --- Helpers ---

export function getSubdivisionLabelsForBeatCount(n: number): string[] {
  const labels: string[] = [];
  for (let beat = 1; beat <= n; beat++) {
    labels.push(String(beat), "e", "&", "a");
  }
  return labels;
}

export function buildAccentArray(length: number, activeIndices: number[]): boolean[] {
  const arr = new Array(length).fill(false);
  for (const idx of activeIndices) {
    if (idx >= 0 && idx < length) arr[idx] = true;
  }
  return arr;
}

// --- WCS Step Event Helpers ---

export function buildAccentFromEvents(totalSubs: number, events: StepEvent[]): boolean[] {
  const arr = new Array(totalSubs).fill(false);
  for (const ev of events) {
    if (ev.subdivisionIndex >= 0 && ev.subdivisionIndex < totalSubs) {
      arr[ev.subdivisionIndex] = true;
    }
  }
  return arr;
}

// --- Shared Step-Event Arrays ---

// 6-count basic: 1, 2, 3&4, 5&6 → 8 weight changes
const SIX_COUNT_BASIC_EVENTS: StepEvent[] = [
  { subdivisionIndex: 0,  countLabel: "1", type: "walk" },
  { subdivisionIndex: 4,  countLabel: "2", type: "walk" },
  { subdivisionIndex: 8,  countLabel: "3", type: "triple" },
  { subdivisionIndex: 10, countLabel: "&", type: "triple" },
  { subdivisionIndex: 12, countLabel: "4", type: "triple" },
  { subdivisionIndex: 16, countLabel: "5", type: "anchor" },
  { subdivisionIndex: 18, countLabel: "&", type: "anchor" },
  { subdivisionIndex: 20, countLabel: "6", type: "anchor" },
];

// 6-count eighths: 1&, 2&, 3&4&, 5&6& → 12 weight changes
const SIX_COUNT_EIGHTHS_EVENTS: StepEvent[] = [
  { subdivisionIndex: 0,  countLabel: "1", type: "walk" },
  { subdivisionIndex: 2,  countLabel: "&", type: "walk" },
  { subdivisionIndex: 4,  countLabel: "2", type: "walk" },
  { subdivisionIndex: 6,  countLabel: "&", type: "walk" },
  { subdivisionIndex: 8,  countLabel: "3", type: "triple" },
  { subdivisionIndex: 10, countLabel: "&", type: "triple" },
  { subdivisionIndex: 12, countLabel: "4", type: "triple" },
  { subdivisionIndex: 14, countLabel: "&", type: "triple" },
  { subdivisionIndex: 16, countLabel: "5", type: "anchor" },
  { subdivisionIndex: 18, countLabel: "&", type: "anchor" },
  { subdivisionIndex: 20, countLabel: "6", type: "anchor" },
  { subdivisionIndex: 22, countLabel: "&", type: "anchor" },
];

// 8-count basic: 1, 2, 3&4, 5, 6, 7&8 → 10 weight changes
const EIGHT_COUNT_BASIC_EVENTS: StepEvent[] = [
  { subdivisionIndex: 0,  countLabel: "1", type: "walk" },
  { subdivisionIndex: 4,  countLabel: "2", type: "walk" },
  { subdivisionIndex: 8,  countLabel: "3", type: "triple" },
  { subdivisionIndex: 10, countLabel: "&", type: "triple" },
  { subdivisionIndex: 12, countLabel: "4", type: "triple" },
  { subdivisionIndex: 16, countLabel: "5", type: "walk" },
  { subdivisionIndex: 20, countLabel: "6", type: "walk" },
  { subdivisionIndex: 24, countLabel: "7", type: "anchor" },
  { subdivisionIndex: 26, countLabel: "&", type: "anchor" },
  { subdivisionIndex: 28, countLabel: "8", type: "anchor" },
];

// 8-count eighths: 1&, 2&, 3&4&, 5&, 6&, 7&8& → 16 weight changes
const EIGHT_COUNT_EIGHTHS_EVENTS: StepEvent[] = [
  { subdivisionIndex: 0,  countLabel: "1", type: "walk" },
  { subdivisionIndex: 2,  countLabel: "&", type: "walk" },
  { subdivisionIndex: 4,  countLabel: "2", type: "walk" },
  { subdivisionIndex: 6,  countLabel: "&", type: "walk" },
  { subdivisionIndex: 8,  countLabel: "3", type: "triple" },
  { subdivisionIndex: 10, countLabel: "&", type: "triple" },
  { subdivisionIndex: 12, countLabel: "4", type: "triple" },
  { subdivisionIndex: 14, countLabel: "&", type: "triple" },
  { subdivisionIndex: 16, countLabel: "5", type: "walk" },
  { subdivisionIndex: 18, countLabel: "&", type: "walk" },
  { subdivisionIndex: 20, countLabel: "6", type: "walk" },
  { subdivisionIndex: 22, countLabel: "&", type: "walk" },
  { subdivisionIndex: 24, countLabel: "7", type: "anchor" },
  { subdivisionIndex: 26, countLabel: "&", type: "anchor" },
  { subdivisionIndex: 28, countLabel: "8", type: "anchor" },
  { subdivisionIndex: 30, countLabel: "&", type: "anchor" },
];

// --- WCS Pattern Presets ---

export const WCS_PATTERN_PRESETS: WCSPatternPreset[] = [
  // --- 6-count Counts ---
  {
    id: "sugar-push",
    name: "Sugar Push",
    category: "basic",
    difficulty: "counts",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_BASIC_EVENTS),
  },
  {
    id: "left-side-pass",
    name: "Left Side Pass",
    category: "basic",
    difficulty: "counts",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_BASIC_EVENTS),
  },
  {
    id: "right-side-pass",
    name: "Right Side Pass",
    category: "basic",
    difficulty: "counts",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_BASIC_EVENTS),
  },
  {
    id: "push-break",
    name: "Push Break",
    category: "basic",
    difficulty: "counts",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_BASIC_EVENTS),
  },
  {
    id: "starter-step",
    name: "Starter Step",
    category: "basic",
    difficulty: "counts",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_BASIC_EVENTS),
  },
  {
    id: "change-of-places",
    name: "Change of Places",
    category: "intermediate",
    difficulty: "counts",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_BASIC_EVENTS),
  },
  {
    id: "tuck-turn",
    name: "Tuck Turn",
    category: "intermediate",
    difficulty: "counts",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_BASIC_EVENTS),
  },
  // --- 8-count Counts ---
  {
    id: "underarm-pass",
    name: "Underarm Pass",
    category: "intermediate",
    difficulty: "counts",
    beatCount: 8,
    totalSubdivisions: 32,
    stepEvents: EIGHT_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(32, EIGHT_COUNT_BASIC_EVENTS),
  },
  {
    id: "basic-whip",
    name: "Basic Whip",
    category: "intermediate",
    difficulty: "counts",
    beatCount: 8,
    totalSubdivisions: 32,
    stepEvents: EIGHT_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(32, EIGHT_COUNT_BASIC_EVENTS),
  },
  {
    id: "reverse-whip",
    name: "Reverse Whip",
    category: "advanced",
    difficulty: "counts",
    beatCount: 8,
    totalSubdivisions: 32,
    stepEvents: EIGHT_COUNT_BASIC_EVENTS,
    accentBeats: buildAccentFromEvents(32, EIGHT_COUNT_BASIC_EVENTS),
  },
  // --- 8th Note Variants ---
  {
    id: "sugar-push-eighths",
    name: "Sugar Push (8ths)",
    category: "advanced",
    difficulty: "eighths",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_EIGHTHS_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_EIGHTHS_EVENTS),
  },
  {
    id: "left-side-pass-eighths",
    name: "Left Side Pass (8ths)",
    category: "advanced",
    difficulty: "eighths",
    beatCount: 6,
    totalSubdivisions: 24,
    stepEvents: SIX_COUNT_EIGHTHS_EVENTS,
    accentBeats: buildAccentFromEvents(24, SIX_COUNT_EIGHTHS_EVENTS),
  },
  {
    id: "basic-whip-eighths",
    name: "Basic Whip (8ths)",
    category: "advanced",
    difficulty: "eighths",
    beatCount: 8,
    totalSubdivisions: 32,
    stepEvents: EIGHT_COUNT_EIGHTHS_EVENTS,
    accentBeats: buildAccentFromEvents(32, EIGHT_COUNT_EIGHTHS_EVENTS),
  },
];

// --- Challenge Types ---

export const CHALLENGE_TYPES: { id: ChallengeType; label: string; description: string }[] = [
  { id: "tap-walks", label: "Tap Walks", description: "Tap on the walk steps" },
  { id: "tap-triples", label: "Tap Triples", description: "Tap on the triple steps" },
  { id: "tap-anchors", label: "Tap Anchors", description: "Tap on the anchor steps" },
  { id: "cycle-pattern", label: "Cycle Pattern", description: "Tap through the full pattern" },
  { id: "random-subdivision", label: "Random Subdivision", description: "Tap the highlighted subdivision" },
];

// --- Haptic Feedback Patterns ---

export const HAPTIC_PATTERNS: Record<TapRating, number[]> = {
  perfect: [10],
  good: [15, 10],
  ok: [20, 10, 20],
  miss: [50, 30, 50],
};

// --- Tempo Ramp Defaults ---

export const TEMPO_RAMP_DEFAULTS: TempoRampConfig = {
  startBpm: 80,
  incrementBpm: 5,
  intervalSeconds: 30,
  maxMisses: 3,
};

// --- Step Type Colors ---

export const STEP_TYPE_COLORS: Record<StepType, string> = {
  walk: "bg-blue-500",
  triple: "bg-green-500",
  anchor: "bg-orange-500",
};

export const STEP_TYPE_TEXT_COLORS: Record<StepType, string> = {
  walk: "text-blue-500",
  triple: "text-green-500",
  anchor: "text-orange-500",
};
