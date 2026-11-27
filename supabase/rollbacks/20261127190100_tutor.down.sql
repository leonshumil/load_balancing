-- Undo 20261127190100_tutor.sql. Run in the Supabase SQL editor, then:
--   delete from supabase_migrations.schema_migrations where version = '20261127190100';
-- `settings` is kept: step 07 stores the instructor key there too.
drop function if exists public.tutor_log_read(text, timestamptz);
drop function if exists public.tutor_take_turn(text, int, int);
drop table if exists public.tutor_log;
drop table if exists public.tutor_usage;
