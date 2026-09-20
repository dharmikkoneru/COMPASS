-- Fix: mastery is on a 0-100 scale, not 0-1
-- Run this to correct the competency_mastery values

DO $$
DECLARE
  uid uuid := 'PASTE_YOUR_UUID_HERE';
BEGIN

UPDATE public.competency_mastery SET
  mastery = 78, attempts = 8, correct = 6, total = 8
WHERE user_id = uid AND competency_tag = 'Survey Methodology';

UPDATE public.competency_mastery SET
  mastery = 55, attempts = 6, correct = 3, total = 6
WHERE user_id = uid AND competency_tag = 'Sampling Techniques';

UPDATE public.competency_mastery SET
  mastery = 82, attempts = 10, correct = 8, total = 10
WHERE user_id = uid AND competency_tag = 'Data Collection & Field Ops';

UPDATE public.competency_mastery SET
  mastery = 63, attempts = 8, correct = 5, total = 8
WHERE user_id = uid AND competency_tag = 'Data Quality & Validation';

UPDATE public.competency_mastery SET
  mastery = 42, attempts = 6, correct = 2, total = 6
WHERE user_id = uid AND competency_tag = 'Statistical Computing';

UPDATE public.competency_mastery SET
  mastery = 70, attempts = 4, correct = 3, total = 4
WHERE user_id = uid AND competency_tag = 'Data Indexing & Storage';

UPDATE public.competency_mastery SET
  mastery = 50, attempts = 6, correct = 3, total = 6
WHERE user_id = uid AND competency_tag = 'Official Statistics & Indicators';

UPDATE public.competency_mastery SET
  mastery = 35, attempts = 4, correct = 1, total = 4
WHERE user_id = uid AND competency_tag = 'Data Governance & Privacy';

END $$;

-- Verify
select competency_tag, mastery, attempts, correct, total
from public.competency_mastery
order by mastery desc;
