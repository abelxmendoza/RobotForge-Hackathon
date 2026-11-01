'use client';
/* Live endpoint plumbing — the React equivalent of forge.js's live
 * section and assets/js/live-config.js.
 *
 * GENERATED config in the vanilla site comes from
 * src/robotforge/site.py (LIVE_ENDPOINT). Empty (the committed
 * default): the site is exactly the recorded site — the Forge
 * replays recorded runs and the Guide answers from recorded data.
 * Set LIVE_ENDPOINT to the deployed Worker base URL (see
 * live/README.md) to light up live describe / photo / list steps. */
import type { LiveHealth } from './model';
import { isDemoMode } from '@/lib/demoMode';

export const LIVE_ENDPOINT = 'https://robotforge-live.abelxmendoza.workers.dev';

export const liveBase = LIVE_ENDPOINT.replace(/\/+$/, '');

/* Demo mode never touches the Worker (see lib/demoMode.ts): the
 * health probe resolves null WITHOUT a network call and live POSTs
 * refuse with a demo error, so every consumer falls back to its
 * recorded/offline path and says why. The demo check runs before
 * the health cache on purpose — a probe cached before the visitor
 * entered the demo must not leak live behavior into it. */
export const DEMO_LIVE_MESSAGE =
  'Live features are off in demo mode — exit the demo and sign in to use live AI.';

let healthCache: LiveHealth | null | undefined; // undefined = not probed yet
export async function liveHealth(): Promise<LiveHealth | null> {
  if (isDemoMode()) return null;
  if (!liveBase) return null;
  if (healthCache !== undefined) return healthCache;
  try {
    const r = await fetch(liveBase + '/health', { cache: 'no-cache' });
    healthCache = r.ok ? ((await r.json()) as LiveHealth) : null;
  } catch {
    healthCache = null;
  }
  return healthCache;
}

export function routeOn(h: LiveHealth | null, route: string): boolean {
  return Boolean(
    h &&
      h.ok &&
      h.mode === 'live' &&
      h.routes &&
      h.routes[route] &&
      !(h.budget && h.budget.exhausted),
  );
}

export function LiveOffReason({
  h,
  route,
}: {
  h: LiveHealth | null;
  route: string;
}) {
  if (isDemoMode()) {
    return (
      <>
        you&apos;re exploring the demo — live features are off here and
        answers are recorded; exit the demo and sign in for live AI
      </>
    );
  }
  if (!liveBase) {
    return (
      <>
        live mode is off in this deployment — no live endpoint is configured
        (see <code>live/README.md</code> in the repo)
      </>
    );
  }
  if (!h) return <>the live endpoint isn’t answering</>;
  if (h.mode === 'off') return <>live mode is switched off at the endpoint</>;
  if (h.budget && h.budget.exhausted) {
    return <>today’s live budget is used up</>;
  }
  if (route === 'photo') {
    return (
      <>
        photo live mode isn’t configured on the endpoint (it needs the
        optional Meta key)
      </>
    );
  }
  return <>that live route isn’t configured on the endpoint</>;
}

/* The Worker's model routes are account-gated: they verify the
 * session Bearer token (see live/worker.js requireAccount). The
 * session lives in localStorage under the key lib/auth.ts owns;
 * it is read here directly because lib/auth.ts imports liveBase
 * from this module — importing it back would be a cycle. With no
 * stored session the call goes out anonymous and the Worker
 * answers 401 auth_required, which callers already handle as a
 * live-off fallback. Demo mode never reaches this: postJSON
 * refuses above, before any token is read. */
export function sessionToken(): string | null {
  try {
    const raw = window.localStorage.getItem('rf.auth.v1');
    if (!raw) return null;
    const s = JSON.parse(raw) as { token?: unknown };
    return typeof s.token === 'string' && s.token ? s.token : null;
  } catch {
    return null;
  }
}

export async function postJSON<T>(path: string, payload: unknown): Promise<T> {
  if (isDemoMode()) {
    const e = new Error(DEMO_LIVE_MESSAGE) as Error & { code?: string };
    e.code = 'demo_mode';
    throw e;
  }
  const token = sessionToken();
  const r = await fetch(liveBase + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(payload),
  });
  let body: { error?: string; code?: string } | null = null;
  try {
    body = await r.json();
  } catch {
    /* non-JSON error page */
  }
  if (!r.ok) {
    const e = new Error(
      (body && body.error) || 'the endpoint answered HTTP ' + r.status,
    ) as Error & { code?: string; status?: number };
    e.code = (body && body.code) || undefined;
    e.status = r.status;
    throw e;
  }
  return body as T;
}
