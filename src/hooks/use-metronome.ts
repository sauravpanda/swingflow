"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  type Feel,
  type AccentPattern,
  ACCENT_PATTERNS,
  BPM_DEFAULT,
  SCHEDULER_INTERVAL_MS,
  SCHEDULER_LOOKAHEAD_MS,
} from "@/lib/rhythm-constants";

export type ScheduledBeat = {
  time: number; // AudioContext time
  subdivisionIndex: number;
};

export function useMetronome() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(BPM_DEFAULT);
  const [feel, setFeel] = useState<Feel>("straight");
  const [accentPattern, setAccentPattern] = useState<AccentPattern>(ACCENT_PATTERNS[0]);
  const [currentSubdivision, setCurrentSubdivision] = useState(-1);

  const audioContextRef = useRef<AudioContext | null>(null);
  const schedulerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextNoteTimeRef = useRef(0);
  const currentSubRef = useRef(0);
  const scheduledBeatsRef = useRef<ScheduledBeat[]>([]);
  const rafRef = useRef<number | null>(null);

  // Refs that stay in sync with state for use inside scheduler
  const bpmRef = useRef(bpm);
  const feelRef = useRef(feel);
  const accentPatternRef = useRef(accentPattern);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { feelRef.current = feel; }, [feel]);
  useEffect(() => { accentPatternRef.current = accentPattern; }, [accentPattern]);

  const getSubdivisionDuration = useCallback((index: number) => {
    const sixteenthBase = 60 / (bpmRef.current * 4); // duration of one 16th note in seconds
    if (feelRef.current === "straight") return sixteenthBase;

    // Swing: delay odd-indexed subdivisions (e, a) by 30% of a 16th
    const swingOffset = sixteenthBase * 0.3;
    if (index % 2 === 0) {
      // Even positions (1, &) are shortened
      return sixteenthBase - swingOffset;
    }
    // Odd positions (e, a) are lengthened
    return sixteenthBase + swingOffset;
  }, []);

  const scheduleClick = useCallback((time: number, subdivisionIndex: number) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const isAccented = accentPatternRef.current.beats[subdivisionIndex];
    if (!isAccented) return; // Don't play non-accented beats

    const isDownbeat = subdivisionIndex === 0 || subdivisionIndex === 4;
    const frequency = isDownbeat ? 1000 : 880;
    const gain = isDownbeat ? 0.5 : 0.3;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.frequency.value = frequency;
    osc.type = "square";

    gainNode.gain.setValueAtTime(gain, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.03);

    osc.start(time);
    osc.stop(time + 0.03);
  }, []);

  const scheduler = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const lookaheadEnd = ctx.currentTime + SCHEDULER_LOOKAHEAD_MS / 1000;

    while (nextNoteTimeRef.current < lookaheadEnd) {
      const subIndex = currentSubRef.current;

      scheduleClick(nextNoteTimeRef.current, subIndex);

      // Store scheduled beat for tap comparison
      scheduledBeatsRef.current.push({
        time: nextNoteTimeRef.current,
        subdivisionIndex: subIndex,
      });
      // Keep only last 16 beats
      if (scheduledBeatsRef.current.length > 16) {
        scheduledBeatsRef.current.shift();
      }

      // Advance to next subdivision
      const duration = getSubdivisionDuration(subIndex);
      nextNoteTimeRef.current += duration;
      currentSubRef.current = (subIndex + 1) % 8;
    }
  }, [scheduleClick, getSubdivisionDuration]);

  const updateVisual = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    // Find the most recent scheduled beat that has passed
    const beats = scheduledBeatsRef.current;
    let activeSub = -1;
    for (let i = beats.length - 1; i >= 0; i--) {
      if (beats[i].time <= ctx.currentTime) {
        activeSub = beats[i].subdivisionIndex;
        break;
      }
    }

    setCurrentSubdivision(activeSub);
    rafRef.current = requestAnimationFrame(updateVisual);
  }, []);

  const start = useCallback(() => {
    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    currentSubRef.current = 0;
    nextNoteTimeRef.current = ctx.currentTime;
    scheduledBeatsRef.current = [];

    schedulerTimerRef.current = setInterval(scheduler, SCHEDULER_INTERVAL_MS);
    rafRef.current = requestAnimationFrame(updateVisual);

    setIsPlaying(true);
    setCurrentSubdivision(-1);
  }, [scheduler, updateVisual]);

  const stop = useCallback(() => {
    if (schedulerTimerRef.current) {
      clearInterval(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsPlaying(false);
    setCurrentSubdivision(-1);
    scheduledBeatsRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  return {
    isPlaying,
    bpm,
    setBpm,
    feel,
    setFeel,
    accentPattern,
    setAccentPattern,
    currentSubdivision,
    start,
    stop,
    audioContextRef,
    scheduledBeatsRef,
  };
}
