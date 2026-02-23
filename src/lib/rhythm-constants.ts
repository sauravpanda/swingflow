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

export type PatternStep = {
  beat: number;
  type: StepType;
  label: string;
};

export type WCSPatternPreset = {
  id: string;
  name: string;
  category: "basic" | "intermediate" | "advanced";
  beatCount: 6 | 8;
  totalSubdivisions: number;
  steps: PatternStep[];
  accentBeats: boolean[];
  stepLabels: string[];
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

// --- WCS Pattern Presets ---

const SIX_COUNT_STEPS_SUGAR_PUSH: PatternStep[] = [
  { beat: 1, type: "walk", label: "Walk" },
  { beat: 2, type: "walk", label: "Walk" },
  { beat: 3, type: "triple", label: "Triple" },
  { beat: 4, type: "triple", label: "Triple" },
  { beat: 5, type: "anchor", label: "Anchor" },
  { beat: 6, type: "anchor", label: "Anchor" },
];

const EIGHT_COUNT_STEPS_WHIP: PatternStep[] = [
  { beat: 1, type: "walk", label: "Walk" },
  { beat: 2, type: "walk", label: "Walk" },
  { beat: 3, type: "triple", label: "Triple" },
  { beat: 4, type: "triple", label: "Triple" },
  { beat: 5, type: "walk", label: "Walk" },
  { beat: 6, type: "walk", label: "Walk" },
  { beat: 7, type: "anchor", label: "Anchor" },
  { beat: 8, type: "anchor", label: "Anchor" },
];

export const WCS_PATTERN_PRESETS: WCSPatternPreset[] = [
  {
    id: "sugar-push",
    name: "Sugar Push",
    category: "basic",
    beatCount: 6,
    totalSubdivisions: 24,
    steps: SIX_COUNT_STEPS_SUGAR_PUSH,
    accentBeats: buildAccentArray(24, [0, 4, 8, 10, 16, 18]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Anchor", "Anchor"],
  },
  {
    id: "left-side-pass",
    name: "Left Side Pass",
    category: "basic",
    beatCount: 6,
    totalSubdivisions: 24,
    steps: SIX_COUNT_STEPS_SUGAR_PUSH,
    accentBeats: buildAccentArray(24, [0, 4, 8, 10, 16, 18]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Anchor", "Anchor"],
  },
  {
    id: "right-side-pass",
    name: "Right Side Pass",
    category: "basic",
    beatCount: 6,
    totalSubdivisions: 24,
    steps: SIX_COUNT_STEPS_SUGAR_PUSH,
    accentBeats: buildAccentArray(24, [0, 4, 8, 10, 16, 18]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Anchor", "Anchor"],
  },
  {
    id: "push-break",
    name: "Push Break",
    category: "basic",
    beatCount: 6,
    totalSubdivisions: 24,
    steps: SIX_COUNT_STEPS_SUGAR_PUSH,
    accentBeats: buildAccentArray(24, [0, 4, 8, 10, 16, 18]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Anchor", "Anchor"],
  },
  {
    id: "starter-step",
    name: "Starter Step",
    category: "basic",
    beatCount: 6,
    totalSubdivisions: 24,
    steps: SIX_COUNT_STEPS_SUGAR_PUSH,
    accentBeats: buildAccentArray(24, [0, 4, 8, 10, 16, 18]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Anchor", "Anchor"],
  },
  {
    id: "change-of-places",
    name: "Change of Places",
    category: "intermediate",
    beatCount: 6,
    totalSubdivisions: 24,
    steps: SIX_COUNT_STEPS_SUGAR_PUSH,
    accentBeats: buildAccentArray(24, [0, 4, 8, 10, 16, 18]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Anchor", "Anchor"],
  },
  {
    id: "tuck-turn",
    name: "Tuck Turn",
    category: "intermediate",
    beatCount: 6,
    totalSubdivisions: 24,
    steps: SIX_COUNT_STEPS_SUGAR_PUSH,
    accentBeats: buildAccentArray(24, [0, 4, 8, 10, 16, 18]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Anchor", "Anchor"],
  },
  {
    id: "underarm-pass",
    name: "Underarm Pass",
    category: "intermediate",
    beatCount: 8,
    totalSubdivisions: 32,
    steps: EIGHT_COUNT_STEPS_WHIP,
    accentBeats: buildAccentArray(32, [0, 4, 8, 10, 16, 20, 24, 26]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Walk", "Walk", "Anchor", "Anchor"],
  },
  {
    id: "basic-whip",
    name: "Basic Whip",
    category: "intermediate",
    beatCount: 8,
    totalSubdivisions: 32,
    steps: EIGHT_COUNT_STEPS_WHIP,
    accentBeats: buildAccentArray(32, [0, 4, 8, 10, 16, 20, 24, 26]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Walk", "Walk", "Anchor", "Anchor"],
  },
  {
    id: "reverse-whip",
    name: "Reverse Whip",
    category: "advanced",
    beatCount: 8,
    totalSubdivisions: 32,
    steps: EIGHT_COUNT_STEPS_WHIP,
    accentBeats: buildAccentArray(32, [0, 4, 8, 10, 16, 20, 24, 26]),
    stepLabels: ["Walk", "Walk", "Triple", "Triple", "Walk", "Walk", "Anchor", "Anchor"],
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
