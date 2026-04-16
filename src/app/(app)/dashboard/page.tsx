"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/components/store-provider";
import { useAnalysisHistory } from "@/hooks/use-analysis-history";
import { ScoreTrendChart } from "@/components/analyze/score-trend";
import {
  Video,
  Music,
  Flame,
  Clock,
  TrendingUp,
  Target,
  ArrowRight,
  Sparkles,
} from "lucide-react";

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function DashboardPage() {
  const { getStats, loaded } = useAppStore();
  const history = useAnalysisHistory();

  const stats = loaded ? getStats() : null;

  const analysisStats = useMemo(() => {
    const recs = history.records;
    if (!recs.length) {
      return { total: 0, avg: null as number | null, best: null as number | null };
    }
    const scores = recs
      .map((r) => r.result?.overall?.score)
      .filter((s): s is number => typeof s === "number" && !Number.isNaN(s));
    const total = recs.length;
    const avg =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null;
    const best = scores.length > 0 ? Math.max(...scores) : null;
    return { total, avg, best };
  }, [history.records]);

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Your WCS practice at a glance
        </p>
      </div>

      {/* ─── Hero actions ─── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/analyze" className="group">
          <Card className="border-primary/30 bg-gradient-to-br from-card to-primary/5 h-full hover:border-primary/60 transition-colors">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
                  <Video className="h-5 w-5 text-primary" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground transition-all" />
              </div>
              <div>
                <h3 className="font-semibold">Analyze a video</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Upload a dance clip. Get WSDC-style scoring across timing,
                  technique, teamwork, and presentation.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/rhythm" className="group">
          <Card className="border-border hover:border-primary/60 h-full transition-colors">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
                  <Music className="h-5 w-5 text-violet-400" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground transition-all" />
              </div>
              <div>
                <h3 className="font-semibold">Rhythm trainer</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Drop in a song to see every anchor. Tap along, drill
                  subdivisions, ramp tempo.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ─── Stats ─── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Video className="h-4 w-4 text-primary" />}
          label="Videos analyzed"
          value={analysisStats.total.toString()}
          hint={
            analysisStats.total
              ? `last ${Math.min(analysisStats.total, 20)}`
              : "upload your first clip"
          }
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
          label="Average score"
          value={
            analysisStats.avg !== null
              ? analysisStats.avg.toFixed(1)
              : "—"
          }
          hint={
            analysisStats.avg !== null
              ? "out of 10 across analyses"
              : "needs at least one analysis"
          }
        />
        <StatCard
          icon={<Target className="h-4 w-4 text-amber-400" />}
          label="Best score"
          value={
            analysisStats.best !== null
              ? analysisStats.best.toFixed(1)
              : "—"
          }
          hint={
            analysisStats.best !== null
              ? "your personal best"
              : "room for greatness"
          }
        />
        <StatCard
          icon={<Flame className="h-4 w-4 text-orange-400" />}
          label="Practice streak"
          value={stats ? String(stats.streak.currentStreak) : "—"}
          hint={
            stats
              ? `days · best ${stats.streak.longestStreak}`
              : ""
          }
        />
      </div>

      {/* ─── Score trend ─── */}
      <ScoreTrendChart
        records={history.chartRecords}
        loading={history.loading}
      />

      {/* ─── Recent analyses ─── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent analyses</CardTitle>
            {history.records.length > 0 && (
              <Link
                href="/analyze"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                View all →
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {history.loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : history.records.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <Sparkles className="h-8 w-8 text-muted-foreground/50 mx-auto" />
                <div className="text-sm text-muted-foreground">
                  No analyses yet. Upload your first dance clip to get
                  scored.
                </div>
                <Button asChild size="sm">
                  <Link href="/analyze">
                    <Video className="mr-2 h-4 w-4" />
                    Analyze a video
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {history.records.slice(0, 5).map((rec) => {
                  const overall = rec.result?.overall;
                  return (
                    <Link
                      key={rec.id}
                      href="/analyze"
                      className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {rec.filename || "Untitled"}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <span>{formatRelative(rec.created_at)}</span>
                          {rec.event_name && (
                            <>
                              <span>·</span>
                              <span className="truncate">{rec.event_name}</span>
                            </>
                          )}
                          {rec.role && (
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1.5 py-0 h-4"
                            >
                              {rec.role}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {overall && (
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <span className="font-mono font-bold tabular-nums">
                            {overall.score?.toFixed?.(1) ?? "—"}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {overall.grade ?? "—"}
                          </Badge>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Practice sidebar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-400" />
              Practice
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-bold tabular-nums">
                {stats?.totalPracticeMinutes ?? 0}
                <span className="text-base font-normal text-muted-foreground ml-1">
                  min
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                across {stats?.streak.totalPracticeDays ?? 0} day
                {(stats?.streak.totalPracticeDays ?? 0) !== 1 ? "s" : ""}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/practice">
                Start a practice session
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href="/rhythm">
                Jump to rhythm trainer
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </CardContent>
    </Card>
  );
}
