from __future__ import annotations

import json
import time
from typing import Any

from google import genai
from google.genai import types as genai_types

from .prompts import SYSTEM_PROMPT


class VideoAnalysisError(Exception):
    pass


# ─────────────────────────────────────────────────────────────────────
# JSON parsing helpers
# ─────────────────────────────────────────────────────────────────────

def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines)


def _safe_parse_json(text: str) -> dict[str, Any] | None:
    cleaned = _strip_code_fence(text).strip()

    # Happy path
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    # Tolerant fallback: try to extract the first complete top-level JSON
    # object by depth-counting braces. Handles trailing garbage, markdown
    # fragments, or partial truncation past a valid object.
    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(cleaned)):
        ch = cleaned[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(cleaned[start : i + 1])
                    return parsed if isinstance(parsed, dict) else None
                except json.JSONDecodeError:
                    return None
    return None


# ─────────────────────────────────────────────────────────────────────
# Gemini call
# ─────────────────────────────────────────────────────────────────────

def _build_gen_config(
    model: str,
    *,
    system_prompt: str | None = None,
    thinking_level_override: str | None = None,
    seed: int | None = 42,
) -> genai_types.GenerateContentConfig:
    config_kwargs: dict[str, Any] = {
        "system_instruction": system_prompt or SYSTEM_PROMPT,
        # Rich schema (reasoning + sub-scores + off-beat moments +
        # patterns + lead/follow) produces long outputs. 8192 was
        # truncating mid-JSON on real dance videos with many events.
        "max_output_tokens": 32768,
        "temperature": 0.0,
        "response_mime_type": "application/json",
        # HIGH media resolution (~768 tokens/frame) vs the default
        # MEDIUM (~256). For dance analysis this is the difference
        # between "I can see there are dancers" and "I can see heel-
        # toe rolling and a collapsed anchor." wcs-analyzer uses
        # HIGH by default and it's critical for technique scoring.
        "media_resolution": genai_types.MediaResolution.MEDIA_RESOLUTION_HIGH,
    }
    # Pin the seed by default. Even at temperature=0.0, Gemini has
    # GPU non-determinism + thinking-token variance that produces
    # ±0.3 score drift between identical runs. A fixed seed doesn't
    # fully eliminate that (thinking and video sampling are still
    # non-deterministic) but meaningfully reduces it.
    #
    # Callers can pass seed=None to opt out — used on Re-analyze so
    # a second run doesn't return the exact same result (which
    # confuses users who expect a re-run to "try harder").
    if seed is not None:
        config_kwargs["seed"] = seed
    # Extended thinking. The SDK accepts a ThinkingConfig on both
    # Gemini 3.x and 2.5 models, but the fields differ:
    #   - Gemini 3.x: thinking_level ("low"|"medium"|"high")
    #   - Gemini 2.5: thinking_budget (int token budget; -1 = auto)
    # We use MEDIUM on 3.x — HIGH is the biggest source of
    # analysis-to-analysis variance (thinking explores different
    # paths each run). Medium trades some peak scoring quality for
    # a lot of consistency, which matters more for a user-facing
    # score than the upper ~5% of reasoning depth.
    if "gemini-3" in model:
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                thinking_level=(thinking_level_override or "medium"),  # type: ignore[arg-type]
            )
        except (TypeError, AttributeError):
            pass
    elif "gemini-2.5" in model:
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                thinking_budget=-1,  # auto — let 2.5 decide how much to think
            )
        except (TypeError, AttributeError):
            pass
    return genai_types.GenerateContentConfig(**config_kwargs)


def _extract_usage(response: Any, model: str) -> dict[str, Any]:
    """Pull token counts from a Gemini response's usage_metadata.

    Returns a dict with prompt_tokens, response_tokens, total_tokens,
    model. Thinking tokens are folded into response_tokens so cost
    reflects actual billed spend. Safe to call on any response — fields
    default to 0 when missing.
    """
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return {
            "prompt_tokens": 0,
            "response_tokens": 0,
            "total_tokens": 0,
            "model": model,
        }
    prompt = int(getattr(meta, "prompt_token_count", 0) or 0)
    candidates = int(getattr(meta, "candidates_token_count", 0) or 0)
    thinking = int(getattr(meta, "thoughts_token_count", 0) or 0)
    response_tokens = candidates + thinking
    return {
        "prompt_tokens": prompt,
        "response_tokens": response_tokens,
        "total_tokens": prompt + response_tokens,
        "model": model,
    }


def _call_gemini(
    client: genai.Client,
    model: str,
    contents: list,
    *,
    system_prompt: str | None = None,
    thinking_level_override: str | None = None,
    seed: int | None = 42,
) -> tuple[str, dict[str, Any]]:
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=_build_gen_config(
            model,
            system_prompt=system_prompt,
            thinking_level_override=thinking_level_override,
            seed=seed,
        ),
    )
    text = getattr(response, "text", None)
    if not text:
        raise VideoAnalysisError("Gemini returned an empty response")
    return text, _extract_usage(response, model)


def _upload_video_file(client: genai.Client, video_path: str) -> Any:
    uploaded = client.files.upload(file=video_path)

    # Poll until the file is ACTIVE on Gemini's side.
    deadline = time.time() + 120
    while uploaded.state and uploaded.state.name == "PROCESSING":
        if time.time() > deadline:
            raise VideoAnalysisError("Gemini file processing timed out")
        time.sleep(1.5)
        uploaded = client.files.get(name=uploaded.name)

    if not uploaded.state or uploaded.state.name != "ACTIVE":
        state_name = uploaded.state.name if uploaded.state else "UNKNOWN"
        raise VideoAnalysisError(f"Gemini file upload state: {state_name}")

    return uploaded


def _delete_uploaded_file(client: genai.Client, uploaded: Any) -> None:
    try:
        client.files.delete(name=uploaded.name)
    except Exception:
        pass
