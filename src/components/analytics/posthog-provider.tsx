"use client";

import { useEffect } from "react";
import { useUser } from "@/hooks/use-user";
import { identifyUser, initAnalytics, resetUser } from "@/lib/analytics";

/**
 * Bootstraps PostHog on mount, then wires the Supabase session so
 * user_id + email are attached to every event.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initAnalytics();
  }, []);

  const { user } = useUser();

  useEffect(() => {
    if (user) {
      identifyUser(user.id, { email: user.email });
    } else {
      resetUser();
    }
  }, [user]);

  return <>{children}</>;
}
