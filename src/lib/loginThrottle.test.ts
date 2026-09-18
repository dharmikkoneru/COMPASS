import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  clearFailures,
  formatLockDuration,
  getLockState,
  recordFailure,
  setFailureStoreForTests,
} from './loginThrottle';

/** Map-backed store so tests never touch localStorage. */
function fakeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const EMAIL = 'Officer@MoSPI.gov.in'; // deliberately mixed case — key must normalize

beforeEach(() => {
  setFailureStoreForTests(fakeStore());
});

afterEach(() => {
  setFailureStoreForTests(null);
});

describe('loginThrottle', () => {
  it('starts unlocked with all attempts available', () => {
    expect(getLockState(EMAIL)).toEqual({ locked: false, attemptsLeft: MAX_ATTEMPTS, retryInSec: 0 });
  });

  it('locks after MAX_ATTEMPTS failures and reports wait time', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailure(EMAIL, 1000 + i);
    const s = getLockState(EMAIL, 2000);
    expect(s.locked).toBe(true);
    expect(s.attemptsLeft).toBe(0);
    expect(s.retryInSec).toBeGreaterThan(0);
    expect(s.retryInSec).toBeLessThanOrEqual(WINDOW_MS / 1000);
  });

  it('retries per failed attempt below the limit, never below 1 left after a failure', () => {
    recordFailure(EMAIL, 1000);
    expect(getLockState(EMAIL, 1100).attemptsLeft).toBe(MAX_ATTEMPTS - 1);
  });

  it('lifts the lock as failures age out of the window', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailure(EMAIL, 1000 * (i + 1));
    // Just before the first failure expires.
    expect(getLockState(EMAIL, 1000 + WINDOW_MS - 1).locked).toBe(true);
    // Just after — only the first has aged out, but that drops below the limit.
    expect(getLockState(EMAIL, 1000 + WINDOW_MS + 1).locked).toBe(false);
  });

  it('clears failures on successful sign-in', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailure(EMAIL, 1000 + i);
    clearFailures(EMAIL);
    expect(getLockState(EMAIL).locked).toBe(false);
  });

  it('keys per email, not globally', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailure(EMAIL, 1000 + i);
    expect(getLockState('other@mospi.gov.in').locked).toBe(false);
  });

  it('survives corrupted stored data', () => {
    const s = fakeStore();
    setFailureStoreForTests(s);
    s.setItem('compass.login.failures.' + EMAIL.toLowerCase(), 'not-json{');
    expect(getLockState(EMAIL).locked).toBe(false);
  });
});

describe('formatLockDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatLockDuration(45)).toBe('45s');
    expect(formatLockDuration(60)).toBe('1m');
    expect(formatLockDuration(125)).toBe('2m 5s');
  });
});
