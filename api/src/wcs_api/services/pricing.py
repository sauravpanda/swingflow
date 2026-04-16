"""Per-model Gemini API pricing and cost estimation.

Ported from sibling `wcs-analyzer` project. Prices are USD per 1M
tokens — a point-in-time snapshot that trails upstream changes. The
`pricing_updated_on` date is surfaced in every analysis record so we
can reconcile against the actual bill later.

Cost is stored as integer micros (1e-6 USD) to avoid float drift in
Postgres aggregations.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

PRICING_UPDATED_ON = "2026-04-15"


@dataclass(frozen=True)
class ModelPricing:
    input_per_mtok: float
    output_per_mtok: float


# Prices in USD per 1M tokens (text). Video / audio / image tokens on
# Gemini are typically billed at the same rate as the closest modality
# and `total_token_count` already sums them, so we use a single rate
# per model here.
_DEFAULT_PRICING: dict[str, ModelPricing] = {
    "gemini-3.1-pro-preview": ModelPricing(2.00, 12.00),
    "gemini-3-pro-preview": ModelPricing(2.00, 12.00),
    "gemini-3-pro": ModelPricing(2.00, 12.00),
    "gemini-2.5-flash": ModelPricing(0.30, 2.50),
    "gemini-2.5-pro": ModelPricing(1.25, 10.00),
    "gemini-1.5-flash": ModelPricing(0.075, 0.30),
    "gemini-1.5-pro": ModelPricing(1.25, 5.00),
}


def _load_override() -> tuple[dict[str, ModelPricing], str | None]:
    path_str = os.environ.get("WCS_PRICING_FILE")
    if not path_str:
        return {}, None
    path = Path(path_str)
    if not path.exists():
        logger.warning("WCS_PRICING_FILE %s does not exist; ignoring", path)
        return {}, None
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse WCS_PRICING_FILE %s: %s", path, e)
        return {}, None
    overrides: dict[str, ModelPricing] = {}
    for model, entry in (data.get("models") or {}).items():
        try:
            overrides[model] = ModelPricing(
                input_per_mtok=float(entry["input_per_mtok"]),
                output_per_mtok=float(entry["output_per_mtok"]),
            )
        except (KeyError, TypeError, ValueError):
            logger.warning("Bad pricing entry for %s in override file", model)
    return overrides, data.get("updated_on")


def get_pricing(model: str) -> ModelPricing | None:
    overrides, _ = _load_override()
    if model in overrides:
        return overrides[model]
    return _DEFAULT_PRICING.get(model)


def pricing_updated_on() -> str:
    _, override_date = _load_override()
    return override_date or PRICING_UPDATED_ON


def estimate_cost_usd(
    model: str, input_tokens: int, output_tokens: int
) -> float:
    """Return estimated USD cost. 0.0 if model pricing is unknown."""
    p = get_pricing(model)
    if p is None:
        return 0.0
    return (
        (input_tokens / 1_000_000) * p.input_per_mtok
        + (output_tokens / 1_000_000) * p.output_per_mtok
    )


def estimate_cost_micros(
    model: str, input_tokens: int, output_tokens: int
) -> int:
    """Integer micros (1e-6 USD) — the form we persist to Postgres."""
    return int(round(estimate_cost_usd(model, input_tokens, output_tokens) * 1_000_000))
