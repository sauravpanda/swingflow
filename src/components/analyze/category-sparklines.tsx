"use client";

// Per-category sparklines — at-a-glance view of trajectory across
// the 4 WSDC categories + overall (#104). The full ScoreTrendChart
// hides 4/5 metrics behind tabs; this surfaces them all on the
// dashboard landing so the user sees movement without clicking.

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartMetric, ChartRecord } from "@/hooks/use-analysis-history";

const METRIC_ORDER: Array<{ key: ChartMetric; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "timing", label: "Timing" },
  { key: "technique", label: "Technique" },
  { key: "teamwork", label: "Teamwork" },
  { key: "presentation", label: "Presentation" },
];

// 3 points = the bar to compute a delta. Below this we show the
// current value but suppress the trend arrow — too noisy.
const MIN_POINTS_FOR_TREND = 3;

// Magnitude (in 0-10 score units) below which we render a flat
// indicator instead of up/down. Matches MEANINGFUL_DELTA in
// trend-callouts.tsx so an arrow on a sparkline can never disagree
// with "Your timing jumped X → Y" copy on the same data — both are
// computed from the same scores with the same threshold.
const FLAT_DELTA_THRESHOLD = 0.3;

const SVG_W = 96;
const SVG_H = 28;

function scoreFor(r: ChartRecord, metric: ChartMetric): number | null {
  switch (metric) {
    case "timing":
      return r.timing;
    case "technique":
      return r.technique;
    case "teamwork":
      return r.teamwork;
    case "presentation":
      return r.presentation;
    case "overall":
    default:
      return r.score;
  }
}

type Series = {
  metric: ChartMetric;
  label: string;
  scores: number[];
  current: number | null;
  delta: number | null;
};

function buildSeries(
  records: ChartRecord[],
  metric: ChartMetric,
  label: string
): Series {
  // Chronological so the polyline reads left-to-right as oldest →
  // newest. Drop locked rows for the same reason the main trend
  // chart does.
  const ordered = records
    .filter((r) => !r.deleted_at && !r.timeline_locked)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const scores: number[] = [];
  for (const r of ordered) {
    const s = scoreFor(r, metric);
    if (typeof s === "number" && !Number.isNaN(s)) scores.push(s);
  }
  const current = scores.length > 0 ? scores[scores.length - 1] : null;
  // Compare last vs first half — symmetric with TrendCallouts so the
  // sparkline arrow doesn't disagree with the callout copy on the
  // same data.
  let delta: number | null = null;
  if (scores.length >= MIN_POINTS_FOR_TREND) {
    const half = Math.max(1, Math.floor(scores.length / 2));
    const firstAvg =
      scores.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const lastAvg = scores.slice(-half).reduce((a, b) => a + b, 0) / half;
    delta = lastAvg - firstAvg;
  }
  return { metric, label, scores, current, delta };
}

function Sparkline({ scores }: { scores: number[] }) {
  if (scores.length === 0) {
    return (
      <div
        className="h-7 w-24 rounded-sm bg-muted/20"
        aria-label="No data"
      />
    );
  }
  // 1-10 score range pinned, so two sparklines on the same row are
  // visually comparable rather than each auto-scaling to its own min/
  // max (which would hide the "this category is way lower" signal).
  const minY = 1;
  const maxY = 10;
  const range = maxY - minY;
  const stepX = scores.length > 1 ? SVG_W / (scores.length - 1) : 0;
  const pts = scores
    .map((s, i) => {
      const x = i * stepX;
      const y = SVG_H - ((s - minY) / range) * SVG_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={SVG_W}
      height={SVG_H}
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      className="overflow-visible"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
      {scores.length > 0 && (
        <circle
          cx={(scores.length - 1) * stepX}
          cy={SVG_H - ((scores[scores.length - 1] - minY) / range) * SVG_H}
          r="2"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

function TrendIcon({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  if (Math.abs(delta) < FLAT_DELTA_THRESHOLD) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  return delta > 0 ? (
    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
  ) : (
    <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
  );
}

export function CategorySparklines({
  records,
  loading,
}: {
  records: ChartRecord[];
  loading?: boolean;
}) {
  const series = useMemo(
    () =>
      METRIC_ORDER.map((m) => buildSeries(records, m.key, m.label)),
    [records]
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  // No category has any data — show nothing rather than a sea of
  // empty boxes. Once the user analyzes one clip the panel appears.
  const anyData = series.some((s) => s.scores.length > 0);
  if (!anyData) return null;

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          {series.map((s) => (
            <SparklineCell key={s.metric} series={s} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SparklineCell({ series }: { series: Series }) {
  const { label, scores, current, delta } = series;
  const isOverall = series.metric === "overall";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md p-2 transition-colors",
        isOverall ? "bg-primary/5" : "bg-muted/10",
        "text-primary"
      )}
    >
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className={cn(isOverall && "text-primary")}>{label}</span>
        <TrendIcon delta={delta} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-xl font-bold tabular-nums text-foreground">
          {current != null ? current.toFixed(1) : "—"}
        </span>
        <Sparkline scores={scores} />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {scores.length === 0
          ? "No data yet"
          : delta == null
          ? `${scores.length} session${scores.length === 1 ? "" : "s"}`
          : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} over ${scores.length} sessions`}
      </div>
    </div>
  );
}
