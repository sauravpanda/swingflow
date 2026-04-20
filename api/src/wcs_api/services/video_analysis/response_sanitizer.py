from __future__ import annotations

import re as _re
from typing import Any


# ─────────────────────────────────────────────────────────────────────
# Score aggregation
# ─────────────────────────────────────────────────────────────────────

_WEIGHTS = {
    "timing": 0.30,
    "technique": 0.30,
    "teamwork": 0.20,
    "presentation": 0.20,
}

_GRADE_THRESHOLDS: list[tuple[float, str]] = [
    (9.5, "A+"),
    (9.0, "A"),
    (8.5, "A-"),
    (8.0, "B+"),
    (7.5, "B"),
    (7.0, "B-"),
    (6.5, "C+"),
    (6.0, "C"),
    (5.5, "C-"),
    (5.0, "D+"),
    (4.5, "D"),
    (4.0, "D-"),
]


def _grade_letter(score: float) -> str:
    for threshold, letter in _GRADE_THRESHOLDS:
        if score >= threshold:
            return letter
    return "F"


def _compute_overall(categories: dict[str, dict[str, Any]]) -> float:
    total = 0.0
    for key, weight in _WEIGHTS.items():
        try:
            total += float(categories[key]["score"]) * weight
        except (KeyError, TypeError, ValueError):
            pass
    return round(total, 1)


def _max_interval(categories: dict[str, dict[str, Any]]) -> float:
    """Largest score_high - score_low across categories. Used to flag low-
    confidence results per wcs-analyzer's heuristic."""
    widest = 0.0
    for cat in categories.values():
        try:
            low = float(cat.get("score_low", cat["score"]))
            high = float(cat.get("score_high", cat["score"]))
            widest = max(widest, high - low)
        except (KeyError, TypeError, ValueError):
            continue
    return widest


# ─────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────

# Strip control characters + newlines + carriage returns so nothing in
# user input can break out of its prompt line and masquerade as model
# instruction. Applied to every user field before interpolation. Keep
# tabs + regular spaces; everything else becomes a single space.
_CONTROL_CHARS_RE = _re.compile(r"[\x00-\x08\x0b-\x1f\x7f\n\r]+")


def _sanitize_user_field(value: str | None, max_length: int) -> str:
    """Clean a user-supplied string for safe interpolation into the
    Gemini prompt. Strips control chars + newlines, collapses runs
    of whitespace, and enforces a max length. Pydantic already caps
    length at the body-validation layer; this is defense-in-depth
    for anything that bypasses the validator.
    """
    if not value:
        return ""
    cleaned = _CONTROL_CHARS_RE.sub(" ", str(value))
    cleaned = " ".join(cleaned.split())  # collapse whitespace runs
    return cleaned[:max_length].strip()


def _safe_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pattern_inside_window(
    pattern: dict[str, Any],
    dance_start: float | None,
    dance_end: float | None,
) -> bool:
    """True if the pattern overlaps the dance window at all. Used to
    filter out stray pre-dance / post-dance entries. We keep patterns
    that partially overlap — they'll get trimmed by _sanitize_patterns.
    """
    start = _safe_float(pattern.get("start_time"))
    end = _safe_float(pattern.get("end_time"))
    if start is None or end is None:
        return False
    if dance_end is not None and start >= dance_end:
        return False
    if dance_start is not None and end <= dance_start:
        return False
    return True


_CONFIDENCE_UNGROUNDED_VARIANT = 0.4
_CONFIDENCE_UNSET = 0.6


def _detect_repeating_cycle(names: list[str]) -> int | None:
    """Detect a repeating cycle in the pattern-name sequence.

    Returns the cycle length N (2..5) when the sequence contains ≥3
    consecutive repetitions of the same N-length block at any
    starting offset within the sequence. Returns None when no such
    cycle is present.

    Sarah v2 (27 entries) and Jon prelim (26 entries) both exhibit
    this failure mode: the model emits a tidy
    `throwout → L side pass → R side pass → sugar push → whip` or
    `underarm turn → whip → L side pass` cycle instead of grounding
    each pattern in visible evidence. The detector scans from any
    offset because real dances may legitimately have an intro or
    starter step before the hallucinated loop begins. It fires on
    3+ reps because 2 reps can legitimately happen (a pair of side
    passes is a real WCS figure).
    """
    n = len(names)
    if n < 6:
        return None
    for cycle_len in range(2, 6):
        # Scan all starting offsets — a hallucinated loop may begin
        # after a legitimate intro / starter-step entry.
        for offset in range(min(cycle_len + 2, n)):
            if offset + cycle_len * 3 > n:
                break
            block = names[offset : offset + cycle_len]
            reps = 1
            for start in range(
                offset + cycle_len, n - cycle_len + 1, cycle_len
            ):
                if names[start : start + cycle_len] == block:
                    reps += 1
                else:
                    break
            if reps >= 3:
                return cycle_len
    return None


def _sanitize_patterns(
    raw: list[Any] | None,
    *,
    max_window_sec: float = 12.0,
    dance_start_sec: float | None = None,
    dance_end_sec: float | None = None,
) -> list[dict[str, Any]]:
    """Clean Gemini's patterns_identified output.

    - Drops entries with missing/invalid times.
    - Drops entries entirely outside the dance window when one is
      provided (defense against pre-dance hallucination even when
      the model ignored the prompt). Entries that partially
      overlap get trimmed to the window boundary.
    - Splits any window longer than `max_window_sec` into ~6s chunks
      sharing the same metadata (prevents the "45s Sugar Push" bug
      even when the model slips past the prompt guidance).
    - Enforces the variant/visual_cue contract: entries that commit
      to a non-basic variant without supplying a visual_cue get
      demoted to `variant=null, confidence=0.4`. The model claimed
      specificity it couldn't substantiate — downgrade to "family
      known, variant uncertain" so the UI doesn't surface confident
      fictions (e.g. "7 underarm turns" from a single cue'd one that
      propagated through a hallucinated repeat cycle).
    - Detects the repeating-cycle failure mode (3+ reps of the same
      2–5 pattern block) and halves confidence across ALL entries
      in the run. Fires on real Discord-reported cases where the
      model emits a metronomic `X → Y → Z → X → Y → Z → ...` output
      instead of grounding each pattern in visible evidence.
    - Keeps all other fields untouched.
    """
    if not isinstance(raw, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            start = float(entry.get("start_time"))
            end = float(entry.get("end_time"))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        # Trim to dance window. Drop entries that fall entirely
        # outside it — those are pre-dance / post-dance hallucinations.
        if dance_start_sec is not None:
            if end <= dance_start_sec:
                continue
            if start < dance_start_sec:
                start = dance_start_sec
        if dance_end_sec is not None:
            if start >= dance_end_sec:
                continue
            if end > dance_end_sec:
                end = dance_end_sec
        if end <= start:
            continue
        entry = dict(entry)
        entry["start_time"] = start
        entry["end_time"] = end

        # Variant/visual_cue contract: if the model committed to a
        # non-basic variant ("basket", "with inside turn", ...) but
        # didn't supply a visual_cue, it's confident specificity
        # without evidence. Demote to variant=null so the summary
        # doesn't aggregate uncertain labels into a confident count.
        variant_raw = entry.get("variant")
        variant = (
            str(variant_raw).strip() if isinstance(variant_raw, str) else ""
        )
        cue_raw = entry.get("visual_cue")
        cue = str(cue_raw).strip() if isinstance(cue_raw, str) else ""
        conf_raw = entry.get("confidence")
        try:
            confidence = float(conf_raw) if conf_raw is not None else None
        except (TypeError, ValueError):
            confidence = None

        if variant and variant.lower() not in ("basic", "null") and not cue:
            entry["variant"] = None
            # Only demote confidence if the model hadn't already
            # rated itself below our ungrounded-variant floor.
            if confidence is None or confidence > _CONFIDENCE_UNGROUNDED_VARIANT:
                entry["confidence"] = _CONFIDENCE_UNGROUNDED_VARIANT
                confidence = _CONFIDENCE_UNGROUNDED_VARIANT
        elif confidence is None:
            # Preserve existing shape when confidence wasn't provided;
            # mark it as a default value so downstream can tell the
            # model abstained rather than committing to a number.
            entry["confidence"] = _CONFIDENCE_UNSET
            confidence = _CONFIDENCE_UNSET

        span = end - start
        if span <= max_window_sec:
            cleaned.append(entry)
            continue
        # Model likely merged repeats. Split into ~6s slices sharing
        # the original metadata. Label subsequent slices so we don't
        # silently inflate the pattern count UI — caller sees the
        # same occurrences but time ranges are sane.
        n_splits = max(2, int(round(span / 6.0)))
        slice_len = span / n_splits
        base_name = entry.get("name", "unknown")
        for i in range(n_splits):
            clone = dict(entry)
            clone["start_time"] = start + i * slice_len
            clone["end_time"] = start + (i + 1) * slice_len
            clone["name"] = base_name
            if i > 0:
                existing_notes = (clone.get("notes") or "").strip()
                marker = "(split from a long merged window)"
                clone["notes"] = (
                    f"{existing_notes} {marker}".strip()
                    if existing_notes
                    else marker
                )
            cleaned.append(clone)

    # Repeating-cycle detector: Jon prelim and Sarah v2 both shipped
    # 26–27 entries in a clean 3–5 pattern cycle. Run the detector on
    # the family name sequence (ignoring variant). When it fires, halve
    # the confidence on every entry in the locked run and tag them for
    # the UI.
    if cleaned:
        family_names = [
            _normalize_pattern_name(str(p.get("name") or ""))
            for p in cleaned
        ]
        cycle_len = _detect_repeating_cycle(family_names)
        if cycle_len is not None:
            for p in cleaned:
                try:
                    cur = float(p.get("confidence", _CONFIDENCE_UNSET))
                except (TypeError, ValueError):
                    cur = _CONFIDENCE_UNSET
                p["confidence"] = round(min(cur * 0.5, 0.4), 2)
                p["timeline_locked"] = True
    return cleaned


def _normalize_pattern_name(name: str) -> str:
    """Lowercase + collapse whitespace for aggregation key."""
    return " ".join((name or "").lower().split())


def _summarize_patterns(
    patterns: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Aggregate a flat pattern timeline into per-pattern counts.

    Returns a list like:
      [{"name": "sugar push", "count": 5, "quality": "needs_work",
        "timing": "on_beat", "notes": "…"}]

    Keeps the display name from the first occurrence, picks the
    most common quality/timing (ties broken by first seen), and
    joins unique notes with " · " for compact rendering.
    """
    from collections import Counter, defaultdict

    counts: Counter[str] = Counter()
    display_names: dict[str, str] = {}
    variants_per_key: dict[str, str | None] = {}
    qualities: dict[str, list[str]] = defaultdict(list)
    timings: dict[str, list[str]] = defaultdict(list)
    notes: dict[str, list[str]] = defaultdict(list)
    # Keep styling + coaching_tips dedup'd per pattern too — an
    # expressive dancer may land the same body-roll on multiple
    # sugar pushes, and we only want to surface that once.
    stylings: dict[str, list[str]] = defaultdict(list)
    tips: dict[str, list[str]] = defaultdict(list)

    def _s(v: Any) -> str:
        """Coerce any field that should be a string into one safely,
        so .strip() / .lower() below can't raise on a nested dict or
        number returned by Gemini."""
        return str(v).strip() if isinstance(v, str) else ""

    for p in patterns:
        raw_name = _s(p.get("name"))
        if not raw_name:
            continue
        # Drop entries with sub-threshold confidence from the *summary
        # count* only — they still appear in the detailed timeline (so
        # the UI can render them with a "low confidence" marker) but
        # don't contribute to "7 underarm turns" aggregates the user
        # would otherwise read as a definitive tally.
        try:
            confidence = float(p.get("confidence", _CONFIDENCE_UNSET))
        except (TypeError, ValueError):
            confidence = _CONFIDENCE_UNSET
        if confidence < 0.5:
            continue
        # Key on (family + variant) so "basket whip" and "reverse whip"
        # count as distinct patterns even though they share the "whip"
        # family. "basic" variant groups with null — both mean
        # "plain execution of the family".
        raw_variant = _s(p.get("variant")).lower()
        variant_key_part = "" if raw_variant in ("", "basic") else raw_variant
        key = _normalize_pattern_name(raw_name) + (
            f"|{variant_key_part}" if variant_key_part else ""
        )
        counts[key] += 1
        display_names.setdefault(key, raw_name)
        # Store the first non-"basic" variant we see for this key
        # so the UI can show it as a distinct label.
        if variant_key_part and key not in variants_per_key:
            variants_per_key[key] = raw_variant
        q = p.get("quality")
        if isinstance(q, str) and q:
            qualities[key].append(q)
        t = p.get("timing")
        if isinstance(t, str) and t:
            timings[key].append(t)
        n = _s(p.get("notes"))
        if n and n not in notes[key]:
            notes[key].append(n)
        styling_val = _s(p.get("styling"))
        if styling_val and styling_val not in stylings[key]:
            stylings[key].append(styling_val)
        tip_val = _s(p.get("coaching_tip"))
        if tip_val and tip_val not in tips[key]:
            tips[key].append(tip_val)

    def _most_common(items: list[str]) -> str | None:
        return Counter(items).most_common(1)[0][0] if items else None

    summary: list[dict[str, Any]] = []
    for key, cnt in counts.most_common():
        summary.append(
            {
                "name": display_names[key],
                "variant": variants_per_key.get(key),
                "count": cnt,
                "quality": _most_common(qualities[key]),
                "timing": _most_common(timings[key]),
                "notes": " · ".join(notes[key][:3]) if notes[key] else None,
                "styling": (
                    " · ".join(stylings[key][:2]) if stylings[key] else None
                ),
                "coaching_tip": (
                    " · ".join(tips[key][:2]) if tips[key] else None
                ),
            }
        )
    return summary


def _sanity_check(
    parsed: dict[str, Any],
    duration_sec: float | None,
    *,
    dance_start_sec: float | None = None,
    dance_end_sec: float | None = None,
) -> list[str]:
    """Return a human-readable list of implausibility issues in
    Gemini's response. Empty list = response looks reasonable.

    The goal is to catch "model hallucinated a 60s intro" or
    "claimed there's only 2 patterns in a 2-minute clip" before
    we persist the result. Callers should use the issue list as
    a correction prompt for a single retry.

    When a dance window is known, pattern-density expectations are
    computed against the dance duration (not the total video
    duration) so clips with long walk-ons don't get falsely
    flagged as "too few patterns". Entries emitted outside the
    dance window are also flagged — they're pre-dance or
    post-dance hallucinations.
    """
    issues: list[str] = []

    patterns = parsed.get("patterns_identified") or []
    if not isinstance(patterns, list):
        return ["patterns_identified is missing or not a list"]

    # Flag any pattern the model placed outside the declared dance
    # window — even after sanitize trims these, the raw Gemini JSON
    # still contains them at sanity-check time so we catch the
    # "hallucinated pre-dance" failure mode and trigger a retry.
    if dance_start_sec is not None or dance_end_sec is not None:
        out_of_window = 0
        for p in patterns:
            if not isinstance(p, dict):
                continue
            try:
                start = float(p.get("start_time"))
                end = float(p.get("end_time"))
            except (TypeError, ValueError):
                continue
            if dance_start_sec is not None and end <= dance_start_sec:
                out_of_window += 1
            elif dance_end_sec is not None and start >= dance_end_sec:
                out_of_window += 1
        if out_of_window > 0:
            issues.append(
                f"{out_of_window} pattern(s) placed outside the dance "
                f"window ({dance_start_sec or 0:.1f}s - "
                f"{dance_end_sec or 0:.1f}s) — the couple is not "
                "dancing in that span"
            )

    # 1. Non-dance labels that are suspiciously long. A real WCS
    # intro / starter step / anchor-only moment is a few seconds;
    # 15s+ means the model grouped 'walking onstage' or 'waiting'
    # into one block and probably missed actual dancing inside it.
    NON_DANCE = {
        "intro",
        "introduction",
        "waiting",
        "wait",
        "unknown",
        "starter step",
        "pause",
        "break",
        "setup",
        "preparation",
    }
    MAX_NON_DANCE_SEC = 15.0
    MAX_ANY_PATTERN_SEC = 15.0

    for p in patterns:
        if not isinstance(p, dict):
            continue
        name = (p.get("name") or "").strip().lower()
        try:
            start = float(p.get("start_time"))
            end = float(p.get("end_time"))
        except (TypeError, ValueError):
            continue
        span = end - start
        if span <= 0:
            continue
        if name in NON_DANCE and span > MAX_NON_DANCE_SEC:
            issues.append(
                f'"{name}" from {start:.0f}s to {end:.0f}s is '
                f"{span:.0f}s long — too long for a non-dance segment; "
                "something is actually happening in that window"
            )
        elif span > MAX_ANY_PATTERN_SEC:
            issues.append(
                f'pattern "{name}" at {start:.0f}s spans {span:.0f}s '
                "— way too long for a single WCS window; likely merged repeats"
            )

    # 2. Not enough patterns for the dance length. WCS runs at
    # roughly one pattern per 4-6 seconds, so 90s of actual dancing
    # should have ~15-25 entries. Prefer dance-window duration over
    # total video duration so clips with long walk-ons / bows don't
    # trigger false "too few patterns" flags.
    if dance_start_sec is not None and dance_end_sec is not None:
        effective_sec = max(0.0, dance_end_sec - dance_start_sec)
    else:
        effective_sec = duration_sec or 0.0
    if effective_sec > 30:
        expected_min = max(5, int(effective_sec / 10))
        # Only count patterns inside the dance window for the density
        # check — out-of-window entries are already flagged above.
        in_window = 0
        for p in patterns:
            if not isinstance(p, dict):
                continue
            try:
                start = float(p.get("start_time"))
                end = float(p.get("end_time"))
            except (TypeError, ValueError):
                continue
            if dance_start_sec is not None and end <= dance_start_sec:
                continue
            if dance_end_sec is not None and start >= dance_end_sec:
                continue
            in_window += 1
        if in_window < expected_min:
            issues.append(
                f"only {in_window} patterns identified for "
                f"{int(effective_sec)}s of dancing — expected at least "
                f"{expected_min} based on typical WCS pattern density"
            )

    # 3. Large uncovered gaps INSIDE the dance window. If the
    # model skipped a 20-second stretch of dancing, it almost
    # certainly missed patterns. Gaps outside the dance window
    # (pre-dance setup, post-dance walk-off) are expected.
    MAX_GAP_SEC = 10.0
    timed: list[tuple[float, float]] = []
    for p in patterns:
        if not isinstance(p, dict):
            continue
        try:
            pstart = float(p.get("start_time"))
            pend = float(p.get("end_time"))
        except (TypeError, ValueError):
            continue
        # Skip out-of-window entries when computing gaps.
        if dance_start_sec is not None and pend <= dance_start_sec:
            continue
        if dance_end_sec is not None and pstart >= dance_end_sec:
            continue
        timed.append((pstart, pend))
    timed.sort()
    window_start = dance_start_sec if dance_start_sec is not None else 0.0
    window_end = (
        dance_end_sec
        if dance_end_sec is not None
        else (duration_sec or 0.0)
    )
    prev_end = window_start
    for start, end in timed:
        gap = start - prev_end
        if gap > MAX_GAP_SEC:
            issues.append(
                f"{gap:.0f}s gap between {prev_end:.0f}s and {start:.0f}s "
                "has no pattern labeled"
            )
        prev_end = max(prev_end, end)
    if window_end and window_end - prev_end > MAX_GAP_SEC:
        issues.append(
            f"last {window_end - prev_end:.0f}s of the dance "
            f"(from ~{prev_end:.0f}s onwards) has no pattern labeled"
        )

    # observed_level is now REQUIRED by the prompt. A null return means
    # the model punted on tier placement — surface as a soft issue so
    # we log it and can trigger a retry on the next cleanup.
    observed = parsed.get("observed_level")
    if observed is None or (isinstance(observed, str) and not observed.strip()):
        issues.append(
            "observed_level is missing — model must commit to a tier "
            "(Newcomer|Novice|Intermediate|Advanced|All-Star|Champion)"
        )

    return issues


_MUSICAL_MOMENT_KINDS = {
    "phrase_top",
    "break",
    "hit",
    "pocket",
    "drop",
    "accent",
    "build",
}
_FOLLOWER_INITIATIVE_KINDS = {
    "hijack",
    "syncopation",
    "styling",
    "interpretation",
    "musical_hit",
}


def _sanitize_musical_moments(
    raw: list[Any] | None,
    *,
    dance_start_sec: float | None = None,
    dance_end_sec: float | None = None,
) -> list[dict[str, Any]]:
    """Clean Gemini's musical_moments output.

    - Drops entries with missing / non-numeric timestamps.
    - Drops entries outside the dance window (music happening
      during walk-on / walk-off is not the dancers' problem).
    - Normalizes kind to a known value or None (keep the entry
      with unknown kind so the UI can still render it generically).
    - Coerces `caught` to bool.
    """
    if not isinstance(raw, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        ts = _safe_float(entry.get("timestamp_sec"))
        if ts is None:
            continue
        if dance_start_sec is not None and ts < dance_start_sec - 0.25:
            continue
        if dance_end_sec is not None and ts > dance_end_sec + 0.25:
            continue
        kind = (entry.get("kind") or "").strip().lower() or None
        if kind and kind not in _MUSICAL_MOMENT_KINDS:
            kind = None
        cleaned.append(
            {
                "timestamp_sec": ts,
                "kind": kind,
                "description": (entry.get("description") or "").strip() or None,
                "caught": _coerce_bool(entry.get("caught")),
                "caught_how": (
                    (entry.get("caught_how") or "").strip() or None
                ),
            }
        )
    cleaned.sort(key=lambda m: m["timestamp_sec"])
    return cleaned


def _sanitize_follower_initiative(
    raw: list[Any] | None,
    *,
    dance_start_sec: float | None = None,
    dance_end_sec: float | None = None,
) -> list[dict[str, Any]]:
    """Clean Gemini's follower_initiative output. Same shape as
    musical_moments but keyed on follower-authored moments. We keep
    it separate from musical_moments so the frontend can render
    them as distinct lenses.
    """
    if not isinstance(raw, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        ts = _safe_float(entry.get("timestamp_sec"))
        if ts is None:
            continue
        if dance_start_sec is not None and ts < dance_start_sec - 0.25:
            continue
        if dance_end_sec is not None and ts > dance_end_sec + 0.25:
            continue
        kind = (entry.get("kind") or "").strip().lower() or None
        if kind and kind not in _FOLLOWER_INITIATIVE_KINDS:
            kind = None
        quality = (entry.get("quality") or "").strip().lower() or None
        if quality not in (None, "strong", "solid", "needs_work"):
            quality = None
        cleaned.append(
            {
                "timestamp_sec": ts,
                "kind": kind,
                "description": (entry.get("description") or "").strip() or None,
                "quality": quality,
            }
        )
    cleaned.sort(key=lambda m: m["timestamp_sec"])
    return cleaned


def _coerce_score(v: Any, default: float = 0.0) -> float:
    """Coerce a numeric field to a float clamped to [0, 10].

    Gemini sometimes returns scores as strings ("8.5"), lists ([8, 9]),
    or the occasional free-text qualifier ("high 8"). The frontend
    calls `.toFixed(1)` directly on these fields, so any non-number
    white-screens the analysis page. Clamp to the valid WCS range so
    an outlier like 42 or -3 can't skew downstream computations either.
    """
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:  # NaN check
        return default
    if f < 0:
        return 0.0
    if f > 10:
        return 10.0
    return round(f, 2)


def _coerce_bool(v: Any) -> bool:
    """Coerce a loosely-typed 'caught' flag into a strict boolean.

    `bool(x)` is too permissive: Gemini occasionally returns the
    string "false" or "missed" here, both of which bool() would
    treat as truthy. Parse known true/false tokens explicitly and
    default to False for anything else — "caught" should be an
    explicit positive, not a fuzzy fallback.
    """
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        normalized = v.strip().lower()
        return normalized in ("true", "1", "yes", "y", "caught", "hit")
    return False


def _coerce_str_list(
    raw: Any, *, max_items: int = 20, max_len: int = 500
) -> list[str]:
    """Coerce a field expected to be a list-of-strings into a safe
    list. Gemini occasionally returns a single string, a dict, or null
    where we asked for an array — the frontend `.map()`s over these
    and crashes if the value isn't iterable. Anything non-stringy is
    dropped rather than stringified blindly."""
    if raw is None:
        return []
    items: list[Any]
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, str):
        # Single string where we asked for an array — wrap it so we
        # at least don't lose the content.
        items = [raw]
    else:
        return []
    cleaned: list[str] = []
    for item in items[:max_items]:
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if not trimmed:
            continue
        cleaned.append(trimmed[:max_len])
    return cleaned


# Stock coaching phrases we've observed the model ship on nearly every
# analysis regardless of what was in the video. Each pattern matches
# case-insensitively against the raw suggestion text. When a suggestion
# text matches one of these AND has no grounded observed_cue, we drop
# it — it's horoscope coaching, not feedback. Sourced from real-world
# Discord feedback (2026-04-18) + the three share tokens we audited.
_STOCK_COACHING_PATTERNS = tuple(
    _re.compile(pat, _re.IGNORECASE)
    for pat in (
        # "Roll through your feet", "rolling through the feet", etc.
        r"roll(?:ing)? through (?:the |your )?feet",
        r"\bheel[- ]toe\b",
        # "Stack your posture", "stacking the posture"
        r"stack(?:ing)? (?:the |your )?posture",
        r"shoulders over hips",
        # "Initiate movement from your core", "initiate patterns by
        # shifting your body weight", etc. — loose enough to catch the
        # live-data variants, strict enough not to fire on specific
        # moment-grounded feedback.
        r"\binitiate\b[^.]{0,60}(?:body ?weight|\b(?:core|center|body)\b)",
        # "Introduce more variety", "add pattern variety"
        r"(?:introduce|add|bring|more|greater)\b[^.]{0,30}\bvariety\b",
        r"break up the repetitive loop",
        # "Settle deeper into the anchor", "elastic stretch at the anchor"
        r"settle (?:deeper|more)[^.]{0,30}\banchor\b",
        r"elastic stretch[^.]{0,20}anchor",
        # "Keep the chest lifted", "lift the chest"
        r"(?:keep the chest lifted|lift (?:the|your) chest)",
        # "Engage the core", "engage your core"
        r"engage (?:the|your) core\b",
        # "avoid pitching forward", "avoid hinging at the waist"
        r"avoid (?:pitching|hinging|breaking|collapsing)\b[^.]{0,40}(?:forward|waist|hips)",
        # "eliminate the clomping / flat-footed look"
        r"eliminate the (?:clomping|flat[- ]footed) look",
        # "compression [...] in the arms rather than the core"
        r"compression[^.]{0,40}\barms?\b[^.]{0,20}(?:rather|instead|core)",
    )
)


def _is_stock_coaching(text: str) -> bool:
    """True if the text matches one of the documented stock-phrase
    patterns. Used to drop 'horoscope' coaching that isn't tied to a
    specific video moment.
    """
    return any(pat.search(text) for pat in _STOCK_COACHING_PATTERNS)


def _fmt_timestamp(sec: float) -> str:
    """Format seconds as 'M:SS' for human-readable coaching prefixes."""
    if sec < 0:
        sec = 0.0
    m = int(sec // 60)
    s = int(round(sec - m * 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


def _sanitize_coaching_list(
    raw: Any,
    *,
    max_items: int = 3,
    dance_start_sec: float | None = None,
    dance_end_sec: float | None = None,
) -> list[str]:
    """Coerce strengths / improvements into a grounded, de-horoscoped
    list of display strings.

    Accepts either the new rich shape from the prompt:
        [{"text": "...", "observed_cue": "...", "timestamp_sec": 12.5}, ...]
    or the legacy bare-string shape:
        ["...", "..."]

    For the rich shape:
      - entries without a non-empty `observed_cue` are dropped
      - entries whose `text` matches a stock-coaching pattern are dropped
      - entries outside the dance window are dropped
      - survivors render as `"[M:SS] text"` (the cue powers the drop
        decision but doesn't need to show twice in the UI).

    For the legacy shape: we keep the entries but still drop any that
    match a stock-coaching pattern — better to show fewer items than
    ship the horoscope triad.
    """
    if raw is None:
        return []
    items: list[Any]
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, str):
        items = [raw]
    else:
        return []

    cleaned: list[str] = []
    for item in items:
        if isinstance(item, dict):
            text_raw = item.get("text") or item.get("suggestion") or ""
            text = str(text_raw).strip() if text_raw else ""
            if not text:
                continue
            cue_raw = item.get("observed_cue") or ""
            cue = str(cue_raw).strip() if cue_raw else ""
            ts = _safe_float(item.get("timestamp_sec"))
            # Drop horoscope text even when the model also attached a
            # cue — if the cue is just a restatement of the platitude,
            # the rendered suggestion is still generic.
            if _is_stock_coaching(text):
                continue
            # Rich-shape contract: require an observed_cue. Without
            # one, the suggestion can't be verified against the video
            # and is indistinguishable from a horoscope.
            if not cue:
                continue
            if ts is not None:
                if dance_start_sec is not None and ts < dance_start_sec - 0.5:
                    continue
                if dance_end_sec is not None and ts > dance_end_sec + 0.5:
                    continue
                cleaned.append(f"[{_fmt_timestamp(ts)}] {text[:500]}")
            else:
                cleaned.append(text[:500])
        elif isinstance(item, str):
            trimmed = item.strip()
            if not trimmed:
                continue
            if _is_stock_coaching(trimmed):
                continue
            cleaned.append(trimmed[:500])
        if len(cleaned) >= max_items:
            break
    return cleaned


def _coerce_category(cat: Any) -> dict[str, Any]:
    """Coerce a single category dict into a shape the frontend can
    safely render. Missing or malformed `score` becomes 0.0 (never
    a crash). Nested sub-scores (posture, extension, footwork, slot)
    get the same treatment. All other fields pass through so reasoning
    / notes / off_beat_moments survive the round trip unchanged."""
    if not isinstance(cat, dict):
        return {"score": 0.0}
    out: dict[str, Any] = dict(cat)
    out["score"] = _coerce_score(cat.get("score"))
    if "score_low" in cat:
        out["score_low"] = _coerce_score(cat.get("score_low"), default=out["score"])
    if "score_high" in cat:
        out["score_high"] = _coerce_score(cat.get("score_high"), default=out["score"])
    # Nested sub-scores on technique; shape is {score, notes}.
    for sub_key in ("posture", "extension", "footwork", "slot"):
        sub = cat.get(sub_key)
        if isinstance(sub, dict) and "score" in sub:
            out[sub_key] = {
                **sub,
                "score": _coerce_score(sub.get("score")),
            }
    return out


def _shape_response(
    parsed: dict[str, Any],
    *,
    usage: dict[str, Any] | None = None,
    sanity_warnings: list[str] | None = None,
    dance_start_sec: float | None = None,
    dance_end_sec: float | None = None,
    beat_grid: dict[str, Any] | None = None,
    user_song_style: str | None = None,
) -> dict[str, Any]:
    """Map Gemini's rich response into the API's return shape.

    Preserves rich audit fields (reasoning, score_low/high,
    off_beat_moments, sub-scores, patterns) while also providing the
    simplified fields the current frontend renders.

    All score and list fields are coerced through the `_coerce_*`
    helpers so one malformed Gemini response cannot poison a DB row
    or crash the analysis page on `.toFixed()` / `.map()`.
    """
    categories = {
        key: _coerce_category(parsed.get(key))
        for key in ("timing", "technique", "teamwork", "presentation")
    }
    overall_score = _compute_overall(categories)
    grade = _grade_letter(overall_score)
    max_interval = _max_interval(categories)
    # Flag a result as low-confidence when any category interval is wider
    # than 2 points — matches wcs-analyzer's scoring.py heuristic.
    confidence = "low" if max_interval > 2.0 else "high"

    # Grounded coaching: the prompt now asks for
    # [{text, observed_cue, timestamp_sec}, ...] so we can drop
    # entries that aren't tied to a moment in the video. Stock
    # phrases ("roll through your feet", "stack your posture", ...)
    # get stripped even when the model obeys the shape, because
    # they're the horoscope triad users called out in feedback.
    # Falls back to the legacy string-only shape when the model
    # returns bare strings — old clips re-analyzed before the
    # prompt change still render.
    strengths = _sanitize_coaching_list(
        parsed.get("highlights") or parsed.get("strengths"),
        dance_start_sec=dance_start_sec,
        dance_end_sec=dance_end_sec,
    )
    improvements = _sanitize_coaching_list(
        parsed.get("improvements"),
        dance_start_sec=dance_start_sec,
        dance_end_sec=dance_end_sec,
    )

    patterns_identified = _sanitize_patterns(
        parsed.get("patterns_identified"),
        dance_start_sec=dance_start_sec,
        dance_end_sec=dance_end_sec,
    )
    pattern_summary = _summarize_patterns(patterns_identified)
    # Top-level flag so the frontend can render a "pattern
    # identification was low confidence on this analysis" banner
    # without having to re-derive it from the timeline. Set when
    # `_sanitize_patterns` detected a hallucinated repeating cycle
    # (real dances rarely hit the 3+ reps of the same 2-5 pattern
    # block threshold).
    timeline_locked = any(
        p.get("timeline_locked") for p in patterns_identified
    )
    extra_warnings: list[str] = []
    if timeline_locked:
        extra_warnings.append(
            "Pattern timeline shows a repeating cycle — the model "
            "likely fell into a template rather than identifying each "
            "pattern from the video. Treat the pattern labels as "
            "low-confidence."
        )
    musical_moments = _sanitize_musical_moments(
        parsed.get("musical_moments"),
        dance_start_sec=dance_start_sec,
        dance_end_sec=dance_end_sec,
    )
    follower_initiative = _sanitize_follower_initiative(
        parsed.get("follower_initiative"),
        dance_start_sec=dance_start_sec,
        dance_end_sec=dance_end_sec,
    )

    # Song-style precedence: user-tag > librosa swing-ratio > Gemini
    # guess. The Gemini answer is routinely wrong (ships "contemporary"
    # for blues), so we prefer any signal that isn't it.
    detected_style = (beat_grid or {}).get("detected_style") if beat_grid else None
    song_style = (
        user_song_style
        or detected_style
        or parsed.get("song_style")
    )

    return {
        "overall": {
            "score": overall_score,
            "grade": grade,
            "confidence": confidence,
            "impression": parsed.get("overall_impression"),
        },
        "categories": categories,
        "patterns_identified": patterns_identified,
        "pattern_summary": pattern_summary,
        "musical_moments": musical_moments,
        "follower_initiative": follower_initiative,
        "dance_start_sec": dance_start_sec,
        "dance_end_sec": dance_end_sec,
        "beat_grid": beat_grid,
        "strengths": strengths,
        "improvements": improvements,
        "lead": parsed.get("lead"),
        "follow": parsed.get("follow"),
        "estimated_bpm": parsed.get("estimated_bpm"),
        "song_style": song_style,
        "song_style_source": (
            "user-tag" if user_song_style
            else ("detector" if detected_style else "gemini")
        ),
        "observed_level": parsed.get("observed_level"),
        "timeline_locked": timeline_locked,
        "sanity_warnings": (sanity_warnings or []) + extra_warnings,
        "usage": usage,
    }
