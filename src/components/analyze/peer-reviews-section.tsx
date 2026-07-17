"use client";

/**
 * Shows the owner (a) a button to request a new peer review, and
 * (b) any submitted reviews alongside pending-but-not-yet-responded
 * requests. Deliberately kept compact so it can slot under the AI
 * score without competing with it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deletePeerReview,
  listPeerReviews,
  requestPeerReview,
  type PeerReview,
  type ReviewBrief,
} from "@/lib/wcs-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  Copy,
  Loader2,
  MessageSquare,
  Pin,
  UserPlus,
  X,
} from "lucide-react";

type FocusCategory = NonNullable<ReviewBrief["focus_categories"]>[number];
const FOCUS_CATEGORIES: Array<{ key: FocusCategory; label: string }> = [
  { key: "timing", label: "Timing" },
  { key: "technique", label: "Technique" },
  { key: "teamwork", label: "Teamwork" },
  { key: "presentation", label: "Presentation" },
];

function formatPinTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const CATEGORIES: Array<{ key: keyof PeerReview; label: string }> = [
  { key: "timing_score", label: "Timing" },
  { key: "technique_score", label: "Technique" },
  { key: "teamwork_score", label: "Teamwork" },
  { key: "presentation_score", label: "Presentation" },
];

export function PeerReviewsSection({ analysisId }: { analysisId: string }) {
  const [pending, setPending] = useState<PeerReview[]>([]);
  const [submitted, setSubmitted] = useState<PeerReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  // Brief dialog state — comment-first flow. Sending an empty brief
  // is still valid (the brief is optional server-side), but the
  // dialog nudges the dancer to say what they actually want feedback
  // on, which is the whole point.
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefPrompt, setBriefPrompt] = useState("");
  const [briefFocus, setBriefFocus] = useState<Set<FocusCategory>>(
    () => new Set()
  );

  const refresh = useCallback(async () => {
    try {
      const data = await listPeerReviews(analysisId);
      setPending(data.pending);
      setSubmitted(data.submitted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRequest = async () => {
    setRequesting(true);
    setError(null);
    try {
      const brief: ReviewBrief = {
        requester_prompt: briefPrompt.trim() || null,
        focus_categories: Array.from(briefFocus),
      };
      const { url } = await requestPeerReview(analysisId, brief);
      // Try to copy immediately so the user can paste into a DM /
      // message / email. Falls back to showing the URL in the row if
      // clipboard isn't available.
      try {
        await navigator.clipboard.writeText(url);
        setCopiedToken(url);
        setTimeout(() => setCopiedToken(null), 2000);
      } catch {
        // ignore — the link will be visible in the pending row
      }
      setBriefOpen(false);
      setBriefPrompt("");
      setBriefFocus(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(false);
    }
  };

  const toggleFocus = (c: FocusCategory) => {
    setBriefFocus((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const handleCopy = async (token: string) => {
    const url = `${window.location.origin}/peer-review?t=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleRevoke = async (id: string) => {
    setError(null);
    try {
      await deletePeerReview(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const aggregate = useMemo(() => {
    if (submitted.length === 0) return null;
    const totals: Record<string, { sum: number; n: number }> = {};
    for (const r of submitted) {
      for (const c of CATEGORIES) {
        const v = r[c.key];
        if (typeof v === "number" && Number.isFinite(v)) {
          totals[c.key] ??= { sum: 0, n: 0 };
          totals[c.key].sum += v;
          totals[c.key].n += 1;
        }
      }
    }
    const avg: Record<string, number | null> = {};
    for (const c of CATEGORIES) {
      const t = totals[c.key];
      avg[c.key] = t && t.n > 0 ? t.sum / t.n : null;
    }
    return avg;
  }, [submitted]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading peer reviews…
        </CardContent>
      </Card>
    );
  }

  const hasAny = pending.length > 0 || submitted.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Peer reviews
            {submitted.length > 0 && (
              <Badge variant="secondary">{submitted.length}</Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBriefOpen(true)}
            disabled={requesting}
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Ask someone
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!hasAny && (
          <p className="text-sm text-muted-foreground">
            Get a second opinion from a coach, a training partner, or a
            judge friend. Click{" "}
            <span className="font-medium">Ask someone</span> to generate a
            private link — they don't need an account to leave a score.
          </p>
        )}

        {aggregate && submitted.length > 0 && (
          <div className="rounded-md border border-border/60 p-3 space-y-2 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                Average of {submitted.length} review
                {submitted.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CATEGORIES.map((c) => {
                const v = aggregate[c.key as string];
                return (
                  <div key={c.key as string} className="text-xs">
                    <div className="text-muted-foreground">{c.label}</div>
                    <div className="text-base font-mono tabular-nums font-semibold">
                      {v != null ? v.toFixed(1) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {submitted.map((r) => (
          <ReviewCard
            key={r.id}
            review={r}
            onRevoke={() => handleRevoke(r.id)}
          />
        ))}

        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Awaiting response ({pending.length})
            </p>
            {pending.map((r) => {
              const url = `${typeof window !== "undefined" ? window.location.origin : ""}/peer-review?t=${encodeURIComponent(r.token)}`;
              const isCopied = copiedToken === r.token || copiedToken === url;
              return (
                <div
                  key={r.id}
                  className="rounded-md border border-border/60 p-3 flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <code className="text-xs text-muted-foreground truncate block">
                      {url}
                    </code>
                    {/* Echo the brief so the owner can tell multiple
                        outstanding requests apart ("the anchor one"
                        vs "the connection one"). */}
                    {r.requester_prompt && (
                      <p className="text-[11px] text-foreground/80 mt-1 line-clamp-2">
                        &ldquo;{r.requester_prompt}&rdquo;
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>
                        Requested{" "}
                        {new Date(r.requested_at).toLocaleDateString()}
                      </span>
                      {(r.focus_categories ?? []).map((c) => (
                        <Badge
                          key={c}
                          variant="outline"
                          className="text-[9px] px-1 py-0 h-3.5 capitalize"
                        >
                          {c}
                        </Badge>
                      ))}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopy(r.token)}
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRevoke(r.id)}
                    title="Revoke"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog
        open={briefOpen}
        onOpenChange={(open) => {
          if (requesting) return;
          setBriefOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ask someone for feedback</DialogTitle>
            <DialogDescription>
              Tell the reviewer what to look at. A focused question gets a
              focused answer — &ldquo;does my anchor settle on 5–6?&rdquo; beats
              &ldquo;score me out of 10.&rdquo;
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="brief-prompt" className="text-sm">
                What do you want feedback on?{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <textarea
                id="brief-prompt"
                value={briefPrompt}
                onChange={(e) => setBriefPrompt(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="e.g. My anchors keep feeling rushed. Does my weight settle on 5-6, or am I leaving early?"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">
                Focus areas{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {FOCUS_CATEGORIES.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 text-sm cursor-pointer rounded-md border border-border/60 px-2.5 py-1.5 hover:bg-muted/30"
                  >
                    <Checkbox
                      checked={briefFocus.has(c.key)}
                      onCheckedChange={() => toggleFocus(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBriefOpen(false)}
              disabled={requesting}
            >
              Cancel
            </Button>
            <Button onClick={handleRequest} disabled={requesting}>
              {requesting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Generating link…
                </>
              ) : (
                "Generate review link"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ReviewCard({
  review,
  onRevoke,
}: {
  review: PeerReview;
  onRevoke: () => void;
}) {
  const submittedAt = review.submitted_at
    ? new Date(review.submitted_at).toLocaleDateString()
    : null;
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {review.reviewer_name || "Anonymous reviewer"}
            </span>
            {review.reviewer_role && (
              <Badge variant="outline" className="text-[10px]">
                {review.reviewer_role}
              </Badge>
            )}
          </div>
          {submittedAt && (
            <p className="text-[11px] text-muted-foreground">
              Reviewed {submittedAt}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRevoke}
          title="Remove this review"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* What the owner asked for, alongside the answer — reviews
          only make sense against the question that prompted them. */}
      {review.requester_prompt && (
        <p className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic">
          You asked: &ldquo;{review.requester_prompt}&rdquo;
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {CATEGORIES.map((c) => {
          const v = review[c.key];
          return (
            <div key={c.key as string} className="text-xs">
              <div className="text-muted-foreground">{c.label}</div>
              <div className="text-sm font-mono tabular-nums font-semibold">
                {typeof v === "number" ? v.toFixed(1) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Timestamped pins from the reviewer (#127). Rendered as a
          compact list of time + note pairs — the most useful thing
          humans add over the AI score. */}
      {review.per_moment_notes && review.per_moment_notes.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Pin className="h-3 w-3" />
            <span className="uppercase tracking-wide font-medium">
              Pinned moments
            </span>
            <span className="tabular-nums">
              ({review.per_moment_notes.length})
            </span>
          </div>
          <div className="space-y-1">
            {review.per_moment_notes
              .slice()
              .sort((a, b) => a.timestamp_sec - b.timestamp_sec)
              .map((p, i) => (
                <div
                  key={`pin-${i}-${p.timestamp_sec}`}
                  className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-2 text-sm"
                >
                  <span className="font-mono tabular-nums text-primary shrink-0">
                    {formatPinTime(p.timestamp_sec)}
                  </span>
                  <p className="flex-1 min-w-0 text-muted-foreground whitespace-pre-wrap break-words">
                    {p.note}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {review.overall_notes && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {review.overall_notes}
        </p>
      )}
    </div>
  );
}
