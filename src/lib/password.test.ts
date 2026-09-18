import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, passwordIssues, passwordStrength, validatePassword } from './password';

describe('passwordIssues', () => {
  it('accepts a strong password', () => {
    expect(passwordIssues('Tr0ub4dor&3x')).toEqual([]);
  });

  it('flags each missing rule', () => {
    const rules = passwordIssues('!').map((i) => i.rule); // symbol only: nothing else present
    expect(rules).toContain('length');
    expect(rules).toContain('lower');
    expect(rules).toContain('upper');
    expect(rules).toContain('digit');
  });

  it('honours the minimum length constant', () => {
    expect('x'.repeat(MIN_PASSWORD_LENGTH - 1)).not.toHaveLength(MIN_PASSWORD_LENGTH);
    expect(passwordIssues('Ab1' + 'x'.repeat(MIN_PASSWORD_LENGTH - 3))).toEqual([]);
  });
});

describe('validatePassword', () => {
  it('ok for a compliant password', () => {
    expect(validatePassword('CorrectHorse1')).toEqual({ ok: true });
  });

  it('names the missing rules in the message', () => {
    const r = validatePassword('alllowercase1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/uppercase/i);
  });
});

describe('passwordStrength', () => {
  it('orders empty < weak < good < strong', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('GoodPass1')).toBe(2);
    expect(passwordStrength('LongEnough&Strong1')).toBe(3);
  });
});
