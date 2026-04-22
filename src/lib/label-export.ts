// Exports user-authored labels as a JSON file that matches the
// grading harness schema from #139. Downloads client-side — no
// upload, no server call.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AnalysisRecord } from "@/hooks/use-analysis-history";
import type { PatternLabel } from "@/hooks/use-pattern-labels";

type TruthEntry = {
  start: number;
  end: number;
  name: string;
  variant: string | null;
  count: number | null;
  source: string;
  notes: string | null;
};

type ExportClip = {
  clip_id: string;
  analysis_id: string;
  filename: string | null;
  role: string | null;
  competition_level: string | null;
  dance_start_sec: number | null;
  dance_end_sec: number | null;
  duration: number | null;
  labeled_at: string;
  truth: TruthEntry[];
};

type ExportBundle = {
  schema: "swingflow.pattern-labels/v1";
  exported_at: string;
  clip_count: number;
  label_count: number;
  clips: ExportClip[];
};

export async function exportAllLabels(
  records: AnalysisRecord[],
  counts: Record<string, number>
): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Supabase not configured");

  // Only include analyses the user has actually labeled — keeps the
  // export tight and avoids 50 empty clip entries.
  const labeledIds = Object.keys(counts).filter((id) => counts[id] > 0);
  if (labeledIds.length === 0) {
    throw new Error("No labels to export yet.");
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("pattern_labels")
    .select("*")
    .in("analysis_id", labeledIds)
    .order("analysis_id", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw error;

  const labels = (data as PatternLabel[]) ?? [];
  const byAnalysis = new Map<string, PatternLabel[]>();
  for (const l of labels) {
    const arr = byAnalysis.get(l.analysis_id) ?? [];
    arr.push(l);
    byAnalysis.set(l.analysis_id, arr);
  }

  const clips: ExportClip[] = [];
  for (const record of records) {
    const labelsForAnalysis = byAnalysis.get(record.id);
    if (!labelsForAnalysis?.length) continue;
    clips.push({
      clip_id: record.filename ?? record.id,
      analysis_id: record.id,
      filename: record.filename,
      role: record.role,
      competition_level: record.competition_level,
      dance_start_sec: record.result?.dance_start_sec ?? null,
      dance_end_sec: record.result?.dance_end_sec ?? null,
      duration: record.duration,
      labeled_at: labelsForAnalysis.reduce(
        (max, l) => (l.updated_at > max ? l.updated_at : max),
        labelsForAnalysis[0].updated_at
      ),
      truth: labelsForAnalysis.map((l) => ({
        start: l.start_time,
        end: l.end_time,
        name: l.name,
        variant: l.variant,
        count: l.count,
        source: l.source,
        notes: l.notes,
      })),
    });
  }

  const bundle: ExportBundle = {
    schema: "swingflow.pattern-labels/v1",
    exported_at: new Date().toISOString(),
    clip_count: clips.length,
    label_count: labels.length,
    clips,
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `swingflow-labels-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
