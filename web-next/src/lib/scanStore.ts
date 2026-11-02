'use client';
/* The scan files themselves, in this browser's IndexedDB. They are not
 * uploaded anywhere and are not part of Save to account (too big). */
import { isDemoMode } from './demoMode';
import { scanKey } from './scan3d';

const DB = 'robotforge-scans-v1';
const STORE = 'scans';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(new Error('This browser cannot store 3D scans (private window?).'));
    req.onsuccess = () => resolve(req.result);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = tx.onabort = () => reject(new Error(mode === 'readwrite'
        ? 'The scan did not fit in this browser\'s storage. Export a smaller one.'
        : 'Could not read the saved scan.'));
    });
  } finally {
    db.close();
  }
}

export async function saveScanFile(robotId: string, file: Blob): Promise<void> {
  const data = await file.arrayBuffer();
  await run('readwrite', (s) => s.put(data, scanKey(robotId, isDemoMode())));
}

export async function readScanFile(robotId: string): Promise<ArrayBuffer | null> {
  const v = await run<ArrayBuffer>('readonly', (s) => s.get(scanKey(robotId, isDemoMode())));
  return v instanceof ArrayBuffer ? v : null;
}

export async function removeScanFile(robotId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(scanKey(robotId, isDemoMode())));
}
