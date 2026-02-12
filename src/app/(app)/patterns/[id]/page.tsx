"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DifficultyBadge } from "@/components/difficulty-badge";
import { CategoryBadge } from "@/components/category-badge";
import { PatternChecklist } from "@/components/pattern-checklist";
import { useAppStore } from "@/components/store-provider";
import { ArrowLeft, Music, Plus, Check } from "lucide-react";

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
  checklistTemplates: {
    id: string;
    category: string;
    item: string;
    sortOrder: number;
  }[];
};

export default function PatternDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [loading, setLoading] = useState(true);
  const { addToReviewDeck, isInDeck } = useAppStore();

  useEffect(() => {
    fetch(`/api/patterns/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPattern(data);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!pattern) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Pattern not found</p>
        <Link href="/patterns">
          <Button variant="link" className="mt-2">
            Back to patterns
          </Button>
        </Link>
      </div>
    );
  }

  const mechanics: string[] = JSON.parse(pattern.mechanics);
  const mistakes: string[] = JSON.parse(pattern.commonMistakes);
  const inDeck = isInDeck(pattern.id);

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/patterns"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to patterns
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{pattern.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            <DifficultyBadge difficulty={pattern.difficulty} />
            <CategoryBadge category={pattern.category} />
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Music className="h-3.5 w-3.5" />
              {pattern.beats} beats
            </span>
          </div>
        </div>
        <Button
          onClick={() => addToReviewDeck(pattern.id)}
          disabled={inDeck}
          variant={inDeck ? "outline" : "default"}
          size="sm"
        >
          {inDeck ? (
            <>
              <Check className="mr-1.5 h-4 w-4" />
              In Review Deck
            </>
          ) : (
            <>
              <Plus className="mr-1.5 h-4 w-4" />
              Add to Review
            </>
          )}
        </Button>
      </div>

      <p className="text-muted-foreground">{pattern.description}</p>

      <Tabs defaultValue="mechanics">
        <TabsList>
          <TabsTrigger value="mechanics">Mechanics</TabsTrigger>
          <TabsTrigger value="mistakes">Common Mistakes</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="mechanics" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Step-by-Step Mechanics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {mechanics.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-medium">
                      {i + 1}
                    </span>
                    <span className="text-sm text-muted-foreground pt-0.5">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mistakes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Common Mistakes</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {mistakes.map((mistake, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="text-destructive shrink-0 mt-0.5">
                      ✗
                    </span>
                    <span className="text-muted-foreground">{mistake}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          <PatternChecklist templates={pattern.checklistTemplates} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
