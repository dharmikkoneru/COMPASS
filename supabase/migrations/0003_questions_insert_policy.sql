-- ═══════════════════════════════════════════════════════════════
-- COMPASS Platform — SIH26101 (MoSPI) — migration 0003
-- The write half of the quiz-generation path was never grantable.
--
-- The generate-quiz edge function writes with the *caller's* JWT (the
-- anon key plus the user's Authorization header), so RLS applies to it
-- exactly as it does to the browser. 0001 shipped:
--
--   1. no INSERT policy on public.questions at all. Every generation got
--      as far as inserting the quiz row and then died with
--      "new row violates row-level security policy for table questions"
--      — surfacing in the UI as "Quiz generation failed" while an empty
--      quiz row (question_count = n, zero questions) accumulated on the
--      Materials page. This is the bug that broke the assess → diagnose
--      loop end to end.
--
--   2. no DELETE policy on public.quizzes, so the function had no way to
--      roll back the quiz row it had just created when a later step (the
--      questions insert) failed.
--
-- Both policies are scoped to the row's owner, mirroring the existing
-- quizzes_insert / questions_select rules: an officer can only write
-- questions under a quiz they created.
--
-- Safe to run against a database that already has 0001/0002 applied.
-- Safe to run twice.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. questions: creators may insert into their own quizzes ──
drop policy if exists "questions_insert" on public.questions;
create policy "questions_insert" on public.questions
  for insert to authenticated with check (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and (q.created_by = auth.uid() or public.is_admin())
    )
  );

-- ── 2. quizzes: creators (and admins) may delete ──────────────
drop policy if exists "quizzes_delete" on public.quizzes;
create policy "quizzes_delete" on public.quizzes
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- PostgREST caches policies per instance; pick this up immediately.
notify pgrst, 'reload schema';

-- ── 3. Fail loudly if this did not take ───────────────────────
-- A migration that appears to have been applied but did not is worse than one
-- that errors. The deployed project was still refusing the questions insert
-- (42501, "new row violates row-level security policy for table questions")
-- after 0003 was believed to be live — the write worked all the way through to
-- the insert and stopped there. So rather than trust that this ran, check it:
-- raising here rolls a half-applied run back instead of letting it look
-- successful, and the SELECT below prints the policies that exist as proof.
do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', t.tbl, t.pol), ', ')
    into missing
    from (values ('questions', 'questions_insert'),
                 ('quizzes', 'quizzes_delete')) as t(tbl, pol)
   where not exists (
     select 1
       from pg_policies pp
      where pp.schemaname = 'public'
        and pp.tablename = t.tbl
        and pp.policyname = t.pol
   );

  if missing is not null then
    raise exception 'Migration 0003 did not take effect - still missing: %. Check that you are running this against the project the app points at (VITE_SUPABASE_URL in .env), then run the whole script again.', missing;
  end if;
end $$;

-- Proof for the SQL editor: this must list questions_insert on public.questions
-- (cmd = INSERT, with_check naming the quizzes owner) and quizzes_delete.
select schemaname, tablename, policyname, cmd, roles, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('questions', 'quizzes')
 order by tablename, cmd, policyname;
