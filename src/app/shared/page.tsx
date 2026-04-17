"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Video,
  Quote,
  CheckCircle2,
  Target,
  Link2Off,
} from "lucide-react";
import { fetchSharedAnalysis, type SharedAnalysis } from "@/lib/wcs-api";
import { TimelineView } from "@/components/analyze/timeline-view";
import {
  PatternSummaryCard,
  derivePatternSummary,
} from "@/components/analyze/pattern-summary";
import { Analytics } from "@/lib/analytics";

function scoreBarColor(score: number): string {
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-primary";
  if (score >= 4) return "bg-amber-500";
  return "bg-rose-500";
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full ${scoreBarColor(score)}`}
        style={{ width: `${Math.min(100, score * 10)}%` }}
      />
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function SharedAnalysisContent() {
  const params = useSearchParams();
  const token = params.get("t");
  const [analysis, setAnalysis] = useState<SharedAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing share token — check the link.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchSharedAnalysis(token)
      .then((a) => {
        setAnalysis(a);
        Analytics.sharedAnalysisViewed();
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load analysis")
      )
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center space-y-3">
            <Link2Off className="h-8 w-8 text-muted-foreground mx-auto" />
            <h1 className="font-semibold">Link unavailable</h1>
            <p className="text-sm text-muted-foreground">
              {error ??
                "This share link has been revoked or the analysis was deleted."}
            </p>
            <Link href="/">
              <Button variant="outline" size="sm">
                Go to SwingFlow
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { result, duration, filename } = analysis;
  const overall = result.overall;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 backdrop-blur">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">
                SF
              </span>
            </div>
            <span className="font-semibold">SwingFlow</span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Shared analysis
            </Badge>
            <Link href="/login">
              <Button size="sm">Try SwingFlow</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">
              {filename || "Shared analysis"}
            </h1>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{formatDuration(duration ?? 0)}</span>
            {analysis.event_name && <span>· {analysis.event_name}</span>}
            {analysis.role && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {analysis.role}
              </Badge>
            )}
            {analysis.competition_level && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {analysis.competition_level}
              </Badge>
            )}
            {analysis.stage && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {analysis.stage}
              </Badge>
            )}
            {(analysis.tags ?? []).map((t) => (
              <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                #{t}
              </Badge>
            ))}
          </div>
        </div>

        {/* Score hero */}
        <Card className="bg-gradient-to-b from-card to-muted/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-7xl font-bold tabular-nums leading-none">
                  {overall.score.toFixed(1)}
                </span>
                <span className="text-2xl text-muted-foreground">/10</span>
              </div>
              <Badge className="text-sm px-3 py-0.5">{overall.grade}</Badge>
              {overall.impression && (
                <p className="text-sm text-muted-foreground italic text-center max-w-lg pt-1">
                  <Quote className="inline h-3 w-3 mr-1 -mt-0.5 opacity-50" />
                  {overall.impression}
                </p>
              )}
            </div>
            <div className="space-y-3.5 pt-2 border-t border-border">
              {(["timing", "technique", "teamwork", "presentation"] as const).map(
                (key) => {
                  const cat = result.categories[key];
                  const label =
                    key === "timing"
                      ? "Timing & Rhythm"
                      : key === "technique"
                      ? "Technique"
                      : key === "teamwork"
                      ? "Teamwork"
                      : "Presentation";
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="font-mono tabular-nums">
                          {cat.score.toFixed(1)} / 10
                        </span>
                      </div>
                      <ScoreBar score={cat.score} />
                      {cat.notes && (
                        <p className="text-xs text-muted-foreground pt-0.5">
                          {cat.notes}
                        </p>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pattern timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <TimelineView result={result} duration={duration ?? 0} />
          </CardContent>
        </Card>

        {/* Patterns summary — client-side derivation handles older
            analyses that lack `pattern_summary` on the stored JSON. */}
        {(() => {
          const summary =
            result.pattern_summary && result.pattern_summary.length > 0
              ? result.pattern_summary
              : derivePatternSummary(result.patterns_identified);
          return summary.length > 0 ? (
            <PatternSummaryCard summary={summary} />
          ) : null;
        })()}

        {/* Strengths */}
        {result.strengths?.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Strengths
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5 text-sm">
                {result.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{s}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Improvements */}
        {result.improvements?.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-400" />
                Areas to improve
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5 text-sm">
                {result.improvements.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Target className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{s}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card className="border-primary/30">
          <CardContent className="py-5 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Want to get your own dance scored?
            </p>
            <Link href="/login">
              <Button size="sm">Start free on SwingFlow</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default function SharedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SharedAnalysisContent />
    </Suspense>
  );
}
