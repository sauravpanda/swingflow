"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Square, Minus, Plus } from "lucide-react";
import {
  type Feel,
  type AccentPattern,
  type WCSPatternPreset,
  ACCENT_PATTERNS,
  WCS_PATTERN_PRESETS,
  BPM_MIN,
  BPM_MAX,
} from "@/lib/rhythm-constants";

type RhythmControlsProps = {
  isPlaying: boolean;
  bpm: number;
  feel: Feel;
  accentPattern: AccentPattern;
  onStart: () => void;
  onStop: () => void;
  onBpmChange: (bpm: number) => void;
  onFeelChange: (feel: Feel) => void;
  onAccentChange: (pattern: AccentPattern) => void;
  selectedPattern: WCSPatternPreset | null;
  onPatternChange: (pattern: WCSPatternPreset | null) => void;
  phrasePosition: number;
  isRampMode: boolean;
  onRampModeToggle: () => void;
};

const countsPatterns = WCS_PATTERN_PRESETS.filter((p) => p.difficulty === "counts");
const eighthsPatterns = WCS_PATTERN_PRESETS.filter((p) => p.difficulty === "eighths");

export function RhythmControls({
  isPlaying,
  bpm,
  feel,
  accentPattern,
  onStart,
  onStop,
  onBpmChange,
  onFeelChange,
  onAccentChange,
  selectedPattern,
  onPatternChange,
  phrasePosition,
  isRampMode,
  onRampModeToggle,
}: RhythmControlsProps) {
  const beatCount = selectedPattern?.beatCount ?? 0;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Pattern Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground shrink-0">Pattern:</span>
          <Select
            value={selectedPattern?.id ?? "free"}
            onValueChange={(id) => {
              if (id === "free") {
                onPatternChange(null);
              } else {
                const p = WCS_PATTERN_PRESETS.find((pat) => pat.id === id);
                if (p) onPatternChange(p);
              }
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free Practice</SelectItem>
              {countsPatterns.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Counts</SelectLabel>
                  {countsPatterns.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.beatCount}-count)
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {eighthsPatterns.length > 0 && (
                <SelectGroup>
                  <SelectLabel>8th Notes</SelectLabel>
                  {eighthsPatterns.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.beatCount}-count)
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Phrase counter when pattern selected and playing */}
        {selectedPattern && isPlaying && phrasePosition > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Beat</span>
            <span className="text-lg font-mono font-bold">{phrasePosition}</span>
            <span className="text-sm text-muted-foreground">of {beatCount}</span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden ml-2">
              <div
                className="h-full bg-primary rounded-full transition-all duration-75"
                style={{ width: `${(phrasePosition / beatCount) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Play/Stop + BPM */}
        <div className="flex items-center gap-4">
          <Button
            onClick={isPlaying ? onStop : onStart}
            size="lg"
            variant={isPlaying ? "destructive" : "default"}
            className="shrink-0"
          >
            {isPlaying ? (
              <>
                <Square className="mr-2 h-5 w-5" />
                Stop
              </>
            ) : (
              <>
                <Play className="mr-2 h-5 w-5" />
                Start
              </>
            )}
          </Button>

          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">BPM</span>
              <span className="text-2xl font-mono font-bold tabular-nums">
                {bpm}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => onBpmChange(Math.max(BPM_MIN, bpm - 5))}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <Slider
                value={[bpm]}
                min={BPM_MIN}
                max={BPM_MAX}
                step={1}
                onValueChange={([v]) => onBpmChange(v)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => onBpmChange(Math.min(BPM_MAX, bpm + 5))}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* Feel + Accent/Ramp */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Feel:</span>
            <Badge
              variant={feel === "straight" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => onFeelChange("straight")}
            >
              Straight
            </Badge>
            <Badge
              variant={feel === "swung" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => onFeelChange("swung")}
            >
              Swung
            </Badge>
            <Badge
              variant={isRampMode ? "default" : "outline"}
              className="cursor-pointer ml-1"
              onClick={onRampModeToggle}
            >
              Ramp
            </Badge>
          </div>

          {/* Only show accent dropdown when no pattern is selected */}
          {!selectedPattern && (
            <div className="flex items-center gap-2 sm:ml-auto">
              <span className="text-sm text-muted-foreground">Accents:</span>
              <Select
                value={accentPattern.label}
                onValueChange={(label) => {
                  const pattern = ACCENT_PATTERNS.find((p) => p.label === label);
                  if (pattern) onAccentChange(pattern);
                }}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCENT_PATTERNS.map((p) => (
                    <SelectItem key={p.label} value={p.label}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
