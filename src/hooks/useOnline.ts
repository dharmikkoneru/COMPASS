import { useSyncExternalStore } from 'react';
import { browserIsOnline } from '../lib/connectivity';

/**
 * The browser's online/offline signal, as React state.
 *
 * `useSyncExternalStore` rather than `useState` + an event listener: the browser
 * owns this value, so the component should *read* it, not keep a copy that can
 * drift from the truth between the initial render and the effect that would
 * have re-read it.
 *
 * It is a *hint*, never the verdict: a laptop joined to a venue router with no
 * uplink reports `true` while every request fails, and a sleeping free-tier API
 * is reachable-but-slow rather than offline. Actual failures are classified
 * from their messages in `lib/connectivity` — this only says "the link looks
 * down", and the two are always used together.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeToLink, browserIsOnline, () => true);
}

function subscribeToLink(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
