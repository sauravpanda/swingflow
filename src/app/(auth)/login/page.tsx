"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUser } from "@/hooks/use-user";
import { isSupabaseConfigured } from "@/lib/supabase";

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-center">Sign in to SwingFlow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isSupabaseConfigured ? (
          <p className="text-center text-sm text-destructive">
            Supabase env vars missing. Check <code>.env.local</code>.
          </p>
        ) : (
          <Button className="w-full" onClick={signInWithGoogle}>
            Continue with Google
          </Button>
        )}
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Free tier: 1 video analysis / month. Music analysis is unlimited.
        </p>
      </CardContent>
    </Card>
  );
}
