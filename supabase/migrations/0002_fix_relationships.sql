-- ═══════════════════════════════════════════════════════════════
-- COMPASS Platform — SIH26101 (MoSPI) — migration 0002
-- Repairs two constraints that 0001 shipped without.
--
-- Both surfaced as HTTP 400s in the running app:
--
--   1. competency_mastery.user_id referenced auth.users, which gives
--      PostgREST no relationship to public.profiles. The admin heatmap
--      reads `profiles!inner(full_name, department)` and failed with
--      "Could not find a relationship between 'competency_mastery' and
--      'profiles' in the schema cache".
--      profiles.id already cascades from auth.users.id, so pointing the
--      FK at profiles keeps the cascade intact *and* gives PostgREST the
--      join it needs.
--
--   2. recommendations had no unique key on (user_id, course_id), so the
--      adapter's upsert(..., { onConflict: 'user_id,course_id' }) was
--      rejected with SQLSTATE 42P10 — "there is no unique or exclusion
--      constraint matching the ON CONFLICT specification" — which aborted
--      the whole iGOT recommendations page.
--
-- Safe to run against a database that already has 0001 applied.
-- Safe to run twice.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. competency_mastery → profiles relationship ─────────────
-- Drop the old auth.users FK (Postgres auto-named it for us) and
-- re-point it at profiles.
alter table public.competency_mastery
  drop constraint if exists competency_mastery_user_id_fkey;

alter table public.competency_mastery
  add constraint competency_mastery_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ── 2. unique key backing the recommendations upsert ──────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard it explicitly:
-- a plain `add constraint` aborts with 42710 on the second run, which
-- contradicted this file's "safe to run twice" promise. 0001 also creates
-- the key inline, so on a fresh install it already exists and this is a
-- no-op.
do $$ begin
  alter table public.recommendations
    add constraint recommendations_user_course_key unique (user_id, course_id);
exception
  when duplicate_object then null;  -- 42710: the constraint is already there
  when duplicate_table then null;   -- 42P07: only an index of that name exists
  when unique_violation then
    raise exception
      'Duplicate (user_id, course_id) rows in public.recommendations — de-duplicate them, then re-run this migration';
end $$;

-- PostgREST caches the schema per instance; ask it to pick up the new
-- relationship immediately instead of waiting for the next reload.
notify pgrst, 'reload schema';
