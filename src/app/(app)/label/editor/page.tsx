"use client";

// Label editor — scrub through a video and build a corrected pattern
// timeline. Pre-populates from the AI's `patterns_identified` so the
// user is correcting, not starting from zero.
//
// Kept deliberately simple: a table-style list of pattern blocks,
// click a row to edit, plus a "Save" per row. The timeline renders
// below so the user can see the blocks visually but editing happens
// in the table to keep form focus stable.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Plus,
  Check,
  Trash2,
  Edit2,
  Loader2,
  AlertCircle,
  Tags,
  Sparkles,
  Play,
} from "lucide-react";
import { useAnalysisHistory } from "@/hooks/use-analysis-history";
import { BeatPanel } from "@/components/analyze/beat-panel";
import {
  usePatternLabels,
  type PatternLabel,
  type LabelSource,
  type PatternLabelDraft,
} from "@/hooks/use-pattern-labels";
import {
  PATTERN_FAMILIES,
  PATTERN_COUNTS,
  CUSTOM_FAMILY_SENTINEL,
  isKnownFamily,
  normalizePatternName,
  variantsFor,
  type PatternFamily,
} from "@/lib/pattern-vocabulary";
import { getViewUrl } from "@/lib/wcs-api";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

export default function LabelEditorPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <LabelEditorInner />
    </Suspense>
  );
}

function LabelEditorInner() {
  const params = useSearchParams();
  const analysisId = params.get("id");
  const history = useAnalysisHistory();
  const { labels, loading: labelsLoading, add, update, remove } =
    usePatternLabels(analysisId);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Seek the video when the user clicks a position on the beat map.
  const seekVideo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t);
  }, []);

  // Play just one segment of the video (e.g. the range of a single
  // AI-predicted pattern) so the user can see it isolated while
  // deciding how to label it. Scheduled pause on the next tick so we
  // don't fight React's render cycle; a single-fire "pause when we
  // pass end_time" is attached via ontimeupdate.
  const [segmentEnd, setSegmentEnd] = useState<number | null>(null);
  const playSegment = useCallback(
    (start: number, end: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, start);
      setSegmentEnd(end);
      // Defer play one tick so currentTime takes effect. Catches the
      // rare autoplay-blocked error so we don't crash on strict
      // browsers.
      v.play().catch(() => {});
    },
    []
  );
  // Auto-pause when we reach the segment's end time. One-shot — the
  // useEffect clears segmentEnd after firing.
  useEffect(() => {
    if (segmentEnd == null) return;
    const v = videoRef.current;
    if (!v) return;
    if (currentTime >= segmentEnd - 0.05) {
      v.pause();
      setSegmentEnd(null);
    }
  }, [currentTime, segmentEnd]);

  const record = useMemo(
    () =>
      analysisId ? history.records.find((r) => r.id === analysisId) : null,
    [history.records, analysisId]
  );

  // Load a playable URL for the video. Mirrors the analysis page.
  useEffect(() => {
    if (!record?.object_key) return;
    let cancelled = false;
    (async () => {
      try {
        const url = await getViewUrl(record.object_key!);
        if (!cancelled) setVideoUrl(url);
      } catch (e) {
        if (!cancelled) {
          setVideoError(e instanceof Error ? e.message : "Failed to load video");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [record?.object_key]);

  // AI-predicted patterns we can accept/edit. Only show ones inside
  // the dance window when it's available.
  const aiPatterns = useMemo(() => {
    if (!record?.result?.patterns_identified) return [];
    return record.result.patterns_identified.filter(
      (p) => (p.start_time ?? 0) >= 0
    );
  }, [record]);

  // Off-beat moments from the AI's timing analysis, parsed to numeric
  // seconds for the BeatPanel's red markers.
  const offBeats = useMemo(() => {
    const raw = record?.result?.categories?.timing?.off_beat_moments ?? [];
    const out: Array<{ t: number; description?: string; beat_count?: string }> = [];
    for (const m of raw) {
      const ts = m.timestamp_approx?.trim();
      if (!ts) continue;
      // "0:23" / "0:23.5" / "23s" / "23.5"
      let n: number | null = null;
      if (ts.includes(":")) {
        const parts = ts.split(":").map((p) => parseFloat(p));
        if (parts.every((p) => Number.isFinite(p))) {
          n =
            parts.length === 2
              ? parts[0] * 60 + parts[1]
              : parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      } else {
        const x = parseFloat(ts.replace(/s$/, ""));
        n = Number.isFinite(x) ? x : null;
      }
      if (n == null) continue;
      out.push({ t: n, description: m.description, beat_count: m.beat_count });
    }
    return out;
  }, [record]);

  const effectiveDuration =
    videoDuration > 0
      ? videoDuration
      : record?.duration && record.duration > 0
        ? record.duration
        : 0;

  // Match AI patterns to existing labels — if the user has already
  // accepted/edited an AI block, we know not to show it as pending.
  const acceptedWindows = useMemo(() => {
    const out = new Set<string>();
    for (const l of labels) {
      if (l.source === "ai_accepted" || l.source === "ai_edited") {
        out.add(`${l.start_time.toFixed(2)}-${l.end_time.toFixed(2)}`);
      }
    }
    return out;
  }, [labels]);

  const pendingAi = useMemo(() => {
    return aiPatterns.filter((p) => {
      const s = (p.start_time ?? 0).toFixed(2);
      const e = (p.end_time ?? p.start_time ?? 0).toFixed(2);
      return !acceptedWindows.has(`${s}-${e}`);
    });
  }, [aiPatterns, acceptedWindows]);

  const handleAcceptAi = useCallback(
    async (idx: number) => {
      const p = aiPatterns[idx];
      if (!p) return;
      const start = p.start_time ?? 0;
      const end = p.end_time ?? start + 3;
      const normalized = normalizePatternName(p.name);
      try {
        setBusyId(`ai-${idx}`);
        await add({
          analysis_id: analysisId!,
          start_time: start,
          end_time: end,
          name: normalized ?? (p.name ?? "unknown"),
          variant: p.variant ?? null,
          count: inferCount(normalized ?? p.name),
          confidence: null,
          source: "ai_accepted",
          notes: null,
        });
      } catch (e) {
        alert(e instanceof Error ? e.message : "Save failed");
      } finally {
        setBusyId(null);
      }
    },
    [add, aiPatterns, analysisId]
  );

  const handleEditAi = useCallback(
    (idx: number) => {
      const p = aiPatterns[idx];
      if (!p) return;
      const normalized = normalizePatternName(p.name);
      setEditing({
        mode: "new_from_ai",
        start_time: p.start_time ?? 0,
        end_time: p.end_time ?? (p.start_time ?? 0) + 3,
        name: normalized ?? "",
        variant: p.variant ?? "basic",
        count: inferCount(normalized ?? p.name) ?? 6,
        notes: p.notes ?? "",
      });
    },
    [aiPatterns]
  );

  const handleAddAtPlayhead = useCallback(() => {
    setEditing({
      mode: "new",
      start_time: Math.max(0, currentTime - 1.5),
      end_time: currentTime + 1.5,
      name: "",
      variant: "basic",
      count: 6,
      notes: "",
    });
  }, [currentTime]);

  const handleEditExisting = useCallback((l: PatternLabel) => {
    setEditing({
      mode: "edit",
      id: l.id,
      start_time: l.start_time,
      end_time: l.end_time,
      name: l.name,
      variant: l.variant ?? "basic",
      count: l.count ?? 6,
      notes: l.notes ?? "",
      originalSource: l.source,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editing || !analysisId) return;
    const draft: PatternLabelDraft = {
      analysis_id: analysisId,
      start_time: editing.start_time,
      end_time: editing.end_time,
      name: editing.name,
      variant:
        editing.variant && editing.variant !== "basic" ? editing.variant : null,
      count: editing.count ?? null,
      confidence: null,
      source:
        editing.mode === "new_from_ai"
          ? "ai_edited"
          : editing.mode === "edit" && editing.originalSource === "ai_accepted"
            ? "ai_edited"
            : editing.mode === "edit"
              ? (editing.originalSource as LabelSource)
              : "user",
      notes: editing.notes?.trim() || null,
    };
    try {
      if (editing.mode === "edit" && editing.id) {
        await update(editing.id, draft);
      } else {
        await add(draft);
      }
      setEditing(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    }
  }, [editing, analysisId, add, update]);

  if (!analysisId) {
    return (
      <div className="max-w-lg">
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <AlertCircle className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-sm">No analysis selected.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/label">Back to list</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (history.loading) {
    return <p className="text-sm text-muted-foreground">Loading analysis…</p>;
  }

  if (!record) {
    return (
      <div className="max-w-lg">
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <AlertCircle className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-sm">
              Analysis not found. It may have been deleted.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/label">Back to list</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <Button asChild variant="ghost" size="sm">
          <Link href="/label">
            <ArrowLeft className="h-4 w-4 mr-1" />
            All analyses
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Tags className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold truncate">
              {record.filename ?? "Labeling"}
            </h1>
            <Badge variant="outline" className="text-[10px]">
              {labels.length} labeled
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {pendingAi.length} AI pending
            </Badge>
          </div>
        </div>
        <Button size="sm" onClick={handleAddAtPlayhead}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add at {formatTime(currentTime)}
        </Button>
      </header>

      {videoError ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Couldn&rsquo;t load video: {videoError}. You can still label
            by entering timestamps manually.
          </CardContent>
        </Card>
      ) : videoUrl ? (
        <Card>
          <CardContent className="p-0 overflow-hidden">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              className="w-full bg-black max-h-[60vh]"
              onTimeUpdate={(e) =>
                setCurrentTime((e.target as HTMLVideoElement).currentTime)
              }
              onLoadedMetadata={(e) =>
                setVideoDuration(
                  (e.target as HTMLVideoElement).duration || 0
                )
              }
            />
          </CardContent>
        </Card>
      ) : !record.object_key ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No source video stored for this analysis. Labels only — enter
            timestamps manually based on memory or external playback.
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Loading video…</p>
      )}

      {/* Beat map — easier to see if a labeled window aligns with
          the music's beat / phrase structure. Click to seek the video
          to that spot. */}
      {effectiveDuration > 0 && (
        <Card>
          <CardContent className="py-3">
            <BeatPanel
              grid={record.result?.beat_grid}
              offBeats={offBeats}
              effectiveDuration={effectiveDuration}
              currentTime={currentTime}
              playbackRate={1}
              onSeek={seekVideo}
            />
          </CardContent>
        </Card>
      )}

      {/* AI suggestions — pending blocks the user hasn't accepted/edited yet. */}
      {pendingAi.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI-predicted patterns ({pendingAi.length} pending review)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {aiPatterns.map((p, idx) => {
              const s = (p.start_time ?? 0).toFixed(2);
              const e = (p.end_time ?? p.start_time ?? 0).toFixed(2);
              const isAccepted = acceptedWindows.has(`${s}-${e}`);
              if (isAccepted) return null;
              const startSec = p.start_time ?? 0;
              const endSec = p.end_time ?? startSec;
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => playSegment(startSec, endSec)}
                  role="button"
                  tabIndex={0}
                  title="Click to play just this segment"
                >
                  <Play className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs tabular-nums text-muted-foreground w-24 shrink-0">
                    {formatTime(startSec)}–{formatTime(endSec)}
                  </span>
                  <span className="text-sm truncate flex-1 min-w-[120px]">
                    <span className="font-medium">{p.name}</span>
                    {p.variant && p.variant !== "basic" && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.variant}
                      </span>
                    )}
                  </span>
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => handleEditAi(idx)}
                    >
                      <Edit2 className="h-3 w-3 mr-1" />
                      Fix
                    </Button>
                    <Button
                      size="sm"
                      className="h-7"
                      onClick={() => handleAcceptAi(idx)}
                      disabled={busyId === `ai-${idx}`}
                    >
                      {busyId === `ai-${idx}` ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3 mr-1" />
                      )}
                      Accept
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* User labels */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Your labels ({labels.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {labelsLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : labels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None yet. Accept an AI block above or click
              &ldquo;Add at {formatTime(currentTime)}&rdquo;.
            </p>
          ) : (
            labels.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-border/60 hover:bg-muted/10 transition-colors cursor-pointer"
                onClick={() => playSegment(l.start_time, l.end_time)}
                role="button"
                tabIndex={0}
                title="Click to play just this segment"
              >
                <Play className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs tabular-nums text-muted-foreground w-24 shrink-0">
                  {formatTime(l.start_time)}–{formatTime(l.end_time)}
                </span>
                <span className="text-sm truncate flex-1 min-w-[120px]">
                  <span className="font-medium">{l.name}</span>
                  {l.variant && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {l.variant}
                    </span>
                  )}
                  {l.count && (
                    <span className="text-muted-foreground text-[10px] ml-1">
                      ({l.count}-ct)
                    </span>
                  )}
                </span>
                <Badge
                  variant="outline"
                  className={
                    "text-[10px] " +
                    (l.source === "user"
                      ? "border-primary/40 text-primary"
                      : l.source === "ai_accepted"
                        ? "border-emerald-500/40 text-emerald-400"
                        : "border-amber-500/40 text-amber-400")
                  }
                >
                  {l.source === "user"
                    ? "you"
                    : l.source === "ai_accepted"
                      ? "ai ✓"
                      : "ai ✎"}
                </Badge>
                <div
                  className="flex items-center gap-1.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => handleEditExisting(l)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-destructive hover:text-destructive"
                    onClick={async () => {
                      if (!confirm("Delete this label?")) return;
                      try {
                        await remove(l.id);
                      } catch (e) {
                        alert(
                          e instanceof Error ? e.message : "Delete failed"
                        );
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditLabelDialog
          state={editing}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

type EditingState = {
  mode: "new" | "new_from_ai" | "edit";
  id?: string;
  start_time: number;
  end_time: number;
  name: string;
  variant: string;
  count: number | null;
  notes: string;
  originalSource?: LabelSource;
};

function EditLabelDialog({
  state,
  onChange,
  onSave,
  onCancel,
}: {
  state: EditingState;
  onChange: (s: EditingState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const groupedFamilies = useMemo(() => {
    const groups: Record<string, PatternFamily[]> = {};
    for (const f of PATTERN_FAMILIES) {
      (groups[f.group] = groups[f.group] ?? []).push(f);
    }
    return groups;
  }, []);

  const availableVariants = useMemo(
    () => (state.name ? variantsFor(state.name) : []),
    [state.name]
  );

  const canSave =
    state.name.trim().length > 0 && state.end_time > state.start_time;

  // True when the editor is in custom-pattern mode: either the user
  // just picked "Other" (state.name === "") or the existing label was
  // saved with a non-canonical name we don't recognize. Custom mode
  // hides the variant dropdown (variants are family-scoped and don't
  // make sense for ad-hoc labels) and shows a free-text input.
  const isCustom = !isKnownFamily(state.name);

  const handleFamilyChange = (id: string) => {
    if (id === CUSTOM_FAMILY_SENTINEL) {
      // Drop into custom mode with a fresh empty name. The text input
      // below will collect what the user actually wants to call it.
      onChange({ ...state, name: "", variant: "" });
      return;
    }
    const fam = PATTERN_FAMILIES.find((f) => f.id === id);
    onChange({
      ...state,
      name: id,
      variant: "basic",
      count: fam?.defaultCount ?? state.count,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {state.mode === "edit" ? "Edit label" : "New label"}
          </DialogTitle>
          <DialogDescription>
            Pick the pattern that was actually danced in this window.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start">Start (sec)</Label>
              <Input
                id="start"
                type="number"
                step="0.1"
                min={0}
                value={state.start_time}
                onChange={(e) =>
                  onChange({
                    ...state,
                    start_time: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">End (sec)</Label>
              <Input
                id="end"
                type="number"
                step="0.1"
                min={0}
                value={state.end_time}
                onChange={(e) =>
                  onChange({
                    ...state,
                    end_time: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Pattern family</Label>
            <Select
              value={isCustom ? CUSTOM_FAMILY_SENTINEL : state.name}
              onValueChange={handleFamilyChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a pattern" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(groupedFamilies).map(([group, families]) => (
                  <SelectGroup key={group}>
                    <SelectLabel className="text-[10px] uppercase tracking-wide">
                      {group}
                    </SelectLabel>
                    {families.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wide">
                    custom
                  </SelectLabel>
                  <SelectItem value={CUSTOM_FAMILY_SENTINEL}>
                    Other (type your own)
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {isCustom && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-name">Pattern name</Label>
              <Input
                id="custom-name"
                value={state.name}
                onChange={(e) => onChange({ ...state, name: e.target.value })}
                placeholder="e.g. sugar push + tuck combo"
                maxLength={120}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Use this for conjoined patterns or moves not in the dropdown.
              </p>
            </div>
          )}

          {!isCustom && availableVariants.length > 1 && (
            <div className="space-y-1.5">
              <Label>Variant</Label>
              <Select
                value={state.variant}
                onValueChange={(v) => onChange({ ...state, variant: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableVariants.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Count</Label>
            <Select
              value={String(state.count ?? "")}
              onValueChange={(v) =>
                onChange({ ...state, count: v ? parseInt(v, 10) : null })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="6, 8, or longer" />
              </SelectTrigger>
              <SelectContent>
                {PATTERN_COUNTS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}-count
                    {n > 8 ? " (conjoined)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <textarea
              id="notes"
              rows={2}
              value={state.notes}
              onChange={(e) => onChange({ ...state, notes: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Anything worth remembering later"
              maxLength={400}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!canSave}>
            Save label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function inferCount(
  name: string | null | undefined
): number | null {
  if (!name) return null;
  const f = PATTERN_FAMILIES.find((x) => x.id === name);
  return f?.defaultCount ?? null;
}
