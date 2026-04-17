"use client";

import { useCallback, useEffect, useState } from "react";
import {
  analyzeVideoFromKey,
  getPresignedUploadUrl,
  getVideoQuota,
  isWcsApiConfigured,
  uploadToPresignedUrl,
  UploadError,
  type VideoAnalysisResponse,
  type VideoAnalyzeOptions,
  type VideoQuota,
} from "@/lib/wcs-api";
import { Analytics } from "@/lib/analytics";

export type VideoAnalysisStatus =
  | "idle"
  | "uploading"
  | "analyzing"
  | "success"
  | "error";

export type VideoAnalysisState = {
  status: VideoAnalysisStatus;
  result: VideoAnalysisResponse | null;
  error: string | null;
  uploadProgress: number;
};

const INITIAL: VideoAnalysisState = {
  status: "idle",
  result: null,
  error: null,
  uploadProgress: 0,
};

export function useVideoAnalysis() {
  const [state, setState] = useState<VideoAnalysisState>(INITIAL);
  const [quota, setQuota] = useState<VideoQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const refreshQuota = useCallback(async () => {
    if (!isWcsApiConfigured) {
      setQuotaLoading(false);
      setQuotaError("Cloud API not configured");
      return;
    }
    setQuotaLoading(true);
    try {
      const q = await getVideoQuota();
      setQuota(q);
      setQuotaError(null);
    } catch (e) {
      setQuotaError(e instanceof Error ? e.message : "Failed to load quota");
    } finally {
      setQuotaLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  const analyze = useCallback(
    async (file: File, options: VideoAnalyzeOptions = {}) => {
      if (!isWcsApiConfigured) {
        setState({
          ...INITIAL,
          status: "error",
          error: "Cloud API not configured (NEXT_PUBLIC_WCS_API_URL)",
        });
        return;
      }
      setState({ ...INITIAL, status: "uploading" });
      const sizeMb = file.size / (1024 * 1024);
      Analytics.videoUploadStarted({
        size_mb: +sizeMb.toFixed(1),
        content_type: file.type || "application/octet-stream",
      });
      try {
        // Retry the upload up to 3 times. Re-request a fresh
        // presigned URL on each attempt so we don't retry against a
        // stale/expired link. Only retry on transient failures —
        // genuine config issues (storage 4xx other than 403) fail
        // fast with a useful message instead of hammering R2.
        const MAX_ATTEMPTS = 3;
        const BACKOFF_MS = [0, 1500, 4000];
        let objectKey = "";
        let lastError: unknown = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          if (BACKOFF_MS[attempt] > 0) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
          }
          try {
            const presign = await getPresignedUploadUrl(
              file.name,
              file.type || "application/octet-stream"
            );
            objectKey = presign.objectKey;
            await uploadToPresignedUrl(
              presign.uploadUrl,
              file,
              (percent) => {
                setState((s) => ({ ...s, uploadProgress: percent }));
              }
            );
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
            const shouldRetry =
              e instanceof UploadError &&
              e.retryable &&
              attempt < MAX_ATTEMPTS - 1;
            if (!shouldRetry) break;
            // Reset progress for the retry so the UI doesn't look
            // stuck at the failed attempt's last frame.
            setState((s) => ({ ...s, uploadProgress: 0 }));
          }
        }
        if (lastError) throw lastError;
        Analytics.videoUploadSucceeded({ size_mb: +sizeMb.toFixed(1) });
        setState((s) => ({ ...s, status: "analyzing", uploadProgress: 100 }));
        Analytics.videoAnalysisStarted();
        const result = await analyzeVideoFromKey(
          objectKey,
          file.name,
          options
        );
        Analytics.videoAnalysisSucceeded({
          score: result.result?.overall?.score,
          grade: result.result?.overall?.grade,
          duration_sec: Math.round(result.duration ?? 0),
          role: options.role,
          level: options.competitionLevel,
          stage: options.stage,
        });
        setState({
          status: "success",
          result,
          error: null,
          uploadProgress: 100,
        });
        refreshQuota();
      } catch (e) {
        // Surface user-actionable copy per error kind. Keeps the
        // "check the R2 CORS policy" troubleshooting note OFF the
        // screen — that's an ops concern, not something users can do.
        let message: string;
        if (e instanceof UploadError) {
          switch (e.kind) {
            case "offline":
              message =
                "You appear to be offline. Reconnect and try again.";
              break;
            case "timeout":
              message =
                "Upload timed out. Try again on a stronger connection, or use a shorter clip.";
              break;
            case "network":
              message =
                "Connection dropped during upload. We retried but it kept failing — check your internet and try again.";
              break;
            case "expired":
              message =
                "Upload link expired. Refresh the page and try again.";
              break;
            case "storage":
              message = `Storage returned an error (${e.status}). If this keeps happening, let us know.`;
              break;
            default:
              message = e.message || "Upload failed.";
          }
        } else {
          message = e instanceof Error ? e.message : "Analysis failed";
        }
        Analytics.videoAnalysisFailed({ message });
        setState({ ...INITIAL, status: "error", error: message });
      }
    },
    [refreshQuota]
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return {
    state,
    quota,
    quotaLoading,
    quotaError,
    analyze,
    reset,
    refreshQuota,
    isConfigured: isWcsApiConfigured,
  };
}
