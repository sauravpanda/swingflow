"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Info, Trash2 } from "lucide-react";

export default function SettingsPage() {
  const handleClearData = () => {
    if (
      confirm(
        "This will reset all your progress (review deck, checklists, streaks, practice history). Are you sure?"
      )
    ) {
      localStorage.removeItem("swingflow-data");
      window.location.reload();
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">App preferences</p>
      </div>

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
