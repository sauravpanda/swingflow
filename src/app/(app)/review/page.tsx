"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DifficultyBadge } from "@/components/difficulty-badge";
import { CategoryBadge } from "@/components/category-badge";
import { useAppStore } from "@/components/store-provider";
import { sm2 } from "@/lib/sm2";
import { Brain, RotateCcw, Check, Music, ArrowRight } from "lucide-react";

type Pattern = {
  id: string;
  name: string;
  slug: string;
  beats: number;
  difficulty: string;
  category: string;
  description: string;
  mechanics: string;
  commonMistakes: string;
};

type DueReview = {
  patternId: string;
  easeFactor: number;
  interval: number;
  repetitions: number;
  pattern: Pattern | null;
};

const qualityButtons = [
  {
    quality: 0,
    label: "Forgot",
    description: "Complete blank",
    className:
      "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25",
  },
  {
    quality: 2,
    label: "Hard",
    description: "Struggled a lot",
    className:
      "bg-orange-500/15 text-orange-400 border-orange-500/30 hover:bg-orange-500/25",
  },
  {
    quality: 4,
    label: "Good",
    description: "Got it right",
    className:
      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25",
  },
  {
    quality: 5,
    label: "Easy",
    description: "Perfect recall",
    className:
      "bg-sky-500/15 text-sky-400 border-sky-500/30 hover:bg-sky-500/25",
  },
];

export default function ReviewPage() {
  const { getDueReviews, submitReview, loaded } = useAppStore();
  const [reviews, setReviews] = useState<DueReview[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load due reviews and fetch their pattern data
  useEffect(() => {
    if (!loaded) return;
    const due = getDueReviews();
    if (due.length === 0) {
      setLoading(false);
      return;
    }

    // Fetch all patterns at once and match
    fetch("/api/patterns")
      .then((r) => r.json())
      .then((patterns: Pattern[]) => {
        const patternMap = new Map(patterns.map((p) => [p.id, p]));
        const withPatterns = due
          .map((r) => ({
            ...r,
            pattern: patternMap.get(r.patternId) ?? null,
          }))
          .filter((r) => r.pattern !== null);
        setReviews(withPatterns);
        setLoading(false);
      });
  }, [loaded, getDueReviews]);

  const handleRate = useCallback(
    (quality: number) => {
      const review = reviews[currentIndex];
      if (!review) return;

      const result = sm2({
        quality,
        repetitions: review.repetitions,
        easeFactor: review.easeFactor,
        interval: review.interval,
      });

      submitReview(review.patternId, quality, result);

      setCompleted((c) => c + 1);
      setFlipped(false);

      if (currentIndex + 1 < reviews.length) {
        setCurrentIndex((i) => i + 1);
      } else {
        setSessionComplete(true);
      }
    },
    [reviews, currentIndex, submitReview]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">
          Loading review session...
        </div>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <Brain className="h-16 w-16 text-muted-foreground/40 mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Reviews Due</h2>
        <p className="text-muted-foreground max-w-md">
          You&apos;re all caught up! Add patterns to your review deck from the
          pattern library, or come back later when reviews are due.
        </p>
        <Button asChild className="mt-6">
          <a href="/patterns">Browse Patterns</a>
        </Button>
      </div>
    );
  }

  if (sessionComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="h-16 w-16 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Session Complete!</h2>
        <p className="text-muted-foreground">
          You reviewed {completed} pattern{completed !== 1 ? "s" : ""}. Great
          work!
        </p>
        <Button
          onClick={() => window.location.reload()}
          variant="outline"
          className="mt-6"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Start new session
        </Button>
      </div>
    );
  }

  const current = reviews[currentIndex];
  const pattern = current.pattern!;
  const mechanics: string[] = JSON.parse(pattern.mechanics);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Review Session</h1>
          <p className="text-sm text-muted-foreground">
            {currentIndex + 1} of {reviews.length} &middot; {completed}{" "}
            completed
          </p>
        </div>
        <div className="flex items-center gap-1">
          {reviews.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-6 rounded-full transition-colors ${
                i < completed
                  ? "bg-primary"
                  : i === currentIndex
                  ? "bg-primary/50"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      <div>
        <Card
          className={`min-h-[320px] cursor-pointer transition-all duration-500 ${
            flipped ? "border-primary/30" : ""
          }`}
          onClick={() => setFlipped(!flipped)}
        >
          <CardContent className="flex flex-col items-center justify-center min-h-[320px] p-8 text-center">
            {!flipped ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <DifficultyBadge difficulty={pattern.difficulty} />
                  <CategoryBadge category={pattern.category} />
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Music className="h-3 w-3" />
                    {pattern.beats}
                  </span>
                </div>
                <h2 className="text-2xl font-bold mb-4">{pattern.name}</h2>
                <p className="text-muted-foreground mb-6">
                  Can you recall the mechanics of this pattern?
                </p>
                <Button variant="outline" size="sm">
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Show Answer
                </Button>
              </>
            ) : (
              <div className="w-full text-left space-y-4">
                <h3 className="text-lg font-semibold text-center">
                  {pattern.name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {pattern.description}
                </p>
                <ol className="space-y-2">
                  {mechanics.map((step, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-xs">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {flipped && (
        <div className="space-y-3">
          <p className="text-sm text-center text-muted-foreground">
            How well did you recall this pattern?
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {qualityButtons.map((btn) => (
              <button
                key={btn.quality}
                onClick={() => handleRate(btn.quality)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors ${btn.className}`}
              >
                <span className="text-sm font-medium">{btn.label}</span>
                <span className="text-xs opacity-70">{btn.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
