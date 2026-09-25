import { useEffect, useState } from 'react';
import { aiServiceStatus, subscribeAiServiceStatus, warmAiService } from '../lib/ai';
import { queuedNote } from '../lib/connectivity';
import { useOnline } from '../hooks/useOnline';
import { usePendingAttempts } from '../hooks/usePendingAttempts';

/** How long a "synced" confirmation stays up once the queue has drained. */
const SYNCED_NOTE_MS = 12000;

interface Strip {
  tone: string;
  text: string;
  action?: { label: string; run: () => void };
}

/**
 * The system-status strip: offline, work waiting to sync, and whether the AI
 * service is up.
 *
 * Every line here exists because its absence made the app look broken in a way
 * that was not the officer's fault and was not diagnosable from the screen:
 *
 *   - a dead venue network looked like a failed submission, when the answers
 *     were in fact still on the device (see `lib/attemptQueue`);
 *   - a sleeping free-tier API looked like a hang, when it was a ~50 s boot;
 *   - a cold start pushed the call to the edge functions, which is correct and
 *     worth naming rather than hiding.
 *
 * Nothing renders while the network is up, the queue is empty and the API is
 * awake — a healthy app has no status bar at all.
 */
export default function StatusBanner() {
  const online = useOnline();
  const { pending, syncing, syncedCount, error, flush } = usePendingAttempts();
  const [service, setService] = useState(aiServiceStatus);
  /** The syncedCount whose confirmation the officer has already read. */
  const [acknowledged, setAcknowledged] = useState(0);

  useEffect(() => subscribeAiServiceStatus(setService), []);

  // Warm the (possibly sleeping) API once, from the one component that is
  // already watching its status and is mounted on every route including login.
  useEffect(() => {
    void warmAiService();
  }, []);

  // Derived, not stored: "there is something new to confirm" is a fact about
  // syncedCount, so a state flag for it could only ever disagree with it.
  const showSynced = syncedCount > 0 && syncedCount !== acknowledged;

  useEffect(() => {
    if (!showSynced) return;
    const timer = setTimeout(() => setAcknowledged(syncedCount), SYNCED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [showSynced, syncedCount]);

  const queued = queuedNote(pending.length);

  let strip: Strip | null = null;

  if (!online) {
    strip = {
      tone: 'bg-red-500/10 border-red-500/30 text-red-200',
      text: [
        "You're offline. Screens you have already opened keep working, but AI generation and mastery updates need a connection.",
        queued,
      ]
        .filter(Boolean)
        .join(' '),
    };
  } else if (error) {
    strip = {
      tone: 'bg-red-500/10 border-red-500/30 text-red-200',
      text: `${error} ${queued}`.trim(),
      action: { label: 'Try again', run: () => void flush() },
    };
  } else if (syncing) {
    strip = {
      tone: 'bg-blue-500/10 border-blue-500/30 text-blue-200',
      text: `Submitting ${pending.length} saved attempt${pending.length === 1 ? '' : 's'}…`,
    };
  } else if (pending.length > 0) {
    strip = {
      tone: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
      text: queued,
      action: { label: 'Sync now', run: () => void flush() },
    };
  } else if (showSynced) {
    strip = {
      tone: 'bg-green-500/10 border-green-500/30 text-green-200',
      text:
        syncedCount === 1
          ? '1 saved attempt synced — your mastery is updated.'
          : `${syncedCount} saved attempts synced — your mastery is updated.`,
    };
  } else if (service === 'waking') {
    strip = {
      tone: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
      text: 'Starting the AI service — the first request after an idle period takes about a minute. It will answer on its own.',
    };
  } else if (service === 'unreachable') {
    strip = {
      tone: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
      text: 'The COMPASS API is not responding. AI features are using the backup path (Supabase edge functions) instead.',
    };
  }

  if (!strip) return null;

  return (
    <div className={`border-b text-xs text-center py-1.5 px-4 ${strip.tone}`}>
      <span>{strip.text}</span>
      {strip.action && (
        <button
          onClick={strip.action.run}
          className="ml-2 underline hover:no-underline font-medium transition"
        >
          {strip.action.label}
        </button>
      )}
    </div>
  );
}
