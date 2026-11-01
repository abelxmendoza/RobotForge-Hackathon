"use client";
/* The demo workspace's persona: while a signed-out visitor is in
 * the demo, the topbar shows whose shelf they're looking at — a
 * clearly sample account, "Sam Rivera · Demo account", never the
 * visitor's name and never the operator's. It is chrome only: no session
 * is created, nothing is written, and the real Sign in control
 * sits right beside it as the exit ramp. When a real session
 * exists (a signed-in user who started the demo from their
 * account menu), this renders nothing — their own account chip
 * already says who they are, and stamping a second, fake identity
 * next to it would just be noise. */
import { useEffect, useState } from "react";
import { DEMO_EVENT, useDemoMode } from "@/lib/demoMode";
import { loadSession } from "@/lib/auth";

export const DEMO_PERSONA_NAME = "Sam Rivera";

export default function DemoIdentity() {
  const demo = useDemoMode();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!demo) return;
    const read = () => setSignedIn(Boolean(loadSession()?.token));
    read();
    window.addEventListener(DEMO_EVENT, read);
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener(DEMO_EVENT, read);
      window.removeEventListener("focus", read);
    };
  }, [demo]);

  if (!demo || signedIn) return null;

  return (
    <span className="demo-identity" title="You are exploring a sample account — not signed in">
      <span className="demo-identity-avatar" aria-hidden="true">SR</span>
      <span className="demo-identity-text">
        <span className="demo-identity-name">{DEMO_PERSONA_NAME}</span>
        <span className="demo-identity-label">Demo account</span>
      </span>
    </span>
  );
}
