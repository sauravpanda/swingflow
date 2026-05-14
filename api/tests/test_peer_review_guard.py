"""Comment-first review guard.

The SubmitBody.require_at_least_one_signal() check is the new gate
that turns peer review from a 'score me' form into a 'review me'
form. The guard belongs to the model itself (not the route handler)
so it stays testable in isolation — feed SubmitBody and call the
method.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from wcs_api.routes.peer_reviews import SubmitBody


def _body(**overrides):
    base = {
        "reviewer_name": "Test Reviewer",
        "reviewer_role": "dancer",
    }
    base.update(overrides)
    return SubmitBody(**base)


def test_empty_submission_is_rejected():
    """The drive-by failure mode: name only, no notes, no pins, no
    scores. Must return 400 — this is the whole point of comment-
    first."""
    body = _body()
    with pytest.raises(HTTPException) as exc_info:
        body.require_at_least_one_signal()
    assert exc_info.value.status_code == 400
    # Surface mentions all three accepted signals so the reviewer
    # knows how to satisfy the form.
    detail = str(exc_info.value.detail).lower()
    assert "comment" in detail
    assert "pin" in detail
    assert "rate" in detail or "category" in detail


def test_overall_note_alone_passes():
    body = _body(overall_notes="anchor settles cleanly on 5-6")
    body.require_at_least_one_signal()


def test_whitespace_only_overall_note_does_not_pass():
    """A note that's just spaces shouldn't trigger 'has signal' — it
    would store as blank and the dancer would see an empty review."""
    body = _body(overall_notes="   \n\t  ")
    with pytest.raises(HTTPException):
        body.require_at_least_one_signal()


def test_single_pin_passes():
    body = _body(
        per_moment_notes=[
            {"timestamp_sec": 12.3, "note": "rushed footwork here"}
        ]
    )
    body.require_at_least_one_signal()


def test_pin_with_empty_note_is_filtered_and_fails():
    """The _cap_moment_notes validator drops pins with blank notes,
    so the per_moment_notes list arrives empty at the guard — the
    overall submission must still fail."""
    body = _body(
        per_moment_notes=[
            {"timestamp_sec": 12.3, "note": "   "},
            {"timestamp_sec": 5.0, "note": ""},
        ]
    )
    with pytest.raises(HTTPException):
        body.require_at_least_one_signal()


def test_any_single_category_score_passes():
    """A reviewer who only feels qualified to rate one of the four
    categories shouldn't be blocked. Scores are now optional but
    not all-or-nothing."""
    for field in (
        "timing_score",
        "technique_score",
        "teamwork_score",
        "presentation_score",
    ):
        body = _body(**{field: 6.5})
        body.require_at_least_one_signal()


def test_scores_default_to_none_not_zero():
    """Regression guard: in v1 scores defaulted to 7, which let
    'drive-by 7/7/7/7' submissions through. Default must be None
    (no signal) so the empty-form check fires."""
    body = _body()
    assert body.timing_score is None
    assert body.technique_score is None
    assert body.teamwork_score is None
    assert body.presentation_score is None
