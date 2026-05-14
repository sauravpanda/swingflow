"use client";

/**
 * Public reviewer page. Unauthenticated — anyone with the link can
 * watch the video and submit scores. We deliberately do NOT show the
 * AI score here, to avoid priming the reviewer's judgment.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fetchPublicReview,
  submitPublicReview,
  type PeerReviewerRole,
  type PublicReviewContext,
} from "@/lib/wcs-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pin,
  Trash2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatPinTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PeerReviewPage() {
  // useSearchParams needs a Suspense boundary under Next's static
  // export mode, otherwise the whole page falls back to client-only
  // rendering warnings at build time.
  return (
    <Suspense fallback={null}>
      <PeerReviewInner />
    </Suspense>
  );
}

function PeerReviewInner() {
  const params = useSearchParams();
  const token = params.get("t");

  const [ctx, setCtx] = useState<PublicReviewContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerRole, setReviewerRole] =
    useState<PeerReviewerRole>("dancer");
  // Scores deliberately start UNSET (null). Anchoring at "7" produced
  // "drive-by 7/7/7/7" submissions where the reviewer never moved the
  // sliders and left no notes — bad data we then averaged against the
  // AI score. Comment-first: the reviewer has to actively decide to
  // rate a category, or skip it.
  const [timing, setTiming] = useState<number | null>(null);
  const [technique, setTechnique] = useState<number | null>(null);
  const [teamwork, setTeamwork] = useState<number | null>(null);
  const [presentation, setPresentation] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  // Opt-in to use this review to improve the AI. Default false;
  // stays off unless the reviewer actively checks the box.
  const [trainingConsent, setTrainingConsent] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Timestamped comments pinned to specific moments in the clip.
  // Reviewers get a "Pin at current time" button over the video and
  // can compose short comments against the second they saw the
  // issue (#127). Max of MAX_PINS to keep the UI/timeline readable.
  const [pins, setPins] = useState<
    Array<{ timestamp_sec: number; note: string }>
  >([]);
  const [pinDraft, setPinDraft] = useState<{
    timestamp_sec: number;
    note: string;
  } | null>(null);
  const MAX_PINS = 20;
  const MAX_PIN_CHARS = 200;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPublicReview(token);
        if (cancelled) return;
        setCtx(data);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Comment-first: a name + literally nothing else used to be a valid
  // submission. Now require at least one signal — a written note, a
  // pin with text, or at least one rated category.
  const hasSignal = useMemo(() => {
    const hasOverall = notes.trim().length > 0;
    const hasPin = pins.some((p) => p.note.trim().length > 0);
    const hasScore =
      timing != null ||
      technique != null ||
      teamwork != null ||
      presentation != null;
    return hasOverall || hasPin || hasScore;
  }, [notes, pins, timing, technique, teamwork, presentation]);

  const canSubmit = useMemo(() => {
    return (
      !!ctx &&
      !ctx.already_submitted &&
      reviewerName.trim().length > 0 &&
      hasSignal &&
      !submitting
    );
  }, [ctx, reviewerName, hasSignal, submitting]);

  const handleSubmit = async () => {
    if (!token || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPublicReview(token, {
        reviewer_name: reviewerName.trim(),
        reviewer_role: reviewerRole,
        timing_score: timing,
        technique_score: technique,
        teamwork_score: teamwork,
        presentation_score: presentation,
        overall_notes: notes.trim() || null,
        per_moment_notes: pins
          .map((p) => ({
            timestamp_sec: Math.round(p.timestamp_sec * 10) / 10,
            note: p.note.trim(),
          }))
          .filter((p) => p.note.length > 0),
        training_consent: trainingConsent,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !ctx) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-6 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
            <h1 className="font-semibold">Review link not available</h1>
            <p className="text-sm text-muted-foreground">
              {error ||
                "This review link is invalid, expired, or the linked video was deleted."}
            </p>
            <Link href="/">
              <Button variant="outline">Go to SwingFlow</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted || ctx.already_submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-6 text-center space-y-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto" />
            <h1 className="font-semibold">Thanks for your review</h1>
            <p className="text-sm text-muted-foreground">
              {submitted
                ? "Your scores have been shared with the dancer."
                : "This review has already been submitted."}
            </p>
            <Link href="/">
              <Button variant="outline">About SwingFlow</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <header className="space-y-2">
          <Link
            href="/"
            className="inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← SwingFlow
          </Link>
          <h1 className="text-2xl font-bold">Peer review</h1>
          <p className="text-sm text-muted-foreground">
            A dancer has asked for your feedback on this clip. Watch the
            video and leave at least one comment, pinned moment, or
            category rating. Your feedback goes only to the dancer.
          </p>
        </header>

        <ContextCard ctx={ctx} />

        {(ctx.requester_prompt || (ctx.focus_categories?.length ?? 0) > 0) && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                What the dancer wants feedback on
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {ctx.requester_prompt && (
                <p className="whitespace-pre-wrap text-foreground">
                  {ctx.requester_prompt}
                </p>
              )}
              {ctx.focus_categories && ctx.focus_categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ctx.focus_categories.map((c) => (
                    <Badge key={c} variant="secondary" className="capitalize">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0 overflow-hidden">
            {ctx.video_url ? (
              <video
                ref={videoRef}
                src={ctx.video_url}
                controls
                playsInline
                className="w-full bg-black"
              />
            ) : (
              <div className="p-6 text-sm text-muted-foreground text-center">
                The video is no longer available. You can still leave
                comments below if you saw it elsewhere.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Timestamped pins — reviewers click at a specific second
            and leave a short comment tied to that moment. This is
            the most useful thing humans add over the AI score: "at
            0:34 you anchored late" beats "Timing: 7/10" every time.
            Hidden when the video is unavailable. See #127. */}
        {ctx.video_url && (
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Pin className="h-4 w-4 text-primary" />
                  Pin a comment at a specific moment
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pause at the moment you want to comment on, then
                  click &ldquo;Pin here.&rdquo; Dancers find
                  &ldquo;anchor late at 0:34&rdquo; more actionable
                  than a category score.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pins.length >= MAX_PINS || pinDraft !== null}
                onClick={() => {
                  const t = videoRef.current?.currentTime ?? 0;
                  setPinDraft({ timestamp_sec: t, note: "" });
                }}
                title={
                  pins.length >= MAX_PINS
                    ? `Max ${MAX_PINS} pins per review`
                    : "Pin at the current playback time"
                }
              >
                <Pin className="h-3.5 w-3.5 sm:mr-2" />
                <span className="hidden sm:inline">Pin here</span>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Draft composer — appears when user clicks Pin and
                  disappears when they Save or Cancel. Kept
                  single-active so the UI doesn't turn into a
                  comment-thread mess. */}
              {pinDraft && (
                <div className="rounded-md border border-primary/50 bg-primary/5 p-2.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono tabular-nums font-medium">
                      {formatPinTime(pinDraft.timestamp_sec)}
                    </span>
                    <span className="text-muted-foreground">
                      Pinned to this moment
                    </span>
                  </div>
                  <textarea
                    value={pinDraft.note}
                    onChange={(e) =>
                      setPinDraft({
                        ...pinDraft,
                        note: e.target.value.slice(0, MAX_PIN_CHARS),
                      })
                    }
                    autoFocus
                    rows={2}
                    maxLength={MAX_PIN_CHARS}
                    placeholder="e.g. Anchor hit late — settled on 7 instead of 5 & 6."
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {pinDraft.note.length} / {MAX_PIN_CHARS}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setPinDraft(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={pinDraft.note.trim().length === 0}
                        onClick={() => {
                          setPins((prev) =>
                            [...prev, pinDraft].sort(
                              (a, b) => a.timestamp_sec - b.timestamp_sec
                            )
                          );
                          setPinDraft(null);
                        }}
                      >
                        Save pin
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {/* Saved pins list — each row seeks the video back to
                  the pinned second on click. */}
              {pins.length === 0 && !pinDraft && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No pins yet. This is optional — leave category
                  scores below even if you skip pins.
                </p>
              )}
              {pins.map((p, i) => (
                <div
                  key={`${p.timestamp_sec}-${i}`}
                  className="flex items-start gap-2 rounded-md border border-border bg-muted/10 p-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const v = videoRef.current;
                      if (v) {
                        v.currentTime = p.timestamp_sec;
                        v.play().catch(() => {
                          /* autoplay may be blocked */
                        });
                      }
                    }}
                    className="font-mono tabular-nums text-primary hover:underline shrink-0"
                    title="Jump to this moment"
                  >
                    {formatPinTime(p.timestamp_sec)}
                  </button>
                  <p className="flex-1 min-w-0 text-muted-foreground whitespace-pre-wrap break-words">
                    {p.note}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setPins((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    aria-label="Remove pin"
                    title="Remove pin"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">About you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reviewer-name">Your name</Label>
              <Input
                id="reviewer-name"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="e.g. Alex Chen"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reviewer-role">Your role</Label>
              <Select
                value={reviewerRole}
                onValueChange={(v) => setReviewerRole(v as PeerReviewerRole)}
              >
                <SelectTrigger id="reviewer-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dancer">Dancer</SelectItem>
                  <SelectItem value="instructor">Instructor</SelectItem>
                  <SelectItem value="judge">WSDC judge</SelectItem>
                  <SelectItem value="friend">Friend / watcher</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Your scores{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (1–10, optional)
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Each category is unrated until you click <em>Rate</em>. Skip
              what you don&rsquo;t feel qualified to call.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <ScoreRow
              label="Timing"
              help="On the beat? Clean triples, anchor on 5 & 6."
              value={timing}
              onChange={setTiming}
            />
            <ScoreRow
              label="Technique"
              help="Posture, extension, footwork, slot discipline."
              value={technique}
              onChange={setTechnique}
            />
            <ScoreRow
              label="Teamwork"
              help="Partnership connection, shared weight, recovery."
              value={teamwork}
              onChange={setTeamwork}
            />
            <ScoreRow
              label="Presentation"
              help="Musicality, styling, stage presence."
              value={presentation}
              onChange={setPresentation}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Overall notes (optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="What stood out? Anything specific to work on?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={trainingConsent}
                onCheckedChange={(v) =>
                  setTrainingConsent(v === true)
                }
                className="mt-0.5"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-snug">
                  It's OK to use my review to improve SwingFlow's AI
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Optional — off by default. If checked, we may use
                  your scores and notes (along with the AI's score on
                  the same clip) to calibrate and fine-tune the
                  scoring model. Your name is stored with the review
                  but isn't published anywhere outside the dancer you're
                  reviewing for.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="space-y-2">
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit review"
            )}
          </Button>
          {!hasSignal && reviewerName.trim().length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Leave at least one note, pin a moment, or rate a category
              to submit.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextCard({ ctx }: { ctx: PublicReviewContext }) {
  const chips: Array<{ label: string; value: string }> = [];
  if (ctx.context.role)
    chips.push({ label: "Role", value: ctx.context.role });
  if (ctx.context.competition_level)
    chips.push({ label: "Level", value: ctx.context.competition_level });
  if (ctx.context.event_name)
    chips.push({ label: "Event", value: ctx.context.event_name });
  if (ctx.context.stage)
    chips.push({ label: "Stage", value: ctx.context.stage });
  if (ctx.context.event_date)
    chips.push({ label: "Date", value: ctx.context.event_date });

  if (chips.length === 0 && !ctx.context.dancer_description) return null;

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <Badge variant="outline" key={c.label}>
                {c.label}: {c.value}
              </Badge>
            ))}
          </div>
        )}
        {ctx.context.dancer_description && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Who to watch:</span>{" "}
            {ctx.context.dancer_description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreRow({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const SCORE_MID = 7;
  const isSet = value != null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        <div className="flex items-center gap-2">
          <span
            className={
              "text-sm font-mono tabular-nums font-semibold " +
              (isSet ? "" : "text-muted-foreground")
            }
          >
            {isSet ? value!.toFixed(1) : "—"}
          </span>
          <button
            type="button"
            onClick={() => onChange(isSet ? null : SCORE_MID)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            aria-label={isSet ? `Skip rating ${label}` : `Rate ${label}`}
          >
            {isSet ? "Skip" : "Rate"}
          </button>
        </div>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={0.1}
        value={value ?? SCORE_MID}
        disabled={!isSet}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}
