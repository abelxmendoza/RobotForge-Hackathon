'use client';
/* Save to account: this browser's Workshop data (robots, parts,
 * assemblies, BOM prices, ownership) goes to the signed-in account
 * through the Worker's /account/save, and /account/data brings it
 * back on another browser. Saving is a button, not a background
 * sync: one KV write per press, and the Worker caps saves per day.
 * The demo never saves or loads: it is sample data, and it makes
 * no Worker calls (lib/demoMode.ts). */
import { liveBase } from '@/components/forge/live';
import { isDemoMode } from './demoMode';
import { writeStore } from './store';

/* Must match ACCOUNT_DATA_KEYS in live/worker.js: the Worker keeps
 * only these. */
export const ACCOUNT_DATA_KEYS: readonly string[] = [
  'rf.garage.v1', 'rf.inventory.v1', 'rf.assemblies.v1', 'rf.buildplan.v1', 'rf.ownership.v1',
];
const SAVED_KEY = 'rf.account.saved.v1';
export const ACCOUNT_SAVE_EVENT = 'rf-account-save';

export interface SavedMark { email: string; savedAt: string; hash: string }

/* The real (non-demo) stores, raw, so the saved copy is exact. */
export function collectLocalData(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ACCOUNT_DATA_KEYS) {
    try {
      const raw = window.localStorage.getItem(k);
      if (raw) out[k] = JSON.parse(raw);
    } catch { /* unreadable store: left out */ }
  }
  return out;
}

/* A cheap fingerprint to tell "saved" from "changed since". */
export function hashData(data: Record<string, unknown>): string {
  const s = JSON.stringify(data);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return s.length.toString(36) + '.' + (h >>> 0).toString(36);
}

export function readSavedMark(email: string): SavedMark | null {
  try {
    const m = JSON.parse(window.localStorage.getItem(SAVED_KEY) || 'null') as SavedMark | null;
    return m && m.email === email ? m : null;
  } catch { return null; }
}

function writeSavedMark(m: SavedMark) {
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(m)); } catch { /* best effort */ }
  window.dispatchEvent(new CustomEvent(ACCOUNT_SAVE_EVENT));
}

async function call(path: string, token: string, init: RequestInit = {}) {
  let r: Response;
  try {
    r = await fetch(liveBase + path, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token },
      cache: 'no-cache',
    });
  } catch {
    throw new Error('Could not reach the RobotForge server. Your robots are still saved in this browser.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error('Saving to your account is not switched on at the server yet.');
  if (!r.ok) throw new Error((data as { error?: string }).error || `Save failed (${r.status}).`);
  return data as Record<string, unknown>;
}

export async function saveToAccount(token: string, email: string): Promise<SavedMark> {
  if (isDemoMode()) throw new Error('The demo is sample data and is never saved to an account.');
  const data = collectLocalData();
  const res = await call('/account/save', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const mark = { email, savedAt: String(res.savedAt), hash: hashData(data) };
  writeSavedMark(mark);
  return mark;
}

export async function fetchAccountData(token: string): Promise<{ saved: boolean; savedAt?: string; data?: Record<string, unknown> }> {
  if (isDemoMode()) throw new Error('Exit the demo to load your own robots.');
  return (await call('/account/data', token)) as { saved: boolean; savedAt?: string; data?: Record<string, unknown> };
}

/* Replace this browser's stores with the account's copy. */
export function applyAccountData(email: string, savedAt: string, data: Record<string, unknown>): string | null {
  for (const k of ACCOUNT_DATA_KEYS) {
    if (!(k in data)) continue;
    const failure = writeStore(k, data[k]);
    if (failure) return failure;
  }
  writeSavedMark({ email, savedAt, hash: hashData(collectLocalData()) });
  return null;
}
