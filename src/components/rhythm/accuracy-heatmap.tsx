"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SubdivisionAccuracy } from "@/lib/rhythm-constants";

type AccuracyHeatmapProps = {
  data: SubdivisionAccuracy[];
  beatCount: number;
};

function getAccuracyColor(accuracy: number, hasData: boolean) {
  if (!hasData) return "bg-muted/30";
  if (accuracy >= 80) return "bg-emerald-500";
  if (accuracy >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

export function AccuracyHeatmap({ data, beatCount }: AccuracyHeatmapProps) {
  const totalSubs = beatCount * 4;
  const subLabels = ["1", "e", "&", "a"];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Accuracy by Subdivision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Heatmap grid */}
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${Math.min(beatCount, 8)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: totalSubs }, (_, i) => {
            const entry = data.find((d) => d.subdivisionIndex === i);
            const hasData = !!entry && entry.totalTaps > 0;
            const accuracy = entry?.accuracy ?? 0;
            const beatNum = Math.floor(i / 4) + 1;
            const subIdx = i % 4;

            // Group 4 subdivisions visually per beat
            if (subIdx === 0) {
              return (
                <div key={i} className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground text-center block">
                    Beat {beatNum}
                  </span>
                  <div className="grid grid-cols-4 gap-0.5">
                    {[0, 1, 2, 3].map((sub) => {
                      const idx = i + sub;
                      const e = data.find((d) => d.subdivisionIndex === idx);
                      const hd = !!e && e.totalTaps > 0;
                      const acc = e?.accuracy ?? 0;
                      return (
                        <div
                          key={idx}
                          className={cn(
                            "h-6 rounded-sm flex items-center justify-center",
                            getAccuracyColor(acc, hd)
                          )}
                          title={hd ? `${subLabels[sub]}: ${acc}% (${e!.totalTaps} taps)` : `${subLabels[sub]}: no data`}
                        >
                          <span className={cn("text-[9px] font-mono", hd ? "text-white" : "text-muted-foreground")}>
                            {subLabels[sub]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> &gt;80%
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-yellow-500" /> 50-80%
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> &lt;50%
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-muted/30" /> No data
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
