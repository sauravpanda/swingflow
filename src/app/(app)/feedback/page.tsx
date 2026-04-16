"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUser } from "@/hooks/use-user";

export default function FeedbackPage() {
  const { user } = useUser();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !user) {
      setError("You need to be signed in to submit feedback.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const sb = getSupabase();
    const { error: insertError } = await sb.from("feature_requests").insert({
      user_id: user.id,
      email: user.email ?? null,
      title: title.trim(),
      description: description.trim() || null,
    });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSubmitted(true);
    setTitle("");
    setDescription("");
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Feedback & feature requests</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Something broken? A feature you wish existed? Tell us.
        </p>
      </div>

      {submitted && (
        <Card className="border-primary/40">
          <CardContent className="py-5 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Thanks — we got it.</p>
              <p className="text-muted-foreground mt-1">
                Your feedback is in the queue. Submit another below, or head
                back to{" "}
                <Link href="/dashboard" className="underline">
                  the dashboard
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Loop a single 8-count phrase"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                One line. What do you want?
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <textarea
                id="description"
                rows={5}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="I practice the same hard transition for 20 minutes straight — would love to lock a single 4-second segment and loop it instead of scrubbing back every time."
                disabled={submitting}
                className="flex min-h-[88px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
              />
              <p className="text-xs text-muted-foreground">
                Context helps — when you&rsquo;d use it, what&rsquo;s
                missing today.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || !title.trim()}
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Send feedback
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        We read every submission. If it fits the roadmap, we&rsquo;ll build it.
      </p>
    </div>
  );
}
