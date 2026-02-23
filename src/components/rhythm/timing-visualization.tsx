"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TimingDot } from "@/lib/rhythm-constants";

type TimingVisualizationProps = {
  timingDots: TimingDot[];
  beatCount: number;
};

const DOT_COLORS: Record<string, string> = {
  perfect: "bg-emerald-400",
  good: "bg-blue-400",
  ok: "bg-yellow-400",
  miss: "bg-red-400",
};

export function TimingVisualization({ timingDots, beatCount }: TimingVisualizationProps) {
  const maxOffset = 100; // ms scale for visualization

  const tendency = useMemo(() => {
    if (timingDots.length === 0) return null;
    const avg = timingDots.reduce((sum, d) => sum + d.signedDeltaMs, 0) / timingDots.length;
    return avg;
  }, [timingDots]);

  if (timingDots.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Timing Distribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Timeline */}
        <div className="relative h-32 border border-border rounded-lg overflow-hidden">
          {/* Center line (on-beat) */}
          <div className="absolute left-0 right-0 top-1/2 h-px bg-muted-foreground/30" />

          {/* Early/Late labels */}
          <span className="absolute top-1 left-2 text-[10px] text-muted-foreground">Early</span>
          <span className="absolute bottom-1 left-2 text-[10px] text-muted-foreground">Late</span>

          {/* Beat markers */}
          {Array.from({ length: beatCount }, (_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-border"
              style={{ left: `${((i + 0.5) / beatCount) * 100}%` }}
            >
              <span className="absolute -top-0 left-1 text-[9px] text-muted-foreground font-mono">
                {i + 1}
              </span>
            </div>
          ))}

          {/* Timing dots */}
          {timingDots.slice(0, 40).map((dot, i) => {
            const x = ((dot.beatIndex + 0.5) / beatCount) * 100;
            // Clamp offset for visualization
            const clamped = Math.max(-maxOffset, Math.min(maxOffset, dot.signedDeltaMs));
            // Map: early (negative) = above center, late (positive) = below center
            const y = 50 + (clamped / maxOffset) * 40; // 10%-90% range

            return (
              <div
                key={i}
                className={cn("absolute h-2.5 w-2.5 rounded-full opacity-80", DOT_COLORS[dot.rating])}
                style={{
                  left: `calc(${x}% - 5px)`,
                  top: `calc(${y}% - 5px)`,
                }}
                title={`${dot.signedDeltaMs > 0 ? "+" : ""}${dot.signedDeltaMs.toFixed(0)}ms`}
              />
            );
          })}
        </div>

        {/* Summary */}
        {tendency !== null && (
          <p className="text-xs text-center text-muted-foreground">
            Tendency:{" "}
            <span className="font-mono font-medium">
              {Math.abs(tendency).toFixed(0)}ms {tendency < -1 ? "early" : tendency > 1 ? "late" : "on beat"}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
