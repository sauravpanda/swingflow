-- SwingFlow Supabase schema
-- Paste into Supabase SQL Editor and run. Safe to re-run.

-- ────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id                          uuid primary key references auth.users(id) on delete cascade,
  email                       text,
  monthly_video_override      int,    -- per-user override; NULL = global default
  max_video_seconds_override  int,    -- per-user override; NULL = global default
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Migration: drop Stripe / plan columns from older schemas. Everyone
-- is on the same free allowance now; per-user credits live on the
-- override columns. Idempotent.
do $$
begin
  if exists (
    select 1 from pg_constraint c
    join pg_class r on c.conrelid = r.oid
    where r.relname = 'profiles' and c.conname = 'profiles_plan_check'
  ) then
    alter table public.profiles drop constraint profiles_plan_check;
  end if;
end $$;
alter table public.profiles drop column if exists plan;
alter table public.profiles drop column if exists stripe_customer_id;

-- Drop the subscriptions table entirely — no paid users ever existed,
-- Stripe integration is removed. Safe to cascade because nothing
-- references it anymore.
drop table if exists public.subscriptions cascade;

create table if not exists public.usage_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('video', 'music')),
  duration_sec    integer,
  job_id          text,
  -- Cost tracking (video analyses only — music path is on-device and free).
  -- Cost is stored as integer micros (1 micro = 1e-6 USD) to avoid float drift
  -- in sum() / avg() queries.
  model           text,
  prompt_tokens   integer,
  response_tokens integer,
  cost_usd_micros integer,
  created_at      timestamptz not null default now()
);
create index if not exists usage_events_user_month_idx
  on public.usage_events(user_id, created_at desc);

-- Migration: add cost columns to pre-existing usage_events. No-op on fresh.
alter table public.usage_events
  add column if not exists model           text,
  add column if not exists prompt_tokens   integer,
  add column if not exists response_tokens integer,
  add column if not exists cost_usd_micros integer;

-- ────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────

alter table public.profiles      enable row level security;
alter table public.usage_events  enable row level security;

-- Profiles: user reads/updates own row. RLS scopes which ROWS
-- (their own); column-level GRANTs (below) restrict which COLUMNS
-- they can touch so they can't self-grant extra quota. Service role
-- bypasses RLS + GRANTs automatically.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);

-- Authenticated users may only update their own `email` column.
-- The override columns (monthly_video_override,
-- max_video_seconds_override) are service-role-only — admins grant
-- extra credits manually via the service key.
revoke update on public.profiles from authenticated;
grant update (email) on public.profiles to authenticated;

-- Usage events: user reads own. Only service role writes (quota enforcement).
drop policy if exists usage_events_self_select on public.usage_events;
create policy usage_events_self_select on public.usage_events
  for select using (auth.uid() = user_id);

create table if not exists public.video_analyses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  filename          text,
  duration          float,
  result            jsonb not null,
  object_key        text,            -- R2 key while the source video is still in storage; NULL once deleted
  role              text,            -- optional: lead / follow / solo
  competition_level text,            -- optional: novice / intermediate / all-star / champion
  event_name        text,            -- optional: "Boogie by the Bay"
  event_date        date,            -- optional: when the event happened (separate from created_at)
  stage             text,            -- optional: prelims / quarters / semis / finals
  tags              text[] default '{}',  -- optional free-form user tags
  -- When there's more than one couple in frame, the user can
  -- describe which dancer(s) we should focus on (e.g. "couple in
  -- the red dress and blue shirt", "the lead on the far right").
  -- Prepended to the Gemini prompt as a DANCER IDENTIFICATION block.
  dancer_description text,
  share_token       text,            -- NULL = not shared; set = public read via /shared?t=<token>
  -- Cost / usage tracking (admin-only, never exposed to user UI).
  model             text,
  prompt_tokens     integer,
  response_tokens   integer,
  cost_usd_micros   integer,
  -- Soft-delete: analyze list filters these out; dashboard score
  -- trend chart still shows them for historical progress.
  deleted_at        timestamptz,
  -- Share-link view counter — see migration block below for details.
  share_view_count      integer not null default 0,
  share_last_viewed_at  timestamptz,
  created_at        timestamptz not null default now()
);

-- Migration: add cost columns to pre-existing rows. Idempotent.
alter table public.video_analyses
  add column if not exists model                 text,
  add column if not exists prompt_tokens         integer,
  add column if not exists response_tokens       integer,
  add column if not exists cost_usd_micros       integer,
  -- Soft-delete: the analyze list filters these out, but the
  -- dashboard score trend chart still shows them so users can see
  -- their historical progress even after cleaning up old clips.
  add column if not exists deleted_at            timestamptz,
  -- Share-link view tracking: incremented by the /shared/{token}
  -- backend route on real browser navigations (Sec-Fetch-Mode:
  -- navigate) so Slack/iMessage/Twitter link-preview unfurls don't
  -- inflate the count.
  add column if not exists share_view_count      integer not null default 0,
  add column if not exists share_last_viewed_at  timestamptz,
  -- Free-text identifier used to focus scoring on a specific
  -- dancer/couple when the video has multiple people in frame.
  add column if not exists dancer_description    text;

create index if not exists video_analyses_user_active_idx
  on public.video_analyses(user_id, created_at desc)
  where deleted_at is null;
create unique index if not exists video_analyses_share_token_idx
  on public.video_analyses(share_token)
  where share_token is not null;
create index if not exists video_analyses_user_idx
  on public.video_analyses(user_id, created_at desc);

alter table public.video_analyses enable row level security;

drop policy if exists video_analyses_self_select on public.video_analyses;
create policy video_analyses_self_select on public.video_analyses
  for select using (auth.uid() = user_id);

drop policy if exists video_analyses_self_update on public.video_analyses;
create policy video_analyses_self_update on public.video_analyses
  for update using (auth.uid() = user_id);

drop policy if exists video_analyses_self_delete on public.video_analyses;
create policy video_analyses_self_delete on public.video_analyses
  for delete using (auth.uid() = user_id);

-- Authenticated users can update only the fields they have business
-- editing: share_token (Share / Stop sharing), deleted_at (soft-delete
-- from the list), filename + optional metadata (tags / role / event /
-- level / stage / dancer_description). Everything score-related —
-- result, duration, model, token counts, cost_usd_micros, share_view_
-- count, share_last_viewed_at — is service-role-only so users can't
-- tamper with their own scores or inflate view counts.
revoke update on public.video_analyses from authenticated;
grant update (
  share_token,
  deleted_at,
  filename,
  role,
  competition_level,
  event_name,
  event_date,
  stage,
  tags,
  dancer_description
) on public.video_analyses to authenticated;

-- ────────────────────────────────────────────────────────────
-- Peer reviews
-- ────────────────────────────────────────────────────────────
--
-- A dancer clicks "Ask someone to review" on their analysis page.
-- We mint a one-time token, the dancer shares the link however they
-- like (DM / text / email), the reviewer opens /review/<token>,
-- watches the video, and submits a structured score. Reviewer
-- doesn't need an account. Token is single-use: once submitted_at
-- is set, subsequent fetches render the thank-you state instead of
-- the form.
create table if not exists public.peer_reviews (
  id                    uuid primary key default gen_random_uuid(),
  analysis_id           uuid not null references public.video_analyses(id) on delete cascade,
  token                 text not null unique,      -- opaque; in the /review/<token> URL
  requester_user_id     uuid not null references public.profiles(id) on delete cascade,
  requested_at          timestamptz not null default now(),

  -- Reviewer-supplied metadata (nullable until submit)
  reviewer_name         text,
  reviewer_role         text check (
    reviewer_role is null
    or reviewer_role in ('dancer', 'instructor', 'judge', 'friend', 'other')
  ),

  -- Scores (nullable until submitted). 1-10 with one decimal.
  timing_score          numeric(3,1) check (timing_score is null or (timing_score >= 0 and timing_score <= 10)),
  technique_score       numeric(3,1) check (technique_score is null or (technique_score >= 0 and technique_score <= 10)),
  teamwork_score        numeric(3,1) check (teamwork_score is null or (teamwork_score >= 0 and teamwork_score <= 10)),
  presentation_score    numeric(3,1) check (presentation_score is null or (presentation_score >= 0 and presentation_score <= 10)),

  overall_notes         text,
  -- Per-moment notes as JSON array of {timestamp_sec: number, note: string}
  per_moment_notes      jsonb not null default '[]'::jsonb,

  -- Training-data consent. We ask the reviewer explicitly on the
  -- submit form whether we can use their score + notes to improve
  -- the AI. Default false — nothing training-usable unless the
  -- reviewer actively checks the box.
  training_consent      boolean not null default false,
  consent_given_at      timestamptz,

  -- Frozen snapshot of the AI analysis result as it stood at the
  -- time this review was submitted. Necessary for training because
  -- the owner can re-analyze the same video later and mutate
  -- `video_analyses.result` — without a snapshot the human score
  -- and AI score could desync, ruining the training pair.
  ai_result_snapshot    jsonb,

  submitted_at          timestamptz,
  created_at            timestamptz not null default now()
);

-- Migration: add training-data columns to pre-existing rows. Idempotent.
alter table public.peer_reviews
  add column if not exists training_consent   boolean not null default false,
  add column if not exists consent_given_at   timestamptz,
  add column if not exists ai_result_snapshot jsonb;

create index if not exists peer_reviews_analysis_id_idx
  on public.peer_reviews(analysis_id);
create index if not exists peer_reviews_requester_idx
  on public.peer_reviews(requester_user_id, created_at desc);
-- Partial index to make 'give me every training-usable row' cheap.
-- Only submitted + consented rows count as training data, and that's
-- what a calibration/fine-tune export always filters on.
create index if not exists peer_reviews_training_idx
  on public.peer_reviews(submitted_at desc)
  where submitted_at is not null and training_consent = true;

alter table public.peer_reviews enable row level security;

-- Owner (requester) can read + delete their own review requests.
-- Writes (insert to request, update to submit) always go through the
-- service role — the reviewer is unauthenticated, and the requester
-- shouldn't be writing scores on behalf of reviewers.
drop policy if exists peer_reviews_owner_select on public.peer_reviews;
create policy peer_reviews_owner_select on public.peer_reviews
  for select using (auth.uid() = requester_user_id);

drop policy if exists peer_reviews_owner_delete on public.peer_reviews;
create policy peer_reviews_owner_delete on public.peer_reviews
  for delete using (auth.uid() = requester_user_id);

revoke insert, update on public.peer_reviews from authenticated;


create table if not exists public.feature_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  email       text,
  title       text not null,
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists feature_requests_created_idx
  on public.feature_requests(created_at desc);

alter table public.feature_requests enable row level security;

drop policy if exists feature_requests_self_insert on public.feature_requests;
create policy feature_requests_self_insert on public.feature_requests
  for insert with check (auth.uid() = user_id);

drop policy if exists feature_requests_self_select on public.feature_requests;
create policy feature_requests_self_select on public.feature_requests
  for select using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- Auto-create profile row when a new auth.users row appears
-- ────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────
-- Current-month usage view (calendar month reset)
-- ────────────────────────────────────────────────────────────

-- security_invoker=on makes the view run as the CALLER, not the view
-- owner — so the underlying usage_events RLS scoping (user sees only
-- their own rows) is enforced when the Supabase JS client queries the
-- view. Without this, views default to security_invoker=off and
-- bypass RLS, leaking other users' usage counts.
create or replace view public.current_month_usage
  with (security_invoker = on)
as
  select
    user_id,
    kind,
    count(*)::int as used_count
  from public.usage_events
  where created_at >= date_trunc('month', now())
  group by user_id, kind;


-- ────────────────────────────────────────────────────────────
-- Share-link view counter RPC — atomic increment.
-- Called by the FastAPI /shared/{token} route on real browser
-- navigations (filtered by Sec-Fetch-Mode upstream). Returns the
-- new count so the route can include it in observability logs.
-- ────────────────────────────────────────────────────────────

create or replace function public.increment_share_view(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  update public.video_analyses
    set share_view_count     = coalesce(share_view_count, 0) + 1,
        share_last_viewed_at = now()
    where share_token = p_token
      and deleted_at is null
    returning share_view_count into new_count;
  return coalesce(new_count, 0);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- Atomic video-quota reservation (fixes #72)
--
-- The previous flow was check-then-charge: the route counted
-- usage_events, ran Gemini, then inserted the usage row. Concurrent
-- requests from the same user could both see "remaining >= 1" and
-- both proceed, overspending quota. If the post-Gemini INSERT
-- failed, the completed analysis was charged to no one.
--
-- Fix: reserve a quota slot atomically BEFORE Gemini runs. Returns
-- the reservation id (the usage_events.id) or NULL when over limit.
-- The caller finalizes on success (fills in duration/usage) or
-- releases on failure (deletes the reservation).
--
-- Serialization is via a per-user transaction-scope advisory lock,
-- so different users don't block each other but one user's
-- concurrent requests wait in line. The lock auto-releases on
-- COMMIT/ROLLBACK — no explicit unlock needed.
-- ────────────────────────────────────────────────────────────

create or replace function public.claim_video_quota(
  p_user uuid,
  p_limit integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_id uuid;
  v_month_start timestamptz;
begin
  -- Per-user xact lock. hashtextextended gives a well-distributed
  -- bigint keyed on the user_id so two concurrent requests for the
  -- same user serialize; two different users don't.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  v_month_start := date_trunc('month', (now() at time zone 'UTC'));

  select count(*) into v_used
  from public.usage_events
  where user_id = p_user
    and kind = 'video'
    and created_at >= v_month_start;

  if v_used >= p_limit then
    return null;
  end if;

  -- Insert a placeholder reservation row. It already counts toward
  -- this month's usage, so a concurrent claim immediately after
  -- sees the updated count. Duration/usage fields are filled by
  -- finalize_video_quota when Gemini completes.
  insert into public.usage_events (user_id, kind)
  values (p_user, 'video')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.finalize_video_quota(
  p_id uuid,
  p_duration_sec integer,
  p_job_id text,
  p_model text,
  p_prompt_tokens integer,
  p_response_tokens integer,
  p_cost_usd_micros integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usage_events
    set duration_sec    = p_duration_sec,
        job_id          = p_job_id,
        model           = p_model,
        prompt_tokens   = p_prompt_tokens,
        response_tokens = p_response_tokens,
        cost_usd_micros = p_cost_usd_micros
    where id = p_id;
end;
$$;

create or replace function public.release_video_quota(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.usage_events where id = p_id;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- Pattern labels (#142) — user-authored ground truth
--
-- Lets users correct the AI's pattern identifications via the /label
-- tab. Each row is one time-ranged pattern assignment on an analysis
-- the user owns. Exported as JSON for the grading harness (#139) and
-- eventually for fine-tuning a better model.
--
-- RLS is strict: a user can only read/write labels on analyses they
-- own. We don't check video_analyses.user_id in RLS (that'd require a
-- join); instead we trust the pattern_labels.user_id column and let
-- the insert-time check (matching auth.uid()) pin ownership.
-- ────────────────────────────────────────────────────────────

create table if not exists public.pattern_labels (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.video_analyses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_time numeric(8,3) not null,
  end_time numeric(8,3) not null,
  name text not null,
  variant text,
  count int,
  confidence numeric(3,2),
  -- source: 'user' (from scratch), 'ai_accepted' (user clicked accept
  -- on an AI block, no edits), 'ai_edited' (user started from an AI
  -- block and changed something). Distinguishes labels that represent
  -- fresh user judgment from ones that are AI inheritance.
  source text not null default 'user' check (source in ('user','ai_accepted','ai_edited')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pattern_labels_time_order check (end_time > start_time)
);

create index if not exists pattern_labels_analysis_idx
  on public.pattern_labels(analysis_id, start_time);

create index if not exists pattern_labels_user_idx
  on public.pattern_labels(user_id);

alter table public.pattern_labels enable row level security;

drop policy if exists pattern_labels_select_own on public.pattern_labels;
create policy pattern_labels_select_own on public.pattern_labels
  for select using (auth.uid() = user_id);

drop policy if exists pattern_labels_insert_own on public.pattern_labels;
create policy pattern_labels_insert_own on public.pattern_labels
  for insert with check (auth.uid() = user_id);

drop policy if exists pattern_labels_update_own on public.pattern_labels;
create policy pattern_labels_update_own on public.pattern_labels
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists pattern_labels_delete_own on public.pattern_labels;
create policy pattern_labels_delete_own on public.pattern_labels
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.pattern_labels to authenticated;

-- Keep updated_at fresh automatically.
create or replace function public.pattern_labels_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pattern_labels_touch_updated_at on public.pattern_labels;
create trigger pattern_labels_touch_updated_at
  before update on public.pattern_labels
  for each row execute function public.pattern_labels_touch_updated_at();
