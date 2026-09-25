import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserIsOnline,
  generationNote,
  isOfflineError,
  isOfflineErrorMessage,
  queuedNote,
} from './connectivity';

describe('isOfflineErrorMessage', () => {
  it('recognises each engine’s wording for a request that never arrived', () => {
    expect(isOfflineErrorMessage('TypeError: Failed to fetch')).toBe(true);
    expect(isOfflineErrorMessage('Load failed')).toBe(true); // Safari
    expect(isOfflineErrorMessage('NetworkError when attempting to fetch resource.')).toBe(true);
    expect(isOfflineErrorMessage('fetch failed')).toBe(true);
    expect(
      isOfflineErrorMessage('net::ERR_INTERNET_DISCONNECTED'),
    ).toBe(true);
  });

  it('never treats a server’s own answer as offline', () => {
    // These are diagnoses. Retrying them silently would hide the real cause.
    expect(isOfflineErrorMessage('GEMINI_API_KEY secret is not set')).toBe(false);
    expect(
      isOfflineErrorMessage('The COMPASS API returned HTTP 500 without an error message.'),
    ).toBe(false);
    expect(isOfflineErrorMessage('permission denied for table attempts [42501]')).toBe(false);
    expect(isOfflineErrorMessage('')).toBe(false);
  });

  it('does not call a slow host offline', () => {
    // A timeout may be a busy model, not a dead link — different advice.
    expect(isOfflineErrorMessage('The method timed out')).toBe(false);
  });
});

describe('isOfflineError', () => {
  it('reads an Error, a bare string and a supabase-style object alike', () => {
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineError('Failed to fetch')).toBe(true);
    expect(isOfflineError({ message: 'Failed to fetch' })).toBe(true);
    expect(isOfflineError({ message: 'permission denied for table attempts' })).toBe(false);
  });

  it('survives values that carry no message at all', () => {
    expect(isOfflineError(null)).toBe(false);
    expect(isOfflineError(undefined)).toBe(false);
    expect(isOfflineError(42)).toBe(false);
    expect(isOfflineError({})).toBe(false);
  });
});

describe('queuedNote', () => {
  it('says where the work actually is, and counts it honestly', () => {
    expect(queuedNote(1)).toBe('1 attempt is saved on this device and will sync automatically.');
    expect(queuedNote(3)).toBe('3 attempts are saved on this device and will sync automatically.');
    expect(queuedNote(0)).toBe('');
  });
});

describe('generationNote', () => {
  it('stays quiet while the wait is unremarkable', () => {
    expect(generationNote(0, false)).toBeNull();
    expect(generationNote(4, true)).toBeNull();
  });

  it('counts the seconds once the wait is worth mentioning', () => {
    expect(generationNote(9, false)).toBe('Still working — 9s.');
  });

  it('explains a long wait by whether the service was starting up', () => {
    // The 50 s cold start is a known, mundane cause; a busy provider is not.
    expect(generationNote(25, true)).toContain('sleeps when idle');
    expect(generationNote(25, false)).toContain('provider is busy');
  });
});

describe('browserIsOnline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports the browser’s own view of the link', () => {
    expect(browserIsOnline()).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });
    expect(browserIsOnline()).toBe(false);
  });
});
