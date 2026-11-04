"""Demo login (web-next): sign in from inside the demo and
actually switch to the real account.

The bug (Abel, 2026-11-03: "I don't see the logins any more"):
opening the sign-in card from inside the demo showed no Meta /
Google buttons, and completing a sign-in there saved a session
but left the demo flag on — so the app kept showing demo-twin
data and the visitor never switched to their own account.

Two layers, following the repo's node-test pattern:

1. Static wiring: authConfig takes an explicit opt-in and the
   card passes it; AccountControl exits the demo on email auth
   AND on the social fragment return; the demo bar and the demo
   pill both carry the sign-in / switch action; the copy says
   what logging out of the demo means.
2. Node unit tests: in demo mode the automatic authConfig()
   probe makes NO fetch and returns no providers, while the
   card's explicit probe fetches the real config; requestSignIn
   dispatches the event the account control listens for; and
   demo isolation holds — rf.auth.v1 is never a demo twin.
"""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
LIB = WEB / "src/lib"
SHELL = WEB / "src/components/shell"


def _auth() -> str:
    return (LIB / "auth.ts").read_text()


def _acct() -> str:
    return (SHELL / "AccountControl.tsx").read_text()


def _bar() -> str:
    return (SHELL / "DemoBar.tsx").read_text()


# ------------------------------------------------------- auth config

def test_auth_config_demo_behaviour_is_opt_in_not_blanket():
    auth = _auth()
    # The signature carries the explicit opt-in, and the demo
    # short-circuit only applies without it.
    assert "opts?: { explicit?: boolean }" in auth
    assert "if (isDemoMode() && !opts?.explicit) return NO_PROVIDERS;" in auth
    # The automatic path still returns the all-off config in the
    # demo (background callers stay demo-silent).
    assert "const NO_PROVIDERS: AuthConfig" in auth
    # The sign-in request event exists for the demo chrome.
    assert 'export const SIGNIN_EVENT = "rf-open-signin";' in auth
    assert "export function requestSignIn()" in auth
    assert "new CustomEvent(SIGNIN_EVENT)" in auth


def test_signin_card_probes_explicitly_and_explains_the_demo_exit():
    card = (SHELL / "SignInCard.tsx").read_text()
    # The card only renders on an explicit visitor action, so it
    # probes as one — providers show even inside the demo.
    assert "authConfig({ explicit: true })" in card
    assert "useDemoMode" in card
    # And it says, in the demo, what signing in does.
    assert "Signing in leaves the demo" in card
    assert "switches you to your own account" in card
    assert "Nothing from the demo is saved to your" in card


# ------------------------------------------------- account control

def test_account_control_exits_demo_on_email_auth():
    acct = _acct()
    assert "const handleAuthed" in acct
    assert "const wasDemo = isDemoMode();" in acct
    assert "if (wasDemo) switchToAccount();" in acct
    assert "onAuthed={handleAuthed}" in acct
    # The switch itself: flag off, land on the visitor's garage.
    assert "const switchToAccount" in acct
    assert 'router.push("/garage/")' in acct


def test_account_control_exits_demo_on_fragment_auth():
    acct = _acct()
    # The social-login return validates in the mount effect; a
    # fragment token landing while the demo flag is on exits too.
    assert "if (frag.token && isDemoMode()) switchToAccount();" in acct
    # The pre-existing demo behaviour is untouched: with the flag
    # on and NO fresh login, the stored session is adopted as-is
    # and never revalidated against the Worker.
    assert "isDemoMode() && !frag.token" in acct


def test_account_control_opens_the_card_on_the_signin_event():
    acct = _acct()
    assert "window.addEventListener(SIGNIN_EVENT, openCard)" in acct
    # The signed-in panel, while in the demo, labels its exit as
    # the switch back to the visitor's account — not a bare exit.
    assert "Switch to my account" in acct
    panel = acct.split("viewing the demo", 1)[1]
    assert "switchToAccount()" in panel.split("Start demo", 1)[0]


# ------------------------------------------------------ demo chrome

def test_demo_bar_carries_the_signin_switch_action():
    bar = _bar()
    # One shared action for bar + pill, with both labels.
    assert "export function useDemoSignInAction" in bar
    assert bar.count("Switch to my account") >= 2
    assert bar.count("Sign in to your account") >= 2
    # With a stored session the action is a plain demo exit onto
    # the visitor's own garage; without one it asks the account
    # control to open the one sign-in card — no second form here.
    assert 'router.push("/garage/")' in bar
    assert "requestSignIn()" in bar
    assert "SignInCard" not in bar
    # The plain log-out-of-the-demo action survives, explained.
    assert "Exit demo" in bar
    assert "logs you out of the demo" in bar
    assert "nothing here is saved to an account" in bar


def test_demo_pill_menu_carries_the_signin_switch_action():
    bar = _bar()
    pill = bar.split("export function DemoPill", 1)[1]
    assert "Sign in to switch" in pill
    assert "log out of the" in pill
    assert "signIn.act()" in pill
    assert "demo-pill-primary" in pill
    # The recovery actions from before are still there.
    assert "Show the demo bar" in pill
    assert "Exit demo" in pill


def test_demo_signin_actions_are_styled():
    css = (REPO / "assets/css/app.css").read_text()
    assert ".demo-bar-signin" in css
    assert ".demo-pill-primary" in css


# -------------------------------------------------------- isolation

def test_demo_isolation_still_holds_for_auth():
    demo = (LIB / "demoMode.ts").read_text()
    keys = demo.split("DEMO_DATA_KEYS", 1)[1].split("]);", 1)[0]
    # The auth key is deliberately NOT a demo twin: the session
    # is the exit ramp, and real data keys keep their twins.
    assert "rf.auth.v1" not in keys
    for key in ("rf.garage.v1", "rf.inventory.v1", "rf.assemblies.v1"):
        assert key in keys
    auth = _auth()
    assert 'const KEY = "rf.auth.v1";' in auth
    # auth.ts never routes its storage through the demo twinning.
    assert "effectiveStorageKey" not in auth


# ------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';

// Fake browser: storage maps, an event log, and a fetch stub
// that counts calls and serves a fixed /auth/config payload.
const makeStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};
const events = [];
globalThis.window = {
  localStorage: makeStore(),
  sessionStorage: makeStore(),
  location: { hash: '', pathname: '/', search: '' },
  dispatchEvent: (e) => { events.push(e.type); return true; },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.history = { replaceState: () => {} };
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

let fetches = 0;
globalThis.fetch = async (url) => {
  fetches += 1;
  assert.ok(String(url).endsWith('/auth/config'), url);
  return {
    ok: true,
    json: async () => ({
      metaLogin: true,
      providers: { meta: true, github: false, google: true },
    }),
  };
};

const A = await import('./auth.ts');
const D = await import('./demoMode.ts');

// Outside the demo the automatic probe fetches the real config.
let cfg = await A.authConfig();
assert.equal(fetches, 1);
assert.deepEqual(cfg.providers, { meta: true, github: false, google: true });

// In the demo the automatic probe stays silent: no fetch, no
// providers — background callers must not wake the Worker.
D.setDemoMode(true);
cfg = await A.authConfig();
assert.equal(fetches, 1, 'automatic probe fetched during demo');
assert.deepEqual(cfg.providers, { meta: false, github: false, google: false });
assert.equal(cfg.metaLogin, false);

// The card's explicit probe is the exit ramp: it fetches and
// returns the real providers even with the demo flag on.
cfg = await A.authConfig({ explicit: true });
assert.equal(fetches, 2);
assert.deepEqual(cfg.providers, { meta: true, github: false, google: true });

// requestSignIn dispatches exactly the event the account
// control listens for.
events.length = 0;
A.requestSignIn();
assert.deepEqual(events, ['rf-open-signin']);

// Isolation: the session key is stored verbatim in the demo,
// while visitor-data keys are twinned.
A.saveSession({ token: 't1', user: { email: 'a@b.c', name: 'A', role: 'user' } });
assert.ok(window.localStorage.getItem('rf.auth.v1'));
assert.equal(window.localStorage.getItem('rf.auth.v1.demo'), null);
assert.equal(A.loadSession().user.email, 'a@b.c');
assert.equal(D.effectiveStorageKey('rf.garage.v1'), 'rf.garage.v1.demo');
assert.equal(D.effectiveStorageKey('rf.auth.v1'), 'rf.auth.v1');
A.saveSession(null);
assert.equal(A.loadSession(), null);
assert.equal(window.localStorage.getItem('rf.auth.v1'), null);
D.setDemoMode(false);
assert.equal(A.loadSession(), null, 'exiting demo must not restore the account');
assert.equal(D.effectiveStorageKey('rf.garage.v1'), 'rf.garage.v1');

console.log('demo login unit checks passed');
"""


def test_demo_login_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    # auth.ts has two "@/..." imports; in the tmp dir they become
    # local files (the real demoMode.ts, a liveBase stub) so node
    # can strip-types the module directly, like the other suites.
    src = _auth()
    src = src.replace(
        'from "@/components/forge/live"', 'from "./live-stub.ts"')
    src = src.replace('from "@/lib/demoMode"', 'from "./demoMode.ts"')
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "auth.ts").write_text(src)
    (tmp_path / "demoMode.ts").write_text((LIB / "demoMode.ts").read_text())
    (tmp_path / "live-stub.ts").write_text(
        'export const liveBase = "https://worker.test";\n')
    (tmp_path / "node_modules").symlink_to(WEB / "node_modules")
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs")],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr


def test_no_worker_or_demo_chrome_regressions():
    """Guard rails: the chrome changes did not smuggle a second
    sign-in form, a Worker call, or a demo-twin write anywhere."""
    bar = _bar()
    assert "fetch(" not in bar
    acct = _acct()
    # The card remains the single auth surface in the control.
    assert acct.count("<SignInCard") == 1
    # Exiting the demo on auth never re-seeds or wipes anything.
    authed = acct.split("const handleAuthed", 1)[1].split("/* The demo chrome", 1)[0]
    assert "seedDemoStores" not in authed
    assert "saveSession(null)" not in authed
    assert re.search(r"switchToAccount\(\);\s*\}", authed) is not None


def test_all_demo_entries_sign_out_without_deleting_account_data():
    for name in ("RunDemoLink.tsx", "DemoEntryButton.tsx", "AccountControl.tsx"):
        source = (SHELL / name).read_text()
        entry = source.split("setDemoMode(true);", 1)[1]
        assert "saveSession(null);" in entry.split("router.push", 1)[0], name
        assert "authLogout(" not in entry.split("router.push", 1)[0], name
    account = _acct()
    assert "frag.token || loadSession()?.token === token" in account
    gate = (SHELL / "AppGate.tsx").read_text()
    assert "const sessionAtStart = loadSession()?.token" in gate
    assert "if (superseded()) return;" in gate
