# SwingFlow

AI-powered West Coast Swing practice companion. Upload a dance video and get WSDC-style scoring. Upload a song and see every anchor. Train your rhythm with song-synced visualization.

## Features

### Dance Video Analysis
Upload a WCS dance clip to get structured feedback from a WSDC-calibrated model (Gemini 3 Pro):

- Overall 1–10 score + A+…F letter grade
- Four-category breakdown (Timing 30%, Technique 30%, Teamwork 20%, Presentation 20%) with one-sentence reasoning and confidence intervals
- Pattern timeline with per-pattern start/end times, quality tier, and timing assessment — click a pattern to jump the video player to that moment
- Off-beat moment detection with timestamps
- Technique sub-scores (posture, extension, footwork, slot)
- Lead/follow sub-scores and notes
- Strengths and actionable improvements
- Librosa beat-context injection into the prompt so timing judgments are grounded in actual detected beats

Videos upload directly to Cloudflare R2 via presigned URLs (bypasses the API proxy, supports up to 500 MB clips). R2 objects are deleted immediately after scoring — only the structured result persists in the user's history.

### Cloud Music Analysis
Upload any MP3/WAV/M4A to get `librosa`-accurate BPM, downbeat timestamps, 8-count phrase grouping, and WCS anchor positions (beats 5–6 of each phrase). The Rhythm Trainer visualizes phrases live-synced to audio playback.

### Rhythm Trainer
Web Audio-powered metronome with adjustable BPM (60-140), straight and swung feel modes, and multiple practice modes:
- **Listen** — count along to the metronome
- **Tap** — click along to the beat
- **Challenge** — target specific subdivisions (walks, triples, anchors)

Includes WCS pattern presets, tempo ramp for progressive difficulty, timing accuracy visualization, and accuracy heatmaps. When a song is loaded and analyzed, a song-synced phrase grid highlights where each anchor falls.

### Practice Timer
Guided warm-up routines in 5, 15, or 30-minute sessions. Covers joint mobility, body isolation, walking practice, triple step drills, anchor variations, and pattern work.

### Accounts & Plan Tiers
- **Free** — 2 video analyses / month, 2-minute clips, unlimited music analysis
- **Basic ($10/mo)** — 10 video analyses / month, 5-minute clips, unlimited music analysis
- Per-user quota overrides on the `profiles` table for beta testers and refunds
- Google-auth-free: email + password via Supabase Auth

### Feedback
- In-app feedback form writes to a `feature_requests` table (RLS-protected)

## Multi-Dance Support — Roadmap

SwingFlow is WCS-first today. Expanding to other partner dances (Lindy Hop, Salsa, Bachata, Tango, Ballroom, Hustle, Zouk) is technically straightforward but requires dance-specific scoring quality work. Three staged levels:

### Level 1 — Multi-style via Gemini's general knowledge (≈1–2 hours)
Cheapest possible ship. Works for casual hobbyists across a long tail of styles.

**What needs to change:**
- [ ] Schema: `alter table video_analyses add column dance_style text`
- [ ] Frontend: dropdown on the upload form (WCS / Lindy Hop / Salsa / Bachata / Tango / Ballroom / Hustle / Zouk / Other) in `src/app/(app)/analyze/page.tsx`
- [ ] Frontend: `VideoAnalyzeOptions` gains `danceStyle`; `wcs-api.ts` passes it in the `/analyze/video` body
- [ ] Backend: `VideoAnalyzeBody` accepts `dance_style`; `insert_video_analysis` persists it
- [ ] Backend: `video_analyzer.py` conditionally prepends a style-context paragraph to the Gemini prompt when the style is not WCS:
  > "This video should be scored as a [LEAD/FOLLOW] [STYLE] performance. Apply conventions of [STYLE] — its typical patterns, timing structure, connection style, and stylistic norms — when judging."
- [ ] Landing page + `/analyze` upload form disclaimers: "WCS is our flagship; other styles are beta quality"
- [ ] `TimelineView` + `ScoreResultCard` unchanged (the JSON shape doesn't change)

**What you lose:** Gemini's calibration on non-WCS styles is vaguer, so scores cluster in the 6–7 range and feel generic. Anchors, patterns, and rubric language stay WCS-themed in the prompt's calibration examples.

**What you gain:** dance-agnostic coverage with <1 day of engineering.

### Level 2 — Per-style rubric modules (1–2 weeks per style)
Ship only for styles with traction after Level 1.

**Per style (Salsa, Bachata, Lindy Hop first if those top the list):**
- [ ] A style-specific `SYSTEM_PROMPT` with novice/intermediate/champion calibration examples, authored or reviewed by a qualified instructor in that style
- [ ] Style-specific pattern vocabulary for the pre-pass + main scoring prompts:
  - Salsa: cross-body lead, right turn, copa, 360 lead turn, hammerlock, enchufla
  - Bachata: basic, side-to-side, hammerlock, sensual body waves, dips
  - Lindy Hop: swing-out, Charleston kicks, lindy circle, sugar push (different from WCS), lindy flip
  - Tango: ochos, sacadas, ganchos, boleos, molinete
- [ ] Style-specific scoring weights (ballroom weighs Presentation ≈ 35%, not 20%; competitive Latin emphasizes Technique)
- [ ] Style-specific beat structure (WCS 8-count + anchors on 5–6; Salsa 8-count with breaks on 1 or 5; Bachata 4-count; Waltz 3-count) — feeds into any timeline/phrase UI
- [ ] `dance_style` router in the backend picks the right module at analyze time
- [ ] Per-style `/analyze` result copy ("Your anchor timing" vs "Your break timing")

**Cost:** each module needs ~4 hours of a paying instructor's calibration time. Budget for this — don't prompt-engineer a Bachata rubric alone if you don't dance Bachata.

### Level 3 — Native style support (2–3 months per style)
Only if a style becomes a significant share of revenue.

**Per style:**
- [ ] Dedicated Rhythm Trainer: beat grid matched to the style's count structure, correct break/anchor highlighting, correct tempo range defaults
- [ ] Pattern library with step-by-step mechanics, common mistakes, and technique checklists in the style's own vocabulary
- [ ] Competition-level tiers (WSDC vs NDCA vs WDSF vs community judging bodies)
- [ ] Visual references (gifs, reference videos) per pattern
- [ ] Translated rubric language if the style has a strong non-English community

This is where "SwingFlow but for Bachata" would actually compete with a dedicated Bachata app.

### Positioning question (not a code task)
"SwingFlow" is a swing-specific brand. Three strategic options:

1. **Keep WCS as flagship, others as beta** — honest, no rebrand, WCS community stays primary
2. **Spin off sub-brands** — SwingFlow (WCS) + SalsaFlow + TangoFlow under a parent — bigger brand investment, better differentiation per style
3. **Stay WCS, go deep** — ignore this roadmap entirely, own the niche, double down on WSDC-specific features

**Decision should be driven by Level 1 analytics.** Ship Level 1 first, watch what styles users actually upload, then choose a direction with real data instead of guessing.

## Tech Stack

**Frontend** (`/`)
- Next.js 16 (App Router, static export) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui + Radix UI
- Web Audio API for the metronome + rhythm trainer
- `@supabase/supabase-js` v2 for auth + per-user DB reads (RLS-protected)
- Cloudflare Pages for static hosting

**Backend** (`api/`)
- FastAPI + Uvicorn on Python 3.11
- Gemini 3 Pro (video scoring) via `google-genai`
- `librosa` (beat + downbeat + phrase detection)
- `ffmpeg` (duration probe + audio extraction for beat context)
- `boto3` (R2 presigned URLs + post-analysis cleanup)
- PyJWT against Supabase's JWKS (ES256) for request auth
- `httpx` for Supabase service-role REST calls
- Stripe SDK for billing (Checkout Sessions, Customer Portal, webhook)
- Deployed to Railway from `api/Dockerfile`

**Storage**
- **Supabase Postgres** — user profiles, subscriptions, usage events, video analysis results, feature requests (all RLS-protected; backend uses the service-role key for quota/analysis writes that need to bypass RLS)
- **Cloudflare R2** — video uploads (presigned PUT, auto-deleted post-analysis, 24h lifecycle rule as backstop)

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+ (if running the API locally)
- `ffmpeg` installed on PATH (for API video/audio processing)
- Supabase project (free tier works)
- Cloudflare R2 bucket + API token
- Google AI Studio API key (Gemini)
- Stripe account (test mode for development)

### Frontend

```bash
git clone https://github.com/sauravpanda/swingflow.git
cd swingflow
npm install
cp .env.local.example .env.local   # fill in Supabase + API URL
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Backend

```bash
cd api
uv venv --python 3.11
uv pip install -e .
cp .env.example .env   # fill in Supabase, R2, Stripe, Gemini creds
.venv/bin/uvicorn wcs_api.main:app --reload --port 8080
```

### Build

```bash
npm run build
```

Frontend deploys to Cloudflare Pages (static export via `wrangler.toml`). Backend deploys to Railway via `api/railway.json` / `api/Dockerfile`.

## Project Structure

```
swingflow/
├── api/                         # Python FastAPI service (Railway)
│   ├── src/wcs_api/
│   │   ├── main.py              # FastAPI app, CORS, router wiring
│   │   ├── auth.py              # JWKS (ES256) + HS256 fallback token verification
│   │   ├── settings.py          # pydantic-settings — all env vars
│   │   ├── routes/
│   │   │   ├── health.py
│   │   │   ├── music.py         # POST /analyze/music (librosa)
│   │   │   ├── video.py         # POST /analyze/video (Gemini)
│   │   │   ├── uploads.py       # presign / view / delete R2
│   │   │   └── billing.py       # Stripe checkout / portal / webhook
│   │   └── services/
│   │       ├── video_analyzer.py   # Gemini prompt + parser + beat context
│   │       ├── music_analyzer.py   # librosa pipeline
│   │       ├── r2.py               # boto3 wrapper for Cloudflare R2
│   │       ├── billing.py          # Stripe helpers
│   │       ├── quota.py            # per-user + plan-based quota
│   │       └── supabase_admin.py   # service-role REST client
│   ├── Dockerfile
│   └── railway.json
├── supabase/
│   └── schema.sql               # Tables + RLS policies
└── src/
    ├── app/                     # Next.js App Router
    │   ├── (app)/               # auth-gated routes (dashboard, analyze, etc.)
    │   ├── (auth)/              # login page
    │   └── page.tsx             # landing page
    ├── components/
    │   ├── ui/                  # shadcn/ui primitives
    │   ├── analyze/             # TimelineView
    │   ├── auth/                # RequireAuth
    │   └── rhythm/              # beat grid, music player, phrase grid
    ├── hooks/                   # useUser, useProfile, useVideoAnalysis, etc.
    ├── lib/
    │   ├── supabase.ts
    │   └── wcs-api.ts           # typed fetch client for the FastAPI service
    └── data/                    # Pattern JSON datasets
```

## Deployment

- **Frontend** → Cloudflare Pages (static export from `out/`)
- **Backend** → Railway (`api/` root directory, Dockerfile builder)
- **Database + Auth** → Supabase
- **Object storage** → Cloudflare R2

CI/CD is git-integration based on both Cloudflare and Railway — push to `main` to deploy.

## Contributing

Contributions welcome. Open issues or PRs at [github.com/sauravpanda/swingflow](https://github.com/sauravpanda/swingflow).

## Author

Created by [Saurav Panda](https://github.com/sauravpanda).

## License

MIT License. See [LICENSE](LICENSE) for details.
