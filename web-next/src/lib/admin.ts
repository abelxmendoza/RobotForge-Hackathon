/* Founder admin console — the data half.
 *
 * The console reads GET /auth/admin/users on the live endpoint with
 * the founder's own session token. The endpoint re-checks the role
 * server-side (founder only), so this module never decides who is
 * allowed — it only carries the session and shapes what comes back.
 * The operator token is NOT used here: that secret never reaches a
 * browser. Accounts are served as public records (no password hash
 * exists in this shape, on either route that lists users). */
import { liveBase } from "@/components/forge/live";
import type { AuthUser } from "@/lib/auth";

export interface ConsoleUser extends AuthUser {
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
}

export interface ConsoleSummary {
  total: number;
  /* Accounts with at least one stamped sign-in. */
  loggedIn: number;
  /* Stamped sign-in inside the trailing 7 days. */
  active7d: number;
  /* Accounts created inside the trailing 30 days. */
  new30d: number;
  byRole: Record<string, number>;
  byProvider: Record<string, number>;
}

const DAY = 24 * 60 * 60 * 1000;

export function summarizeUsers(users: ConsoleUser[], nowMs: number): ConsoleSummary {
  const byRole: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  let loggedIn = 0;
  let active7d = 0;
  let new30d = 0;
  for (const u of users) {
    byRole[u.role] = (byRole[u.role] || 0) + 1;
    const provider = u.provider || "password";
    byProvider[provider] = (byProvider[provider] || 0) + 1;
    const last = u.lastLoginAt ? Date.parse(u.lastLoginAt) : NaN;
    if (Number.isFinite(last)) {
      loggedIn += 1;
      if (nowMs - last <= 7 * DAY) active7d += 1;
    }
    const created = Date.parse(u.createdAt || "");
    if (Number.isFinite(created) && nowMs - created <= 30 * DAY) new30d += 1;
  }
  return { total: users.length, loggedIn, active7d, new30d, byRole, byProvider };
}

/* "Nov 3, 2026, 11:42 PM" — or the honest fallback for records that
 * predate a stamp. */
export function formatStamp(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return fallback;
  return new Date(t).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export async function fetchConsoleUsers(token: string): Promise<ConsoleUser[]> {
  let r: Response;
  try {
    r = await fetch(liveBase + "/auth/admin/users", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-cache",
    });
  } catch {
    throw new Error("Could not reach the RobotForge server. Try again in a moment.");
  }
  const data = (await r.json().catch(() => ({}))) as {
    users?: ConsoleUser[]; error?: string;
  };
  if (r.status === 404) {
    /* The route ships with an endpoint update; until that deploy
     * lands the live Worker answers 404 here. Say so plainly
     * instead of showing a raw status. */
    throw new Error("The console endpoint is not live yet — it arrives with the next endpoint update.");
  }
  if (!r.ok) {
    throw new Error(data.error || `The server refused the list (${r.status}).`);
  }
  return Array.isArray(data.users) ? data.users : [];
}
