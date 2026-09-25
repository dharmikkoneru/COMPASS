-- 0013 — cognitive level per question (Recall / Application / Analysis)
--
-- The deck claims every question is tagged with its cognitive depth, and until
-- now questions carried only a competency tag plus easy/medium/hard. The level
-- is a different axis from difficulty: difficulty says how hard the material is
-- to recall, the level says what kind of thinking the question demands.
--
-- Why a CHECK rather than an enum type: adding a value to a PostgreSQL enum
-- cannot run inside a transaction block in older versions and needs a type
-- change we would rather not do under time pressure; a check constraint is one
-- `alter table`. The values match backend/app/quiz.py::COGNITIVE_LEVELS and the
-- edge function's list, and agents normalise case before writing.
--
-- Nullable on purpose. Every question generated before this migration has no
-- level, and inventing one here would be a guess written into the database —
-- the UI simply shows no chip for an untagged question, and the generators
-- require the field from here on.

alter table public.questions
  add column if not exists cognitive_level text;

do $$
begin
  -- Named explicitly so re-running this file is a no-op instead of an error.
  if not exists (
    select 1 from pg_constraint where conname = 'questions_cognitive_level_check'
  ) then
    alter table public.questions
      add constraint questions_cognitive_level_check
      check (cognitive_level is null or cognitive_level in ('Recall', 'Application', 'Analysis'));
  end if;
end $$;

comment on column public.questions.cognitive_level is
  'Bloom-style cognitive demand: Recall, Application or Analysis. Null for questions generated before 0013.';

-- Verification: the column and the constraint must both exist, and the write
-- path (0003's insert policy) is untouched by this migration.
do $$
declare
  col_type text;
  has_check boolean;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'questions'
    and column_name = 'cognitive_level';

  if col_type is null then
    raise exception '0013 did not create questions.cognitive_level';
  end if;

  select exists (
    select 1 from pg_constraint where conname = 'questions_cognitive_level_check'
  ) into has_check;

  if not has_check then
    raise exception '0013 did not create the cognitive_level check constraint';
  end if;

  raise notice '0013 applied: questions.cognitive_level is % and constrained to Recall/Application/Analysis.', col_type;
end $$;
