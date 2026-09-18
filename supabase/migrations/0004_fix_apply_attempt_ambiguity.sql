-- ═════════════════════════════════════════════ self-verifying: run whole file
-- 0004 — fix apply_attempt: ambiguous column "competency_tag" [42702]
--
-- The function declares `returns table (competency_tag text, ...)` — in PL/pgSQL,
-- those output columns are *variables*, and they shadow same-named table columns
-- inside the body. The `on conflict (user_id, competency_tag)` target then names a
-- column the parser can't resolve, so every submission failed with 42702.
--
-- Latent since 0001, invisible until now: quiz generation was broken first, so no
-- attempt ever reached the RPC.
--
-- The fix: `on conflict on constraint competency_mastery_pkey` — the PK constraint
-- 0001 created inline as `primary key (user_id, competency_tag)`, auto-named
-- `<table>_pkey`. A named constraint target contains no column references at all,
-- so nothing can shadow it. The guard below refuses to proceed if the live
-- database names that PK differently.
--
-- Safe to run any number of times.
--
-- Success: notice "apply_attempt replaced (0004)" and a one-row result naming
-- public.apply_attempt with 4 arguments.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 0. Guard: the named PK constraint must exist and be the real PK ──────────
do $$
declare
  v_contype "char";
begin
  select c.contype into v_contype
    from pg_constraint c
   where c.conrelid = 'public.competency_mastery'::regclass
     and c.conname  = 'competency_mastery_pkey';

  if v_contype is null then
    -- NB: RAISE's message must be a single string literal; no '||' concatenation.
    raise exception
      'No constraint "competency_mastery_pkey" on public.competency_mastery. Find the real PK name (select conname from pg_constraint where conrelid = ''public.competency_mastery''::regclass and contype = ''p''), substitute it for competency_mastery_pkey in the ON CONFLICT clause below, then re-run.';
  end if;
  if v_contype <> 'p' then
    raise exception '"competency_mastery_pkey" exists but is not the primary key (contype=%).', v_contype;
  end if;
end $$;

-- ── 1. Replace the function ──────────────────────────────────────────────────
create or replace function public.apply_attempt(
  p_quiz_id uuid,
  p_answers jsonb,
  p_score   int,
  p_total   int
)
returns table (
  competency_tag text,
  mastery        numeric,
  attempts       int,
  correct        int,
  total          int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.attempts (quiz_id, user_id, answers, score, total)
  values (p_quiz_id, v_user, p_answers, p_score, p_total);

  return query
  with per_tag as (
    select
      q.competency_tag,
      count(*)::int as q_total,
      sum(case when (p_answers ->> (q.idx)::text)::int = q.correct_idx
               then 1 else 0 end)::int as q_correct
    from public.questions q
    where q.quiz_id = p_quiz_id
    group by q.competency_tag
  ),
  upserted as (
    insert into public.competency_mastery as cm
      (user_id, competency_tag, mastery, attempts, correct, total, updated_at)
    select
      v_user,
      per_tag.competency_tag,
      greatest(0.4 * (per_tag.q_correct::numeric / per_tag.q_total) * 100, 0),
      1,
      per_tag.q_correct,
      per_tag.q_total,
      now()
    from per_tag
    -- Named-constraint target: no column references, nothing for the
    -- returns-table variables to shadow.
    on conflict on constraint competency_mastery_pkey do update set
      mastery    = greatest(
                     0.6 * cm.mastery
                     + 0.4 * ((cm.correct + per_tag.q_correct::numeric)
                              / (cm.total + per_tag.q_total)) * 100,
                     0),
      attempts   = cm.attempts + 1,
      correct    = cm.correct + per_tag.q_correct,
      total      = cm.total + per_tag.q_total,
      updated_at = now()
    returning cm.competency_tag, cm.mastery, cm.attempts, cm.correct, cm.total
  )
  select * from upserted;
end;
$$;

-- ── 2. Verification: refuse to look successful if the fix didn't land ───────
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'apply_attempt'
       and p.pronargs = 4
  ) then
    raise exception 'Migration 0004 did not take effect - apply_attempt is missing or has the wrong signature.';
  end if;
  raise notice 'apply_attempt replaced (0004)';
end $$;

select n.nspname as schema, p.proname as function_name, p.pronargs as arg_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'apply_attempt';
