"use client";

import { cn } from "@/lib/utils";

type PhraseBeatGridProps = {
  /** 0-7 = current beat within the phrase, -1 = not currently on a beat */
  currentBeatInPhrase: number;
  /** 0-based phrase index the user is currently in, -1 before first phrase */
  phraseIndex: number;
  totalPhrases: number;
};

const BEAT_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8"];

function beatRole(i: number): "downbeat" | "anchor" | "normal" {
  // Beat 1 is the phrase downbeat; beats 5–6 are the WCS anchor step.
  if (i === 0) return "downbeat";
  if (i === 4 || i === 5) return "anchor";
  return "normal";
}

export function PhraseBeatGrid({
  currentBeatInPhrase,
  phraseIndex,
  totalPhrases,
}: PhraseBeatGridProps) {
  const phraseLabel =
    totalPhrases === 0
      ? "—"
      : phraseIndex < 0
      ? `— / ${totalPhrases}`
      : `${Math.min(phraseIndex + 1, totalPhrases)} / ${totalPhrases}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">
          Song phrase
        </span>
        <span className="font-mono tabular-nums">{phraseLabel}</span>
      </div>

      <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
        {BEAT_LABELS.map((label, i) => {
          const role = beatRole(i);
          const isActive = i === currentBeatInPhrase;
          return (
            <div
              key={i}
              className={cn(
                "relative flex h-12 sm:h-14 flex-col items-center justify-center rounded-md border font-semibold transition-all",
                role === "anchor" &&
                  "border-amber-400/50 bg-amber-400/10 text-amber-200",
                role === "downbeat" &&
                  "border-primary/50 bg-primary/10 text-primary",
                role === "normal" &&
                  "border-border bg-muted/20 text-muted-foreground",
                isActive &&
                  "scale-[1.08] ring-2 ring-offset-2 ring-offset-background ring-primary"
              )}
            >
              <span className="text-sm sm:text-base">{label}</span>
              {role === "anchor" && (
                <span className="absolute bottom-0.5 sm:bottom-1 text-[7px] sm:text-[8px] font-normal uppercase tracking-wider opacity-70">
                  anchor
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary/60" />
          downbeat (1)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-400/60" />
          anchor (5–6)
        </span>
      </div>
    </div>
  );
}
