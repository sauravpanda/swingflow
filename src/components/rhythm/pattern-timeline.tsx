"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STEP_TYPE_COLORS, type WCSPatternPreset } from "@/lib/rhythm-constants";

type PatternTimelineProps = {
  pattern: WCSPatternPreset;
  currentSubdivision: number;
  isPlaying: boolean;
};

const BODY_ACTIONS: Record<string, string> = {
  walk: "step",
  triple: "triple step",
  anchor: "anchor & stretch",
};

export function PatternTimeline({
  pattern,
  currentSubdivision,
  isPlaying,
}: PatternTimelineProps) {
  const totalSubs = pattern.totalSubdivisions;
  const cursorPercent = currentSubdivision >= 0
    ? (currentSubdivision / totalSubs) * 100
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{pattern.name} Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Timeline bar */}
        <div className="relative h-10 bg-muted rounded-lg overflow-hidden">
          {/* Step blocks */}
          {pattern.steps.map((step, i) => {
            const startPct = (i / pattern.beatCount) * 100;
            const widthPct = (1 / pattern.beatCount) * 100;

            return (
              <div
                key={i}
                className={cn(
                  "absolute top-0 bottom-0 flex items-center justify-center border-r border-background/50",
                  STEP_TYPE_COLORS[step.type],
                  "opacity-70"
                )}
                style={{
                  left: `${startPct}%`,
                  width: `${widthPct}%`,
                }}
              >
                <span className="text-[10px] font-medium text-white truncate px-0.5">
                  {step.label}
                </span>
                {/* Triple step dots */}
                {step.type === "triple" && (
                  <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                    <span className="h-1 w-1 rounded-full bg-white/60" />
                    <span className="h-1 w-1 rounded-full bg-white/60" />
                    <span className="h-1 w-1 rounded-full bg-white/60" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Moving cursor */}
          {isPlaying && currentSubdivision >= 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)] z-10 transition-[left] duration-75"
              style={{ left: `${cursorPercent}%` }}
            />
          )}
        </div>

        {/* Body action labels */}
        <div
          className="grid text-center"
          style={{ gridTemplateColumns: `repeat(${pattern.beatCount}, minmax(0, 1fr))` }}
        >
          {pattern.steps.map((step, i) => (
            <span key={i} className="text-[10px] text-muted-foreground truncate">
              {BODY_ACTIONS[step.type]}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
