-- Step 11 fix: the service role (the edge function, tools/load-chunks.mjs) needs table
-- privileges. New Supabase projects don't grant them on new public tables by default, so
-- 20261127190000/190100 left service_role with "permission denied". anon and authenticated
-- still get nothing. tutor_usage and settings are only used through security-definer functions.
-- Rollback: supabase/rollbacks/20261127210000_tutor_grants.down.sql

grant select, insert, update, delete on public.paper_chunks to service_role;
grant insert on public.tutor_log to service_role;
