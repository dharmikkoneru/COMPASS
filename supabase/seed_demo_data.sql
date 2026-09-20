-- ═══════════════════════════════════════════════════════════════
-- COMPASS — Demo seed data for SIH judges
--
-- Run in Supabase SQL Editor (NOT psql).
-- ⚠️  Replace the UUID in the first DO block with your auth user ID.
--     Find it: select id, email from auth.users limit 5;
-- Safe to re-run (uses ON CONFLICT).
-- ═══════════════════════════════════════════════════════════════

-- ── CONFIG — paste your UUID here ──────────────────────────────
DO $$
DECLARE
  uid uuid := 'PASTE_YOUR_UUID_HERE';
BEGIN

-- ── 1. Materials ────────────────────────────────────────────────
INSERT INTO public.materials (id, user_id, title, source_type, raw_text, status, created_at) VALUES
('a0000001-0000-0000-0000-000000000001', uid, 'CPI Data Collection Manual 2025', 'pdf',
'The Consumer Price Index (CPI) measures changes in the price level of a weighted average market basket of consumer goods and services. The Ministry of Statistics and Programme Implementation (MoSPI) conducts the CPI through the National Statistical Office (NSO). Data collection follows a stratified random sampling design across 500+ urban centres and 1181 rural villages. Field investigators visit sample households on a rotating schedule, recording prices of 448 items across 8 groups: Food, Pan and Tobacco, Clothing, Housing, Fuel and Light, Miscellaneous, Education, and Health. Quality checks include supervisor verification of 10 percent of schedules and electronic range checks in the CAPI application. The base year for the current series is 2012=100.',
'ready', now() - interval '14 days'),
('a0000002-0000-0000-0000-000000000002', uid, 'NSS 78th Round: Employment-Unemployment Survey', 'pdf',
'The 78th round of the National Sample Survey (NSS) on Employment-Unemployment was conducted from July 2020 to June 2021. The survey covered the entire geographical area of India except inaccessible areas. A multi-stage stratified sampling design was employed with villages and urban blocks as first-stage units and households as second-stage units. The total sample size was 10168 villages and 4740 urban blocks, covering 101680 rural and 47400 urban households. Key parameters estimated include Labour Force Participation Rate (LFPR), Worker Population Ratio (WPR), Unemployment Rate (UR). Data was collected through CAPI with built-in validation checks.',
'ready', now() - interval '10 days'),
('a0000003-0000-0000-0000-000000000003', uid, 'Data Quality Framework for Official Statistics', 'text',
'MoSPI has adopted a comprehensive Data Quality Framework (DQF) aligned with the United Nations Fundamental Principles of Official Statistics. The framework defines six dimensions of data quality: Relevance, Accuracy, Timeliness, Punctuality, Accessibility, and Coherence. Each dimension has measurable indicators and thresholds. The Quality Assurance Unit conducts quarterly audits. Statistical Disclosure Control (SDC) procedures are applied before micro-data release using the tau-argus system.',
'ready', now() - interval '7 days')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Quizzes ─────────────────────────────────────────────────
INSERT INTO public.quizzes (id, material_id, created_by, title, difficulty, question_count, created_at) VALUES
('b0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', uid,
'CPI Data Collection Assessment', 'medium', 5, now() - interval '12 days'),
('b0000002-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000002', uid,
'NSS Employment Survey Methods Quiz', 'hard', 5, now() - interval '8 days'),
('b0000003-0000-0000-0000-000000000003', 'a0000003-0000-0000-0000-000000000003', uid,
'Data Quality Framework Quiz', 'medium', 5, now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

-- ── 3. Questions ───────────────────────────────────────────────
INSERT INTO public.questions (id, quiz_id, idx, text, options, correct_idx, explanation, competency_tag, difficulty) VALUES
('c0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001', 0,
'What is the base year for the current CPI series in India?',
'["2004=100", "2010=100", "2012=100", "2016=100"]'::jsonb, 2,
'The current CPI series uses 2012 as the base year, as per the NSO methodology.',
'Survey Methodology', 'medium'),
('c0000002-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000001', 1,
'How many item groups are covered in the CPI basket?',
'["5", "6", "8", "10"]'::jsonb, 2,
'The CPI basket covers 8 groups: Food, Pan and Tobacco, Clothing, Housing, Fuel and Light, Miscellaneous, Education, and Health.',
'Data Quality & Validation', 'medium'),
('c0000003-0000-0000-0000-000000000003', 'b0000001-0000-0000-0000-000000000001', 2,
'What percentage of schedules does a supervisor verify during quality checks?',
'["5%", "10%", "15%", "20%"]'::jsonb, 1,
'Supervisors verify 10% of schedules to ensure data quality and investigator performance.',
'Data Quality & Validation', 'medium'),
('c0000004-0000-0000-0000-000000000004', 'b0000001-0000-0000-0000-000000000001', 3,
'How many items are priced in the CPI basket?',
'["248", "348", "448", "548"]'::jsonb, 2,
'The CPI collects prices for 448 items across the 8 commodity groups.',
'Data Collection & Field Ops', 'medium'),
('c0000005-0000-0000-0000-000000000005', 'b0000001-0000-0000-0000-000000000001', 4,
'What sampling design is used for CPI data collection?',
'["Simple random sampling", "Stratified random sampling", "Cluster sampling", "Systematic sampling"]'::jsonb, 1,
'CPI uses stratified random sampling across urban centres and rural villages for representativeness.',
'Sampling Techniques', 'medium'),
('c0000006-0000-0000-0000-000000000006', 'b0000002-0000-0000-0000-000000000002', 0,
'Which round of the NSS conducted the Employment-Unemployment Survey?',
'["75th", "76th", "78th", "80th"]'::jsonb, 2,
'The 78th round of the NSS covered Employment-Unemployment from July 2020 to June 2021.',
'Survey Methodology', 'hard'),
('c0000007-0000-0000-0000-000000000007', 'b0000002-0000-0000-0000-000000000002', 1,
'What is the total rural sample size (households) in the 78th round?',
'["51680", "101680", "151680", "201680"]'::jsonb, 1,
'The 78th round covered 101680 rural households across 10168 villages.',
'Sampling Techniques', 'hard'),
('c0000008-0000-0000-0000-000000000008', 'b0000002-0000-0000-0000-000000000002', 2,
'Which of these is NOT a key parameter estimated by the NSS employment survey?',
'["Labour Force Participation Rate", "GDP Growth Rate", "Worker Population Ratio", "Unemployment Rate"]'::jsonb, 1,
'GDP Growth Rate is a macroeconomic indicator, not an employment survey parameter.',
'Official Statistics & Indicators', 'hard'),
('c0000009-0000-0000-0000-000000000009', 'b0000002-0000-0000-0000-000000000002', 3,
'What technology was used for data collection in the 78th round?',
'["Paper schedules", "CAPI with validation", "Online web forms", "SMS surveys"]'::jsonb, 1,
'CAPI (Computer Assisted Personal Interviewing) with built-in validation checks was used.',
'Statistical Computing', 'hard'),
('c0000010-0000-0000-0000-000000000010', 'b0000002-0000-0000-0000-000000000002', 4,
'The survey period for the 78th round was:',
'["Jan 2020 to Dec 2020", "July 2019 to June 2020", "July 2020 to June 2021", "Jan 2021 to Dec 2021"]'::jsonb, 2,
'The 78th round ran from July 2020 to June 2021, overlapping with the COVID-19 pandemic period.',
'Data Collection & Field Ops', 'hard'),
('c0000011-0000-0000-0000-000000000011', 'b0000003-0000-0000-0000-000000000003', 0,
'How many dimensions does the MoSPI Data Quality Framework define?',
'["4", "5", "6", "8"]'::jsonb, 2,
'The DQF defines 6 dimensions: Relevance, Accuracy, Timeliness, Punctuality, Accessibility, and Coherence.',
'Data Governance & Privacy', 'medium'),
('c0000012-0000-0000-0000-000000000012', 'b0000003-0000-0000-0000-000000000003', 1,
'Which system is used for Statistical Disclosure Control at MoSPI?',
'["R", "SPSS", "tau-argus", "SAS"]'::jsonb, 2,
'tau-argus is the standard SDC tool used globally and by MoSPI for micro-data protection.',
'Data Governance & Privacy', 'medium'),
('c0000013-0000-0000-0000-000000000013', 'b0000003-0000-0000-0000-000000000003', 2,
'How often does the Quality Assurance Unit conduct audits?',
'["Monthly", "Quarterly", "Half-yearly", "Annually"]'::jsonb, 1,
'The QA Unit conducts quarterly audits of all statistical products.',
'Data Quality & Validation', 'medium'),
('c0000014-0000-0000-0000-000000000014', 'b0000003-0000-0000-0000-000000000003', 3,
'The DQF is aligned with which international framework?',
'["SDGs", "UN Fundamental Principles of Official Statistics", "World Bank standards", "IMF SDDS"]'::jsonb, 1,
'MoSPI aligned its DQF with the UN Fundamental Principles of Official Statistics.',
'Official Statistics & Indicators', 'medium'),
('c0000015-0000-0000-0000-000000000015', 'b0000003-0000-0000-0000-000000000003', 4,
'Which model does MoSPI use for statistical metadata?',
'["ISO 9001", "GSBPM", "ITIL", "CMMI"]'::jsonb, 1,
'MoSPI metadata conforms to the Generic Statistical Business Process Model (GSBPM) lifecycle.',
'Data Indexing & Storage', 'medium')
ON CONFLICT (id) DO NOTHING;

-- ── 4. Attempts (spread over the last 2 weeks) ────────────────
INSERT INTO public.attempts (id, quiz_id, user_id, answers, score, total, status, submitted_at) VALUES
('d0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001', uid,
'[2,1,1,2,1]'::jsonb, 4, 5, 'completed', now() - interval '11 days'),
('d0000002-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000001', uid,
'[2,2,1,2,1]'::jsonb, 5, 5, 'completed', now() - interval '9 days'),
('d0000003-0000-0000-0000-000000000003', 'b0000002-0000-0000-0000-000000000002', uid,
'[2,1,1,1,2]'::jsonb, 3, 5, 'completed', now() - interval '7 days'),
('d0000004-0000-0000-0000-000000000004', 'b0000002-0000-0000-0000-000000000002', uid,
'[2,1,3,1,2]'::jsonb, 4, 5, 'completed', now() - interval '5 days'),
('d0000005-0000-0000-0000-000000000005', 'b0000003-0000-0000-0000-000000000003', uid,
'[2,2,1,1,1]'::jsonb, 3, 5, 'completed', now() - interval '3 days'),
('d0000006-0000-0000-0000-000000000006', 'b0000003-0000-0000-0000-000000000003', uid,
'[2,2,1,1,1]'::jsonb, 5, 5, 'completed', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── 5. Competency Mastery (realistic gaps) ─────────────────────
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

-- ── 6. iGOT Courses ───────────────────────────────────────────
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

-- ── 7. Recommendations (gap-driven) ───────────────────────────
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

-- ── Verify ─────────────────────────────────────────────────────
select 'materials' as tbl, count(*) as cnt from public.materials
union all select 'quizzes', count(*) from public.quizzes
union all select 'questions', count(*) from public.questions
union all select 'attempts', count(*) from public.attempts
union all select 'mastery', count(*) from public.competency_mastery
union all select 'courses', count(*) from public.igot_courses
union all select 'recommendations', count(*) from public.recommendations;
