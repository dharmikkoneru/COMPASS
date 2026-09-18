// COMPASS competency taxonomy for India's Official Statistical System.
// Question competency tags, mastery rows, iGOT course tags and the
// dashboard radar all key off this single list.

export const COMPETENCIES = [
  'Survey Methodology',
  'Sampling Techniques',
  'Data Collection & Field Ops',
  'Data Quality & Validation',
  'Statistical Computing',
  'Data Indexing & Storage',
  'Official Statistics & Indicators',
  'Data Governance & Privacy',
] as const;

export type Competency = (typeof COMPETENCIES)[number];

/** Compact labels for chips and chart axes. */
export const COMPETENCY_SHORT: Record<Competency, string> = {
  'Survey Methodology': 'Survey Mgmt',
  'Sampling Techniques': 'Sampling',
  'Data Collection & Field Ops': 'Field Ops',
  'Data Quality & Validation': 'Data Quality',
  'Statistical Computing': 'Stat Computing',
  'Data Indexing & Storage': 'Data Indexing',
  'Official Statistics & Indicators': 'Official Stats',
  'Data Governance & Privacy': 'Governance',
};

/** A competency is a "gap" when mastery falls below this threshold. */
export const GAP_THRESHOLD = 60;

export function isGap(mastery: number): boolean {
  return mastery < GAP_THRESHOLD;
}
