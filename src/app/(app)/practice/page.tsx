"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircularTimer } from "@/components/circular-timer";
import { useTimer, formatTime } from "@/hooks/use-timer";
import { routines, type Routine } from "@/lib/routines";
import { useAppStore } from "@/components/store-provider";
import { Play, Pause, RotateCcw, Check, Clock } from "lucide-react";

export default function PracticePage() {
  const [selectedRoutine, setSelectedRoutine] = useState<Routine | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useTimer(selectedRoutine?.duration ?? 0);
  const { logPractice } = useAppStore();

  const currentStep = useMemo(() => {
    if (!selectedRoutine) return null;

    let accumulated = 0;
    for (const step of selectedRoutine.steps) {
      accumulated += step.duration;
      if (timer.elapsed < accumulated) {
        return {
          ...step,
          remaining: accumulated - timer.elapsed,
          index: selectedRoutine.steps.indexOf(step),
        };
      }
    }
    return null;
  }, [selectedRoutine, timer.elapsed]);

  const handleComplete = () => {
    if (!selectedRoutine) return;
    logPractice(timer.elapsed, selectedRoutine.id);
    setSaved(true);
  };

  if (!selectedRoutine) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Practice Timer</h1>
          <p className="text-muted-foreground">
            Choose a structured warm-up routine
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {routines.map((routine) => (
            <Card
              key={routine.id}
              className="cursor-pointer transition-colors hover:border-primary/30"
              onClick={() => setSelectedRoutine(routine)}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">{routine.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold mb-2">
                  {formatTime(routine.duration)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {routine.steps.length} exercises
                </p>
                <ul className="mt-3 space-y-1">
                  {routine.steps.map((step, i) => (
                    <li
                      key={i}
                      className="text-xs text-muted-foreground flex justify-between"
                    >
                      <span>{step.label}</span>
                      <span>{formatTime(step.duration)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (timer.state === "finished") {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="h-16 w-16 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Practice Complete!</h2>
        <p className="text-muted-foreground mb-1">
          {selectedRoutine.name} — {formatTime(selectedRoutine.duration)}
        </p>
        {saved ? (
          <p className="text-sm text-emerald-400">Session saved to your log</p>
        ) : (
          <Button onClick={handleComplete} className="mt-4">
            Save Session
          </Button>
        )}
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            setSelectedRoutine(null);
            timer.reset();
            setSaved(false);
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          New Session
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-bold">{selectedRoutine.name}</h1>
        <p className="text-sm text-muted-foreground">
          {selectedRoutine.steps.length} exercises
        </p>
      </div>

      <div className="flex justify-center">
        <CircularTimer
          remaining={timer.remaining}
          total={selectedRoutine.duration}
          progress={timer.progress}
        />
      </div>

      <div className="flex justify-center gap-3">
        {timer.state === "idle" && (
          <Button onClick={timer.start} size="lg">
            <Play className="mr-2 h-5 w-5" />
            Start
          </Button>
        )}
        {timer.state === "running" && (
          <Button onClick={timer.pause} variant="outline" size="lg">
            <Pause className="mr-2 h-5 w-5" />
            Pause
          </Button>
        )}
        {timer.state === "paused" && (
          <>
            <Button onClick={timer.resume} size="lg">
              <Play className="mr-2 h-5 w-5" />
              Resume
            </Button>
            <Button onClick={timer.reset} variant="outline" size="lg">
              <RotateCcw className="mr-2 h-5 w-5" />
              Reset
            </Button>
          </>
        )}
      </div>

      {currentStep && (timer.state === "running" || timer.state === "paused") && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {currentStep.label}
              </CardTitle>
              <span className="text-sm text-muted-foreground">
                Step {currentStep.index + 1}/{selectedRoutine.steps.length}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              {currentStep.description}
            </p>
            <p className="text-xs text-primary font-mono">
              {formatTime(currentStep.remaining)} remaining in this step
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-1">
        {selectedRoutine.steps.map((step, i) => {
          let accumulated = 0;
          for (let j = 0; j <= i; j++) {
            accumulated += selectedRoutine.steps[j].duration;
          }
          const stepStart = accumulated - step.duration;
          const isComplete = timer.elapsed >= accumulated;
          const isCurrent =
            timer.elapsed >= stepStart && timer.elapsed < accumulated;

          return (
            <div
              key={i}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                isComplete
                  ? "text-muted-foreground/50 line-through"
                  : isCurrent
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                {isComplete && <Check className="h-3 w-3" />}
                {step.label}
              </span>
              <span className="text-xs">{formatTime(step.duration)}</span>
            </div>
          );
        })}
      </div>

      <div className="text-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelectedRoutine(null);
            timer.reset();
          }}
        >
          Choose different routine
        </Button>
      </div>
    </div>
  );
}
