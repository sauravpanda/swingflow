"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  SkipBack,
  Gauge,
  Crosshair,
  RotateCcw,
  Drum,
  Repeat,
  ChevronFirst,
  ChevronLast,
  PersonStanding,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVideoBeatClick } from "@/hooks/use-video-beat-click";
import {
  PoseOverlay,
  type PoseOverlayHandle,
} from "@/components/analyze/pose-overlay";
import type {
  MusicalMoment,
  VideoPatternIdentified,
  VideoScoreResult,
} from "@/lib/wcs-api";
import { BeatPanel } from "@/components/analyze/beat-panel";

type TimelineViewProps = {
  result: VideoScoreResult;
  duration: number;
  videoSrc?: string | null;
  // When present, enables the "dance start" user-override UI and
  // persists the override to localStorage keyed on this id. Absent
  // on the shared view (no stable per-user id) so anonymous visitors
  // can't fiddle with the timeline. See #70.
  analysisId?: string;
  // Initial seek target (seconds) honored once on mount. Used by
  // the cross-analysis Patterns view (#138) to deep-link straight
  // to a specific occurrence's start_time.
  initialSeekSec?: number;
  // Pins from submitted peer reviews. Rendered as a separate layer
  // above the AI pattern blocks so the user can scrub directly to
  // moments a human flagged. Click a marker → seek + show note.
  reviewerPins?: Array<{
    timestamp_sec: number;
    note: string;
    reviewer_name: string | null;
    reviewer_role: string | null;
    review_id: string;
  }>;
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
  analysisId,
  initialSeekSec,
  reviewerPins,
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
  const [muted, setMuted] = useState(false);
  // User override for the "dance starts here" marker. See #70 — the
  // model occasionally returns dance_start_sec=0 even when the first
  // 10-20s is walk-on/setup, and the only signal the user has is
  // "sugar push at 0:08 while the couple is clearly in closed
  // position not dancing yet." This lets them drag the line to
  // where dancing actually starts. Persisted to localStorage keyed
  // on analysisId so it follows the analysis across refreshes.
  // null means "no override" (use result.dance_start_sec).
  const [danceStartOverride, setDanceStartOverride] = useState<
    number | null
  >(null);
  useEffect(() => {
    if (!analysisId || typeof window === "undefined") {
      setDanceStartOverride(null);
      return;
    }
    const raw = window.localStorage.getItem(
      `swingflow:dance-start-override:${analysisId}`
    );
    const n = raw == null ? NaN : parseFloat(raw);
    setDanceStartOverride(Number.isFinite(n) && n >= 0 ? n : null);
  }, [analysisId]);
  const writeDanceStartOverride = useCallback(
    (t: number | null) => {
      setDanceStartOverride(t);
      if (!analysisId || typeof window === "undefined") return;
      const key = `swingflow:dance-start-override:${analysisId}`;
      if (t == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(t));
    },
    [analysisId]
  );

  // Practice-mode playback rate. Read from localStorage so a user's
  // preferred slow-down sticks across clips. preservesPitch keeps the
  // music listenable at 0.5x instead of sounding chipmunk/demonic.
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("swingflow:playbackRate");
    const n = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= 2) setPlaybackRate(n);
  }, []);
  const applyRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("swingflow:playbackRate", String(rate));
    }
    const v = videoRef.current;
    if (v) {
      v.playbackRate = rate;
      // Prefixed flags for older Safari/Chrome so pitch stays native.
      v.preservesPitch = true;
      const vAny = v as HTMLVideoElement & {
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      vAny.mozPreservesPitch = true;
      vAny.webkitPreservesPitch = true;
    }
  }, []);
  // Re-apply after the video element mounts / src changes — a fresh
  // video element defaults back to rate=1 and preservesPitch=false.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = playbackRate;
    v.preservesPitch = true;
    const vAny = v as HTMLVideoElement & {
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    vAny.mozPreservesPitch = true;
    vAny.webkitPreservesPitch = true;
  }, [videoSrc, playbackRate]);

  // Pose overlay control. The overlay manages its own enable state +
  // localStorage persistence; we hold a handle so the timeline's
  // toggle button can flip it and re-render with the new state.
  const poseRef = useRef<PoseOverlayHandle | null>(null);
  // Mirror the enabled flag in component state so the toggle button
  // re-renders when it flips. Initial value matches the same
  // localStorage key the overlay uses so the button doesn't flash
  // "off" for one render when the preference is on.
  const [poseEnabled, setPoseEnabledMirror] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("swingflow:pose-overlay-enabled") === "true";
  });
  const togglePose = () => {
    const next = !poseEnabled;
    poseRef.current?.setEnabled(next);
    setPoseEnabledMirror(next);
  };

  // Frame export — snapshot the current video frame with the pose
  // overlay (if on) baked in, downloaded as PNG. Coaches share
  // screenshots constantly; an annotated frame keeps the context
  // (skeleton, plumb, slot, loaded foot) along with the moment.
  //
  // CORS gotcha: `drawImage(video)` taints the destination canvas
  // unless the R2 bucket sends Access-Control-Allow-Origin headers
  // for video responses. We DON'T set crossOrigin on the <video>
  // because that would break playback for clips on a bucket without
  // CORS. Instead we attempt the export and surface a friendly
  // error if the canvas turns out tainted (the user can add R2
  // CORS configuration to enable the feature).
  const [frameError, setFrameError] = useState<string | null>(null);
  const handleSaveFrame = useCallback(() => {
    const v = videoRef.current;
    setFrameError(null);
    // Surface preconditions inline rather than no-op'ing — a silent
    // return on click makes the button feel broken.
    if (!v || !v.videoWidth || !v.videoHeight) {
      setFrameError("Frame export unavailable until the video has loaded.");
      return;
    }
    const out = document.createElement("canvas");
    out.width = v.videoWidth;
    out.height = v.videoHeight;
    const ctx = out.getContext("2d");
    if (!ctx) {
      setFrameError(
        "Frame export failed — couldn't acquire a 2D canvas context."
      );
      return;
    }
    try {
      ctx.drawImage(v, 0, 0, out.width, out.height);
      const poseCanvas = poseRef.current?.getCanvas();
      if (poseCanvas && poseCanvas.width > 0 && poseCanvas.height > 0) {
        ctx.drawImage(poseCanvas, 0, 0, out.width, out.height);
      }
      out.toBlob((blob) => {
        if (!blob) {
          setFrameError("Frame export failed — browser returned no blob.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ts = Math.floor(v.currentTime);
        a.download = `swingflow_frame_${ts}s.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Slight delay before revoking so Safari finishes the
        // download. URL.revokeObjectURL synchronously aborts an
        // in-flight fetch by some browsers' downloaders.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    } catch (err) {
      // SecurityError on tainted canvas — the video came from a
      // bucket without CORS. Friendly message + log the cause.
      const msg =
        err instanceof Error && err.name === "SecurityError"
          ? "Frame export needs R2 CORS configured (Access-Control-Allow-Origin on video responses)."
          : err instanceof Error
          ? err.message
          : "Frame export failed";
      console.warn("frame-export failed", err);
      setFrameError(msg);
    }
  }, []);

  // Audible beat click — Web Audio metronome that fires on each beat
  // extracted from the song (#168-pivot). The video player handles
  // the song's own audio; this layers a separate "tick" on top that
  // stays accurate when the video is slowed or sped up, because the
  // scheduler reads playbackRate. Toggle is persisted in localStorage
  // so a coach's preference sticks across clips.
  const beatClick = useVideoBeatClick({
    beats: result.beat_grid?.beats ?? null,
    downbeats: result.beat_grid?.downbeats ?? null,
    videoRef,
    playing,
  });

  // Loop a section — coaches drill the same 2-3 second move over and
  // over to spot a weight-transfer issue. Hot keys `[` / `]` set the
  // in/out points at the current playhead, `\` clears, and the loop
  // boundary check is wired into the existing timeupdate listener
  // below. Persisted per-analysisId so a coach's loop survives a
  // refresh while they take a note.
  const [loopStart, setLoopStartState] = useState<number | null>(null);
  const [loopEnd, setLoopEndState] = useState<number | null>(null);
  useEffect(() => {
    if (!analysisId || typeof window === "undefined") {
      setLoopStartState(null);
      setLoopEndState(null);
      return;
    }
    const raw = window.localStorage.getItem(
      `swingflow:loop:${analysisId}`
    );
    if (!raw) {
      setLoopStartState(null);
      setLoopEndState(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        start?: number | null;
        end?: number | null;
      };
      setLoopStartState(
        typeof parsed.start === "number" && parsed.start >= 0
          ? parsed.start
          : null
      );
      setLoopEndState(
        typeof parsed.end === "number" && parsed.end > 0 ? parsed.end : null
      );
    } catch {
      setLoopStartState(null);
      setLoopEndState(null);
    }
  }, [analysisId]);

  const persistLoop = useCallback(
    (start: number | null, end: number | null) => {
      setLoopStartState(start);
      setLoopEndState(end);
      if (!analysisId || typeof window === "undefined") return;
      const key = `swingflow:loop:${analysisId}`;
      if (start == null && end == null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify({ start, end }));
      }
    },
    [analysisId]
  );

  // Detail shown below the bar. Manual intent (hover / tap-select)
  // wins. Otherwise track whatever pattern the video is currently
  // playing through so a user just pressing play watches the detail
  // card follow the dance. Defined after currentPattern below.

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

  // Refs that stay in lockstep with state so the timeupdate handler
  // doesn't have to be re-registered (and re-bound on every render)
  // when the loop changes. The listener reads through the refs.
  const loopStartRef = useRef<number | null>(null);
  const loopEndRef = useRef<number | null>(null);
  useEffect(() => {
    loopStartRef.current = loopStart;
  }, [loopStart]);
  useEffect(() => {
    loopEndRef.current = loopEnd;
  }, [loopEnd]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      // Loop snap-back: when both points are set and the playhead
      // crosses the out-point, jump back to the in-point. Reading
      // through refs keeps the listener stable across loop edits.
      const ls = loopStartRef.current;
      const le = loopEndRef.current;
      if (le != null && v.currentTime >= le) {
        v.currentTime = ls ?? 0;
      }
      setCurrentTime(v.currentTime);
    };
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

  // Honor the deep-link seek (`?t=...` from the cross-analysis
  // Patterns view, #138) once per (video, target) pair. The
  // `seek()` helper handles the not-yet-loaded case via a
  // loadedmetadata listener, so we don't have to wait here.
  const initialSeekKey = `${videoSrc ?? ""}|${initialSeekSec ?? ""}`;
  const seekedForKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialSeekSec == null || !Number.isFinite(initialSeekSec)) return;
    if (!videoSrc) return;
    if (seekedForKeyRef.current === initialSeekKey) return;
    seekedForKeyRef.current = initialSeekKey;
    seek(initialSeekSec, { autoplay: true });
    // `seek` is referenced via closure and its identity changes per
    // render; we intentionally only re-run when the deep-link key
    // (videoSrc + target) changes, not on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeekKey]);

  // autoplay: start playback after landing the seek. On for "go
  // watch this moment" intents (pattern block, reviewer pin, bar
  // click); off for positioning intents (J/L skip, frame-step,
  // arrow-key scrub) — a paused frame-step that silently resumes
  // playback blows away the exact frame the user was inspecting.
  const seek = (t: number, opts?: { autoplay?: boolean }) => {
    const autoplay = opts?.autoplay ?? false;
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
          if (autoplay && !playing) {
            v.play().catch(() => {
              /* user gesture required */
            });
          }
        };
        v.addEventListener("loadedmetadata", onReady);
        return;
      }
      v.currentTime = clamped;
      if (autoplay && !playing) {
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

  // Coach-mode shortcuts. YouTube convention:
  //   K (or space): play/pause
  //   J / L:        skip ±5s
  //   , / .:        step ±1 frame (assuming 30fps; the only universal
  //                  number we can pick without per-clip metadata)
  //   [ / ]:        set loop in / out at the current playhead
  //   \:            clear the loop
  // Registered on document so the user doesn't have to click into the
  // timeline first — they can scrub with J/L while reading the
  // strengths panel. Skipped when the target is a form input so
  // typing in the label editor or peer-review form isn't hijacked.
  useEffect(() => {
    const FRAME_SEC = 1 / 30;
    const SKIP_SEC = 5;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Don't fight other handlers that already use modifiers.
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case "k":
        case "K":
          e.preventDefault();
          togglePlay();
          break;
        case "j":
        case "J":
          e.preventDefault();
          seek(v.currentTime - SKIP_SEC);
          break;
        case "l":
        case "L":
          e.preventDefault();
          seek(v.currentTime + SKIP_SEC);
          break;
        case ",":
          // Frame-step pauses first (NLE convention) — stepping
          // implies the user wants to inspect a single frame, and
          // stepping mid-playback would otherwise read as a stutter.
          e.preventDefault();
          if (!v.paused) v.pause();
          seek(v.currentTime - FRAME_SEC);
          break;
        case ".":
          e.preventDefault();
          if (!v.paused) v.pause();
          seek(v.currentTime + FRAME_SEC);
          break;
        case "[":
          e.preventDefault();
          persistLoop(v.currentTime, loopEndRef.current);
          break;
        case "]":
          e.preventDefault();
          persistLoop(loopStartRef.current, v.currentTime);
          break;
        case "\\":
          e.preventDefault();
          persistLoop(null, null);
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `seek`, `togglePlay`, `persistLoop` reference `videoRef.current`
    // through closures that are recreated each render; the listener
    // body re-reads from refs each time. Re-binding on every render
    // would be wasteful, so depend only on the stable persistLoop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistLoop]);

  // Effective dance-start: user override wins over the model's
  // estimate. All downstream timeline rendering (pre-dance band,
  // pattern filtering, currentPattern highlight) keys off this.
  const effectiveDanceStart = useMemo(() => {
    if (danceStartOverride != null) return danceStartOverride;
    return typeof result.dance_start_sec === "number" &&
      result.dance_start_sec > 0
      ? result.dance_start_sec
      : 0;
  }, [danceStartOverride, result.dance_start_sec]);

  // Patterns that end before dancing started are model noise —
  // filter them out so the user isn't told they did a "sugar push"
  // at 0:08 while still in closed position. Patterns that straddle
  // the boundary get visually clamped in the render below.
  const allPatterns = result.patterns_identified ?? [];
  const patterns = useMemo(
    () =>
      allPatterns.filter((p) => {
        const end = p.end_time ?? p.start_time ?? 0;
        return end > effectiveDanceStart;
      }),
    [allPatterns, effectiveDanceStart]
  );
  const offBeats = (result.categories.timing?.off_beat_moments ?? [])
    .map((m) => ({ ...m, t: parseTimestamp(m.timestamp_approx) }))
    .filter((m): m is typeof m & { t: number } => m.t !== null);

  // Pattern containing the video's current playback position. Used
  // to (a) auto-highlight the block as the video plays and (b)
  // auto-surface its detail card when nothing is manually hovered
  // or tap-selected. Computed each render — patterns list is small.
  const currentPattern = useMemo(() => {
    for (const p of patterns) {
      const start = p.start_time ?? 0;
      const end = p.end_time ?? start;
      if (currentTime >= start && currentTime <= end) return p;
    }
    return null;
  }, [patterns, currentTime]);

  // Prefer manual intent (hover / tap-select) over auto-tracked.
  // The auto-tracked current pattern kicks in during playback when
  // the user is just watching.
  const autoDetail = hovered ?? selected ?? currentPattern;

  // Scrub the timeline by clicking anywhere on the bar. We resolve
  // the click's x-position against the bar's bounding box so the
  // seek is accurate regardless of the bar's width.
  const barRef = useRef<HTMLDivElement>(null);
  const scrubToClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    seek(pct * effectiveDuration, { autoplay: true });
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const restart = () => seek(0, { autoplay: true });

  // Fullscreen targets the whole player box (video + pose-overlay
  // canvas + control row), not the bare <video>. Fullscreening only
  // the video element drops the overlay canvas — it's an absolute
  // *sibling*, not a child — so the skeleton/plumb/slot lines the
  // coach was studying silently vanish in fullscreen.
  const playerBoxRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === playerBoxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const box = playerBoxRef.current;
    if (box?.requestFullscreen) {
      box.requestFullscreen().catch(() => {});
      return;
    }
    // iPhone Safari has no element fullscreen — fall back to the
    // video's native fullscreen (overlay won't show there, but a
    // fullscreen video beats a dead button).
    const v = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    v?.webkitEnterFullscreen?.();
  };

  return (
    <div className="space-y-3">
      {videoSrc && (
        // Unified player: video (no native progress bar so we don't
        // have two scrubbers that don't align), custom control row,
        // then the pattern timeline as the only scrubber. max-h caps
        // the video so portrait clips don't dominate the viewport.
        <div
          ref={playerBoxRef}
          className={cn(
            "rounded-md bg-black overflow-hidden",
            // In fullscreen the box is the viewport: stack video area
            // over the control row and let the video take the rest.
            isFullscreen && "flex flex-col"
          )}
        >
          <div className={cn("relative", isFullscreen && "flex-1 min-h-0")}>
            <video
              ref={videoRef}
              src={videoSrc}
              preload="metadata"
              playsInline
              onClick={togglePlay}
              className={cn(
                "w-full object-contain cursor-pointer",
                isFullscreen
                  ? "h-full max-h-none"
                  : "max-h-[60vh] sm:max-h-[520px]"
              )}
            />
            {/* Pose-skeleton overlay (#168-pivot PR 3). Rendered as
                an absolute sibling of the video so the canvas
                tracks the video's displayed size via inset-0. The
                overlay does its own enable/disable via the handle
                exposed below; nothing renders here when off. */}
            <PoseOverlay
              ref={poseRef}
              videoRef={videoRef}
              playing={playing}
            />
          </div>
          {/* Custom control row — play, restart, time, mute, fullscreen.
              flex-wrap so the bar collapses to two rows on phones
              (the coaching tools added in #172-#176 took the row past
              its single-line budget at <500px). gap-y matches gap-x
              so the wrapped row sits flush. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs bg-black/80">
            <button
              type="button"
              onClick={togglePlay}
              className="text-white/90 hover:text-white p-1 rounded transition-colors"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={restart}
              className="text-white/70 hover:text-white p-1 rounded transition-colors"
              aria-label="Restart"
              title="Restart"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <span className="font-mono tabular-nums text-white/80 text-[11px]">
              {formatTime(currentTime)} / {formatTime(effectiveDuration)}
            </span>
            {result.beat_grid && (
              <MetronomeDot
                grid={result.beat_grid}
                currentTime={currentTime}
              />
            )}
            <div className="ml-auto flex items-center gap-1">
              {/* Loop controls — set in/out points at the current
                  playhead. Once both are set the timeupdate handler
                  snaps the video back to the in-point on each cross.
                  Repeat icon lights emerald when active so coaches
                  can see at a glance whether a loop is armed. */}
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) persistLoop(v.currentTime, loopEnd);
                }}
                className="text-white/70 hover:text-white p-1 rounded transition-colors"
                aria-label="Set loop in-point at current time ([)"
                title="Loop IN at current time ( [ )"
              >
                <ChevronFirst className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) persistLoop(loopStart, v.currentTime);
                }}
                className="text-white/70 hover:text-white p-1 rounded transition-colors"
                aria-label="Set loop out-point at current time (])"
                title="Loop OUT at current time ( ] )"
              >
                <ChevronLast className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => persistLoop(null, null)}
                disabled={loopStart == null && loopEnd == null}
                className={cn(
                  "p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                  loopStart != null || loopEnd != null
                    ? "text-emerald-400 hover:text-emerald-300"
                    : "text-white/40"
                )}
                aria-label="Clear loop (\\)"
                title={
                  loopStart != null && loopEnd != null
                    ? `Looping ${formatTime(loopStart)}–${formatTime(loopEnd)} · click to clear ( \\ )`
                    : loopStart != null || loopEnd != null
                    ? "Loop partially set · click to clear ( \\ )"
                    : "Set loop with [ and ] (or buttons to the left)"
                }
              >
                <Repeat className="h-4 w-4" />
              </button>
              <SpeedSelector rate={playbackRate} onChange={applyRate} />
              {/* Save annotated frame. PNG download of the current
                  video frame composited with the pose overlay (when
                  on). Always available — even without pose, a
                  bare-frame screenshot is useful for sharing. */}
              <button
                type="button"
                onClick={handleSaveFrame}
                className="text-white/70 hover:text-white p-1 rounded transition-colors"
                aria-label="Download annotated frame as PNG"
                title="Save current frame as PNG (with pose overlay if on)"
              >
                <Camera className="h-4 w-4" />
              </button>
              {/* Pose-skeleton overlay toggle. Hidden when there's
                  no video src — toggle while video is missing would
                  have nothing to draw on. Icon lights cyan when on. */}
              <button
                type="button"
                onClick={togglePose}
                className={cn(
                  "p-1 rounded transition-colors",
                  poseEnabled
                    ? "text-cyan-300 hover:text-cyan-200"
                    : "text-white/70 hover:text-white"
                )}
                aria-label={
                  poseEnabled
                    ? "Hide body skeleton overlay"
                    : "Show body skeleton overlay"
                }
                aria-pressed={poseEnabled}
                title={
                  poseEnabled
                    ? "Body skeleton on — tap to hide"
                    : "Body skeleton off — tap to overlay pose detection on the video"
                }
              >
                <PersonStanding className="h-4 w-4" />
              </button>
              {result.beat_grid && (
                <button
                  type="button"
                  onClick={() => beatClick.setEnabled(!beatClick.enabled)}
                  className={cn(
                    "p-1 rounded transition-colors",
                    beatClick.enabled
                      ? "text-emerald-400 hover:text-emerald-300"
                      : "text-white/70 hover:text-white"
                  )}
                  aria-label={
                    beatClick.enabled
                      ? "Mute beat click"
                      : "Play beat click on each detected beat"
                  }
                  aria-pressed={beatClick.enabled}
                  title={
                    beatClick.enabled
                      ? "Beat click on — tap to mute"
                      : "Beat click off — tap to hear a tick on every detected beat (downbeats louder)"
                  }
                >
                  <Drum className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleMute}
                className="text-white/70 hover:text-white p-1 rounded transition-colors"
                aria-label={muted ? "Unmute" : "Mute"}
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="text-white/70 hover:text-white p-1 rounded transition-colors"
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                <Maximize className="h-4 w-4" />
              </button>
            </div>
          </div>
          {frameError && (
            <div className="px-2 py-1.5 text-[11px] text-amber-200 bg-amber-900/40 border-t border-amber-700/40">
              {frameError}
              <button
                type="button"
                onClick={() => setFrameError(null)}
                className="ml-2 underline hover:no-underline"
              >
                dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Musicality strip — audio-first lens showing whether the
          couple caught each musical moment. Sits ABOVE the pattern
          timeline so it reads as a peer, not a footnote. Hidden
          entirely when Gemini returned no moments (e.g. pure-groove
          music with no standout hits). */}
      {(result.musical_moments?.length ?? 0) > 0 && (
        <MusicalityStrip
          moments={result.musical_moments ?? []}
          effectiveDuration={effectiveDuration}
          onSeek={(t) => seek(t, { autoplay: true })}
        />
      )}

      {/* Beat map — rendered as its own separate graph ABOVE the
          pattern timeline so users can visually track the rhythm
          independently of pattern blocks. Shows detected beats,
          downbeats, phrase markers, and AI-flagged off-beat moments.
          BeatPanel renders a clear empty state when beat_grid is
          missing (silent-fallback or old analyses) rather than
          hiding the whole section. */}
      <BeatPanel
        grid={result.beat_grid}
        offBeats={offBeats}
        effectiveDuration={effectiveDuration}
        currentTime={currentTime}
        playbackRate={playbackRate}
        onSeek={(t) => seek(t, { autoplay: true })}
      />

      {/* Pattern timeline = the scrubber (single source of truth) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground gap-2">
          <span className="font-medium uppercase tracking-wide">
            Pattern timeline
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            {analysisId && (
              <>
                <button
                  type="button"
                  onClick={() => writeDanceStartOverride(currentTime)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/60 hover:border-foreground/40 hover:bg-muted/40 transition-colors text-[10px]"
                  title="Set dance start to the current playback time. The pre-dance band + pattern filter will update."
                >
                  <Crosshair className="h-3 w-3" />
                  Set dance start
                </button>
                {danceStartOverride != null && (
                  <button
                    type="button"
                    onClick={() => writeDanceStartOverride(null)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/60 hover:border-foreground/40 hover:bg-muted/40 transition-colors text-[10px] text-amber-500"
                    title={`Override: ${formatTime(danceStartOverride)}. Click to clear and use the model's estimate.`}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset ({formatTime(danceStartOverride)})
                  </button>
                )}
              </>
            )}
            <span className="font-mono tabular-nums">
              {formatTime(currentTime)} / {formatTime(effectiveDuration)}
            </span>
          </div>
        </div>

        <div
          ref={barRef}
          className="relative h-12 sm:h-14 rounded-md bg-muted/30 overflow-hidden border border-border cursor-pointer group/bar focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
          role="slider"
          tabIndex={0}
          aria-label="Pattern timeline — click or use arrow keys to scrub"
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDuration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(effectiveDuration)}`}
          onClick={scrubToClick}
          onKeyDown={(e) => {
            // Arrow-key scrubbing. Step sizes tuned for reviewing
            // technique: 1s fine step catches a single beat at most
            // tempos; 5s large step (shift-arrow) lets you skip
            // between patterns quickly. Home / End snap to boundaries.
            const step = e.shiftKey ? 5 : 1;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              seek(currentTime + step);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              seek(currentTime - step);
            } else if (e.key === "Home") {
              e.preventDefault();
              seek(0);
            } else if (e.key === "End") {
              e.preventDefault();
              seek(effectiveDuration);
            } else if (e.key === " " || e.key === "Enter") {
              // Space/Enter is the expected activation on a focused
              // slider in most ATs — use it to play/pause so users
              // can scrub + review without reaching for the mouse.
              e.preventDefault();
              togglePlay();
            }
          }}
        >
          {/* Loop region — translucent emerald band over the section
              between the in / out points. Drawn under everything else
              (no z-index) so pattern blocks, off-beats, pins, and the
              playhead all remain interactive. */}
          {loopStart != null && loopEnd != null && loopEnd > loopStart && (
            <div
              className="absolute top-0 h-full bg-emerald-400/15 border-l-2 border-r-2 border-emerald-400/60 pointer-events-none"
              style={{
                left: `${Math.max(0, (loopStart / effectiveDuration) * 100)}%`,
                width: `${Math.min(100, ((loopEnd - loopStart) / effectiveDuration) * 100)}%`,
              }}
              aria-label={`Looping ${formatTime(loopStart)} to ${formatTime(loopEnd)}`}
            />
          )}

          {/* Pre-dance / post-dance bands. Rendered under the
              pattern blocks so stray out-of-window entries (if any
              slip through the backend sanitizer) still show on top.
              Hatched muted fill visually separates setup / walk-off
              from the dancing region. */}
          {effectiveDanceStart > 0.5 && (
              <div
                className="absolute top-0 h-full pointer-events-none bg-muted/60 border-r border-border/80"
                style={{
                  left: 0,
                  width: `${Math.min(100, (effectiveDanceStart / effectiveDuration) * 100)}%`,
                }}
                title={
                  danceStartOverride != null
                    ? `Pre-dance setup · ends ${formatTime(effectiveDanceStart)} (your override)`
                    : `Pre-dance setup · ends ${formatTime(effectiveDanceStart)}`
                }
              >
                <span className="absolute inset-0 flex items-center justify-center text-[9px] sm:text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">
                  pre-dance
                </span>
              </div>
            )}
          {typeof result.dance_end_sec === "number" &&
            result.dance_end_sec < effectiveDuration - 0.5 && (
              <div
                className="absolute top-0 h-full pointer-events-none bg-muted/60 border-l border-border/80"
                style={{
                  left: `${(result.dance_end_sec / effectiveDuration) * 100}%`,
                  width: `${Math.max(0, ((effectiveDuration - result.dance_end_sec) / effectiveDuration) * 100)}%`,
                }}
                title={`After dance · starts ${formatTime(result.dance_end_sec)}`}
              >
                <span className="absolute inset-0 flex items-center justify-center text-[9px] sm:text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">
                  after
                </span>
              </div>
            )}
          {patterns.map((p, i) => {
            // Clamp start/end to the effective timeline so patterns
            // whose model-reported end_time slightly overshoots the
            // video don't render off the right edge. Also guards
            // against negative start_times from bad model output.
            const rawStart = p.start_time ?? 0;
            const rawEnd = p.end_time ?? rawStart;
            // Clamp visual start to the dance-start line so patterns
            // that model-reported as straddling pre-dance don't bleed
            // into the grey band.
            const floorStart = Math.max(rawStart, effectiveDanceStart);
            const start = Math.max(0, Math.min(floorStart, effectiveDuration));
            const end = Math.max(start, Math.min(rawEnd, effectiveDuration));
            const left = (start / effectiveDuration) * 100;
            const width = Math.max(
              0.8,
              ((end - start) / effectiveDuration) * 100
            );
            const isCurrent = currentPattern === p;
            const isHoveredOrSelected = hovered === p || selected === p;
            return (
              <button
                key={`${i}-${p.name}`}
                type="button"
                className={cn(
                  "absolute h-full border-r border-background/40 flex items-center justify-start px-1 text-[9px] sm:text-[10px] font-medium overflow-hidden whitespace-nowrap transition-[opacity,box-shadow,transform,filter] duration-200",
                  colorForQuality(p.quality),
                  // Current pattern: brighter + inset ring so it
                  // reads as the "you are here" block without
                  // changing layout.
                  isCurrent
                    ? "opacity-100 ring-2 ring-inset ring-white/70 brightness-110 saturate-125"
                    : isHoveredOrSelected
                    ? "opacity-100"
                    : "opacity-80 hover:opacity-100"
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={(e) => {
                  // Stop the click from bubbling to the bar's
                  // scrub handler — clicking a pattern block
                  // should seek to that pattern's start, not the
                  // block's click x-position.
                  e.stopPropagation();
                  seek(start, { autoplay: true });
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

          {/* Reviewer pins — human-authored timestamped comments from
              submitted peer reviews. Rendered INSIDE the bar at the
              top edge (the parent has overflow-hidden, so negative
              top values would clip the pins out of view entirely).
              z-10 keeps them above the pattern blocks they may
              overlap. Click → seek. */}
          {(reviewerPins ?? []).map((pin, i) => {
            const pct = Math.max(
              0,
              Math.min(100, (pin.timestamp_sec / effectiveDuration) * 100)
            );
            const author = pin.reviewer_name || "Anonymous";
            return (
              <button
                key={`pin-${pin.review_id}-${i}`}
                type="button"
                className="absolute top-0.5 z-10 -translate-x-1/2 h-3 w-3 rounded-full border-2 border-background bg-emerald-400 shadow-sm hover:scale-125 transition-transform"
                style={{ left: `${pct}%` }}
                title={`${author}${pin.reviewer_role ? ` (${pin.reviewer_role})` : ""} @ ${formatTime(pin.timestamp_sec)}: ${pin.note}`}
                onClick={(e) => {
                  e.stopPropagation();
                  seek(pin.timestamp_sec, { autoplay: true });
                }}
                aria-label={`Jump to reviewer comment at ${formatTime(pin.timestamp_sec)}`}
              />
            );
          })}

          {/* Playhead with floating time tag */}
          <div
            className="absolute top-0 h-full w-[2px] bg-foreground pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
            style={{
              left: `${Math.min(100, (currentTime / effectiveDuration) * 100)}%`,
            }}
          >
            <span
              className="absolute -top-[18px] left-1/2 -translate-x-1/2 px-1 py-[1px] text-[9px] font-mono tabular-nums rounded-sm bg-foreground text-background whitespace-nowrap pointer-events-none"
              style={{
                // Keep the tag on-screen near both edges.
                transform:
                  (currentTime / effectiveDuration) * 100 < 4
                    ? "translate(0%, 0)"
                    : (currentTime / effectiveDuration) * 100 > 96
                    ? "translate(-100%, 0)"
                    : "translate(-50%, 0)",
              }}
            >
              {formatTime(currentTime)}
            </span>
          </div>
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

        {/* Beat map moved above the pattern timeline — see BeatPanel. */}

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

        {/* Detail card — tracks hover / tap-select, falls back to
            the pattern currently under the playhead during playback. */}
        {autoDetail && (
          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="font-semibold text-foreground">
                {autoDetail.name}
                {autoDetail.variant &&
                  autoDetail.variant.toLowerCase() !== "basic" && (
                    <span className="text-muted-foreground font-normal">
                      {" · "}
                      <span className="text-foreground">
                        {autoDetail.variant}
                      </span>
                    </span>
                  )}
              </span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {formatTime(autoDetail.start_time ?? 0)} →{" "}
                {formatTime(autoDetail.end_time ?? 0)}
              </span>
            </div>
            <div className="text-muted-foreground mt-1">
              {autoDetail.quality ?? "—"} · {autoDetail.timing ?? "—"}
              {autoDetail.notes && (
                <span className="block mt-1 whitespace-pre-wrap break-words">
                  {autoDetail.notes}
                </span>
              )}
              {autoDetail.styling && (
                <span className="block mt-1.5 whitespace-pre-wrap break-words">
                  <span className="font-medium text-foreground">
                    Styling:
                  </span>{" "}
                  {autoDetail.styling}
                </span>
              )}
              {autoDetail.coaching_tip && (
                <span className="block mt-1 whitespace-pre-wrap break-words text-amber-300">
                  <span className="font-medium">Tip:</span>{" "}
                  {autoDetail.coaching_tip}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Play button moved into the custom video control strip
            above — the pattern timeline is the sole scrubber now. */}
      </div>
    </div>
  );
}

function MetronomeDot({
  grid,
  currentTime,
}: {
  grid: NonNullable<VideoScoreResult["beat_grid"]>;
  currentTime: number;
}) {
  // Find the nearest beat to currentTime. Binary search — the beats
  // array is sorted and can have hundreds of entries on long clips.
  const nearestBeat = useMemo(() => {
    const beats = grid.beats;
    if (!beats || beats.length === 0) return null;
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < currentTime) lo = mid + 1;
      else hi = mid;
    }
    const candidates = [
      beats[Math.max(0, lo - 1)],
      beats[lo],
      beats[Math.min(beats.length - 1, lo + 1)],
    ];
    let best = candidates[0];
    let bestDist = Math.abs(currentTime - best);
    for (const c of candidates) {
      const d = Math.abs(currentTime - c);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return { time: best, distance: bestDist };
  }, [grid.beats, currentTime]);

  // Pulse strength: 1.0 on the beat, decays to 0 within 180ms. Gives
  // a visible flash even at lower frame rates since we're reading
  // video.currentTime on requestAnimationFrame cadence (~60 FPS)
  // rather than per-beat.
  const beatWindow = 0.18;
  const pulse = nearestBeat
    ? Math.max(0, 1 - nearestBeat.distance / beatWindow)
    : 0;
  const isDownbeat =
    nearestBeat != null &&
    grid.downbeats.some((d) => Math.abs(d - nearestBeat.time) < 0.01);

  // Scale + opacity keyed to pulse intensity. Downbeats get a bigger
  // ceiling so you can visually tell bar 1 from beats 2-4.
  const maxScale = isDownbeat ? 1.8 : 1.35;
  const scale = 1 + pulse * (maxScale - 1);
  const opacity = 0.45 + pulse * 0.55;
  const color = isDownbeat ? "bg-emerald-400" : "bg-primary";

  return (
    <div
      className="flex items-center gap-1.5 ml-3"
      title={`Detected ${grid.bpm.toFixed(0)} BPM${
        grid.source ? ` · ${grid.source}` : ""
      }. Does this match what you hear? If the dot is off the music, the pattern timing will be off too.`}
    >
      <div
        className={`h-2.5 w-2.5 rounded-full ${color} transition-transform duration-75`}
        style={{
          transform: `scale(${scale})`,
          opacity,
        }}
        aria-hidden="true"
      />
      <span className="font-mono tabular-nums text-white/70 text-[10px]">
        {grid.bpm.toFixed(0)} BPM
      </span>
    </div>
  );
}

const MOMENT_KIND_LABEL: Record<string, string> = {
  phrase_top: "Phrase",
  break: "Break",
  hit: "Hit",
  pocket: "Pocket",
  drop: "Drop",
  accent: "Accent",
  build: "Build",
};

function MusicalityStrip({
  moments,
  effectiveDuration,
  onSeek,
}: {
  moments: MusicalMoment[];
  effectiveDuration: number;
  onSeek: (t: number) => void;
}) {
  const [hover, setHover] = useState<MusicalMoment | null>(null);
  // Cull to what fits the strip. A 2-min clip with 8-12 moments is
  // comfortable; much more than that and the markers collide.
  const visible = useMemo(
    () =>
      moments
        .filter((m) => Number.isFinite(m.timestamp_sec))
        .filter(
          (m) =>
            m.timestamp_sec >= 0 && m.timestamp_sec <= effectiveDuration
        ),
    [moments, effectiveDuration]
  );

  const caughtCount = visible.filter((m) => m.caught).length;
  const totalCount = visible.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">
          Musicality
        </span>
        <span className="text-[10px] tabular-nums">
          {caughtCount} of {totalCount} moments caught
        </span>
      </div>
      <div className="relative h-8 rounded-md bg-muted/30 border border-border overflow-visible">
        {visible.map((m, i) => {
          const pct = (m.timestamp_sec / effectiveDuration) * 100;
          return (
            <button
              key={`mm-${i}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(m.timestamp_sec);
              }}
              onMouseEnter={() => setHover(m)}
              onMouseLeave={() =>
                setHover((curr) => (curr === m ? null : curr))
              }
              className={cn(
                "absolute top-1 bottom-1 w-[3px] rounded-sm transition-transform hover:scale-y-110",
                m.caught ? "bg-emerald-500" : "bg-rose-500/80"
              )}
              style={{ left: `calc(${pct}% - 1.5px)` }}
              aria-label={`${m.caught ? "Caught" : "Missed"} — ${m.description ?? "musical moment"} at ${formatTime(m.timestamp_sec)}`}
              title={`${m.description ?? "Musical moment"} · ${m.caught ? "caught" : "missed"} · ${formatTime(m.timestamp_sec)}`}
            >
              {/* Kind label above the marker when there's room. Only
                  shown on larger screens — on mobile the hover card
                  below does the same job. */}
              {m.kind && MOMENT_KIND_LABEL[m.kind] && (
                <span className="hidden sm:inline absolute -top-[14px] left-1/2 -translate-x-1/2 text-[8px] font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap pointer-events-none">
                  {MOMENT_KIND_LABEL[m.kind]}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hover && (
        <div className="rounded-md border border-border bg-muted/20 p-2 text-xs">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="font-semibold text-foreground">
              {hover.kind && MOMENT_KIND_LABEL[hover.kind]
                ? `${MOMENT_KIND_LABEL[hover.kind]} · `
                : ""}
              {hover.description ?? "Musical moment"}
            </span>
            <span
              className={cn(
                "font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded",
                hover.caught
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-rose-500/20 text-rose-300"
              )}
            >
              {hover.caught ? "caught" : "missed"} · {formatTime(hover.timestamp_sec)}
            </span>
          </div>
          {hover.caught_how && (
            <div className="text-muted-foreground mt-1">
              {hover.caught_how}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SPEED_OPTIONS: number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5];

function SpeedSelector({
  rate,
  onChange,
}: {
  rate: number;
  onChange: (r: number) => void;
}) {
  const [open, setOpen] = useState(false);
  // Close on outside click. Pointerdown (not click) so the dropdown
  // closes before any click handler on a different button fires.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const label = rate === 1 ? "1x" : `${rate}x`;
  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-white/80 hover:text-white px-1.5 py-1 rounded transition-colors font-mono tabular-nums text-[11px]"
        aria-label={`Playback speed (${label})`}
        title={`Playback speed (${label}) — pitch preserved`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Gauge className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-1 min-w-[72px] rounded-md border border-border bg-black/95 shadow-lg py-1 z-20"
        >
          {SPEED_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitemradio"
              aria-checked={r === rate}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={cn(
                "block w-full text-left px-2.5 py-1 font-mono tabular-nums text-[11px] transition-colors",
                r === rate
                  ? "bg-primary/30 text-white"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              {r === 1 ? "1x" : `${r}x`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
