-- ═══════════════════════════════════════════════════════════════
-- 0009_oauth_domain_exemption.sql
--
-- Fixes the collision between 0006 (signup domain allowlist) and
-- Google OAuth: the 0006 trigger ran on EVERY new auth.users row,
-- so a judge signing in with a personal Gmail via Google was
-- rejected mid-handshake with a raw SQL error.
--
-- New rule: email/password signups remain locked to official
-- government domains (gov.in / nic.in / mospi.gov.in). OAuth
-- signups are exempt because the provider has already verified
-- the account controls that address — Google does not hand back
-- unverified emails. The threat model is unchanged: nobody can
-- *claim* an arbitrary gov.in address they do not own via OAuth,
-- and the anonymous free-signup path stays closed.
--
-- Implementation note: auth.users has no `provider` column — GoTrue stores
-- it inside raw_app_meta_data ('email' | 'google' | ...), so we read it from
-- there. We additionally require email_confirmed_at to be set — always true
-- for Google signups — so a hypothetical provider that returns unverified
-- emails would fall through to the domain check instead of being waived.
--
-- v2 fix: the first version referenced new.provider, which does not exist
-- on auth.users (42703 at insert time, breaking ALL new signups). plpgsql
-- resolves record fields lazily, so the function validated but failed on
-- first use — caught while provisioning the guest account in 0010.
--
-- Safe to re-run: replaces the trigger function and trigger.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.check_signup_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain   text;
  provider text;
  allowed  constant text[] := array[
    'gov.in',
    'nic.in',
    'mospi.gov.in',
    'compass.gov.in'  -- the platform's own demo domain (guest account);
                      -- the check is EXACT-match, so subdomains of gov.in
                      -- are not automatically allowed.
  ];
begin
  -- OAuth signup with a provider-verified email: allow regardless
  -- of domain (Google sign-ins with personal Gmail must work).
  provider := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  if provider <> 'email'
     and new.email_confirmed_at is not null then
    return new;
  end if;

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

-- Fail loudly if the trigger did not take, rather than silently
-- leaving signups open (same self-verification pattern as 0006).
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
    raise exception '0009 did not take effect - trigger enforce_signup_email_domain is missing on auth.users. Run the whole script again against the project the app points at (VITE_SUPABASE_URL in .env).';
  end if;
end $$;

-- Show the live trigger state so the operator can eyeball the result.
select tgname, tgrelid::regclass as on_table, tgenabled
  from pg_trigger
 where tgrelid = 'auth.users'::regclass
   and not tgisinternal;
