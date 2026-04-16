from fastapi import APIRouter, Header, HTTPException, status

from ..services import supabase_admin

router = APIRouter(prefix="/shared", tags=["shared"])


def _is_real_browser_navigation(
    sec_fetch_mode: str | None,
    sec_fetch_dest: str | None,
    user_agent: str | None,
) -> bool:
    """Detect real browser page loads vs. link-preview bots.

    Slack / iMessage / Twitter / Discord / Facebook all fire GETs
    against shared URLs to unfurl an OpenGraph preview. They don't
    send `Sec-Fetch-Mode: navigate` (the header browsers attach to
    real page loads) and many have telltale user agents.

    Frontend fetches from our own SPA also send Sec-Fetch-Mode=cors
    (not navigate), so we actually count a view when the *frontend*
    page successfully loads the analysis — which we proxy via a
    custom header the frontend sends, `X-Swingflow-View: 1`. See
    `src/app/shared/page.tsx`.

    Kept intentionally loose: false negatives (undercounting) are
    preferable to false positives (inflated numbers from every Slack
    channel the owner posted in).
    """
    ua = (user_agent or "").lower()
    bot_markers = (
        "bot",
        "crawler",
        "spider",
        "slackbot",
        "twitterbot",
        "facebookexternalhit",
        "discordbot",
        "whatsapp",
        "telegrambot",
        "linkedinbot",
        "preview",
    )
    if any(m in ua for m in bot_markers):
        return False
    # Browsers set `Sec-Fetch-Mode: navigate` on top-level page loads
    # and `cors` on fetch() calls. We accept either, since our frontend
    # fetches this endpoint via fetch() after the page mounts.
    mode = (sec_fetch_mode or "").lower()
    return mode in ("navigate", "cors", "")


@router.get("/{token}")
async def get_shared(
    token: str,
    sec_fetch_mode: str | None = Header(default=None, alias="Sec-Fetch-Mode"),
    sec_fetch_dest: str | None = Header(default=None, alias="Sec-Fetch-Dest"),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    swingflow_view: str | None = Header(default=None, alias="X-Swingflow-View"),
) -> dict:
    """Public endpoint — no JWT required. Returns a video analysis row
    keyed by its share_token, restricted to the public-safe field set
    (no user_id, no object_key). The client generates a random token
    when the user clicks Share, so the 'knowledge of the token' acts
    as the access control.

    Side effect: when called with the frontend's `X-Swingflow-View: 1`
    header (or a real navigate fetch that isn't a known bot), the
    share_view_count on the row is atomically incremented and
    share_last_viewed_at is updated. Bot / link-preview requests
    don't count.
    """
    if not token or len(token) < 16:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid share token",
        )
    analysis = await supabase_admin.get_shared_analysis(token)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="shared analysis not found or no longer shared",
        )

    # Count as a view when the frontend explicitly opts in or the
    # request looks like a real browser. Failures are swallowed
    # inside `increment_share_view` so the public page never fails
    # because the counter hiccuped.
    is_frontend_view = swingflow_view == "1"
    if is_frontend_view or _is_real_browser_navigation(
        sec_fetch_mode, sec_fetch_dest, user_agent
    ):
        new_count = await supabase_admin.increment_share_view(token)
        # Reflect the new count back in the response so the owner
        # (if they're the one viewing) doesn't see stale data.
        if new_count > 0:
            analysis["share_view_count"] = new_count

    return analysis
