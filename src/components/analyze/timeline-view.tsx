"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  VideoPatternIdentified,
  VideoScoreResult,
} from "@/lib/wcs-api";

type TimelineViewProps = {
  result: VideoScoreResult;
  duration: number;
  videoSrc?: string | null;
};

const QUALITY_COLOR: Record<string, string> = {
  strong: "bg-emerald-500/70 border-emerald-400/80 text-emerald-50",
  solid: "bg-primary/70 border-primary/80 text-primary-foreground",
  needs_work: "bg-amber-500/70 border-amber-400/80 text-amber-50",
  weak: "bg-rose-500/70 border-rose-400/80 text-rose-50",
};

const DEFAULT_COLOR =
  "bg-muted-foreground/40 border-muted-foreground/60 text-foreground";

function colorForQuality(quality?: string): string {
  if (!quality) return DEFAULT_COLOR;
  return QUALITY_COLOR[quality] ?? DEFAULT_COLOR;
}

function parseTimestamp(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  // Handle "0:23", "0:23.5", "23s", "23.5"
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => parseFloat(p));
    if (parts.some(Number.isNaN)) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }
  const n = parseFloat(s.replace(/s$/, ""));
  return Number.isFinite(n) ? n : null;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TimelineView({
  result,
  duration,
  videoSrc,
}: TimelineViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState<VideoPatternIdentified | null>(null);
  const [selected, setSelected] = useState<VideoPatternIdentified | null>(null);
  // Video element's actual playback duration, captured on
  // loadedmetadata. Preferred over the ffprobe-reported `duration`
  // prop because the video element is the source of truth for the
  // playhead's position — any mismatch between the two would make
  // pattern blocks visually drift as the video plays. Zero means
  // "not loaded yet; use the prop".
  const [videoDuration, setVideoDuration] = useState(0);
  // On touch devices there's no hover — tap sticks a selection that
  // shows the same detail card below the timeline.
  const detail = hovered ?? selected;

  const effectiveDuration = useMemo(() => {
    // Video element wins once metadata loads — that's the exact
    // timeline the playhead moves along, so patterns positioned
    // against it stay in sync.
    if (videoDuration > 0) return videoDuration;
    if (duration > 0) return duration;
    const fromPatterns = (result.patterns_identified ?? []).reduce(
      (m, p) => Math.max(m, p.end_time ?? 0),
      0
    );
    return Math.max(fromPatterns, 1);
  }, [videoDuration, duration, result.patterns_identified]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onLoadedMetadata = () => {
      if (v.duration && Number.isFinite(v.duration)) {
        setVideoDuration(v.duration);
      }
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("loadedmetadata", onLoadedMetadata);
    // If metadata already loaded (e.g. the element was remounted
    // with a cached video), pick up duration immediately.
    if (v.readyState >= 1) onLoadedMetadata();
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [videoSrc]);

  // Reset captured duration when the src changes so we re-latch
  // onto the new video's metadata instead of reusing the old one.
  useEffect(() => {
    setVideoDuration(0);
  }, [videoSrc]);

  const seek = (t: number) => {
    const clamped = Math.max(0, Math.min(t, effectiveDuration));
    setCurrentTime(clamped);
    const v = videoRef.current;
    if (v) {
      // Some browsers (Safari especially) silently ignore
      // `currentTime` assignment before metadata loads. Wait for
      // readyState >= 1 so the seek actually lands.
      if (v.readyState < 1) {
        const onReady = () => {
          v.currentTime = clamped;
          v.removeEventListener("loadedmetadata", onReady);
          if (!playing) {
            v.play().catch(() => {
              /* user gesture required */
            });
          }
        };
        v.addEventListener("loadedmetadata", onReady);
        return;
      }
      v.currentTime = clamped;
      if (!playing) {
        v.play().catch(() => {
          /* user gesture required */
        });
      }
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
    } else {
      v.pause();
    }
  };

  const patterns = result.patterns_identified ?? [];
  const offBeats = (result.categories.timing?.off_beat_moments ?? [])
    .map((m) => ({ ...m, t: parseTimestamp(m.timestamp_approx) }))
    .filter((m): m is typeof m & { t: number } => m.t !== null);

  return (
    <div className="space-y-3">
      {videoSrc && (
        <video
          ref={videoRef}
          src={videoSrc}
          controls
          preload="metadata"
          className="w-full rounded-md bg-black"
        />
      )}

      {/* Pattern timeline */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">
            Pattern timeline
          </span>
          <span className="font-mono tabular-nums">
            {formatTime(currentTime)} / {formatTime(effectiveDuration)}
          </span>
        </div>

        <div
          className="relative h-12 sm:h-14 rounded-md bg-muted/30 overflow-hidden border border-border"
          role="region"
          aria-label="Pattern timeline"
        >
          {patterns.map((p, i) => {
            // Clamp start/end to the effective timeline so patterns
            // whose model-reported end_time slightly overshoots the
            // video don't render off the right edge. Also guards
            // against negative start_times from bad model output.
            const rawStart = p.start_time ?? 0;
            const rawEnd = p.end_time ?? rawStart;
            const start = Math.max(0, Math.min(rawStart, effectiveDuration));
            const end = Math.max(start, Math.min(rawEnd, effectiveDuration));
            const left = (start / effectiveDuration) * 100;
            const width = Math.max(
              0.8,
              ((end - start) / effectiveDuration) * 100
            );
            return (
              <button
                key={`${i}-${p.name}`}
                type="button"
                className={cn(
                  "absolute h-full border-r border-background/40 flex items-center justify-start px-1 text-[9px] sm:text-[10px] font-medium overflow-hidden whitespace-nowrap transition-opacity",
                  colorForQuality(p.quality),
                  hovered === p ? "opacity-100" : "opacity-90 hover:opacity-100"
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => {
                  seek(start);
                  setSelected(p);
                }}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                title={`${p.name} — ${p.quality ?? "?"} · ${p.timing ?? "?"} · ${formatTime(start)}-${formatTime(end)}`}
              >
                {p.name}
              </button>
            );
          })}

          {/* Off-beat markers */}
          {offBeats.map((m, i) => (
            <div
              key={`ob-${i}`}
              className="absolute top-0 h-full w-0.5 bg-rose-500 pointer-events-none"
              style={{ left: `${(m.t / effectiveDuration) * 100}%` }}
              title={`Off-beat at ${formatTime(m.t)}: ${m.description ?? ""}`}
            />
          ))}

          {/* Playhead */}
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground pointer-events-none"
            style={{
              left: `${Math.min(100, (currentTime / effectiveDuration) * 100)}%`,
            }}
          />
        </div>

        {/* Time ticks */}
        <div className="relative h-3 text-[9px] text-muted-foreground">
          {(() => {
            const step =
              effectiveDuration <= 30
                ? 5
                : effectiveDuration <= 90
                ? 15
                : effectiveDuration <= 240
                ? 30
                : 60;
            const ticks: number[] = [];
            for (let t = 0; t <= effectiveDuration; t += step) {
              ticks.push(t);
            }
            return ticks.map((t) => {
              const pct = (t / effectiveDuration) * 100;
              const atStart = pct < 2;
              const atEnd = pct > 98;
              return (
                <span
                  key={t}
                  className="absolute tabular-nums"
                  style={{
                    left: `${pct}%`,
                    transform: atStart
                      ? undefined
                      : atEnd
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
                  }}
                >
                  {formatTime(t)}
                </span>
              );
            });
          })()}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground pt-1">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500/70" />
            strong
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-primary/70" />
            solid
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-amber-500/70" />
            needs work
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-rose-500/70" />
            weak / off-beat
          </span>
        </div>

        {/* Hovered / tap-selected pattern detail */}
        {detail && (
          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="font-semibold text-foreground">
                {detail.name}
              </span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {formatTime(detail.start_time ?? 0)} →{" "}
                {formatTime(detail.end_time ?? 0)}
              </span>
            </div>
            <div className="text-muted-foreground mt-1">
              {detail.quality ?? "—"} · {detail.timing ?? "—"}
              {detail.notes && (
                <span className="block mt-1 whitespace-pre-wrap break-words">
                  {detail.notes}
                </span>
              )}
              {detail.styling && (
                <span className="block mt-1.5 whitespace-pre-wrap break-words">
                  <span className="font-medium text-foreground">
                    Styling:
                  </span>{" "}
                  {detail.styling}
                </span>
              )}
              {detail.coaching_tip && (
                <span className="block mt-1 whitespace-pre-wrap break-words text-amber-300">
                  <span className="font-medium">Tip:</span>{" "}
                  {detail.coaching_tip}
                </span>
              )}
            </div>
          </div>
        )}

        {videoSrc && (
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {playing ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {playing ? "Pause" : "Play"}
          </button>
        )}
      </div>
    </div>
  );
}
