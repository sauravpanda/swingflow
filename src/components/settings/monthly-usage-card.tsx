"use client";

// Monthly video-analysis quota. Moved from the analyze page to the
// settings page — the analyze page should be about picking + uploading
// a clip, and the quota counter was taking up that top real estate.
// Self-contained: fetches its own quota so settings doesn't need the
// larger useVideoAnalysis hook (which also owns upload state).

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, Gauge } from "lucide-react";
import { getVideoQuota, type VideoQuota } from "@/lib/wcs-api";

export function MonthlyUsageCard() {
  const [quota, setQuota] = useState<VideoQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = await getVideoQuota();
        if (!cancelled) setQuota(q);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load quota");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" />
          Monthly usage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : quota ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>
                {quota.used} of {quota.limit} videos used this month
              </span>
              <span className="text-muted-foreground">
                up to {Math.round(quota.max_seconds / 60)} min each
              </span>
            </div>
            <Progress
              value={Math.min(100, (quota.used / quota.limit) * 100)}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground pt-1">
              Your allowance resets on the 1st of each month.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
