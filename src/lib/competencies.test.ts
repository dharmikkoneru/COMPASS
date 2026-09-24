import { describe, expect, it } from 'vitest';
import { GAP_THRESHOLD, displayMastery, isGap } from './competencies';

describe('displayMastery', () => {
  it('never shows a gap as the threshold it has not reached', () => {
    // The live bug: Sampling mastery 59.966 rendered as "60%" inside a list of
    // gaps, with the caption "below 60% mastery" directly above it.
    expect(isGap(59.966)).toBe(true);
    expect(displayMastery(59.966)).toBe(GAP_THRESHOLD - 1);
  });

  it('rounds normally everywhere else', () => {
    expect(displayMastery(59.4)).toBe(59);
    expect(displayMastery(72.6)).toBe(73);
    expect(displayMastery(0)).toBe(0);
    expect(displayMastery(100)).toBe(100);
  });

  it('leaves an exact threshold value at the threshold', () => {
    // 60.0 is a strength, so it must read 60 — the rounding guard only applies
    // to values genuinely below the bar.
    expect(isGap(60)).toBe(false);
    expect(displayMastery(60)).toBe(60);
  });

  it('treats a missing or non-numeric mastery as zero', () => {
    expect(displayMastery(Number.NaN)).toBe(0);
  });
});
