import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  enqueuePending,
  flushPendingFor,
  loadPendingFor,
  pendingState,
  subscribePending,
  type PendingState,
  type QueuedAttemptInput,
} from '../lib/attemptQueue';
import { useOnline } from './useOnline';

export interface PendingAttempts extends PendingState {
  /** Queue one attempt; false when there is no signed-in user to own it. */
  enqueue: (input: QueuedAttemptInput) => boolean;
  /** Retry the queue now — the banner's "try again" button. */
  flush: () => Promise<number>;
}

/**
 * The queue, bound to whoever is signed in.
 *
 * State lives in `lib/attemptQueue` rather than in this hook because two places
 * need the same answer at the same time: the review screen (which queues a
 * failed submission) and the status banner (which reports it and retries). Two
 * `useState`s would drift, and the banner would claim an empty queue while the
 * review screen was holding one.
 */
export function usePendingAttempts(): PendingAttempts {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const online = useOnline();
  const state = useSyncExternalStore(subscribePending, pendingState, pendingState);

  // Load this user's queue whenever the user changes (sign-in, sign-out, the
  // demo account handing over to a real officer).
  useEffect(() => {
    loadPendingFor(userId);
  }, [userId]);

  // Automatic retry, on exactly two edges: a user appearing with work queued,
  // and the link coming back. Deliberately not on every render or on every
  // change to the queue — a server that refused an attempt should not be asked
  // again and again without the officer's say-so. A failed flush leaves the
  // banner's manual retry, which is the honest place for the second attempt.
  useEffect(() => {
    if (!userId || !online) return;
    void flushPendingFor(userId);
  }, [userId, online]);

  const enqueue = useCallback(
    (input: QueuedAttemptInput): boolean => {
      if (!userId) return false;
      enqueuePending(userId, input);
      return true;
    },
    [userId],
  );

  const flush = useCallback(async () => {
    if (!userId) return 0;
    return flushPendingFor(userId);
  }, [userId]);

  return { ...state, enqueue, flush };
}
