-- ═══════════════════════════════════════════════════════════════
-- COMPASS — mock iGOT Karmayogi course catalog (seed)
-- Idempotent: re-running does nothing (conflict on external_id).
-- ═══════════════════════════════════════════════════════════════

insert into public.igot_courses (external_id, title, provider, duration_hrs, competency_tags, url, is_mock)
values
  ('CBP-MOSP-001', 'Foundations of Official Statistics', 'MoSPI', 4.0,
   array['Official Statistics & Indicators', 'Data Governance & Privacy'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-MOSP-002', 'National Statistical System: Structure and Mandates', 'MoSPI', 3.5,
   array['Official Statistics & Indicators'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-NSSTA-001', 'Survey Design and Planning for Official Data Collection', 'NSSTA', 6.0,
   array['Survey Methodology', 'Data Collection & Field Ops'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-NSSTA-002', 'Sampling Theory in Practice: Frames, Weights and Estimation', 'NSSTA', 8.0,
   array['Sampling Techniques'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-NSSTA-003', 'Non-response, Substitution and Bias Mitigation in Field Surveys', 'NSSTA', 5.0,
   array['Survey Methodology', 'Data Quality & Validation'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-CSO-001', 'Field Operations Management for Large-scale Surveys', 'CSO (SDRD)', 5.5,
   array['Data Collection & Field Ops'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-CSO-002', 'Computer-assisted Personal Interviewing (CAPI) Essentials', 'CSO (SDRD)', 3.0,
   array['Data Collection & Field Ops', 'Statistical Computing'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-CSO-003', 'Data Validation, Editing and Imputation Techniques', 'CSO (Data Informatics Division)', 6.5,
   array['Data Quality & Validation'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-DID-001', 'Microdata Documentation and Metadata Standards (DDI)', 'Data Informatics Division', 4.5,
   array['Data Indexing & Storage'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-DID-002', 'Statistical Databases and Data Warehousing for NSO Workflows', 'Data Informatics Division', 7.0,
   array['Data Indexing & Storage', 'Statistical Computing'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-NIC-001', 'R for Official Statistics: Reproducible Estimation Workflows', 'NIC / MoSPI', 10.0,
   array['Statistical Computing'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-NIC-002', 'Python for Survey Data Processing and Quality Checks', 'NIC / MoSPI', 8.5,
   array['Statistical Computing', 'Data Quality & Validation'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-LEG-001', 'Data Governance and the Draft National Data Protection Framework', 'MoSPI', 3.0,
   array['Data Governance & Privacy'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-LEG-002', 'Confidentiality and Dissemination of Statistical Microdata', 'MoSPI', 4.0,
   array['Data Governance & Privacy', 'Official Statistics & Indicators'],
   'https://igotkarmayogi.gov.in/', true),

  ('CBP-MOSP-003', 'Index Numbers, CPI and Key Economic Indicators', 'MoSPI', 6.0,
   array['Official Statistics & Indicators', 'Sampling Techniques'],
   'https://igotkarmayogi.gov.in/', true)
on conflict (external_id) do nothing;
