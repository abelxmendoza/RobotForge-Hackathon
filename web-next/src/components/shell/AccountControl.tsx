"use client";
/* The account control: the sign-in entry point in the app topbar
 * and the landing header. It owns the session (restore + validate
 * on mount, sign out) and shows the shared SignInCard in a modal;
 * the card itself (form, providers, copy) lives in SignInCard.tsx
 * so the app gate presents the identical surface.
 *
 * Demo polish (2026-11-01): the signed-in panel also carries the
 * demo door — "Start demo" enters the same isolated sandbox the
 * anonymous entries open (seed + rf.demo.v1, real keys untouched),
 * and while the demo flag is on this control makes no Worker
 * calls: a stored session is adopted for display as-is and only
 * revalidates after the demo exits. */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AUTH_EVENT,
  authLogout,
  authMe,
  captureFragmentAuth,
  loadSession,
  saveSession,
  HEALTH_URL,
  type AuthSession,
} from "@/lib/auth";
import { liveHealth } from "@/components/forge/live";
import { isDemoMode, setDemoMode, useDemoMode } from "@/lib/demoMode";
import { seedDemoStores } from "@/lib/demoSeed";
import SignInCard, { PROVIDER_LABELS } from "./SignInCard";
import { useDemoExit } from "./DemoBar";
import { applyAccountData, fetchAccountData, readSavedMark } from "@/lib/accountSync";

function roleBadge(role: string) {
  if (role === "founder") return <span className="fbadge live">FOUNDER</span>;
  if (role === "admin") return <span className="fbadge local">ADMIN</span>;
  return null;
}

export default function AccountControl() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [open, setOpen] = useState(false);
  const [fragError, setFragError] = useState("");
  const [healthLine, setHealthLine] = useState("");
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const inDemo = useDemoMode();
  const exitDemo = useDemoExit();

  /* Enter the demo from the account panel: the same seed + flag
   * as the anonymous entries, so there is exactly one sandbox.
   * The session is never touched — rf.auth.v1 is not a demo-twin
   * key, and coming back restores this panel exactly as it was. */
  const startDemo = useCallback(() => {
    seedDemoStores();
    setDemoMode(true);
    setOpen(false);
    router.push("/garage/");
  }, [router]);

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
      /* The demo makes no Worker calls (lib/demoMode.ts), and that
       * includes this control: with the flag on and no fresh login
       * landing, adopt the stored session for display exactly as
       * it was left and skip the /auth/me refresh — the token is
       * untouched and revalidates on the next non-demo load. A
       * fragment token (a social login completing) still validates
       * below: signing in is the demo's exit ramp. */
      if (isDemoMode() && !frag.token) {
        if (!cancelled) setSession(loadSession());
        return;
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
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  /* Mirror the stored session when it changes elsewhere: the
   * app gate's own sign-in card, another tab, or an expiry
   * cleanup all go through saveSession (AUTH_EVENT). Without
   * this, signing in at the gate would leave this control
   * showing "Sign in" until the next reload. Display state only
   * — session validation belongs to the mount effect above and
   * to the gate. */
  useEffect(() => {
    const sync = () => {
      const s = loadSession();
      setSession((prev) =>
        (prev?.token || null) === (s?.token || null) ? prev : s);
    };
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

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

  /* Load from account replaces this browser's robots and parts with
   * the account's saved copy, so it asks first. */
  const [loadState, setLoadState] = useState<{ step: "idle" | "checking" | "confirm" | "done" | "error"; msg?: string; savedAt?: string; data?: Record<string, unknown> }>({ step: "idle" });
  useEffect(() => { if (!open) setLoadState({ step: "idle" }); }, [open]);
  const loadFromAccount = async () => {
    if (!session) return;
    if (loadState.step === "confirm" && loadState.data && loadState.savedAt) {
      const failure = applyAccountData(session.user.email, loadState.savedAt, loadState.data);
      setLoadState(failure ? { step: "error", msg: failure } : { step: "done", msg: "Loaded. This browser now has your saved robots and parts." });
      return;
    }
    setLoadState({ step: "checking" });
    try {
      const r = await fetchAccountData(session.token);
      if (!r.saved || !r.data || !r.savedAt) {
        setLoadState({ step: "error", msg: "Nothing is saved in your account yet. Use Save in the top bar first." });
        return;
      }
      setLoadState({ step: "confirm", savedAt: r.savedAt, data: r.data });
    } catch (e) {
      setLoadState({ step: "error", msg: (e as Error).message });
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

      {open && !user && mounted && createPortal(
        <div
          className="acct-overlay"
          ref={overlayRef}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <SignInCard
            notice={fragError || undefined}
            onClose={() => setOpen(false)}
            onAuthed={(s) => { adopt(s); setOpen(false); }}
          />
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
          {!inDemo && (
            <div className="acct-sync">
              <p className="acct-note">
                Save in the top bar keeps your robots, parts and BOM prices in your account.
                {(() => {
                  const m = readSavedMark(user.email);
                  return m ? ` Last saved from this browser ${new Date(m.savedAt).toLocaleString()}.` : " Nothing saved from this browser yet.";
                })()}
              </p>
              {loadState.step === "confirm" ? (
                <p className="acct-note" role="alert">
                  Replace this browser&apos;s robots and parts with your account&apos;s copy from {new Date(loadState.savedAt!).toLocaleString()}?{" "}
                  <button type="button" className="btn btn-sm g-remove-yes" onClick={loadFromAccount}>Yes, load it</button>{" "}
                  <button type="button" className="btn btn-sm" onClick={() => setLoadState({ step: "idle" })}>Cancel</button>
                </p>
              ) : (
                <button type="button" className="btn" onClick={loadFromAccount} disabled={loadState.step === "checking"}>
                  {loadState.step === "checking" ? "Checking your account…" : "Load from account"}
                </button>
              )}
              {loadState.msg && <p className="acct-note" role="status">{loadState.msg}</p>}
            </div>
          )}
          {inDemo ? (
            <>
              <p className="acct-note">
                You&apos;re in the demo — sample data and recorded answers. Your
                account and your own robots and inventory are untouched.
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => { setOpen(false); exitDemo(); }}
              >
                Exit demo
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={startDemo}>
              Start demo
            </button>
          )}
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
