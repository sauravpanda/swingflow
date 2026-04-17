-- SwingFlow Supabase schema
-- Paste into Supabase SQL Editor and run. Safe to re-run.

-- ────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id                          uuid primary key references auth.users(id) on delete cascade,
  email                       text,
  plan                        text not null default 'free' check (plan in ('free', 'basic')),
  stripe_customer_id          text unique,
  monthly_video_override      int,    -- per-user override; NULL = plan default
  max_video_seconds_override  int,    -- per-user override; NULL = plan default
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Migration: older versions used 'pro' as the paid tier name. Rename to
-- 'basic' if we're coming from that state. Idempotent and no-op on fresh.
do $$
begin
  update public.profiles set plan = 'basic' where plan = 'pro';
  if exists (
    select 1 from pg_constraint c
    join pg_class r on c.conrelid = r.oid
    where r.relname = 'profiles' and c.conname = 'profiles_plan_check'
      and pg_get_constraintdef(c.oid) like '%pro%'
  ) then
    alter table public.profiles drop constraint profiles_plan_check;
    alter table public.profiles add constraint profiles_plan_check
      check (plan in ('free', 'basic'));
  end if;
end $$;

create table if not exists public.subscriptions (
  id                     text primary key,
  user_id                uuid not null references public.profiles(id) on delete cascade,
  status                 text not null,
  price_id               text,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);

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
alter table public.subscriptions enable row level security;
alter table public.usage_events  enable row level security;

-- Profiles: user reads/updates own row. RLS scopes which ROWS
-- (their own); column-level GRANTs (below) restrict which COLUMNS
-- they can touch so they can't self-grant Basic plan or bump their
-- quota overrides. Service role bypasses RLS + GRANTs automatically.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);

-- Authenticated users may only update their own `email` column.
-- Everything else (plan, monthly_video_override, max_video_seconds_
-- override, stripe_customer_id) is service-role-only — those are
-- set by the backend when Stripe webhooks fire or when an admin
-- manually grants overrides via the service key.
revoke update on public.profiles from authenticated;
grant update (email) on public.profiles to authenticated;

-- Subscriptions: user reads own. Only service role writes (Stripe webhook).
drop policy if exists subscriptions_self_select on public.subscriptions;
create policy subscriptions_self_select on public.subscriptions
  for select using (auth.uid() = user_id);

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
    returning share_view_count into new_count;
  return coalesce(new_count, 0);
end;
$$;
