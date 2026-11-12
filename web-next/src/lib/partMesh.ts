'use client';
/* The browser side of Wrench's "regenerate one part in 3D"
 * (lib/partEdit.ts parseLookEdit): calls the Worker's /part-mesh
 * routes, and keeps each kept look's GLB in this browser's IndexedDB.
 *
 * What leaves the browser: the part id ("wheel") and the owner's
 * words, nothing else. The Worker builds the prompt (live/worker.js
 * meshPrompt) and holds the 3D service key. Demo mode never calls
 * the Worker (postJSON refuses), so a look edit there says so.
 *
 * The GLB files are not part of Save to account (too big, like
 * scans): the robot record keeps a small PartLook entry naming each
 * look, and a browser without the file simply draws the plain part. */
import { DEMO_LIVE_MESSAGE, liveBase, liveHealth, postJSON, routeOn, sessionToken } from '@/components/forge/live';
import { isDemoMode } from './demoMode';

export interface PartLook {
  /* The 3D model's part id (components/kit/takeapart). */
  viewId: string;
  partLabel: string;
  /* The owner's words the look was generated from. */
  description: string;
  provider: 'meshy';
  jobId: string;
  createdAt: string;
  bytes: number;
}

export interface MeshJob { id: string; status: string; progress: number; ready?: boolean }

export const LOOK_CAPTION = 'Generated look (text-to-3D, Meshy), fitted into this part’s space. It is a picture of the idea, not CAD, and it does not change the spec.';

export async function partMeshAvailable(): Promise<boolean> {
  if (isDemoMode()) return false;
  return routeOn(await liveHealth(), 'part_mesh');
}

export function startPartMesh(viewId: string, description: string): Promise<MeshJob> {
  return postJSON<MeshJob>('/part-mesh', { part: viewId, description });
}

export function partMeshStatus(id: string): Promise<MeshJob> {
  return postJSON<MeshJob>('/part-mesh/status', { id });
}

export async function fetchPartMeshFile(id: string): Promise<ArrayBuffer> {
  if (isDemoMode()) throw new Error(DEMO_LIVE_MESSAGE);
  const token = sessionToken();
  const r = await fetch(liveBase + '/part-mesh/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ id }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error((body && body.error) || 'the endpoint answered HTTP ' + r.status);
  }
  const data = await r.arrayBuffer();
  /* A GLB starts with the ASCII magic "glTF". */
  const magic = new Uint8Array(data.slice(0, 4));
  if (String.fromCharCode(...magic) !== 'glTF') throw new Error('The 3D service sent a file that is not a GLB model.');
  return data;
}

/* ---------------- this browser's copies of kept looks ---------------- */

const DB = 'robotforge-part-looks-v1';
const STORE = 'looks';

export function lookKey(robotId: string, viewId: string, demo: boolean): string {
  return (demo ? 'demo:' : '') + robotId + ':' + viewId;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(new Error('This browser cannot store 3D looks (private window?).'));
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
        ? 'The 3D look did not fit in this browser\'s storage.'
        : 'Could not read the saved 3D look.'));
    });
  } finally {
    db.close();
  }
}

export async function saveLookFile(robotId: string, viewId: string, data: ArrayBuffer): Promise<void> {
  await run('readwrite', (s) => s.put(data, lookKey(robotId, viewId, isDemoMode())));
}

export async function removeLookFile(robotId: string, viewId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(lookKey(robotId, viewId, isDemoMode())));
}

/* The kept looks this browser holds for a robot, by part id. Looks
 * whose file is missing (another browser, cleared storage) are left
 * out, so the model draws that part plainly. */
export async function readLookFiles(robotId: string, looks: PartLook[] | undefined): Promise<Record<string, ArrayBuffer>> {
  const out: Record<string, ArrayBuffer> = {};
  if (!looks?.length || typeof indexedDB === 'undefined') return out;
  for (const look of looks) {
    try {
      const v = await run<ArrayBuffer>('readonly', (s) => s.get(lookKey(robotId, look.viewId, isDemoMode())));
      if (v instanceof ArrayBuffer) out[look.viewId] = v;
    } catch {
      /* unreadable: draw the plain part */
    }
  }
  return out;
}
