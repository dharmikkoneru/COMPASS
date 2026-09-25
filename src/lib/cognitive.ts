/**
 * Cognitive level — what a question asks the officer to *do*.
 *
 * Orthogonal to difficulty, which says how deeply the material has to be known.
 * The three names are Bloom's cognitive levels, narrowed to the three this
 * assessment actually distinguishes, and they are the exact strings migration
 * 0013's check constraint allows — anything else is refused by the database, so
 * the list is a contract rather than a label.
 *
 * Nothing here ever guesses a level. Every question generated before 0013 has
 * none, and defaulting those to "Application" would write a claim about a
 * question nobody classified; an unrecognised value renders as no chip at all.
 */

export const COGNITIVE_LEVELS = ['Recall', 'Application', 'Analysis'] as const;

export type CognitiveLevel = (typeof COGNITIVE_LEVELS)[number];

/**
 * The canonical level for a stored value, or null when it is not one.
 *
 * Case-insensitive for the same reason the generators normalise: a model can
 * answer correctly while ignoring an enum's spelling, and dropping "analysis"
 * as unknown would hide a tag that is right.
 */
export function cognitiveLevel(value: unknown): CognitiveLevel | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return COGNITIVE_LEVELS.find((level) => level.toLowerCase() === text) ?? null;
}

/** What each tag means, shown in the chip's tooltip. */
export const COGNITIVE_HINT: Record<CognitiveLevel, string> = {
  Recall: 'The material states this rule or figure — the question checks it was recognised.',
  Application:
    'A fact from the material applied to a situation other than the one it was stated in.',
  Analysis:
    'Several parts of the material weighed together — a cause diagnosed, or a conclusion inferred.',
};

/** Tailwind classes per level, so one level never looks like two things. */
export const COGNITIVE_TONE: Record<CognitiveLevel, string> = {
  Recall: 'bg-gray-600/70 text-gray-200',
  Application: 'bg-cyan-900/70 text-cyan-200',
  Analysis: 'bg-violet-900/70 text-violet-200',
};
