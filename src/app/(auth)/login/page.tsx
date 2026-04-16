"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { isSupabaseConfigured } from "@/lib/supabase";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const { user, loading, signInWithPassword, signUpWithPassword } = useUser();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        await signInWithPassword(email, password);
      } else {
        await signUpWithPassword(email, password);
        // If "Confirm email" is enabled in Supabase, the user won't have
        // an active session yet — tell them to check their inbox.
        setInfo(
          "Account created. If email confirmation is enabled in Supabase, check your inbox before signing in."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-center">Welcome to SwingFlow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isSupabaseConfigured ? (
          <p className="text-center text-sm text-destructive">
            Supabase env vars missing. Check <code>.env.local</code>.
          </p>
        ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit} className="space-y-3 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {info && <p className="text-sm text-muted-foreground">{info}</p>}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <TabsContent value="signin" className="pt-2">
              <p className="text-center text-xs text-muted-foreground">
                New here? Switch to <span className="font-medium">Sign up</span>.
              </p>
            </TabsContent>
            <TabsContent value="signup" className="pt-2">
              <p className="text-center text-xs text-muted-foreground">
                Free tier: 2 video analyses / month. Music analysis is
                unlimited.
              </p>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
