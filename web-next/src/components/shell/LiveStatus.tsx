'use client';
/* What is answering right now, said once at the top of a page, and
 * what a slow live call is doing while it runs.
 *
 *   LIVE     — Muse Spark answers through the live endpoint.
 *   RECORDED — the page replays runs recorded from earlier live calls.
 *   MOCK     — an offline helper (textbook rules, no model) answers.
 *
 * A page names its fallback (recorded or mock). The banner states the
 * reason whenever the fallback is in use — the endpoint is off, over
 * budget, unreachable, or the last live call failed — so a visitor
 * never mistakes a fallback for the model. */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { liveBase, liveHealth, routeOn } from '@/components/forge/live';
import type { LiveHealth } from '@/components/forge/model';

export type LiveMode = 'checking' | 'live' | 'recorded' | 'mock';

const PILL: Record<LiveMode, string> = {
  checking: 'CHECKING',
  live: 'LIVE',
  recorded: 'RECORDED',
  mock: 'MOCK',
};

const HEADLINE: Record<LiveMode, string> = {
  checking: 'Checking whether Muse Spark is reachable…',
  live: 'Muse Spark is answering live.',
  recorded: 'Showing recorded runs, not live answers.',
  mock: 'Offline helper: textbook rules, not the AI model.',
};

/* Why the live route is not in use, in plain words. */
export function offReason(h: LiveHealth | null, route: string): string {
  if (!liveBase) return 'no live endpoint is configured in this deployment';
  if (!h || !h.ok) return 'the live endpoint isn’t answering';
  if (h.mode === 'off') return 'live mode is switched off at the endpoint';
  if (h.budget && h.budget.exhausted) return 'today’s shared live budget is used up (it resets at midnight UTC)';
  if (route === 'photo' || route === 'part') return 'photo reading isn’t configured on the endpoint (it needs the Meta key)';
  return 'that live route isn’t configured on the endpoint';
}

export interface LiveModeState {
  mode: LiveMode;
  health: LiveHealth | null | undefined;
  reason: string;
  /* Call when a live call fails and the page falls back. */
  noteFailure: (err: unknown) => void;
  /* Call when a live call succeeds (clears an earlier failure). */
  noteSuccess: () => void;
}

/* The endpoint's /health answer: undefined while checking, null when
 * it can't be reached. */
export function useLiveHealth(): LiveHealth | null | undefined {
  const [health, setHealth] = useState<LiveHealth | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    liveHealth().then((h) => { if (alive) setHealth(h); });
    return () => { alive = false; };
  }, []);
  return health;
}

export function useLiveMode(route: string, fallback: 'recorded' | 'mock'): LiveModeState {
  const health = useLiveHealth();
  const [failure, setFailure] = useState('');
  const noteFailure = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setFailure('the last live call failed (' + msg + ')');
  }, []);
  const noteSuccess = useCallback(() => setFailure(''), []);
  if (health === undefined) return { mode: 'checking', health, reason: '', noteFailure, noteSuccess };
  const on = routeOn(health, route);
  if (on && !failure) return { mode: 'live', health, reason: '', noteFailure, noteSuccess };
  return { mode: fallback, health, reason: failure || offReason(health, route), noteFailure, noteSuccess };
}

export function ModeBanner({
  mode,
  reason,
  children,
}: {
  mode: LiveMode;
  reason?: string;
  children?: ReactNode;
}) {
  return (
    <div className={'mode-banner m-' + mode} role="status">
      <span className="mode-pill">{PILL[mode]}</span>
      <span className="mode-text">
        <strong>{HEADLINE[mode]}</strong>
        {reason ? <> Why: {reason}.</> : null}
        {children ? <> {children}</> : null}
      </span>
    </div>
  );
}

/* A slow live call in progress. The steps are the ones the browser can
 * actually see; the bar is indeterminate because the model reports no
 * progress, and the timer is real elapsed time. */
export function LiveProgress({
  what,
  next,
  typical = 'usually 15–40 s, sometimes up to 95 s',
}: {
  what: string;
  next?: string;
  typical?: string;
}) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const iv = setInterval(() => setSecs(Math.round((performance.now() - t0) / 1000)), 500);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="live-progress" role="status" aria-live="polite">
      <ol className="lp-steps">
        <li className="done">Sent to the live endpoint</li>
        <li className="now">
          {what} <span className="lp-time">{secs} s</span>
        </li>
        {next ? <li>{next}</li> : null}
      </ol>
      <div className="lp-bar" aria-hidden="true"><span /></div>
      <p className="faint lp-note">Muse Spark calls take {typical}. The timer is real; there is no fake percentage.</p>
    </div>
  );
}
