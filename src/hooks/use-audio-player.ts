"use client";

import { useState, useRef, useCallback } from "react";
import { detectBpm, type BpmDetectionResult } from "@/lib/bpm-detection";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export type AudioPlayerState = {
  isLoading: boolean;
  loadError: string | null;
  fileName: string | null;
  duration: number;
  isLoaded: boolean;
  detectedBpm: number | null;
  bpmConfidence: number;
  bpmCandidates: { bpm: number; strength: number }[];
  isDetectingBpm: boolean;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
};

export function useAudioPlayer() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [bpmConfidence, setBpmConfidence] = useState(0);
  const [bpmCandidates, setBpmCandidates] = useState<
    { bpm: number; strength: number }[]
  >([]);
  const [isDetectingBpm, setIsDetectingBpm] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(0.8);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const startOffsetRef = useRef(0);
  const startTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const updateTime = useCallback(() => {
    const ctx = playbackContextRef.current;
    if (!ctx || !sourceNodeRef.current) return;
    const elapsed = ctx.currentTime - startTimeRef.current + startOffsetRef.current;
    setCurrentTime(elapsed);
    rafRef.current = requestAnimationFrame(updateTime);
  }, []);

  const decodeAndDetect = useCallback(
    async (arrayBuffer: ArrayBuffer, name: string) => {
      setIsLoading(true);
      setLoadError(null);

      try {
        // Decode with a temporary context
        const tempCtx = new AudioContext();
        const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        await tempCtx.close();

        audioBufferRef.current = audioBuffer;
        setFileName(name);
        setDuration(audioBuffer.duration);
        setIsLoaded(true);

        // Run BPM detection
        setIsDetectingBpm(true);
        const result: BpmDetectionResult = detectBpm(audioBuffer);
        setDetectedBpm(result.bpm);
        setBpmConfidence(result.confidence);
        setBpmCandidates(result.candidates);
        setIsDetectingBpm(false);
      } catch {
        setLoadError("Failed to decode audio file");
        setIsLoaded(false);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_SIZE) {
        setLoadError("File too large (max 50MB)");
        return;
      }
      if (!file.type.startsWith("audio/")) {
        setLoadError("Not an audio file");
        return;
      }
      const arrayBuffer = await file.arrayBuffer();
      await decodeAndDetect(arrayBuffer, file.name);
    },
    [decodeAndDetect]
  );

  const loadUrl = useCallback(
    async (url: string) => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Fetch failed");
        const arrayBuffer = await response.arrayBuffer();
        const urlName = url.split("/").pop()?.split("?")[0] || "URL Audio";
        await decodeAndDetect(arrayBuffer, urlName);
      } catch {
        setLoadError("Failed to load audio from URL");
        setIsLoading(false);
      }
    },
    [decodeAndDetect]
  );

  const play = useCallback(
    (audioContext: AudioContext) => {
      if (!audioBufferRef.current) return;

      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();

      source.buffer = audioBufferRef.current;
      source.connect(gain);
      gain.connect(audioContext.destination);
      gain.gain.value = volume;

      sourceNodeRef.current = source;
      gainNodeRef.current = gain;
      playbackContextRef.current = audioContext;
      startTimeRef.current = audioContext.currentTime;
      startOffsetRef.current = 0;

      source.onended = () => {
        setIsPlaying(false);
        stopRaf();
        sourceNodeRef.current = null;
      };

      source.start(0);
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(updateTime);
    },
    [volume, updateTime, stopRaf]
  );

  const stop = useCallback(() => {
    stopRaf();
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // source may already be stopped
      }
      sourceNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    playbackContextRef.current = null;
    startOffsetRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, [stopRaf]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = v;
    }
  }, []);

  const unload = useCallback(() => {
    stop();
    audioBufferRef.current = null;
    setFileName(null);
    setDuration(0);
    setIsLoaded(false);
    setDetectedBpm(null);
    setBpmConfidence(0);
    setBpmCandidates([]);
    setIsDetectingBpm(false);
    setLoadError(null);
  }, [stop]);

  return {
    // State
    isLoading,
    loadError,
    fileName,
    duration,
    isLoaded,
    detectedBpm,
    bpmConfidence,
    bpmCandidates,
    isDetectingBpm,
    isPlaying,
    currentTime,
    volume,
    // Actions
    loadFile,
    loadUrl,
    play,
    stop,
    setVolume,
    unload,
  };
}
