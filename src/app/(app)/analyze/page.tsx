"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Target,
  Quote,
  Share2,
  Link2Off,
  Copy,
  Eye,
} from "lucide-react";
import { useVideoAnalysis } from "@/hooks/use-video-analysis";
import { useAnalysisHistory, type AnalysisRecord } from "@/hooks/use-analysis-history";
import { getLevelContext } from "@/lib/level-context";
import {
  analyzeVideoFromKey,
  deleteUploadedVideo,
  getViewUrl,
  type VideoScoreResult,
} from "@/lib/wcs-api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimelineView } from "@/components/analyze/timeline-view";
import { ScoreResultCard } from "@/components/analyze/score-result-card";
import { Analytics } from "@/lib/analytics";

const ROLE_OPTIONS = ["Lead", "Follow", "Solo"] as const;
const LEVEL_OPTIONS = [
  "Newcomer",
  "Novice",
  "Intermediate",
  "Advanced",
  "All-Star",
  "Champion",
  "Invitational",
] as const;
const STAGE_OPTIONS = [
  "Prelims",
  "Quarterfinals",
  "Semifinals",
  "Finals",
  "Social",
  "Practice",
  "Showcase",
] as const;
const OTHER = "__other__";


// derivePatternSummary moved to
// src/components/analyze/pattern-summary.tsx


function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When an analysis finishes and was successfully persisted, jump
  // to /analysis?id=<id>. That page has the dedicated full-screen
  // layout (video + synced timeline + all cards) and lets the user
  // share the direct link. Falls back to the inline render when
  // the insert didn't return an id (e.g. DB write failed silently).
  const redirectedAnalysisIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== "success") return;
    const id = state.result?.analysis_id;
    if (!id) return;
    // Guard against double-navigation on StrictMode / re-renders.
    if (redirectedAnalysisIdRef.current === id) return;
    redirectedAnalysisIdRef.current = id;
    router.push(`/analysis?id=${encodeURIComponent(id)}`);
  }, [state.status, state.result?.analysis_id, router]);

  // Deep-link: dashboard / chart pass `?id=<analysis-uuid>` to jump
  // straight to a specific analysis. Also handles the "accidentally
  // refreshed mid-analysis" case: if the most recent history row was
  // created in the last ~60s, treat it as a deep-link target so the
  // user sees the result instead of an empty upload card.
  const [targetAnalysisId, setTargetAnalysisId] = useState<string | null>(
    null
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) setTargetAnalysisId(id);
  }, []);

  // Auto-surface a just-completed analysis after an accidental
  // refresh. Only fires when (a) there's no explicit ?id= in the URL,
  // (b) the most recent history row is <60s old, and (c) we haven't
  // already set a target. History is the source of truth — the
  // backend finishes and persists even if the browser disconnects.
  useEffect(() => {
    if (targetAnalysisId) return;
    if (history.loading) return;
    if (history.records.length === 0) return;
    const mostRecent = history.records[0];
    const ageMs = Date.now() - new Date(mostRecent.created_at).getTime();
    if (ageMs < 60_000) {
      setTargetAnalysisId(mostRecent.id);
    }
  }, [history.loading, history.records, targetAnalysisId]);

  // Warn the user before they navigate away / refresh while an
  // analysis is in flight. Upload is cheap to repeat; an analysis
  // in progress is not (a used quota + lost-looking result from the
  // user's perspective), so the browser prompt is worth the
  // friction here.
  useEffect(() => {
    if (state.status !== "uploading" && state.status !== "analyzing") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Most modern browsers ignore the message and show a generic
      // prompt, but returnValue needs to be set for the prompt to
      // appear in Chrome/Firefox.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.status]);

  // Optional metadata — captured pre-upload so it gets saved with the analysis.
  // Each of role / level / stage can be a preset OR free text via "Other".
  const [roleSelect, setRoleSelect] = useState("");
  const [roleCustom, setRoleCustom] = useState("");
  const [levelSelect, setLevelSelect] = useState("");
  const [levelCustom, setLevelCustom] = useState("");
  const [stageSelect, setStageSelect] = useState("");
  const [stageCustom, setStageCustom] = useState("");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [dancerDescription, setDancerDescription] = useState("");
  // Default off — videos get deleted from R2 right after scoring
  // for privacy. Turning it on keeps the clip so the user can
  // replay it against the pattern timeline later.
  const [storeVideo, setStoreVideo] = useState(false);

  const role =
    roleSelect === OTHER ? roleCustom.trim() : roleSelect.trim();
  const competitionLevel =
    levelSelect === OTHER ? levelCustom.trim() : levelSelect.trim();
  const stage =
    stageSelect === OTHER ? stageCustom.trim() : stageSelect.trim();

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
              `Video is ${Math.round(dur)}s; clips must be ${quota.max_seconds}s or less.`
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
    if (!file) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    // <input type="month"> gives us "YYYY-MM"; Postgres date column wants
    // "YYYY-MM-DD" so we pin to the first of the month.
    const normalizedDate = eventDate
      ? `${eventDate}-01`
      : undefined;
    const focus = dancerDescription.trim().slice(0, 200);
    analyze(file, {
      role: role || undefined,
      competitionLevel: competitionLevel || undefined,
      eventName: eventName.trim() || undefined,
      eventDate: normalizedDate,
      stage: stage || undefined,
      tags: tags.length ? tags : undefined,
      dancerDescription: focus || undefined,
      storeVideo,
    }).then(() => history.refresh());
  }, [
    file,
    analyze,
    history,
    role,
    competitionLevel,
    eventName,
    eventDate,
    stage,
    tagsInput,
    dancerDescription,
    storeVideo,
  ]);

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
    <div className="space-y-4 sm:space-y-6 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <Video className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Dance Video Analysis</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Upload a clip to get WSDC-style scoring and feedback
        </p>
      </div>

      {/* Quota card — purely informational. Free for everyone; the
          counter just helps users pace their 2/month allowance. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly usage</CardTitle>
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
              {isPaywalled && state.status !== "success" && (
                <p className="text-xs text-muted-foreground">
                  Your allowance resets on the 1st of next month.
                </p>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* How scoring works — quietly collapsed by default so it
          doesn't dominate the page, but always accessible for users
          wondering what their score is based on. */}
      {state.status !== "success" && <HowScoringWorksInfo />}

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

            {file && state.status === "idle" && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Optional tags (saved with the analysis)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <SelectWithOther
                    id="role"
                    label="Role"
                    options={ROLE_OPTIONS}
                    select={roleSelect}
                    setSelect={setRoleSelect}
                    custom={roleCustom}
                    setCustom={setRoleCustom}
                    customPlaceholder="e.g. both, shadow…"
                  />
                  <SelectWithOther
                    id="level"
                    label="Level"
                    options={LEVEL_OPTIONS}
                    select={levelSelect}
                    setSelect={setLevelSelect}
                    custom={levelCustom}
                    setCustom={setLevelCustom}
                    customPlaceholder="e.g. Open, Rising Star…"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label htmlFor="event" className="text-xs">
                      Event
                    </Label>
                    <Input
                      id="event"
                      placeholder="Boogie by the Bay"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="event-date" className="text-xs">
                      Event month
                    </Label>
                    <Input
                      id="event-date"
                      type="month"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                <SelectWithOther
                  id="stage"
                  label="Stage"
                  options={STAGE_OPTIONS}
                  select={stageSelect}
                  setSelect={setStageSelect}
                  custom={stageCustom}
                  setCustom={setStageCustom}
                  customPlaceholder="e.g. Open Finals, Jack & Jill Invitational…"
                />

                <div className="space-y-1">
                  <Label htmlFor="tags" className="text-xs">
                    Tags
                  </Label>
                  <Input
                    id="tags"
                    placeholder="strictly-swing, showcase, 2026 (comma separated)"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="dancer-focus" className="text-xs">
                    Focus on
                    <span className="ml-1 text-muted-foreground font-normal">
                      (if multiple people in frame)
                    </span>
                  </Label>
                  <Input
                    id="dancer-focus"
                    placeholder="e.g. lead with floral jacket and bib number 433"
                    value={dancerDescription}
                    onChange={(e) =>
                      setDancerDescription(e.target.value.slice(0, 200))
                    }
                    maxLength={200}
                    className="h-8 text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground tabular-nums text-right">
                    {dancerDescription.length}/200
                  </p>
                </div>

                <label
                  htmlFor="store-video"
                  className="flex items-start gap-2 cursor-pointer rounded-md border border-border p-2.5 hover:border-primary/40 transition-colors"
                >
                  <input
                    id="store-video"
                    type="checkbox"
                    checked={storeVideo}
                    onChange={(e) => setStoreVideo(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                  />
                  <span className="text-xs space-y-0.5">
                    <span className="block font-medium">
                      Keep video stored
                    </span>
                    <span className="block text-muted-foreground">
                      Replay the clip later mapped against the pattern
                      timeline + off-beat markers. Off by default — clips
                      are deleted right after scoring. You can delete a
                      stored video any time.
                    </span>
                  </span>
                </label>
              </div>
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
        <>
          <ScoreResultCard
            result={state.result.result}
            duration={state.result.duration}
            competitionLevel={competitionLevel || undefined}
            onClear={handleClear}
          />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pattern timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <TimelineView
                result={state.result.result}
                duration={state.result.duration}
                analysisId={state.result.analysis_id ?? undefined}
              />
            </CardContent>
          </Card>
          {/* Gentle note when the user has now consumed their monthly
              allowance. No upsell — just tells them when it refills. */}
          {isPaywalled && (
            <Card className="border-muted">
              <CardContent className="py-4 text-center text-sm text-muted-foreground">
                That was your last analysis for the month. Your
                allowance resets on the 1st.
              </CardContent>
            </Card>
          )}
        </>
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
                autoExpand={rec.id === targetAnalysisId}
                onReanalyzed={history.refresh}
                onDeleted={history.remove}
                onShare={history.enableSharing}
                onStopShare={history.disableSharing}
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
  autoExpand,
}: {
  record: AnalysisRecord;
  autoExpand?: boolean;
  /** Kept for API compatibility with the old signature; unused now
      because actions moved to the dedicated /analysis page. */
  onReanalyzed?: () => void;
  onDeleted?: (id: string) => Promise<void> | void;
  onShare?: (id: string) => Promise<string>;
  onStopShare?: (id: string) => Promise<void>;
}) {
  const overall = record.result?.overall;
  const tier = overall
    ? overall.score >= 8
      ? "text-emerald-400"
      : overall.score >= 6
      ? "text-primary"
      : overall.score >= 4
      ? "text-amber-400"
      : "text-rose-400"
    : "";
  return (
    <Link
      href={`/analysis?id=${record.id}`}
      className={`block rounded-md border p-3 hover:bg-muted/30 transition-colors ${
        autoExpand
          ? "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
          : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">
            {record.filename || "Untitled"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
            <span>
              {new Date(record.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            {record.role && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {record.role}
              </Badge>
            )}
            {record.competition_level && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {record.competition_level}
              </Badge>
            )}
            {record.event_name && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 max-w-[160px] truncate">
                {record.event_name}
              </Badge>
            )}
            {record.stage && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                {record.stage}
              </Badge>
            )}
            {(record.tags ?? []).slice(0, 3).map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="text-[9px] px-1.5 py-0 h-4"
              >
                #{t}
              </Badge>
            ))}
            {record.object_key && (
              <span
                className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground"
                title="Video stored — timeline maps to replayable clip"
              >
                <Play className="h-2.5 w-2.5" />
                stored
              </span>
            )}
            {record.share_token && (
              <span
                className="inline-flex items-center gap-0.5 text-[9px] text-primary"
                title={
                  (record.share_view_count ?? 0) > 0
                    ? `Shared · ${record.share_view_count} view${record.share_view_count === 1 ? "" : "s"}`
                    : "Shared"
                }
              >
                <Share2 className="h-2.5 w-2.5" />
                {(record.share_view_count ?? 0) > 0 &&
                  `${record.share_view_count}`}
              </span>
            )}
          </div>
        </div>
        {overall && (
          <div className="flex items-center gap-2 shrink-0">
            <span className={`font-mono font-bold tabular-nums ${tier}`}>
              {overall.score?.toFixed?.(1) ?? "—"}
            </span>
            <Badge variant="secondary" className="text-xs">
              {overall.grade ?? "—"}
            </Badge>
          </div>
        )}
      </div>
    </Link>
  );
}

// ScoreResultCard moved to src/components/analyze/score-result-card.tsx

function HowScoringWorksInfo() {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer list-none p-4 text-sm font-medium">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              How scoring works
            </span>
            <span className="text-xs text-muted-foreground group-open:hidden">
              Show details ▾
            </span>
            <span className="text-xs text-muted-foreground hidden group-open:inline">
              Hide ▴
            </span>
          </summary>
          <div className="px-4 pb-4 space-y-4 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-1.5">
                WSDC-style scoring · 4 weighted categories
              </p>
              <ul className="space-y-1">
                <li>
                  <span className="font-mono text-foreground">30%</span>{" "}
                  <span className="font-medium text-foreground">
                    Timing & Rhythm
                  </span>{" "}
                  — on-beat dancing, triple-step precision, anchor-step
                  placement, musical breaks
                </li>
                <li>
                  <span className="font-mono text-foreground">30%</span>{" "}
                  <span className="font-medium text-foreground">
                    Technique
                  </span>{" "}
                  — posture, extension, footwork (heel-toe rolling), slot
                  discipline, frame
                </li>
                <li>
                  <span className="font-mono text-foreground">20%</span>{" "}
                  <span className="font-medium text-foreground">Teamwork</span>{" "}
                  — connection quality, shared weight, responsiveness,
                  matched energy
                </li>
                <li>
                  <span className="font-mono text-foreground">20%</span>{" "}
                  <span className="font-medium text-foreground">
                    Presentation
                  </span>{" "}
                  — musicality, styling, stage presence, creative movement
                </li>
              </ul>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1.5">
                What affects your score
              </p>
              <ul className="space-y-1">
                <li>
                  <span className="font-medium text-foreground">Level</span>{" "}
                  — calibrates the rubric. A Novice at 6.5 and a Champion
                  at 6.5 are judged against different expectations in the
                  written feedback.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Focus on (who)
                  </span>{" "}
                  — when multiple dancers are in frame, this restricts
                  scoring to the identified dancer(s) only.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Role / Event / Stage / Tags
                  </span>{" "}
                  — context for the reasoning. Doesn&apos;t change the
                  rubric; helps you filter and compare later.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Audio quality
                  </span>{" "}
                  — the model listens to the music to judge on-beat
                  dancing. Phone-mic clips are fine; completely silent
                  video hurts Timing scoring.
                </li>
              </ul>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1.5">
                What doesn&apos;t affect it
              </p>
              <ul className="space-y-1">
                <li>
                  Video quality and camera angle (within reason) — the
                  model is tolerant of handheld phone footage
                </li>
                <li>
                  Filename or tags — stored for your reference, not shown
                  to the model
                </li>
                <li>
                  Other analyses in your history — each clip is scored
                  independently
                </li>
              </ul>
            </div>

            <p className="italic">
              Scoring is a tool for reflection — use it to spot patterns
              over time rather than as a definitive judgment on any one
              run. The uncertainty band next to each score is the model&apos;s
              honest confidence interval.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function SelectWithOther({
  id,
  label,
  options,
  select,
  setSelect,
  custom,
  setCustom,
  customPlaceholder,
}: {
  id: string;
  label: string;
  options: readonly string[];
  select: string;
  setSelect: (v: string) => void;
  custom: string;
  setCustom: (v: string) => void;
  customPlaceholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={select} onValueChange={setSelect}>
        <SelectTrigger id={id} className="h-8 text-sm">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>Other…</SelectItem>
        </SelectContent>
      </Select>
      {select === OTHER && (
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={customPlaceholder ?? `Custom ${label.toLowerCase()}`}
          className="h-8 text-sm mt-1"
        />
      )}
    </div>
  );
}

// PatternSummaryCard + derivePatternSummary moved to
// src/components/analyze/pattern-summary.tsx so the shared page
// can reuse them.



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
