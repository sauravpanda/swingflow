"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DifficultyBadge } from "@/components/difficulty-badge";
import { Anchor } from "lucide-react";

type AnchorType = {
  id: string;
  name: string;
  slug: string;
  description: string;
  execution: string;
  musicality: string;
  difficulty: string;
};

export default function AnchorsPage() {
  const [anchors, setAnchors] = useState<AnchorType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/anchors")
      .then((r) => r.json())
      .then((data) => {
        setAnchors(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">
          Loading anchors...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Anchor Types</h1>
        <p className="text-muted-foreground">
          The anchor is the foundation of every WCS pattern. Master these
          variations.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {anchors.map((anchor) => {
          const execution: string[] = JSON.parse(anchor.execution);
          const isExpanded = selected === anchor.id;

          return (
            <Card
              key={anchor.id}
              className={`cursor-pointer transition-all ${
                isExpanded ? "sm:col-span-2 lg:col-span-3 border-primary/40" : "hover:border-primary/30"
              }`}
              onClick={() => setSelected(isExpanded ? null : anchor.id)}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Anchor className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">{anchor.name}</CardTitle>
                  </div>
                  <DifficultyBadge difficulty={anchor.difficulty} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {anchor.description}
                </p>

                {isExpanded && (
                  <>
                    <div>
                      <h3 className="text-sm font-medium mb-2">Execution</h3>
                      <ol className="space-y-2">
                        {execution.map((step, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-xs">
                              {i + 1}
                            </span>
                            <span className="text-muted-foreground">
                              {step}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div>
                      <h3 className="text-sm font-medium mb-1">
                        When to use it
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {anchor.musicality}
                      </p>
                    </div>
                  </>
                )}

                {!isExpanded && (
                  <p className="text-xs text-muted-foreground/60">
                    Click to expand
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
