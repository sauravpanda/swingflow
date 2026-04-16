"use client";

import { useCallback, useRef, useState } from "react";
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
} from "lucide-react";
import { useVideoAnalysis } from "@/hooks/use-video-analysis";
import { useAnalysisHistory, type AnalysisRecord } from "@/hooks/use-analysis-history";
import {
  analyzeVideoFromKey,
  deleteUploadedVideo,
  getViewUrl,
  type VideoScoreResult,
} from "@/lib/wcs-api";

const CATEGORY_LABELS: Record<keyof VideoScoreResult["categories"], string> = {
  timing: "Timing & Rhythm",
  technique: "Technique",
  teamwork: "Teamwork",
  presentation: "Presentation",
};

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
    if (file) {
      analyze(file).then(() => history.refresh());
    }
  }, [file, analyze, history]);

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
    <div className="space-y-6 max-w-2xl mx-auto">
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

      {/* Paywall */}
      {isPaywalled && (
        <Card className="border-primary/40">
          <CardContent className="py-6 space-y-3 text-center">
            <Sparkles className="h-8 w-8 text-primary mx-auto" />
            <h2 className="text-lg font-semibold">Monthly limit reached</h2>
            <p className="text-sm text-muted-foreground">
              Upgrade to Basic for 10 videos / month and 5-minute clips.
            </p>
            <Link href="/billing">
              <Button className="w-full">Upgrade to Basic — $10/mo</Button>
            </Link>
          </CardContent>
        </Card>
      )}

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
        <ScoreResultCard
          result={state.result.result}
          duration={state.result.duration}
          onClear={handleClear}
        />
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
                onReanalyzed={history.refresh}
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
  onReanalyzed,
}: {
  record: AnalysisRecord;
  onReanalyzed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [currentResult, setCurrentResult] = useState<
    VideoScoreResult | null
  >(record.result ?? null);
  const [rowError, setRowError] = useState<string | null>(null);
  const overall = currentResult?.overall;

  const canViewOrReanalyze = Boolean(record.object_key) && !deleted;

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

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!record.object_key) return;
    const ok = window.confirm(
      "Delete the source video from storage? Your scoring result stays — only the video file is removed. This cannot be undone."
    );
    if (!ok) return;
    setDeleting(true);
    setRowError(null);
    try {
      await deleteUploadedVideo(record.object_key);
      setDeleted(true);
      setVideoUrl(null);
      onReanalyzed();
    } catch (err) {
      setRowError(
        err instanceof Error ? err.message : "Delete failed"
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="border border-border rounded-lg">
      <div
        className="w-full flex items-center justify-between p-3 text-sm cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="min-w-0 flex-1">
          <span className="font-medium truncate block">
            {record.filename || "Untitled"}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(record.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {record.duration ? ` · ${formatDuration(record.duration)}` : ""}
          </span>
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
          {canViewOrReanalyze && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleWatch}
                disabled={loadingVideo || reanalyzing || deleting}
              >
                {loadingVideo ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-2 h-3.5 w-3.5" />
                )}
                {videoUrl ? "Reload video" : "Watch"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReanalyze}
                disabled={reanalyzing || loadingVideo || deleting}
              >
                {reanalyzing ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                )}
                Re-analyze (1 quota)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive ml-auto"
                onClick={handleDelete}
                disabled={deleting || reanalyzing || loadingVideo}
              >
                {deleting ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                )}
                Delete video
              </Button>
            </div>
          )}

          {!canViewOrReanalyze && (
            <p className="text-xs text-muted-foreground">
              {deleted
                ? "Video deleted from storage. The scoring result above is preserved."
                : "Source video isn\u2019t available (older entry — video was removed after scoring)."}
            </p>
          )}

          {rowError && (
            <p className="text-xs text-destructive">{rowError}</p>
          )}

          {videoUrl && (
            <video
              src={videoUrl}
              controls
              preload="metadata"
              className="w-full rounded-md bg-black"
            />
          )}

          {currentResult && (
            <ScoreResultCard
              result={currentResult}
              duration={record.duration ?? 0}
              onClear={() => setExpanded(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ScoreResultCard({
  result,
  duration,
  onClear,
}: {
  result: VideoScoreResult;
  duration: number;
  onClear: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
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
        <CardContent className="space-y-4">
          <div className="flex items-baseline justify-center gap-2 py-2">
            <span className="text-5xl font-bold tabular-nums">
              {result.overall.score.toFixed(1)}
            </span>
            <span className="text-2xl text-muted-foreground">/ 10</span>
            <Badge className="ml-3 text-base">{result.overall.grade}</Badge>
          </div>

          <div className="space-y-3">
            {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map(
              (key) => {
                const cat = result.categories[key];
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{CATEGORY_LABELS[key]}</span>
                      <span className="font-mono tabular-nums">
                        {cat.score.toFixed(1)} / 10
                      </span>
                    </div>
                    <Progress value={cat.score * 10} className="h-1.5" />
                    <p className="text-xs text-muted-foreground">{cat.notes}</p>
                  </div>
                );
              }
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Strengths</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {result.strengths.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Areas to improve</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {result.improvements.map((s, i) => (
              <li key={i}>• {s}</li>
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
