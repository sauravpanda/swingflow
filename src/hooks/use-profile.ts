"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUser } from "@/hooks/use-user";

export type Plan = "free" | "pro";

export type Profile = {
  id: string;
  email: string | null;
  plan: Plan;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
};

export function useProfile() {
  const { user, loading: userLoading } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !user) {
      setProfile(null);
      setLoading(userLoading);
      return;
    }
    setLoading(true);
    setError(null);
    const sb = getSupabase();
    const { data, error: queryError } = await sb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (queryError) {
      setError(queryError.message);
      setProfile(null);
    } else {
      setProfile((data as Profile | null) ?? null);
    }
    setLoading(false);
  }, [user, userLoading]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { profile, loading, error, refresh, plan: profile?.plan ?? "free" };
}
