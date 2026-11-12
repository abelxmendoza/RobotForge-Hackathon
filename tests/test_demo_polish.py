"""Demo polish (web-next): the dismissable demo bar + DEMO pill,
demo entry from a signed-in account, and the fresh, guided demo seed.

Two layers, following the repo's node-test pattern:

1. Static wiring + honesty: the bar's x and the pill's exit exist
   and are mounted in both topbars; the signed-in panel carries
   "Start demo"; the demo never revalidates a session against the
   Worker; the seed's labels survive the deepening (every seeded
   name still says demo, the PLANNED version uses the garage's
   planned flag, every catalogue id the seed names exists).
2. Node unit tests: the bar dismissal is keyed to the demo
   session's start stamp — it persists inside one demo session
   and a fresh demo start shows the bar again.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
LIB = WEB / "src/lib"
SHELL = WEB / "src/components/shell"


# ---------------------------------------------------------------- wiring

def test_side_menu_has_no_demo_entry_but_the_real_doors_stay():
    """Abel (2026-11-01): "the demo in the side menu sucks, take it
    out." The AppShell sidebar NAV carries no demo entry; the demo
    itself is untouched — the landing keeps its RunDemoLink entries
    and the signed-in account panel keeps "Start demo"."""
    shell = (SHELL / "AppShell.tsx").read_text()
    nav = shell.split("const NAV = [", 1)[1].split("];", 1)[0]
    assert 'id: "demo"' not in nav
    assert '"/demo/"' not in nav
    # Keep the primary destinations in order; rover design lives in Workshop.
    ids = re.findall(r'id: "(\w+)"', nav)
    # BOM wizard and Evidence left the nav on 2026-11-01; /evidence/
    # stays reachable from robot pages, the demo and Wrench.
    # 2026-11-12 simplify: Workshop, Library, Robots; Home is the logo.
    assert ids == ["workshop", "inventory", "robots"], ids
    # Rover design is Wrench + the Workshop's Kit panel, not a separate flow.
    studio = (SHELL.parent / "garage" / "WorkshopStudio.tsx").read_text()
    assert "RoverKitPanel" in studio
    assert not (SHELL.parent / "design" / "RoverDesigner.tsx").exists()
    landing = (WEB / "src/app/page.tsx").read_text()
    assert "RunDemoLink" in landing
    chrome = (WEB / "src/components/home/LandingChrome.tsx").read_text()
    assert "Run the demo" in chrome
    acct = (SHELL / "AccountControl.tsx").read_text()
    assert "Start demo" in acct


def test_demo_bar_is_dismissable_and_the_pill_keeps_the_exit():
    bar = (SHELL / "DemoBar.tsx").read_text()
    # The slim bar gains a real dismiss control wired to the
    # since-keyed dismissal in lib/demoMode.ts.
    assert 'aria-label="Dismiss demo bar"' in bar
    assert "setDemoBarDismissed(true)" in bar
    assert "barDismissed" in bar  # the bar renders nothing while dismissed
    # The pill: visible marker + menu with both recovery actions.
    assert "export function DemoPill" in bar
    assert "Show the demo bar" in bar
    assert "Exit demo" in bar
    assert "setDemoBarDismissed(false)" in bar


def test_demo_welcome_is_a_short_guided_path():
    bar = (SHELL / "DemoBar.tsx").read_text()
    # Fresh and guided (2026-11-01): four steps with links, not a
    # wall of text about a lived-in workspace.
    assert 'className="demo-steps"' in bar
    for href in ('"/garage/"', '"/garage/#tab=simulate"', '"/garage/#tab=bom"'):
        assert href in bar, href
    assert "lived-in" not in bar
    # Abel's copy correction: Wrench is the build partner, not a guide.
    assert "build partner" in bar
    assert "Wrench, the guide" not in bar


def test_pill_and_identity_are_mounted_in_both_topbars():
    for chrome in ("AppShell.tsx", "LandingChrome.tsx"):
        src = (WEB / "src/components" / ("shell" if chrome == "AppShell.tsx" else "home") / chrome).read_text()
        assert "DemoPill" in src, chrome
        assert "DemoIdentity" in src, chrome


def test_demo_identity_is_an_obvious_sample_persona():
    ident = (SHELL / "DemoIdentity.tsx").read_text()
    assert "Demo account" in ident
    assert "Sam Rivera" in ident
    # Never the operator's real identity.
    assert "Abel" not in ident
    assert "abelxmendoza" not in ident
    # With a real session present the persona stands down — the
    # account chip already says who is signed in.
    assert "loadSession" in ident


def test_account_menu_starts_the_demo_and_the_demo_skips_revalidation():
    acct = (SHELL / "AccountControl.tsx").read_text()
    # Signed-in panel: Start demo (and Exit demo while in it),
    # entering through the same seed + flag as the anonymous path.
    assert "Start demo" in acct
    assert "seedDemoStores" in acct
    assert "setDemoMode(true)" in acct
    # Since the demo-login fix (tests/test_demo_login.py) the
    # in-demo panel action is labelled as what it does for a
    # signed-in visitor: switch back to their real account.
    assert "Switch to my account" in acct
    # The demo makes no Worker calls: a stored session is adopted
    # as-is, never refreshed against /auth/me while the flag is on.
    assert "isDemoMode() && !frag.token" in acct
    # The sign-in card's guest block carries the demo entry too —
    # since PR #68 the card lives in SignInCard.tsx.
    card = (SHELL / "SignInCard.tsx").read_text()
    assert "DemoEntryButton" in card
    assert 'label="Try the demo"' in card


# ---------------------------------------------------------------- seed

def _seed_source() -> str:
    return (LIB / "demoSeed.ts").read_text()


def test_seed_labels_survive_the_deepening():
    seed = _seed_source()
    # Every named seed entry still carries its demo marker.
    for name in re.findall(r"name: '([^']+)'", seed):
        assert "(demo" in name, name
    assert "(demo sample)" in seed
    assert "Demo sample data" in seed  # SAMPLE_NOTE intact
    assert "sim-only" in seed


def test_seed_garage_is_two_fresh_turtlebots():
    seed = _seed_source()
    assert "demo-turtlebot3-burger" in seed
    assert "demo-turtlebot3-waffle-pi" in seed
    assert "turtlebot3-burger.json" in seed and "photo-turtlebot.json" in seed
    # No invented history: no planned versions, no Pathfinder, and
    # the photo draft says its numbers are estimates.
    assert "planned: true" not in seed
    assert "demo-pathfinder" not in seed
    assert "ESTIMATED" in seed
    # Re-entry preserves the demo account and all visitor changes.
    assert "resetDemoSandbox()" not in seed
    assert "writeIfAbsent(GARAGE_KEY + '.demo', robots)" in seed


def test_seed_inventory_is_a_small_starter_shelf():
    seed = _seed_source()
    # No fake wear or spread-out dates: the visitor makes the history.
    assert "condition: 'used'" not in seed
    assert "retired" not in seed.lower()
    dates = set(re.findall(r"createdAt: '(\d{4}-\d{2}-\d{2})", seed))
    assert len(dates) <= 1


def test_seed_catalogue_ids_all_exist():
    seed = _seed_source()
    catalog = json.loads((REPO / "catalog" / "parts.json").read_text())
    ids = {p["id"] for p in catalog["parts"]}
    referenced = set(re.findall(r"simFromCatalog\('([a-z0-9_]+)'", seed))
    referenced |= set(re.findall(r"catalogPart\('([a-z0-9_]+)'", seed))
    assert referenced, "seed should reference the catalogue"
    assert referenced <= ids, f"seed names missing catalogue parts: {referenced - ids}"


def test_demo_thread_starts_empty_and_never_leaks():
    dock = (WEB / "src/components/chat" / "ChatDock.tsx").read_text()
    assert "DEMO_THREAD_QUESTIONS" not in dock
    # The visitor's real thread is still snapshotted and restored.
    assert "demoThreadRef" in dock
    assert "setMessages(snapshot.messages)" in dock


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';

// Fake browser storage: string maps + event no-ops, enough for
// lib/demoMode.ts's storage helpers (the React hooks in the file
// are never invoked here).
const makeStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};
globalThis.window = {
  localStorage: makeStore(),
  sessionStorage: makeStore(),
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

const D = await import('./demoMode.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// No demo running: nothing is dismissed.
assert.equal(D.isDemoBarDismissed(), false);

// Enter the demo: the bar starts visible.
D.setDemoMode(true);
assert.equal(D.isDemoMode(), true);
assert.equal(D.isDemoBarDismissed(), false);

// Dismiss it: hidden now, and the answer is a pure storage read,
// so it stays hidden across page loads inside this demo session.
D.setDemoBarDismissed(true);
assert.equal(D.isDemoBarDismissed(), true);
assert.equal(D.isDemoBarDismissed(), true);

// Exit and start a FRESH demo (new start stamp): the dismissal
// was keyed to the old stamp, so the bar shows again.
D.setDemoMode(false);
await sleep(10);
D.setDemoMode(true);
assert.equal(D.isDemoBarDismissed(), false);

// Dismiss + restore inside the new session round-trips too.
D.setDemoBarDismissed(true);
assert.equal(D.isDemoBarDismissed(), true);
D.setDemoBarDismissed(false);
assert.equal(D.isDemoBarDismissed(), false);

console.log('demo bar dismissal unit checks passed');
"""


def _prep_unit_dir(tmp: Path) -> None:
    (tmp / "package.json").write_text('{"type":"module"}')
    (tmp / "demoMode.ts").write_text((LIB / "demoMode.ts").read_text())
    (tmp / "node_modules").symlink_to(WEB / "node_modules")


def test_demo_bar_dismissal_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    _prep_unit_dir(tmp_path)
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr


def test_run_demo_opens_populated_workshop_even_with_account():
    entry = (SHELL / "RunDemoLink.tsx").read_text()
    assert 'to = "/garage/"' in entry
    assert "loadSession" not in entry
    assert entry.index("await seedDemoStores()") < entry.index("setDemoMode(true)")
    acct = (SHELL / "AccountControl.tsx").read_text()
    start = acct.split("const startDemo", 1)[1].split("}, [router])", 1)[0]
    assert start.index("await seedDemoStores()") < start.index("setDemoMode(true)")


def test_demo_turtlebots_share_workshop_and_my_robots_store():
    source = (WEB / "src/components/robots/DexSources.tsx").read_text()
    assert "useStore<GarageRobot[]>(GARAGE_KEY, [])" in source
    assert 'overrides[garageKey(r.id)] ?? "mine"' in source
    seed = _seed_source()
    assert "GARAGE_KEY + '.demo'" in seed
    assert "writeIfAbsent(GARAGE_KEY," not in seed


def test_demo_seed_is_populated_persistent_and_isolated(tmp_path):
    """Execute the actual seed with the catalogue and both recorded specs."""
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    script = r'''
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require(process.argv[2] + '/web-next/node_modules/typescript');
const root = process.argv[2];
let source = fs.readFileSync(root + '/web-next/src/lib/demoSeed.ts', 'utf8');
source = source.replace(/^import .*;\n/gm, '');
source = `const parts = ${JSON.stringify(JSON.parse(fs.readFileSync(root + '/catalog/parts.json')).parts)};
const GARAGE_KEY='rf.garage.v1', INVENTORY_KEY='rf.inventory.v1', OWNERSHIP_KEY='rf.ownership.v1';
const assetPath = x => x;
` + source;
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const data = new Map([['rf.garage.v1', 'real robots untouched'], ['rf.inventory.v1', 'real shelf untouched']]);
global.window = {localStorage: {getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v)}};
global.fetch = async path => ({ok: true, json: async () => JSON.parse(fs.readFileSync(root + '/' + path))});
const mod = {exports:{}};
new Function('exports', 'module', compiled)(mod.exports,mod);
(async () => {
 await mod.exports.seedDemoStores();
 const robots = JSON.parse(data.get('rf.garage.v1.demo'));
 assert.deepEqual(robots.map(r=>r.id), ['demo-turtlebot3-burger','demo-turtlebot3-waffle-pi']);
 assert.ok(robots.every(r=>r.versions[0].spec));
 robots[0].name = 'My edited demo Burger';
 data.set('rf.garage.v1.demo', JSON.stringify(robots));
 await mod.exports.seedDemoStores();
 assert.equal(JSON.parse(data.get('rf.garage.v1.demo'))[0].name, 'My edited demo Burger');
 assert.equal(data.get('rf.garage.v1'), 'real robots untouched');
 assert.equal(data.get('rf.inventory.v1'), 'real shelf untouched');
 assert.ok([...data.keys()].filter(k=>!['rf.garage.v1','rf.inventory.v1'].includes(k)).every(k=>k.endsWith('.demo')));
})().catch(e=>{console.error(e);process.exitCode=1});
'''
    runner = tmp_path / "seed.cjs"
    runner.write_text(script)
    result = subprocess.run([node, str(runner), str(REPO)], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr


def test_mounted_workshop_switches_stores_on_demo_entry_and_exit():
    source = (LIB / "store.ts").read_text()
    assert "const onDemoChange = () => setValue(readStore(key, fallback))" in source
    assert "window.addEventListener(DEMO_EVENT, onDemoChange)" in source
    assert "window.removeEventListener(DEMO_EVENT, onDemoChange)" in source
