"use client";
/* The demo chrome: a slim in-flow strip at the very top of every
 * page while demo mode is on — the page underneath stays fully
 * visible and usable (Abel's rule: no stacked panels). The first
 * entry in a browser session expands it once with what the demo
 * is; after that it stays one line: "Demo · sample data" + Exit.
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
 * bar again. */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  setDemoBarDismissed,
  setDemoMode,
  useDemoBarDismissed,
  useDemoMode,
} from "@/lib/demoMode";

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

export default function DemoBar() {
  const demo = useDemoMode();
  const barDismissed = useDemoBarDismissed();
  const [welcomed, setWelcomed] = useState(true);
  const exit = useDemoExit();

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
          is live.
        </span>
        <button type="button" className="demo-bar-exit" onClick={exit}>
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
            <strong>You&apos;re exploring the RobotForge demo.</strong> It is
            the real app, preloaded to feel lived-in: two demo robots in the
            Workshop — a TurtleBot3 Burger with a saved baseline and a
            planned upgrade, and a Pathfinder with a short build history —
            the robot catalogue, a sample inventory split into real vs
            sim-only parts and tools, and a Wrench thread already in
            progress. Wrench — the workshop&apos;s build partner, not just a
            guide — is here too: it designs specs with you in the Forge,
            carries out build operations from chat, and checks the work
            (gate results, physics, the BOM). In the demo it answers from
            recorded real runs — live AI is off in the demo, so it costs
            nothing and claims nothing it didn&apos;t do. Anything you change lives in the demo
            sandbox only; your own robots and parts are never touched. For
            live AI and your own shelf, exit and sign in. You can hide this
            bar with its × — a DEMO pill in the top bar keeps the demo
            labeled, and Exit demo lives inside it.
          </p>
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
 * is the exit ramp that survives the dismissal: "Show the demo
 * bar" restores the strip, "Exit demo" leaves the demo. */
export function DemoPill() {
  const demo = useDemoMode();
  const barDismissed = useDemoBarDismissed();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const exit = useDemoExit();

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
            Demo mode — sample data, recorded answers. Your own robots and
            parts are untouched.
          </p>
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
