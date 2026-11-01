'use client';
/* Per-browser storage for the Garage and the parts inventory.
 *
 * The site is static: there is no account and no server database, so
 * a visitor's robots and parts live in this browser's localStorage.
 * Every read and write is guarded (private windows and full storage
 * throw), and Export / Import JSON is the way to move data between
 * browsers or commit it to the repo. */
import { useCallback, useEffect, useState } from 'react';
import { effectiveStorageKey } from './demoMode';

const EVENT = 'rf-store';

/* Demo mode: visitor-data keys transparently resolve to their
 * ".demo" twins (see lib/demoMode.ts), so every component reading
 * or writing through here is sandboxed without knowing it. The
 * change event keeps the LOGICAL key, so subscribers don't care. */
export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(effectiveStorageKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* Returns an error message when the write failed (usually: storage
 * full of photos), else null. */
export function writeStore<T>(key: string, value: T): string | null {
  try {
    window.localStorage.setItem(effectiveStorageKey(key), JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    return null;
  } catch (e) {
    return e instanceof Error && /quota/i.test(e.name + e.message)
      ? 'This browser’s storage is full. Export your data, then remove a few photos.'
      : 'This browser would not save the change (private window or storage blocked).';
  }
}

export function useStore<T>(key: string, fallback: T): [T, (next: T) => string | null, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setValue(readStore(key, fallback));
    setReady(true);
    const onChange = (e: Event) => {
      const k = (e as CustomEvent).detail ?? (e as StorageEvent).key;
      if (k === key) setValue(readStore(key, fallback));
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const save = useCallback((next: T) => {
    const error = writeStore(key, next);
    if (!error) setValue(next);
    return error;
  }, [key]);
  return [value, save, ready];
}

export function uid(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function downloadJSON(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
