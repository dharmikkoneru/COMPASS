import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The queue's contract is narrow and worth pinning exactly: it may only ever
 * hold work it can still submit, it must survive corrupt storage, it must never
 * leak one officer's work to another, and it must stop rather than hammer a
 * server that has just refused something.
 */

vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }));

import {
  MAX_QUEUE,
  appendQueued,
  clearPendingFor,
  enqueuePending,
  flushPendingFor,
  loadPendingFor,
  parseQueue,
  pendingState,
  queueKey,
  resetPendingForTests,
  serializeQueue,
  setQueueStoreForTests,
  setSubmitterForTests,
  type QueuedAttempt,
} from './attemptQueue';

const USER = 'd0e10000-0000-4000-8000-000000000001';
const OTHER_USER = '11111111-2222-4333-8444-555555555555';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const good = (n: number): QueuedAttempt => ({
  id: `id-${n}`,
  quizId: `quiz-${n}`,
  answers: { '0': 1, '1': 2 },
  score: n,
  total: 5,
  queuedAt: '2026-09-25T00:00:00.000Z',
});

const input = (n: number) => ({
  quizId: `quiz-${n}`,
  answers: { '0': 1 },
  score: n,
  total: 5,
});

describe('parseQueue', () => {
  it('drops malformed entries and keeps the good ones', () => {
    // Storage is shared and hand-editable, so a bad entry must never brick the app.
    const raw = JSON.stringify([
      good(1),
      { ...good(2), quizId: undefined },
      { ...good(3), total: 0 },
      { ...good(4), answers: { '0': 'one' } },
      { ...good(5), answers: [1, 2] },
      'not an object',
      good(6),
    ]);

    expect(parseQueue(raw).map((a) => a.id)).toEqual(['id-1', 'id-6']);
  });

  it('returns nothing rather than throwing on unreadable storage', () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('{not json')).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
  });

  it('round-trips through serialize', () => {
    expect(parseQueue(serializeQueue([good(1), good(2)]))).toHaveLength(2);
  });

  it('stamps a timestamp when one is missing', () => {
    const [entry] = parseQueue(JSON.stringify([{ ...good(1), queuedAt: undefined }]));
    expect(Number.isNaN(Date.parse(entry.queuedAt))).toBe(false);
  });
});

describe('appendQueued', () => {
  it('keeps the newest attempts and drops the oldest when full', () => {
    const list = [good(1), good(2)];
    expect(appendQueued(list, good(3), 2).map((a) => a.id)).toEqual(['id-2', 'id-3']);
    expect(MAX_QUEUE).toBeGreaterThan(0);
  });
});

type Submitter = (attempt: QueuedAttempt) => Promise<void>;
const makeSubmitter = () => vi.fn<Submitter>(async () => {});

describe('the queue', () => {
  let store: ReturnType<typeof memoryStore>;
  let submitter: ReturnType<typeof makeSubmitter>;

  beforeEach(() => {
    resetPendingForTests();
    store = memoryStore();
    setQueueStoreForTests(store);
    submitter = makeSubmitter();
    setSubmitterForTests(submitter);
  });

  it('persists a queued attempt under the user’s own key', () => {
    loadPendingFor(USER);
    const stored = enqueuePending(USER, input(1));

    expect(stored.id).toBeTruthy();
    expect(store.map.has(queueKey(USER))).toBe(true);
    expect(parseQueue(store.getItem(queueKey(USER)))).toHaveLength(1);
    expect(pendingState().pending).toHaveLength(1);
  });

  it('never shows one user the other’s unsent work', () => {
    loadPendingFor(USER);
    enqueuePending(USER, input(1));

    loadPendingFor(OTHER_USER);
    expect(pendingState().pending).toHaveLength(0);

    loadPendingFor(USER);
    expect(pendingState().pending).toHaveLength(1);
  });

  it('submits oldest first and clears each as it lands', async () => {
    loadPendingFor(USER);
    enqueuePending(USER, input(1));
    enqueuePending(USER, input(2));

    await expect(flushPendingFor(USER)).resolves.toBe(2);
    expect(submitter.mock.calls.map((c) => (c[0] as QueuedAttempt).quizId)).toEqual([
      'quiz-1',
      'quiz-2',
    ]);
    expect(pendingState().pending).toEqual([]);
    expect(pendingState().syncedCount).toBe(2);
    // Nothing left behind means the storage key is gone, not an empty array.
    expect(store.map.has(queueKey(USER))).toBe(false);
  });

  it('keeps the attempt and reports a real server refusal', async () => {
    loadPendingFor(USER);
    enqueuePending(USER, input(1));
    submitter.mockRejectedValue({ message: 'permission denied for table attempts', code: '42501' });

    await expect(flushPendingFor(USER)).resolves.toBe(0);
    expect(pendingState().pending).toHaveLength(1);
    expect(pendingState().error).toContain('permission denied');
    expect(pendingState().syncing).toBe(false);

    // A refusal is retryable on purpose, and the manual retry path succeeds.
    submitter.mockResolvedValue(undefined);
    await expect(flushPendingFor(USER)).resolves.toBe(1);
    expect(pendingState().pending).toEqual([]);
  });

  it('stops at the first failure instead of retry-storming', async () => {
    loadPendingFor(USER);
    enqueuePending(USER, input(1));
    enqueuePending(USER, input(2));
    submitter.mockRejectedValue({ message: 'permission denied for table attempts' });

    await flushPendingFor(USER);
    expect(submitter).toHaveBeenCalledTimes(1);
    expect(pendingState().pending).toHaveLength(2);
  });

  it('treats being offline as the queue working, not as an error', async () => {
    loadPendingFor(USER);
    enqueuePending(USER, input(1));
    submitter.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(flushPendingFor(USER)).resolves.toBe(0);
    expect(pendingState().pending).toHaveLength(1);
    expect(pendingState().error).toBeNull();
  });

  it('does not call the server when there is nothing queued', async () => {
    loadPendingFor(USER);
    await expect(flushPendingFor(USER)).resolves.toBe(0);
    expect(submitter).not.toHaveBeenCalled();
  });

  it('clears a previous refusal when new work is queued', async () => {
    loadPendingFor(USER);
    enqueuePending(USER, input(1));
    submitter.mockRejectedValue({ message: 'permission denied for table attempts' });
    await flushPendingFor(USER);
    expect(pendingState().error).not.toBeNull();

    enqueuePending(USER, input(2));
    expect(pendingState().error).toBeNull();
  });

  it('clears storage as well as memory', () => {
    loadPendingFor(USER);
    enqueuePending(USER, input(1));
    clearPendingFor(USER);

    expect(pendingState().pending).toEqual([]);
    expect(store.map.has(queueKey(USER))).toBe(false);
  });
});
