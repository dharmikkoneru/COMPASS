/**
 * Connectivity — telling "the network is gone" apart from "the server said no".
 *
 * The whole resilience story depends on this one distinction:
 *
 *   1. **the request never reached a server** — offline, a dead DNS name, a
 *      CORS preflight failure, or a free-tier host that is still booting. The
 *      officer's work is not wrong and retrying is the honest next step, so a
 *      quiz submission is *queued* rather than rejected;
 *   2. **the server answered and explained itself** — a real diagnosis (a
 *      missing key, a retired model) that must be shown, never silently
 *      retried into the void.
 *
 * The detection is string matching because that is genuinely all the browser
 * gives us: every engine words a dead network differently (`TypeError: Failed
 * to fetch` in Chrome, `Load failed` in Safari, `NetworkError when attempting
 * to fetch resource` in Firefox) and none of them carries an error code.
 *
 * `navigator.onLine` is necessary but not sufficient — a laptop joined to a
 * venue router with no uplink reports `true` while every request fails — so
 * the two are always used together: `navigator.onLine` for the banner, the
 * message patterns for classifying an actual failure.
 */

/** Phrases engines use when the request never completed. */
const OFFLINE_PATTERNS: RegExp[] = [
  /failed to fetch/i,
  /networkerror/i,
  /network request failed/i,
  /load failed/i, // Safari
  /fetch failed/i, // undici / node-flavoured runtimes
  /err_internet_disconnected/i,
  /err_network_changed/i,
  /the internet connection appears to be offline/i,
];

/**
 * True when a message describes a transport failure rather than a server's
 * answer. Deliberately conservative: a timeout is *not* offline (the host may
 * be up and simply slow), and neither is a 4xx/5xx body.
 */
export function isOfflineErrorMessage(message: string): boolean {
  if (!message.trim()) return false;
  return OFFLINE_PATTERNS.some((re) => re.test(message));
}

/** {@link isOfflineErrorMessage} for a thrown value of any shape. */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof Error) return isOfflineErrorMessage(err.message);
  if (typeof err === 'string') return isOfflineErrorMessage(err);
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return isOfflineErrorMessage(message);
  }
  return false;
}

/**
 * The browser's own view of the link.
 *
 * Only an explicit `onLine === false` counts as offline: `navigator.onLine` is
 * `undefined` anywhere there is no browser (tests, a worker), and "unknown"
 * must not disable features. Being wrong here is cheap — an actual failed
 * request is classified from its own message.
 */
export function browserIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * What to tell the officer about a queued submission.
 *
 * Queueing is only honest if it says *where* the work is: on this device, not
 * in the platform. The attempt is safe but the dashboard has not changed yet.
 */
export function queuedNote(count: number): string {
  if (count <= 0) return '';
  return count === 1
    ? '1 attempt is saved on this device and will sync automatically.'
    : `${count} attempts are saved on this device and will sync automatically.`;
}

/**
 * Staged progress copy for a running generation.
 *
 * A cold free-tier API can take about a minute, and a silent button for that
 * long reads as a broken app. This says how long it has been and, once the
 * wait is clearly past a normal generation, why. Null while the wait is short
 * enough that progress would be noise.
 *
 * @param elapsedSec seconds since the request started
 * @param waking true when the AI service is known to be starting up
 */
export function generationNote(elapsedSec: number, waking: boolean): string | null {
  const secs = Math.max(0, Math.floor(elapsedSec));
  if (secs < 5) return null;
  if (secs < 20) return `Still working — ${secs}s.`;
  return waking
    ? `Still working — ${secs}s. The AI service sleeps when idle; the first request after a pause takes about a minute.`
    : `Still working — ${secs}s. A long generation usually means the AI provider is busy; it is worth one more try.`;
}
