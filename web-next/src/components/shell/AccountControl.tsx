"use client";
/* The account control: sign in / create account / sign out, in the
 * app topbar and the landing header. Backed by lib/auth.ts and the
 * live endpoint's /auth/* routes.
 *
 * The sign-in surface mirrors the design language of Abel's
 * LoreBook login (lorebookai.com): a narrow centered card over a
 * dark, softly glowing backdrop — logo + heading + a quiet
 * subline, icon fields, one full-width accent action, a hairline
 * "or" divider, provider buttons as full-width secondary buttons,
 * a featured no-account note, and a small-print footer.
 * RobotForge keeps its own navy/teal palette, logo and copy; the
 * accounts underneath stay RobotForge's (email + password, or
 * Meta / GitHub / Google through the live endpoint).
 *
 * Honest v1 scope, stated in the card itself: an account is
 * identity + role. Robots and inventory stay on this device —
 * there is no cloud sync yet. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  authConfig,
  authLogin,
  authLogout,
  authMe,
  authRegister,
  captureFragmentAuth,
  loadSession,
  oauthStartUrl,
  saveSession,
  HEALTH_URL,
  type AuthSession,
  type OAuthProviderId,
} from "@/lib/auth";
import { liveHealth } from "@/components/forge/live";

function roleBadge(role: string) {
  if (role === "founder") return <span className="fbadge live">FOUNDER</span>;
  if (role === "admin") return <span className="fbadge local">ADMIN</span>;
  return null;
}

/* ---- field + provider glyphs (inline, no icon dependency) ---- */

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function MetaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" aria-hidden="true">
      <path d="M12 12c0-3 2.7-6 5.7-6A5.7 5.7 0 1 1 12 12Zm0 0c0 3-2.7 6-5.7 6A5.7 5.7 0 1 1 12 12Z" />
    </svg>
  );
}

const PROVIDERS: { id: OAuthProviderId; label: string; icon: ReactNode }[] = [
  { id: "meta", label: "Meta", icon: <MetaIcon /> },
  { id: "github", label: "GitHub", icon: <GithubIcon /> },
  { id: "google", label: "Google", icon: <GoogleIcon /> },
];

const PROVIDER_LABELS: Record<string, string> = {
  meta: "Meta", github: "GitHub", google: "Google",
};

export default function AccountControl() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [providers, setProviders] = useState<Record<OAuthProviderId, boolean>>(
    { meta: false, github: false, google: false });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fragError, setFragError] = useState("");
  const [busy, setBusy] = useState(false);
  const [healthLine, setHealthLine] = useState("");
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const adopt = useCallback((s: AuthSession | null) => {
    setSession(s);
    saveSession(s);
  }, []);

  /* On mount: a social-login redirect lands with #auth=<token>;
   * otherwise restore the stored session and refresh it against
   * /auth/me (a revoked or expired token signs the visitor out).
   * A failed social login lands as #auth_error=<provider>_login_failed
   * and opens the card with the reason. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const frag = captureFragmentAuth();
      if (frag.error) {
        const m = frag.error.match(/^(\w+)_login_failed$/);
        const label = (m && PROVIDER_LABELS[m[1]]) || null;
        setFragError(label
          ? `${label} login didn't complete — try again or use email.`
          : "That login didn't complete — try again or use email.");
        setOpen(true);
      }
      const token = frag.token || loadSession()?.token;
      if (token) {
        try {
          const user = await authMe(token);
          if (!cancelled) adopt({ token, user });
        } catch {
          if (!cancelled) adopt(null);
        }
      }
      if (!cancelled) setReady(true);
      const cfg = await authConfig();
      if (!cancelled) setProviders(cfg.providers);
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  /* Close the card/panel on an outside click or Escape. The
   * sign-in card is portalled to <body> (below), so "outside"
   * means outside both this root and the overlay. */
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current && rootRef.current.contains(t)) return;
      if (overlayRef.current && overlayRef.current.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  /* The founder/admin section reports the endpoint facts that
   * actually exist: the live health readout. */
  useEffect(() => {
    if (!open || !session || (session.user.role !== "founder" && session.user.role !== "admin")) return;
    let cancelled = false;
    (async () => {
      const h = await liveHealth();
      if (cancelled) return;
      setHealthLine(
        h
          ? `Endpoint: ${h.mode} · configured: ${h.configured ? "yes" : "no"} · accounts: ${(h as { auth?: boolean }).auth ? "on" : "off"}`
          : "Endpoint: not answering right now",
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const s =
        mode === "register"
          ? await authRegister(email.trim(), password, name.trim())
          : await authLogin(email.trim(), password);
      adopt(s);
      setPassword("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (session) await authLogout(session.token);
    adopt(null);
    setOpen(false);
  };

  const switchMode = (m: "signin" | "register") => { setMode(m); setError(""); };

  const user = session?.user;
  const privileged = user && (user.role === "founder" || user.role === "admin");
  const enabledProviders = PROVIDERS.filter((p) => providers[p.id]);

  return (
    <div className="acct" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost acct-btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {user ? (
          <>
            <span className="acct-who">{user.name || user.email}</span>
            {roleBadge(user.role)}
          </>
        ) : (
          "Sign in"
        )}
      </button>

      {open && !user && mounted && createPortal(
        <div
          className="acct-overlay"
          ref={overlayRef}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="acct-card"
            role="dialog"
            aria-modal="true"
            aria-label={mode === "signin" ? "Sign in to RobotForge" : "Create your RobotForge account"}
          >
            <button type="button" className="acct-close" aria-label="Close"
              onClick={() => setOpen(false)}>
              ×
            </button>
            <div className="acct-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/img/logo.svg" alt="" width={38} height={38} />
              <span>RobotForge</span>
            </div>
            <div>
              <h2>{mode === "signin" ? "Sign in to RobotForge" : "Create your account"}</h2>
              <p className="acct-sub">
                {mode === "signin" ? "Your garage is waiting." : "Set up your corner of the forge."}
              </p>
            </div>

            {fragError && (
              <p className="acct-errorbox" role="alert">{fragError}</p>
            )}

            <form onSubmit={submit} className="acct-form">
              {mode === "register" && (
                <span className="acct-field">
                  <UserIcon />
                  <input
                    aria-label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder="Your name"
                  />
                </span>
              )}
              <span className="acct-field">
                <MailIcon />
                <input
                  aria-label="Email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </span>
              <span className="acct-field">
                <LockIcon />
                <input
                  aria-label="Password"
                  type="password"
                  required
                  minLength={mode === "register" ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                />
              </span>
              {error && (
                <p className="acct-errorbox" role="alert">{error}</p>
              )}
              <button type="submit" className="btn btn-primary acct-cta" disabled={busy || !ready}>
                {busy ? "Working…" : (
                  <>{mode === "register" ? "Create account" : "Sign in"} <ArrowIcon /></>
                )}
              </button>
            </form>

            {enabledProviders.length > 0 && (
              <>
                <div className="acct-divider" aria-hidden="true"><span>or</span></div>
                <div className="acct-providers">
                  {enabledProviders.map((p) => (
                    <a key={p.id} className="acct-provider" href={oauthStartUrl(p.id)}>
                      {p.icon} Continue with {p.label}
                    </a>
                  ))}
                </div>
              </>
            )}

            <p className="acct-switch">
              {mode === "signin" ? (
                <>
                  New to RobotForge?{" "}
                  <button type="button" onClick={() => switchMode("register")}>
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => switchMode("signin")}>
                    Sign in
                  </button>
                </>
              )}
            </p>

            <div className="acct-guest">
              <strong>No account needed.</strong> The Forge, the demo and
              your garage all work signed out. Accounts are identity +
              role for now — your robots and inventory stay on this
              device, no cloud sync yet, and there is no email
              verification or password reset in this version.
            </div>

            <p className="acct-legal">
              By continuing you agree to the{" "}
              <Link href="/privacy/">Privacy Policy</Link>. Deleting your
              data is covered on the{" "}
              <Link href="/data-deletion/">data deletion page</Link>.
            </p>
          </div>
        </div>,
        document.body,
      )}

      {open && user && (
        <div className="acct-panel" role="dialog" aria-label="Account">
          <p className="acct-id">
            <strong>{user.name || user.email}</strong>
            {roleBadge(user.role)}
            <span className="acct-email">
              {user.email} · via {user.provider || "password"}
            </span>
          </p>
          {privileged && (
            <div className="acct-founder">
              <h3>{user.role === "founder" ? "Founder" : "Admin"}</h3>
              <p>{healthLine || "Checking the endpoint…"}</p>
              <p>
                <a href={HEALTH_URL} target="_blank" rel="noreferrer">
                  Endpoint health (raw)
                </a>
              </p>
            </div>
          )}
          <p className="acct-note">
            Accounts are identity + role for now. Your robots and inventory stay on
            this device — no cloud sync yet.
          </p>
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
