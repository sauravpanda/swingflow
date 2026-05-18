"use client";

// Schedules a Web Audio click on each beat of a video's extracted
// beat_grid. Distinct from useMetronome (which generates beats from a
// fixed BPM for the Rhythm trainer): here the beat times come from
// Beat This!'s analysis of the actual song, so they can be irregular
// (tempo shifts, fermatas) and the click stays accurate without us
// re-deriving anything.
//
// Coaching use case (#168-pivot): when reviewing a clip you want a
// metronome that *matches the music as it actually played*. The
// existing MetronomeDot covers the visual; this covers the audible.

import { useCallback, useEffect, useRef, useState } from "react";

// How far ahead of video.currentTime we look when scheduling. 250ms
// is the standard Web Audio metronome lookahead: large enough to ride
// out main-thread jank, small enough that toggling off feels immediate.
const SCHEDULER_LOOKAHEAD_SEC = 0.25;
// How often the scheduler wakes up. 50ms keeps each tick small while
// still comfortably re-arming inside the lookahead window.
const SCHEDULER_INTERVAL_MS = 50;

const DOWNBEAT_FREQ = 1100;
const BEAT_FREQ = 660;
const CLICK_DURATION = 0.04;
const DOWNBEAT_GAIN = 0.6;
const BEAT_GAIN = 0.4;

const STORAGE_KEY = "swingflow:beat-click-enabled";

export type UseVideoBeatClickOptions = {
  /** Sorted beat timestamps in video seconds. */
  beats: number[] | null | undefined;
  /** Subset of `beats` that are downbeats (bar 1). */
  downbeats: number[] | null | undefined;
  /** The <video> element to mirror — we read currentTime + playback rate
   *  here so the click stays in sync when the user slows the video down. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether the video is currently playing. Pause clears the queue. */
  playing: boolean;
};

export function useVideoBeatClick({
  beats,
  downbeats,
  videoRef,
  playing,
}: UseVideoBeatClickOptions) {
  // Lazy initializer so the localStorage read happens once at mount
  // and lives in render rather than an effect. Effects-that-setState
  // trigger a cascading render, which the lint rule rightly flags.
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  });
  // Track which beat indices we've already scheduled in this play
  // cycle so a single beat doesn't get queued twice when the lookahead
  // window slides over it on consecutive ticks.
  const scheduledIdxRef = useRef<Set<number>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const downbeatSetRef = useRef<Set<number>>(new Set());
  const enabledRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    }
  }, []);

  // Rebuild downbeat lookup whenever the source data changes. Compare
  // by exact float equality matches Beat This!'s output (downbeats is
  // a subset of beats with identical float values).
  useEffect(() => {
    downbeatSetRef.current = new Set(downbeats ?? []);
  }, [downbeats]);

  // Stop scheduler + reset state. Idempotent so we can call it from
  // any of the effects that might tear things down.
  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    scheduledIdxRef.current = new Set();
  }, []);

  // Schedule a single click at a precise AudioContext time. Square
  // wave on a fast envelope reads as a clean "tick" without the
  // smearing you get from a longer sine fade.
  const scheduleClick = useCallback(
    (ctx: AudioContext, atTime: number, isDownbeat: boolean) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.value = isDownbeat ? DOWNBEAT_FREQ : BEAT_FREQ;
      const peak = isDownbeat ? DOWNBEAT_GAIN : BEAT_GAIN;
      gainNode.gain.setValueAtTime(peak, atTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, atTime + CLICK_DURATION);
      osc.start(atTime);
      osc.stop(atTime + CLICK_DURATION);
    },
    []
  );

  // The scheduler tick — finds beats inside the next lookahead window
  // and queues a click for each one we haven't already scheduled in
  // this play cycle.
  const tick = useCallback(() => {
    if (!enabledRef.current) return;
    const video = videoRef.current;
    const ctx = audioCtxRef.current;
    if (!video || !ctx || video.paused) return;
    if (!beats || beats.length === 0) return;

    const videoNow = video.currentTime;
    const rate = video.playbackRate || 1;
    // beat lands at video timestamp T, so the audio-clock time is
    //   audioNow + (T - videoNow) / rate
    // Anything ≤ audioNow has already been missed; skip it.
    const audioNow = ctx.currentTime;
    const lookaheadVideoEnd = videoNow + SCHEDULER_LOOKAHEAD_SEC * rate;

    // Binary search for the first beat >= videoNow. Beats are sorted.
    let lo = 0;
    let hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < videoNow) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < beats.length; i++) {
      const beatTime = beats[i];
      if (beatTime > lookaheadVideoEnd) break;
      if (scheduledIdxRef.current.has(i)) continue;
      const audioTime = audioNow + (beatTime - videoNow) / rate;
      // Past-time defense: occasionally a tick wakes late and the beat
      // has slid into the past. Drop it rather than fire instantly.
      if (audioTime < audioNow) {
        scheduledIdxRef.current.add(i);
        continue;
      }
      const isDownbeat = downbeatSetRef.current.has(beatTime);
      scheduleClick(ctx, audioTime, isDownbeat);
      scheduledIdxRef.current.add(i);
    }
  }, [beats, scheduleClick, videoRef]);

  // Bring the scheduler up when enabled + playing + we have beats.
  // Each play cycle gets a fresh AudioContext if the previous one was
  // closed; reused otherwise so we don't pay the start-up cost on every
  // play/pause toggle.
  useEffect(() => {
    if (!enabled || !playing) {
      teardown();
      return;
    }
    if (!beats || beats.length === 0) return;
    let cancelled = false;

    const ensureContext = async () => {
      let ctx = audioCtxRef.current;
      if (!ctx || ctx.state === "closed") {
        ctx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)();
        audioCtxRef.current = ctx;
      }
      // Browsers freeze suspended contexts after autoplay-policy
      // rejections — resume() is a no-op when already running.
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          // ignore; the next user gesture will re-try
        }
      }
      if (cancelled) return;
      // Fresh schedule set per play cycle so a seek (which fires
      // pause→play) doesn't permanently mark earlier beats as "already
      // scheduled".
      scheduledIdxRef.current = new Set();
      timerRef.current = setInterval(tick, SCHEDULER_INTERVAL_MS);
      // Fire once immediately so the very first beat after press-play
      // doesn't have to wait for the first tick interval.
      tick();
    };
    void ensureContext();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [enabled, playing, beats, tick, teardown]);

  // Seeking inside a play cycle resets the schedule set — we may
  // have jumped past beats that are still in scheduledIdxRef, and
  // we may have jumped backward to beats we'd marked as done.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onSeeked = () => {
      scheduledIdxRef.current = new Set();
    };
    video.addEventListener("seeked", onSeeked);
    return () => {
      video.removeEventListener("seeked", onSeeked);
    };
  }, [videoRef]);

  // Cleanup on unmount: close the AudioContext so we don't leak
  // audio devices when the user navigates away.
  useEffect(() => {
    return () => {
      teardown();
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== "closed") {
        try {
          ctx.close();
        } catch {
          // ignore
        }
      }
      audioCtxRef.current = null;
    };
  }, [teardown]);

  return { enabled, setEnabled };
}
