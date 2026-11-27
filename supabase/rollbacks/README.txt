Rollback SQL for each migration, by the same timestamp.
These live outside supabase/migrations/ on purpose: the Supabase CLI applies every
migrations/<digits>_<name>.sql file, so a .down.sql there would run right after its migration.
