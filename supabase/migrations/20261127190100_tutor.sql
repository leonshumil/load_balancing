-- Step 11: tutor rate limits and log.
-- RLS on everywhere with no policies: tables are reachable only by the service role (the
-- edge function). Instructors read the log through tutor_log_read(p_key).
-- Rollback: supabase/rollbacks/20261127190100_tutor.down.sql

-- Per-session usage: 40 messages per session, at most one every 3 s (checked in tutor_take_turn).
create table if not exists public.tutor_usage (
  session_id text primary key,
  count      int not null default 0,
  last_at    timestamptz
);
alter table public.tutor_usage enable row level security;
revoke all on public.tutor_usage from anon, authenticated;

-- One row per tutor reply. Students are told the chat is saved (one line of notice in the UI).
create table if not exists public.tutor_log (
  id            bigint generated always as identity primary key,
  session_id    text not null,
  fork_id       text,
  message       text not null,
  reply         text not null,
  cites         text[] not null default '{}',
  detected_pick text,
  properties    text[] not null default '{}',
  ready_to_reveal boolean not null default false,
  fallback      boolean not null default false,  -- true when the model's output failed validation twice
  model         text,
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  created_at    timestamptz not null default now()
);
create index if not exists tutor_log_session_idx on public.tutor_log (session_id, created_at);
alter table public.tutor_log enable row level security;
revoke all on public.tutor_log from anon, authenticated;

-- Shared key/value settings (step 07 uses the same table for 'instructor_key').
create table if not exists public.settings (
  k text primary key,
  v text not null
);
alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;

-- Atomic rate-limit check and count. Returns 'ok', 'too_fast' or 'limit'.
-- Only a successful turn is counted, so a too-fast retry doesn't use up the 40.
create or replace function public.tutor_take_turn(p_session text, p_max int default 40, p_gap_ms int default 3000)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.tutor_usage;
begin
  insert into public.tutor_usage (session_id) values (p_session) on conflict (session_id) do nothing;
  select * into r from public.tutor_usage where session_id = p_session for update;
  if r.count >= p_max then
    return 'limit';
  end if;
  if r.last_at is not null and clock_timestamp() - r.last_at < make_interval(secs => p_gap_ms / 1000.0) then
    return 'too_fast';
  end if;
  update public.tutor_usage set count = count + 1, last_at = clock_timestamp() where session_id = p_session;
  return 'ok';
end;
$$;
revoke all on function public.tutor_take_turn(text, int, int) from public, anon, authenticated;
grant execute on function public.tutor_take_turn(text, int, int) to service_role;

-- Instructor read access: the whole log (or since a time), only with the instructor key
-- stored in settings ('instructor_key'). Callable with the publishable key.
create or replace function public.tutor_log_read(p_key text, p_since timestamptz default null)
returns setof public.tutor_log
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_key is null or not exists (select 1 from public.settings where k = 'instructor_key' and v = p_key) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select * from public.tutor_log
    where p_since is null or created_at >= p_since
    order by session_id, created_at;
end;
$$;
revoke all on function public.tutor_log_read(text, timestamptz) from public;
grant execute on function public.tutor_log_read(text, timestamptz) to anon, authenticated, service_role;
