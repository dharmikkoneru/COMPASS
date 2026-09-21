-- ═══════════════════════════════════════════════════════════════
-- 0010_guest_access.sql
--
-- Blueprint item: Guest & Preview Access — effortless demo sessions.
--
-- Creates the shared guest account demo@compass.gov.in and seeds its
-- profile. The domain passes the 0006 gov-domain allowlist, so no
-- trigger exemption is needed. The 0001 profile trigger fires on the
-- insert below; we also upsert the profile row defensively so 0010
-- still works if that trigger is ever absent.
--
-- HOW TO USE (2 steps, Supabase SQL Editor):
--   1. Run this whole file.
--   2. Run supabase/seed_demo_data.sql with the uid variable set to
--      the guest id below — that populates materials, quizzes,
--      questions, attempts, mastery and iGOT recommendations.
--
-- RESET: re-running BOTH files resets the demo to a pristine state —
-- use it between judge sessions.
--
-- The guest password lives in src/lib/guest.ts and MUST match the
-- crypt() call here. It is a demo credential by design; rotate both
-- together if this deployment ever leaves demo duty.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  guest_id    constant uuid := 'd0e10000-0000-4000-8000-000000000001';
  g_instance  constant uuid := '00000000-0000-0000-0000-000000000000';
  pid_is_uuid boolean;
begin
  -- Guard against a hand-created account with the same email but a
  -- different id, which would otherwise fail mid-script on the email
  -- unique constraint with a confusing error.
  if exists (
    select 1 from auth.users
     where email = 'demo@compass.gov.in' and id <> guest_id
  ) then
    raise exception 'A different auth.users row already uses demo@compass.gov.in. Resolve that account before running 0010.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new
  ) values (
    g_instance, guest_id, 'authenticated', 'authenticated',
    'demo@compass.gov.in',
    crypt('Compass-Guest-2026', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Demo Officer","department":"Demo (Guest Preview)","designation":"Guest Officer"}'::jsonb,
    now(), now(), '', '', '', ''
  )
  on conflict (id) do nothing;

  -- Repair path for a row left by an earlier run: NULL instance_id,
  -- possibly stale hash, token columns looking "pending".
  update auth.users
     set instance_id            = g_instance,
         encrypted_password     = crypt('Compass-Guest-2026', gen_salt('bf', 10)),
         email_confirmed_at     = now(),
         confirmation_token     = '',
         recovery_token         = '',
         email_change           = '',
         email_change_token_new = '',
         updated_at             = now()
   where id = guest_id;

  -- GoTrue resolves password sign-ins through auth.identities; without
  -- this row the account exists but every sign-in says "Invalid login
  -- credentials". provider_id is text in current schemas and uuid in
  -- some older ones, so branch on the live column type.
  if not exists (
    select 1 from auth.identities
     where user_id = guest_id and provider = 'email'
  ) then
    select data_type = 'uuid' into pid_is_uuid
      from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities'
       and column_name = 'provider_id';

    if pid_is_uuid then
      execute $sql$
        insert into auth.identities
          (id, user_id, provider_id, identity_data, provider,
           last_sign_in_at, created_at, updated_at)
        values
          (gen_random_uuid(), $1, $1,
           jsonb_build_object('sub', $1::text,
                              'email', 'demo@compass.gov.in',
                              'email_verified', true,
                              'phone_verified', false),
           'email', now(), now(), now())
      $sql$ using guest_id;
    else
      execute $sql$
        insert into auth.identities
          (id, user_id, provider_id, identity_data, provider,
           last_sign_in_at, created_at, updated_at)
        values
          (gen_random_uuid(), $1, $1::text,
           jsonb_build_object('sub', $1::text,
                              'email', 'demo@compass.gov.in',
                              'email_verified', true,
                              'phone_verified', false),
           'email', now(), now(), now())
      $sql$ using guest_id;
    end if;
  end if;
end $$;

-- Profile upsert: refreshes demo metadata on every run (and covers
-- the case where the 0001 signup trigger did not create the row).
insert into public.profiles (id, email, full_name, department, designation, role)
values (
  'd0e10000-0000-4000-8000-000000000001',
  'demo@compass.gov.in',
  'Demo Officer',
  'Demo (Guest Preview)',
  'Guest Officer',
  'officer'
)
on conflict (id) do update set
  email       = excluded.email,
  full_name   = excluded.full_name,
  department  = excluded.department,
  designation = excluded.designation,
  role        = 'officer';

-- ── Verification: expect one confirmed user + matching profile ──
select id, email, email_confirmed_at is null as unconfirmed
  from auth.users
 where email = 'demo@compass.gov.in';

select id, email, full_name, department, role
  from public.profiles
 where id = 'd0e10000-0000-4000-8000-000000000001';
