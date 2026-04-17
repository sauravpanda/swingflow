"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Target, Quote } from "lucide-react";
import type { VideoScoreResult } from "@/lib/wcs-api";
import { getLevelContext } from "@/lib/level-context";
import {
  PatternSummaryCard,
  derivePatternSummary,
} from "@/components/analyze/pattern-summary";

const CATEGORY_LABELS: Record<keyof VideoScoreResult["categories"], string> = {
  timing: "Timing & Rhythm",
  technique: "Technique",
  teamwork: "Teamwork",
  presentation: "Presentation",
};

function scoreBarColor(score: number): string {
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-primary";
  if (score >= 4) return "bg-amber-500";
  return "bg-rose-500";
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ScoreBar({
  score,
  scoreLow,
  scoreHigh,
}: {
  score: number;
  scoreLow?: number;
  scoreHigh?: number;
}) {
  const hasRange =
    typeof scoreLow === "number" &&
    typeof scoreHigh === "number" &&
    scoreHigh > scoreLow;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
      {hasRange && (
        <div
          className="absolute inset-y-0 bg-foreground/15"
          style={{
            left: `${Math.max(0, scoreLow! * 10)}%`,
            width: `${Math.min(
              100 - scoreLow! * 10,
              (scoreHigh! - scoreLow!) * 10
            )}%`,
          }}
          title={`Uncertainty range: ${scoreLow!.toFixed(1)}–${scoreHigh!.toFixed(1)}`}
        />
      )}
      <div
        className={`relative h-full ${scoreBarColor(score)} transition-all`}
        style={{ width: `${Math.min(100, score * 10)}%` }}
      />
    </div>
  );
}

function TechniqueBreakdown({
  technique,
}: {
  technique: VideoScoreResult["categories"]["technique"];
}) {
  const subs = [
    { key: "posture", label: "Posture", sub: technique.posture },
    { key: "extension", label: "Extension", sub: technique.extension },
    { key: "footwork", label: "Footwork", sub: technique.footwork },
    { key: "slot", label: "Slot", sub: technique.slot },
  ].filter(
    (
      s
    ): s is { key: string; label: string; sub: { score: number; notes?: string } } =>
      Boolean(s.sub && typeof s.sub.score === "number")
  );
  if (subs.length === 0) return null;
  return (
    <details className="group pt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none inline-flex items-center gap-1">
        <span className="group-open:hidden">Show sub-scores ▾</span>
        <span className="hidden group-open:inline">Hide sub-scores ▴</span>
      </summary>
      <div className="grid grid-cols-2 gap-3 pt-2.5">
        {subs.map(({ key, label, sub }) => (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono tabular-nums">
                {sub.score.toFixed(1)}
              </span>
            </div>
            <ScoreBar score={sub.score} />
          </div>
        ))}
      </div>
    </details>
  );
}

function PartnerPanel({
  label,
  data,
}: {
  label: string;
  data?: { technique_score?: number; presentation_score?: number; notes?: string };
}) {
  if (!data) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        {label}: no per-partner detail
      </div>
    );
  }
  const rows: Array<{ k: string; v?: number }> = [
    { k: "Technique", v: data.technique_score },
    { k: "Presentation", v: data.presentation_score },
  ].filter((r) => typeof r.v === "number");
  return (
    <div className="rounded-md border border-border p-3 space-y-2.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.k} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{r.k}</span>
              <span className="font-mono tabular-nums">
                {(r.v ?? 0).toFixed(1)}
              </span>
            </div>
            <ScoreBar score={r.v ?? 0} />
          </div>
        ))}
      </div>
      {data.notes && (
        <p className="text-xs text-muted-foreground pt-1">{data.notes}</p>
      )}
    </div>
  );
}

function PartnerCards({
  lead,
  follow,
}: {
  lead?: VideoScoreResult["lead"];
  follow?: VideoScoreResult["follow"];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Lead & Follow</CardTitle>
      </CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-4">
        <PartnerPanel label="Lead" data={lead} />
        <PartnerPanel label="Follow" data={follow} />
      </CardContent>
    </Card>
  );
}

/**
 * Full score card: overall hero + category bars + partner cards +
 * pattern summary + strengths + improvements. Used by both the
 * analyze page (fresh-run results) and the dedicated analysis
 * page (viewing a stored analysis). The `onClear` CTA is optional
 * — pass it for the analyze-page flow, omit for the detail page.
 */
export function ScoreResultCard({
  result,
  duration,
  competitionLevel,
  onClear,
  clearLabel = "Analyze another video",
}: {
  result: VideoScoreResult;
  duration: number;
  competitionLevel?: string | null;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const levelContext = getLevelContext(
    result.overall.score,
    competitionLevel
  );
  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-b from-card to-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Score
            </span>
            <span className="text-sm text-muted-foreground font-normal">
              {formatDuration(duration)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl sm:text-7xl font-bold tabular-nums leading-none">
                {result.overall.score.toFixed(1)}
              </span>
              <span className="text-xl sm:text-2xl text-muted-foreground">
                /10
              </span>
            </div>
            {levelContext && (
              <span
                className={`text-xs font-medium ${
                  levelContext.tone === "above"
                    ? "text-emerald-300"
                    : levelContext.tone === "below"
                    ? "text-amber-300"
                    : "text-muted-foreground"
                }`}
                title={`Heuristic tier range for ${levelContext.matchedLevel}. Compares against typical WCS scoring bands, not peer data.`}
              >
                {levelContext.label}
              </span>
            )}
            {(() => {
              const declared = (competitionLevel || "").trim().toLowerCase();
              const observed = (result.observed_level || "").trim();
              if (!observed) return null;
              if (declared && observed.toLowerCase() === declared)
                return null;
              if (!declared) {
                return (
                  <span className="text-xs text-muted-foreground">
                    Scored as{" "}
                    <span className="font-medium text-foreground">
                      {observed}
                    </span>
                  </span>
                );
              }
              return (
                <span className="text-xs text-muted-foreground">
                  Scored as{" "}
                  <span className="font-medium text-emerald-300">
                    {observed}
                  </span>
                  {" · Declared "}
                  <span className="font-medium">{competitionLevel}</span>
                </span>
              );
            })()}
            <div className="flex items-center gap-2">
              <Badge className="text-sm px-3 py-0.5">
                {result.overall.grade}
              </Badge>
              {result.overall.confidence === "low" && (
                <Badge variant="outline" className="text-xs">
                  low confidence
                </Badge>
              )}
              {result.sanity_warnings &&
                result.sanity_warnings.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs border-amber-500/40 text-amber-300"
                    title={result.sanity_warnings.join("\n")}
                  >
                    plausibility warnings (
                    {result.sanity_warnings.length})
                  </Badge>
                )}
            </div>
            {result.overall.impression && (
              <p className="text-sm text-muted-foreground italic text-center max-w-lg pt-2">
                <Quote className="inline h-3 w-3 mr-1 -mt-0.5 opacity-50" />
                {result.overall.impression}
              </p>
            )}
          </div>

          <div className="space-y-4 pt-2 border-t border-border">
            {(
              Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>
            ).map((key) => {
              const cat = result.categories[key];
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {CATEGORY_LABELS[key]}
                    </span>
                    <span className="font-mono tabular-nums text-right">
                      {cat.score.toFixed(1)} / 10
                      {typeof cat.score_low === "number" &&
                        typeof cat.score_high === "number" &&
                        cat.score_high > cat.score_low && (
                          <span className="block text-[10px] text-muted-foreground font-normal">
                            [{cat.score_low.toFixed(1)}–
                            {cat.score_high.toFixed(1)}]
                          </span>
                        )}
                    </span>
                  </div>
                  <ScoreBar
                    score={cat.score}
                    scoreLow={cat.score_low}
                    scoreHigh={cat.score_high}
                  />
                  {cat.notes && (
                    <p className="text-xs text-muted-foreground pt-0.5">
                      {cat.notes}
                    </p>
                  )}
                  {key === "technique" && (
                    <TechniqueBreakdown technique={cat} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {(result.lead || result.follow) && (
        <PartnerCards lead={result.lead} follow={result.follow} />
      )}

      {(() => {
        const summary =
          result.pattern_summary && result.pattern_summary.length > 0
            ? result.pattern_summary
            : derivePatternSummary(result.patterns_identified);
        return summary.length > 0 ? (
          <PatternSummaryCard summary={summary} />
        ) : null;
      })()}

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

      {onClear && (
        <Button onClick={onClear} variant="outline" className="w-full">
          {clearLabel}
        </Button>
      )}
    </div>
  );
}
