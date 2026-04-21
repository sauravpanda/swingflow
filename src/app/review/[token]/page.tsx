"use client";

/**
 * Public reviewer page. Unauthenticated — anyone with the link can
 * watch the video and submit scores. We deliberately do NOT show the
 * AI score here, to avoid priming the reviewer's judgment.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
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
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function PeerReviewPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [ctx, setCtx] = useState<PublicReviewContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerRole, setReviewerRole] =
    useState<PeerReviewerRole>("dancer");
  const [timing, setTiming] = useState<number>(7);
  const [technique, setTechnique] = useState<number>(7);
  const [teamwork, setTeamwork] = useState<number>(7);
  const [presentation, setPresentation] = useState<number>(7);
  const [notes, setNotes] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  const canSubmit = useMemo(() => {
    return (
      !!ctx &&
      !ctx.already_submitted &&
      reviewerName.trim().length > 0 &&
      !submitting
    );
  }, [ctx, reviewerName, submitting]);

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
            video, then score them on the four WSDC categories (timing,
            technique, teamwork, presentation). Your scores and notes
            will be shared only with the dancer.
          </p>
        </header>

        <ContextCard ctx={ctx} />

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
            <CardTitle className="text-base">Your scores (1–10)</CardTitle>
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

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

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
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="text-sm font-mono tabular-nums font-semibold">
          {value.toFixed(1)}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}
