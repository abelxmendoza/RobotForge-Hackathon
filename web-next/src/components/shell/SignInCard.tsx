"use client";
/* The sign-in card: email/password form + social providers,
 * shared by the topbar/landing account control (which shows it
 * in a modal) and the app gate (which shows it as the locked
 * app's front door). Design language from Abel's LoreBook login:
 * a narrow card — logo + heading + a quiet subline, icon fields,
 * one full-width accent action, a hairline "or" divider,
 * provider buttons as full-width secondary buttons, a featured
 * no-account note, and a small-print footer — in RobotForge's
 * own navy/teal palette and copy.
 *
 * Honest scope, stated in the card itself: an account is
 * identity + role. Robots and inventory live on this device; the
 * top bar's Save button (AccountSave.tsx) copies them to the
 * account on demand. */
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  authConfig,
  authLogin,
  authRegister,
  oauthStartUrl,
  type AuthSession,
  type OAuthProviderId,
} from "@/lib/auth";
import DemoEntryButton from "./DemoEntryButton";

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

export const PROVIDER_LABELS: Record<string, string> = {
  meta: "Meta", github: "GitHub", google: "Google",
};

export default function SignInCard({
  onAuthed,
  onClose,
  notice,
  hideDemo = false,
}: {
  /* Called with the fresh session after a successful email
   * sign-in/register. The host owns storing it (saveSession) and
   * whatever UI state follows. */
  onAuthed: (s: AuthSession) => void;
  /* Modal hosts pass a close handler; the gate panel omits it. */
  onClose?: () => void;
  /* A notice to show above the form (e.g. a failed social login). */
  notice?: string;
  /* The gate shows its own demo card, so it hides this one. */
  hideDemo?: boolean;
}) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [providers, setProviders] = useState<Record<OAuthProviderId, boolean>>(
    { meta: false, github: false, google: false });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await authConfig();
      if (!cancelled) setProviders(cfg.providers);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const s =
        mode === "register"
          ? await authRegister(email.trim(), password, name.trim())
          : await authLogin(email.trim(), password);
      setPassword("");
      onAuthed(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: "signin" | "register") => { setMode(m); setError(""); };
  const enabledProviders = PROVIDERS.filter((p) => providers[p.id]);

  return (
    <div
      className="acct-card"
      role="dialog"
      aria-label={mode === "signin" ? "Sign in to RobotForge" : "Create your RobotForge account"}
    >
      {onClose && (
        <button type="button" className="acct-close" aria-label="Close"
          onClick={onClose}>
          ×
        </button>
      )}
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

      {notice && (
        <p className="acct-errorbox" role="alert">{notice}</p>
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
        <button type="submit" className="btn btn-primary acct-cta" disabled={busy}>
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
        <strong>Just visiting?</strong> The demo is the no-account
        way in — sample robots and recorded answers, nothing sent
        anywhere. A free account opens the full app and live AI.
        Your robots and parts live on this device; signed in, the
        Save button also keeps a copy in your account. No email
        verification or password reset in this version.
        {!hideDemo && (
          <div className="acct-guest-demo">
            <DemoEntryButton label="Try the demo" />
          </div>
        )}
      </div>

      <p className="acct-legal">
        By continuing you agree to the{" "}
        <Link href="/privacy/">Privacy Policy</Link>. Deleting your
        data is covered on the{" "}
        <Link href="/data-deletion/">data deletion page</Link>.
      </p>
    </div>
  );
}
