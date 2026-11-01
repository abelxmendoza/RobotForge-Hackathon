'use client';
/* Demo mode — the LoreBook pattern, adapted (Abel, 2026-11-01):
 * one tap from the landing page drops a visitor into the real app
 * preloaded with clearly-labeled sample data. No account, and the
 * demo NEVER calls the live Worker: chat answers come from the
 * recorded data, live features stay off, and the 200/day live
 * budget is untouched no matter how many visitors click.
 *
 * Isolation contract: while the demo flag is on, every read/write
 * of the visitor-data stores is redirected to a "<key>.demo" twin
 * (see effectiveStorageKey, applied centrally in lib/store.ts and
 * lib/grouping.ts). The visitor's real keys are never read for
 * content and never written, so entering, using and exiting the
 * demo leaves their robots, inventory and sightings byte-identical.
 * Exiting just clears the flag; the demo twins stay on disk,
 * namespaced, so re-entering shows the same sandbox. */
import { useEffect, useState } from 'react';

export const DEMO_FLAG_KEY = 'rf.demo.v1';
export const DEMO_EVENT = 'rf-demo-change';

/* The visitor-data stores that get demo twins. Auth (rf.auth.v1)
 * is deliberately NOT one of them: an account is the exit ramp
 * from the demo, not demo content. */
export const DEMO_DATA_KEYS: ReadonlySet<string> = new Set([
  'rf.garage.v1',
  'rf.inventory.v1',
  'rf.assemblies.v1',
  'robotforge.dex.sightings.v1',
]);

export function isDemoMode(): boolean {
  try {
    return Boolean(window.localStorage.getItem(DEMO_FLAG_KEY));
  } catch {
    return false;
  }
}

/* The storage key a read/write should actually touch. Outside demo
 * mode (and for non-data keys) the key passes through unchanged. */
export function effectiveStorageKey(key: string): string {
  return DEMO_DATA_KEYS.has(key) && isDemoMode() ? key + '.demo' : key;
}

export function setDemoMode(on: boolean): void {
  try {
    if (on) {
      window.localStorage.setItem(
        DEMO_FLAG_KEY,
        JSON.stringify({ v: 1, since: new Date().toISOString() }),
      );
    } else {
      window.localStorage.removeItem(DEMO_FLAG_KEY);
    }
  } catch {
    /* storage blocked: demo simply won't persist across pages */
  }
  window.dispatchEvent(new CustomEvent(DEMO_EVENT));
}

/* Reactive demo state for components (the demo bar, entry buttons,
 * the chat's subtitle). Re-reads on the demo event and on cross-tab
 * storage changes. */
export function useDemoMode(): boolean {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    const read = () => setDemo(isDemoMode());
    read();
    window.addEventListener(DEMO_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(DEMO_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);
  return demo;
}
