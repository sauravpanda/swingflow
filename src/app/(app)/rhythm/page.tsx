"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BeatGrid } from "@/components/rhythm/beat-grid";
import { PhraseBeatGrid } from "@/components/rhythm/phrase-beat-grid";
import { RhythmControls } from "@/components/rhythm/rhythm-controls";
import { TapArea } from "@/components/rhythm/tap-area";
import { ChallengeSelector } from "@/components/rhythm/challenge-selector";
import { PatternTimeline } from "@/components/rhythm/pattern-timeline";
import { TimingVisualization } from "@/components/rhythm/timing-visualization";
import { AccuracyHeatmap } from "@/components/rhythm/accuracy-heatmap";
import { TempoRampControls } from "@/components/rhythm/tempo-ramp-controls";
import { MusicPlayer } from "@/components/rhythm/music-player";
import { useMetronome } from "@/hooks/use-metronome";
import { useAudioPlayer } from "@/hooks/use-audio-player";
import { useTapTracker } from "@/hooks/use-tap-tracker";
import { useAccuracyHistory } from "@/hooks/use-accuracy-history";
import { useTempoRamp } from "@/hooks/use-tempo-ramp";
import { useMusicAnalysis } from "@/hooks/use-music-analysis";
import { useAppStore } from "@/components/store-provider";
import {
  type PracticeMode,
  type SubdivisionIndex,
  type ChallengeType,
  type WCSPatternPreset,
  type RhythmSession,
  type TapResult,
  SUBDIVISION_LABELS,
  ACCENT_PATTERNS,
  getSubdivisionLabelsForBeatCount,
} from "@/lib/rhythm-constants";
import { Music } from "lucide-react";

function getRandomSubdivision(max = 8): SubdivisionIndex {
  return Math.floor(Math.random() * max) as SubdivisionIndex;
}

/**
 * Map a song playback time to which 8-count phrase we're inside and
 * which beat (0–7) of that phrase. Returns -1 for either when the user
 * is before the first phrase or hasn't started playing.
 */
function findCurrentPhrasePosition(
  currentTime: number,
  phrases: number[][]
): { phraseIndex: number; beatInPhrase: number } {
  if (!phrases.length) return { phraseIndex: -1, beatInPhrase: -1 };
  // Scan from the end — as playback moves forward, the answer is
  // usually in the last phrase we looked at, so this is effectively O(1).
  for (let p = phrases.length - 1; p >= 0; p--) {
    const phrase = phrases[p];
    if (currentTime >= phrase[0]) {
      for (let i = phrase.length - 1; i >= 0; i--) {
        if (currentTime >= phrase[i]) {
          return { phraseIndex: p, beatInPhrase: i };
        }
      }
    }
  }
  return { phraseIndex: -1, beatInPhrase: -1 };
}

function getTargetForChallenge(
  challengeType: ChallengeType,
  pattern: WCSPatternPreset | null,
  totalSubs: number
): SubdivisionIndex | null {
  if (!pattern) return getRandomSubdivision(totalSubs);

  const targetSubs: number[] = [];
  for (const ev of pattern.stepEvents) {
    if (
      (challengeType === "tap-walks" && ev.type === "walk") ||
      (challengeType === "tap-triples" && ev.type === "triple") ||
      (challengeType === "tap-anchors" && ev.type === "anchor") ||
      challengeType === "cycle-pattern"
    ) {
      targetSubs.push(ev.subdivisionIndex);
    }
  }

  if (targetSubs.length === 0) return getRandomSubdivision(totalSubs);
  return targetSubs[Math.floor(Math.random() * targetSubs.length)] as SubdivisionIndex;
}

function getChallengeLabel(
  challengeType: ChallengeType,
  pattern: WCSPatternPreset | null
): string | undefined {
  if (!pattern) return undefined;
  switch (challengeType) {
    case "tap-walks": return "Tap the Walks!";
    case "tap-triples": return "Tap the Triples!";
    case "tap-anchors": return "Tap the Anchors!";
    case "cycle-pattern": return "Tap the Full Pattern!";
    default: return undefined;
  }
}

export default function RhythmPage() {
  const [mode, setMode] = useState<PracticeMode>("listen");
  const [targetSub, setTargetSub] = useState<SubdivisionIndex | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<WCSPatternPreset | null>(null);
  const [challengeType, setChallengeType] = useState<ChallengeType>("random-subdivision");
  const [isRampMode, setIsRampMode] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const { logPractice } = useAppStore();

  const metronome = useMetronome();
  const audioPlayer = useAudioPlayer();
  const musicAnalysis = useMusicAnalysis();
  const lastFileRef = useRef<File | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const sharedContextRef = useRef<AudioContext | null>(null);
  const tapTracker = useTapTracker(
    metronome.audioContextRef,
    metronome.scheduledBeatsRef
  );
  const accuracyHistory = useAccuracyHistory();
  const tempoRamp = useTempoRamp(metronome.setBpm);

  // Auto-set BPM when audio is detected with sufficient confidence
  useEffect(() => {
    if (audioPlayer.detectedBpm && audioPlayer.bpmConfidence > 0.3) {
      metronome.setBpm(audioPlayer.detectedBpm);
    }
  }, [audioPlayer.detectedBpm, audioPlayer.bpmConfidence, metronome.setBpm]);

  // Auto-mute metronome clicks when a song is loaded — the song already
  // provides the beat, and stacking the tick on top is almost always
  // unwanted. User can still toggle it back on manually.
  useEffect(() => {
    if (audioPlayer.isLoaded) {
      metronome.setMuteClicks(true);
    }
  }, [audioPlayer.isLoaded, metronome.setMuteClicks]);

  // When cloud analysis succeeds, prefer its BPM over the local estimate.
  useEffect(() => {
    if (musicAnalysis.state.status === "success" && musicAnalysis.state.result) {
      metronome.setBpm(Math.round(musicAnalysis.state.result.bpm));
    }
  }, [musicAnalysis.state.status, musicAnalysis.state.result, metronome.setBpm]);

  const handleLoadFile = useCallback(
    (file: File) => {
      lastFileRef.current = file;
      setHasFile(true);
      musicAnalysis.reset();
      audioPlayer.loadFile(file);
    },
    [audioPlayer, musicAnalysis]
  );

  const handleLoadUrl = useCallback(
    (url: string) => {
      lastFileRef.current = null;
      setHasFile(false);
      musicAnalysis.reset();
      audioPlayer.loadUrl(url);
    },
    [audioPlayer, musicAnalysis]
  );

  const handleUnloadFile = useCallback(() => {
    lastFileRef.current = null;
    setHasFile(false);
    musicAnalysis.reset();
    audioPlayer.unload();
  }, [audioPlayer, musicAnalysis]);

  const handleAnalyzePrecise = useCallback(() => {
    const file = lastFileRef.current;
    if (!file) return;
    musicAnalysis.analyze(file);
  }, [musicAnalysis]);

  const effectiveBeatCount = selectedPattern?.beatCount ?? 2;
  const effectiveTotalSubs = selectedPattern?.totalSubdivisions ?? 8;

  const accentBeats = useMemo(() => {
    if (selectedPattern) return selectedPattern.accentBeats;
    return metronome.accentPattern.beats;
  }, [selectedPattern, metronome.accentPattern.beats]);

  const handlePatternChange = useCallback(
    (pattern: WCSPatternPreset | null) => {
      setSelectedPattern(pattern);
      if (pattern) {
        metronome.setTotalSubdivisions(pattern.totalSubdivisions);
        // Set accent pattern to pattern's accents
        metronome.setAccentPattern({
          label: pattern.name,
          beats: pattern.accentBeats,
        });
      } else {
        metronome.setTotalSubdivisions(8);
        metronome.setAccentPattern(ACCENT_PATTERNS[0]);
      }
      // Reset challenge type when switching patterns
      setChallengeType(pattern ? "tap-walks" : "random-subdivision");
    },
    [metronome]
  );

  const handleStart = useCallback(() => {
    const ctx = new AudioContext();
    sharedContextRef.current = ctx;
    metronome.start(ctx);
    if (audioPlayer.isLoaded) {
      audioPlayer.play(ctx);
    }
    startTimeRef.current = Date.now();
    tapTracker.reset();
    if (mode === "challenge") {
      setTargetSub(getTargetForChallenge(challengeType, selectedPattern, effectiveTotalSubs));
    }
    if (isRampMode) {
      tempoRamp.start();
    }
  }, [metronome, audioPlayer, tapTracker, mode, challengeType, selectedPattern, effectiveTotalSubs, isRampMode, tempoRamp]);

  const handleStop = useCallback(() => {
    metronome.stop(true); // keep context alive briefly
    audioPlayer.stop();
    if (sharedContextRef.current) {
      sharedContextRef.current.close();
      sharedContextRef.current = null;
    }
    if (isRampMode && tempoRamp.state.isActive) {
      tempoRamp.stop();
    }

    // Save session to history if enough taps
    if (tapTracker.results.length >= 5) {
      const session: RhythmSession = {
        id: crypto.randomUUID(),
        patternId: selectedPattern?.id ?? null,
        bpm: metronome.bpm,
        feel: metronome.feel,
        totalTaps: tapTracker.results.length,
        results: tapTracker.results,
        accuracy: tapTracker.getAccuracyPercent(),
        timestamp: Date.now(),
      };
      accuracyHistory.saveSession(session);
    }

    if (startTimeRef.current) {
      const durationSec = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (durationSec >= 30) {
        logPractice(durationSec, "rhythm");
      }
      startTimeRef.current = null;
    }
  }, [metronome, audioPlayer, logPractice, tapTracker, selectedPattern, accuracyHistory, isRampMode, tempoRamp]);

  const handleTargetHit = useCallback(
    (result: TapResult) => {
      // Re-roll target for challenge mode
      setTargetSub(getTargetForChallenge(challengeType, selectedPattern, effectiveTotalSubs));
      // Feed to ramp tracker
      if (isRampMode) {
        tempoRamp.onTapResult(result);
      }
    },
    [challengeType, selectedPattern, effectiveTotalSubs, isRampMode, tempoRamp]
  );

  const handleTapInTapMode = useCallback(() => {
    const result = tapTracker.handleTap();
    if (result && isRampMode) {
      tempoRamp.onTapResult(result);
    }
    return result;
  }, [tapTracker, isRampMode, tempoRamp]);

  const handleModeChange = useCallback(
    (value: string) => {
      const newMode = value as PracticeMode;
      setMode(newMode);
      if (newMode === "challenge" && metronome.isPlaying) {
        setTargetSub(getTargetForChallenge(challengeType, selectedPattern, effectiveTotalSubs));
      } else {
        setTargetSub(null);
      }
    },
    [metronome.isPlaying, challengeType, selectedPattern, effectiveTotalSubs]
  );

  const subdivisionLabels = useMemo(() => {
    if (selectedPattern) {
      return getSubdivisionLabelsForBeatCount(selectedPattern.beatCount);
    }
    return SUBDIVISION_LABELS;
  }, [selectedPattern]);

  const timingDots = tapTracker.getTimingDots();
  const aggregateAccuracy = accuracyHistory.getAggregateAccuracy(selectedPattern?.id);
  const challengeLabel = getChallengeLabel(challengeType, selectedPattern);

  // Song-synced phrase visualization — only populated when precise cloud
  // analysis has run on the loaded song.
  const analysisResult = musicAnalysis.state.result;
  const analyzedPhrases = analysisResult?.phrases ?? [];
  const { phraseIndex, beatInPhrase } =
    analysisResult && audioPlayer.isPlaying
      ? findCurrentPhrasePosition(audioPlayer.currentTime, analyzedPhrases)
      : { phraseIndex: -1, beatInPhrase: -1 };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Music className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Rhythm Trainer</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Practice 16th note subdivisions for West Coast Swing
        </p>
      </div>

      {/* Beat Grid */}
      <BeatGrid
        currentSubdivision={metronome.currentSubdivision}
        accentBeats={accentBeats}
        targetSubdivision={mode === "challenge" ? targetSub : null}
        pattern={selectedPattern}
        phrasePosition={metronome.phrasePosition}
        totalSubdivisions={metronome.totalSubdivisions}
      />

      {/* Song-synced phrase grid — only when precise analysis is loaded */}
      {analysisResult && (
        <Card>
          <CardContent className="pt-5">
            <PhraseBeatGrid
              currentBeatInPhrase={beatInPhrase}
              phraseIndex={phraseIndex}
              totalPhrases={analyzedPhrases.length}
            />
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <RhythmControls
        isPlaying={metronome.isPlaying}
        bpm={metronome.bpm}
        feel={metronome.feel}
        accentPattern={metronome.accentPattern}
        onStart={handleStart}
        onStop={handleStop}
        onBpmChange={metronome.setBpm}
        onFeelChange={metronome.setFeel}
        onAccentChange={metronome.setAccentPattern}
        selectedPattern={selectedPattern}
        onPatternChange={handlePatternChange}
        phrasePosition={metronome.phrasePosition}
        isRampMode={isRampMode}
        onRampModeToggle={() => setIsRampMode((prev) => !prev)}
      />

      {/* Music Player */}
      <MusicPlayer
        playerState={audioPlayer}
        onLoadFile={handleLoadFile}
        onLoadUrl={handleLoadUrl}
        onUnload={handleUnloadFile}
        onVolumeChange={audioPlayer.setVolume}
        onBpmSelect={metronome.setBpm}
        muteClicks={metronome.muteClicks}
        onMuteClicksToggle={() => metronome.setMuteClicks((prev) => !prev)}
        disabled={metronome.isPlaying}
        analysisState={
          musicAnalysis.isConfigured && hasFile ? musicAnalysis.state : undefined
        }
        onAnalyzePrecise={
          musicAnalysis.isConfigured && hasFile ? handleAnalyzePrecise : undefined
        }
      />

      {/* Practice Modes */}
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="listen">Listen</TabsTrigger>
          <TabsTrigger value="tap">Tap</TabsTrigger>
          <TabsTrigger value="challenge">Challenge</TabsTrigger>
        </TabsList>

        <TabsContent value="listen" className="space-y-4">
          {selectedPattern ? (
            <PatternTimeline
              pattern={selectedPattern}
              currentSubdivision={metronome.currentSubdivision}
              isPlaying={metronome.isPlaying}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Counting Guide</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Listen to the 16th note subdivisions and count along:
                </p>
                <div className="flex items-center justify-center gap-2 text-lg font-mono font-bold py-2">
                  {(subdivisionLabels as readonly string[]).map((label, i) => (
                    <span key={i} className="w-6 text-center">
                      {label}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    <span className="font-semibold text-red-400">1, 2</span> — Downbeats (strongest)
                  </p>
                  <p>
                    <span className="font-semibold text-green-400">&</span> — Upbeats
                  </p>
                  <p>
                    <span className="font-semibold text-blue-400">e</span> and{" "}
                    <span className="font-semibold text-yellow-400">a</span> — Inner subdivisions
                  </p>
                  <p className="pt-2">
                    Try the <span className="font-semibold">Swung</span> feel to hear how WCS music shifts the timing of e and a subdivisions.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ramp controls in listen tab when ramp mode is on */}
          {isRampMode && (
            <TempoRampControls
              config={tempoRamp.config}
              state={tempoRamp.state}
              onConfigChange={tempoRamp.setConfig}
              onStart={tempoRamp.start}
              onStop={tempoRamp.stop}
            />
          )}
        </TabsContent>

        <TabsContent value="tap" className="space-y-4">
          {metronome.isPlaying ? (
            <>
              <TapArea
                results={tapTracker.results}
                onTap={handleTapInTapMode}
                accuracyPercent={tapTracker.getAccuracyPercent()}
              />
              {timingDots.length > 0 && (
                <TimingVisualization
                  timingDots={timingDots}
                  beatCount={effectiveBeatCount}
                />
              )}
              {aggregateAccuracy.length > 0 && (
                <AccuracyHeatmap
                  data={aggregateAccuracy}
                  beatCount={effectiveBeatCount}
                />
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Press <span className="font-semibold">Start</span> to begin tapping along
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="challenge" className="space-y-4">
          <ChallengeSelector
            selectedPattern={selectedPattern}
            challengeType={challengeType}
            onChallengeTypeChange={setChallengeType}
          />
          {metronome.isPlaying ? (
            <>
              <TapArea
                results={tapTracker.results}
                onTap={tapTracker.handleTap}
                accuracyPercent={tapTracker.getAccuracyPercent()}
                targetSubdivision={targetSub}
                onTargetHit={handleTargetHit}
                challengeLabel={challengeLabel}
              />
              {timingDots.length > 0 && (
                <TimingVisualization
                  timingDots={timingDots}
                  beatCount={effectiveBeatCount}
                />
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Press <span className="font-semibold">Start</span> to begin the challenge
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
