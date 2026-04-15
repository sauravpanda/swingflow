"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      router.replace("/login");
      return;
    }

    const sb = getSupabase();

    const redirectIfSession = async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        router.replace("/dashboard");
        return true;
      }
      return false;
    };

    let unsubscribed = false;
    redirectIfSession().then((done) => {
      if (done || unsubscribed) return;

      const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
        if (session) {
          sub.subscription.unsubscribe();
          router.replace("/dashboard");
        }
      });

      const timeout = setTimeout(() => {
        sub.subscription.unsubscribe();
        router.replace("/login?error=callback_timeout");
      }, 6000);

      return () => {
        unsubscribed = true;
        clearTimeout(timeout);
        sub.subscription.unsubscribe();
      };
    });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Signing you in…</span>
      </div>
    </div>
  );
}
