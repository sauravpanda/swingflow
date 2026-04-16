/**
 * Map a score (0-10) + self-reported level to a short contextual
 * label. Purpose: answer "is this score good for my level?" without
 * needing a peer data flywheel. The level→range mapping is a
 * judgment call anchored to wcs-analyzer's calibration examples
 * (Novice ~3-5, Intermediate ~5-7, Champion ~9).
 *
 * Heuristic, not data — deliberately conservative ranges so most
 * real scores fall cleanly into one tier.
 */

export type LevelRange = {
  level: string;
  aliases: string[]; // normalized tokens that map to this tier
  min: number;
  max: number;
  // Anchor = the "typical" score for this level — used to phrase
  // the contextual label ("above typical X", "mid Y", etc.).
  anchor: number;
};

const LEVEL_RANGES: LevelRange[] = [
  {
    level: "Newcomer",
    aliases: ["newcomer", "beginner", "first-timer"],
    min: 2.0,
    max: 4.0,
    anchor: 3.0,
  },
  {
    level: "Novice",
    aliases: ["novice"],
    min: 3.0,
    max: 5.5,
    anchor: 4.2,
  },
  {
    level: "Intermediate",
    aliases: ["intermediate"],
    min: 4.5,
    max: 7.0,
    anchor: 5.8,
  },
  {
    level: "Advanced",
    aliases: ["advanced", "rising star", "open"],
    min: 6.0,
    max: 8.0,
    anchor: 7.0,
  },
  {
    level: "All-Star",
    aliases: ["all-star", "allstar", "all star"],
    min: 7.0,
    max: 8.8,
    anchor: 7.9,
  },
  {
    level: "Champion",
    aliases: ["champion", "invitational", "pro"],
    min: 8.0,
    max: 10.0,
    anchor: 9.0,
  },
];

function matchLevel(level: string): LevelRange | null {
  const normalized = level.toLowerCase().trim();
  for (const range of LEVEL_RANGES) {
    if (range.aliases.some((a) => normalized.includes(a))) {
      return range;
    }
  }
  return null;
}

export type LevelContext = {
  label: string;
  tone: "above" | "in-range" | "below";
  matchedLevel: string;
};

/**
 * Returns a short contextual label ("upper Novice", "above
 * Intermediate range", "below expected All-Star") for a given
 * score + self-reported level. Returns null when the level
 * string doesn't match any known tier, so callers can hide
 * the label cleanly.
 */
export function getLevelContext(
  score: number,
  level: string | null | undefined
): LevelContext | null {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  if (!level) return null;
  const range = matchLevel(level);
  if (!range) return null;

  if (score < range.min) {
    return {
      label: `Below typical ${range.level} range`,
      tone: "below",
      matchedLevel: range.level,
    };
  }
  if (score > range.max) {
    return {
      label: `Above typical ${range.level} range`,
      tone: "above",
      matchedLevel: range.level,
    };
  }

  // In range: describe where in the band.
  const nearAnchor = Math.abs(score - range.anchor) <= 0.3;
  if (nearAnchor) {
    return {
      label: `Typical ${range.level} score`,
      tone: "in-range",
      matchedLevel: range.level,
    };
  }

  const third = (range.max - range.min) / 3;
  let position = "Mid";
  if (score < range.min + third) position = "Lower";
  else if (score > range.max - third) position = "Upper";

  return {
    label: `${position} ${range.level} range`,
    tone: "in-range",
    matchedLevel: range.level,
  };
}
