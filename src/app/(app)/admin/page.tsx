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
                  className="flex items-center justify-between text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate block max-w-[200px] font-medium">
                      {a.filename || "untitled"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.email}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
