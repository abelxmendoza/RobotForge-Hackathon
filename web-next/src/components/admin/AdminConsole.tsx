"use client";
/* The founder admin console: everyone who has an account on
 * RobotForge, and everyone who has actually logged in.
 *
 * Data comes from GET /auth/admin/users on the live endpoint,
 * fetched with the founder's own session. The endpoint re-checks
 * the founder role server-side — this component's role checks are
 * only about showing the right message; they grant nothing. The
 * operator token is never used in the browser.
 *
 * Demo mode makes no Worker calls (the demo rule), so in the demo
 * this page explains itself instead of fetching. Accounts created
 * before login stamping existed carry no lastLoginAt; the table
 * says "Not since tracking began" rather than inventing a time. */
import { useCallback, useEffect, useState } from "react";
import {
  AUTH_EVENT,
  authMe,
  loadSession,
  requestSignIn,
  type AuthUser,
} from "@/lib/auth";
import { fetchConsoleUsers, formatStamp, summarizeUsers, type ConsoleUser } from "@/lib/admin";
import { isDemoMode, useDemoMode } from "@/lib/demoMode";
import { PROVIDER_LABELS } from "@/components/shell/SignInCard";

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; user: AuthUser }
  | { kind: "error"; msg: string }
  | { kind: "ready"; users: ConsoleUser[]; fetchedAt: number };

function roleBadge(role: string) {
  if (role === "founder") return <span className="fbadge live">FOUNDER</span>;
  if (role === "admin") return <span className="fbadge local">ADMIN</span>;
  return <span className="fbadge recorded">USER</span>;
}

function providerLabel(provider: string | undefined): string {
  if (!provider || provider === "password") return "Email";
  return PROVIDER_LABELS[provider] || provider;
}

export default function AdminConsole() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const inDemo = useDemoMode();

  const load = useCallback(async () => {
    if (isDemoMode()) return; // the demo never calls the Worker
    const session = loadSession();
    if (!session) {
      setState({ kind: "signed-out" });
      return;
    }
    setState({ kind: "loading" });
    try {
      /* Re-read the account from the endpoint so a stale stored
       * role (granted or revoked since sign-in) is not what the
       * console trusts for its own message. */
      const me = await authMe(session.token);
      if (me.role !== "founder") {
        setState({ kind: "forbidden", user: me });
        return;
      }
      const users = await fetchConsoleUsers(session.token);
      setState({ kind: "ready", users, fetchedAt: Date.now() });
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Sign-in / sign-out anywhere updates the stored session; follow it. */
  useEffect(() => {
    const onAuth = () => load();
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, [load]);

  if (inDemo) {
    return (
      <div className="state-box">
        You&apos;re in the demo — sample data, no real accounts. Exit the demo
        and sign in with the founder account to see everyone who has
        logged in.
      </div>
    );
  }

  if (state.kind === "loading") {
    return <div className="state-box">Loading the account list…</div>;
  }

  if (state.kind === "signed-out") {
    return (
      <div className="state-box">
        <p>The admin console is for the founder account. Sign in to see it.</p>
        <p>
          <button type="button" className="btn" onClick={() => requestSignIn()}>
            Sign in
          </button>
        </p>
      </div>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <div className="state-box">
        You&apos;re signed in as {state.user.email} ({state.user.role}) — the
        admin console is for the founder account only, and the server
        enforces that, not just this page.
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="state-box">
        <p role="alert">{state.msg}</p>
        <p>
          <button type="button" className="btn" onClick={load}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  const { users, fetchedAt } = state;
  const summary = summarizeUsers(users, fetchedAt);
  const roleLine = Object.entries(summary.byRole)
    .map(([r, n]) => `${n} ${r}${n === 1 ? "" : "s"}`)
    .join(" · ");
  const providerLine = Object.entries(summary.byProvider)
    .map(([p, n]) => `${n} via ${providerLabel(p)}`)
    .join(" · ");

  return (
    <section className="section">
      <div className="admin-stats">
        <div className="fstage admin-stat">
          <span className="admin-stat-n">{summary.total}</span>
          <span className="admin-stat-l">Accounts</span>
        </div>
        <div className="fstage admin-stat">
          <span className="admin-stat-n">{summary.loggedIn}</span>
          <span className="admin-stat-l">Have logged in</span>
        </div>
        <div className="fstage admin-stat">
          <span className="admin-stat-n">{summary.active7d}</span>
          <span className="admin-stat-l">Logged in, last 7 days</span>
        </div>
        <div className="fstage admin-stat">
          <span className="admin-stat-n">{summary.new30d}</span>
          <span className="admin-stat-l">New, last 30 days</span>
        </div>
      </div>
      <p className="fbadge-note" style={{ margin: "10px 0 14px" }}>
        {roleLine}
        {providerLine ? ` — ${providerLine}` : ""} · As of{" "}
        {new Date(fetchedAt).toLocaleTimeString()} ·{" "}
        <button type="button" className="btn btn-sm" onClick={load}>
          Refresh
        </button>
      </p>

      <div className="g-tablewrap">
        <table className="g-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Via</th>
              <th>Signed up</th>
              <th>Last login</th>
              <th>Logins</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <td>
                  <strong>{u.name || u.email}</strong>
                  <br />
                  <span className="fbadge-note">{u.email}</span>
                </td>
                <td>{roleBadge(u.role)}</td>
                <td>{providerLabel(u.provider)}</td>
                <td>{formatStamp(u.createdAt, "—")}</td>
                <td>{formatStamp(u.lastLoginAt, "Not since tracking began")}</td>
                <td>{u.loginCount || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fbadge-note" style={{ marginTop: 12 }}>
        Most recent logins first. Only the founder account can open this
        list — the endpoint checks the role on every request.
      </p>
    </section>
  );
}
