# Pattern Eval Fixtures

Place one JSON file per labeled clip in this directory when you want a
committed ground-truth fixture for the eval harness:

```json
{
  "clip_id": "IMG_9577",
  "analysis_id": "00000000-0000-0000-0000-000000000000",
  "dance_start_sec": 8.2,
  "dance_end_sec": 109.6,
  "truth": [
    { "start": 8.2, "end": 11.0, "name": "starter step", "variant": "basic" }
  ]
}
```

Run:

```bash
uv run python -m wcs_api.evals.patterns IMG_9577
```

If no local truth file exists, the harness falls back to live
`pattern_labels` rows from Supabase for the given clip / analysis ref.
