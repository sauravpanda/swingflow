"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  Share2,
  Link2Off,
  Copy,
  Eye,
  AlertCircle,
} from "lucide-react";
import { TimelineView } from "@/components/analyze/timeline-view";
import { ScoreResultCard } from "@/components/analyze/score-result-card";
import { PeerReviewsSection } from "@/components/analyze/peer-reviews-section";
import {
  useAnalysisHistory,
  type AnalysisRecord,
} from "@/hooks/use-analysis-history";
import {
  analyzeVideoFromKey,
  deleteUploadedVideo,
  getViewUrl,
  type VideoScoreResult,
} from "@/lib/wcs-api";
import { Analytics } from "@/lib/analytics";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AnalysisPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");

  const history = useAnalysisHistory();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);
  const [deletingAnalysis, setDeletingAnalysis] = useState(false);
  const [videoDeleted, setVideoDeleted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [overrideResult, setOverrideResult] = useState<VideoScoreResult | null>(
    null
  );

  // Find the record from the history hook. history.records already
  // filters soft-deleted rows by default, so if the id is missing
  // from the list we treat it as deleted/not-found.
  const record: AnalysisRecord | undefined = id
    ? history.records.find((r) => r.id === id)
    : undefined;

  const currentResult = overrideResult ?? record?.result ?? null;

  const canViewOrReanalyze =
    Boolean(record?.object_key) && !videoDeleted;

  const shareUrl =
    record?.share_token && typeof window !== "undefined"
      ? `${window.location.origin}/shared?t=${record.share_token}`
      : null;

  const handleWatch = useCallback(async () => {
    if (!record?.object_key) return;
    if (videoUrl) return;
    setLoadingVideo(true);
    setRowError(null);
    try {
      const url = await getViewUrl(record.object_key);
      setVideoUrl(url);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Could not load video");
    } finally {
      setLoadingVideo(false);
    }
  }, [record?.object_key, videoUrl]);

  // Auto-load the video when a stored clip exists — dedicated page
  // has room for the video, so no reason to make the user click.
  useEffect(() => {
    if (canViewOrReanalyze && !videoUrl && !loadingVideo) {
      handleWatch();
    }
  }, [canViewOrReanalyze, videoUrl, loadingVideo, handleWatch]);

  const handleReanalyze = async () => {
    if (!record?.object_key) return;
    setReanalyzing(true);
    setRowError(null);
    try {
      const resp = await analyzeVideoFromKey(
        record.object_key,
        record.filename ?? "video.mp4",
        {
          // fresh: true flips the backend off its pinned seed so the
          // re-run actually diverges from the previous result instead
          // of returning near-identical output. Costs nothing extra.
          fresh: true,
          // Preserve video linkage. Without storeVideo=true, the
          // backend defaults to store_video=false and (a) saves
          // object_key=null on the new row and (b) deletes the R2
          // object after scoring — orphaning both the original row
          // AND the new one. This re-analyze flow is ALWAYS on a
          // stored video (we guard record.object_key above), so the
          // user already opted into retention; keep it retained.
          storeVideo: true,
          // Carry forward all metadata from the source analysis so
          // the new row has the same role / level / event / tags /
          // dancer description context — otherwise the re-analyze
          // loses calibration context and reads the dance without
          // knowing it's a Novice finals run, etc.
          role: record.role ?? undefined,
          competitionLevel: record.competition_level ?? undefined,
          eventName: record.event_name ?? undefined,
          eventDate: record.event_date ?? undefined,
          stage: record.stage ?? undefined,
          tags: record.tags ?? undefined,
          dancerDescription: record.dancer_description ?? undefined,
        }
      );
      Analytics.analysisReanalyzed();
      setOverrideResult(resp.result);
      history.refresh();
      // If the backend returned a new analysis_id, navigate to it so
      // the URL reflects the fresh run (user can share / bookmark it
      // independently from the original row).
      if (resp.analysis_id && resp.analysis_id !== record.id) {
        router.push(`/analysis?id=${encodeURIComponent(resp.analysis_id)}`);
      }
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Re-analysis failed");
    } finally {
      setReanalyzing(false);
    }
  };

  const handleDeleteVideo = async () => {
    if (!record?.object_key) return;
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
      history.refresh();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingVideo(false);
    }
  };

  const handleShare = async () => {
    if (!record) return;
    setSharing(true);
    setShareMessage(null);
    setRowError(null);
    try {
      const token = await history.enableSharing(record.id);
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

  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage("Link copied to clipboard");
      setTimeout(() => setShareMessage(null), 3000);
    } catch {
      setShareMessage(shareUrl);
    }
  };

  const handleStopShare = async () => {
    if (!record) return;
    const ok = window.confirm(
      "Stop sharing this analysis? The existing link will stop working immediately."
    );
    if (!ok) return;
    setSharing(true);
    try {
      await history.disableSharing(record.id);
      Analytics.shareLinkRevoked();
      setShareMessage("Sharing disabled");
      setTimeout(() => setShareMessage(null), 3000);
    } finally {
      setSharing(false);
    }
  };

  const handleDeleteAnalysis = async () => {
    if (!record) return;
    const ok = window.confirm(
      "Delete this analysis from your list? This soft-deletes the entry — your score stays on the dashboard trend, but it won't appear on the analyze page anymore."
    );
    if (!ok) return;
    setDeletingAnalysis(true);
    try {
      await history.remove(record.id);
      router.push("/analyze");
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Delete failed");
      setDeletingAnalysis(false);
    }
  };

  // ─── Loading / not-found states ────────────────────────────────

  if (!id) {
    return (
      <div className="max-w-4xl mx-auto">
        <ErrorState
          title="No analysis selected"
          body="This page needs an analysis ID. Go to your list and pick one."
        />
      </div>
    );
  }

  if (history.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!record || !currentResult) {
    return (
      <div className="max-w-4xl mx-auto">
        <ErrorState
          title="Analysis not found"
          body="This analysis doesn't exist, has been deleted, or belongs to someone else."
        />
      </div>
    );
  }

  // ─── Full view ─────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/analyze"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        All analyses
      </Link>

      {/* Header: filename + metadata */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold break-all">
          {record.filename || "Untitled"}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
          <span>{formatDateTime(record.created_at)}</span>
          {record.role && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
              {record.role}
            </Badge>
          )}
          {record.competition_level && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
              {record.competition_level}
            </Badge>
          )}
          {record.event_name && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
              {record.event_name}
              {record.event_date
                ? ` · ${new Date(record.event_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
                : ""}
            </Badge>
          )}
          {record.stage && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
              {record.stage}
            </Badge>
          )}
          {(record.tags ?? []).slice(0, 6).map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-5"
            >
              #{t}
            </Badge>
          ))}
        </div>
        {record.dancer_description && (
          <p className="text-xs text-muted-foreground italic mt-1.5">
            Focused on: {record.dancer_description}
          </p>
        )}
      </div>

      {/* Action bar — icon-only labels on mobile (text appears sm+)
          so a narrow screen shows a clean row of tappable icons
          instead of a wrapped mess of button text. */}
      <Card>
        <CardContent className="p-2 sm:p-3 flex flex-wrap items-center gap-1.5 sm:gap-2">
          {canViewOrReanalyze && (
            <>
              {loadingVideo && !videoUrl ? (
                <Button size="sm" variant="outline" disabled>
                  <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
                  <span className="hidden sm:inline">Loading video…</span>
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={handleReanalyze}
                disabled={
                  reanalyzing || loadingVideo || deletingVideo || deletingAnalysis
                }
                title="Re-analyze this clip (uses 1 quota)"
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
                  deletingVideo || deletingAnalysis || reanalyzing || loadingVideo
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
                {" view"}
                {record.share_view_count === 1 ? "" : "s"}
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
            className="text-muted-foreground hover:text-destructive sm:ml-auto"
            onClick={handleDeleteAnalysis}
            disabled={deletingAnalysis || deletingVideo || reanalyzing}
            title="Remove from your analyses list"
          >
            {deletingAnalysis ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-2" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 sm:mr-2" />
            )}
            <span className="hidden sm:inline">Delete analysis</span>
          </Button>
        </CardContent>
      </Card>

      {shareMessage && (
        <p className="text-xs text-primary">{shareMessage}</p>
      )}
      {rowError && <p className="text-xs text-destructive">{rowError}</p>}

      {!canViewOrReanalyze && (
        <Card className="border-muted">
          <CardContent className="py-4 text-xs text-muted-foreground flex items-start gap-2">
            <Play className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {videoDeleted
                ? "Video deleted from storage. Your scoring result is preserved."
                : "Source video wasn't kept (delete-after-scoring is the default). Upload again with \u201cKeep video stored\u201d enabled to map the timeline to a clip you can replay."}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Timeline + video */}
      <TimelineView
        result={currentResult}
        duration={record.duration ?? 0}
        videoSrc={videoUrl}
      />

      {/* Score + sub-scores + patterns + strengths + improvements */}
      <ScoreResultCard
        result={currentResult}
        duration={record.duration ?? 0}
        competitionLevel={record.competition_level}
      />

      {/* Peer reviews — generate private review links, show submitted
          reviews alongside the AI score */}
      <PeerReviewsSection analysisId={record.id} />
    </div>
  );
}

function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center gap-3">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-md">{body}</p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link href="/analyze">Back to analyses</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AnalysisPageInner />
    </Suspense>
  );
}
