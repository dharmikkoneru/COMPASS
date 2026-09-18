-- ═════════════════════════════════════════════ self-verifying: run whole file
-- 0005 — fix apply_attempt: missing FROM-clause entry for table "per_tag" [42P01]
--
-- Second latent bug in the same function, unmasked once 0004 cleared the 42702.
-- In `insert ... on conflict do update set`, the SET expressions may reference
-- the target table (alias cm) and EXCLUDED — but NOT the source relation the
-- proposed rows came from. The update expressions referenced per_tag.q_correct
-- / per_tag.q_total, which are out of scope, so every submission failed with
-- 42P01.
--
-- The values are already in the proposed row: excluded.correct == per_tag.q_correct
-- and excluded.total == per_tag.q_total. This migration rewrites the expressions
-- against EXCLUDED (casting the cumulative sums to numeric so the ratio divides
-- as numeric, not integer division).
--
-- Safe to run any number of times.
--
-- Success: notice "apply_attempt replaced (0005)" and a one-row result showing
-- body_ok = true.
-- ═════════════════════════════════════════════════════════════════════════════

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
    -- SET expressions may reference the target (cm) and EXCLUDED only; the
    -- proposed values carry per_tag's numbers, so use excluded.* here.
    on conflict on constraint competency_mastery_pkey do update set
      mastery    = greatest(
                     0.6 * cm.mastery
                     + 0.4 * ((cm.correct + excluded.correct)::numeric
                              / (cm.total + excluded.total)) * 100,
                     0),
      attempts   = cm.attempts + 1,
      correct    = cm.correct + excluded.correct,
      total      = cm.total + excluded.total,
      updated_at = now()
    returning cm.competency_tag, cm.mastery, cm.attempts, cm.correct, cm.total
  )
  select * from upserted;
end;
$$;

-- ── Verification: the deployed body must actually use EXCLUDED ──────────────
do $$
declare
  v_body_ok boolean;
begin
  select exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'apply_attempt'
       and p.pronargs = 4
       and position('excluded.correct' in p.prosrc) > 0
       and position('excluded.total' in p.prosrc) > 0
       and position('per_tag.q_correct' in p.prosrc) < position('on conflict' in p.prosrc)
       and position('per_tag.q_total' in p.prosrc) < position('on conflict' in p.prosrc)
  ) into v_body_ok;

  if not v_body_ok then
    raise exception 'Migration 0005 did not take effect - apply_attempt is missing, has the wrong signature, or still references per_tag inside the ON CONFLICT clause.';
  end if;
  raise notice 'apply_attempt replaced (0005)';
end $$;

select n.nspname as schema,
       p.proname as function_name,
       p.pronargs as arg_count,
       (position('excluded.correct' in p.prosrc) > 0) as body_ok
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'apply_attempt';
