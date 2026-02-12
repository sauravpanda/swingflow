/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Quality ratings:
 *   0 - Forgot (complete blackout)
 *   2 - Hard (significant difficulty remembering)
 *   4 - Good (correct with some hesitation)
 *   5 - Easy (perfect recall)
 *
 * Returns new review state after processing a quality rating.
 */

export type SM2Input = {
  quality: number; // 0, 2, 4, or 5
  repetitions: number;
  easeFactor: number;
  interval: number; // in days
};

export type SM2Output = {
  repetitions: number;
  easeFactor: number;
  interval: number; // in days
  nextReviewAt: Date;
};

export function sm2(input: SM2Input): SM2Output {
  const { quality, repetitions, easeFactor, interval } = input;

  let newRepetitions: number;
  let newEaseFactor: number;
  let newInterval: number;

  // Calculate new ease factor
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  newEaseFactor =
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEaseFactor < 1.3) newEaseFactor = 1.3;

  if (quality >= 3) {
    // Correct response
    if (repetitions === 0) {
      newInterval = 1;
    } else if (repetitions === 1) {
      newInterval = 6;
    } else {
      newInterval = Math.round(interval * newEaseFactor);
    }
    newRepetitions = repetitions + 1;
  } else {
    // Incorrect response — reset
    newRepetitions = 0;
    newInterval = 1;
  }

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);

  return {
    repetitions: newRepetitions,
    easeFactor: Math.round(newEaseFactor * 100) / 100,
    interval: newInterval,
    nextReviewAt,
  };
}
