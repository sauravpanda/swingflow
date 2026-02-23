import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const difficultyConfig = {
  beginner: {
    label: "Beginner",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  intermediate: {
    label: "Intermediate",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  advanced: {
    label: "Advanced",
    className: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  },
} as const;

export function DifficultyBadge({
  difficulty,
}: {
  difficulty: string;
}) {
  const config =
    difficultyConfig[difficulty as keyof typeof difficultyConfig] ??
    difficultyConfig.beginner;

  return (
    <Badge variant="outline" className={cn("text-xs", config.className)}>
      {config.label}
    </Badge>
  );
}
