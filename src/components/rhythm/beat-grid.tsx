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
  // Pattern mode: render one column per step event
  if (pattern) {
    const events = pattern.stepEvents;

    // Find active step: the event whose subdivisionIndex range contains currentSubdivision
    let activeIdx = -1;
    if (currentSubdivision >= 0) {
      for (let i = 0; i < events.length; i++) {
        const start = events[i].subdivisionIndex;
        const end = i + 1 < events.length ? events[i + 1].subdivisionIndex : pattern.totalSubdivisions;
        if (currentSubdivision >= start && currentSubdivision < end) {
          activeIdx = i;
          break;
        }
      }
    }

    return (
      <div className="space-y-2">
        <div
          className="grid gap-1 sm:gap-1.5"
          style={{ gridTemplateColumns: `repeat(${events.length}, minmax(0, 1fr))` }}
        >
          {events.map((ev, i) => {
            const isActive = activeIdx === i;
            const colorClass = STEP_TYPE_COLORS[ev.type];
            const isTarget = targetSubdivision != null &&
              targetSubdivision === ev.subdivisionIndex;

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
                  {ev.countLabel}
                </span>
              </div>
            );
          })}
        </div>
        {/* Step type labels row */}
        <div
          className="grid gap-1 sm:gap-1.5"
          style={{ gridTemplateColumns: `repeat(${events.length}, minmax(0, 1fr))` }}
        >
          {events.map((ev, i) => {
            const textColor = STEP_TYPE_TEXT_COLORS[ev.type];
            // Capitalize first letter of type
            const label = ev.type.charAt(0).toUpperCase() + ev.type.slice(1);
            return (
              <span
                key={i}
                className={cn("text-[10px] sm:text-xs text-center font-medium", textColor)}
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
