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
};

export type VideoPartnerScore = {
  technique_score?: number;
  presentation_score?: number;
  notes?: string;
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
  strengths: string[];
  improvements: string[];
  lead?: VideoPartnerScore;
  follow?: VideoPartnerScore;
  estimated_bpm?: number;
  song_style?: string;
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

export async function analyzeVideo(
  file: File
): Promise<VideoAnalysisResponse> {
  if (!API_URL) throw new Error("NEXT_PUBLIC_WCS_API_URL is not set");
  const token = await getAccessToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/analyze/video`, {
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
    throw new Error(`Video analysis failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as VideoAnalysisResponse;
}
