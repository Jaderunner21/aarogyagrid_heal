-- =====================================================================
-- AarogyaGrid — 03_reset.sql
-- Wipes ALL app tables/functions so you can re-run 01_schema.sql + 02_seed.sql
-- (e.g. right before recording the demo, so the synthetic history ends "yesterday").
-- Auth users are kept; run `npm run demo-users` afterwards
-- to recreate their profiles.
-- =====================================================================
drop schema public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on all tables    in schema public to postgres, anon, authenticated, service_role;
grant all on all functions in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
