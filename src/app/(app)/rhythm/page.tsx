"use client";

import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BeatGrid } from "@/components/rhythm/beat-grid";
import { RhythmControls } from "@/components/rhythm/rhythm-controls";
import { TapArea } from "@/components/rhythm/tap-area";
import { useMetronome } from "@/hooks/use-metronome";
import { useTapTracker } from "@/hooks/use-tap-tracker";
import { useAppStore } from "@/components/store-provider";
import {
  type PracticeMode,
  type SubdivisionIndex,
  SUBDIVISION_LABELS,
} from "@/lib/rhythm-constants";
import { Music } from "lucide-react";

function getRandomSubdivision(): SubdivisionIndex {
  return Math.floor(Math.random() * 8) as SubdivisionIndex;
}

export default function RhythmPage() {
  const [mode, setMode] = useState<PracticeMode>("listen");
  const [targetSub, setTargetSub] = useState<SubdivisionIndex | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const { logPractice } = useAppStore();

  const metronome = useMetronome();
  const tapTracker = useTapTracker(
    metronome.audioContextRef,
    metronome.scheduledBeatsRef
  );

  const handleStart = useCallback(() => {
    metronome.start();
    startTimeRef.current = Date.now();
    tapTracker.reset();
    if (mode === "challenge") {
      setTargetSub(getRandomSubdivision());
    }
  }, [metronome, tapTracker, mode]);

  const handleStop = useCallback(() => {
    metronome.stop();
    if (startTimeRef.current) {
      const durationSec = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (durationSec >= 30) {
        logPractice(durationSec, "rhythm");
      }
      startTimeRef.current = null;
    }
  }, [metronome, logPractice]);

  const handleTargetHit = useCallback(() => {
    // Re-roll target after each tap in challenge mode
    setTargetSub(getRandomSubdivision());
  }, []);

  const handleModeChange = useCallback(
    (value: string) => {
      const newMode = value as PracticeMode;
      setMode(newMode);
      if (newMode === "challenge" && metronome.isPlaying) {
        setTargetSub(getRandomSubdivision());
      } else {
        setTargetSub(null);
      }
    },
    [metronome.isPlaying]
  );

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
        accentBeats={metronome.accentPattern.beats}
        targetSubdivision={mode === "challenge" ? targetSub : null}
      />

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
      />

      {/* Practice Modes */}
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="listen">Listen</TabsTrigger>
          <TabsTrigger value="tap">Tap</TabsTrigger>
          <TabsTrigger value="challenge">Challenge</TabsTrigger>
        </TabsList>

        <TabsContent value="listen">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Counting Guide</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Listen to the 16th note subdivisions and count along:
              </p>
              <div className="flex items-center justify-center gap-2 text-lg font-mono font-bold py-2">
                {SUBDIVISION_LABELS.map((label, i) => (
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
        </TabsContent>

        <TabsContent value="tap">
          {metronome.isPlaying ? (
            <TapArea
              results={tapTracker.results}
              onTap={tapTracker.handleTap}
              accuracyPercent={tapTracker.getAccuracyPercent()}
            />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Press <span className="font-semibold">Start</span> to begin tapping along
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="challenge">
          {metronome.isPlaying ? (
            <TapArea
              results={tapTracker.results}
              onTap={tapTracker.handleTap}
              accuracyPercent={tapTracker.getAccuracyPercent()}
              targetSubdivision={targetSub}
              onTargetHit={handleTargetHit}
            />
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
