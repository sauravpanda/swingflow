"""Unit coverage for the score-eval math (wcs_api.evals.scores).

Pure-function tests only — the consistency subcommand's Gemini loop
and the calibration subcommand's Supabase read are exercised at their
seams (extract/summarize/pair/report), never over the network.
"""

from __future__ import annotations

import httpx

from wcs_api.evals.scores import (
    calibration_pairs,
    calibration_report,
    extract_category_scores,
    pearson,
    prompt_version_of,
    summarize_runs,
)


# ─── pearson ─────────────────────────────────────────────────────────


def test_pearson_perfect_positive():
    assert pearson([1, 2, 3], [2, 4, 6]) is not None
    assert abs(pearson([1, 2, 3], [2, 4, 6]) - 1.0) < 1e-9


def test_pearson_perfect_negative():
    assert abs(pearson([1, 2, 3], [6, 4, 2]) + 1.0) < 1e-9


def test_pearson_undefined_on_zero_variance():
    # Every human said 7 — correlation is undefined, not 0 or crash.
    assert pearson([5.0, 6.0, 7.0], [7.0, 7.0, 7.0]) is None


def test_pearson_undefined_below_two_points():
    assert pearson([5.0], [6.0]) is None
    assert pearson([], []) is None


# ─── extract / version helpers ──────────────────────────────────────


def _result(scores: dict[str, float], version: str | None = "v1") -> dict:
    out: dict = {
        "categories": {k: {"score": v} for k, v in scores.items()},
        "overall": {
            "score": round(sum(scores.values()) / max(len(scores), 1), 1)
        },
        "patterns_identified": [{"name": "sugar push"}],
        "observed_level": "Intermediate",
    }
    if version is not None:
        out["analysis_meta"] = {"prompt_version": version}
    return out


def test_extract_category_scores_skips_malformed():
    result = {
        "categories": {
            "timing": {"score": 6.5},
            "technique": {"score": "not-a-number"},
            "teamwork": "not-a-dict",
            # presentation absent entirely
        }
    }
    assert extract_category_scores(result) == {"timing": 6.5}


def test_prompt_version_of_falls_back_to_unstamped():
    assert prompt_version_of({}) == "unstamped"
    assert prompt_version_of(_result({"timing": 6.0})) == "v1"


# ─── summarize_runs ──────────────────────────────────────────────────


def test_summarize_runs_reports_spread():
    runs = [
        _result({"timing": 6.0, "technique": 5.0}),
        _result({"timing": 6.6, "technique": 5.0}),
        _result({"timing": 6.3, "technique": 5.0}),
    ]
    summary = summarize_runs(runs)
    timing = summary["categories"]["timing"]
    assert timing["n"] == 3
    assert abs(timing["mean"] - 6.3) < 1e-9
    assert abs(timing["range"] - 0.6) < 1e-9
    assert timing["stddev"] > 0
    # A category that never moves reports zero spread.
    technique = summary["categories"]["technique"]
    assert technique["stddev"] == 0.0
    assert technique["range"] == 0.0
    assert summary["prompt_versions"] == {"v1": 3}


def test_summarize_runs_single_run_has_zero_stddev():
    summary = summarize_runs([_result({"timing": 7.0})])
    assert summary["categories"]["timing"]["stddev"] == 0.0


# ─── calibration ─────────────────────────────────────────────────────


def _review(
    human: dict[str, float | None],
    ai: dict[str, float] | None,
) -> dict:
    row: dict = {
        "reviewer_role": "instructor",
        "ai_result_snapshot": _result(ai) if ai is not None else None,
    }
    for key in ("timing", "technique", "teamwork", "presentation"):
        row[f"{key}_score"] = human.get(key)
    return row


def test_calibration_pairs_requires_both_sides():
    rows = [
        # Contributes to timing only: human skipped the other three.
        _review({"timing": 6.0}, {"timing": 7.0, "technique": 5.0}),
        # Comment-only review (no scores) contributes nothing.
        _review({}, {"timing": 7.0}),
        # Snapshot missing → row skipped entirely.
        _review({"timing": 8.0}, None),
    ]
    pairs = calibration_pairs(rows)
    assert pairs["timing"] == [(7.0, 6.0)]
    assert pairs["technique"] == []


def test_calibration_report_bias_and_mae():
    pairs = {
        "timing": [(7.0, 6.0), (8.0, 6.0)],  # AI +1 and +2 high
        "technique": [],
        "teamwork": [(5.0, 5.0)],
        "presentation": [],
    }
    report = calibration_report(pairs)
    assert report["timing"]["n"] == 2
    assert abs(report["timing"]["bias"] - 1.5) < 1e-9
    assert abs(report["timing"]["mae"] - 1.5) < 1e-9
    assert report["technique"] == {"n": 0}
    # Single pair: bias/mae defined, pearson undefined.
    assert report["teamwork"]["pearson_r"] is None
    assert report["teamwork"]["bias"] == 0.0


# ─── list_consented_reviews query shape ──────────────────────────────


async def test_list_consented_reviews_filters(monkeypatch):
    from wcs_api.services import supabase_admin

    class _FakeClient:
        def __init__(self):
            self.calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def get(self, url, **kwargs):
            self.calls.append({"url": url, **kwargs})
            return httpx.Response(
                200,
                json=[{"id": "r1"}],
                request=httpx.Request("GET", "https://test"),
            )

    fake = _FakeClient()
    monkeypatch.setattr(
        supabase_admin.httpx, "AsyncClient", lambda *a, **kw: fake
    )
    rows = await supabase_admin.list_consented_reviews()
    assert rows == [{"id": "r1"}]
    params = fake.calls[0]["params"]
    # The two filters that make this the training set: submitted +
    # consented. Regression here would silently train on non-consented
    # reviews.
    assert params["training_consent"] == "is.true"
    assert params["submitted_at"] == "not.is.null"
    assert "ai_result_snapshot" in params["select"]
