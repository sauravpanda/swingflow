import { getSupabase } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_WCS_API_URL;

export const isWcsApiConfigured = Boolean(API_URL);

export type MusicAnalysisResult = {
  bpm: number;
  duration: number;
  beats: number[];
  downbeats: number[];
  phrases: number[][];
  anchor_beats: number[];
};

async function getAccessToken(): Promise<string> {
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

export async function analyzeMusic(file: File): Promise<MusicAnalysisResult> {
  if (!API_URL) throw new Error("NEXT_PUBLIC_WCS_API_URL is not set");
  const token = await getAccessToken();

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/analyze/music`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore
    }
    throw new Error(`Music analysis failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as MusicAnalysisResult;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error("NEXT_PUBLIC_WCS_API_URL is not set");
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      if (errBody?.detail) detail = String(errBody.detail);
    } catch {
      // ignore
    }
    throw new Error(`Request to ${path} failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

export async function createCheckoutSession(
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const data = await postJson<{ url: string }>("/billing/checkout", {
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return data.url;
}

export async function createPortalSession(returnUrl: string): Promise<string> {
  const data = await postJson<{ url: string }>("/billing/portal", {
    return_url: returnUrl,
  });
  return data.url;
}

// ───────────────────────────────────────────────────────────────────
// Video analysis
// ───────────────────────────────────────────────────────────────────

export type VideoOffBeatMoment = {
  timestamp_approx?: string;
  description?: string;
  beat_count?: string;
};

export type VideoSubScore = {
  score: number;
  notes?: string;
};

export type VideoCategoryScore = {
  score: number;
  score_low?: number;
  score_high?: number;
  reasoning?: string;
  notes?: string;
  // Timing-specific
  on_beat?: boolean;
  off_beat_moments?: VideoOffBeatMoment[];
  rhythm_consistency?: string;
  // Technique-specific sub-scores
  posture?: VideoSubScore;
  extension?: VideoSubScore;
  footwork?: VideoSubScore;
  slot?: VideoSubScore;
  // Teamwork / Presentation extras
  connection?: string;
  musicality?: string;
  styling?: string;
};

export type VideoPatternIdentified = {
  name: string;
  start_time?: number;
  end_time?: number;
  quality?: "strong" | "solid" | "needs_work" | "weak" | string;
  timing?: "on_beat" | "slightly_off" | "off_beat" | string;
  notes?: string;
  // Brief free-text description of styling during this pattern
  // (body rolls, arm styling, musical hits). Null when nothing
  // notable — the model is instructed to prefer silence over
  // invention here.
  styling?: string | null;
  // One actionable, pattern-specific suggestion. Null when the
  // execution was clean enough not to warrant targeted work.
  coaching_tip?: string | null;
};

export type VideoPartnerScore = {
  technique_score?: number;
  presentation_score?: number;
  notes?: string;
};

export type PatternSummary = {
  name: string;
  count: number;
  quality?: string | null;
  timing?: string | null;
  notes?: string | null;
  styling?: string | null;
  coaching_tip?: string | null;
};

export type VideoScoreResult = {
  overall: {
    score: number;
    grade: string;
    confidence?: "high" | "low";
    impression?: string;
  };
  categories: {
    timing: VideoCategoryScore;
    technique: VideoCategoryScore;
    teamwork: VideoCategoryScore;
    presentation: VideoCategoryScore;
  };
  patterns_identified?: VideoPatternIdentified[];
  // Aggregated patterns: deduplicated by name with per-pattern
  // occurrence count + most-common quality/timing. Computed server-side.
  pattern_summary?: PatternSummary[];
  strengths: string[];
  improvements: string[];
  lead?: VideoPartnerScore;
  follow?: VideoPartnerScore;
  estimated_bpm?: number;
  song_style?: string;
  // The tier Gemini actually observed (Newcomer / Novice /
  // Intermediate / Advanced / All-Star / Champion), independent
  // of the user's self-declared level. When the two disagree we
  // render an explicit "Scored as X · Declared Y" note on the
  // score hero so the mismatch doesn't look like a contradiction.
  observed_level?: string;
  // Non-empty when the server sanity check flagged implausible
  // results (e.g. "intro lasted 60s") that even one retry couldn't
  // fully fix. Surfaced as a low-confidence hint in the UI.
  sanity_warnings?: string[];
};

export type VideoQuota = {
  plan: "free" | "basic";
  used: number;
  limit: number;
  max_seconds: number;
  remaining: number;
};

export type VideoAnalysisResponse = {
  duration: number;
  result: VideoScoreResult;
  quota: {
    plan: "free" | "basic";
    used: number;
    limit: number;
    remaining: number;
  };
};

export async function getVideoQuota(): Promise<VideoQuota> {
  if (!API_URL) throw new Error("NEXT_PUBLIC_WCS_API_URL is not set");
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}/analyze/video/quota`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore
    }
    throw new Error(`Quota check failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as VideoQuota;
}

export type AdminStats = {
  total_users: number;
  signups_this_month: number;
  signups_this_week: number;
  total_video_analyses: number;
  total_music_analyses: number;
  active_users_7d: number;
  active_users_30d: number;
  total_feature_requests: number;
  // Gemini spend — admin-only, never shown to end users.
  cost_total_usd?: number;
  cost_last_7d_usd?: number;
  cost_last_30d_usd?: number;
  total_tokens?: number;
  recent_signups: Array<{
    id: string;
    email: string;
    plan: string;
    created_at: string;
  }>;
  recent_analyses: Array<{
    id: string;
    filename: string;
    duration: number;
    created_at: string;
    email: string;
    model?: string | null;
    cost_usd?: number;
  }>;
  recent_feature_requests: Array<{
    id: string;
    email: string | null;
    title: string;
    description: string | null;
    created_at: string;
  }>;
};

export async function getAdminStats(): Promise<AdminStats> {
  if (!API_URL) throw new Error("NEXT_PUBLIC_WCS_API_URL is not set");
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}/admin/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore
    }
    throw new Error(`Admin stats failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as AdminStats;
}

export type PresignResponse = {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
};

export async function getPresignedUploadUrl(
  filename: string,
  contentType: string
): Promise<PresignResponse> {
  return postJson<PresignResponse>("/uploads/presign", {
    filename,
    content_type: contentType || "application/octet-stream",
  });
}

export type UploadErrorKind =
  | "network"
  | "timeout"
  | "offline"
  | "expired"
  | "storage"
  | "aborted"
  | "unknown";

export class UploadError extends Error {
  kind: UploadErrorKind;
  status: number;
  constructor(kind: UploadErrorKind, message: string, status = 0) {
    super(message);
    this.name = "UploadError";
    this.kind = kind;
    this.status = status;
  }
  /** True when retrying is likely to help (as opposed to a config bug). */
  get retryable(): boolean {
    return (
      this.kind === "network" ||
      this.kind === "timeout" ||
      this.kind === "expired" ||
      (this.kind === "storage" && this.status >= 500)
    );
  }
}

/**
 * PUT a file directly to the presigned URL. Uses XHR (not fetch) because
 * only XHR exposes upload progress events. Throws a classified
 * `UploadError` so callers can retry the transient failures and
 * surface useful messages for the rest.
 */
export function uploadToPresignedUrl(
  url: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      reject(
        new UploadError(
          "offline",
          "You appear to be offline. Check your internet connection."
        )
      );
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    // 10-minute hard ceiling — stops a dead connection from hanging
    // the UI indefinitely on large clips. Most uploads complete in
    // under 2 minutes even on modest wifi.
    xhr.timeout = 10 * 60 * 1000;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      // R2 returns 403 when the presigned URL has expired or been
      // tampered with. We classify that separately so callers can
      // request a fresh URL on retry.
      if (xhr.status === 403) {
        reject(
          new UploadError(
            "expired",
            "Upload link expired — retrying with a fresh link.",
            403
          )
        );
        return;
      }
      reject(
        new UploadError(
          "storage",
          `Storage rejected the upload (${xhr.status}).`,
          xhr.status
        )
      );
    };
    xhr.onerror = () => {
      // Status 0 means the browser blocked the response reading —
      // either a real network drop or a CORS preflight denied.
      // We can't distinguish reliably, so report as network and let
      // the caller retry; a persistent failure will surface with
      // our follow-up diagnostic copy below.
      reject(
        new UploadError(
          "network",
          "Connection dropped during upload. Retrying…"
        )
      );
    };
    xhr.ontimeout = () =>
      reject(
        new UploadError(
          "timeout",
          "Upload timed out. Try again on a stronger connection."
        )
      );
    xhr.onabort = () =>
      reject(new UploadError("aborted", "Upload was cancelled."));
    xhr.send(file);
  });
}

export type VideoAnalyzeOptions = {
  role?: string;
  competitionLevel?: string;
  eventName?: string;
  eventDate?: string; // YYYY-MM-DD
  stage?: string;
  tags?: string[];
  // Free-text description of which dancer / couple to focus on
  // when multiple people are in frame (e.g. "couple in the red
  // dress and blue shirt", "the lead on the far right").
  dancerDescription?: string;
  // Opt-in: keep the video in R2 after analysis so the user can
  // replay it against the pattern timeline. Default off — we
  // delete the clip right after scoring otherwise.
  storeVideo?: boolean;
};

export async function analyzeVideoFromKey(
  objectKey: string,
  filename: string,
  options: VideoAnalyzeOptions = {}
): Promise<VideoAnalysisResponse> {
  return postJson<VideoAnalysisResponse>("/analyze/video", {
    object_key: objectKey,
    filename,
    role: options.role || null,
    competition_level: options.competitionLevel || null,
    event_name: options.eventName || null,
    event_date: options.eventDate || null,
    stage: options.stage || null,
    tags: options.tags && options.tags.length ? options.tags : null,
    dancer_description: options.dancerDescription || null,
    store_video: Boolean(options.storeVideo),
  });
}

export async function getViewUrl(objectKey: string): Promise<string> {
  const data = await postJson<{ url: string }>("/uploads/view", {
    object_key: objectKey,
  });
  return data.url;
}

export async function deleteUploadedVideo(objectKey: string): Promise<void> {
  await postJson<{ ok: boolean }>("/uploads/delete", {
    object_key: objectKey,
  });
}

// ───────────────────────────────────────────────────────────────────
// Public shared-analysis read (no JWT)
// ───────────────────────────────────────────────────────────────────

export type SharedAnalysis = {
  id: string;
  filename: string | null;
  duration: number | null;
  result: VideoScoreResult;
  role?: string | null;
  competition_level?: string | null;
  event_name?: string | null;
  stage?: string | null;
  tags?: string[] | null;
  created_at: string;
  // Populated server-side on real browser views — link-preview
  // bots don't count.
  share_view_count?: number;
  share_last_viewed_at?: string | null;
};

export async function fetchSharedAnalysis(
  token: string
): Promise<SharedAnalysis> {
  if (!API_URL) throw new Error("NEXT_PUBLIC_WCS_API_URL is not set");
  // The custom header tells the backend this is a real frontend
  // navigation (not a Slack/Twitter unfurl), so the view counter
  // increments. Bots can't forge custom request headers via the
  // standard OpenGraph scrape path — they just do a plain GET.
  const res = await fetch(
    `${API_URL}/shared/${encodeURIComponent(token)}`,
    { headers: { "X-Swingflow-View": "1" } }
  );
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore
    }
    throw new Error(`Shared analysis fetch failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as SharedAnalysis;
}
