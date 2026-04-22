"use client";

// CRUD for pattern_labels (#142). Labels belong to the user who
// authored them; RLS enforces the isolation, and we pass user_id
// explicitly on insert so the row passes the RLS insert-check.

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUser } from "@/hooks/use-user";

export type LabelSource = "user" | "ai_accepted" | "ai_edited";

export type PatternLabel = {
  id: string;
  analysis_id: string;
  user_id: string;
  start_time: number;
  end_time: number;
  name: string;
  variant: string | null;
  count: number | null;
  confidence: number | null;
  source: LabelSource;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PatternLabelDraft = Omit<
  PatternLabel,
  "id" | "user_id" | "created_at" | "updated_at"
>;

export function usePatternLabels(analysisId: string | null) {
  const { user } = useUser();
  const [labels, setLabels] = useState<PatternLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!analysisId || !isSupabaseConfigured || !user) {
      setLabels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const sb = getSupabase();
    const { data, error: err } = await sb
      .from("pattern_labels")
      .select("*")
      .eq("analysis_id", analysisId)
      .order("start_time", { ascending: true });
    if (err) {
      setError(err.message);
    } else {
      setLabels((data as PatternLabel[]) ?? []);
    }
    setLoading(false);
  }, [analysisId, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (draft: PatternLabelDraft) => {
      if (!user) throw new Error("not signed in");
      const sb = getSupabase();
      const { data, error: err } = await sb
        .from("pattern_labels")
        .insert({ ...draft, user_id: user.id })
        .select("*")
        .single();
      if (err) throw err;
      const row = data as PatternLabel;
      setLabels((cur) =>
        [...cur, row].sort((a, b) => a.start_time - b.start_time)
      );
      return row;
    },
    [user]
  );

  const update = useCallback(
    async (id: string, patch: Partial<PatternLabelDraft>) => {
      const sb = getSupabase();
      const { data, error: err } = await sb
        .from("pattern_labels")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (err) throw err;
      const row = data as PatternLabel;
      setLabels((cur) =>
        cur
          .map((l) => (l.id === id ? row : l))
          .sort((a, b) => a.start_time - b.start_time)
      );
      return row;
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    const sb = getSupabase();
    const { error: err } = await sb
      .from("pattern_labels")
      .delete()
      .eq("id", id);
    if (err) throw err;
    setLabels((cur) => cur.filter((l) => l.id !== id));
  }, []);

  return { labels, loading, error, refresh, add, update, remove };
}

// Separate hook for the /label list page — counts labels per analysis
// so we can show "3 labels / 18 patterns" progress indicators.
export function useLabelCounts() {
  const { user } = useUser();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setCounts({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      const { data } = await sb
        .from("pattern_labels")
        .select("analysis_id")
        .eq("user_id", user.id);
      if (cancelled) return;
      const out: Record<string, number> = {};
      for (const r of (data as { analysis_id: string }[]) ?? []) {
        out[r.analysis_id] = (out[r.analysis_id] ?? 0) + 1;
      }
      setCounts(out);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { counts, loading };
}
