"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import type { TempoRampConfig } from "@/lib/rhythm-constants";
import type { TempoRampState } from "@/hooks/use-tempo-ramp";

type TempoRampControlsProps = {
  config: TempoRampConfig;
  state: TempoRampState;
  onConfigChange: (config: TempoRampConfig) => void;
  onStart: () => void;
  onStop: () => void;
};

export function TempoRampControls({
  config,
  state,
  onConfigChange,
  onStart,
  onStop,
}: TempoRampControlsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          Tempo Ramp
          {state.isActive && (
            <Badge variant="default" className="ml-2">Active</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.isActive ? (
          <>
            {/* Live display */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Current</p>
                <p className="text-lg font-mono font-bold">{state.currentBpm}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Best</p>
                <p className="text-lg font-mono font-bold text-emerald-400">{state.highestBpm}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Misses</p>
                <p className="text-lg font-mono font-bold text-red-400">
                  {state.consecutiveMisses}/{config.maxMisses}
                </p>
              </div>
            </div>
            <Button onClick={onStop} variant="destructive" size="sm" className="w-full">
              Stop Ramp
            </Button>
          </>
        ) : (
          <>
            {/* Config */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Start BPM</span>
                <span className="text-sm font-mono">{config.startBpm}</span>
              </div>
              <Slider
                value={[config.startBpm]}
                min={60}
                max={120}
                step={5}
                onValueChange={([v]) => onConfigChange({ ...config, startBpm: v })}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">+BPM:</span>
              {[5, 10].map((inc) => (
                <Badge
                  key={inc}
                  variant={config.incrementBpm === inc ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => onConfigChange({ ...config, incrementBpm: inc })}
                >
                  {inc}
                </Badge>
              ))}
              <span className="text-xs text-muted-foreground shrink-0 ml-2">Every:</span>
              {[15, 30, 60].map((sec) => (
                <Badge
                  key={sec}
                  variant={config.intervalSeconds === sec ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => onConfigChange({ ...config, intervalSeconds: sec })}
                >
                  {sec}s
                </Badge>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Miss tolerance:</span>
              {[2, 3, 5].map((n) => (
                <Badge
                  key={n}
                  variant={config.maxMisses === n ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => onConfigChange({ ...config, maxMisses: n })}
                >
                  {n}
                </Badge>
              ))}
            </div>

            <Button onClick={onStart} size="sm" className="w-full">
              Start Ramp
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
