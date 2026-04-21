"use client";

// Play-along practice: user picks one of their past analyses, drops
// a local video clip, and plays the clip against the chosen
// analysis's beat map + pattern timeline at 0.25-1.5x. Local clips
// stay in the browser — no upload.
//
// Moved here from the analysis page (which originally owned this
// feature) because it's a practice activity, not an analysis
// artifact. The analysis page keeps its own primary-video player
// for the stored clip.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FileVideo, X, Clapperboard } from "lucide-react";
import { TimelineView } from "@/components/analyze/timeline-view";
import { useAnalysisHistory } from "@/hooks/use-analysis-history";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function PlayAlongCard() {
  const history = useAnalysisHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localVideo, setLocalVideo] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Default the picker to the user's most recent analysis once
  // history loads — saves a click for the common case.
  useEffect(() => {
    if (selectedId || history.loading) return;
    const first = history.records[0];
    if (first) setSelectedId(first.id);
  }, [history.loading, history.records, selectedId]);

  // Revoke the object URL on clip change / unmount. Leaking these
  // pins 100s of MB per session if the user tries a handful of clips.
  useEffect(() => {
    if (!localVideo) return;
    return () => {
      URL.revokeObjectURL(localVideo.url);
    };
  }, [localVideo]);

  const handleLocalFile = useCallback((file: File) => {
    if (!file.type.startsWith("video/")) return;
    const url = URL.createObjectURL(file);
    setLocalVideo({ url, name: file.name });
  }, []);

  const clearLocalVideo = useCallback(() => {
    setLocalVideo(null);
  }, []);

  const record = useMemo(
    () => history.records.find((r) => r.id === selectedId) ?? null,
    [history.records, selectedId]
  );

  // Empty-state: no analyses yet → nudge toward /analyze instead of
  // rendering a dead picker.
  if (!history.loading && history.records.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Play along with a clip</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>
            Drop any video and play it against a beat map at 0.25&ndash;1.5x
            &mdash; great for slow-scrubbing your own clips, a pro&rsquo;s
            moves, or a YouTube download.
          </p>
          <p>
            You need at least one analysis first so we have a beat map and
            pattern timeline to play against.
          </p>
          <Button asChild size="sm">
            <Link href="/analyze">Analyze a clip</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Play along with a clip</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Drop any video and play it against one of your analyses&rsquo; beat
          maps at 0.25&ndash;1.5x. The clip stays in your browser &mdash;
          nothing is uploaded.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Beat map from
          </label>
          <Select
            value={selectedId ?? undefined}
            onValueChange={(v) => setSelectedId(v)}
            disabled={history.loading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a past analysis" />
            </SelectTrigger>
            <SelectContent>
              {history.records.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="truncate">
                    {r.filename ?? "Untitled"}
                  </span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {formatDate(r.created_at)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className={
            "rounded-md border border-dashed p-3 text-xs transition-colors " +
            (dragging
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/10")
          }
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleLocalFile(f);
          }}
        >
          {localVideo ? (
            <div className="flex items-center gap-2">
              <FileVideo className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  Practice clip: {localVideo.name}
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Use the speed control on the timeline for slow practice.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearLocalVideo}
                className="h-7"
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <FileVideo className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground flex-1 min-w-[180px]">
                Drop a video here (or pick one) to play it against the
                selected beat map.
              </span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted/40 transition-colors">
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLocalFile(f);
                    // Reset so selecting the same file twice still fires.
                    e.target.value = "";
                  }}
                />
                Choose video
              </label>
            </div>
          )}
        </div>

        {record && localVideo && (
          <div className="pt-1">
            <TimelineView
              result={record.result}
              duration={record.duration ?? 0}
              videoSrc={localVideo.url}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
