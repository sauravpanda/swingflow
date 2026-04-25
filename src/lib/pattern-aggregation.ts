// Cross-analysis pattern aggregation. Used by the dashboard
// "My patterns" snapshot card and the full /dashboard/patterns
// drill-down page. Keep both consumers on the same shape so the
// snapshot's numbers match the full-page view exactly.

import type { AnalysisRecord } from "@/hooks/use-analysis-history";

export type Occurrence = {
  analysisId: string;
  createdAt: string;
  startTime: number | null;
  endTime: number | null;
  quality: string | null;
  timing: string | null;
  filename: string | null;
  // Surface routing context so per-occurrence rows can show context
  // chips (e.g. "Strictly · All-Star") without the consumer needing
  // to re-join against AnalysisRecord.
  stage: string | null;
  competitionLevel: string | null;
  eventName: string | null;
};

export type PatternAgg = {
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

/** Collapse whitespace + lowercase so "Sugar Push" and "sugar  push"
 *  aggregate together. We don't touch variant/sub-type — the family-
 *  level roll-up is what the user wants on the dashboard. */
export function normalizePatternName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function titleCasePattern(s: string): string {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function aggregatePatterns(records: AnalysisRecord[]): PatternAgg[] {
  const byName = new Map<string, PatternAgg>();
  for (const r of records) {
    // Skip low-confidence analyses so noisy model output doesn't
    // pollute the pattern stats. Once timeline_locked lands server-
    // side this can switch to that flag (see #109 scope notes).
    if (r.result?.overall?.confidence === "low") continue;
    const patterns = r.result?.patterns_identified ?? [];
    for (const p of patterns) {
      if (!p?.name) continue;
      const key = normalizePatternName(p.name);
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
        stage: r.stage,
        competitionLevel: r.competition_level,
        eventName: r.event_name,
      });
      byName.set(key, existing);
    }
  }
  // Default sort: count desc, then name for determinism. Callers
  // that need a different sort (weakest first, most recent) re-sort
  // after the fact rather than passing a comparator down.
  return Array.from(byName.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
}

export function formatPatternTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatPatternDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
