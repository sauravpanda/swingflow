"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Info, Trash2 } from "lucide-react";
import { MonthlyUsageCard } from "@/components/settings/monthly-usage-card";

export default function SettingsPage() {
  const handleClearData = () => {
    if (
      confirm(
        "This will reset all your progress (review deck, checklists, streaks, practice history) and local preferences. Are you sure?"
      )
    ) {
      // The app writes under two prefixes ("swingflow-data",
      // "swingflow-rhythm-history") plus colon-namespaced keys
      // ("swingflow:playbackRate", per-analysis loop / dance-start
      // overrides, overlay toggles). Sweep them all — removing only
      // swingflow-data left rhythm history and every preference
      // behind, which broke the promise this dialog makes.
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("swingflow")) doomed.push(key);
      }
      doomed.forEach((key) => localStorage.removeItem(key));
      window.location.reload();
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">App preferences</p>
      </div>

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
              All progress is saved locally in your browser. No account needed.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <Trash2 className="h-4 w-4" />
            Reset Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Clear all your progress data. This will reset your review deck,
            checklists, practice history, and streaks.
          </p>
          <Button variant="destructive" onClick={handleClearData}>
            Reset all data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
