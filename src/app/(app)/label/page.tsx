"use client";

// /label — lists the user's past analyses with label-progress
// indicators. Click into one to open the label editor. Exists as a
// separate tab (not on /analysis) because labeling is a focused
// activity for building training data, not a viewing activity.

import Link from "next/link";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tags, ArrowRight, FileVideo, Download } from "lucide-react";
import { useAnalysisHistory } from "@/hooks/use-analysis-history";
import { useLabelCounts } from "@/hooks/use-pattern-labels";
import { exportAllLabels } from "@/lib/label-export";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function LabelListPage() {
  const history = useAnalysisHistory();
  const { counts, loading: countsLoading } = useLabelCounts();

  const rows = useMemo(
    () =>
      history.records.map((r) => {
        const aiCount = (r.result?.patterns_identified ?? []).length;
        const labelCount = counts[r.id] ?? 0;
        return { record: r, aiCount, labelCount };
      }),
    [history.records, counts]
  );

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">Label</h1>
          </div>
          <p className="text-muted-foreground mt-1 max-w-prose">
            Correct the AI&rsquo;s pattern identifications on your clips.
            Your labels train a better model over time &mdash; pick an
            analysis to start. Nothing published; labels stay yours.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await exportAllLabels(history.records, counts);
            } catch (e) {
              alert(e instanceof Error ? e.message : "Export failed");
            }
          }}
          disabled={Object.keys(counts).length === 0}
          title="Download all your labels as JSON (training-ready schema)"
        >
          <Download className="h-3.5 w-3.5 mr-2" />
          Export JSON
        </Button>
      </header>

      {history.loading || countsLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center space-y-3">
            <FileVideo className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You don&rsquo;t have any analyses yet. Analyze a clip first,
              then come back to label it.
            </p>
            <Button asChild size="sm">
              <Link href="/analyze">Analyze a clip</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map(({ record, aiCount, labelCount }) => {
            const progressPct = aiCount
              ? Math.min(100, Math.round((labelCount / aiCount) * 100))
              : 0;
            return (
              <Link
                key={record.id}
                href={`/label/editor?id=${record.id}`}
                className="block"
              >
                <Card className="hover:border-primary/40 transition-colors">
                  <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">
                          {record.filename ?? "Untitled"}
                        </p>
                        {record.competition_level && (
                          <Badge variant="outline" className="text-[10px]">
                            {record.competition_level}
                          </Badge>
                        )}
                        {record.role && (
                          <Badge variant="outline" className="text-[10px]">
                            {record.role}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(record.created_at)}
                        {" · "}
                        {aiCount} AI patterns
                        {" · "}
                        <span
                          className={
                            labelCount > 0
                              ? "text-primary"
                              : "text-muted-foreground"
                          }
                        >
                          {labelCount} labeled
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-28 h-1.5 bg-muted/40 rounded overflow-hidden">
                        <div
                          className="h-full bg-primary/70 transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {progressPct}%
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Card className="bg-muted/10 border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Why label?</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p>
            Pattern identification isn&rsquo;t perfect. Your corrections
            become ground truth we can use to measure accuracy and
            eventually fine-tune a better model.
          </p>
          <p>
            Start with 5&ndash;10 of your cleanest clips. You don&rsquo;t
            have to label everything &mdash; just accept the AI&rsquo;s
            correct calls and fix the wrong ones.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
