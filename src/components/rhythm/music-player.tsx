"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Upload, Link, X, Volume2, Loader2, Minus, Plus, Sparkles } from "lucide-react";
import type { AudioPlayerState } from "@/hooks/use-audio-player";
import type { MusicAnalysisState } from "@/hooks/use-music-analysis";

type MusicPlayerProps = {
  playerState: AudioPlayerState;
  onLoadFile: (file: File) => void;
  onLoadUrl: (url: string) => void;
  onUnload: () => void;
  onVolumeChange: (v: number) => void;
  onBpmSelect: (bpm: number) => void;
  muteClicks: boolean;
  onMuteClicksToggle: () => void;
  disabled?: boolean;
  analysisState?: MusicAnalysisState;
  onAnalyzePrecise?: () => void;
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function confidenceColor(confidence: number): "default" | "secondary" | "destructive" {
  if (confidence >= 0.5) return "default";
  if (confidence >= 0.3) return "secondary";
  return "destructive";
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.5) return "High";
  if (confidence >= 0.3) return "Medium";
  return "Low";
}

export function MusicPlayer({
  playerState,
  onLoadFile,
  onLoadUrl,
  onUnload,
  onVolumeChange,
  onBpmSelect,
  muteClicks,
  onMuteClicksToggle,
  disabled,
  analysisState,
  onAnalyzePrecise,
}: MusicPlayerProps) {
  const [urlInput, setUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file);
    // Reset so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUrlLoad = () => {
    const trimmed = urlInput.trim();
    if (trimmed) {
      onLoadUrl(trimmed);
      setUrlInput("");
    }
  };

  if (playerState.isLoaded) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              Music
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onUnload}
              disabled={disabled}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground truncate max-w-[200px]">
              {playerState.fileName}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatDuration(playerState.duration)}
            </span>
          </div>

          {/* Detected BPM */}
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm text-muted-foreground">Detected:</span>
              {playerState.isDetectingBpm ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="text-2xl font-mono font-bold tabular-nums">
                  {playerState.detectedBpm ?? "—"}
                </span>
              )}
              <span className="text-sm text-muted-foreground">BPM</span>
            </div>
            {playerState.detectedBpm && !playerState.isDetectingBpm && (
              <Badge variant={confidenceColor(playerState.bpmConfidence)}>
                {confidenceLabel(playerState.bpmConfidence)}
              </Badge>
            )}
          </div>

          {/* BPM adjustment */}
          {playerState.detectedBpm && !playerState.isDetectingBpm && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onBpmSelect(playerState.detectedBpm! - 5)}
                >
                  <Minus className="h-3 w-3 mr-0.5" />5
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onBpmSelect(playerState.detectedBpm! - 1)}
                >
                  <Minus className="h-3 w-3 mr-0.5" />1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onBpmSelect(playerState.detectedBpm! + 1)}
                >
                  <Plus className="h-3 w-3 mr-0.5" />1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onBpmSelect(playerState.detectedBpm! + 5)}
                >
                  <Plus className="h-3 w-3 mr-0.5" />5
                </Button>
                {/* Candidate badges */}
                {playerState.bpmCandidates.length > 1 &&
                  playerState.bpmCandidates.slice(1).map((c, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="cursor-pointer text-xs"
                      onClick={() => onBpmSelect(c.bpm)}
                    >
                      {c.bpm}
                    </Badge>
                  ))}
              </div>
            </div>
          )}

          {/* Precise analysis (cloud, librosa) */}
          {analysisState && onAnalyzePrecise && (
            <div className="space-y-2">
              <Separator />
              {analysisState.status === "idle" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full"
                  onClick={onAnalyzePrecise}
                  disabled={disabled}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  Analyze precisely (cloud)
                </Button>
              )}
              {analysisState.status === "loading" && (
                <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing (~5s)…
                </div>
              )}
              {analysisState.status === "success" && analysisState.result && (
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">
                      Precise BPM:
                    </span>{" "}
                    <span className="font-mono">
                      {Math.round(analysisState.result.bpm)}
                    </span>
                  </div>
                  <div>
                    {analysisState.result.downbeats.length} downbeats ·{" "}
                    {analysisState.result.phrases.length} × 8-count phrases ·{" "}
                    {analysisState.result.anchor_beats.length} anchors
                  </div>
                </div>
              )}
              {analysisState.status === "error" && (
                <p className="text-xs text-destructive">{analysisState.error}</p>
              )}
            </div>
          )}

          {/* Volume + Mute Clicks */}
          <div className="flex items-center gap-3">
            <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <Slider
              value={[playerState.volume * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => onVolumeChange(v / 100)}
              className="flex-1"
            />
            <Badge
              variant={muteClicks ? "default" : "outline"}
              className="cursor-pointer shrink-0"
              onClick={onMuteClicksToggle}
            >
              {muteClicks ? "Clicks Off" : "Clicks On"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Unloaded state — upload or URL
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Volume2 className="h-4 w-4" />
          Music (Optional)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {playerState.loadError && (
          <p className="text-sm text-destructive">{playerState.loadError}</p>
        )}

        {playerState.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading audio...</span>
          </div>
        ) : (
          <>
            {/* File upload */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload MP3
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            {/* URL input */}
            <div className="flex gap-2">
              <Input
                placeholder="Paste audio URL..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlLoad()}
                disabled={disabled}
              />
              <Button
                variant="outline"
                onClick={handleUrlLoad}
                disabled={disabled || !urlInput.trim()}
              >
                <Link className="mr-2 h-4 w-4" />
                Load
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
