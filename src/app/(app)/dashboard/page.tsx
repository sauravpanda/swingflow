"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/components/store-provider";
import {
  Brain,
  Library,
  Timer,
  Flame,
  Trophy,
  Clock,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export default function DashboardPage() {
  const { getStats, loaded } = useAppStore();
  const [totalPatterns, setTotalPatterns] = useState(0);
  const [totalChecklist, setTotalChecklist] = useState(0);

  // Fetch total counts from server (read-only data)
  useEffect(() => {
    fetch("/api/patterns")
      .then((r) => r.json())
      .then((patterns) => setTotalPatterns(patterns.length));
    // Count total checklist templates from the first pattern to estimate
    fetch("/api/patterns")
      .then((r) => r.json())
      .then((patterns) => setTotalChecklist(patterns.length * 16));
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const stats = getStats();
  const checklistPercent =
    totalChecklist > 0
      ? Math.round((stats.completedChecklist / totalChecklist) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Your daily practice hub</p>
      </div>

      {/* Quick Actions */}
      {stats.reviewsDue > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">
                  {stats.reviewsDue} pattern
                  {stats.reviewsDue !== 1 ? "s" : ""} due for review
                </p>
                <p className="text-sm text-muted-foreground">
                  Keep your skills sharp with spaced repetition
                </p>
              </div>
            </div>
            <Button asChild>
              <Link href="/review">
                Review Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current Streak
            </CardTitle>
            <Flame className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.streak.currentStreak}
            </div>
            <p className="text-xs text-muted-foreground">
              day{stats.streak.currentStreak !== 1 ? "s" : ""} &middot; Best:{" "}
              {stats.streak.longestStreak}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Patterns Learned
            </CardTitle>
            <Library className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.totalReviews}
              <span className="text-lg text-muted-foreground font-normal">
                /{totalPatterns}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              in your review deck
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Reviews
            </CardTitle>
            <Brain className="h-4 w-4 text-violet-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalReviewLogs}</div>
            <p className="text-xs text-muted-foreground">
              flashcard interactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Practice Time
            </CardTitle>
            <Clock className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.totalPracticeMinutes}
              <span className="text-lg text-muted-foreground font-normal">
                min
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              across {stats.streak.totalPracticeDays} day
              {stats.streak.totalPracticeDays !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Checklist Progress */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Technique Checklist
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl font-bold">{checklistPercent}%</span>
              <span className="text-sm text-muted-foreground">
                {stats.completedChecklist}/{totalChecklist}
              </span>
            </div>
            <Progress value={checklistPercent} className="h-2" />
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/patterns">
                <Library className="mr-2 h-4 w-4" />
                Browse Patterns
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/practice">
                <Timer className="mr-2 h-4 w-4" />
                Start Practice
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/review">
                <Brain className="mr-2 h-4 w-4" />
                Review Session
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Sessions */}
      {stats.recentSessions.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Recent Practice
            </CardTitle>
            <Trophy className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">
                    {session.routineType
                      .replace("warmup-", "")
                      .replace("free", "Free")}
                    min routine
                  </span>
                  <div className="flex items-center gap-3">
                    <span>{Math.round(session.duration / 60)} min</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
