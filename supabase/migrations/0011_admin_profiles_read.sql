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
-- SECOND RESPONSIBILITY — the shared guest account may not become an
-- admin. Anyone can sign in as demo@compass.gov.in (the password ships
-- with the demo), so promoting it would hand the whole directory to
-- every visitor. A guard trigger enforces officer-only, and this script
-- also demotes the account if an earlier experiment promoted it.
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

-- ── Guest account stays an officer ────────────────────────────────

-- Repair: undo any promotion of the shared demo account.
update public.profiles
   set role = 'officer'
 where lower(email) = 'demo@compass.gov.in'
   and role <> 'officer';

-- Prevent it happening again, whatever route is used (API, SQL, UI).
create or replace function public.protect_guest_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.email) = 'demo@compass.gov.in' and new.role <> 'officer' then
    raise exception 'The shared guest demo account must stay an officer - promoting it would expose the admin directory to anyone using the public demo credentials.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_guest_role on public.profiles;
create trigger protect_guest_role
  before insert or update on public.profiles
  for each row execute function public.protect_guest_role();

-- ── Verification ───────────────────────────────────────────────────

-- Expect profiles_read_self_or_admin as the only SELECT policy.
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'profiles'
 order by cmd, policyname;

-- Expect guest_role = officer and the guard trigger present.
select (select role from public.profiles
         where lower(email) = 'demo@compass.gov.in') as guest_role,
       (select exists (select 1 from pg_trigger
                        where tgrelid = 'public.profiles'::regclass
                          and tgname = 'protect_guest_role'
                          and not tgisinternal))    as guard_trigger;
