"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUser } from "@/hooks/use-user";
import type { VideoScoreResult } from "@/lib/wcs-api";

export type AnalysisRecord = {
  id: string;
  filename: string | null;
  duration: number | null;
  result: VideoScoreResult;
  object_key: string | null;
  role: string | null;
  competition_level: string | null;
  event_name: string | null;
  event_date: string | null;
  stage: string | null;
  tags: string[] | null;
  dancer_description: string | null;
  share_token: string | null;
  share_view_count: number | null;
  share_last_viewed_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

/**
 * Minimal shape for the score trend chart. Intentionally projects
 * only the fields the chart needs so we can still fetch the full
 * history (including soft-deleted rows) without paying for the big
 * result JSON per row.
 */
export type ChartMetric =
  | "overall"
  | "timing"
  | "technique"
  | "teamwork"
  | "presentation";

export type ChartRecord = {
  id: string;
  filename: string | null;
  score: number | null;
  // Per-category scores so the dashboard trend chart can slice by
  // Timing / Technique / Teamwork / Presentation in addition to
  // the overall score. Null when the stored result lacks that
  // category (shouldn't happen for any post-MVP analyses, but
  // we defend against it).
  timing: number | null;
  technique: number | null;
  teamwork: number | null;
  presentation: number | null;
  event_name: string | null;
  stage: string | null;
  competition_level: string | null;
  tags: string[] | null;
  // When the user entered an event date on the upload form (the
  // month the video was actually recorded), the chart buckets by
  // that instead of created_at — so a clip from a 2024 competition
  // uploaded today lands in 2024, not today.
  event_date: string | null;
  deleted_at: string | null;
  created_at: string;
};

export function useAnalysisHistory() {
  const { user } = useUser();
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [chartRecords, setChartRecords] = useState<ChartRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !user) {
      setRecords([]);
      setChartRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const sb = getSupabase();

    // Active records — for the analyze-page history list and anywhere
    // that wants the full, undeleted view. Soft-deleted rows filtered
    // out server-side via the partial index.
    const activePromise = sb
      .from("video_analyses")
      .select(
        "id, filename, duration, result, object_key, role, competition_level, event_name, event_date, stage, tags, dancer_description, share_token, share_view_count, share_last_viewed_at, deleted_at, created_at"
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    // Chart records — filtered to non-deleted rows only. If the user
    // deleted an analysis, they don't want that data point lingering
    // on their progress chart ("it doesn't make sense"). Projects
    // only what the chart needs (score, tags, event metadata) so we
    // can pull more rows without the cost of full result JSON each.
    const chartPromise = sb
      .from("video_analyses")
      .select(
        "id, filename, created_at, event_date, deleted_at, event_name, stage, competition_level, tags, result"
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1000);

    const [activeRes, chartRes] = await Promise.all([activePromise, chartPromise]);

    setRecords((activeRes.data as AnalysisRecord[]) ?? []);

    // Flatten the result -> score projection for the chart so it
    // doesn't carry the big JSON around in component props.
    const chartData = (chartRes.data ?? []).map((r: {
      id: string;
      filename: string | null;
      created_at: string;
      event_date: string | null;
      deleted_at: string | null;
      event_name: string | null;
      stage: string | null;
      competition_level: string | null;
      tags: string[] | null;
      result: VideoScoreResult | null;
    }): ChartRecord => {
      const cats = r.result?.categories;
      return {
        id: r.id,
        filename: r.filename,
        score: r.result?.overall?.score ?? null,
        timing: cats?.timing?.score ?? null,
        technique: cats?.technique?.score ?? null,
        teamwork: cats?.teamwork?.score ?? null,
        presentation: cats?.presentation?.score ?? null,
        event_name: r.event_name,
        stage: r.stage,
        competition_level: r.competition_level,
        tags: r.tags,
        event_date: r.event_date,
        deleted_at: r.deleted_at,
        created_at: r.created_at,
      };
    });
    setChartRecords(chartData);

    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      if (!isSupabaseConfigured) return;
      const sb = getSupabase();
      // Soft-delete: the row stays in the DB so the score trend
      // chart can still plot it as history, but it disappears from
      // the analyze-page list. User-intent here is "clean up my
      // list", not "erase all evidence this ever happened".
      //
      // We also null share_token so any public link the user
      // previously generated stops working — deleting should revoke
      // sharing. Backend /shared/{token} also filters deleted rows
      // as defense in depth.
      //
      // Await the response and bail on error so we don't lie to the
      // user: if the DB write fails, the row is still visible and
      // the share link is still live — mutating local state would
      // make it look like the delete succeeded.
      const now = new Date().toISOString();
      const { error } = await sb
        .from("video_analyses")
        .update({ deleted_at: now, share_token: null })
        .eq("id", id);
      if (error) {
        throw new Error(`Failed to delete analysis: ${error.message}`);
      }
      setRecords((rs) => rs.filter((r) => r.id !== id));
      setChartRecords((rs) =>
        rs.map((r) =>
          r.id === id ? { ...r, deleted_at: now, share_token: null } : r
        )
      );
    },
    []
  );

  /** Generate (or regenerate) a share_token on a row. Returns the token. */
  const enableSharing = useCallback(async (id: string): Promise<string> => {
    if (!isSupabaseConfigured) throw new Error("Supabase not configured");
    const sb = getSupabase();
    const token = crypto.randomUUID().replace(/-/g, "");
    const { error } = await sb
      .from("video_analyses")
      .update({ share_token: token })
      .eq("id", id);
    if (error) throw new Error(error.message);
    setRecords((rs) =>
      rs.map((r) => (r.id === id ? { ...r, share_token: token } : r))
    );
    return token;
  }, []);

  /** Revoke sharing by nulling the token. Any existing links stop working. */
  const disableSharing = useCallback(async (id: string): Promise<void> => {
    if (!isSupabaseConfigured) return;
    const sb = getSupabase();
    await sb.from("video_analyses").update({ share_token: null }).eq("id", id);
    setRecords((rs) =>
      rs.map((r) => (r.id === id ? { ...r, share_token: null } : r))
    );
  }, []);

  return {
    records,
    chartRecords,
    loading,
    refresh,
    remove,
    enableSharing,
    disableSharing,
  };
}
