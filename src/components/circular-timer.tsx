"use client";

import { formatTime } from "@/hooks/use-timer";

type CircularTimerProps = {
  remaining: number;
  total: number;
  progress: number;
};

export function CircularTimer({
  remaining,
  total,
  progress,
}: CircularTimerProps) {
  const size = 240;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-all duration-1000 ease-linear"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-mono font-bold tabular-nums">
          {formatTime(remaining)}
        </span>
        <span className="text-sm text-muted-foreground">
          of {formatTime(total)}
        </span>
      </div>
    </div>
  );
}
