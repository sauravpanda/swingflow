"use client";

import { cn } from "@/lib/utils";
import {
  SUBDIVISION_LABELS,
  SUBDIVISION_COLORS,
  STEP_TYPE_COLORS,
  STEP_TYPE_TEXT_COLORS,
  type SubdivisionIndex,
  type WCSPatternPreset,
} from "@/lib/rhythm-constants";

type BeatGridProps = {
  currentSubdivision: number;
  accentBeats: boolean[];
  targetSubdivision?: SubdivisionIndex | null;
  pattern?: WCSPatternPreset | null;
  phrasePosition?: number;
  totalSubdivisions?: number;
};

export function BeatGrid({
  currentSubdivision,
  accentBeats,
  targetSubdivision,
  pattern,
}: BeatGridProps) {
  // Pattern mode: render beatCount columns
  if (pattern) {
    const activeBeat = currentSubdivision >= 0
      ? Math.floor(currentSubdivision / 4)
      : -1;

    return (
      <div className="space-y-2">
        <div
          className="grid gap-1.5 sm:gap-2"
          style={{ gridTemplateColumns: `repeat(${pattern.beatCount}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: pattern.beatCount }, (_, i) => {
            const step = pattern.steps[i];
            const isActive = activeBeat === i;
            const colorClass = step ? STEP_TYPE_COLORS[step.type] : "bg-muted";
            const beatSubStart = i * 4;
            const isTarget = targetSubdivision != null &&
              targetSubdivision >= beatSubStart &&
              targetSubdivision < beatSubStart + 4;

            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg py-3 sm:py-4 transition-all duration-75",
                  isActive
                    ? cn(colorClass, "text-white scale-110")
                    : "bg-muted border border-border",
                  isTarget && !isActive && "ring-2 ring-primary animate-pulse"
                )}
              >
                <span
                  className={cn(
                    "text-sm sm:text-lg font-bold font-mono",
                    isActive && "text-white"
                  )}
                >
                  {i + 1}
                </span>
              </div>
            );
          })}
        </div>
        {/* Step labels row */}
        <div
          className="grid gap-1.5 sm:gap-2"
          style={{ gridTemplateColumns: `repeat(${pattern.beatCount}, minmax(0, 1fr))` }}
        >
          {pattern.stepLabels.map((label, i) => {
            const step = pattern.steps[i];
            const textColor = step ? STEP_TYPE_TEXT_COLORS[step.type] : "text-muted-foreground";
            return (
              <span
                key={i}
                className={cn("text-xs text-center font-medium", textColor)}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // Default mode: 8-column grid (backward compatible)
  return (
    <div className="grid grid-cols-8 gap-1.5 sm:gap-2">
      {SUBDIVISION_LABELS.map((label, i) => {
        const isActive = currentSubdivision === i;
        const isAccented = accentBeats[i];
        const isTarget = targetSubdivision === i;

        return (
          <div
            key={i}
            className={cn(
              "flex flex-col items-center justify-center rounded-lg py-3 sm:py-4 transition-all duration-75",
              isActive
                ? cn(SUBDIVISION_COLORS[i], "text-white scale-110")
                : isAccented
                ? "bg-muted border border-border"
                : "bg-muted/40 opacity-40",
              isTarget && !isActive && "ring-2 ring-primary animate-pulse"
            )}
          >
            <span
              className={cn(
                "text-sm sm:text-lg font-bold font-mono",
                isActive && "text-white"
              )}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
