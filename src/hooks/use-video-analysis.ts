"use client";

import { useCallback, useEffect, useState } from "react";
import {
  analyzeVideoFromKey,
  getPresignedUploadUrl,
  getVideoQuota,
  isWcsApiConfigured,
  uploadToPresignedUrl,
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
        const { uploadUrl, objectKey } = await getPresignedUploadUrl(
          file.name,
          file.type || "application/octet-stream"
        );
        await uploadToPresignedUrl(uploadUrl, file, (percent) => {
          setState((s) => ({ ...s, uploadProgress: percent }));
        });
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
        const message = e instanceof Error ? e.message : "Analysis failed";
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
