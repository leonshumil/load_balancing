-- Step 11: paper chunks for the tutor (CONGA, SIGCOMM 2014), loaded by tools/load-chunks.mjs.
-- RLS on and no policies: only the service role (the edge function, the loader) can read or write.
-- Rollback: supabase/rollbacks/20261127190000_paper_chunks.down.sql

create table if not exists public.paper_chunks (
  id         text primary key,            -- "2.4-p2"
  section    text not null,               -- "2.4"
  page       int  not null,               -- page in the PDF
  text       text not null,
  figures    int[] not null default '{}', -- hand-transcribed figures in this chunk
  updated_at timestamptz not null default now()
);

alter table public.paper_chunks enable row level security;
revoke all on public.paper_chunks from anon, authenticated;
