-- ═══════════════════════════════════════════════════════════════
-- COMPASS — GUEST DEMO SETUP (ALL-IN-ONE, ONE PASTE)  ·  v4
--
-- v4 CHANGE: the guest account could be created but never sign in.
-- A user inserted straight into auth.users has NO auth.identities row
-- and a NULL instance_id, and GoTrue resolves password sign-ins
-- through that identity — so every attempt answered "Invalid login
-- credentials". PART 2 now repairs both, which means re-running this
-- file also fixes an account left behind by an earlier partial run.
--
-- Copy THIS ENTIRE FILE → Supabase SQL Editor → Run. That's it.
-- No edits needed: the guest UUID is already filled in.
--
-- What it does, in order:
--   PART 1  Installs the FIXED 0009 signup trigger (reads provider
--           from raw_app_meta_data) and allows compass.gov.in for
--           the guest account; password signups stay locked to
--           official gov domains otherwise.
--   PART 2  Creates the guest account demo@compass.gov.in
--           (password: Compass-Guest-2026) + profile row.
--   PART 3  Seeds the GUEST with its OWN copy of the demo data —
--           every row id is namespaced under the guest's UUID
--           prefix (d0e10000-…-a001/b001/c001/d001), so it cannot
--           collide with rows seeded earlier against your personal
--           account (that collision is what broke v2: a unique
--           (quiz_id, idx) pair already taken by your questions).
--           Nothing owned by YOUR account is modified or deleted.
--   PART 4  Verification — check the numbers at the bottom.
--
-- 100% safe to re-run: re-running re-asserts the demo baseline and
-- wipes any extra quiz attempts the guest made in between — that is
-- your demo-reset button between judge sessions.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- PART 1 — FIXED SIGNUP TRIGGER (0009 v2 + demo domain)
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
  -- OAuth signup with a provider-verified email: allow regardless of
  -- domain (Google sign-ins with personal Gmail must work). auth.users
  -- has no `provider` column — GoTrue stores it in raw_app_meta_data.
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


-- ═══════════════════════════════════════════════════════════════
-- PART 2 — GUEST ACCOUNT (0010 v2)
--
-- A row in auth.users alone is NOT signable-in: GoTrue looks the
-- account up through auth.identities and expects the default
-- instance id rather than NULL. So this part:
--   1. inserts the user (instance_id = GoTrue's default instance),
--   2. repairs those fields if the row already exists from a partial
--      earlier run,
--   3. creates the missing 'email' identity row,
--   4. drops the throwaway probe account used while diagnosing.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  guest_id    constant uuid := 'd0e10000-0000-4000-8000-000000000001';
  g_instance  constant uuid := '00000000-0000-0000-0000-000000000000';
  pid_is_uuid boolean;
begin
  if exists (
    select 1 from auth.users
     where email = 'demo@compass.gov.in' and id <> guest_id
  ) then
    raise exception 'A different auth.users row already uses demo@compass.gov.in. Resolve that account before running this script.';
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

  -- The missing piece: without this identity row the account exists
  -- but every password sign-in answers "Invalid login credentials".
  if not exists (
    select 1 from auth.identities
     where user_id = guest_id and provider = 'email'
  ) then
    -- provider_id is text in current schemas and uuid in some older
    -- ones; branch on the live column type instead of guessing.
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

  -- Housekeeping: the probe account created while diagnosing the
  -- guest sign-in failure (cascades to its profile row).
  delete from auth.users where email = 'probe@compass.gov.in';
end $$;

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


-- ═══════════════════════════════════════════════════════════════
-- PART 3 — DEMO SEED DATA (guest-owned, collision-proof ids)
--   id scheme: d0e10000-0000-4000-8000-00000000XXXX
--     materials a001–a003 · quizzes b001–b003 · questions c001–c015
--     attempts  d001–d006      courses (global) e001–e005
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  uid uuid := 'd0e10000-0000-4000-8000-000000000001';
BEGIN

-- 3.0 Reset guest's quiz attempts except the six seeded below, so a
--     re-run returns the demo to its pristine baseline.
DELETE FROM public.attempts
 WHERE user_id = uid
   AND id NOT IN (
     'd0e10000-0000-4000-8000-00000000d001',
     'd0e10000-0000-4000-8000-00000000d002',
     'd0e10000-0000-4000-8000-00000000d003',
     'd0e10000-0000-4000-8000-00000000d004',
     'd0e10000-0000-4000-8000-00000000d005',
     'd0e10000-0000-4000-8000-00000000d006'
   );

-- ── 3.1 Materials (guest-owned) ────────────────────────────────
INSERT INTO public.materials (id, user_id, title, source_type, raw_text, status, created_at) VALUES
('d0e10000-0000-4000-8000-00000000a001', uid, 'CPI Data Collection Manual 2025', 'pdf',
'The Consumer Price Index (CPI) measures changes in the price level of a weighted average market basket of consumer goods and services. The Ministry of Statistics and Programme Implementation (MoSPI) conducts the CPI through the National Statistical Office (NSO). Data collection follows a stratified random sampling design across 500+ urban centres and 1181 rural villages. Field investigators visit sample households on a rotating schedule, recording prices of 448 items across 8 groups: Food, Pan and Tobacco, Clothing, Housing, Fuel and Light, Miscellaneous, Education, and Health. Quality checks include supervisor verification of 10 percent of schedules and electronic range checks in the CAPI application. The base year for the current series is 2012=100.',
'ready', now() - interval '14 days'),
('d0e10000-0000-4000-8000-00000000a002', uid, 'NSS 78th Round: Employment-Unemployment Survey', 'pdf',
'The 78th round of the National Sample Survey (NSS) on Employment-Unemployment was conducted from July 2020 to June 2021. The survey covered the entire geographical area of India except inaccessible areas. A multi-stage stratified sampling design was employed with villages and urban blocks as first-stage units and households as second-stage units. The total sample size was 10168 villages and 4740 urban blocks, covering 101680 rural and 47400 urban households. Key parameters estimated include Labour Force Participation Rate (LFPR), Worker Population Ratio (WPR), Unemployment Rate (UR). Data was collected through CAPI with built-in validation checks.',
'ready', now() - interval '10 days'),
('d0e10000-0000-4000-8000-00000000a003', uid, 'Data Quality Framework for Official Statistics', 'text',
'MoSPI has adopted a comprehensive Data Quality Framework (DQF) aligned with the United Nations Fundamental Principles of Official Statistics. The framework defines six dimensions of data quality: Relevance, Accuracy, Timeliness, Punctuality, Accessibility, and Coherence. Each dimension has measurable indicators and thresholds. The Quality Assurance Unit conducts quarterly audits. Statistical Disclosure Control (SDC) procedures are applied before micro-data release using the tau-argus system.',
'ready', now() - interval '7 days')
ON CONFLICT (id) DO NOTHING;

-- ── 3.2 Quizzes (guest-owned) ──────────────────────────────────
INSERT INTO public.quizzes (id, material_id, created_by, title, difficulty, question_count, created_at) VALUES
('d0e10000-0000-4000-8000-00000000b001', 'd0e10000-0000-4000-8000-00000000a001', uid,
'CPI Data Collection Assessment', 'medium', 5, now() - interval '12 days'),
('d0e10000-0000-4000-8000-00000000b002', 'd0e10000-0000-4000-8000-00000000a002', uid,
'NSS Employment Survey Methods Quiz', 'hard', 5, now() - interval '8 days'),
('d0e10000-0000-4000-8000-00000000b003', 'd0e10000-0000-4000-8000-00000000a003', uid,
'Data Quality Framework Quiz', 'medium', 5, now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

-- ── 3.3 Questions (guest quizzes ⇒ (quiz_id, idx) is fresh) ────
INSERT INTO public.questions (id, quiz_id, idx, text, options, correct_idx, explanation, competency_tag, difficulty) VALUES
('d0e10000-0000-4000-8000-00000000c001', 'd0e10000-0000-4000-8000-00000000b001', 0,
'What is the base year for the current CPI series in India?',
'["2004=100", "2010=100", "2012=100", "2016=100"]'::jsonb, 2,
'The current CPI series uses 2012 as the base year, as per the NSO methodology.',
'Survey Methodology', 'medium'),
('d0e10000-0000-4000-8000-00000000c002', 'd0e10000-0000-4000-8000-00000000b001', 1,
'How many item groups are covered in the CPI basket?',
'["5", "6", "8", "10"]'::jsonb, 2,
'The CPI basket covers 8 groups: Food, Pan and Tobacco, Clothing, Housing, Fuel and Light, Miscellaneous, Education, and Health.',
'Data Quality & Validation', 'medium'),
('d0e10000-0000-4000-8000-00000000c003', 'd0e10000-0000-4000-8000-00000000b001', 2,
'What percentage of schedules does a supervisor verify during quality checks?',
'["5%", "10%", "15%", "20%"]'::jsonb, 1,
'Supervisors verify 10% of schedules to ensure data quality and investigator performance.',
'Data Quality & Validation', 'medium'),
('d0e10000-0000-4000-8000-00000000c004', 'd0e10000-0000-4000-8000-00000000b001', 3,
'How many items are priced in the CPI basket?',
'["248", "348", "448", "548"]'::jsonb, 2,
'The CPI collects prices for 448 items across the 8 commodity groups.',
'Data Collection & Field Ops', 'medium'),
('d0e10000-0000-4000-8000-00000000c005', 'd0e10000-0000-4000-8000-00000000b001', 4,
'What sampling design is used for CPI data collection?',
'["Simple random sampling", "Stratified random sampling", "Cluster sampling", "Systematic sampling"]'::jsonb, 1,
'CPI uses stratified random sampling across urban centres and rural villages for representativeness.',
'Sampling Techniques', 'medium'),
('d0e10000-0000-4000-8000-00000000c006', 'd0e10000-0000-4000-8000-00000000b002', 0,
'Which round of the NSS conducted the Employment-Unemployment Survey?',
'["75th", "76th", "78th", "80th"]'::jsonb, 2,
'The 78th round of the NSS covered Employment-Unemployment from July 2020 to June 2021.',
'Survey Methodology', 'hard'),
('d0e10000-0000-4000-8000-00000000c007', 'd0e10000-0000-4000-8000-00000000b002', 1,
'What is the total rural sample size (households) in the 78th round?',
'["51680", "101680", "151680", "201680"]'::jsonb, 1,
'The 78th round covered 101680 rural households across 10168 villages.',
'Sampling Techniques', 'hard'),
('d0e10000-0000-4000-8000-00000000c008', 'd0e10000-0000-4000-8000-00000000b002', 2,
'Which of these is NOT a key parameter estimated by the NSS employment survey?',
'["Labour Force Participation Rate", "GDP Growth Rate", "Worker Population Ratio", "Unemployment Rate"]'::jsonb, 1,
'GDP Growth Rate is a macroeconomic indicator, not an employment survey parameter.',
'Official Statistics & Indicators', 'hard'),
('d0e10000-0000-4000-8000-00000000c009', 'd0e10000-0000-4000-8000-00000000b002', 3,
'What technology was used for data collection in the 78th round?',
'["Paper schedules", "CAPI with validation", "Online web forms", "SMS surveys"]'::jsonb, 1,
'CAPI (Computer Assisted Personal Interviewing) with built-in validation checks was used.',
'Statistical Computing', 'hard'),
('d0e10000-0000-4000-8000-00000000c010', 'd0e10000-0000-4000-8000-00000000b002', 4,
'The survey period for the 78th round was:',
'["Jan 2020 to Dec 2020", "July 2019 to June 2020", "July 2020 to June 2021", "Jan 2021 to Dec 2021"]'::jsonb, 2,
'The 78th round ran from July 2020 to June 2021, overlapping with the COVID-19 pandemic period.',
'Data Collection & Field Ops', 'hard'),
('d0e10000-0000-4000-8000-00000000c011', 'd0e10000-0000-4000-8000-00000000b003', 0,
'How many dimensions does the MoSPI Data Quality Framework define?',
'["4", "5", "6", "8"]'::jsonb, 2,
'The DQF defines 6 dimensions: Relevance, Accuracy, Timeliness, Punctuality, Accessibility, and Coherence.',
'Data Governance & Privacy', 'medium'),
('d0e10000-0000-4000-8000-00000000c012', 'd0e10000-0000-4000-8000-00000000b003', 1,
'Which system is used for Statistical Disclosure Control at MoSPI?',
'["R", "SPSS", "tau-argus", "SAS"]'::jsonb, 2,
'tau-argus is the standard SDC tool used globally and by MoSPI for micro-data protection.',
'Data Governance & Privacy', 'medium'),
('d0e10000-0000-4000-8000-00000000c013', 'd0e10000-0000-4000-8000-00000000b003', 2,
'How often does the Quality Assurance Unit conduct audits?',
'["Monthly", "Quarterly", "Half-yearly", "Annually"]'::jsonb, 1,
'The QA Unit conducts quarterly audits of all statistical products.',
'Data Quality & Validation', 'medium'),
('d0e10000-0000-4000-8000-00000000c014', 'd0e10000-0000-4000-8000-00000000b003', 3,
'The DQF is aligned with which international framework?',
'["SDGs", "UN Fundamental Principles of Official Statistics", "World Bank standards", "IMF SDDS"]'::jsonb, 1,
'MoSPI aligned its DQF with the UN Fundamental Principles of Official Statistics.',
'Official Statistics & Indicators', 'medium'),
('d0e10000-0000-4000-8000-00000000c015', 'd0e10000-0000-4000-8000-00000000b003', 4,
'Which model does MoSPI use for statistical metadata?',
'["ISO 9001", "GSBPM", "ITIL", "CMMI"]'::jsonb, 1,
'MoSPI metadata conforms to the Generic Statistical Business Process Model (GSBPM) lifecycle.',
'Data Indexing & Storage', 'medium')
ON CONFLICT (id) DO NOTHING;

-- ── 3.4 Attempts (spread over the last 2 weeks) ─────────────────
INSERT INTO public.attempts (id, quiz_id, user_id, answers, score, total, status, submitted_at) VALUES
('d0e10000-0000-4000-8000-00000000d001', 'd0e10000-0000-4000-8000-00000000b001', uid,
'[2,1,1,2,1]'::jsonb, 4, 5, 'completed', now() - interval '11 days'),
('d0e10000-0000-4000-8000-00000000d002', 'd0e10000-0000-4000-8000-00000000b001', uid,
'[2,2,1,2,1]'::jsonb, 5, 5, 'completed', now() - interval '9 days'),
('d0e10000-0000-4000-8000-00000000d003', 'd0e10000-0000-4000-8000-00000000b002', uid,
'[2,1,1,1,2]'::jsonb, 3, 5, 'completed', now() - interval '7 days'),
('d0e10000-0000-4000-8000-00000000d004', 'd0e10000-0000-4000-8000-00000000b002', uid,
'[2,1,3,1,2]'::jsonb, 4, 5, 'completed', now() - interval '5 days'),
('d0e10000-0000-4000-8000-00000000d005', 'd0e10000-0000-4000-8000-00000000b003', uid,
'[2,2,1,1,1]'::jsonb, 3, 5, 'completed', now() - interval '3 days'),
('d0e10000-0000-4000-8000-00000000d006', 'd0e10000-0000-4000-8000-00000000b003', uid,
'[2,2,1,1,1]'::jsonb, 5, 5, 'completed', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── 3.5 Competency Mastery (realistic gaps) ─────────────────────
INSERT INTO public.competency_mastery (user_id, competency_tag, mastery, attempts, correct, total, updated_at) VALUES
(uid, 'Survey Methodology', 78, 8, 6, 8, now() - interval '1 day'),
(uid, 'Sampling Techniques', 55, 6, 3, 6, now() - interval '1 day'),
(uid, 'Data Collection & Field Ops', 82, 10, 8, 10, now() - interval '1 day'),
(uid, 'Data Quality & Validation', 63, 8, 5, 8, now() - interval '1 day'),
(uid, 'Statistical Computing', 42, 6, 2, 6, now() - interval '1 day'),
(uid, 'Data Indexing & Storage', 70, 4, 3, 4, now() - interval '1 day'),
(uid, 'Official Statistics & Indicators', 50, 6, 3, 6, now() - interval '1 day'),
(uid, 'Data Governance & Privacy', 35, 4, 1, 4, now() - interval '1 day')
ON CONFLICT (user_id, competency_tag) DO UPDATE SET
mastery = EXCLUDED.mastery, attempts = EXCLUDED.attempts, correct = EXCLUDED.correct, total = EXCLUDED.total, updated_at = EXCLUDED.updated_at;

-- ── 3.6 iGOT Courses (global catalog) ───────────────────────────
INSERT INTO public.igot_courses (id, external_id, title, provider, duration_hrs, competency_tags, url, is_mock) VALUES
('e0000001-0000-0000-0000-000000000001', 'IGOT-STAT-101', 'Fundamentals of Official Statistics', 'NSI Delhi', 8.0,
'{Official Statistics & Indicators, Survey Methodology}', 'https://karmayogi.gov.in/course/101', false),
('e0000002-0000-0000-0000-000000000002', 'IGOT-DATA-201', 'Advanced Sampling Methods', 'ISI Kolkata', 12.0,
'{Sampling Techniques, Survey Methodology}', 'https://karmayogi.gov.in/course/201', false),
('e0000003-0000-0000-0000-000000000003', 'IGOT-DQF-301', 'Statistical Disclosure Control', 'MoSPI', 6.0,
'{Data Governance & Privacy, Data Quality & Validation}', 'https://karmayogi.gov.in/course/301', false),
('e0000004-0000-0000-0000-000000000004', 'IGOT-SCMP-401', 'R Programming for Statisticians', 'NASSCOM', 10.0,
'{Statistical Computing}', 'https://karmayogi.gov.in/course/401', false),
('e0000005-0000-0000-0000-000000000005', 'IGOT-FOPS-501', 'Field Operations Handbook', 'NSO', 5.0,
'{Data Collection & Field Ops, Survey Methodology}', 'https://karmayogi.gov.in/course/501', false)
ON CONFLICT (id) DO NOTHING;

-- ── 3.7 Recommendations (gap-driven, guest-owned) ───────────────
INSERT INTO public.recommendations (user_id, course_id, competency_tag, reason, status, progress, created_at) VALUES
(uid, 'e0000004-0000-0000-0000-000000000004', 'Statistical Computing',
'Mastery at 42 percent — below the 60 percent readiness threshold. This course covers R programming for survey data analysis.',
'recommended', 0, now() - interval '5 days'),
(uid, 'e0000003-0000-0000-0000-000000000003', 'Data Governance & Privacy',
'Mastery at 35 percent — the lowest across all competencies. SDC training is critical for data release compliance.',
'recommended', 0, now() - interval '5 days'),
(uid, 'e0000002-0000-0000-0000-000000000002', 'Sampling Techniques',
'Mastery at 55 percent — borderline gap. Advanced sampling methods will strengthen field survey design skills.',
'enrolled', 35, now() - interval '3 days'),
(uid, 'e0000001-0000-0000-0000-000000000001', 'Official Statistics & Indicators',
'Mastery at 50 percent — below threshold. Covers NSI frameworks and international best practices.',
'in_progress', 60, now() - interval '2 days'),
(uid, 'e0000005-0000-0000-0000-000000000005', 'Data Collection & Field Ops',
'Already at 82 percent — this course covers advanced field techniques for career growth.',
'recommended', 0, now() - interval '1 day')
ON CONFLICT (user_id, course_id) DO UPDATE SET
status = EXCLUDED.status, progress = EXCLUDED.progress, reason = EXCLUDED.reason;

END $$;


-- ═══════════════════════════════════════════════════════════════
-- PART 4 — VERIFICATION (read the results, then you're done)
-- ═══════════════════════════════════════════════════════════════

-- 4a. Guest user exists and is confirmed (expect 1 row, unconfirmed = f)
select id, email, email_confirmed_at is null as unconfirmed
  from auth.users
 where email = 'demo@compass.gov.in';

-- 4b. Demo data counts FOR THE GUEST (expect 3/3/15/6/8/5)
select 'materials' as tbl, count(*) as cnt from public.materials
 where user_id = 'd0e10000-0000-4000-8000-000000000001'
union all
select 'quizzes', count(*) from public.quizzes
 where created_by = 'd0e10000-0000-4000-8000-000000000001'
union all
select 'questions', count(*) from public.questions q
 join public.quizzes z on z.id = q.quiz_id
 where z.created_by = 'd0e10000-0000-4000-8000-000000000001'
union all
select 'attempts', count(*) from public.attempts
 where user_id = 'd0e10000-0000-4000-8000-000000000001'
union all
select 'mastery', count(*) from public.competency_mastery
 where user_id = 'd0e10000-0000-4000-8000-000000000001'
union all
select 'recommendations', count(*) from public.recommendations
 where user_id = 'd0e10000-0000-4000-8000-000000000001'
union all
select 'courses (global)', count(*) from public.igot_courses;

-- 4c. Signup trigger live (expect enforce_signup_email_domain, enabled)
select tgname, tgrelid::regclass as on_table, tgenabled
  from pg_trigger
 where tgrelid = 'auth.users'::regclass
   and not tgisinternal;

-- 4d. Guest auth plumbing — this is what v4 fixed.
--     Expect instance_id = 00000000-0000-0000-0000-000000000000,
--     confirmed = t, identities = 1.
select u.id,
       u.instance_id,
       u.email_confirmed_at is not null as confirmed,
       (select count(*) from auth.identities i
         where i.user_id = u.id and i.provider = 'email') as identities
  from auth.users u
 where u.email = 'demo@compass.gov.in';
