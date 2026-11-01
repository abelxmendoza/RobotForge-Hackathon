"use client";
/* The demo chrome: a slim in-flow strip at the very top of every
 * page while demo mode is on — the page underneath stays fully
 * visible and usable (Abel's rule: no stacked panels). The first
 * entry in a browser session expands it once with what the demo
 * is; after that it stays one line: "Demo · sample data" + Exit.
 * Exit only clears the flag — the visitor's real stores were
 * never touched, so there is nothing to restore. */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setDemoMode, useDemoMode } from "@/lib/demoMode";

const WELCOMED_KEY = "rf.demo.welcomed";

export default function DemoBar() {
  const demo = useDemoMode();
  const [welcomed, setWelcomed] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!demo) return;
    try {
      setWelcomed(window.sessionStorage.getItem(WELCOMED_KEY) === "1");
    } catch {
      setWelcomed(true);
    }
  }, [demo]);

  if (!demo) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      /* ignore */
    }
    setWelcomed(true);
  };

  const exit = () => {
    setDemoMode(false);
    if (pathname && pathname !== "/") router.push("/");
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
      </div>
      {!welcomed && (
        <div className="demo-bar-welcome">
          <p>
            <strong>You&apos;re exploring the RobotForge demo.</strong> It is
            the real app, preloaded: a demo copy of the TurtleBot3 Burger in
            the Workshop, the robot catalogue, and a sample inventory split
            into real vs sim-only parts and tools. Wrench, the guide, answers
            from recorded real runs — live AI is off in the demo, so it costs
            nothing and claims nothing it didn&apos;t do. Anything you change
            lives in the demo sandbox only; your own robots and parts are
            never touched. For live AI and your own shelf, exit and sign in.
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={dismiss}>
            Start exploring
          </button>
        </div>
      )}
    </div>
  );
}
