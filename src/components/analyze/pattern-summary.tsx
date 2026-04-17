"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VideoScoreResult, VideoPatternIdentified } from "@/lib/wcs-api";

const QUALITY_STYLES: Record<
  string,
  { label: string; badge: string; dot: string }
> = {
  strong: {
    label: "strong",
    badge: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
    dot: "bg-emerald-500",
  },
  solid: {
    label: "solid",
    badge: "border-primary/40 text-primary bg-primary/10",
    dot: "bg-primary",
  },
  needs_work: {
    label: "needs work",
    badge: "border-amber-500/40 text-amber-300 bg-amber-500/10",
    dot: "bg-amber-500",
  },
  weak: {
    label: "weak",
    badge: "border-rose-500/40 text-rose-300 bg-rose-500/10",
    dot: "bg-rose-500",
  },
};

const TIMING_LABELS: Record<string, string> = {
  on_beat: "on beat",
  slightly_off: "slightly off",
  off_beat: "off beat",
};

/**
 * Derive a pattern summary from the flat patterns_identified array.
 * Mirrors the backend `_summarize_patterns` helper so analyses
 * stored before the backend started returning `pattern_summary`
 * still get the aggregated pattern card client-side.
 */
export function derivePatternSummary(
  patterns: VideoPatternIdentified[] | undefined
): NonNullable<VideoScoreResult["pattern_summary"]> {
  if (!patterns || patterns.length === 0) return [];
  const counts = new Map<string, number>();
  const displayNames = new Map<string, string>();
  const variants = new Map<string, string | null>();
  const qualities = new Map<string, string[]>();
  const timings = new Map<string, string[]>();
  const notes = new Map<string, string[]>();
  const stylings = new Map<string, string[]>();
  const tips = new Map<string, string[]>();

  for (const p of patterns) {
    const raw = (p.name || "").trim();
    if (!raw) continue;
    const rawVariant = (p.variant || "").trim().toLowerCase();
    // Group "basic" and null together — both mean "plain execution
    // of the family". Distinct non-basic variants get their own
    // bucket ("whip basket" ≠ "whip reverse").
    const variantKeyPart =
      rawVariant === "" || rawVariant === "basic" ? "" : rawVariant;
    const base = raw.toLowerCase().replace(/\s+/g, " ");
    const key = variantKeyPart ? `${base}|${variantKeyPart}` : base;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!displayNames.has(key)) displayNames.set(key, raw);
    if (variantKeyPart && !variants.has(key)) {
      variants.set(key, p.variant ?? variantKeyPart);
    }
    if (p.quality) {
      const list = qualities.get(key) ?? [];
      list.push(p.quality);
      qualities.set(key, list);
    }
    if (p.timing) {
      const list = timings.get(key) ?? [];
      list.push(p.timing);
      timings.set(key, list);
    }
    const note = (p.notes || "").trim();
    if (note) {
      const list = notes.get(key) ?? [];
      if (!list.includes(note)) list.push(note);
      notes.set(key, list);
    }
    const styling = (p.styling || "").trim();
    if (styling) {
      const list = stylings.get(key) ?? [];
      if (!list.includes(styling)) list.push(styling);
      stylings.set(key, list);
    }
    const tip = (p.coaching_tip || "").trim();
    if (tip) {
      const list = tips.get(key) ?? [];
      if (!list.includes(tip)) list.push(tip);
      tips.set(key, list);
    }
  }

  const mostCommon = (items?: string[]): string | null => {
    if (!items || items.length === 0) return null;
    const freq = new Map<string, number>();
    for (const it of items) freq.set(it, (freq.get(it) ?? 0) + 1);
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
  };

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      name: displayNames.get(key)!,
      variant: variants.get(key) ?? null,
      count,
      quality: mostCommon(qualities.get(key)),
      timing: mostCommon(timings.get(key)),
      notes: (notes.get(key) ?? []).slice(0, 3).join(" · ") || null,
      styling: (stylings.get(key) ?? []).slice(0, 2).join(" · ") || null,
      coaching_tip:
        (tips.get(key) ?? []).slice(0, 2).join(" · ") || null,
    }));
}

/**
 * Aggregated pattern card: deduplicated by normalized name with
 * per-pattern count + most-common quality/timing labels. Renders
 * the "9 unique · 30 total" header plus one row per unique
 * pattern. Used on both the authenticated analyze page and the
 * public shared page.
 */
export function PatternSummaryCard({
  summary,
}: {
  summary: NonNullable<VideoScoreResult["pattern_summary"]>;
}) {
  const totalOccurrences = summary.reduce((a, b) => a + b.count, 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Patterns</span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {summary.length} unique · {totalOccurrences} total
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {summary.map((p) => {
            const qStyle =
              (p.quality && QUALITY_STYLES[p.quality]) ||
              QUALITY_STYLES.solid;
            return (
              <li
                key={p.name}
                className="flex items-start gap-3 rounded-md border border-border p-2.5"
              >
                <span
                  className={`mt-1 h-2 w-2 rounded-full shrink-0 ${qStyle.dot}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium text-sm">
                      {p.name}
                      {p.variant && p.variant.toLowerCase() !== "basic" && (
                        <span className="text-muted-foreground font-normal">
                          {" · "}
                          <span className="text-foreground">{p.variant}</span>
                        </span>
                      )}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] tabular-nums px-1.5 py-0 h-4"
                    >
                      {p.count}×
                    </Badge>
                    {p.quality && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 h-4 ${qStyle.badge}`}
                      >
                        {qStyle.label}
                      </Badge>
                    )}
                    {p.timing && (
                      <span className="text-[10px] text-muted-foreground">
                        {TIMING_LABELS[p.timing] ?? p.timing}
                      </span>
                    )}
                  </div>
                  {p.notes && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {p.notes}
                    </p>
                  )}
                  {p.styling && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      <span className="font-medium text-foreground">
                        Styling:
                      </span>{" "}
                      {p.styling}
                    </p>
                  )}
                  {p.coaching_tip && (
                    <p className="text-xs mt-1 text-amber-300">
                      <span className="font-medium">Tip:</span>{" "}
                      {p.coaching_tip}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
