"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Video,
  Upload,
  Loader2,
  Sparkles,
  X,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
  Trash2,
  Target,
  Quote,
  Share2,
  Link2Off,
  Copy,
  Eye,
} from "lucide-react";
import { useVideoAnalysis } from "@/hooks/use-video-analysis";
import { useAnalysisHistory, type AnalysisRecord } from "@/hooks/use-analysis-history";
import { getLevelContext } from "@/lib/level-context";
import {
  analyzeVideoFromKey,
  deleteUploadedVideo,
  getViewUrl,
  type VideoScoreResult,
} from "@/lib/wcs-api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimelineView } from "@/components/analyze/timeline-view";
import {
  PatternSummaryCard,
  derivePatternSummary,
} from "@/components/analyze/pattern-summary";
import { Analytics } from "@/lib/analytics";

const ROLE_OPTIONS = ["Lead", "Follow", "Solo"] as const;
const LEVEL_OPTIONS = [
  "Newcomer",
  "Novice",
  "Intermediate",
  "Advanced",
  "All-Star",
  "Champion",
  "Invitational",
] as const;
const STAGE_OPTIONS = [
  "Prelims",
  "Quarterfinals",
  "Semifinals",
  "Finals",
  "Social",
  "Practice",
  "Showcase",
] as const;
const OTHER = "__other__";

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

// derivePatternSummary moved to
// src/components/analyze/pattern-summary.tsx

function ScoreBar({
  score,
  scoreLow,
  scoreHigh,
}: {
  score: number;
  scoreLow?: number;
  scoreHigh?: number;
}) {
  // If Gemini returned an uncertainty range, render it as a faint band
  // behind the actual-score fill. Range [low, high] maps to [low*10%,
  // high*10%] horizontally. Only render when the interval has width.
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AnalyzePage() {
  const {
    state,
    quota,
    quotaLoading,
    quotaError,
    analyze,
    reset,
    refreshQuota,
    isConfigured,
  } = useVideoAnalysis();
  const history = useAnalysisHistory();

  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Deep-link: dashboard / chart pass `?id=<analysis-uuid>` to jump
  // straight to a specific analysis. Also handles the "accidentally
  // refreshed mid-analysis" case: if the most recent history row was
  // created in the last ~60s, treat it as a deep-link target so the
  // user sees the result instead of an empty upload card.
  const [targetAnalysisId, setTargetAnalysisId] = useState<string | null>(
    null
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) setTargetAnalysisId(id);
  }, []);

  // Auto-surface a just-completed analysis after an accidental
  // refresh. Only fires when (a) there's no explicit ?id= in the URL,
  // (b) the most recent history row is <60s old, and (c) we haven't
  // already set a target. History is the source of truth — the
  // backend finishes and persists even if the browser disconnects.
  useEffect(() => {
    if (targetAnalysisId) return;
    if (history.loading) return;
    if (history.records.length === 0) return;
    const mostRecent = history.records[0];
    const ageMs = Date.now() - new Date(mostRecent.created_at).getTime();
    if (ageMs < 60_000) {
      setTargetAnalysisId(mostRecent.id);
    }
  }, [history.loading, history.records, targetAnalysisId]);

  // Warn the user before they navigate away / refresh while an
  // analysis is in flight. Upload is cheap to repeat; an analysis
  // in progress is not (a used quota + lost-looking result from the
  // user's perspective), so the browser prompt is worth the
  // friction here.
  useEffect(() => {
    if (state.status !== "uploading" && state.status !== "analyzing") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Most modern browsers ignore the message and show a generic
      // prompt, but returnValue needs to be set for the prompt to
      // appear in Chrome/Firefox.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.status]);

  // Optional metadata — captured pre-upload so it gets saved with the analysis.
  // Each of role / level / stage can be a preset OR free text via "Other".
  const [roleSelect, setRoleSelect] = useState("");
  const [roleCustom, setRoleCustom] = useState("");
  const [levelSelect, setLevelSelect] = useState("");
  const [levelCustom, setLevelCustom] = useState("");
  const [stageSelect, setStageSelect] = useState("");
  const [stageCustom, setStageCustom] = useState("");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [dancerDescription, setDancerDescription] = useState("");
  // Default off — videos get deleted from R2 right after scoring
  // for privacy. Turning it on keeps the clip so the user can
  // replay it against the pattern timeline later.
  const [storeVideo, setStoreVideo] = useState(false);

  const role =
    roleSelect === OTHER ? roleCustom.trim() : roleSelect.trim();
  const competitionLevel =
    levelSelect === OTHER ? levelCustom.trim() : levelSelect.trim();
  const stage =
    stageSelect === OTHER ? stageCustom.trim() : stageSelect.trim();

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalError(null);
      reset();
      const f = e.target.files?.[0];
      if (!f) return;

      if (!f.type.startsWith("video/")) {
        setLocalError("Please choose a video file (mp4, mov, etc.)");
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      const MAX_SIZE_MB = 500;
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        setLocalError(
          `File is ${(f.size / 1024 / 1024).toFixed(0)} MB, limit is ${MAX_SIZE_MB} MB. Try trimming the clip.`
        );
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      // Client-side duration check (saves a wasted upload).
      if (quota) {
        try {
          const dur = await probeDuration(f);
          if (dur > quota.max_seconds) {
            setLocalError(
              `Video is ${Math.round(dur)}s, your ${quota.plan} plan allows up to ${
                quota.max_seconds
              }s.`
            );
            if (inputRef.current) inputRef.current.value = "";
            return;
          }
        } catch {
          // If we can't probe locally, let the server enforce.
        }
      }

      setFile(f);
    },
    [quota, reset]
  );

  const handleAnalyze = useCallback(() => {
    if (!file) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    // <input type="month"> gives us "YYYY-MM"; Postgres date column wants
    // "YYYY-MM-DD" so we pin to the first of the month.
    const normalizedDate = eventDate
      ? `${eventDate}-01`
      : undefined;
    const focus = dancerDescription.trim().slice(0, 200);
    analyze(file, {
      role: role || undefined,
      competitionLevel: competitionLevel || undefined,
      eventName: eventName.trim() || undefined,
      eventDate: normalizedDate,
      stage: stage || undefined,
      tags: tags.length ? tags : undefined,
      dancerDescription: focus || undefined,
      storeVideo,
    }).then(() => history.refresh());
  }, [
    file,
    analyze,
    history,
    role,
    competitionLevel,
    eventName,
    eventDate,
    stage,
    tagsInput,
    dancerDescription,
    storeVideo,
  ]);

  const handleClear = useCallback(() => {
    setFile(null);
    setLocalError(null);
    reset();
    if (inputRef.current) inputRef.current.value = "";
  }, [reset]);

  const isLoading =
    state.status === "uploading" || state.status === "analyzing";
  const isPaywalled = quota && quota.remaining <= 0;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <Video className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Dance Video Analysis</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Upload a clip to get WSDC-style scoring and feedback
        </p>
      </div>

      {/* Quota card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Monthly usage</span>
            {quota && (
              <Badge variant={quota.plan === "basic" ? "default" : "secondary"}>
                {quota.plan === "basic" ? "Basic" : "Free"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {quotaLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : quotaError ? (
            <p className="text-sm text-destructive">{quotaError}</p>
          ) : quota ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span>
                  {quota.used} of {quota.limit} videos used
                </span>
                <span className="text-muted-foreground">
                  up to {Math.round(quota.max_seconds / 60)} min each
                </span>
              </div>
              <Progress
                value={Math.min(100, (quota.used / quota.limit) * 100)}
                className="h-2"
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Paywall — hide when showing a fresh result so the score owns the hero slot */}
      {isPaywalled && state.status !== "success" && (
        <Card className="border-primary/40">
          <CardContent className="py-6 space-y-3 text-center">
            <Sparkles className="h-8 w-8 text-primary mx-auto" />
            <h2 className="text-lg font-semibold">Monthly limit reached</h2>
            <p className="text-sm text-muted-foreground">
              Upgrade to Basic for 10 videos / month and 5-minute clips.
            </p>
            <Link href="/billing" onClick={() => Analytics.upgradeClicked({ source: "/analyze-paywall" })}>
              <Button className="w-full">Upgrade to Basic — $10/mo</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* How scoring works — quietly collapsed by default so it
          doesn't dominate the page, but always accessible for users
          wondering what their score is based on. */}
      {state.status !== "success" && <HowScoringWorksInfo />}

      {/* Uploader */}
      {!isPaywalled && state.status !== "success" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload a clip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isConfigured && (
              <p className="text-sm text-destructive">
                Cloud API not configured — set{" "}
                <code className="text-xs">NEXT_PUBLIC_WCS_API_URL</code>.
              </p>
            )}

            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleFileChange}
              disabled={isLoading}
            />

            {!file ? (
              <Button
                variant="outline"
                className="w-full h-20"
                onClick={() => inputRef.current?.click()}
                disabled={!isConfigured || isLoading}
              >
                <Upload className="mr-2 h-5 w-5" />
                Choose video
              </Button>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="text-sm min-w-0 flex-1">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClear}
                  disabled={isLoading}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {localError && (
              <p className="text-sm text-destructive">{localError}</p>
            )}

            {file && state.status === "idle" && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Optional tags (saved with the analysis)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <SelectWithOther
                    id="role"
                    label="Role"
                    options={ROLE_OPTIONS}
                    select={roleSelect}
                    setSelect={setRoleSelect}
                    custom={roleCustom}
                    setCustom={setRoleCustom}
                    customPlaceholder="e.g. both, shadow…"
                  />
                  <SelectWithOther
                    id="level"
                    label="Level"
                    options={LEVEL_OPTIONS}
                    select={levelSelect}
                    setSelect={setLevelSelect}
                    custom={levelCustom}
                    setCustom={setLevelCustom}
                    customPlaceholder="e.g. Open, Rising Star…"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label htmlFor="event" className="text-xs">
                      Event
                    </Label>
                    <Input
                      id="event"
                      placeholder="Boogie by the Bay"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="event-date" className="text-xs">
                      Event month
                    </Label>
                    <Input
                      id="event-date"
                      type="month"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                <SelectWithOther
                  id="stage"
                  label="Stage"
                  options={STAGE_OPTIONS}
                  select={stageSelect}
                  setSelect={setStageSelect}
                  custom={stageCustom}
                  setCustom={setStageCustom}
                  customPlaceholder="e.g. Open Finals, Jack & Jill Invitational…"
                />

                <div className="space-y-1">
                  <Label htmlFor="tags" className="text-xs">
                    Tags
                  </Label>
                  <Input
                    id="tags"
                    placeholder="strictly-swing, showcase, 2026 (comma separated)"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="dancer-focus" className="text-xs">
                    Focus on
                    <span className="ml-1 text-muted-foreground font-normal">
                      (if multiple people in frame)
                    </span>
                  </Label>
                  <Input
                    id="dancer-focus"
                    placeholder="e.g. lead with floral jacket and bib number 433"
                    value={dancerDescription}
                    onChange={(e) =>
                      setDancerDescription(e.target.value.slice(0, 200))
                    }
                    maxLength={200}
                    className="h-8 text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground tabular-nums text-right">
                    {dancerDescription.length}/200
                  </p>
                </div>

                <label
                  htmlFor="store-video"
                  className="flex items-start gap-2 cursor-pointer rounded-md border border-border p-2.5 hover:border-primary/40 transition-colors"
                >
                  <input
                    id="store-video"
                    type="checkbox"
                    checked={storeVideo}
                    onChange={(e) => setStoreVideo(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                  />
                  <span className="text-xs space-y-0.5">
                    <span className="block font-medium">
                      Keep video stored
                    </span>
                    <span className="block text-muted-foreground">
                      Replay the clip later mapped against the pattern
                      timeline + off-beat markers. Off by default — clips
                      are deleted right after scoring. You can delete a
                      stored video any time.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {file && (
              <>
                {state.status === "uploading" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Uploading to storage…</span>
                      <span className="font-mono tabular-nums">
                        {state.uploadProgress}%
                      </span>
                    </div>
                    <Progress value={state.uploadProgress} className="h-1.5" />
                  </div>
                )}
                <Button
                  onClick={handleAnalyze}
                  disabled={isLoading}
                  className="w-full"
                >
                  {state.status === "uploading" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading… {state.uploadProgress}%
                    </>
                  ) : state.status === "analyzing" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing… (~30-60s)
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Analyze video
                    </>
                  )}
                </Button>
              </>
            )}

            {state.status === "error" && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {state.status === "success" && state.result && (
        <>
          <ScoreResultCard
            result={state.result.result}
            duration={state.result.duration}
            competitionLevel={competitionLevel || undefined}
            onClear={handleClear}
          />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pattern timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <TimelineView
                result={state.result.result}
                duration={state.result.duration}
              />
            </CardContent>
          </Card>
          {/* Paywall pushed below the result when both are present */}
          {isPaywalled && (
            <Card className="border-primary/40">
              <CardContent className="py-5 text-center space-y-2">
                <p className="text-sm">
                  <Sparkles className="h-4 w-4 text-primary inline-block mr-1.5 -mt-0.5" />
                  That was your free analysis for the month. Upgrade for 10
                  per month and 5-minute clips.
                </p>
                <Link href="/billing">
                  <Button size="sm" className="mt-1">
                    Upgrade to Basic — $10/mo
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Past analyses */}
      {history.records.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Past analyses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.records.map((rec) => (
              <HistoryRow
                key={rec.id}
                record={rec}
                autoExpand={rec.id === targetAnalysisId}
                onReanalyzed={history.refresh}
                onDeleted={history.remove}
                onShare={history.enableSharing}
                onStopShare={history.disableSharing}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HistoryRow({
  record,
  autoExpand,
  onReanalyzed,
  onDeleted,
  onShare,
  onStopShare,
}: {
  record: AnalysisRecord;
  autoExpand?: boolean;
  onReanalyzed: () => void;
  onDeleted: (id: string) => Promise<void> | void;
  onShare: (id: string) => Promise<string>;
  onStopShare: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(Boolean(autoExpand));
  const rowRef = useRef<HTMLDivElement>(null);

  // When a deep-link targets this row (e.g. arriving from /dashboard
  // with ?id=<uuid>), expand AND scroll the row into view so the
  // user actually lands on the analysis they clicked. autoExpand is
  // computed from the URL param in the parent, so it only fires
  // once for the targeted row.
  useEffect(() => {
    if (!autoExpand) return;
    setExpanded(true);
    // Defer one tick so the expanded body mounts before scrolling.
    const t = setTimeout(() => {
      rowRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
    return () => clearTimeout(t);
  }, [autoExpand]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);
  const [deletingAnalysis, setDeletingAnalysis] = useState(false);
  const [videoDeleted, setVideoDeleted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<
    VideoScoreResult | null
  >(record.result ?? null);
  const [rowError, setRowError] = useState<string | null>(null);
  const overall = currentResult?.overall;

  const canViewOrReanalyze = Boolean(record.object_key) && !videoDeleted;
  const shareUrl =
    record.share_token && typeof window !== "undefined"
      ? `${window.location.origin}/shared?t=${record.share_token}`
      : null;

  const handleWatch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!record.object_key || videoUrl) {
      setExpanded(true);
      return;
    }
    setLoadingVideo(true);
    setRowError(null);
    try {
      const url = await getViewUrl(record.object_key);
      setVideoUrl(url);
      setExpanded(true);
    } catch (err) {
      setRowError(
        err instanceof Error ? err.message : "Could not load video"
      );
    } finally {
      setLoadingVideo(false);
    }
  };

  const handleReanalyze = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!record.object_key) return;
    setReanalyzing(true);
    setRowError(null);
    try {
      const resp = await analyzeVideoFromKey(
        record.object_key,
        record.filename ?? "video.mp4"
      );
      Analytics.analysisReanalyzed();
      setCurrentResult(resp.result);
      setExpanded(true);
      onReanalyzed();
    } catch (err) {
      setRowError(
        err instanceof Error ? err.message : "Re-analysis failed"
      );
    } finally {
      setReanalyzing(false);
    }
  };

  const handleDeleteVideo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!record.object_key) return;
    const ok = window.confirm(
      "Delete the source video from storage? Your scoring result stays — only the video file is removed. This cannot be undone."
    );
    if (!ok) return;
    setDeletingVideo(true);
    setRowError(null);
    try {
      await deleteUploadedVideo(record.object_key);
      setVideoDeleted(true);
      setVideoUrl(null);
      onReanalyzed();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingVideo(false);
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSharing(true);
    setShareMessage(null);
    setRowError(null);
    try {
      const token = await onShare(record.id);
      Analytics.shareLinkCreated();
      const url = `${window.location.origin}/shared?t=${token}`;
      try {
        await navigator.clipboard.writeText(url);
        setShareMessage("Link copied to clipboard");
      } catch {
        setShareMessage(url);
      }
      setTimeout(() => setShareMessage(null), 5000);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Share failed");
    } finally {
      setSharing(false);
    }
  };

  const handleCopyShareLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage("Link copied to clipboard");
      setTimeout(() => setShareMessage(null), 3000);
    } catch {
      setShareMessage(shareUrl);
    }
  };

  const handleStopShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = window.confirm(
      "Stop sharing this analysis? The existing link will stop working immediately."
    );
    if (!ok) return;
    setSharing(true);
    try {
      await onStopShare(record.id);
      Analytics.shareLinkRevoked();
      setShareMessage("Sharing disabled");
      setTimeout(() => setShareMessage(null), 3000);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to stop sharing");
    } finally {
      setSharing(false);
    }
  };

  const handleDeleteAnalysis = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = window.confirm(
      "Delete this analysis from your history? This removes the scoring result and any stored video. Your monthly usage count is NOT refunded."
    );
    if (!ok) return;
    setDeletingAnalysis(true);
    setRowError(null);
    try {
      if (record.object_key && !videoDeleted) {
        try {
          await deleteUploadedVideo(record.object_key);
        } catch {
          // Non-fatal.
        }
      }
      await onDeleted(record.id);
      Analytics.analysisDeleted();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Delete failed");
      setDeletingAnalysis(false);
    }
  };

  return (
    <div
      ref={rowRef}
      className={`border rounded-lg transition-colors ${
        autoExpand
          ? "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
          : "border-border"
      }`}
    >
      <div
        className="w-full flex items-center justify-between p-3 text-sm cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="min-w-0 flex-1">
          <span className="font-medium truncate block">
            {record.filename || "Untitled"}
          </span>
          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5 mt-0.5">
            <span>
              {new Date(record.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {record.duration ? (
              <span>· {formatDuration(record.duration)}</span>
            ) : null}
            {record.role && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {record.role}
              </Badge>
            )}
            {record.competition_level && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {record.competition_level}
              </Badge>
            )}
            {record.event_name && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {record.event_name}
                {record.event_date
                  ? ` · ${new Date(record.event_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
                  : ""}
              </Badge>
            )}
            {record.stage && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {record.stage}
              </Badge>
            )}
            {(record.tags ?? []).slice(0, 4).map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="text-[9px] px-1.5 py-0 h-4"
              >
                #{t}
              </Badge>
            ))}
          </div>
        </div>
        {overall && (
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <span className="font-mono font-bold tabular-nums">
              {overall.score?.toFixed?.(1) ?? "—"}
            </span>
            <Badge variant="secondary" className="text-xs">
              {overall.grade ?? "—"}
            </Badge>
          </div>
        )}
      </div>
      {expanded && (
        <div className="border-t border-border p-3 space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {canViewOrReanalyze && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleWatch}
                  disabled={
                    loadingVideo ||
                    reanalyzing ||
                    deletingVideo ||
                    deletingAnalysis
                  }
                  title={videoUrl ? "Reload video" : "Watch"}
                >
                  {loadingVideo ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
                  ) : (
                    <Play className="h-3.5 w-3.5 sm:mr-2" />
                  )}
                  <span className="hidden sm:inline">
                    {videoUrl ? "Reload video" : "Watch"}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReanalyze}
                  disabled={
                    reanalyzing ||
                    loadingVideo ||
                    deletingVideo ||
                    deletingAnalysis
                  }
                  title="Re-analyze — uses 1 quota"
                >
                  {reanalyzing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5 sm:mr-2" />
                  )}
                  <span className="hidden sm:inline">Re-analyze</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={handleDeleteVideo}
                  disabled={
                    deletingVideo ||
                    deletingAnalysis ||
                    reanalyzing ||
                    loadingVideo
                  }
                  title="Delete video file from storage"
                >
                  {deletingVideo ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 sm:mr-2" />
                  )}
                  <span className="hidden sm:inline">Delete video</span>
                </Button>
              </>
            )}

            {shareUrl && (record.share_view_count ?? 0) > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
                title={
                  record.share_last_viewed_at
                    ? `Last viewed ${new Date(record.share_last_viewed_at).toLocaleString()}`
                    : undefined
                }
              >
                <Eye className="h-3 w-3" />
                {record.share_view_count}
                <span className="hidden sm:inline">
                  {" "}
                  view{record.share_view_count === 1 ? "" : "s"}
                </span>
              </span>
            )}

            {shareUrl ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyShareLink}
                  disabled={sharing}
                  title="Copy share link"
                >
                  <Copy className="h-3.5 w-3.5 sm:mr-2" />
                  <span className="hidden sm:inline">Copy link</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={handleStopShare}
                  disabled={sharing}
                  title="Stop sharing"
                >
                  {sharing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
                  ) : (
                    <Link2Off className="h-3.5 w-3.5 sm:mr-2" />
                  )}
                  <span className="hidden sm:inline">Stop sharing</span>
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleShare}
                disabled={sharing}
                title="Share this analysis via link"
              >
                {sharing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
                ) : (
                  <Share2 className="h-3.5 w-3.5 sm:mr-2" />
                )}
                <span className="hidden sm:inline">Share link</span>
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive ml-auto"
              onClick={handleDeleteAnalysis}
              disabled={deletingAnalysis || deletingVideo || reanalyzing}
              title="Delete this analysis from history"
            >
              {deletingAnalysis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 sm:mr-2" />
              )}
              <span className="hidden sm:inline">Delete analysis</span>
            </Button>
          </div>

          {record.dancer_description && (
            <p className="text-xs text-muted-foreground italic">
              Focused on: {record.dancer_description}
            </p>
          )}

          {shareMessage && (
            <p className="text-xs text-primary">{shareMessage}</p>
          )}

          {canViewOrReanalyze && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Stored video —
              </span>{" "}
              click <span className="font-medium">Watch</span> to map the
              pattern timeline and off-beat markers against the actual
              clip.
            </p>
          )}

          {!canViewOrReanalyze && (
            <p className="text-xs text-muted-foreground">
              {videoDeleted
                ? "Video deleted from storage. The scoring result above is preserved."
                : "Source video wasn\u2019t kept (delete-after-scoring is the default). Upload again with \u201cKeep video stored\u201d enabled if you want to map the timeline to a clip you can replay."}
            </p>
          )}

          {rowError && (
            <p className="text-xs text-destructive">{rowError}</p>
          )}

          {currentResult && (
            <>
              <TimelineView
                result={currentResult}
                duration={record.duration ?? 0}
                videoSrc={videoUrl}
              />
              <ScoreResultCard
                result={currentResult}
                duration={record.duration ?? 0}
                competitionLevel={record.competition_level}
                onClear={() => setExpanded(false)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreResultCard({
  result,
  duration,
  competitionLevel,
  onClear,
}: {
  result: VideoScoreResult;
  duration: number;
  competitionLevel?: string | null;
  onClear: () => void;
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
              <span className="text-xl sm:text-2xl text-muted-foreground">/10</span>
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
              // When Gemini's observed tier differs from the user's
              // declared level, make the mismatch explicit instead of
              // letting the impression text contradict the label.
              const declared = (competitionLevel || "").trim().toLowerCase();
              const observed = (result.observed_level || "").trim();
              if (!observed) return null;
              if (
                declared &&
                observed.toLowerCase() === declared
              )
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
              {result.sanity_warnings && result.sanity_warnings.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-xs border-amber-500/40 text-amber-300"
                  title={result.sanity_warnings.join("\n")}
                >
                  plausibility warnings ({result.sanity_warnings.length})
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
            {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map(
              (key) => {
                const cat = result.categories[key];
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{CATEGORY_LABELS[key]}</span>
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
              }
            )}
          </div>
        </CardContent>
      </Card>

      {(result.lead || result.follow) && (
        <PartnerCards lead={result.lead} follow={result.follow} />
      )}

      {(() => {
        // Prefer the server-computed summary. For analyses stored
        // before the backend started returning pattern_summary, fall
        // back to deriving it from the flat patterns_identified list
        // so every historical analysis still gets the card.
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

      <Button onClick={onClear} variant="outline" className="w-full">
        Analyze another video
      </Button>
    </div>
  );
}

function HowScoringWorksInfo() {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer list-none p-4 text-sm font-medium">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              How scoring works
            </span>
            <span className="text-xs text-muted-foreground group-open:hidden">
              Show details ▾
            </span>
            <span className="text-xs text-muted-foreground hidden group-open:inline">
              Hide ▴
            </span>
          </summary>
          <div className="px-4 pb-4 space-y-4 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-1.5">
                WSDC-style scoring · 4 weighted categories
              </p>
              <ul className="space-y-1">
                <li>
                  <span className="font-mono text-foreground">30%</span>{" "}
                  <span className="font-medium text-foreground">
                    Timing & Rhythm
                  </span>{" "}
                  — on-beat dancing, triple-step precision, anchor-step
                  placement, musical breaks
                </li>
                <li>
                  <span className="font-mono text-foreground">30%</span>{" "}
                  <span className="font-medium text-foreground">
                    Technique
                  </span>{" "}
                  — posture, extension, footwork (heel-toe rolling), slot
                  discipline, frame
                </li>
                <li>
                  <span className="font-mono text-foreground">20%</span>{" "}
                  <span className="font-medium text-foreground">Teamwork</span>{" "}
                  — connection quality, shared weight, responsiveness,
                  matched energy
                </li>
                <li>
                  <span className="font-mono text-foreground">20%</span>{" "}
                  <span className="font-medium text-foreground">
                    Presentation
                  </span>{" "}
                  — musicality, styling, stage presence, creative movement
                </li>
              </ul>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1.5">
                What affects your score
              </p>
              <ul className="space-y-1">
                <li>
                  <span className="font-medium text-foreground">Level</span>{" "}
                  — calibrates the rubric. A Novice at 6.5 and a Champion
                  at 6.5 are judged against different expectations in the
                  written feedback.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Focus on (who)
                  </span>{" "}
                  — when multiple dancers are in frame, this restricts
                  scoring to the identified dancer(s) only.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Role / Event / Stage / Tags
                  </span>{" "}
                  — context for the reasoning. Doesn&apos;t change the
                  rubric; helps you filter and compare later.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Audio quality
                  </span>{" "}
                  — the model listens to the music to judge on-beat
                  dancing. Phone-mic clips are fine; completely silent
                  video hurts Timing scoring.
                </li>
              </ul>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1.5">
                What doesn&apos;t affect it
              </p>
              <ul className="space-y-1">
                <li>
                  Video quality and camera angle (within reason) — the
                  model is tolerant of handheld phone footage
                </li>
                <li>
                  Filename or tags — stored for your reference, not shown
                  to the model
                </li>
                <li>
                  Other analyses in your history — each clip is scored
                  independently
                </li>
              </ul>
            </div>

            <p className="italic">
              Scoring is a tool for reflection — use it to spot patterns
              over time rather than as a definitive judgment on any one
              run. The uncertainty band next to each score is the model&apos;s
              honest confidence interval.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function SelectWithOther({
  id,
  label,
  options,
  select,
  setSelect,
  custom,
  setCustom,
  customPlaceholder,
}: {
  id: string;
  label: string;
  options: readonly string[];
  select: string;
  setSelect: (v: string) => void;
  custom: string;
  setCustom: (v: string) => void;
  customPlaceholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={select} onValueChange={setSelect}>
        <SelectTrigger id={id} className="h-8 text-sm">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>Other…</SelectItem>
        </SelectContent>
      </Select>
      {select === OTHER && (
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={customPlaceholder ?? `Custom ${label.toLowerCase()}`}
          className="h-8 text-sm mt-1"
        />
      )}
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
    (s): s is { key: string; label: string; sub: { score: number; notes?: string } } =>
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

// PatternSummaryCard + derivePatternSummary moved to
// src/components/analyze/pattern-summary.tsx so the shared page
// can reuse them.

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

/**
 * Probe video duration locally via a hidden <video> element. Avoids a
 * wasted upload when the file is obviously over the plan limit.
 */
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    };
    v.src = url;
  });
}
