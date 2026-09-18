/**
 * Client-side login throttle — brute-force defense in depth.
 *
 * Per-email sliding window: after MAX_ATTEMPTS failed sign-ins inside
 * WINDOW_MS, further attempts are refused until the oldest failure ages out
 * of the window. Failures clear on successful sign-in.
 *
 * Honest scope: this runs in the browser, so a determined attacker can clear
 * it. It stops sloppy credential-stuffing and gives visible feedback; the
 * server-side wall is Supabase Auth's built-in per-IP/email rate limits
 * (GoTrue), plus the leaked-password check and domain allow-list.
 */

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface FailureStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY_PREFIX = 'compass.login.failures.';

/* istanbul ignore next -- localStorage exists in every browser this runs in */
const defaultStore: FailureStore = {
  getItem: (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
  setItem: (k, v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  },
  removeItem: (k) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
  },
};

let store: FailureStore = defaultStore;

/** Test seam — keeps unit tests off localStorage. */
export function setFailureStoreForTests(s: FailureStore | null): void {
  store = s ?? defaultStore;
}

function keyFor(email: string): string {
  return KEY_PREFIX + email.trim().toLowerCase();
}

function readTimestamps(email: string): number[] {
  const raw = store.getItem(keyFor(email));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

function writeTimestamps(email: string, timestamps: number[]): void {
  const key = keyFor(email);
  if (timestamps.length === 0) {
    store.removeItem(key);
    return;
  }
  store.setItem(key, JSON.stringify(timestamps));
}

/** Drop entries older than the window; returns the fresh list. */
function prune(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < WINDOW_MS);
}

export function getLockState(email: string, now: number = Date.now()): {
  locked: boolean;
  attemptsLeft: number;
  /** Seconds until the lock lifts; 0 when not locked. */
  retryInSec: number;
} {
  const recent = prune(readTimestamps(email), now);
  if (recent.length > 0) writeTimestamps(email, recent); // opportunistic cleanup
  if (recent.length < MAX_ATTEMPTS) {
    return { locked: false, attemptsLeft: MAX_ATTEMPTS - recent.length, retryInSec: 0 };
  }
  const oldest = Math.min(...recent);
  const retryInSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
  return { locked: true, attemptsLeft: 0, retryInSec };
}

export function recordFailure(email: string, now: number = Date.now()): void {
  const recent = prune(readTimestamps(email), now);
  recent.push(now);
  writeTimestamps(email, recent);
}

export function clearFailures(email: string): void {
  store.removeItem(keyFor(email));
}

export function formatLockDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}
