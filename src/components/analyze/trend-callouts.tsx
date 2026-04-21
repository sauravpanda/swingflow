"use client";

// Dashboard trend callouts (#104 phase 1) — turns the raw score
// trend chart into a plain-English "your timing jumped 7.2 → 8.1
// over 6 sessions" headline. The chart shows progression; this
// card tells the user what changed.

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartMetric, ChartRecord } from "@/hooks/use-analysis-history";

const METRIC_LABEL: Record<ChartMetric, string> = {
  overall: "overall",
  timing: "timing",
  technique: "technique",
  teamwork: "teamwork",
  presentation: "presentation",
};

const METRIC_ORDER: ChartMetric[] = [
  "timing",
  "technique",
  "teamwork",
  "presentation",
  "overall",
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
    default:
      return r.score;
  }
}

type Callout = {
  metric: ChartMetric;
  first: number;
  last: number;
  delta: number;
  sessions: number;
};

// Feature gate: we refuse to synthesize a trend unless the user has
// actually danced enough recently to have one. Three analyses in 60
// days is the floor — fewer than that and a "jumped 7 → 8" reading
// is noise, not signal.
const MIN_SESSIONS = 3;
const WINDOW_DAYS = 60;
// Delta threshold (on a 0–10 scale). Below this we stay quiet
// rather than call out random variance.
const MEANINGFUL_DELTA = 0.3;

function computeCallouts(records: ChartRecord[]): Callout[] {
  const now = Date.now();
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Use created_at for the window check — we want "recent practice",
  // not "clip recorded recently" (event_date may be old). Sort oldest
  // first so first-3 / last-3 splits make chronological sense.
  const recent = records
    .filter((r) => !r.deleted_at)
    .filter((r) => now - new Date(r.created_at).getTime() <= windowMs)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  if (recent.length < MIN_SESSIONS) return [];

  const callouts: Callout[] = [];
  for (const metric of METRIC_ORDER) {
    const scored = recent
      .map((r) => scoreFor(r, metric))
      .filter((s): s is number => typeof s === "number" && !Number.isNaN(s));
    if (scored.length < MIN_SESSIONS) continue;
    // Half-and-half split so a 4-session window is "first 2 vs last
    // 2" rather than a single point on each side. Floor the split
    // so odd counts don't double-count the median.
    const half = Math.max(1, Math.floor(scored.length / 2));
    const firstAvg =
      scored.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const lastAvg =
      scored.slice(-half).reduce((a, b) => a + b, 0) / half;
    const delta = lastAvg - firstAvg;
    if (Math.abs(delta) < MEANINGFUL_DELTA) continue;
    callouts.push({
      metric,
      first: firstAvg,
      last: lastAvg,
      delta,
      sessions: scored.length,
    });
  }
  // Top 2 by abs(delta) — keeps the card compact and the signal
  // high. "Overall" wins ties because it's the summary metric.
  return callouts
    .sort(
      (a, b) =>
        Math.abs(b.delta) - Math.abs(a.delta) ||
        (a.metric === "overall" ? -1 : 1)
    )
    .slice(0, 2);
}

export function TrendCallouts({ records }: { records: ChartRecord[] }) {
  const callouts = useMemo(() => computeCallouts(records), [records]);
  if (callouts.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-3 sm:p-4 flex flex-col gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Last {WINDOW_DAYS} days
        </span>
        {callouts.map((c) => {
          const up = c.delta > 0;
          const Icon = up ? TrendingUp : TrendingDown;
          return (
            <div
              key={c.metric}
              className="flex items-start gap-2 text-sm"
            >
              <Icon
                className={cn(
                  "h-4 w-4 mt-0.5 shrink-0",
                  up ? "text-emerald-400" : "text-amber-400"
                )}
              />
              <div className="flex-1">
                <p>
                  <span className="font-medium">
                    Your {METRIC_LABEL[c.metric]}
                  </span>{" "}
                  {up ? "jumped" : "dropped"}{" "}
                  <span className="font-mono tabular-nums">
                    {c.first.toFixed(1)} → {c.last.toFixed(1)}
                  </span>{" "}
                  over {c.sessions}{" "}
                  {c.sessions === 1 ? "session" : "sessions"}.
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
