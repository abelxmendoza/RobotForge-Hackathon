"use client";
/* The login-or-demo gate (Abel, 2026-11-01): the app — Workshop,
 * Robodex, Kit, Garage, Inventory, Evidence, Wrench — is usable
 * only with (a) a valid account session or (b) demo mode on.
 * Everything else about the shell (sidebar, topbar with the
 * Sign in control and "Try the demo") stays visible: those are
 * the door, not the room. The landing page and the legal pages
 * (/privacy/, /data-deletion/) don't mount this gate at all
 * (AppShell's `gate` prop) and stay fully public.
 *
 * Enforcement notes:
 * - Children are NOT rendered until the check resolves, so no
 *   gated component mounts, no gated data loads, and there is
 *   no flash of app content for a signed-out visitor.
 * - A stored session is validated against the Worker's
 *   /auth/me on load. An expired/revoked token clears the
 *   stored session and lands on the gate with a quiet
 *   "session expired" note — never a half-open app.
 * - Demo mode is checked first and re-checked on the demo
 *   event: while the demo flag is on, the app runs exactly as
 *   the demo built it (lib/demoMode.ts — zero Worker calls).
 * - Sign-in/out anywhere (topbar, landing header, this gate)
 *   goes through lib/auth.ts saveSession, which fires
 *   AUTH_EVENT; the gate re-evaluates on it, so unlocking and
 *   locking are immediate, no reload needed. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AUTH_EVENT,
  authMe,
  captureFragmentAuth,
  loadSession,
  saveSession,
} from "@/lib/auth";
import { DEMO_EVENT, isDemoMode } from "@/lib/demoMode";
import { usePathname } from "next/navigation";
import SignInCard from "./SignInCard";
import DemoEntryButton from "./DemoEntryButton";
import ChatBar from "@/components/chat/ChatBar";

type GateState =
  | { status: "checking" }
  | { status: "open"; via: "account" | "demo" }
  | { status: "locked"; expired: boolean };

const GateCtx = createContext<GateState>({ status: "open", via: "account" });

export function GateProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState<GateState>({ status: "checking" });
  /* The token this gate has already validated in this page
   * session: re-checks (auth events, storage events) trust it
   * instead of calling /auth/me in a loop. */
  const validatedRef = useRef<string | null>(null);
  /* Sticky "the stored session turned out to be dead" flag. The
   * topbar account control validates the same token in parallel
   * and clears it too; its auth event must not erase the expired
   * note this gate is about to show, so the flag lives outside
   * the state transitions and only a successful validation (or
   * entering the demo) clears it. A deliberate sign-out starts
   * from a validated session, whose flag is already false. */
  const expiredRef = useRef(false);

  const validate = useCallback(async (token: string) => {
    try {
      const user = await authMe(token);
      validatedRef.current = token;
      expiredRef.current = false;
      const stored = loadSession();
      if (!stored || stored.token !== token ||
          JSON.stringify(stored.user) !== JSON.stringify(user)) {
        saveSession({ token, user });
      }
      setState({ status: "open", via: "account" });
    } catch {
      validatedRef.current = null;
      expiredRef.current = true;
      saveSession(null);
      setState({ status: "locked", expired: true });
    }
  }, []);

  const evaluate = useCallback(() => {
    if (isDemoMode()) {
      expiredRef.current = false;
      setState({ status: "open", via: "demo" });
      return;
    }
    const stored = loadSession();
    if (!stored) {
      validatedRef.current = null;
      setState({ status: "locked", expired: expiredRef.current });
      return;
    }
    if (validatedRef.current === stored.token) {
      setState({ status: "open", via: "account" });
      return;
    }
    void validate(stored.token);
  }, [validate]);

  /* First check on mount. A social-login redirect can land on a
   * gated URL with #auth=<token> (the Worker normally aims at
   * the site root, where the landing's account control captures
   * it — this is belt and braces): capture and validate it here
   * too. captureFragmentAuth scrubs the fragment, so whichever
   * surface runs second simply finds the stored session. */
  useEffect(() => {
    if (!enabled) return;
    const frag = captureFragmentAuth();
    if (frag.token) {
      void validate(frag.token);
      return;
    }
    evaluate();
  }, [enabled, evaluate, validate]);

  /* React to the world changing around the gate: sign-in/out on
   * any surface (AUTH_EVENT from saveSession), demo on/off,
   * and cross-tab changes. */
  useEffect(() => {
    if (!enabled) return;
    const onChange = () => evaluate();
    window.addEventListener(AUTH_EVENT, onChange);
    window.addEventListener(DEMO_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(AUTH_EVENT, onChange);
      window.removeEventListener(DEMO_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [enabled, evaluate]);

  if (!enabled) {
    return (
      <GateCtx.Provider value={{ status: "open", via: "account" }}>
        {children}
      </GateCtx.Provider>
    );
  }
  return <GateCtx.Provider value={state}>{children}</GateCtx.Provider>;
}

function GateScreen({ expired }: { expired: boolean }) {
  /* Entering the demo keeps you on the page you came for (e.g. /demo/). */
  const pathname = usePathname();
  return (
    <div className="gate">
      <div className="gate-intro">
        <div className="eyebrow">Members&apos; workshop</div>
        <h2>Sign in to use the app — or take the demo</h2>
        <p>
          The Workshop, Robodex, Kit, Garage, Inventory and Wrench
          run on an account, because live AI spends real model
          budget. The landing page stays public, and the demo is
          the no-account way in.
        </p>
        {expired && (
          <p className="gate-expired" role="status">
            Your session expired — sign in again to keep going.
          </p>
        )}
      </div>
      <div className="gate-cards">
        <SignInCard onAuthed={(s) => saveSession(s)} hideDemo />
        <div className="acct-card gate-demo">
          <span className="fbadge local">NO ACCOUNT</span>
          <div>
            <h2>Try the demo first</h2>
            <p className="acct-sub">
              The real app, preloaded with clearly-labeled sample
              robots and parts. Recorded answers only — the demo
              never calls the live endpoint, so it costs nothing
              and asks for nothing.
            </p>
          </div>
          <DemoEntryButton className="btn btn-primary acct-cta" label="Enter the demo" to={pathname || "/garage/"} />
          <p className="acct-note">
            Exit any time from the demo bar. Your own robots and
            inventory are never touched — the demo keeps its own
            separate sandbox on this device.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AppGate({ children }: { children: ReactNode }) {
  const state = useContext(GateCtx);
  if (state.status === "open") return <>{children}</>;
  if (state.status === "checking") {
    return (
      <div className="gate gate--checking" aria-busy="true">
        <p className="gate-checking">Checking your session…</p>
      </div>
    );
  }
  return <GateScreen expired={state.expired} />;
}

/* The chat bar is app surface too: it mounts only when the gate
 * is open (signed in or demo), exactly like the page content. */
export function GatedChatBar() {
  const state = useContext(GateCtx);
  return state.status === "open" ? <ChatBar /> : null;
}
