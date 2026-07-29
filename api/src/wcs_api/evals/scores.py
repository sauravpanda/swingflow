"""Score-quality evals: run-to-run consistency + human calibration.

Two subcommands, complementing the pattern-segmentation harness
(wcs_api.evals.patterns) which grades WHAT the model found — these
grade the NUMBERS it emits, which are the headline product and until
now had zero automated measurement.

Consistency — re-run one stored clip N times and measure score spread:

    uv run python -m wcs_api.evals.scores consistency <analysis-id|filename> --runs 3

  Each run uses fresh=True (random seed, temperature stays 0), i.e.
  exactly what a user's Re-analyze button does. Reports per-category
  mean / sample stddev / min-max range, plus overall, observed_level
  agreement, and pattern-count spread. COSTS REAL GEMINI CALLS —
  the per-run cost is printed as it accrues.

Calibration — compare AI scores against consented human reviews:

    uv run python -m wcs_api.evals.scores calibration [--json]

  Reads peer_reviews rows where training_consent = true (the first
  consumer of peer_reviews_training_idx). Each row carries the
  reviewer's 4-T scores and ai_result_snapshot — the AI result frozen
  at review time, so the pair can't be desynced by a re-analysis.
  Reports per-category N, Pearson r, mean bias (AI - human), and MAE.

Both subcommands print the prompt_version distribution of the results
they graded (result.analysis_meta.prompt_version) so numbers are
attributable to a rubric revision.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

CATEGORIES = ("timing", "technique", "teamwork", "presentation")


# ─────────────────────────────────────────────────────────────────────
# Pure helpers (unit-tested without network)
# ─────────────────────────────────────────────────────────────────────

def pearson(xs: list[float], ys: list[float]) -> float | None:
    """Pearson correlation, or None when undefined (n < 2 or a
    zero-variance side — e.g. every human score identical)."""
    n = min(len(xs), len(ys))
    if n < 2:
        return None
    xs = xs[:n]
    ys = ys[:n]
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 1e-12 or syy <= 1e-12:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / (sxx * syy) ** 0.5


def extract_category_scores(result: dict[str, Any]) -> dict[str, float]:
    """Pull the four category scores out of a shaped result. Missing or
    non-numeric scores are simply absent from the returned dict."""
    out: dict[str, float] = {}
    categories = result.get("categories")
    if not isinstance(categories, dict):
        return out
    for key in CATEGORIES:
        cat = categories.get(key)
        if not isinstance(cat, dict):
            continue
        try:
            out[key] = float(cat["score"])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def prompt_version_of(result: dict[str, Any]) -> str:
    meta = result.get("analysis_meta")
    if isinstance(meta, dict) and meta.get("prompt_version"):
        return str(meta["prompt_version"])
    return "unstamped"


def summarize_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate N shaped results into a consistency report dict."""
    per_category: dict[str, dict[str, Any]] = {}
    for key in CATEGORIES + ("overall",):
        values: list[float] = []
        for run in runs:
            if key == "overall":
                try:
                    values.append(float(run["overall"]["score"]))
                except (KeyError, TypeError, ValueError):
                    continue
            else:
                scores = extract_category_scores(run)
                if key in scores:
                    values.append(scores[key])
        if not values:
            continue
        per_category[key] = {
            "n": len(values),
            "mean": round(sum(values) / len(values), 3),
            "stddev": (
                round(statistics.stdev(values), 3)
                if len(values) >= 2
                else 0.0
            ),
            "range": round(max(values) - min(values), 3),
            "values": values,
        }

    observed_levels = Counter(
        str(run.get("observed_level") or "?") for run in runs
    )
    pattern_counts = [
        len(run.get("patterns_identified") or []) for run in runs
    ]
    return {
        "runs": len(runs),
        "categories": per_category,
        "observed_levels": dict(observed_levels),
        "pattern_counts": pattern_counts,
        "prompt_versions": dict(
            Counter(prompt_version_of(run) for run in runs)
        ),
    }


def calibration_pairs(
    rows: list[dict[str, Any]],
) -> dict[str, list[tuple[float, float]]]:
    """Extract (ai_score, human_score) pairs per category from
    consented peer_reviews rows. A row contributes to a category only
    when the reviewer scored it AND the frozen snapshot carries a
    numeric AI score for it — comment-only reviews are skipped."""
    pairs: dict[str, list[tuple[float, float]]] = {
        key: [] for key in CATEGORIES
    }
    for row in rows:
        snapshot = row.get("ai_result_snapshot")
        if not isinstance(snapshot, dict):
            continue
        ai_scores = extract_category_scores(snapshot)
        for key in CATEGORIES:
            human_raw = row.get(f"{key}_score")
            if human_raw is None or key not in ai_scores:
                continue
            try:
                human = float(human_raw)
            except (TypeError, ValueError):
                continue
            pairs[key].append((ai_scores[key], human))
    return pairs


def calibration_report(
    pairs: dict[str, list[tuple[float, float]]],
) -> dict[str, dict[str, Any]]:
    """Per-category N, Pearson r, mean bias (AI - human), MAE."""
    report: dict[str, dict[str, Any]] = {}
    for key, pair_list in pairs.items():
        if not pair_list:
            report[key] = {"n": 0}
            continue
        ai = [p[0] for p in pair_list]
        human = [p[1] for p in pair_list]
        diffs = [a - h for a, h in pair_list]
        r = pearson(ai, human)
        report[key] = {
            "n": len(pair_list),
            "pearson_r": round(r, 3) if r is not None else None,
            "bias": round(sum(diffs) / len(diffs), 3),
            "mae": round(sum(abs(d) for d in diffs) / len(diffs), 3),
        }
    return report


# ─────────────────────────────────────────────────────────────────────
# Consistency subcommand
# ─────────────────────────────────────────────────────────────────────

def _download_video(url: str, suffix: str) -> str:
    import httpx

    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    with httpx.stream("GET", url, timeout=120) as resp:
        resp.raise_for_status()
        for chunk in resp.iter_bytes():
            tmp.write(chunk)
    tmp.close()
    return tmp.name


def run_consistency(args: argparse.Namespace) -> int:
    from ..services import r2, supabase_admin
    from ..services.video_analysis.analyzer import analyze_video_path

    row = asyncio.run(supabase_admin.get_analysis_eval_row(args.clip_ref))
    if not row:
        print(f"No analysis found for `{args.clip_ref}`.", file=sys.stderr)
        return 1
    object_key = row.get("object_key")
    if not object_key:
        print(
            f"Analysis `{args.clip_ref}` has no stored video "
            "(object_key is null — the owner didn't opt into video "
            "retention), so it can't be re-run.",
            file=sys.stderr,
        )
        return 1

    filename = row.get("filename") or "clip"
    suffix = Path(str(filename)).suffix or ".mp4"
    url = r2.generate_presigned_get(object_key, expires_in=3600)
    print(f"Downloading {filename} …")
    video_path = _download_video(url, suffix)

    context = {
        key: row.get(key)
        for key in (
            "role",
            "competition_level",
            "event_name",
            "event_date",
            "stage",
            "tags",
            "dancer_description",
        )
    }
    duration = row.get("duration")

    runs: list[dict[str, Any]] = []
    total_cost_micros = 0
    for i in range(args.runs):
        print(f"Run {i + 1}/{args.runs} …", flush=True)
        result = analyze_video_path(
            video_path,
            duration_sec=float(duration) if duration else None,
            context=context,
            # fresh=True → random seed per run, exactly what the user's
            # Re-analyze button does. temperature stays 0; this measures
            # the drift users can actually experience.
            fresh=True,
        )
        usage = result.get("usage") or {}
        cost = int(usage.get("cost_usd_micros") or 0)
        total_cost_micros += cost
        print(
            f"  overall={result.get('overall', {}).get('score')} "
            f"cost=${cost / 1_000_000:.3f}"
        )
        runs.append(result)

    summary = summarize_runs(runs)
    summary["clip"] = filename
    summary["analysis_id"] = row.get("id")
    summary["total_cost_usd"] = round(total_cost_micros / 1_000_000, 3)

    if args.json:
        print(json.dumps(summary, indent=2))
        return 0

    print(f"\nConsistency over {summary['runs']} fresh runs — {filename}")
    print(f"prompt versions: {summary['prompt_versions']}")
    header = f"{'category':<14}{'mean':>7}{'stddev':>8}{'range':>7}  values"
    print(header)
    print("-" * len(header))
    for key in CATEGORIES + ("overall",):
        stats = summary["categories"].get(key)
        if not stats:
            continue
        values = ", ".join(f"{v:.1f}" for v in stats["values"])
        print(
            f"{key:<14}{stats['mean']:>7.2f}{stats['stddev']:>8.3f}"
            f"{stats['range']:>7.2f}  [{values}]"
        )
    print(f"observed_level: {summary['observed_levels']}")
    print(f"pattern counts: {summary['pattern_counts']}")
    print(f"total cost: ${summary['total_cost_usd']:.3f}")
    return 0


# ─────────────────────────────────────────────────────────────────────
# Calibration subcommand
# ─────────────────────────────────────────────────────────────────────

def run_calibration(args: argparse.Namespace) -> int:
    from ..services import supabase_admin

    rows = asyncio.run(supabase_admin.list_consented_reviews())
    if not rows:
        print(
            "No consented peer reviews yet (peer_reviews where "
            "submitted_at is set and training_consent = true). "
            "The calibration loop starts once reviewers opt in.",
        )
        return 0

    pairs = calibration_pairs(rows)
    report = calibration_report(pairs)
    versions = Counter(
        prompt_version_of(row["ai_result_snapshot"])
        for row in rows
        if isinstance(row.get("ai_result_snapshot"), dict)
    )
    roles = Counter(str(row.get("reviewer_role") or "?") for row in rows)

    if args.json:
        print(
            json.dumps(
                {
                    "reviews": len(rows),
                    "reviewer_roles": dict(roles),
                    "prompt_versions": dict(versions),
                    "categories": report,
                },
                indent=2,
            )
        )
        return 0

    print(f"Calibration vs {len(rows)} consented human reviews")
    print(f"reviewer roles: {dict(roles)}")
    print(f"prompt versions: {dict(versions)}")
    header = f"{'category':<14}{'n':>4}{'pearson_r':>11}{'bias':>7}{'mae':>7}"
    print(header)
    print("-" * len(header))
    for key in CATEGORIES:
        stats = report[key]
        if stats["n"] == 0:
            print(f"{key:<14}{0:>4}{'—':>11}{'—':>7}{'—':>7}")
            continue
        r = stats["pearson_r"]
        print(
            f"{key:<14}{stats['n']:>4}"
            f"{(f'{r:.3f}' if r is not None else '—'):>11}"
            f"{stats['bias']:>7.2f}{stats['mae']:>7.2f}"
        )
    print(
        "\nbias > 0 means the AI scores higher than the human. "
        "Target from #106: pearson_r >= 0.7 per category."
    )
    return 0


# ─────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m wcs_api.evals.scores",
        description="Score consistency + human-calibration evals.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_cons = sub.add_parser(
        "consistency",
        help="Re-run one stored clip N times; report score spread. "
        "Costs real Gemini calls.",
    )
    p_cons.add_argument(
        "clip_ref", help="analysis UUID or original filename"
    )
    p_cons.add_argument(
        "--runs", type=int, default=3, choices=range(2, 11), metavar="N",
        help="number of fresh runs (2-10, default 3)",
    )
    p_cons.add_argument("--json", action="store_true")
    p_cons.set_defaults(func=run_consistency)

    p_cal = sub.add_parser(
        "calibration",
        help="Compare AI category scores against consented peer reviews.",
    )
    p_cal.add_argument("--json", action="store_true")
    p_cal.set_defaults(func=run_calibration)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
