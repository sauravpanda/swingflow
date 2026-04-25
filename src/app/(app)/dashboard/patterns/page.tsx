"use client";

// Cross-analysis "My patterns" view (#138). Aggregates
// patterns_identified across the user's whole history with
// filters (date / stage / level) and sort modes (frequency /
// weakest / most recent). Shares aggregation logic with the
// dashboard snapshot card via @/lib/pattern-aggregation so the
// numbers stay in lockstep.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ArrowLeft, Filter, Grip } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnalysisHistory } from "@/hooks/use-analysis-history";
import {
  aggregatePatterns,
  formatPatternDate,
  formatPatternTime,
  titleCasePattern,
  type PatternAgg,
} from "@/lib/pattern-aggregation";

type SortMode = "frequency" | "weakest" | "recent" | "best";
type DatePreset = "all" | "7d" | "30d" | "90d" | "365d";

const DATE_PRESET_DAYS: Record<Exclude<DatePreset, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

const ANY = "__any__";

function weaknessScore(a: PatternAgg): number {
  // Higher score = weaker. Weighted so weak/needs_work dominate over
  // raw count — a single weak rep ranks above two solids of the same
  // family. Returns 0 when the pattern has no quality signal at all.
  const denom = a.strong + a.solid + a.needsWork + a.weak;
  if (denom === 0) return 0;
  return (a.weak * 3 + a.needsWork * 2) / denom;
}

function bestScore(a: PatternAgg): number {
  const denom = a.strong + a.solid + a.needsWork + a.weak;
  if (denom === 0) return 0;
  return (a.strong * 3 + a.solid * 2) / denom;
}

function lastSeenIso(a: PatternAgg): string {
  return a.occurrences.reduce(
    (max, o) => (o.createdAt > max ? o.createdAt : max),
    ""
  );
}

function firstSeenIso(a: PatternAgg): string {
  if (a.occurrences.length === 0) return "";
  return a.occurrences.reduce(
    (min, o) => (min === "" || o.createdAt < min ? o.createdAt : min),
    ""
  );
}

export default function CrossAnalysisPatternsPage() {
  const history = useAnalysisHistory();
  const [sortMode, setSortMode] = useState<SortMode>("frequency");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [stageFilter, setStageFilter] = useState<string>(ANY);
  const [levelFilter, setLevelFilter] = useState<string>(ANY);
  const [eventFilter, setEventFilter] = useState<string>(ANY);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Snapshot "now" once at mount so the date-range cutoff is stable
  // across re-renders. The lint rule flags Date.now() in render bodies
  // because it makes the component non-idempotent; pinning it here
  // also means "last 7 days" doesn't tick forward by the second
  // while the user is interacting with filters.
  const [nowMs] = useState<number>(() => Date.now());

  // Build the filter dropdowns from the records we actually have —
  // free-text fields (stage, competition_level, event_name) get
  // de-duped + sorted so picking the same value the user typed
  // upstream just works. "Any" stays first.
  const allRecords = useMemo(
    () => history.records.filter((r) => !r.deleted_at),
    [history.records]
  );

  const stageOptions = useMemo(() => extractStrings(allRecords, "stage"), [
    allRecords,
  ]);
  const levelOptions = useMemo(
    () => extractStrings(allRecords, "competition_level"),
    [allRecords]
  );
  const eventOptions = useMemo(
    () => extractStrings(allRecords, "event_name"),
    [allRecords]
  );

  const filtered = useMemo(() => {
    const cutoff =
      datePreset === "all"
        ? null
        : new Date(
            nowMs - DATE_PRESET_DAYS[datePreset] * 24 * 60 * 60 * 1000
          ).toISOString();
    return allRecords.filter((r) => {
      if (cutoff && r.created_at < cutoff) return false;
      if (stageFilter !== ANY && (r.stage ?? "") !== stageFilter) return false;
      if (
        levelFilter !== ANY &&
        (r.competition_level ?? "") !== levelFilter
      )
        return false;
      if (
        eventFilter !== ANY &&
        (r.event_name ?? "") !== eventFilter
      )
        return false;
      return true;
    });
  }, [allRecords, datePreset, stageFilter, levelFilter, eventFilter, nowMs]);

  const aggs = useMemo(() => {
    const base = aggregatePatterns(filtered);
    switch (sortMode) {
      case "weakest":
        // Patterns with no quality signal sink to the bottom so they
        // don't masquerade as "perfect."
        return [...base].sort(
          (a, b) =>
            weaknessScore(b) - weaknessScore(a) ||
            b.count - a.count ||
            a.name.localeCompare(b.name)
        );
      case "best":
        return [...base].sort(
          (a, b) =>
            bestScore(b) - bestScore(a) ||
            b.count - a.count ||
            a.name.localeCompare(b.name)
        );
      case "recent":
        return [...base].sort((a, b) =>
          lastSeenIso(b).localeCompare(lastSeenIso(a))
        );
      case "frequency":
      default:
        return base;
    }
  }, [filtered, sortMode]);

  const totalOccurrences = aggs.reduce((s, a) => s + a.count, 0);
  const totalAnalyses = filtered.length;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Dashboard
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Grip className="h-5 w-5 text-primary" />
          My patterns
        </h1>
        <p className="text-muted-foreground">
          Every pattern family across all your analyses. Filter by date,
          event, or stage; sort by frequency, weakness, or recency.
        </p>
      </div>

      {/* ─── Filter bar ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterPicker
            label="Date range"
            value={datePreset}
            onValueChange={(v) => setDatePreset(v as DatePreset)}
            options={[
              { value: "all", label: "All time" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "90d", label: "Last 90 days" },
              { value: "365d", label: "Last year" },
            ]}
          />
          <FilterPicker
            label="Stage"
            value={stageFilter}
            onValueChange={setStageFilter}
            options={[
              { value: ANY, label: "Any stage" },
              ...stageOptions.map((v) => ({ value: v, label: v })),
            ]}
            disabled={stageOptions.length === 0}
          />
          <FilterPicker
            label="Level"
            value={levelFilter}
            onValueChange={setLevelFilter}
            options={[
              { value: ANY, label: "Any level" },
              ...levelOptions.map((v) => ({ value: v, label: v })),
            ]}
            disabled={levelOptions.length === 0}
          />
          <FilterPicker
            label="Event"
            value={eventFilter}
            onValueChange={setEventFilter}
            options={[
              { value: ANY, label: "Any event" },
              ...eventOptions.map((v) => ({ value: v, label: v })),
            ]}
            disabled={eventOptions.length === 0}
          />
        </CardContent>
      </Card>

      {/* ─── Sort + counts row ─── */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <span className="text-sm text-muted-foreground tabular-nums">
          {history.loading
            ? "Loading…"
            : `${totalOccurrences} occurrences · ${aggs.length} patterns · ${totalAnalyses} analyses`}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort by</span>
          <Select
            value={sortMode}
            onValueChange={(v) => setSortMode(v as SortMode)}
          >
            <SelectTrigger className="h-8 text-sm w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="frequency">Most danced</SelectItem>
              <SelectItem value="weakest">Weakest first</SelectItem>
              <SelectItem value="best">Strongest first</SelectItem>
              <SelectItem value="recent">Most recent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ─── Pattern list ─── */}
      {history.loading ? (
        <p className="text-sm text-muted-foreground">Loading patterns…</p>
      ) : aggs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No patterns matched these filters.{" "}
            {totalAnalyses === 0 && allRecords.length > 0 && (
              <>Loosen the date/event/stage selection above.</>
            )}
            {allRecords.length === 0 && (
              <>
                Analyze a few clips and your patterns will roll up here.{" "}
                <Link href="/analyze" className="underline">
                  Analyze a video →
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {aggs.map((agg) => (
            <PatternRow
              key={agg.name}
              agg={agg}
              isOpen={expanded === agg.name}
              onToggle={() =>
                setExpanded((prev) => (prev === agg.name ? null : agg.name))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPicker({
  label,
  value,
  onValueChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PatternRow({
  agg,
  isOpen,
  onToggle,
}: {
  agg: PatternAgg;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const qSum = agg.strong + agg.solid + agg.needsWork + agg.weak;
  const tSum = agg.onBeat + agg.slightlyOff + agg.offBeat;
  const pct = (part: number) => (qSum > 0 ? (part / qSum) * 100 : 0);
  const last = lastSeenIso(agg);
  const first = firstSeenIso(agg);

  return (
    <div className="rounded-md border border-border bg-muted/10 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/20 transition-colors text-left"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="font-medium flex-1 min-w-0 truncate">
          {titleCasePattern(agg.name)}
        </span>
        <span className="tabular-nums text-muted-foreground text-xs shrink-0">
          ×{agg.count}
        </span>
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
        <div className="border-t border-border bg-background/40 px-3 py-3 text-xs space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              <span className="text-emerald-400 font-medium">{agg.strong}</span>{" "}
              strong
            </span>
            <span>
              <span className="text-primary font-medium">{agg.solid}</span>{" "}
              solid
            </span>
            <span>
              <span className="text-amber-400 font-medium">{agg.needsWork}</span>{" "}
              needs work
            </span>
            <span>
              <span className="text-rose-400 font-medium">{agg.weak}</span>{" "}
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
          {(first || last) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {first && (
                <span>
                  First seen:{" "}
                  <span className="text-foreground">
                    {formatPatternDate(first)}
                  </span>
                </span>
              )}
              {last && (
                <span>
                  Last seen:{" "}
                  <span className="text-foreground">
                    {formatPatternDate(last)}
                  </span>
                </span>
              )}
            </div>
          )}
          <div className="space-y-1">
            {agg.occurrences
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
                    {formatPatternDate(occ.createdAt)}
                  </span>
                  {occ.startTime != null && (
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {formatPatternTime(occ.startTime)}
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
                  {(occ.stage || occ.competitionLevel) && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {[occ.competitionLevel, occ.stage]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function extractStrings(
  records: { stage: string | null; competition_level: string | null; event_name: string | null }[],
  field: "stage" | "competition_level" | "event_name"
): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const v = r[field];
    if (v && v.trim()) set.add(v.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
