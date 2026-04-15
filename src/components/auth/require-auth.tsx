"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { isSupabaseConfigured } from "@/lib/supabase";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Auth is not configured. Set{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          in <code className="font-mono text-xs">.env.local</code> to enable
          login.
        </p>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
