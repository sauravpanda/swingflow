import { Badge } from "@/components/ui/badge";

const categoryLabels: Record<string, string> = {
  basics: "Basics",
  "push-pull": "Push/Pull",
  turns: "Turns",
  whips: "Whips",
  wraps: "Wraps",
  slides: "Slides",
};

export function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="secondary" className="text-xs">
      {categoryLabels[category] ?? category}
    </Badge>
  );
}
