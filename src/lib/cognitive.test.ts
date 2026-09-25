import { describe, expect, it } from 'vitest';
import { COGNITIVE_HINT, COGNITIVE_LEVELS, COGNITIVE_TONE, cognitiveLevel } from './cognitive';

describe('cognitiveLevel', () => {
  it('returns the canonical name for a stored value', () => {
    expect(cognitiveLevel('Recall')).toBe('Recall');
    expect(cognitiveLevel('Application')).toBe('Application');
    expect(cognitiveLevel('Analysis')).toBe('Analysis');
  });

  it('accepts the spellings a model actually returns', () => {
    expect(cognitiveLevel('analysis')).toBe('Analysis');
    expect(cognitiveLevel('  application ')).toBe('Application');
  });

  it('refuses to guess for anything it does not recognise', () => {
    // Inventing a level would write a claim about a question nobody classified.
    expect(cognitiveLevel('Synthesis')).toBeNull();
    expect(cognitiveLevel('')).toBeNull();
    expect(cognitiveLevel(null)).toBeNull();
    expect(cognitiveLevel(undefined)).toBeNull();
    expect(cognitiveLevel(3)).toBeNull();
  });

  it('never accepts a value the database would refuse', () => {
    // migration 0013's check constraint allows exactly these three.
    expect([...COGNITIVE_LEVELS]).toEqual(['Recall', 'Application', 'Analysis']);
  });
});

describe('the presentation maps', () => {
  it('describe and style every level, so no chip renders blank', () => {
    for (const level of COGNITIVE_LEVELS) {
      expect(COGNITIVE_HINT[level]).toBeTruthy();
      expect(COGNITIVE_TONE[level]).toBeTruthy();
    }
  });
});
