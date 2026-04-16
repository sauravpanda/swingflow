"use client";

import posthog from "posthog-js";

let initialized = false;

export function initAnalytics() {
  if (typeof window === "undefined" || initialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: "history_change",
    person_profiles: "identified_only",
    autocapture: true,
  });
  initialized = true;
}

export function identifyUser(id: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined" || !initialized) return;
  posthog.identify(id, props);
}

export function resetUser() {
  if (typeof window === "undefined" || !initialized) return;
  posthog.reset();
}

export function track(
  event: string,
  props?: Record<string, unknown>
): void {
  if (typeof window === "undefined" || !initialized) return;
  posthog.capture(event, props);
}

// Typed event helpers — keeps event names and props consistent across the app.
export const Analytics = {
  signupStarted: () => track("signup_started"),
  signupCompleted: () => track("signup_completed"),
  loginCompleted: () => track("login_completed"),

  videoUploadStarted: (p: { size_mb: number; content_type: string }) =>
    track("video_upload_started", p),
  videoUploadSucceeded: (p: { size_mb: number }) =>
    track("video_upload_succeeded", p),
  videoUploadFailed: (p: { message: string }) =>
    track("video_upload_failed", p),
  videoAnalysisStarted: () => track("video_analysis_started"),
  videoAnalysisSucceeded: (p: {
    score?: number;
    grade?: string;
    duration_sec: number;
    role?: string;
    level?: string;
    stage?: string;
  }) => track("video_analysis_succeeded", p),
  videoAnalysisFailed: (p: { message: string }) =>
    track("video_analysis_failed", p),

  musicAnalysisCompleted: (p: { bpm?: number; duration?: number }) =>
    track("music_analysis_completed", p),

  upgradeClicked: (p: { source: string }) => track("upgrade_clicked", p),
  manageSubscriptionClicked: () => track("manage_subscription_clicked"),

  shareLinkCreated: () => track("share_link_created"),
  shareLinkRevoked: () => track("share_link_revoked"),
  sharedAnalysisViewed: () => track("shared_analysis_viewed"),

  analysisDeleted: () => track("analysis_deleted"),
  videoFileDeleted: () => track("video_file_deleted"),
  analysisReanalyzed: () => track("analysis_reanalyzed"),

  feedbackSubmitted: () => track("feedback_submitted"),
};
