"use client";

// Beat-map strip + panel wrapper. Extracted from timeline-view.tsx
// so the label editor (and eventually other places) can drop in the
// same beat visualization without pulling in the whole TimelineView.
//
// BeatPanel: renders BeatStrip when there's a grid, otherwise a
// "not available" empty-state.
// BeatStrip: the actual tick-based visualization + off-beat markers
// + phrase markers + playhead.

import { useMemo, useRef } from "react";
import type { VideoScoreResult } from "@/lib/wcs-api";
import { cn } from "@/lib/utils";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function BeatPanel({
  grid,
  offBeats,
  effectiveDuration,
  currentTime,
  playbackRate,
  onSeek,
}: {
  grid: VideoScoreResult["beat_grid"] | null | undefined;
  offBeats: Array<{ t: number; description?: string; beat_count?: string }>;
  effectiveDuration: number;
  currentTime: number;
  playbackRate: number;
  onSeek: (t: number) => void;
}) {
  // Empty state — beat detection didn't run or failed. Render a clear
  // placeholder instead of silently hiding the strip so the user can
  // tell this is a missing signal vs. a UI bug.
  const hasBeats = grid && (grid.beats?.length ?? 0) > 0;
  if (!hasBeats) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">Beat map</span>
          <span className="text-[10px]">not available</span>
        </div>
        <div className="h-7 rounded-md bg-muted/20 border border-dashed border-border flex items-center justify-center text-[11px] text-muted-foreground px-3">
          Beat detection wasn&rsquo;t available for this analysis — re-analyze
          to generate a beat grid.
        </div>
      </div>
    );
  }
  return (
    <BeatStrip
      grid={grid}
      offBeats={offBeats}
      effectiveDuration={effectiveDuration}
      currentTime={currentTime}
      playbackRate={playbackRate}
      onSeek={onSeek}
    />
  );
}

function BeatStrip({
  grid,
  offBeats,
  effectiveDuration,
  currentTime,
  playbackRate,
  onSeek,
}: {
  grid: NonNullable<VideoScoreResult["beat_grid"]>;
  offBeats: Array<{ t: number; description?: string; beat_count?: string }>;
  effectiveDuration: number;
  currentTime: number;
  playbackRate: number;
  onSeek: (t: number) => void;
}) {
  const beats = grid.beats ?? [];
  const downbeats = grid.downbeats ?? [];

  const visibleBeats = useMemo(
    () => beats.filter((b) => b >= 0 && b <= effectiveDuration),
    [beats, effectiveDuration]
  );
  const downbeatSet = useMemo(
    () => new Set(downbeats.map((d) => d.toFixed(3))),
    [downbeats]
  );

  // Phrase markers — WCS musical phrases are 32 beats = 8 bars of 4.
  // Most swing music is in 4 (one downbeat per 4 beats), so a phrase
  // spans 8 downbeats. Step through downbeats and mark every 8th so
  // the user can see where the "1" of each phrase lands.
  const phraseMarkers = useMemo(() => {
    if (downbeats.length < 2) return [];
    const barsPerPhrase = 8;
    const out: number[] = [];
    for (let i = 0; i < downbeats.length; i += barsPerPhrase) {
      const d = downbeats[i];
      if (d >= 0 && d <= effectiveDuration) out.push(d);
    }
    return out;
  }, [downbeats, effectiveDuration]);

  const barRef = useRef<HTMLDivElement>(null);
  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * effectiveDuration);
  };

  // Cull dense beat grids — at 150 BPM over 2 minutes you get 300
  // ticks and the strip becomes a smear. Subsample to ~240 max,
  // always keeping downbeats so the bar structure stays readable.
  const renderedBeats = useMemo(() => {
    const MAX = 240;
    if (visibleBeats.length <= MAX) return visibleBeats;
    const stride = Math.ceil(visibleBeats.length / MAX);
    return visibleBeats.filter(
      (b, i) => i % stride === 0 || downbeatSet.has(b.toFixed(3))
    );
  }, [visibleBeats, downbeatSet]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Beat map</span>
        <span
          className="text-[10px] tabular-nums"
          title={
            playbackRate !== 1
              ? `Song is ${grid.bpm.toFixed(0)} BPM at 1x; you're practicing at ${playbackRate}x → ${(grid.bpm * playbackRate).toFixed(0)} BPM effective`
              : undefined
          }
        >
          {playbackRate === 1 ? (
            <>{grid.bpm.toFixed(0)} BPM</>
          ) : (
            <>
              {(grid.bpm * playbackRate).toFixed(0)} BPM
              <span className="text-muted-foreground/60">
                {" "}
                (song {grid.bpm.toFixed(0)} @ {playbackRate}x)
              </span>
            </>
          )}
          {grid.source ? ` · ${grid.source}` : ""}
          {" · "}
          {downbeats.length} bars
        </span>
      </div>
      <div
        ref={barRef}
        className="relative h-8 rounded-md bg-muted/30 border border-border overflow-hidden cursor-pointer"
        onClick={scrub}
        role="img"
        aria-label={`Beat map — ${downbeats.length} bars at ${grid.bpm.toFixed(0)} BPM`}
        title="Click to seek. Tall ticks = downbeats (boom). Short = offbeats (tick). Red dots = AI-flagged off-beat."
      >
        {/* Beat ticks */}
        {renderedBeats.map((b, i) => {
          const pct = (b / effectiveDuration) * 100;
          const isDownbeat = downbeatSet.has(b.toFixed(3));
          return (
            <div
              key={`bt-${i}-${b}`}
              className={cn(
                "absolute top-1 bottom-1 pointer-events-none",
                isDownbeat
                  ? "w-[2px] bg-emerald-400"
                  : "w-px bg-white/40"
              )}
              style={{ left: `calc(${pct}% - 0.5px)` }}
            />
          );
        })}
        {/* Phrase markers — full-height ghost lines every 8 counts. */}
        {phraseMarkers.map((t, i) => (
          <div
            key={`ph-${i}`}
            className="absolute top-0 bottom-0 w-[2px] bg-amber-400/60 pointer-events-none"
            style={{ left: `calc(${(t / effectiveDuration) * 100}% - 1px)` }}
            title={`Phrase ${i + 1} at ${formatTime(t)}`}
          />
        ))}
        {/* Off-beat markers — red dots from AI timing analysis. */}
        {offBeats.map((m, i) => (
          <div
            key={`ob-${i}`}
            className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-rose-500 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] pointer-events-auto"
            style={{ left: `${(m.t / effectiveDuration) * 100}%` }}
            title={
              m.description
                ? `Off-beat at ${m.beat_count ?? formatTime(m.t)}: ${m.description}`
                : `Off-beat at ${formatTime(m.t)}`
            }
          />
        ))}
        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-foreground pointer-events-none"
          style={{
            left: `${Math.min(100, (currentTime / effectiveDuration) * 100)}%`,
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-[2px] bg-emerald-400" />
          downbeat (boom)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-px bg-white/40" />
          beat (tick)
        </span>
        {phraseMarkers.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-[2px] bg-amber-400/60" />
            phrase (every 8)
          </span>
        )}
        {offBeats.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
            off-beat ({offBeats.length})
          </span>
        )}
      </div>
    </div>
  );
}
