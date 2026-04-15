"use client";

import { useCallback, useState } from "react";
import {
  analyzeMusic,
  isWcsApiConfigured,
  type MusicAnalysisResult,
} from "@/lib/wcs-api";

export type MusicAnalysisStatus = "idle" | "loading" | "success" | "error";

export type MusicAnalysisState = {
  status: MusicAnalysisStatus;
  result: MusicAnalysisResult | null;
  error: string | null;
};

const INITIAL: MusicAnalysisState = {
  status: "idle",
  result: null,
  error: null,
};

export function useMusicAnalysis() {
  const [state, setState] = useState<MusicAnalysisState>(INITIAL);

  const analyze = useCallback(async (file: File) => {
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
      const result = await analyzeMusic(file);
      setState({ status: "success", result, error: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Analysis failed";
      setState({ status: "error", result: null, error: message });
    }
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, analyze, reset, isConfigured: isWcsApiConfigured };
}
