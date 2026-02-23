"use client";

import { useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  type TapResult,
  type SubdivisionIndex,
  SUBDIVISION_LABELS,
  RATING_COLORS,
} from "@/lib/rhythm-constants";

type TapAreaProps = {
  results: TapResult[];
  onTap: () => TapResult | undefined;
  accuracyPercent: number;
  targetSubdivision?: SubdivisionIndex | null;
  onTargetHit?: (result: TapResult) => void;
  challengeLabel?: string;
};

export function TapArea({
  results,
  onTap,
  accuracyPercent,
  targetSubdivision,
  onTargetHit,
  challengeLabel,
}: TapAreaProps) {
  const handleTap = useCallback(() => {
    const result = onTap();
    if (result && targetSubdivision != null && onTargetHit) {
      onTargetHit(result);
    }
  }, [onTap, targetSubdivision, onTargetHit]);

  // Keyboard support
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTap]);

  const lastResult = results[0];
  const recentTaps = results.slice(0, 10);

  const formatSignedDelta = (result: TapResult) => {
    const ms = Math.abs(result.signedDeltaMs).toFixed(0);
    if (result.signedDeltaMs < -1) return `-${ms}ms (early)`;
    if (result.signedDeltaMs > 1) return `+${ms}ms (late)`;
    return `${ms}ms`;
  };

  return (
    <div className="space-y-3">
      {/* Challenge label or target indicator */}
      {challengeLabel ? (
        <div className="text-center">
          <span className="text-lg font-bold text-primary">
            {challengeLabel}
          </span>
        </div>
      ) : targetSubdivision != null ? (
        <div className="text-center">
          <span className="text-sm text-muted-foreground">
            Tap on the{" "}
          </span>
          <span className="text-lg font-bold font-mono text-primary">
            &ldquo;{SUBDIVISION_LABELS[targetSubdivision]}&rdquo;
          </span>
        </div>
      ) : null}

      {/* Tap target */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          handleTap();
        }}
        className={cn(
          "w-full min-h-[200px] rounded-xl border-2 border-dashed border-border",
          "flex flex-col items-center justify-center gap-2",
          "select-none touch-none cursor-pointer",
          "transition-colors active:bg-primary/10 active:border-primary",
          "hover:border-muted-foreground/50"
        )}
      >
        {lastResult ? (
          <>
            <span
              className={cn(
                "text-3xl font-bold uppercase",
                RATING_COLORS[lastResult.rating]
              )}
            >
              {lastResult.rating}
            </span>
            <span className="text-sm text-muted-foreground font-mono">
              {formatSignedDelta(lastResult)}
            </span>
          </>
        ) : (
          <>
            <span className="text-lg text-muted-foreground">
              Tap here or press Space
            </span>
            <span className="text-sm text-muted-foreground/60">
              Tap in time with the beat
            </span>
          </>
        )}
      </button>

      {/* Stats row */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Taps: <span className="font-mono">{results.length}</span>
        </span>
        <span className="text-muted-foreground">
          Accuracy:{" "}
          <span className="font-mono font-bold">
            {accuracyPercent}%
          </span>
        </span>
      </div>

      {/* Recent taps dots */}
      {recentTaps.length > 0 && (
        <div className="flex items-center justify-center gap-1.5">
          {recentTaps.map((tap, i) => (
            <div
              key={i}
              className={cn(
                "h-3 w-3 rounded-full",
                tap.rating === "perfect" && "bg-emerald-400",
                tap.rating === "good" && "bg-blue-400",
                tap.rating === "ok" && "bg-yellow-400",
                tap.rating === "miss" && "bg-red-400"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
