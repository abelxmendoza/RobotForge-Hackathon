"""Founder admin console (Abel, 2026-11-04: "make an admin console
for the founder account and make sure to show all the people who
have logged in").

Shape of the build:

1. The Worker stamps every successful sign-in (register counts as
   the first) with lastLoginAt + loginCount, and serves the roster
   at GET /auth/admin/users — gated by the caller's own session and
   the founder role, NEVER by the operator token (that secret must
   not reach a browser). The operator route keeps working for
   Muse's out-of-band administration. Behavior is exercised for
   real in tests/worker_mock.mjs (the stamping + gating scenarios);
   this file pins the web wiring.
2. The site gains an /admin page whose console component carries
   the founder's session to that route, plus a founder-only link in
   the account panel. Non-founders get a plain explanation; the
   demo never fetches (the demo rule: no Worker calls).
"""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
WORKER = (REPO / "live" / "worker.js").read_text()


def _admin_lib() -> str:
    return (WEB / "src/lib" / "admin.ts").read_text()


def _console() -> str:
    return (WEB / "src/components" / "admin" / "AdminConsole.tsx").read_text()


def test_worker_console_route_is_session_and_founder_gated():
    assert "url.pathname === '/auth/admin/users'" in WORKER
    assert "handleConsoleUsers" in WORKER
    block = WORKER.split("async function handleConsoleUsers")[1].split(
        "async function")[0]
    # Session first (401), role second (403) — and no operator token
    # anywhere in the console guard.
    assert "sessionUser(request, env)" in block
    assert "401" in block and "'unauthorized'" in block
    assert "me.role !== 'founder'" in block
    assert "403" in block and "'founder_only'" in block
    assert "OPERATOR_TOKEN" not in block
    assert "X-Operator-Token" not in block


def test_worker_stamps_every_sign_in_path():
    # Register creates the record already stamped (first login).
    assert "lastLoginAt: new Date().toISOString(), loginCount: 1" in WORKER
    # Password login re-stamps before the session is minted.
    assert "await stampLogin(env, user);" in WORKER
    # OAuth callback re-stamps returning accounts.
    callback = WORKER.split("handleOAuthCallback")[1].split(
        "/* ----------------")[0]
    assert "stampLogin" in callback
    # The stamps are public fields; the hash still never leaves.
    pub = WORKER.split("function publicUser")[1].split("\n}\n")[0]
    assert "lastLoginAt" in pub and "loginCount" in pub
    assert "passHash" not in pub


def test_admin_lib_fetches_with_the_session_only():
    lib = _admin_lib()
    assert 'liveBase + "/auth/admin/users"' in lib
    assert "Authorization" in lib and "Bearer " in lib
    # The operator token must never appear in browser code.
    assert "OPERATOR_TOKEN" not in lib
    assert "X-Operator-Token" not in lib
    # Summary + honest stamp formatting are pure, named helpers.
    assert "export function summarizeUsers" in lib
    assert "export function formatStamp" in lib


def test_console_page_and_component_wiring():
    page = (WEB / "src/app" / "admin" / "page.tsx").read_text()
    assert "AdminConsole" in page and "AppShell" in page
    con = _console()
    # The component verifies the role against the endpoint, not
    # just the stored session, and follows auth changes.
    assert "authMe(session.token)" in con
    assert 'me.role !== "founder"' in con
    assert "fetchConsoleUsers(session.token)" in con
    assert "AUTH_EVENT" in con
    # Demo rule: no Worker calls while the demo flag is on.
    assert "isDemoMode()" in con
    # The table shows logins, not just registrations.
    for col in ["Signed up", "Last login", "Logins"]:
        assert col in con
    # Pre-stamping accounts are labeled honestly, never given a time.
    assert "Not since tracking began" in con


def test_account_panel_links_the_console_for_the_founder_only():
    acct = (WEB / "src/components" / "shell" / "AccountControl.tsx").read_text()
    assert 'href="/admin"' in acct
    block = acct.split('href="/admin"')[0].rsplit("user.role ===", 1)[-1]
    assert "founder" in block  # the link sits behind the founder check
