# swingflow — agent guide

Codebase: Next.js (web, `src/`) + FastAPI (`api/`) WCS dance video analyzer.
Deploys: Cloudflare Workers Builds (frontend, auto on `main` push) + Railway
(API, manual `railway up --detach --ci` from `api/`).

## House rules

### Role-neutral language

WCS roles (Lead, Follow) are not gender-bound. A female-lead user complained
after the analyzer emitted gendered prose. Anywhere the model reads OR writes
text — prompts, schema examples, UI copy — use:

- `L` / `F` (and possessive `L's` / `F's`) for the dancers,
- "the lead" / "the follow" for prose flow,
- `they` / `their` when the role is genuinely ambiguous.

Never `he` / `she` / `him` / `her` / `his` / `hers` / `man's` / `woman's` /
`ladies` / `gentlemen`. Pattern names: prefer `lead's turn` over `man's turn`.

The single source of prompts (`api/src/wcs_api/services/video_analysis/prompts.py`)
has a comment block at the top restating this; the rest of the codebase has
been swept clean.
