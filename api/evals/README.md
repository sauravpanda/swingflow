# Evals

Two offline harnesses, run from `api/` with the same env vars as the
server (Supabase service role + R2 + Gemini keys):

## Pattern segmentation — `wcs_api.evals.patterns`

Grades WHAT the model found: detection/family/exact precision+recall
and timing IoU against human `pattern_labels` (from the /label editor)
or a local truth JSON. See `patterns/README.md` for the fixture format.

```
uv run python -m wcs_api.evals.patterns IMG_9577
```

## Score quality — `wcs_api.evals.scores`

Grades the NUMBERS the model emits.

```
# Run-to-run spread on one clip (COSTS REAL GEMINI CALLS — one full
# analysis per run; per-run cost is printed as it accrues):
uv run python -m wcs_api.evals.scores consistency <analysis-id|filename> --runs 3

# AI vs consented human reviews (read-only, free):
uv run python -m wcs_api.evals.scores calibration
```

Consistency mode needs the clip's video still stored (the owner opted
into "Keep video stored"); it re-runs the analyzer with `fresh=True`,
exactly what the user's Re-analyze button does. Calibration mode reads
`peer_reviews` rows with `training_consent = true` and compares the
reviewer's 4-T scores against `ai_result_snapshot` (the AI result
frozen at review time).

Both report the `prompt_version` distribution of the results they
graded (`result.analysis_meta.prompt_version`) — always quote it next
to eval numbers, and re-run after any prompt bump before trusting a
comparison.
