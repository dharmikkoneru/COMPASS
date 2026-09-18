-- 0006_signup_domain_allowlist.sql
-- Locks down open signups: new accounts may only be created with official
-- government email domains. Runs on auth.users (the GoTrue credentials table),
-- so it applies to every signup path — the website form and any direct API
-- signup — and would also block personal-domain OAuth emails if those are
-- ever enabled.
--
-- TO ADJUST THE LIST: edit `allowed` below and re-run the whole script
-- (it is safe to re-run; the trigger is replaced, not duplicated).

create or replace function public.check_signup_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain text;
  allowed constant text[] := array[
    'gov.in',
    'nic.in',
    'mospi.gov.in'
  ];
begin
  domain := lower(split_part(coalesce(new.email, ''), '@', 2));
  if domain = any(allowed) then
    return new;
  end if;
  raise exception 'Signup restricted to official government email domains (got "%")', domain;
end;
$$;

drop trigger if exists enforce_signup_email_domain on auth.users;
create trigger enforce_signup_email_domain
  before insert on auth.users
  for each row execute function public.check_signup_email_domain();

-- Fail loudly if the trigger did not take, rather than silently leaving
-- signups open (same self-verification pattern as 0003/0004/0005).
do $$
declare
  trg_exists boolean;
begin
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'enforce_signup_email_domain'
      and not tgisinternal
  ) into trg_exists;
  if not trg_exists then
    raise exception '0006 did not take effect - trigger enforce_signup_email_domain is missing on auth.users. Run the whole script again against the project the app points at (VITE_SUPABASE_URL in .env).';
  end if;
end $$;

select tgname, tgrelid::regclass as on_table, tgenabled
  from pg_trigger
 where tgrelid = 'auth.users'::regclass
   and not tgisinternal;
