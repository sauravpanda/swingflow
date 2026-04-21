"use client";

// Dashboard "My patterns" panel (#109) — aggregates
// patterns_identified across the user's whole history so they can
// see per-pattern trends (count, quality distribution, recent
// occurrences) instead of only the per-analysis timeline.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Grip } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisRecord } from "@/hooks/use-analysis-history";

type Occurrence = {
  analysisId: string;
  createdAt: string;
  startTime: number | null;
  endTime: number | null;
  quality: string | null;
  timing: string | null;
  filename: string | null;
};

type PatternAgg = {
  name: string;
  count: number;
  strong: number;
  solid: number;
  needsWork: number;
  weak: number;
  onBeat: number;
  slightlyOff: number;
  offBeat: number;
  occurrences: Occurrence[];
};

function normalizeName(raw: string): string {
  // Collapse whitespace + lowercase so "Sugar Push" and "sugar  push"
  // aggregate together. We don't touch variant/sub-type here — the
  // family-level roll-up is what the user wants on the dashboard.
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function aggregate(records: AnalysisRecord[]): PatternAgg[] {
  const byName = new Map<string, PatternAgg>();
  for (const r of records) {
    // Skip low-confidence analyses so noisy model output doesn't
    // pollute the pattern stats. Once timeline_locked lands server-
    // side this can switch to that flag (see #109 scope notes).
    if (r.result?.overall?.confidence === "low") continue;
    const patterns = r.result?.patterns_identified ?? [];
    for (const p of patterns) {
      if (!p?.name) continue;
      const key = normalizeName(p.name);
      if (!key) continue;
      const existing =
        byName.get(key) ??
        ({
          name: key,
          count: 0,
          strong: 0,
          solid: 0,
          needsWork: 0,
          weak: 0,
          onBeat: 0,
          slightlyOff: 0,
          offBeat: 0,
          occurrences: [],
        } satisfies PatternAgg);
      existing.count += 1;
      switch (p.quality) {
        case "strong":
          existing.strong += 1;
          break;
        case "solid":
          existing.solid += 1;
          break;
        case "needs_work":
          existing.needsWork += 1;
          break;
        case "weak":
          existing.weak += 1;
          break;
      }
      switch (p.timing) {
        case "on_beat":
          existing.onBeat += 1;
          break;
        case "slightly_off":
          existing.slightlyOff += 1;
          break;
        case "off_beat":
          existing.offBeat += 1;
          break;
      }
      existing.occurrences.push({
        analysisId: r.id,
        createdAt: r.created_at,
        startTime: typeof p.start_time === "number" ? p.start_time : null,
        endTime: typeof p.end_time === "number" ? p.end_time : null,
        quality: p.quality ?? null,
        timing: p.timing ?? null,
        filename: r.filename,
      });
      byName.set(key, existing);
    }
  }
  // Sort by count desc, then name for determinism.
  return Array.from(byName.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PatternStatsCard({
  records,
  loading,
}: {
  records: AnalysisRecord[];
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const aggs = useMemo(() => aggregate(records), [records]);
  // Cap the panel so the dashboard stays scannable. Anything past
  // the top 8 is long-tail and better viewed via /analyze → filter.
  const TOP_N = 8;
  const top = aggs.slice(0, TOP_N);
  const totalOccurrences = aggs.reduce((sum, a) => sum + a.count, 0);
  const totalAnalyses = new Set(
    aggs.flatMap((a) => a.occurrences.map((o) => o.analysisId))
  ).size;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Grip className="h-4 w-4 text-primary" />
          My patterns
        </CardTitle>
        {totalOccurrences > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {totalOccurrences} occurrences · {aggs.length} patterns ·{" "}
            {totalAnalyses} analyses
          </span>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : aggs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No patterns aggregated yet. Analyze a few clips and
            they&rsquo;ll roll up here by pattern family.
          </p>
        ) : (
          <div className="space-y-1.5">
            {top.map((agg) => {
              const isOpen = expanded === agg.name;
              const qSum =
                agg.strong + agg.solid + agg.needsWork + agg.weak;
              const tSum = agg.onBeat + agg.slightlyOff + agg.offBeat;
              const pct = (part: number) =>
                qSum > 0 ? (part / qSum) * 100 : 0;
              return (
                <div
                  key={agg.name}
                  className="rounded-md border border-border bg-muted/10 overflow-hidden"
                >
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/20 transition-colors text-left"
                    onClick={() =>
                      setExpanded((prev) =>
                        prev === agg.name ? null : agg.name
                      )
                    }
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium flex-1 min-w-0 truncate">
                      {titleCase(agg.name)}
                    </span>
                    <span className="tabular-nums text-muted-foreground text-xs shrink-0">
                      ×{agg.count}
                    </span>
                    {/* Stacked quality bar — visualizes how many of
                        this pattern landed in each quality bucket. */}
                    <div
                      className="flex h-2 w-24 sm:w-32 rounded-sm overflow-hidden bg-muted/30 shrink-0"
                      title={`${agg.strong} strong · ${agg.solid} solid · ${agg.needsWork} needs work · ${agg.weak} weak`}
                    >
                      {pct(agg.strong) > 0 && (
                        <span
                          className="bg-emerald-500/80"
                          style={{ width: `${pct(agg.strong)}%` }}
                        />
                      )}
                      {pct(agg.solid) > 0 && (
                        <span
                          className="bg-primary/80"
                          style={{ width: `${pct(agg.solid)}%` }}
                        />
                      )}
                      {pct(agg.needsWork) > 0 && (
                        <span
                          className="bg-amber-500/80"
                          style={{ width: `${pct(agg.needsWork)}%` }}
                        />
                      )}
                      {pct(agg.weak) > 0 && (
                        <span
                          className="bg-rose-500/80"
                          style={{ width: `${pct(agg.weak)}%` }}
                        />
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border bg-background/40 px-3 py-2 text-xs space-y-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        <span>
                          <span className="text-emerald-400 font-medium">
                            {agg.strong}
                          </span>{" "}
                          strong
                        </span>
                        <span>
                          <span className="text-primary font-medium">
                            {agg.solid}
                          </span>{" "}
                          solid
                        </span>
                        <span>
                          <span className="text-amber-400 font-medium">
                            {agg.needsWork}
                          </span>{" "}
                          needs work
                        </span>
                        <span>
                          <span className="text-rose-400 font-medium">
                            {agg.weak}
                          </span>{" "}
                          weak
                        </span>
                        {tSum > 0 && (
                          <span className="sm:ml-auto">
                            Timing:{" "}
                            <span className="text-foreground font-medium">
                              {Math.round((agg.onBeat / tSum) * 100)}%
                            </span>{" "}
                            on-beat
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {agg.occurrences
                          .slice()
                          .sort((a, b) =>
                            b.createdAt.localeCompare(a.createdAt)
                          )
                          .slice(0, 3)
                          .map((occ, i) => (
                            <Link
                              key={`${occ.analysisId}-${i}`}
                              href={`/analysis?id=${encodeURIComponent(occ.analysisId)}`}
                              className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/30 transition-colors"
                            >
                              <span
                                className={cn(
                                  "inline-block h-2 w-2 rounded-sm shrink-0",
                                  occ.quality === "strong"
                                    ? "bg-emerald-500"
                                    : occ.quality === "solid"
                                    ? "bg-primary"
                                    : occ.quality === "needs_work"
                                    ? "bg-amber-500"
                                    : occ.quality === "weak"
                                    ? "bg-rose-500"
                                    : "bg-muted-foreground/40"
                                )}
                              />
                              <span className="text-muted-foreground shrink-0 tabular-nums">
                                {formatDate(occ.createdAt)}
                              </span>
                              {occ.startTime != null && (
                                <span className="text-muted-foreground tabular-nums shrink-0">
                                  {formatTime(occ.startTime)}
                                </span>
                              )}
                              <span className="text-foreground truncate flex-1 min-w-0">
                                {occ.filename ?? "Untitled"}
                              </span>
                              {occ.timing && (
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {occ.timing.replace("_", " ")}
                                </span>
                              )}
                            </Link>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {aggs.length > TOP_N && (
              <p className="text-[11px] text-muted-foreground text-center pt-1">
                Showing top {TOP_N} of {aggs.length} patterns.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
