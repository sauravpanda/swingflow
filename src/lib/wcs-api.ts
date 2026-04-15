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

export type VideoCategoryScore = {
  score: number;
  notes: string;
};

export type VideoScoreResult = {
  overall: { score: number; grade: string };
  categories: {
    timing: VideoCategoryScore;
    technique: VideoCategoryScore;
    teamwork: VideoCategoryScore;
    presentation: VideoCategoryScore;
  };
  strengths: string[];
  improvements: string[];
};

export type VideoQuota = {
  plan: "free" | "pro";
  used: number;
  limit: number;
  max_seconds: number;
  remaining: number;
};

export type VideoAnalysisResponse = {
  duration: number;
  result: VideoScoreResult;
  quota: {
    plan: "free" | "pro";
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
    throw new Error(`Quota check failed (${res.status})`);
  }
  return (await res.json()) as VideoQuota;
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
