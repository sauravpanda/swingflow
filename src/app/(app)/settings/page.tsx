"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Info, Loader2, LogOut, Trash2, UserRound } from "lucide-react";
import { MonthlyUsageCard } from "@/components/settings/monthly-usage-card";
import { useUser } from "@/hooks/use-user";

// sessionStorage (not localStorage) so the flag survives the reset's
// reload but is outside the swingflow* localStorage sweep — and dies
// with the tab instead of lingering.
const RESET_FLAG = "swingflow-reset-done";

export default function SettingsPage() {
  const { user, signOut } = useUser();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  // Reset feedback: before this banner existed, a successful reset
  // looked identical to a no-op (analyses live in the account, so a
  // user who hadn't touched the practice features saw nothing change
  // after the reload and reasonably concluded the button was broken).
  const [justReset] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !!window.sessionStorage.getItem(RESET_FLAG);
  });
  useEffect(() => {
    window.sessionStorage.removeItem(RESET_FLAG);
  }, []);

  const handleClearData = () => {
    if (
      confirm(
        "This clears LOCAL data on this device: review deck, checklists, streaks, rhythm practice history, and player preferences. Your analyses are stored in your account and are NOT affected. Continue?"
      )
    ) {
      // The app writes under two prefixes ("swingflow-data",
      // "swingflow-rhythm-history") plus colon-namespaced keys
      // ("swingflow:playbackRate", per-analysis loop / dance-start
      // overrides, overlay toggles). Sweep them all.
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("swingflow")) doomed.push(key);
      }
      doomed.forEach((key) => localStorage.removeItem(key));
      window.sessionStorage.setItem(RESET_FLAG, "1");
      window.location.reload();
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace("/login");
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">App preferences</p>
      </div>

      {justReset && (
        <Card className="border-emerald-500/40 bg-emerald-500/10">
          <CardContent className="py-3 flex items-start gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Local data cleared — review deck, checklists, streaks,
              rhythm history, and preferences were reset on this device.
              Your analyses are stored in your account and weren&apos;t
              touched.
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <label className="text-sm text-muted-foreground">
              Signed in as
            </label>
            <p className="text-sm font-medium">{user?.email ?? "—"}</p>
          </div>
          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4 mr-2" />
            )}
            Sign out
          </Button>
        </CardContent>
      </Card>

      <MonthlyUsageCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">App</label>
            <p className="text-sm font-medium">SwingFlow v0.1.0</p>
          </div>
          <Separator />
          <div>
            <label className="text-sm text-muted-foreground">
              Data Storage
            </label>
            <p className="text-sm font-medium">
              Video analyses and scores are stored in your account.
              Practice progress (review deck, checklists, streaks,
              rhythm history) and player preferences live only in this
              browser.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <Trash2 className="h-4 w-4" />
            Reset Local Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Clears practice progress and preferences stored on this
            device: review deck, checklists, streaks, rhythm history,
            playback and overlay settings. Analyses in your account are
            not affected — delete those individually from the Analyze
            page.
          </p>
          <Button variant="destructive" onClick={handleClearData}>
            Reset local data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
