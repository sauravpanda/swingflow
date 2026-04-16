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
  stage: string | null;
  tags: string[] | null;
  share_token: string | null;
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
      .select(
        "id, filename, duration, result, object_key, role, competition_level, event_name, stage, tags, share_token, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(20);
    setRecords((data as AnalysisRecord[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      if (!isSupabaseConfigured) return;
      const sb = getSupabase();
      await sb.from("video_analyses").delete().eq("id", id);
      setRecords((rs) => rs.filter((r) => r.id !== id));
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

  return { records, loading, refresh, remove, enableSharing, disableSharing };
}
