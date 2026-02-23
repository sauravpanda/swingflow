"use client";

import { cn } from "@/lib/utils";
import {
  SUBDIVISION_LABELS,
  SUBDIVISION_COLORS,
  type SubdivisionIndex,
} from "@/lib/rhythm-constants";

type BeatGridProps = {
  currentSubdivision: number;
  accentBeats: boolean[];
  targetSubdivision?: SubdivisionIndex | null;
};

export function BeatGrid({
  currentSubdivision,
  accentBeats,
  targetSubdivision,
}: BeatGridProps) {
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
