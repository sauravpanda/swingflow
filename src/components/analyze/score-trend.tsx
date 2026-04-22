"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ExternalLink } from "lucide-react";
import type { ChartMetric, ChartRecord } from "@/hooks/use-analysis-history";

const METRIC_TABS: Array<{ key: ChartMetric; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "timing", label: "Timing" },
  { key: "technique", label: "Technique" },
  { key: "teamwork", label: "Teamwork" },
  { key: "presentation", label: "Presentation" },
];

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

type Point = {
  id: string;
  date: Date;
  score: number;
  filename: string | null;
  event_name: string | null;
  stage: string | null;
  competition_level: string | null;
  tags: string[] | null;
  // True when the bucket date came from the upload's `event_date`
  // rather than `created_at` — useful for the hover tooltip so
  // viewers understand why a clip sits where it does.
  from_event_date: boolean;
};

type MonthBucket = {
  key: string; // YYYY-MM
  label: string; // "Apr"
  year: number;
  month: number; // 0-11
  points: Point[];
  avg: number;
};

// Pad the chart with blank months on either side so live data doesn't
// sit flush against the frame. 3 before the earliest analysis and 3
// after "today" (or the most recent analysis, whichever is later).
const PADDING_MONTHS = 3;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" });
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Build per-month buckets covering [earliest - 3mo, max(now, latest) + 3mo]. */
function buildBuckets(
  records: ChartRecord[],
  metric: ChartMetric = "overall"
): MonthBucket[] {
  const points: Point[] = [];
  for (const r of records) {
    const s = scoreFor(r, metric);
    if (typeof s !== "number" || Number.isNaN(s)) continue;
    // Prefer the user-entered event_date so footage from a 2024
    // event clusters in 2024, even if uploaded later. Falls back to
    // created_at when no event date was supplied.
    let date: Date;
    let fromEvent = false;
    if (r.event_date) {
      // Postgres stores as 'YYYY-MM-DD'. Append midnight UTC to
      // avoid the constructor interpreting a bare date as UTC and
      // then shifting it into the previous day in western timezones.
      const parsed = new Date(`${r.event_date}T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
        fromEvent = true;
      } else {
        date = new Date(r.created_at);
      }
    } else {
      date = new Date(r.created_at);
    }
    points.push({
      id: r.id,
      date,
      score: s,
      filename: r.filename,
      event_name: r.event_name,
      stage: r.stage,
      competition_level: r.competition_level,
      tags: r.tags,
      from_event_date: fromEvent,
    });
  }
  if (points.length === 0) return [];

  points.sort((a, b) => a.date.getTime() - b.date.getTime());

  const earliest = points[0].date;
  const latest = points[points.length - 1].date;
  const now = new Date();

  // Show the full history, no 12-month cap — a 2-year journey should
  // render in full. Pad both ends by PADDING_MONTHS for visual room.
  const startMonth = addMonths(startOfMonth(earliest), -PADDING_MONTHS);
  const endReference = latest > now ? latest : now;
  const endMonth = addMonths(startOfMonth(endReference), PADDING_MONTHS);

  const buckets: MonthBucket[] = [];
  const cursor = new Date(startMonth);
  while (cursor <= endMonth) {
    buckets.push({
      key: monthKey(cursor),
      label: monthLabel(cursor),
      year: cursor.getFullYear(),
      month: cursor.getMonth(),
      points: [],
      avg: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const p of points) {
    const b = byKey.get(monthKey(p.date));
    if (b) b.points.push(p);
  }

  for (const b of buckets) {
    b.avg =
      b.points.length > 0
        ? b.points.reduce((a, x) => a + x.score, 0) / b.points.length
        : 0;
  }
  return buckets;
}

function colorForScore(s: number): string {
  if (s >= 8) return "#10b981"; // emerald
  if (s >= 6) return "#8b5cf6"; // primary-ish
  if (s >= 4) return "#f59e0b"; // amber
  return "#f43f5e"; // rose
}

/**
 * Build the hover detail string. Prefers event context (event + stage
 * + level + tags) over the raw filename, since "IMG_8665.MOV" means
 * nothing in a progression view but "Boogie by the Bay · Finals"
 * actually anchors the memory.
 */
function hoverContext(p: Point): string {
  const parts: string[] = [];
  if (p.event_name) parts.push(p.event_name);
  if (p.stage) parts.push(p.stage);
  if (p.competition_level) parts.push(p.competition_level);
  if (p.tags && p.tags.length > 0) parts.push(p.tags.join(", "));
  if (parts.length > 0) return parts.join(" · ");
  return p.filename || "Untitled";
}

const CHART_H = 200;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 28 };
const Y_MIN = 0;
const Y_MAX = 10;

export function ScoreTrendChart({
  records,
  loading,
}: {
  records: ChartRecord[];
  loading?: boolean;
}) {
  const router = useRouter();
  const [metric, setMetric] = useState<ChartMetric>("overall");
  const buckets = useMemo(
    () => buildBuckets(records, metric),
    [records, metric]
  );
  const [hovered, setHovered] = useState<Point | null>(null);

  // Clicking a dot or the detail card deep-links to the dedicated
  // analysis page.
  const openAnalysis = (id: string) => {
    router.push(`/analysis?id=${id}`);
  };

  const allPoints = useMemo(
    () => buckets.flatMap((b) => b.points),
    [buckets]
  );
  const hasData = allPoints.length > 0;

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
  const scores = allPoints.map((p) => p.score);
  const bestScore = Math.max(...scores);
  const avgAll = scores.reduce((a, b) => a + b, 0) / scores.length;

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
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
        <div className="flex flex-wrap gap-1">
          {METRIC_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setMetric(t.key);
                setHovered(null);
              }}
              className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                metric === t.key
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <TrendSVG
          buckets={buckets}
          hovered={hovered}
          setHovered={setHovered}
          onOpen={openAnalysis}
        />
        {hovered && (
          <button
            type="button"
            onClick={() => openAnalysis(hovered.id)}
            className="mt-2 w-full rounded-md border border-border bg-muted/20 hover:bg-muted/40 p-2 text-xs text-left transition-colors group"
            title="Open this analysis"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-medium flex items-center gap-1">
                {hoverContext(hovered)}
                <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
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
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function TrendSVG({
  buckets,
  hovered,
  setHovered,
  onOpen,
}: {
  buckets: MonthBucket[];
  hovered: Point | null;
  setHovered: (p: Point | null) => void;
  onOpen: (id: string) => void;
}) {
  // Responsive via viewBox — SVG scales to container width. Pick a
  // logical width that widens with bucket count so long (2+ year)
  // histories don't cram dots on top of each other; browsers will
  // still shrink it to fit the card visually.
  const n = buckets.length;
  const W = Math.max(600, n * 38);
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = CHART_H - MARGIN.top - MARGIN.bottom;
  const slotW = n > 1 ? innerW / (n - 1) : innerW;

  const xFor = (i: number) => MARGIN.left + i * slotW;
  const yFor = (score: number) =>
    MARGIN.top + innerH - ((score - Y_MIN) / (Y_MAX - Y_MIN)) * innerH;

  const avgPath = buckets
    .map((b, i) =>
      b.points.length === 0
        ? null
        : { x: xFor(i), y: yFor(b.avg) }
    )
    .filter((p): p is { x: number; y: number } => p !== null);

  const pathD = avgPath
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  // For long histories, label every Nth month so the axis stays readable.
  const labelEvery = n <= 12 ? 1 : n <= 24 ? 2 : Math.ceil(n / 12);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${CHART_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        style={{ minWidth: n > 18 ? `${n * 24}px` : undefined }}
        role="img"
        aria-label="Monthly score trend"
      >
        {/* Gridlines at 2/4/6/8/10 */}
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

        {/* Average polyline connecting months with data. Sits behind
            the per-month markers so the markers read as anchors. */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="currentColor"
            className="text-primary"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.5}
          />
        )}

        {/* Per-month monthly-average visual:
            - thick primary range bar covering min → max (so a
              dancer with a wide spread sees that spread at a glance)
            - large primary circle at the monthly avg, labelled
              with the numeric avg so a single-month chart still
              communicates meaningfully */}
        {buckets.map((b, i) => {
          if (b.points.length === 0) return null;
          const scores = b.points.map((p) => p.score);
          const minS = Math.min(...scores);
          const maxS = Math.max(...scores);
          const x = xFor(i);
          const avgY = yFor(b.avg);
          return (
            <g key={`avg-${i}`}>
              {maxS > minS && (
                <line
                  x1={x}
                  x2={x}
                  y1={yFor(maxS)}
                  y2={yFor(minS)}
                  stroke="currentColor"
                  className="text-primary"
                  strokeWidth={6}
                  strokeOpacity={0.18}
                  strokeLinecap="round"
                />
              )}
              <circle
                cx={x}
                cy={avgY}
                r={5.5}
                className="fill-primary"
                stroke="white"
                strokeOpacity={0.35}
                strokeWidth={1.5}
              >
                <title>
                  {b.label} {b.year}: avg {b.avg.toFixed(1)} across{" "}
                  {b.points.length} analys{b.points.length === 1 ? "is" : "es"}
                  {maxS > minS
                    ? ` · range ${minS.toFixed(1)}–${maxS.toFixed(1)}`
                    : ""}
                </title>
              </circle>
              <text
                x={x + 9}
                y={avgY + 3}
                className="fill-foreground"
                fontSize={10}
                fontWeight={600}
              >
                {b.avg.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Individual analysis dots. Deleted rows are filtered out
            upstream in useAnalysisHistory so they never reach here. */}
        {buckets.flatMap((b, i) =>
          b.points.map((p, pi) => {
            const jitter =
              b.points.length > 1
                ? (pi - (b.points.length - 1) / 2) * 6
                : 0;
            const cx = xFor(i) + jitter;
            const cy = yFor(p.score);
            const isActive = hovered?.id === p.id;
            const color = colorForScore(p.score);
            return (
              <circle
                key={p.id}
                cx={cx}
                cy={cy}
                r={isActive ? 5 : 3.5}
                fill={color}
                stroke="white"
                strokeOpacity={0.2}
                strokeWidth={1}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  // Touch devices: first tap shows the detail card,
                  // second tap on the same dot navigates. Mouse
                  // users see the detail card on hover and click
                  // navigates directly.
                  if (isActive) {
                    onOpen(p.id);
                  } else {
                    setHovered(p);
                  }
                }}
              >
                <title>
                  {hoverContext(p) +
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

        {/* Month labels + year tick on January (or on the first
            labeled bucket so users still see the year on long
            histories that start mid-year) */}
        {buckets.map((b, i) => {
          const showLabel = i % labelEvery === 0 || i === n - 1;
          if (!showLabel) return null;
          const isFirst = i === 0;
          const showYear = b.month === 0 || isFirst;
          return (
            <text
              key={b.key}
              x={xFor(i)}
              y={CHART_H - 10}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {b.label}
              {showYear && (
                <tspan x={xFor(i)} dy={11}>
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
