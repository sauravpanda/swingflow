"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ChallengeType,
  type WCSPatternPreset,
  CHALLENGE_TYPES,
} from "@/lib/rhythm-constants";

type ChallengeSelectorProps = {
  selectedPattern: WCSPatternPreset | null;
  challengeType: ChallengeType;
  onChallengeTypeChange: (type: ChallengeType) => void;
};

export function ChallengeSelector({
  selectedPattern,
  challengeType,
  onChallengeTypeChange,
}: ChallengeSelectorProps) {
  const availableTypes = selectedPattern
    ? CHALLENGE_TYPES
    : CHALLENGE_TYPES.filter((t) => t.id === "random-subdivision");

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground shrink-0">Challenge:</span>
      <Select
        value={challengeType}
        onValueChange={(v) => onChallengeTypeChange(v as ChallengeType)}
      >
        <SelectTrigger className="flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableTypes.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
