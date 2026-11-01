/* Accounts (v1) — identity + role only, served by the live
 * endpoint's /auth/* routes. The session token (a JWT issued by
 * the Worker) and the public user record live in localStorage
 * under rf.auth.v1. Robots and inventory are NOT synced: they
 * stay in this browser's own storage, account or no account. */
import { liveBase } from "@/components/forge/live";
import { isDemoMode } from "@/lib/demoMode";

export interface AuthUser {
  email: string;
  name: string;
  role: string; // "user" | "admin" | "founder"
  provider?: string;
  providerId?: string;
  createdAt?: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

const KEY = "rf.auth.v1";

export function loadSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    return s && s.token && s.user && s.user.email ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: AuthSession | null): void {
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage full/blocked: the session just won't persist */
  }
}

/* After Meta login the Worker redirects back to the site with the
 * session token in the URL fragment (/#auth=<jwt>). Capture it,
 * scrub it from the address bar, and report it so the caller can
 * resolve the user via /auth/me. A failed Meta login lands as
 * #auth_error=<code> instead; it is scrubbed and reported too. */
export function captureFragmentAuth(): { token?: string; error?: string } {
  const hash = window.location.hash || "";
  const m = hash.match(/[#&]auth=([^&]+)/);
  const e = hash.match(/[#&]auth_error=([^&]+)/);
  if (!m && !e) return {};
  const clean = hash
    .replace(/[#&]auth=[^&]+/, "")
    .replace(/[#&]auth_error=[^&]+/, "")
    .replace(/^#/, "");
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search + (clean ? "#" + clean : ""),
  );
  return m
    ? { token: decodeURIComponent(m[1]) }
    : { error: decodeURIComponent(e![1]) };
}

async function post(path: string, body: unknown, token?: string): Promise<any> {
  const r = await fetch(liveBase + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export type OAuthProviderId = "meta" | "github" | "google";

export interface AuthConfig {
  metaLogin: boolean;
  providers: Record<OAuthProviderId, boolean>;
}

const NO_PROVIDERS: AuthConfig = {
  metaLogin: false,
  providers: { meta: false, github: false, google: false },
};

export async function authConfig(): Promise<AuthConfig> {
  /* Demo mode makes no Worker calls on its own (see demoMode.ts).
   * This config probe is automatic, so it is skipped in the demo;
   * an explicit sign-in/register from the account panel is the
   * visitor's own action — the demo's exit ramp — and still works. */
  if (isDemoMode()) return NO_PROVIDERS;
  try {
    const r = await fetch(liveBase + "/auth/config", { cache: "no-cache" });
    if (!r.ok) return NO_PROVIDERS;
    const data = await r.json();
    const p = (data && data.providers) || {};
    return {
      metaLogin: Boolean(data.metaLogin ?? p.meta),
      providers: {
        meta: Boolean(p.meta ?? data.metaLogin),
        github: Boolean(p.github),
        google: Boolean(p.google),
      },
    };
  } catch {
    return NO_PROVIDERS;
  }
}

export async function authRegister(
  email: string,
  password: string,
  name: string,
): Promise<AuthSession> {
  const data = await post("/auth/register", { email, password, name });
  return { token: data.token, user: data.user as AuthUser };
}

export async function authLogin(email: string, password: string): Promise<AuthSession> {
  const data = await post("/auth/login", { email, password });
  return { token: data.token, user: data.user as AuthUser };
}

export async function authMe(token: string): Promise<AuthUser> {
  const r = await fetch(liveBase + "/auth/me", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-cache",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data.user as AuthUser;
}

export async function authLogout(token: string): Promise<void> {
  try {
    await post("/auth/logout", {}, token);
  } catch {
    /* stateless: dropping the local token is the real logout */
  }
}

export function oauthStartUrl(provider: OAuthProviderId): string {
  return liveBase + "/auth/" + provider + "/start";
}

export const META_START_URL = liveBase + "/auth/meta/start";
export const HEALTH_URL = liveBase + "/health";
