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

-- Profiles: user reads/updates own row. Service role bypasses RLS automatically.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);

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
  share_token       text,            -- NULL = not shared; set = public read via /shared?t=<token>
  -- Cost / usage tracking (admin-only, never exposed to user UI).
  model             text,
  prompt_tokens     integer,
  response_tokens   integer,
  cost_usd_micros   integer,
  created_at        timestamptz not null default now()
);

-- Migration: add cost columns to pre-existing rows. Idempotent.
alter table public.video_analyses
  add column if not exists model           text,
  add column if not exists prompt_tokens   integer,
  add column if not exists response_tokens integer,
  add column if not exists cost_usd_micros integer;
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

create or replace view public.current_month_usage as
  select
    user_id,
    kind,
    count(*)::int as used_count
  from public.usage_events
  where created_at >= date_trunc('month', now())
  group by user_id, kind;


-- ────────────────────────────────────────────────────────────
-- Admin stats RPC — aggregates user counts, recent activity, and
-- Gemini spend for the admin dashboard. Keep in sync with
-- api/src/wcs_api/routes/admin.py and the frontend admin page.
-- ────────────────────────────────────────────────────────────

create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'signups_this_month', (
      select count(*) from public.profiles
      where created_at >= date_trunc('month', now())
    ),
    'signups_this_week', (
      select count(*) from public.profiles
      where created_at > now() - interval '7 days'
    ),
    'total_video_analyses', (select count(*) from public.video_analyses),
    'total_music_analyses', (
      select count(*) from public.usage_events where kind = 'music'
    ),
    'active_users_7d', (
      select count(distinct user_id) from public.usage_events
      where created_at > now() - interval '7 days'
    ),
    'active_users_30d', (
      select count(distinct user_id) from public.usage_events
      where created_at > now() - interval '30 days'
    ),
    'total_feature_requests', (select count(*) from public.feature_requests),
    -- Gemini spend totals (admin-only — never surfaced to end users).
    -- Stored as integer micros (1e-6 USD) so Postgres sum() stays exact;
    -- we convert to USD here so the frontend doesn't have to divide.
    'cost_total_usd', (
      select round(coalesce(sum(cost_usd_micros), 0)::numeric / 1000000, 4)
      from public.usage_events where kind = 'video'
    ),
    'cost_last_7d_usd', (
      select round(coalesce(sum(cost_usd_micros), 0)::numeric / 1000000, 4)
      from public.usage_events
      where kind = 'video' and created_at > now() - interval '7 days'
    ),
    'cost_last_30d_usd', (
      select round(coalesce(sum(cost_usd_micros), 0)::numeric / 1000000, 4)
      from public.usage_events
      where kind = 'video' and created_at > now() - interval '30 days'
    ),
    'total_tokens', (
      select coalesce(sum(prompt_tokens), 0) + coalesce(sum(response_tokens), 0)
      from public.usage_events where kind = 'video'
    ),
    'recent_signups', (
      select coalesce(jsonb_agg(row_json order by created_at desc), '[]'::jsonb)
      from (
        select
          id,
          email,
          plan,
          created_at,
          jsonb_build_object(
            'id', id,
            'email', email,
            'plan', plan,
            'created_at', created_at
          ) as row_json
        from public.profiles
        order by created_at desc
        limit 10
      ) s
    ),
    'recent_analyses', (
      select coalesce(jsonb_agg(row_json order by created_at desc), '[]'::jsonb)
      from (
        select
          va.id,
          va.created_at,
          jsonb_build_object(
            'id', va.id,
            'filename', va.filename,
            'duration', va.duration,
            'email', p.email,
            'model', va.model,
            'cost_usd', round(coalesce(va.cost_usd_micros, 0)::numeric / 1000000, 4),
            'created_at', va.created_at
          ) as row_json
        from public.video_analyses va
        left join public.profiles p on p.id = va.user_id
        order by va.created_at desc
        limit 20
      ) a
    ),
    'recent_feature_requests', (
      select coalesce(jsonb_agg(row_json order by created_at desc), '[]'::jsonb)
      from (
        select
          fr.id,
          fr.created_at,
          jsonb_build_object(
            'id', fr.id,
            'title', fr.title,
            'description', fr.description,
            'email', coalesce(p.email, fr.email),
            'created_at', fr.created_at
          ) as row_json
        from public.feature_requests fr
        left join public.profiles p on p.id = fr.user_id
        order by fr.created_at desc
        limit 20
      ) f
    )
  ) into result;
  return result;
end;
$$;

-- admin_stats() is called via PostgREST RPC with the service-role key
-- from our FastAPI admin route. Email-based gating happens in the
-- FastAPI layer, not in SQL, so the function itself is callable by
-- anyone with the service key.
