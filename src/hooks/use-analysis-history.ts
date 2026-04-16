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
  created_at: string;
};

export function useAnalysisHistory() {
  const { user } = useUser();
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !user) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const sb = getSupabase();
    const { data } = await sb
      .from("video_analyses")
      .select("id, filename, duration, result, object_key, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setRecords((data as AnalysisRecord[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { records, loading, refresh };
}
