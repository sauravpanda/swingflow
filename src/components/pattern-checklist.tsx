"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/components/store-provider";

type Template = {
  id: string;
  category: string;
  item: string;
  sortOrder: number;
};

const categoryLabels: Record<string, string> = {
  connection: "Connection",
  frame: "Frame",
  posture: "Posture",
  timing: "Timing",
  styling: "Styling",
};

const categoryIcons: Record<string, string> = {
  connection: "\u{1F91D}",
  frame: "\u{1FA9F}",
  posture: "\u{1F9CD}",
  timing: "\u{1F3B5}",
  styling: "\u{2728}",
};

export function PatternChecklist({ templates }: { templates: Template[] }) {
  const { isChecklistCompleted, toggleChecklist } = useAppStore();

  const completedCount = templates.filter((t) =>
    isChecklistCompleted(t.id)
  ).length;
  const progress =
    templates.length > 0 ? (completedCount / templates.length) * 100 : 0;

  // Group by category
  const grouped = templates.reduce(
    (acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, Template[]>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              Progress: {completedCount}/{templates.length}
            </span>
            <span className="text-sm text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </CardContent>
      </Card>

      {Object.entries(grouped).map(([category, categoryItems]) => (
        <Card key={category}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <span>{categoryIcons[category] ?? "\u{1F4CB}"}</span>
              {categoryLabels[category] ?? category}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {categoryItems.map((item) => {
              const completed = isChecklistCompleted(item.id);
              return (
                <label
                  key={item.id}
                  className="flex items-start gap-3 cursor-pointer group"
                >
                  <Checkbox
                    checked={completed}
                    onCheckedChange={(checked) =>
                      toggleChecklist(item.id, checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span
                    className={`text-sm transition-colors ${
                      completed
                        ? "text-muted-foreground line-through"
                        : "text-foreground group-hover:text-primary"
                    }`}
                  >
                    {item.item}
                  </span>
                </label>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
