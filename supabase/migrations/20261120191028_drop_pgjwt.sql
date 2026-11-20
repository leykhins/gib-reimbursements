-- pgjwt was installed by default on older Supabase projects and nothing uses
-- it (checked 2026-11-20: no dependent functions, views, policies, defaults,
-- cron jobs, edge functions, or app code in this repo or gibclaim).
-- It blocks the Postgres upgrade. No cascade, so this fails if anything
-- turns out to depend on it.
drop extension if exists pgjwt;
