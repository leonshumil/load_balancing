-- Undo 20261127210000_tutor_grants.sql. Run in the Supabase SQL editor, then:
--   delete from supabase_migrations.schema_migrations where version = '20261127210000';
revoke select, insert, update, delete on public.paper_chunks from service_role;
revoke insert on public.tutor_log from service_role;
