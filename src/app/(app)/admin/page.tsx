"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Users,
  Video,
  Music,
  Activity,
  RefreshCw,
  ShieldAlert,
  MessageSquare,
  DollarSign,
  Coins,
} from "lucide-react";
import { getAdminStats, type AdminStats } from "@/lib/wcs-api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminStats();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading && !stats) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center space-y-3">
            <ShieldAlert className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            User activity and usage metrics
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Total users"
          value={stats.total_users}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Signups this month"
          value={stats.signups_this_month}
        />
        <StatCard
          icon={<Video className="h-4 w-4" />}
          label="Video analyses"
          value={stats.total_video_analyses}
        />
        <StatCard
          icon={<Music className="h-4 w-4" />}
          label="Music analyses"
          value={stats.total_music_analyses}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Active (7d)"
          value={stats.active_users_7d}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Active (30d)"
          value={stats.active_users_30d}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Signups this week"
          value={stats.signups_this_week}
        />
      </div>

      {/* Gemini spend — admin only */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-amber-400" />
            Gemini spend
            <Badge variant="secondary" className="ml-2 text-[10px]">
              admin-only
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SpendTile
              label="Total"
              usd={stats.cost_total_usd}
            />
            <SpendTile
              label="Last 30 days"
              usd={stats.cost_last_30d_usd}
            />
            <SpendTile
              label="Last 7 days"
              usd={stats.cost_last_7d_usd}
            />
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Coins className="h-3 w-3" />
                Total tokens
              </p>
              <p className="text-lg font-bold tabular-nums mt-1">
                {(stats.total_tokens ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent signups */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent signups</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recent_signups?.length ? (
            <div className="space-y-2">
              {stats.recent_signups.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="truncate max-w-[200px]">{u.email}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {u.plan}
                    </Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(u.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No signups yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Recent feature requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Recent feature requests
            </span>
            <Badge variant="secondary">
              {stats.total_feature_requests} total
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recent_feature_requests?.length ? (
            <div className="space-y-3">
              {stats.recent_feature_requests.map((f) => (
                <div
                  key={f.id}
                  className="border border-border rounded-lg p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-sm">{f.title}</p>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {formatDate(f.created_at)}
                    </span>
                  </div>
                  {f.description && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {f.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground italic">
                    — {f.email || "anonymous"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No feedback yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Recent analyses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent video analyses</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recent_analyses?.length ? (
            <div className="space-y-2">
              {stats.recent_analyses.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-sm gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate block max-w-[240px] font-medium">
                      {a.filename || "untitled"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.email}
                      {a.model ? (
                        <>
                          {" · "}
                          <span className="font-mono">{a.model}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.cost_usd !== undefined && a.cost_usd > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs tabular-nums border-amber-500/40 text-amber-300"
                        title="Gemini spend for this analysis"
                      >
                        ${a.cost_usd.toFixed(3)}
                      </Badge>
                    )}
                    {a.duration && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round(a.duration)}s
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(a.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No video analyses yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SpendTile({ label, usd }: { label: string; usd: number | undefined }) {
  const value = usd ?? 0;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums mt-1">
        ${value.toFixed(2)}
      </p>
    </div>
  );
}
