-- ═════════════════════════════════════════════ self-verifying: run whole file
-- 0012 — apply_attempt: weight the CURRENT attempt, not the lifetime average
--
-- The bug (reported as "the competency map doesn't update after a test"):
--   mastery moved, but by 0.2–4.0 points — and one axis rounded to an
--   identical integer — because the update term was the LIFETIME cumulative
--   ratio (cm.correct + new) / (cm.total + new). On the demo account, where a
--   competency already holds 10–14 attempts, one more question changes that
--   ratio by ~1/12, so the radar, the gap chips and the readiness average all
--   looked frozen. Worse, the term gets weaker the more you practise.
--
--   It also disagreed with the documented model: src/lib/forecast.ts derives
--   its implied-level, plateau and threshold-crossing algebra from
--       m_n = 0.6 * m_{n-1} + 0.4 * s_n        (s_n = that quiz's own score)
--   so the forecast panel was projecting from a formula the database did not
--   implement. This migration makes the database match the document.
--
-- The fix — the update term is now THIS attempt's per-competency ratio:
--       mastery := 0.6 * old_mastery + 0.4 * (attempt_correct / attempt_total) * 100
--   excluded.correct / excluded.total are exactly the proposed row's numbers
--   for the competency, i.e. this attempt's tally — so a strong quiz visibly
--   lifts the map (37 → 62 on a clean attempt) and a weak one drops it.
--
-- Unchanged on purpose:
--   • the first-ever attempt still seeds at 40% of its score (m_0 = 0 in the
--     same rule, so the insert path and the update path stay one formula);
--   • attempts / correct / total remain LIFETIME counters — they are stats
--     (admin directory, history) and columns are unchanged, so this is a plain
--     `create or replace` and the 0008 grants survive untouched.
--
-- Safe to run any number of times. To revert, re-run
-- 0005_fix_apply_attempt_excluded.sql.
--
-- Success: notice "apply_attempt replaced (0012)" and one row with
-- per_attempt_ema = true.
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
      -- First attempt for this competency: 0.6 * 0 + 0.4 * ratio.
      greatest(0.4 * (per_tag.q_correct::numeric / per_tag.q_total) * 100, 0),
      1,
      per_tag.q_correct,
      per_tag.q_total,
      now()
    from per_tag
    -- SET expressions may reference the target (cm) and EXCLUDED only; the
    -- proposed values carry this attempt's numbers, so use excluded.* here.
    -- excluded.total >= 1 always (per_tag groups questions that exist).
    on conflict on constraint competency_mastery_pkey do update set
      mastery    = greatest(0.6 * cm.mastery + 0.4 * (excluded.correct::numeric / excluded.total) * 100, 0),
      attempts   = cm.attempts + 1,
      correct    = cm.correct + excluded.correct,
      total      = cm.total + excluded.total,
      updated_at = now()
    returning cm.competency_tag, cm.mastery, cm.attempts, cm.correct, cm.total
  )
  select * from upserted;
end;
$$;

-- ── Verification: the deployed body must use the per-attempt term ───────────
do $$
declare
  v_ok boolean;
begin
  select exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'apply_attempt'
       and p.pronargs = 4
       -- the new term is present ...
       and position('0.4 * (excluded.correct::numeric / excluded.total) * 100' in p.prosrc) > 0
       -- ... and the old cumulative ratio is gone
       and position('(cm.correct + excluded.correct)::numeric' in p.prosrc) = 0
  ) into v_ok;

  if not v_ok then
    raise exception 'Migration 0012 did not take effect - apply_attempt is missing, has the wrong signature, or still uses the cumulative ratio. Check that you are running this against the project the app points at (VITE_SUPABASE_URL in .env), then run the whole file again.';
  end if;
  raise notice 'apply_attempt replaced (0012)';
end $$;

select
  p.proname                                                        as function_name,
  p.pronargs                                                       as arg_count,
  (position('0.4 * (excluded.correct::numeric / excluded.total) * 100'
            in p.prosrc) > 0)                                      as per_attempt_ema,
  (position('(cm.correct + excluded.correct)::numeric'
            in p.prosrc) = 0)                                      as cumulative_term_removed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'apply_attempt';
