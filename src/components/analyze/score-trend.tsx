"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import type { AnalysisRecord } from "@/hooks/use-analysis-history";

type Point = {
  id: string;
  date: Date;
  score: number;
  filename: string | null;
};

type MonthBucket = {
  key: string; // YYYY-MM
  label: string; // "Apr"
  year: number;
  month: number; // 0-11
  points: Point[];
  avg: number;
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" });
}

/**
 * Build a contiguous run of month buckets between the earliest record
 * and now — empty months included, so the X-axis shows real time
 * passage (gaps = months with no practice).
 */
function buildBuckets(records: AnalysisRecord[]): MonthBucket[] {
  const points: Point[] = [];
  for (const r of records) {
    const score = r.result?.overall?.score;
    if (typeof score !== "number" || Number.isNaN(score)) continue;
    points.push({
      id: r.id,
      date: new Date(r.created_at),
      score,
      filename: r.filename,
    });
  }
  if (points.length === 0) return [];

  points.sort((a, b) => a.date.getTime() - b.date.getTime());
  const earliest = points[0].date;
  const now = new Date();

  // Cap at 12 months for readability — show the most recent year.
  const oldestShown = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const start = earliest < oldestShown ? oldestShown : earliest;

  const buckets = new Map<string, MonthBucket>();
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor <= end) {
    const key = monthKey(cursor);
    buckets.set(key, {
      key,
      label: monthLabel(cursor),
      year: cursor.getFullYear(),
      month: cursor.getMonth(),
      points: [],
      avg: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const p of points) {
    const b = buckets.get(monthKey(p.date));
    if (b) b.points.push(p);
  }

  const list = Array.from(buckets.values());
  for (const b of list) {
    b.avg =
      b.points.length > 0
        ? b.points.reduce((a, x) => a + x.score, 0) / b.points.length
        : 0;
  }
  return list;
}

function colorForScore(s: number): string {
  if (s >= 8) return "#10b981"; // emerald
  if (s >= 6) return "#8b5cf6"; // primary-ish
  if (s >= 4) return "#f59e0b"; // amber
  return "#f43f5e"; // rose
}

const CHART_H = 180;
const MARGIN = { top: 12, right: 12, bottom: 24, left: 28 };
const Y_MIN = 0;
const Y_MAX = 10;

export function ScoreTrendChart({
  records,
  loading,
}: {
  records: AnalysisRecord[];
  loading?: boolean;
}) {
  const buckets = useMemo(() => buildBuckets(records), [records]);
  const [hovered, setHovered] = useState<Point | null>(null);

  // Need at least one scored analysis for the chart to be useful.
  const hasData = buckets.some((b) => b.points.length > 0);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Score trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasData) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Score trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-6 text-center">
            Your score history will chart here once you&apos;ve analyzed a
            few clips.
          </p>
        </CardContent>
      </Card>
    );
  }

  const monthsWithData = buckets.filter((b) => b.points.length > 0).length;
  const allScores = buckets.flatMap((b) => b.points.map((p) => p.score));
  const bestScore = Math.max(...allScores);
  const avgAll = allScores.reduce((a, b) => a + b, 0) / allScores.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Score trend
          </span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {monthsWithData} month{monthsWithData === 1 ? "" : "s"} · avg{" "}
            {avgAll.toFixed(1)} · best {bestScore.toFixed(1)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TrendSVG buckets={buckets} hovered={hovered} setHovered={setHovered} />
        {hovered && (
          <div className="mt-2 rounded-md border border-border bg-muted/20 p-2 text-xs flex items-center justify-between gap-3">
            <span className="truncate font-medium">
              {hovered.filename || "Untitled"}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground shrink-0">
              {hovered.date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              · {hovered.score.toFixed(1)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrendSVG({
  buckets,
  hovered,
  setHovered,
}: {
  buckets: MonthBucket[];
  hovered: Point | null;
  setHovered: (p: Point | null) => void;
}) {
  // Responsive via viewBox — SVG scales to container width. We pick a
  // logical width that fits ~12 buckets comfortably; the viewBox then
  // rescales to fill the card.
  const W = 600;
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = CHART_H - MARGIN.top - MARGIN.bottom;
  const n = buckets.length;
  const slotW = n > 1 ? innerW / (n - 1) : innerW;

  const xFor = (i: number) => MARGIN.left + i * slotW;
  const yFor = (score: number) =>
    MARGIN.top + innerH - ((score - Y_MIN) / (Y_MAX - Y_MIN)) * innerH;

  // Build avg polyline only over months that have data — skip empty
  // months so the line doesn't dip to 0.
  const avgPath = buckets
    .map((b, i) =>
      b.points.length === 0
        ? null
        : { x: xFor(i), y: yFor(b.avg), avg: b.avg }
    )
    .filter((p): p is { x: number; y: number; avg: number } => p !== null);

  const pathD = avgPath
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${CHART_H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Monthly score trend"
      >
        {/* Horizontal gridlines at 2, 4, 6, 8, 10 */}
        {[2, 4, 6, 8, 10].map((s) => (
          <g key={s}>
            <line
              x1={MARGIN.left}
              x2={W - MARGIN.right}
              y1={yFor(s)}
              y2={yFor(s)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
              strokeDasharray={s === 10 ? "" : "2 3"}
            />
            <text
              x={MARGIN.left - 6}
              y={yFor(s) + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {s}
            </text>
          </g>
        ))}

        {/* Average line through months with data */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="currentColor"
            className="text-primary"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.7}
          />
        )}

        {/* Average-per-month dots */}
        {avgPath.map((p, i) => (
          <circle
            key={`avg-${i}`}
            cx={p.x}
            cy={p.y}
            r={3}
            className="fill-primary"
          />
        ))}

        {/* Individual analysis dots (scatter). Jitter the x-position
            slightly within the month slot so overlapping dots separate. */}
        {buckets.flatMap((b, i) =>
          b.points.map((p, pi) => {
            const jitter = b.points.length > 1 ? (pi - (b.points.length - 1) / 2) * 6 : 0;
            const cx = xFor(i) + jitter;
            const cy = yFor(p.score);
            const isActive = hovered?.id === p.id;
            return (
              <circle
                key={p.id}
                cx={cx}
                cy={cy}
                r={isActive ? 5 : 3.5}
                fill={colorForScore(p.score)}
                stroke="white"
                strokeOpacity={0.2}
                strokeWidth={1}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setHovered(isActive ? null : p)}
              >
                <title>
                  {(p.filename || "Untitled") +
                    " — " +
                    p.score.toFixed(1) +
                    " on " +
                    p.date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                </title>
              </circle>
            );
          })
        )}

        {/* Month labels on X-axis */}
        {buckets.map((b, i) => {
          // Only label every other month if too dense to read.
          const showLabel = n <= 6 || i % 2 === 0 || i === n - 1;
          if (!showLabel) return null;
          return (
            <text
              key={b.key}
              x={xFor(i)}
              y={CHART_H - 6}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {b.label}
              {b.month === 0 && (
                <tspan x={xFor(i)} dy={10}>
                  &apos;{String(b.year).slice(-2)}
                </tspan>
              )}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
