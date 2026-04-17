"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const sb = getSupabase();
    let mounted = true;

    sb.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      const sb = getSupabase();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    []
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      const sb = getSupabase();
      // Explicit emailRedirectTo so the verification link resolves
      // back to production, not whatever Site URL is currently
      // configured in the Supabase dashboard (which defaults to
      // localhost:3000 on a fresh project). Falls back to the
      // current origin on staging/dev so local signups still work.
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "https://swingflow.dance";
      const { error } = await sb.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/`,
        },
      });
      if (error) throw error;
    },
    []
  );

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    await sb.auth.signOut();
  }, []);

  return {
    user,
    session,
    loading,
    signInWithPassword,
    signUpWithPassword,
    signOut,
  };
}
