"use client";

import { useCallback, useEffect, useState } from "react";
import {
  analyzeVideo,
  getVideoQuota,
  isWcsApiConfigured,
  type VideoAnalysisResponse,
  type VideoQuota,
} from "@/lib/wcs-api";

export type VideoAnalysisStatus = "idle" | "loading" | "success" | "error";

export type VideoAnalysisState = {
  status: VideoAnalysisStatus;
  result: VideoAnalysisResponse | null;
  error: string | null;
};

const INITIAL: VideoAnalysisState = {
  status: "idle",
  result: null,
  error: null,
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
    async (file: File) => {
      if (!isWcsApiConfigured) {
        setState({
          status: "error",
          result: null,
          error: "Cloud API not configured (NEXT_PUBLIC_WCS_API_URL)",
        });
        return;
      }
      setState({ status: "loading", result: null, error: null });
      try {
        const result = await analyzeVideo(file);
        setState({ status: "success", result, error: null });
        // Refresh quota so the UI shows the updated count.
        refreshQuota();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Analysis failed";
        setState({ status: "error", result: null, error: message });
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
