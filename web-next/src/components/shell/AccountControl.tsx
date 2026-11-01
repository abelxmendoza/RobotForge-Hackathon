"use client";
/* The account control: sign in / create account / sign out, in the
 * app topbar and the landing header. Backed by lib/auth.ts and the
 * live endpoint's /auth/* routes.
 *
 * Honest v1 scope, stated in the panel itself: an account is
 * identity + role. Robots and inventory stay on this device —
 * there is no cloud sync yet. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  authConfig,
  authLogin,
  authLogout,
  authMe,
  authRegister,
  captureFragmentAuth,
  loadSession,
  saveSession,
  HEALTH_URL,
  META_START_URL,
  type AuthSession,
} from "@/lib/auth";
import { liveHealth } from "@/components/forge/live";

function roleBadge(role: string) {
  if (role === "founder") return <span className="fbadge live">FOUNDER</span>;
  if (role === "admin") return <span className="fbadge local">ADMIN</span>;
  return null;
}

export default function AccountControl() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [metaLogin, setMetaLogin] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [healthLine, setHealthLine] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const adopt = useCallback((s: AuthSession | null) => {
    setSession(s);
    saveSession(s);
  }, []);

  /* On mount: a Meta-login redirect lands with #auth=<token>;
   * otherwise restore the stored session and refresh it against
   * /auth/me (a revoked or expired token signs the visitor out). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const frag = captureFragmentAuth();
      if (frag.error) setError("Meta login didn't complete — try again or use email.");
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
      if (!cancelled) setMetaLogin(cfg.metaLogin);
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  /* Close the panel on an outside click or Escape. */
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  const user = session?.user;
  const privileged = user && (user.role === "founder" || user.role === "admin");

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
      {open && (
        <div className="acct-panel" role="dialog" aria-label="Account">
          {user ? (
            <>
              <p className="acct-id">
                <strong>{user.name || user.email}</strong>
                {roleBadge(user.role)}
                <span className="acct-email">{user.email}</span>
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
            </>
          ) : (
            <>
              <div className="tabs acct-tabs" role="tablist" aria-label="Sign in or create account">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signin"}
                  className="tab"
                  onClick={() => {
                    setMode("signin");
                    setError("");
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "register"}
                  className="tab"
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                >
                  Create account
                </button>
              </div>
              <form onSubmit={submit} className="acct-form">
                {mode === "register" && (
                  <label className="g-field">
                    <span>Name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      placeholder="Your name"
                    />
                  </label>
                )}
                <label className="g-field">
                  <span>Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>
                <label className="g-field">
                  <span>Password</span>
                  <input
                    type="password"
                    required
                    minLength={mode === "register" ? 8 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                  />
                </label>
                {error && (
                  <p className="acct-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
                  {busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
                </button>
              </form>
              {metaLogin && (
                <a className="btn acct-meta" href={META_START_URL}>
                  Continue with Meta
                </a>
              )}
              <p className="acct-note">
                Accounts are identity + role for now. Your robots and inventory stay on
                this device — no cloud sync yet. No email verification or password reset
                in this version.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
