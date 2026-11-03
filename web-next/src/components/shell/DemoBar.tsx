"use client";
/* The demo chrome: a slim in-flow strip at the very top of every
 * page while demo mode is on — the page underneath stays fully
 * visible and usable (Abel's rule: no stacked panels). Each demo
 * entry expands it once with a short guided path (four steps);
 * after that it stays one line: "Demo · sample data" + Exit.
 * Exit only clears the flag — the visitor's real stores were
 * never touched, so there is nothing to restore.
 *
 * The strip can also be dismissed outright (its ×). Dismissal is
 * not the end of the labeling: while the bar is hidden, DemoPill
 * (below) stays in the topbar — a small DEMO tag whose menu holds
 * "Show the demo bar" and "Exit demo" — so sample data is never
 * on screen without a demo marker. The dismissal is keyed to the
 * demo session's start stamp (lib/demoMode.ts): it survives page
 * loads inside one demo session and a fresh demo start shows the
 * bar again.
 *
 * The bar and the pill also carry the way OUT to a real account
 * (2026-11-03): a primary sign-in action. With a stored session
 * it reads "Switch to my account" and simply exits the demo back
 * to the visitor's real data; without one it asks the account
 * control to open the sign-in card (lib/auth requestSignIn) —
 * there is no second sign-in form here. "Exit demo" stays the
 * plain log-out-of-the-demo action beside it. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DEMO_EVENT,
  setDemoBarDismissed,
  setDemoMode,
  useDemoBarDismissed,
  useDemoMode,
} from "@/lib/demoMode";
import { AUTH_EVENT, loadSession, requestSignIn } from "@/lib/auth";

const WELCOMED_KEY = "rf.demo.welcomed";

/* Leaving the demo: clear the flag and, away from the landing,
 * land there — the demo's entry point and the sign-in live there. */
export function useDemoExit() {
  const pathname = usePathname();
  const router = useRouter();
  return () => {
    setDemoMode(false);
    if (pathname && pathname !== "/") router.push("/");
  };
}

/* The demo chrome's primary action: get from the demo to a real
 * account. A stored session means the visitor signed in before
 * entering the demo, so the action is a switch — exit the demo
 * and land on their own garage, real data and all. No session
 * means the action opens the account control's sign-in card by
 * event (requestSignIn); completing any auth there exits the
 * demo too (AccountControl's handleAuthed / fragment path). */
export function useDemoSignInAction() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const read = () => setHasSession(Boolean(loadSession()?.token));
    read();
    window.addEventListener(AUTH_EVENT, read);
    window.addEventListener(DEMO_EVENT, read);
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener(AUTH_EVENT, read);
      window.removeEventListener(DEMO_EVENT, read);
      window.removeEventListener("focus", read);
    };
  }, []);

  const act = () => {
    if (loadSession()?.token) {
      setDemoMode(false);
      router.push("/garage/");
    } else {
      requestSignIn();
    }
  };
  return { hasSession, act };
}

export default function DemoBar() {
  const demo = useDemoMode();
  const barDismissed = useDemoBarDismissed();
  const [welcomed, setWelcomed] = useState(true);
  const exit = useDemoExit();
  const signIn = useDemoSignInAction();

  useEffect(() => {
    if (!demo) return;
    try {
      setWelcomed(window.sessionStorage.getItem(WELCOMED_KEY) === "1");
    } catch {
      setWelcomed(true);
    }
  }, [demo]);

  if (!demo || barDismissed) return null;

  const dismissWelcome = () => {
    try {
      window.sessionStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      /* ignore */
    }
    setWelcomed(true);
  };

  return (
    <div className="demo-bar" role="region" aria-label="Demo mode">
      <div className="demo-bar-row">
        <span className="demo-bar-tag">Demo</span>
        <span className="demo-bar-text">
          Sample data — chat answers are recorded from real runs, nothing here
          is live. Sign in to switch to your own account; Exit demo just
          logs you out of the demo — nothing here is saved to an account,
          and your real data is untouched.
        </span>
        <button type="button" className="demo-bar-signin" onClick={signIn.act}>
          {signIn.hasSession ? "Switch to my account" : "Sign in to your account"}
        </button>
        <button
          type="button"
          className="demo-bar-exit"
          title="Log out of the demo — sample data stays behind, your real data is untouched"
          onClick={exit}
        >
          Exit demo
        </button>
        <button
          type="button"
          className="demo-bar-dismiss"
          aria-label="Dismiss demo bar"
          title="Hide this bar — a DEMO pill stays in the top bar"
          onClick={() => setDemoBarDismissed(true)}
        >
          ×
        </button>
      </div>
      {!welcomed && (
        <div className="demo-bar-welcome">
          <p>
            <strong>Welcome to the RobotForge demo.</strong> No account
            needed. It&apos;s the real app with two sample TurtleBots and
            a starter parts shelf. Wrench, your build partner, answers from
            recorded real runs, so nothing here is live or costs anything,
            and your own data is never touched. Try this:
          </p>
          <ol className="demo-steps">
            <li><Link href="/garage/" onClick={dismissWelcome}>Open the TurtleBot in the Workshop</Link> and spin it in 3D.</li>
            <li>Ask Wrench to change something, like &ldquo;make the wheels 80 mm&rdquo;.</li>
            <li><Link href="/garage/#tab=simulate" onClick={dismissWelcome}>Simulate it</Link> on a slope and a kerb.</li>
            <li><Link href="/garage/#tab=bom" onClick={dismissWelcome}>See its parts list</Link> and what you already have.</li>
          </ol>
          <button type="button" className="btn btn-primary btn-sm" onClick={dismissWelcome}>
            Start exploring
          </button>
        </div>
      )}
    </div>
  );
}

/* The persistent DEMO marker shown while the bar is dismissed.
 * Mounted in the app topbar and the landing header; renders
 * nothing unless demo mode is on AND the bar is hidden. Its menu
 * is the exit ramp that survives the dismissal: the sign-in /
 * switch action goes to a real account, "Show the demo bar"
 * restores the strip, "Exit demo" logs out of the demo. */
export function DemoPill() {
  const demo = useDemoMode();
  const barDismissed = useDemoBarDismissed();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const exit = useDemoExit();
  const signIn = useDemoSignInAction();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  if (!demo || !barDismissed) return null;

  return (
    <div className="demo-pill" ref={rootRef}>
      <button
        type="button"
        className="demo-pill-btn"
        aria-expanded={open}
        aria-label="Demo mode options"
        onClick={() => setOpen((o) => !o)}
      >
        Demo
      </button>
      {open && (
        <div className="demo-pill-menu" role="menu" aria-label="Demo mode">
          <p className="demo-pill-note">
            Demo mode — sample data, recorded answers. Sign in to switch
            to your own robots and parts, or Exit demo to log out of the
            demo. Your own data is untouched either way, and nothing
            from the demo is saved to an account.
          </p>
          <button
            type="button"
            role="menuitem"
            className="demo-pill-primary"
            onClick={() => {
              setOpen(false);
              signIn.act();
            }}
          >
            {signIn.hasSession ? "Switch to my account" : "Sign in to your account"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDemoBarDismissed(false);
              setOpen(false);
            }}
          >
            Show the demo bar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              exit();
            }}
          >
            Exit demo
          </button>
        </div>
      )}
    </div>
  );
}
