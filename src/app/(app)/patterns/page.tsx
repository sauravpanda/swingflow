"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DifficultyBadge } from "@/components/difficulty-badge";
import { CategoryBadge } from "@/components/category-badge";
import { Search, Music } from "lucide-react";

type Pattern = {
  id: string;
  name: string;
  slug: string;
  beats: number;
  difficulty: string;
  category: string;
  description: string;
};

const difficulties = ["all", "beginner", "intermediate", "advanced"];
const categories = [
  "all",
  "basics",
  "push-pull",
  "turns",
  "whips",
  "wraps",
  "slides",
];

const categoryLabels: Record<string, string> = {
  all: "All",
  basics: "Basics",
  "push-pull": "Push/Pull",
  turns: "Turns",
  whips: "Whips",
  wraps: "Wraps",
  slides: "Slides",
};

export default function PatternsPage() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("all");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/patterns")
      .then((r) => r.json())
      .then((data) => {
        setPatterns(data);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    return patterns.filter((p) => {
      if (difficulty !== "all" && p.difficulty !== difficulty) return false;
      if (category !== "all" && p.category !== category) return false;
      if (
        search &&
        !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.description.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [patterns, search, difficulty, category]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">
          Loading patterns...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pattern Library</h1>
        <p className="text-muted-foreground">
          {patterns.length} West Coast Swing patterns to master
        </p>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search patterns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {difficulties.map((d) => (
            <Button
              key={d}
              variant={difficulty === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDifficulty(d)}
              className="capitalize"
            >
              {d === "all" ? "All Levels" : d}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Button
              key={c}
              variant={category === c ? "secondary" : "outline"}
              size="sm"
              onClick={() => setCategory(c)}
            >
              {categoryLabels[c]}
            </Button>
          ))}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing {filtered.length} pattern{filtered.length !== 1 ? "s" : ""}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((pattern) => (
          <Link key={pattern.id} href={`/patterns/${pattern.slug}`}>
            <Card className="h-full transition-colors hover:bg-card/80 hover:border-primary/30 cursor-pointer">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">
                    {pattern.name}
                  </CardTitle>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Music className="h-3 w-3" />
                    {pattern.beats}
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <DifficultyBadge difficulty={pattern.difficulty} />
                  <CategoryBadge category={pattern.category} />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {pattern.description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No patterns found matching your filters.
        </div>
      )}
    </div>
  );
}
