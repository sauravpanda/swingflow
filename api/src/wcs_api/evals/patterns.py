from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from statistics import mean
from typing import Any

from ..services import supabase_admin

_REPO_API_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_TRUTH_DIR = _REPO_API_ROOT / "evals" / "patterns"

_PATTERN_ALIASES = {
    "push break": "sugar push",
    "same side tuck": "sugar tuck",
    "under arm pass": "right side pass",
    "underarm turn": "right side pass",
    "tuck": "tuck turn",
    "shootout": "fold",
    "cradle whip": "basket whip",
    "cuddle whip": "basket whip",
    "locked whip": "basket whip",
    "apache whip": "texas tommy",
    "texas tommy whip": "texas tommy",
    "decap whip": "decapitive whip",
    "change of places": "changing places",
}

_WHIP_FAMILY_VARIANTS = {
    "basket whip": "basket",
    "closed whip": "closed",
    "inside whip": "inside",
    "reverse whip": "reverse",
    "texas tommy": "texas tommy",
    "tandem whip": "tandem",
    "shadow whip": "shadow",
    "tunnel whip": "tunnel",
    "dishrag whip": "dishrag",
    "windows whip": "windows",
    "matador whip": "matador",
    "same side whip": "same side",
    "hustle whip": "hustle",
    "carwash whip": "carwash",
    "pull through whip": "pull through",
    "decapitive whip": "decapitive",
    "behind the back whip": "behind the back",
    "over the head whip": "over the head",
    "outside walking whip": "outside walking",
    "underarm whip": "underarm",
    "half whip & throwout": "half whip & throwout",
    "continuous whip": "continuous",
    "extended whip": "extended",
    "lead's cradle whip": "lead's cradle",
}

_VARIANT_ALIASES = {
    "apache": "texas tommy",
    "titanic": "shadow",
    "rolling": "continuous",
    "decap": "decapitive",
}


def _norm_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    for old, new in (
        ("\u2013", "-"),
        ("\u2014", "-"),
        ("\u2212", "-"),
        ("\u2019", "'"),
    ):
        text = text.replace(old, new)
    return " ".join(text.split())


def _canonical_pattern_name(value: Any) -> str:
    norm = _norm_text(value)
    return _PATTERN_ALIASES.get(norm, norm)


def _canonical_variant(value: Any) -> str | None:
    norm = _norm_text(value)
    if norm in ("", "null", "none", "basic"):
        return None
    return _VARIANT_ALIASES.get(norm, norm)


def _canonical_label(name: Any, variant: Any) -> tuple[str, str | None]:
    family = _canonical_pattern_name(name)
    variant_norm = _canonical_variant(variant)
    whip_variant = _WHIP_FAMILY_VARIANTS.get(family)
    if whip_variant:
        return "whip", variant_norm or whip_variant
    return family, variant_norm


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{path} did not contain a JSON object")
    return data


def _find_truth_file(clip_ref: str) -> Path | None:
    path = _DEFAULT_TRUTH_DIR / f"{clip_ref}.json"
    return path if path.exists() else None


def _extract_clip_from_truth_payload(
    payload: dict[str, Any],
    *,
    clip_ref: str | None = None,
) -> dict[str, Any]:
    if isinstance(payload.get("truth"), list):
        return payload

    clips = payload.get("clips")
    if not isinstance(clips, list):
        raise ValueError("Truth payload must contain either `truth` or `clips`.")
    if not clip_ref:
        if len(clips) != 1:
            raise ValueError("Truth bundle contains multiple clips; pass a clip ref.")
        clip = clips[0]
        if not isinstance(clip, dict):
            raise ValueError("Truth bundle clip entry must be an object.")
        return clip

    for clip in clips:
        if not isinstance(clip, dict):
            continue
        if clip.get("clip_id") == clip_ref or clip.get("analysis_id") == clip_ref:
            return clip
    raise ValueError(f"Clip `{clip_ref}` not found in truth bundle.")


def _normalize_truth_entries(entries: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        start = _safe_float(entry.get("start"))
        end = _safe_float(entry.get("end"))
        if start is None or end is None or end <= start:
            continue
        family, variant = _canonical_label(entry.get("name"), entry.get("variant"))
        normalized.append(
            {
                "start": start,
                "end": end,
                "name": family,
                "variant": variant,
                "count": entry.get("count"),
                "source": entry.get("source"),
                "notes": entry.get("notes"),
            }
        )
    normalized.sort(key=lambda item: (item["start"], item["end"]))
    return normalized


def _normalize_prediction_entries(entries: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        start = _safe_float(entry.get("start_time"))
        end = _safe_float(entry.get("end_time"))
        if start is None or end is None or end <= start:
            continue
        family, variant = _canonical_label(entry.get("name"), entry.get("variant"))
        normalized.append(
            {
                "start": start,
                "end": end,
                "name": family,
                "variant": variant,
                "count": entry.get("count"),
                "confidence": _safe_float(entry.get("confidence")),
                "raw_name": entry.get("name"),
                "raw_variant": entry.get("variant"),
            }
        )
    normalized.sort(key=lambda item: (item["start"], item["end"]))
    return normalized


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def _iou(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    overlap = _overlap(a_start, a_end, b_start, b_end)
    if overlap <= 0:
        return 0.0
    union = (a_end - a_start) + (b_end - b_start) - overlap
    return overlap / union if union > 0 else 0.0


def _match_windows(
    truth: list[dict[str, Any]],
    predicted: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], set[int], set[int]]:
    candidate_pairs: list[tuple[float, float, int, int]] = []
    truth_overlap: set[int] = set()
    predicted_overlap: set[int] = set()
    for truth_idx, truth_entry in enumerate(truth):
        for pred_idx, pred_entry in enumerate(predicted):
            overlap = _overlap(
                truth_entry["start"],
                truth_entry["end"],
                pred_entry["start"],
                pred_entry["end"],
            )
            if overlap <= 0:
                continue
            truth_overlap.add(truth_idx)
            predicted_overlap.add(pred_idx)
            candidate_pairs.append(
                (
                    _iou(
                        truth_entry["start"],
                        truth_entry["end"],
                        pred_entry["start"],
                        pred_entry["end"],
                    ),
                    overlap,
                    truth_idx,
                    pred_idx,
                )
            )

    candidate_pairs.sort(reverse=True)
    used_truth: set[int] = set()
    used_pred: set[int] = set()
    matches: list[dict[str, Any]] = []
    for iou, overlap, truth_idx, pred_idx in candidate_pairs:
        if truth_idx in used_truth or pred_idx in used_pred:
            continue
        used_truth.add(truth_idx)
        used_pred.add(pred_idx)
        truth_entry = truth[truth_idx]
        pred_entry = predicted[pred_idx]
        family_match = truth_entry["name"] == pred_entry["name"]
        variant_match = truth_entry["variant"] == pred_entry["variant"]
        matches.append(
            {
                "truth_index": truth_idx,
                "prediction_index": pred_idx,
                "truth": truth_entry,
                "prediction": pred_entry,
                "overlap_sec": round(overlap, 3),
                "iou": round(iou, 4),
                "family_match": family_match,
                "variant_match": variant_match,
                "exact_match": family_match and variant_match,
            }
        )
    matches.sort(key=lambda item: item["truth"]["start"])
    return matches, truth_overlap, predicted_overlap


def evaluate_patterns(
    truth: list[dict[str, Any]],
    predicted: list[dict[str, Any]],
) -> dict[str, Any]:
    matches, truth_overlap, predicted_overlap = _match_windows(truth, predicted)
    exact_matches = sum(1 for match in matches if match["exact_match"])
    family_matches = sum(1 for match in matches if match["family_match"])

    def _rate(numerator: int, denominator: int) -> float | None:
        if denominator <= 0:
            return None
        return round(numerator / denominator, 4)

    unmatched_truth = [
        truth[idx] for idx in range(len(truth)) if idx not in {m["truth_index"] for m in matches}
    ]
    unmatched_predictions = [
        predicted[idx]
        for idx in range(len(predicted))
        if idx not in {m["prediction_index"] for m in matches}
    ]

    return {
        "truth_count": len(truth),
        "predicted_count": len(predicted),
        "overlap_truth_count": len(truth_overlap),
        "overlap_prediction_count": len(predicted_overlap),
        "matched_pairs": len(matches),
        "metrics": {
            "detection_recall": _rate(len(truth_overlap), len(truth)),
            "detection_precision": _rate(len(predicted_overlap), len(predicted)),
            "family_match_recall": _rate(family_matches, len(truth)),
            "family_match_precision": _rate(family_matches, len(predicted)),
            "exact_match_recall": _rate(exact_matches, len(truth)),
            "exact_match_precision": _rate(exact_matches, len(predicted)),
            "timing_iou_mean": (
                round(mean(match["iou"] for match in matches), 4) if matches else None
            ),
        },
        "matches": matches,
        "false_negatives": unmatched_truth,
        "false_positives": unmatched_predictions,
    }


async def _fetch_live_truth_clip(clip_ref: str) -> dict[str, Any]:
    analysis = await supabase_admin.get_analysis_eval_row(clip_ref)
    if not analysis:
        raise ValueError(
            f"No analysis found for `{clip_ref}` in Supabase and no local truth file exists."
        )
    analysis_id = analysis.get("id")
    if not isinstance(analysis_id, str):
        raise ValueError(f"Analysis `{clip_ref}` is missing an id.")
    labels = await supabase_admin.get_pattern_labels(analysis_id)
    if not labels:
        raise ValueError(f"Analysis `{clip_ref}` has no pattern_labels rows to grade.")

    result = analysis.get("result")
    dance_start = result.get("dance_start_sec") if isinstance(result, dict) else None
    dance_end = result.get("dance_end_sec") if isinstance(result, dict) else None
    return {
        "clip_id": analysis.get("filename") or analysis_id,
        "analysis_id": analysis_id,
        "filename": analysis.get("filename"),
        "dance_start_sec": dance_start,
        "dance_end_sec": dance_end,
        "truth": [
            {
                "start": label.get("start_time"),
                "end": label.get("end_time"),
                "name": label.get("name"),
                "variant": label.get("variant"),
                "count": label.get("count"),
                "source": label.get("source"),
                "notes": label.get("notes"),
            }
            for label in labels
        ],
    }


def _load_truth_clip(args: argparse.Namespace) -> tuple[dict[str, Any], str]:
    if args.truth_file:
        payload = _load_json(Path(args.truth_file))
        return _extract_clip_from_truth_payload(payload, clip_ref=args.clip_ref), str(args.truth_file)

    default_truth = _find_truth_file(args.clip_ref)
    if default_truth:
        return _extract_clip_from_truth_payload(_load_json(default_truth)), str(default_truth)

    return asyncio.run(_fetch_live_truth_clip(args.clip_ref)), "supabase:pattern_labels"


def _load_prediction_payload(args: argparse.Namespace, truth_clip: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if args.prediction_file:
        payload = _load_json(Path(args.prediction_file))
        if isinstance(payload.get("result"), dict):
            payload = payload["result"]
        return payload, str(args.prediction_file)

    analysis_ref = truth_clip.get("analysis_id") or args.clip_ref
    if not isinstance(analysis_ref, str) or not analysis_ref.strip():
        raise ValueError("Truth clip is missing analysis_id, and no prediction file was provided.")
    analysis = asyncio.run(supabase_admin.get_analysis_eval_row(analysis_ref))
    if not analysis:
        raise ValueError(f"Could not fetch stored analysis `{analysis_ref}` from Supabase.")
    result = analysis.get("result")
    if not isinstance(result, dict):
        raise ValueError(f"Stored analysis `{analysis_ref}` does not contain a result payload.")
    return result, f"supabase:video_analyses:{analysis_ref}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Grade one analysis against ground-truth pattern labels. "
            "By default this looks for api/evals/patterns/<clip-ref>.json, "
            "then falls back to live pattern_labels in Supabase."
        )
    )
    parser.add_argument(
        "clip_ref",
        help="Clip id, filename, or analysis id to grade.",
    )
    parser.add_argument(
        "--truth-file",
        help="Path to a single-clip truth JSON or a swingflow.pattern-labels/v1 bundle.",
    )
    parser.add_argument(
        "--prediction-file",
        help="Path to a stored analysis result JSON. Skips the Supabase fetch for predictions.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of the text summary.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        truth_clip, truth_source = _load_truth_clip(args)
        prediction_payload, prediction_source = _load_prediction_payload(args, truth_clip)
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}")
        return 1

    truth = _normalize_truth_entries(truth_clip.get("truth") or [])
    predicted = _normalize_prediction_entries(prediction_payload.get("patterns_identified") or [])
    report = evaluate_patterns(truth, predicted)
    output = {
        "clip_id": truth_clip.get("clip_id") or args.clip_ref,
        "analysis_id": truth_clip.get("analysis_id"),
        "truth_source": truth_source,
        "prediction_source": prediction_source,
        "report": report,
    }

    if args.json:
        print(json.dumps(output, indent=2))
        return 0

    metrics = report["metrics"]
    print(f"Clip: {output['clip_id']}")
    print(f"Analysis: {output['analysis_id'] or 'unknown'}")
    print(f"Truth source: {truth_source}")
    print(f"Prediction source: {prediction_source}")
    print(f"Truth windows: {report['truth_count']}")
    print(f"Predicted windows: {report['predicted_count']}")
    print(
        "Detection recall / precision: "
        f"{metrics['detection_recall']} / {metrics['detection_precision']}"
    )
    print(
        "Family match recall / precision: "
        f"{metrics['family_match_recall']} / {metrics['family_match_precision']}"
    )
    print(
        "Exact match recall / precision: "
        f"{metrics['exact_match_recall']} / {metrics['exact_match_precision']}"
    )
    print(f"Mean timing IoU: {metrics['timing_iou_mean']}")

    false_negatives = report["false_negatives"][:5]
    false_positives = report["false_positives"][:5]
    if false_negatives:
        print("\nTop false negatives:")
        for entry in false_negatives:
            print(
                f"  - {entry['start']:.2f}-{entry['end']:.2f}s "
                f"{entry['name']} ({entry['variant'] or 'basic'})"
            )
    if false_positives:
        print("\nTop false positives:")
        for entry in false_positives:
            print(
                f"  - {entry['start']:.2f}-{entry['end']:.2f}s "
                f"{entry['name']} ({entry['variant'] or 'basic'})"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
