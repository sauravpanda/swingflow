"""Coverage for response_sanitizer's pure helpers — the strengths /
improvements fallback (PR #148), the pattern_summary confidence cutoff
(PR #150 — drop from 0.5 to 0.25), and the merge-unique cap.

These functions are private (underscore-prefixed) but they're the
ones that actually decide whether the user sees a useful coaching
panel or empty arrays, so they're worth pinning."""

from __future__ import annotations

from wcs_api.services.video_analysis.response_sanitizer import (
    _improvements_from_summary,
    _merge_unique,
    _strengths_from_summary,
    _summarize_patterns,
)


# ─── _summarize_patterns: confidence cutoff (PR #150) ──────────────


def test_summarize_drops_patterns_below_0_25_confidence():
    """0.5 cutoff in #148 starved the strengths/improvements fallback;
    #150 lowered it to 0.25 because the model started emitting
    confidence in the 0.2-0.3 range across the board."""
    patterns = [
        {"name": "sugar push", "confidence": 0.6, "quality": "solid"},
        {"name": "whip", "confidence": 0.30, "quality": "solid"},
        {"name": "left side pass", "confidence": 0.24, "quality": "solid"},
        {"name": "tuck turn", "confidence": 0.10, "quality": "solid"},
    ]
    summary = _summarize_patterns(patterns)
    names = {s["name"] for s in summary}

    assert "sugar push" in names  # 0.60 ≥ 0.25 → kept
    assert "whip" in names  # 0.30 ≥ 0.25 → kept
    assert "left side pass" not in names  # 0.24 < 0.25 → dropped
    assert "tuck turn" not in names  # 0.10 < 0.25 → dropped


def test_summarize_groups_basic_with_null_variant():
    """`variant=null` and `variant="basic"` both mean plain execution
    of the family — they should aggregate into ONE entry, not two."""
    patterns = [
        {"name": "sugar push", "confidence": 0.6, "variant": None},
        {"name": "sugar push", "confidence": 0.6, "variant": "basic"},
    ]
    summary = _summarize_patterns(patterns)
    sugar = [s for s in summary if s["name"] == "sugar push"]
    assert len(sugar) == 1
    assert sugar[0]["count"] == 2


def test_summarize_separates_distinct_variants():
    """basket whip and reverse whip are distinct patterns even though
    they share the 'whip' family — the key includes variant."""
    patterns = [
        {"name": "whip", "confidence": 0.6, "variant": "basket"},
        {"name": "whip", "confidence": 0.6, "variant": "reverse"},
        {"name": "whip", "confidence": 0.6, "variant": "basket"},
    ]
    summary = _summarize_patterns(patterns)
    by_variant = {(s["name"], s.get("variant")): s["count"] for s in summary}
    assert by_variant[("whip", "basket")] == 2
    assert by_variant[("whip", "reverse")] == 1


def test_summarize_skips_empty_name():
    patterns = [
        {"name": "", "confidence": 0.9, "quality": "solid"},
        {"name": None, "confidence": 0.9, "quality": "solid"},
        {"confidence": 0.9, "quality": "solid"},  # missing key
    ]
    assert _summarize_patterns(patterns) == []


def test_summarize_handles_non_string_quality_gracefully():
    """Gemini occasionally returns nested objects where a string is
    expected. The helper has a defensive _s() coercion — proves it
    doesn't crash."""
    patterns = [
        {
            "name": "sugar push",
            "confidence": 0.6,
            "quality": {"value": "solid"},  # wrong shape
            "notes": 42,  # wrong type
        }
    ]
    out = _summarize_patterns(patterns)
    assert len(out) == 1
    assert out[0]["name"] == "sugar push"


# ─── _strengths_from_summary (PR #148) ─────────────────────────────


def test_strengths_picks_solid_and_excellent_with_notes():
    summary = [
        {
            "name": "sugar push",
            "quality": "solid",
            "notes": "anchor settled cleanly on 5-6",
            "count": 4,
        },
        {
            "name": "whip",
            "quality": "excellent",
            "notes": "follow stretches before the rotation",
            "count": 2,
        },
        {
            "name": "tuck turn",
            "quality": "needs_work",
            "notes": "rushed timing",
            "count": 1,
        },
    ]
    out = _strengths_from_summary(summary)
    joined = " | ".join(out)

    assert "Sugar push (×4)" in joined
    assert "anchor settled cleanly" in joined
    assert "Whip (×2)" in joined
    # needs_work shouldn't surface as a strength.
    assert "Tuck turn" not in joined


def test_strengths_skips_entries_without_notes():
    """A 'solid' tag without supporting notes is still ungrounded —
    should not produce a Strength line."""
    summary = [
        {"name": "sugar push", "quality": "solid", "notes": "", "count": 3},
        {"name": "whip", "quality": "solid", "count": 2},  # missing notes
    ]
    assert _strengths_from_summary(summary) == []


def test_strengths_caps_at_max_items():
    summary = [
        {"name": f"p{i}", "quality": "solid", "notes": "ok", "count": 1}
        for i in range(10)
    ]
    assert len(_strengths_from_summary(summary, max_items=3)) == 3


def test_strengths_handles_empty_or_none_input():
    assert _strengths_from_summary(None) == []
    assert _strengths_from_summary([]) == []


# ─── _improvements_from_summary ────────────────────────────────────


def test_improvements_uses_coaching_tip_field():
    summary = [
        {
            "name": "whip",
            "coaching_tip": "lead earlier on the rotation entry at 0:34",
            "count": 3,
        }
    ]
    out = _improvements_from_summary(summary)
    assert len(out) == 1
    assert "Whip (×3)" in out[0]
    assert "lead earlier" in out[0]


def test_improvements_skips_stock_coaching_phrases():
    """Even when the model attaches a tip to a real pattern, generic
    stock advice ('engage your core') still reads as horoscope and
    should be filtered."""
    summary = [
        {
            "name": "sugar push",
            "coaching_tip": "engage your core",
            "count": 5,
        },
        {
            "name": "whip",
            "coaching_tip": "lift the elbow on beat 5 of the basket entry",
            "count": 2,
        },
    ]
    out = _improvements_from_summary(summary)
    # The stock-phrase one is filtered; the specific one stays.
    assert len(out) == 1
    assert "Whip" in out[0]


# ─── _merge_unique ─────────────────────────────────────────────────


def test_merge_unique_appends_only_novel_items_capped_at_3():
    primary = ["a", "b"]
    fallback = ["b", "c", "d", "e"]  # b is a dup; cap before e
    out = _merge_unique(primary, fallback)
    assert out == ["a", "b", "c"]


def test_merge_unique_dedup_is_case_and_whitespace_insensitive():
    primary = ["Sugar Push: foo "]
    fallback = ["sugar push: foo"]
    assert _merge_unique(primary, fallback) == ["Sugar Push: foo "]


def test_merge_unique_preserves_primary_order_unchanged():
    primary = ["x", "y"]
    fallback = ["z"]
    assert _merge_unique(primary, fallback) == ["x", "y", "z"]
