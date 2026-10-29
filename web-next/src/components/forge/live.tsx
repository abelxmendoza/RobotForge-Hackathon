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

export const LIVE_ENDPOINT = 'https://robotforge-live.abelxmendoza.workers.dev';

export const liveBase = LIVE_ENDPOINT.replace(/\/+$/, '');

let healthCache: LiveHealth | null | undefined; // undefined = not probed yet
export async function liveHealth(): Promise<LiveHealth | null> {
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

export async function postJSON<T>(path: string, payload: unknown): Promise<T> {
  const r = await fetch(liveBase + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
