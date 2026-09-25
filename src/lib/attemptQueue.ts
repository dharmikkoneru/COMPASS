/**
 * The offline submission queue — what happens to an attempt when the network
 * dies between answering the last question and pressing submit.
 *
 * Without it that submit failed with a red sentence, and the officer's answers
 * lived only in component state: navigate away, let the laptop sleep, or simply
 * reload, and five answered questions were gone. On venue wifi that is the
 * difference between "the platform protected my work" and "the demo is broken".
 *
 * So a submission that fails because it never reached a server is *queued* on
 * the device and retried when the link returns. Deliberately narrow, exactly
 * like the AI transport's fallback: only transport failures are queued. If
 * Postgres refuses the attempt (RLS, a bad quiz id, a missing grant) the officer
 * is told, because queueing a request the server will refuse forever turns one
 * clear error into a silent pile of unsent work.
 *
 * Honest scope: this is localStorage, so it is per-browser and per-user, it can
 * be cleared by the officer, and it cannot survive a different device. The
 * question is never "is the data safe" but "did we lose the attempt" — and this
 * answers that. The payload is the same one the RPC takes, so a queued attempt
 * is submitted by the identical code path, not a second one that could drift.
 */

import { isOfflineError } from './connectivity';
import { errorMessage } from './errors';
import { supabase } from './supabase';

export interface QueuedAttempt {
  /** Local id: the attempt row does not exist in the database yet. */
  id: string;
  quizId: string;
  /** Question idx → chosen option, shaped exactly as apply_attempt takes it. */
  answers: Record<string, number>;
  score: number;
  total: number;
  /** ISO timestamp of the moment the officer pressed submit. */
  queuedAt: string;
}

/** What a caller supplies — the queue owns the id and the timestamp. */
export type QueuedAttemptInput = Omit<QueuedAttempt, 'id' | 'queuedAt'>;

export interface PendingState {
  /** Oldest first, i.e. the order they will be submitted in. */
  pending: QueuedAttempt[];
  /** True while a flush is in flight. */
  syncing: boolean;
  /** How many queued attempts this session has actually submitted. */
  syncedCount: number;
  /**
   * The last *server* refusal, already readable. Being offline is not an error
   * here — it is the reason the queue exists — so it leaves this null.
   */
  error: string | null;
}

export const STORAGE_PREFIX = 'compass.pendingAttempts.';

/**
 * localStorage is small and shared with everything else on the origin, so the
 * queue is capped: past this many unsent attempts the oldest is dropped. Losing
 * the oldest is the least-bad choice, and 20 attempts is far more than a demo
 * or an offline stretch produces.
 */
export const MAX_QUEUE = 20;

export function queueKey(userId: string): string {
  return STORAGE_PREFIX + userId;
}

function isOption(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Read the queue back from storage, dropping anything malformed.
 *
 * Storage is shared, editable and versioned by no one, so a partially written
 * or hand-edited entry must never brick the app: a bad item is discarded and
 * the rest of the queue survives. Nothing here throws.
 */
export function parseQueue(raw: string | null): QueuedAttempt[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: QueuedAttempt[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const answers = e.answers;
    if (typeof e.id !== 'string' || !e.id) continue;
    if (typeof e.quizId !== 'string' || !e.quizId) continue;
    if (!Number.isFinite(e.score) || !Number.isFinite(e.total)) continue;
    if (typeof e.total !== 'number' || e.total <= 0) continue;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) continue;
    if (!Object.values(answers as Record<string, unknown>).every(isOption)) continue;

    out.push({
      id: e.id,
      quizId: e.quizId,
      answers: answers as Record<string, number>,
      score: Number(e.score),
      total: Number(e.total),
      queuedAt: typeof e.queuedAt === 'string' ? e.queuedAt : new Date().toISOString(),
    });
  }
  return out;
}

export function serializeQueue(list: QueuedAttempt[]): string {
  return JSON.stringify(list);
}

/** Newest last, with the oldest dropped once the cap is reached. */
export function appendQueued(
  list: QueuedAttempt[],
  item: QueuedAttempt,
  max: number = MAX_QUEUE,
): QueuedAttempt[] {
  const next = [...list, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

interface QueueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/* istanbul ignore next -- localStorage exists in every browser this runs in */
const defaultStore: QueueStore = {
  getItem: (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
  setItem: (k, v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  },
  removeItem: (k) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
  },
};

let store: QueueStore = defaultStore;

/** Test seam — keeps unit tests off localStorage. */
export function setQueueStoreForTests(s: QueueStore | null): void {
  store = s ?? defaultStore;
}

/** Submits one attempt. Throws on any failure, transport or server. */
type Submitter = (attempt: QueuedAttempt) => Promise<void>;

/**
 * The real submission: the same `apply_attempt` RPC the online path calls, so a
 * synced attempt is indistinguishable from one that never left the device.
 * RLS and the mastery maths are unchanged — nothing here is privileged.
 */
async function submitViaRpc(attempt: QueuedAttempt): Promise<void> {
  const { error } = await supabase.rpc('apply_attempt', {
    p_quiz_id: attempt.quizId,
    p_answers: attempt.answers,
    p_score: attempt.score,
    p_total: attempt.total,
  });
  if (error) throw error;
}

let submitter: Submitter = submitViaRpc;

/** Test seam — lets tests drive the flush without a database. */
export function setSubmitterForTests(fn: Submitter | null): void {
  submitter = fn ?? submitViaRpc;
}

const EMPTY: PendingState = { pending: [], syncing: false, syncedCount: 0, error: null };

let state: PendingState = { ...EMPTY };
let flushing = false;
const listeners = new Set<(s: PendingState) => void>();

export function pendingState(): PendingState {
  return state;
}

/** Subscribe for `useSyncExternalStore`. Returns an unsubscribe function. */
export function subscribePending(listener: (s: PendingState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replace the snapshot with a *new* object every time.
 *
 * `useSyncExternalStore` compares snapshots by identity, so mutating `state` in
 * place would look like "nothing changed" and the banner would never update.
 */
function patch(next: Partial<PendingState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

function writeQueue(userId: string, list: QueuedAttempt[]): void {
  const key = queueKey(userId);
  if (list.length === 0) {
    store.removeItem(key);
    return;
  }
  store.setItem(key, serializeQueue(list));
}

/**
 * Load this user's queue from storage. Called on sign-in and on mount.
 *
 * Keyed by user id on purpose: the shared demo account and a real officer can
 * use the same browser, and one must never be shown the other's unsent work.
 */
export function loadPendingFor(userId: string | null): void {
  if (!userId) {
    patch({ pending: [], error: null, syncing: false });
    return;
  }
  patch({ pending: parseQueue(store.getItem(queueKey(userId))) });
}

function localId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Queue one attempt. Returns what was stored, so the caller can show it. */
export function enqueuePending(userId: string, input: QueuedAttemptInput): QueuedAttempt {
  const item: QueuedAttempt = { ...input, id: localId(), queuedAt: new Date().toISOString() };
  const pending = appendQueued(state.pending, item);
  writeQueue(userId, pending);
  // A fresh queueing clears a previous server refusal: this is a different
  // submission, and the old message would be about work that is no longer here.
  patch({ pending, error: null });
  return item;
}

/**
 * Submit everything queued, oldest first.
 *
 * Stops at the first failure. Two reasons: order matters (an officer's history
 * reads better chronologically), and hammering a server that just refused
 * something is how a queue turns into a retry storm.
 *
 * @returns how many attempts were accepted by the database
 */
export async function flushPendingFor(userId: string): Promise<number> {
  if (flushing) return 0;
  if (state.pending.length === 0) return 0;

  flushing = true;
  patch({ syncing: true, error: null });

  let synced = 0;
  try {
    for (const item of [...state.pending]) {
      try {
        await submitter(item);
      } catch (err) {
        // Offline again: expected, and the whole point of keeping the queue.
        // The attempt stays put and the banner keeps saying so.
        if (!isOfflineError(err)) {
          patch({ error: errorMessage(err, 'The saved attempt could not be submitted') });
        }
        break;
      }
      const pending = state.pending.filter((p) => p.id !== item.id);
      writeQueue(userId, pending);
      patch({ pending, syncedCount: state.syncedCount + 1 });
      synced += 1;
    }
  } finally {
    flushing = false;
    patch({ syncing: false });
  }
  return synced;
}

/** Drop everything, in memory and in storage — sign-out and tests. */
export function clearPendingFor(userId: string | null): void {
  if (userId) writeQueue(userId, []);
  patch({ ...EMPTY });
}

export function resetPendingForTests(): void {
  state = { ...EMPTY };
  flushing = false;
  listeners.clear();
}
