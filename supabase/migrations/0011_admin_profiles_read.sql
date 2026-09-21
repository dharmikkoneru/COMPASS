-- ═══════════════════════════════════════════════════════════════
-- 0011_admin_profiles_read.sql
--
-- Blueprint item: administrative portal — a user directory inside a
-- restricted administrative view.
--
-- 0001 shipped `profiles_select` as `using (true)`: any authenticated
-- session could read every officer's record (the guest account could
-- see the administrator's row). This migration narrows it to least
-- privilege:
--
--   * officers  -> their own record only
--   * admins    -> the whole directory
--
-- Note on "excluding sensitive credentials": that is structural, not a
-- filter. Password hashes live in auth.users, which the PostgREST API
-- never exposes and RLS cannot reach from this schema — so there is no
-- query that could return them even by mistake.
--
-- Existing write policies are untouched: profiles_update_self and
-- profiles_update_admin (0001) already let an admin change a role,
-- which the UI exposes with a self-protection guard.
--
-- Safe to re-run: every SELECT policy on profiles is dropped first.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'profiles'
       and cmd        = 'SELECT'
  loop
    execute format('drop policy %I on public.profiles', pol.policyname);
  end loop;
end $$;

create policy "profiles_read_self_or_admin"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

-- Fail loudly if the policy did not take, rather than silently leaving
-- the directory open or unreadable.
do $$
declare
  ok boolean;
begin
  select exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'profiles'
       and policyname = 'profiles_read_self_or_admin'
       and cmd        = 'SELECT'
  ) into ok;

  if not ok then
    raise exception '0011 did not take effect - profiles_read_self_or_admin is missing. Run the whole script again against the project the app points at (VITE_SUPABASE_URL in .env).';
  end if;
end $$;

-- Show the live state: expect profiles_read_self_or_admin as the only SELECT.
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'profiles'
 order by cmd, policyname;
