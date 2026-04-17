"""West Coast Swing video scoring via Gemini's File API.

Self-contained reimplementation of the relevant parts of the sibling
`wcs-analyzer` project, scoped to a single sync entry point that takes
raw video bytes and returns a structured WSDC score. We bundle the
logic here (rather than depending on wcs-analyzer as a package) so the
Railway image stays a single self-contained deploy.

Prompt structure, calibration anchors, uncertainty bounds, reasoning
fields, off-beat moment tracking, and the pattern pre-pass architecture
are all ported from wcs-analyzer's `prompts.py` + `gemini_analyzer.py`
to ensure scoring consistency with the canonical research tool.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from typing import Any

from google import genai
from google.genai import types as genai_types

from ..settings import settings


def _extract_beat_context(video_path: str) -> str | None:
    """Pull audio out of the video, run librosa beat tracking, and return a
    prompt-ready string. Gemini's native audio understanding is good, but
    giving it actual beat timestamps as context consistently tightens up
    timing judgments (the canonical wcs-analyzer behavior).

    Silent-fail on any error — this is a best-effort enrichment, not a
    blocker.
    """
    try:
        import librosa  # lazy import — heavy module

        wav_path = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    video_path,
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "22050",
                    wav_path,
                ],
                capture_output=True,
                check=True,
                timeout=60,
            )
            y, sr = librosa.load(wav_path, sr=22050, mono=True)
            tempo_raw, beat_times = librosa.beat.beat_track(
                y=y, sr=sr, units="time"
            )
            if beat_times is None or len(beat_times) < 4:
                return None
            bpm = (
                float(tempo_raw)
                if not hasattr(tempo_raw, "__iter__")
                else float(list(tempo_raw)[0])
            )
            # FULL beat timeline with phrase-1/5 markers. WCS clips
            # (especially blues and contemporary) often have tempo
            # shifts or breaks mid-song, so passing only the first
            # portion + relying on BPM extrapolation would miss real
            # timing drift. Cost is small — ~1000 tokens for a full
            # 2-min clip — vs. the accuracy gain from a grid that's
            # valid end-to-end.
            all_beats = beat_times.tolist()
            lines: list[str] = []
            for i, t in enumerate(all_beats):
                phrase_beat = (i % 8) + 1
                marker = ""
                if phrase_beat == 1:
                    marker = "  ← phrase start (beat 1)"
                elif phrase_beat == 5:
                    marker = "  ← anchor region (beats 5-6)"
                lines.append(f"  {t:6.2f}s  beat {phrase_beat}{marker}")
            grid = "\n".join(lines)
            total_beats = len(all_beats)
            # Flag tempo shifts: compute rolling inter-beat-interval
            # and note any windows where it deviates >15% from the
            # average. Gives the model an explicit heads-up instead
            # of forcing it to re-detect BPM shifts itself.
            shift_notes = ""
            if total_beats >= 16:
                ibis = [
                    all_beats[i + 1] - all_beats[i]
                    for i in range(total_beats - 1)
                ]
                avg_ibi = sum(ibis) / len(ibis)
                shifts: list[str] = []
                for i, ibi in enumerate(ibis):
                    if avg_ibi > 0 and abs(ibi - avg_ibi) / avg_ibi > 0.15:
                        shifts.append(
                            f"  near {all_beats[i]:.1f}s (ibi {ibi:.2f}s vs avg {avg_ibi:.2f}s)"
                        )
                if shifts:
                    shift_notes = (
                        "\n- Tempo shifts detected (interval deviates >15% from average):\n"
                        + "\n".join(shifts[:8])
                        + ("\n  …" if len(shifts) > 8 else "")
                    )
            return (
                "DETECTED MUSIC CONTEXT (from librosa beat tracking):\n"
                f"- Estimated average BPM: {bpm:.1f}\n"
                f"- Total beats detected: {total_beats}"
                f"{shift_notes}\n"
                "- Full beat grid (use this as the authoritative timeline):\n"
                f"{grid}\n\n"
                "Use this grid as a STRONG PRIOR. Every pattern boundary "
                "should snap to the nearest beat 1 (start) or beat 6 / "
                "beat 8 (end). A dancer's weight change within ~100ms "
                "of a detected beat counts as on-beat. Anchor steps "
                "should land near beats 5 and 6 of each 8-count phrase. "
                "Do NOT invent times between beats — align to the grid. "
                "When tempo shifts (see flagged regions), re-anchor to "
                "the actual beat timestamps rather than extrapolating.\n"
            )
        finally:
            try:
                os.unlink(wav_path)
            except OSError:
                pass
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────
# Prompts — ported from wcs-analyzer/src/wcs_analyzer/prompts.py
# ─────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert West Coast Swing (WCS) dance judge with decades of experience \
evaluating dancers at WSDC (World Swing Dance Council) competitions. You analyze \
dance videos and provide detailed, constructive feedback calibrated to the \
dancer's declared division.

═══════════════════════════════════════════════════════════════
CORE CATEGORIES — the four WSDC "Ts"
═══════════════════════════════════════════════════════════════

1. **Timing & Rhythm** (30% weight)
   - Dancing on beat with the music; anchor steps landing on 5 & 6
   - Triple-step articulation (three distinct weight changes, not "step-pause-step")
   - Syncopations, musical breaks, and pauses executed cleanly
   - Rhythm variations land back on the partnership's shared pulse

2. **Technique** (30% weight)
   - Posture: engaged core, neutral spine, no forward collapse
   - Footwork: heel-toe rolling through each step, not flat-footed clomping
   - Extension: reaching through the slot, stretch at the anchor
   - Anchor: clear triple settle at beats 5 & 6, weight back, "stretch" visible
   - Slot discipline; frame held with body not arms
   - Turn completion with balance (no post-turn wobble)

3. **Teamwork** (20% weight)
   - Lead/follow connection: shared weight, counter-balance, responsive to cues
   - Follower waits for the lead, doesn't guess or hijack
   - Lead offers patterns the follower can read; doesn't yank with biceps
   - Recovery from mismatch is clean (invisible to a non-judge eye at higher levels)

4. **Presentation** (20% weight)
   - Musicality: interpreting the music through the dance, not alongside it
   - Styling: body movement, isolations, arm styling, phrase-change awareness
   - Stage presence and confidence
   - Contrast and variety — purposeful tool choice, not just "many moves"

═══════════════════════════════════════════════════════════════
CRITICAL: CRITERIA ESCALATE BY DIVISION
═══════════════════════════════════════════════════════════════

WSDC uses the same four categories across divisions, but judges weight \
them differently by level. Lower divisions judge fundamentals only; \
higher divisions add criteria on top:

- Newcomer / Novice → Timing + Technique + Teamwork (the "3 Ts"). \
  Presentation is NOT officially graded.
- Intermediate → adds **Variety** (pattern / rhythm / body position variations)
- Advanced → adds **Contrast** (purposeful juxtaposition tied to the music — \
  slow vs. fast, small vs. big, smooth vs. sharp)
- All-Star → adds **Showmanship / Musicality** (macro + micro musicality, \
  audience projection, intentional affect)
- Champion → Connection + presence weighted **higher than flawlessness**. \
  A Champion couple with one mistake but full partnership outranks a \
  clean-but-disconnected Champion couple.

═══════════════════════════════════════════════════════════════
PER-DIVISION CALIBRATION — use the declared level from user context
═══════════════════════════════════════════════════════════════

**NEWCOMER (~2–4 typical):** Minimum bar is upright posture + on-beat stepping \
+ completed triples + stepping on the correct foot on count 1. Judges forgive \
slot drift, stiff frames, and missing musicality. Common kills: off-time \
stepping (instant DQ from finals consideration), incomplete triples, \
arm-leading, panic-styling. Don't penalize a Newcomer for lacking what isn't \
expected at this level.

**NOVICE (~3–5 typical):** Fundamentals clean under Jack-and-Jill pressure. \
Rolling feet, completed triples, engaged core, anchor as a recognizable \
triple in roughly 3rd foot position. Connection "visual + physical" — not \
staring past each other. Music: on the beat consistently, not just the first \
8-count. Scoring rule at Novice: Presentation/styling attempts are not \
expected and DO NOT ADD to the score when they appear. BUT: judges use \
Presentation/variety as a *finals tiebreaker* when multiple Novice couples \
are clean. So: score Novice Presentation in the 3–5 range even for flat \
performances; only elevate toward 5–6 when partnership conversation and \
micro-musicality (body pulse matching groove, small accents hit) are visibly \
present. Common kills: train-wreck partnering, dropped triples under \
pressure, follower hijacking, attempting dips/syncopations that fall apart.

**INTERMEDIATE (~4.5–7 typical):** Basics are assumed. Frame is elastic \
(compression AND stretch both functional). Anchor settles on 5 & 6 with \
visible stretch. Footwork variations (kick-balls, scoots, hold-replace) \
appear without breaking timing. Variety is officially graded — varied \
patterns, rhythm changes, body shapes. Common kills: repetitive pattern \
loops (sugar-push → left-side-pass → sugar-push = failing), variety attempts \
that break timing/partnership, "pantomiming" the music with arms, pushing \
showmanship past technical limits. Attempting Advanced-tier ideas and \
missing = net negative; attempting and landing = small positive only if \
fundamentals remain clean.

**ADVANCED (~6–8 typical):** Near-mastery — deliberate, intentional motion. \
Subtle movements read because precision is high. Acceleration/deceleration \
mirror musical nuance. Anchor length/rhythm vary purposefully. \
Contrast is officially graded — deliberate juxtaposition tied to \
musical structure, phrase changes hit cleanly. Common kills: abandoning \
partnership to pantomime the music (the signature Advanced failure), \
over-styling that costs the anchor, tricks for tricks' sake, inconsistent \
quality across tempos.

**ALL-STAR (~7–8.8 typical):** Technique assumed flawless. Body movement \
(isolations, body rolls, spine stretch) is itself graded. Anchor as a \
creative tool — different rhythms, lengths, shapes — while preserving \
partnership settle. Showmanship/musicality officially graded: audience \
awareness, projection, intentional affect, mood-matching across genres. \
Partnership co-creation — both dancers contribute musical ideas. Common \
kills: showmanship that sacrifices partnership, pantomiming song lyrics, \
champion-cosplay (attempting Champion ideas that don't land), inconsistent \
recoveries.

**CHAMPION (~8–10 typical):** Technique not the differentiator — assumed. \
Anchor is a creative space, not a step. Pacing control is the \
differentiator: when to ramp, when to pull back, when to under-play. \
Connection + presence weight **higher** than flawlessness. Champions \
reattach to the music after WCS's 6-beat-pattern phase drift in creative \
ways. Common kills: loss of partnership during showmanship, over-relying \
on signature tricks, energy drop after a mistake (vs. recovering through \
it), losing the slot during big body movement.

═══════════════════════════════════════════════════════════════
SCORING RULES
═══════════════════════════════════════════════════════════════

1. **Use the declared level** from USER-PROVIDED CONTEXT to calibrate. \
   The same execution should score differently for a Novice vs. a Champion \
   because the bar is different. When context is missing, assume Intermediate.

2. **Connection is a floor, not a co-equal criterion.** A couple weak on \
   partnership connection should cap below couples strong on connection, \
   even if the weak-connection couple has more variety or flashier moves. \
   This is especially true at Novice and Intermediate finals.

3. **Attempted-but-dropped rule** (asymmetric penalty):
   - At Novice: attempting above-division moves and missing is net \
     NEGATIVE. Landing them is NEUTRAL (judges explicitly weight at zero).
   - Intermediate and up: attempting + missing is net NEGATIVE; \
     attempting + landing is small POSITIVE only if fundamentals remain clean.

4. **Finals vs. prelims.** If USER-PROVIDED CONTEXT names `stage` as Finals, \
   Semis, Quarters, or Invitational, apply a stricter tiebreaker layer: \
   the next-division-up criterion (Variety for Novice finals, Contrast for \
   Intermediate finals, Musicality for Advanced finals) becomes a tiebreaker \
   — meaningful enough to separate 1st from 5th but never enough to overturn \
   weakness in the division's core criteria.

5. **If the video clearly shows a dancer at a different level than declared**, \
   score based on what you observe and explicitly say so in the reasoning. \
   A Champion-tier dancer who declared Novice should still be scored against \
   Champion expectations with a note that they're over-declared. A Novice \
   who declared Champion should be scored against Novice expectations with \
   a note that they're over-declared.

6. **Score scale 1–10:**
   - 1–3: Foundational issues (off-time, no frame, broken partnership)
   - 4–5: Basics present but inconsistent
   - 6–7: Solid with room for improvement
   - 8–9: Polished and consistent at division tier
   - 10: Exceptional, at-or-beyond division ceiling

═══════════════════════════════════════════════════════════════
OUTPUT DISCIPLINE
═══════════════════════════════════════════════════════════════

- Before every score, write a one-sentence `reasoning` walking through \
  the specific evidence you observed. The score follows the reasoning, \
  not the reverse.
- Return `score_low` and `score_high` for each category expressing your \
  uncertainty — the range you'd defend if pressed. Tight interval (e.g. \
  7.3–7.7) = confident; wide (e.g. 5.5–8.0) = obstructed view or \
  inconsistent dancing. Keep `score_low <= score <= score_high`, all 1–10.
- Be specific and constructive. Reference exact moments when possible.

IMPORTANT: If the video contains multiple couples or bystanders, focus \
ONLY on the specified dancers. Ignore all other people in the frame.\
"""


PATTERN_SEGMENTATION_PROMPT = """\
You are the pattern-identification pass for a West Coast Swing analysis \
pipeline. Your only job is to produce a beat-anchored timeline of patterns \
in this video — no scoring, no technique notes. Focus exclusively on \
WHICH pattern happens WHEN.

=== WCS PATTERNS — DETAILED REFERENCE ===

DO NOT default every ambiguous move to "sugar push" or "basic". Many WCS \
patterns share silhouettes but differ in rotation, entry, exit, and travel. \
Look for these specific cues:

**6-count pattern FAMILIES** (2 walks + 2 triples + anchor; ~3-5s):

- **Sugar push** (family) — follower walks TOWARD lead (beats 1-2),
  compression on 3&4 in place, follower walks back to anchor (5-6).
  NO travel, NO rotation, stays in the slot. Hands stay connected in a V.
  Variants to identify explicitly when present:
  - *basic* — plain execution, no styling or added turns
  - *with inside turn* — follower adds an inside turn on 3-4
  - *with tuck* / *sugar tuck* — compression into a tuck before push-off
  - *with hand change* — lead transfers from one hand to the other
- **Left side pass** / **Right side pass** — follower crosses to lead's
  respective side on 3-4, anchors at the opposite end of the slot.
  Variants:
  - *basic* — straight pass, no turn added
  - *with inside turn* — follower adds an inside turn during the pass
  - *with outside turn* — follower adds an outside (CCW) turn
- **Tuck turn** (family) — compact 1-turn on follower during 3-4.
  Variants: *basic*, *double tuck* (two spins), *open tuck* (catch with
  both hands open).
- **Underarm turn / Inside turn** — follower turns UNDER a raised hand
  during the pass (not at the catch).
- **Starter step / basic** — no travel, no rotation. Weight changes in
  place.

**8-count pattern FAMILIES** (3 walks + 3 triples + anchor; ~5-7s):

- **Whip** (family — has MANY variants, identify the specific one):
  - *basic* — standard 8-count whip, no modifications
  - *basket* — follower's hand held behind their back creating a
    "basket" shape; tighter frame
  - *reverse* — rotation goes the OPPOSITE direction; follower led
    backwards through the pattern
  - *apache* — lead's arm cradles follower's head/shoulder during
    rotation
  - *with inside turn* — whip + additional follower inside-turn during
    rotation (beats 5-6)
  - *with outside turn* — whip + follower outside-turn during rotation
  - *tandem* — lead and follower travel side-by-side through rotation
  - *cuddle* / *continuous* — follower stays close in a cuddle position
    through the whip
  - *shadow* — follower dances behind lead, same direction facing
  - *pretzel* — follower's arms wrap into a pretzel shape during
    rotation
- **Basic in closed / promenade** — closed-position walk variation.

=== VARIANT IDENTIFICATION ===

For each pattern, return BOTH:
1. `name` — the pattern family (e.g. "whip", "sugar push", "side pass")
2. `variant` — the specific sub-type (e.g. "basket", "reverse",
   "with inside turn"). Use "basic" when it's a plain execution of
   the family, or null if you can't commit to a specific variant.

Example: a clear basket whip → `{name: "whip", variant: "basket"}`.
A plain whip → `{name: "whip", variant: "basic"}`. A whip where you
see rotation but can't tell which kind → `{name: "whip", variant: null}`.

Prefer committing to a specific variant when distinguishing features
are visible. "basic" is valid when the family is clear but nothing
sets it apart. `null` is for genuine uncertainty — don't use it to
avoid thinking.

=== DISTINGUISHING RULES (when in doubt) ===

Prefer the MORE specific identification:
- Rotational movement ≥ 180° by follower → whip family, not sugar push
- Follower goes UNDER lead's arm → underarm / inside turn variant, not
  plain side pass
- Follower crosses lead's body laterally WITHOUT going under an arm →
  side pass (specify L or R based on which side of lead she ends up on)
- Two clear body-crossings with rotation → whip
- In-place with no travel → sugar push / starter / anchor-only
- 3 clear walks before the first triple → 8-count (whip family)
- 2 clear walks before the first triple → 6-count (sugar / pass / tuck)

If TRULY unclear, name it "unknown" with confidence <0.3 — do NOT
default-guess "sugar push" to avoid admitting uncertainty.

=== BEAT ALIGNMENT ===

The beat grid above is the ground truth for timing. Every pattern:
- MUST start within 100ms of a beat 1 (or beat 3 at the earliest)
- MUST end on beat 6 (6-count patterns) or beat 8 (8-count patterns)
- Do NOT invent timestamps between beats — snap to the grid

If two patterns look like they overlap, the boundary goes at the next
downbeat after the first pattern's anchor.

=== OUTPUT ===

Contiguous, non-overlapping timeline covering the whole video. JSON only,
no markdown, no prose:

{
  "patterns": [
    {"start_time": 0.00, "end_time": 2.67, "name": "starter step", "variant": "basic", "count": 6, "confidence": 0.9},
    {"start_time": 2.67, "end_time": 5.33, "name": "sugar push", "variant": "with inside turn", "count": 6, "confidence": 0.8},
    {"start_time": 5.33, "end_time": 8.89, "name": "whip", "variant": "basket", "count": 8, "confidence": 0.7}
  ]
}

Fields:
- start_time / end_time: decimal seconds, snapped to beat grid
- name: pattern family (e.g. "whip", "sugar push"), or "unknown"
- variant: specific sub-type (e.g. "basket", "reverse", "with inside
  turn"), "basic" for plain execution, or null for genuine uncertainty
- count: 6 or 8 (the WCS count structure)
- confidence: 0.0-1.0 (1.0 = certain, 0.5 = narrowed to family,
  <0.3 = unclear — use with "unknown")\
"""


GEMINI_VIDEO_PROMPT = """\
Watch and listen to this entire West Coast Swing dance video carefully. \
Pay attention to both the visual movement AND the music/audio to judge timing accuracy.

Analyze the full performance and provide a comprehensive evaluation. \
Since you can hear the music, evaluate whether the dancers are truly on beat — \
listen for anchors landing on the downbeat, triples matching the rhythm, \
and whether styling choices align with musical accents and breaks.

For `patterns_identified`, walk through the entire video chronologically and \
commit to a contiguous list of pattern windows that cover the dance from start \
to end. Every pattern the dancers execute must appear as its own entry — do \
NOT merge consecutive repeats of the same pattern into one window. If the \
couple performs three sugar pushes in a row, emit three separate entries. A \
typical WCS pattern is 6 or 8 beats, which at 90–130 BPM is roughly 3–6 \
seconds; windows longer than ~10 seconds almost always mean you collapsed \
repeats. A 90-second routine usually contains 15-25 pattern windows. \
Common WCS patterns: sugar push, left side pass, right side pass, tuck turn, \
whip (and variants: basket whip, reverse whip, apache whip), underarm turn, \
inside turn, free spin, starter step, basic in closed position, anchor step \
variations.

Respond in this exact JSON format. Fill `reasoning` BEFORE `score` in each category:
{
  "timing": {
    "reasoning": "<one sentence walking through what you heard and saw before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "on_beat": <true/false for overall>,
    "off_beat_moments": [
      {"timestamp_approx": "<time>", "description": "<what happened>", "beat_count": "<e.g., 3&4>"}
    ],
    "rhythm_consistency": "<assessment of timing throughout>",
    "notes": "<detailed timing observations referencing what you heard in the music>"
  },
  "technique": {
    "reasoning": "<one sentence weighing posture, extension, footwork, slot before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "posture": {"score": <1-10>, "notes": "<detail: frame alignment, core engagement, forward lean, head position, shoulder tension>"},
    "extension": {"score": <1-10>, "notes": "<detail: arm reach, body stretch through slot, line quality>"},
    "footwork": {"score": <1-10>, "notes": "<detail: heel leads, toe leads, rolling through feet, triple step clarity>"},
    "slot": {"score": <1-10>, "notes": "<detail: staying in the slot line, drifting, lane discipline>"},
    "notes": "<overall technique observations>"
  },
  "teamwork": {
    "reasoning": "<one sentence on connection, responsiveness, shared weight before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "connection": "<observations about lead/follow connection>",
    "notes": "<overall teamwork observations>"
  },
  "presentation": {
    "reasoning": "<one sentence on musicality, styling, stage presence before scoring>",
    "score": <1-10>,
    "score_low": <1-10>,
    "score_high": <1-10>,
    "musicality": "<observations — reference specific musical moments>",
    "styling": "<observations>",
    "notes": "<overall presentation observations>"
  },
  "patterns_identified": [
    {
      "name": "<pattern family — e.g. sugar push, left side pass, whip, tuck turn>",
      "variant": "<specific sub-type — e.g. 'basket', 'reverse', 'apache', 'with inside turn', 'with outside turn', 'sugar tuck'. Use 'basic' for plain execution. Use null only when you genuinely can't commit to a variant.>",
      "start_time": <seconds from video start, float>,
      "end_time": <seconds from video start, float>,
      "quality": "<strong|solid|needs_work|weak>",
      "timing": "<on_beat|slightly_off|off_beat>",
      "notes": "<what was good or needs improvement in this pattern>",
      "styling": "<brief description of styling observed during this pattern — body rolls, arm styling, footwork flourishes, musical hits, syncopations. Use null when nothing notable. DO NOT invent styling that wasn't there.>",
      "coaching_tip": "<one concrete, actionable suggestion specific to THIS pattern (e.g. 'stretch the anchor 2 extra beats to match the blues pocket', 'less arm on the lead into this whip — drive from the core'). Use null for patterns that execute cleanly and don't need targeted work.>"
    }
  ],
  "highlights": ["<notable positive moments with approximate timestamps>"],
  "improvements": ["<specific actionable suggestions>"],
  "lead": {
    "technique_score": <1-10>,
    "presentation_score": <1-10>,
    "notes": "<lead-specific observations>"
  },
  "follow": {
    "technique_score": <1-10>,
    "presentation_score": <1-10>,
    "notes": "<follow-specific observations>"
  },
  "overall_impression": "<1-2 sentence overall assessment>",
  "observed_level": "<one of: Newcomer|Novice|Intermediate|Advanced|All-Star|Champion — the tier the dancing actually lands at, regardless of what was declared. Fill this even when it matches the declared level; leave null only if truly uncertain.>",
  "estimated_bpm": <estimated BPM from the music>,
  "song_style": "<e.g., blues, contemporary, lyrical>"
}

Constraints on patterns_identified:
- Cover the full video end-to-end with non-overlapping contiguous time ranges, in chronological order.
- Each entry is ONE occurrence of ONE pattern — emit separate entries for repeated patterns.
- Windows should be 3–8 seconds typical, rarely longer than 10 seconds.
- For a 90-second clip expect 15–25 entries; scale proportionally for shorter/longer clips.
- If a segment is truly unclear, name it "unknown", keep it short (≤8s), and explain in notes.
- start_time and end_time are decimal seconds from the video start.
- Use the beat grid in the context (if provided) to anchor window boundaries near anchor steps (beats 5–6).
- `styling` and `coaching_tip`: populate when there's something real to say. Return null (not empty string) when a pattern is unremarkable — it's better to say nothing than to invent filler. These should feel like a coach's post-dance notes, not AI-generated text.

Only output valid JSON, no other text. Do not include // comments inside the JSON.\
"""


class VideoAnalysisError(Exception):
    pass


# ─────────────────────────────────────────────────────────────────────
# ffprobe
# ─────────────────────────────────────────────────────────────────────

def get_video_duration(path: str) -> float:
    """Return duration in seconds via `ffprobe`. Raises VideoAnalysisError."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        )
    except FileNotFoundError as exc:
        raise VideoAnalysisError("ffprobe not installed on the server") from exc
    except subprocess.CalledProcessError as exc:
        raise VideoAnalysisError(f"ffprobe failed: {exc.stderr.strip()}") from exc
    except subprocess.TimeoutExpired as exc:
        raise VideoAnalysisError("ffprobe timed out") from exc

    data = json.loads(result.stdout or "{}")
    try:
        return float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError) as exc:
        raise VideoAnalysisError("could not parse video duration") from exc


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
# Gemini call
# ─────────────────────────────────────────────────────────────────────

def _build_gen_config(
    model: str,
    *,
    system_prompt: str | None = None,
    thinking_level_override: str | None = None,
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
        # Pin the seed. Even at temperature=0.0, Gemini has GPU
        # non-determinism + thinking-token variance that produces
        # ±0.3 score drift between identical runs. A fixed seed
        # doesn't fully eliminate that (thinking and video sampling
        # are still non-deterministic) but meaningfully reduces it.
        "seed": 42,
    }
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


def _video_part_with_fps(uploaded: Any, fps: float = 2.0) -> genai_types.Part:
    """Wrap an uploaded Gemini File as a Part with explicit video
    sampling FPS. Default is 2 FPS — twice the temporal resolution
    of Gemini's ~1 FPS default, which matters for dance moves that
    happen on the & counts (roughly 2-3 FPS at typical WCS tempos).
    """
    return genai_types.Part(
        file_data=genai_types.FileData(
            file_uri=uploaded.uri,
            mime_type=getattr(uploaded, "mime_type", None) or "video/mp4",
        ),
        video_metadata=genai_types.VideoMetadata(fps=fps),
    )


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
) -> tuple[str, dict[str, Any]]:
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=_build_gen_config(
            model,
            system_prompt=system_prompt,
            thinking_level_override=thinking_level_override,
        ),
    )
    text = getattr(response, "text", None)
    if not text:
        raise VideoAnalysisError("Gemini returned an empty response")
    return text, _extract_usage(response, model)


# ─────────────────────────────────────────────────────────────────────
# Pattern pre-pass
# ─────────────────────────────────────────────────────────────────────

def _format_pattern_timeline(patterns: list[dict[str, Any]]) -> str:
    lines = ["DETECTED PATTERN TIMELINE (from a dedicated pattern pre-pass):"]
    for i, seg in enumerate(patterns, 1):
        start = float(seg.get("start_time") or 0.0)
        end = float(seg.get("end_time") or 0.0)
        name = seg.get("name", "unknown")
        conf = seg.get("confidence")
        conf_str = (
            f" (confidence {conf:.1f})"
            if isinstance(conf, (int, float))
            else ""
        )
        lines.append(f"  {i}. {start:.1f}s - {end:.1f}s: {name}{conf_str}")
    lines.append(
        "\nUse this timeline as a strong prior when filling "
        "`patterns_identified` in your response. You can add patterns the "
        "pre-pass missed or correct obvious errors, but default to "
        "trusting it."
    )
    return "\n".join(lines)


def _run_pattern_pre_pass(
    client: genai.Client,
    model: str,
    video_file: Any,
) -> tuple[str | None, dict[str, Any] | None]:
    """Single-purpose Gemini call asking ONLY about the pattern timeline.

    Per wcs-analyzer's docstring: "the per-pattern focus consistently
    outperforms asking the main prompt to enumerate patterns while also
    scoring the dance." Failures here are non-fatal — we fall back to
    the main prompt enumerating patterns inline.

    Returns (prompt_context, usage). Either may be None on failure.
    """
    try:
        # Pattern ID benefits disproportionately from extra reasoning
        # — this is where "sugar push vs whip vs tuck turn" gets
        # disambiguated. Using HIGH thinking here and keeping MEDIUM
        # on the main scoring call trades some pre-pass cost for
        # noticeably better pattern accuracy downstream. Also pass a
        # null system_prompt so SYSTEM_PROMPT's full judging rubric
        # doesn't bias this pure-ID pass.
        raw, usage = _call_gemini(
            client,
            model,
            contents=[video_file, PATTERN_SEGMENTATION_PROMPT],
            system_prompt=(
                "You are a WCS pattern identification specialist. "
                "Your only task is to produce a beat-anchored pattern "
                "timeline. Do not score, do not judge, do not comment "
                "on quality — just identify WHAT happens WHEN."
            ),
            thinking_level_override="high",
        )
    except VideoAnalysisError:
        return None, None
    data = _safe_parse_json(raw)
    if not data:
        return None, usage
    patterns = data.get("patterns")
    if not isinstance(patterns, list) or not patterns:
        return None, usage
    return _format_pattern_timeline(patterns), usage


# ─────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────

def _build_user_context(context: dict[str, Any] | None) -> str:
    """Turn the optional tag/role/level/event metadata from the
    upload form into a short context block for Gemini. Keeps the
    model grounded on what the user *says* they are (and is at),
    while still scoring against the objective WSDC rubric.

    Also includes a DANCER IDENTIFICATION paragraph when
    `dancer_description` is set — critical for practice-floor or
    social-dance clips where multiple couples share the frame.
    """
    if not context:
        return ""

    # Defensive cap in case the request body bypassed the pydantic
    # validator (older clients, direct REST hits, etc.). Matches the
    # max_length on VideoAnalyzeBody.dancer_description.
    dancer = (context.get("dancer_description") or "").strip()[:200]
    dancer_block = ""
    if dancer:
        dancer_block = (
            "DANCER IDENTIFICATION: "
            f"{dancer}\n"
            "Focus your analysis ONLY on these dancers. There may be "
            "other people visible in the video (other couples, "
            "spectators, judges, instructors) — ignore them entirely. "
            "Every pattern you identify, every score you give, and "
            "every observation you make must refer exclusively to the "
            "identified dancer(s). If you can't confidently tell which "
            "dancer matches the description at any given moment, say so "
            "in the reasoning rather than guessing.\n\n"
        )

    fields = []
    if context.get("role"):
        fields.append(f"- Role: {context['role']}")
    if context.get("competition_level"):
        fields.append(f"- Self-reported level: {context['competition_level']}")
    if context.get("event_name"):
        event_line = f"- Event: {context['event_name']}"
        if context.get("stage"):
            event_line += f" ({context['stage']})"
        fields.append(event_line)
    elif context.get("stage"):
        fields.append(f"- Stage: {context['stage']}")
    if context.get("event_date"):
        fields.append(f"- Event date: {context['event_date']}")
    if context.get("tags"):
        tags = context["tags"]
        if isinstance(tags, (list, tuple)) and tags:
            fields.append(f"- Tags: {', '.join(str(t) for t in tags)}")

    if not fields and not dancer_block:
        return ""

    context_block = ""
    if fields:
        context_block = (
            "USER-PROVIDED CONTEXT:\n"
            + "\n".join(fields)
            + "\n\nCalibrate your scoring against the self-reported level — "
            "a Novice scoring 6/10 is different from a Champion scoring 6/10, "
            "and your reasoning should reflect the dancer's stated tier. "
            "If the video clearly shows a dancer at a different level than "
            "what they self-report, score based on what you observe and say "
            "so in the reasoning. Use the event / stage info to decide how "
            "formal the scoring should feel (Finals on the floor vs. a "
            "practice social).\n"
        )

    # Dancer identification comes first so the model knows WHO to
    # score before anything about how to score them.
    return dancer_block + context_block


def _build_sanity_retry_prompt(
    issues: list[str], previous_raw: str
) -> str:
    """Construct a correction prompt for a second Gemini pass when
    the first response tripped sanity checks. We include the prior
    response so the model can patch it rather than start over.
    """
    issue_lines = "\n".join(f"- {i}" for i in issues)
    return (
        "SANITY CHECK FAILED on your previous response. "
        "The following issues were detected:\n"
        f"{issue_lines}\n\n"
        "Revise your response to fix these specific issues. "
        "Non-dance labels like 'intro', 'waiting', 'starter step', "
        "or 'unknown' should be 1-8 seconds — if one of yours is "
        "longer, what's actually happening in that span? Walking "
        "on, counting beats, and the first real pattern are "
        "different entries. Every pattern window should be 3-8 "
        "seconds — if yours is longer, it's a merge of repeats. "
        "Cover the full video with no gaps larger than ~8 seconds. "
        "Return the complete revised JSON in the same format as "
        "before.\n\n"
        f"YOUR PREVIOUS RESPONSE (for reference, do not copy blindly):\n"
        f"{previous_raw[:6000]}\n"
    )


def analyze_video_path(
    video_path: str,
    duration_sec: float | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Upload video → optional pattern pre-pass → WSDC scoring call → parse.

    Returns a dict shaped for the Swingflow frontend plus rich audit
    fields (reasoning, score_low/high, off_beat_moments, patterns).

    `context` is optional user-provided metadata (role, level, event,
    stage, tags) from the upload form. When present, it's prepended
    to the prompt so Gemini can calibrate scoring against the
    self-reported tier.

    `duration_sec` feeds the post-hoc sanity check (pattern density
    expectation + gap detection). When a sanity issue is found, we
    do ONE retry with the issues as corrective feedback. Retries
    cost one extra Gemini call (~$0.30 on 3.x Pro) but fix the
    "intro lasted 60s" class of hallucination without user intervention.
    """
    if not settings.gemini_api_key:
        raise VideoAnalysisError("GEMINI_API_KEY not configured")

    client = genai.Client(api_key=settings.gemini_api_key)
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

    # Aggregate token usage across pre-pass + main call so cost
    # tracking reflects the full billed spend for this analysis.
    total_prompt_tokens = 0
    total_response_tokens = 0

    sanity_warnings: list[str] = []

    # Wrap the uploaded video with an explicit fps=2 sampling hint.
    # Default Gemini sampling is ~1 FPS; doubling it catches the
    # "&" counts between beats (kick-ball-changes, quick anchor
    # settles) that 1 FPS routinely misses. Video token cost ~2x,
    # still bounded because we only upload short clips.
    video_part = _video_part_with_fps(uploaded, fps=2.0)

    try:
        prompt = GEMINI_VIDEO_PROMPT

        # User-provided metadata (level, role, event, stage, tags)
        # sits at the top of the prompt so Gemini calibrates against
        # the stated tier. Empty string when no context was supplied.
        user_context = _build_user_context(context)
        if user_context:
            prompt = f"{user_context}\n{prompt}"

        # Prepend librosa-derived beat context to ground timing judgments.
        beat_context = _extract_beat_context(video_path)
        if beat_context:
            prompt = f"{beat_context}\n\n{prompt}"

        if settings.enable_pattern_prepass:
            pre_pass_context, pre_pass_usage = _run_pattern_pre_pass(
                client, settings.gemini_model, video_part
            )
            if pre_pass_context:
                prompt = f"{pre_pass_context}\n\n{prompt}"
            if pre_pass_usage:
                total_prompt_tokens += int(pre_pass_usage.get("prompt_tokens", 0))
                total_response_tokens += int(pre_pass_usage.get("response_tokens", 0))

        raw, main_usage = _call_gemini(
            client, settings.gemini_model, contents=[video_part, prompt]
        )
        total_prompt_tokens += int(main_usage.get("prompt_tokens", 0))
        total_response_tokens += int(main_usage.get("response_tokens", 0))

        parsed = _safe_parse_json(raw)
        if parsed is None:
            raise VideoAnalysisError(
                f"Gemini returned unparseable JSON: {raw[:200]}"
            )

        # Sanity check: if the response has obvious implausibilities
        # (e.g. "intro lasted 60s" or only 2 patterns for a 2-minute
        # clip), do ONE corrective retry with the specific issues
        # fed back to the model. If the retry still has issues, we
        # accept it and surface the warnings in the response so the
        # frontend can display a "low confidence" badge.
        issues = _sanity_check(parsed, duration_sec)
        if issues:
            retry_prompt = _build_sanity_retry_prompt(issues, raw)
            try:
                retry_raw, retry_usage = _call_gemini(
                    client,
                    settings.gemini_model,
                    contents=[uploaded, retry_prompt],
                )
                total_prompt_tokens += int(retry_usage.get("prompt_tokens", 0))
                total_response_tokens += int(retry_usage.get("response_tokens", 0))
                retry_parsed = _safe_parse_json(retry_raw)
                if retry_parsed is not None:
                    # Only accept the retry if it's strictly better —
                    # otherwise keep the original + warnings.
                    retry_issues = _sanity_check(retry_parsed, duration_sec)
                    if len(retry_issues) < len(issues):
                        parsed = retry_parsed
                        sanity_warnings = retry_issues
                    else:
                        sanity_warnings = issues
                else:
                    sanity_warnings = issues
            except VideoAnalysisError:
                sanity_warnings = issues
    finally:
        # Best-effort cleanup of the Gemini-side file.
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass

    from .pricing import estimate_cost_micros, pricing_updated_on

    usage = {
        "model": settings.gemini_model,
        "prompt_tokens": total_prompt_tokens,
        "response_tokens": total_response_tokens,
        "total_tokens": total_prompt_tokens + total_response_tokens,
        "cost_usd_micros": estimate_cost_micros(
            settings.gemini_model, total_prompt_tokens, total_response_tokens
        ),
        "pricing_updated_on": pricing_updated_on(),
        "sanity_retry": bool(sanity_warnings),
    }

    return _shape_response(
        parsed, usage=usage, sanity_warnings=sanity_warnings
    )


def _sanitize_patterns(
    raw: list[Any] | None,
    *,
    max_window_sec: float = 12.0,
) -> list[dict[str, Any]]:
    """Clean Gemini's patterns_identified output.

    - Drops entries with missing/invalid times.
    - Splits any window longer than `max_window_sec` into ~6s chunks
      sharing the same metadata (prevents the "45s Sugar Push" bug
      even when the model slips past the prompt guidance).
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

    for p in patterns:
        raw_name = (p.get("name") or "").strip()
        if not raw_name:
            continue
        # Key on (family + variant) so "basket whip" and "reverse whip"
        # count as distinct patterns even though they share the "whip"
        # family. "basic" variant groups with null — both mean
        # "plain execution of the family".
        raw_variant = (p.get("variant") or "").strip().lower()
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
        n = (p.get("notes") or "").strip()
        if n and n not in notes[key]:
            notes[key].append(n)
        styling_val = (p.get("styling") or "").strip()
        if styling_val and styling_val not in stylings[key]:
            stylings[key].append(styling_val)
        tip_val = (p.get("coaching_tip") or "").strip()
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
) -> list[str]:
    """Return a human-readable list of implausibility issues in
    Gemini's response. Empty list = response looks reasonable.

    The goal is to catch "model hallucinated a 60s intro" or
    "claimed there's only 2 patterns in a 2-minute clip" before
    we persist the result. Callers should use the issue list as
    a correction prompt for a single retry.
    """
    issues: list[str] = []

    patterns = parsed.get("patterns_identified") or []
    if not isinstance(patterns, list):
        return ["patterns_identified is missing or not a list"]

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

    # 2. Not enough patterns for the video length. WCS runs at
    # roughly one pattern per 4-6 seconds, so a 90s clip should
    # have ~15-25 entries. Flag if we're under half that density.
    if duration_sec and duration_sec > 30:
        expected_min = max(5, int(duration_sec / 10))
        if len(patterns) < expected_min:
            issues.append(
                f"only {len(patterns)} patterns identified for "
                f"{int(duration_sec)}s of video — expected at least "
                f"{expected_min} based on typical WCS pattern density"
            )

    # 3. Large uncovered gaps in the timeline. If the model skipped
    # a 20-second stretch, it almost certainly missed patterns.
    MAX_GAP_SEC = 10.0
    timed = []
    for p in patterns:
        if not isinstance(p, dict):
            continue
        try:
            timed.append(
                (float(p.get("start_time")), float(p.get("end_time")))
            )
        except (TypeError, ValueError):
            continue
    timed.sort()
    prev_end = 0.0
    for start, end in timed:
        gap = start - prev_end
        if gap > MAX_GAP_SEC:
            issues.append(
                f"{gap:.0f}s gap between {prev_end:.0f}s and {start:.0f}s "
                "has no pattern labeled"
            )
        prev_end = max(prev_end, end)
    if duration_sec and duration_sec - prev_end > MAX_GAP_SEC:
        issues.append(
            f"last {duration_sec - prev_end:.0f}s of the video "
            "(from ~{prev:.0f}s onwards) has no pattern labeled".format(
                prev=prev_end
            )
        )

    return issues


def _shape_response(
    parsed: dict[str, Any],
    *,
    usage: dict[str, Any] | None = None,
    sanity_warnings: list[str] | None = None,
) -> dict[str, Any]:
    """Map Gemini's rich response into the API's return shape.

    Preserves rich audit fields (reasoning, score_low/high,
    off_beat_moments, sub-scores, patterns) while also providing the
    simplified fields the current frontend renders.
    """
    categories = {
        key: (parsed.get(key) or {}) if isinstance(parsed.get(key), dict) else {}
        for key in ("timing", "technique", "teamwork", "presentation")
    }
    overall_score = _compute_overall(categories)
    grade = _grade_letter(overall_score)
    max_interval = _max_interval(categories)
    # Flag a result as low-confidence when any category interval is wider
    # than 2 points — matches wcs-analyzer's scoring.py heuristic.
    confidence = "low" if max_interval > 2.0 else "high"

    strengths = parsed.get("highlights") or parsed.get("strengths") or []
    improvements = parsed.get("improvements") or []

    patterns_identified = _sanitize_patterns(parsed.get("patterns_identified"))
    pattern_summary = _summarize_patterns(patterns_identified)

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
        "strengths": strengths,
        "improvements": improvements,
        "lead": parsed.get("lead"),
        "follow": parsed.get("follow"),
        "estimated_bpm": parsed.get("estimated_bpm"),
        "song_style": parsed.get("song_style"),
        "observed_level": parsed.get("observed_level"),
        "sanity_warnings": sanity_warnings or [],
        "usage": usage,
    }


def analyze_video_bytes(
    video_bytes: bytes,
    filename: str = "video.mp4",
) -> tuple[dict[str, Any], float]:
    """Convenience wrapper: write → ffprobe → analyze → return (result, duration)."""
    suffix = os.path.splitext(filename)[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        duration = get_video_duration(tmp_path)
        result = analyze_video_path(tmp_path)
        return result, duration
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
