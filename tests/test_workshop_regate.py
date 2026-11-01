"""Workshop re-gate (2026-11-01): the two wirings designed against
the superseded #82 tabs, audited against the landed #87 tabs and
built where the audit found them missing.

Audit evidence (main b13c298, before this change):
  - SimulateTab.tsx carried the rover field-check scenes and, for a
    catalogue match, LINKS to the robot page — no import of
    lib/gazebo.ts, no bundle offer. The Nov 1 visual pass saw the
    same: a physics summary plus a "runs on your computer" note.
  - BomTab.tsx stated in its own header "it never shows a price"
    and contained no read of rf.buildplan.v1, no resolvedPrice, no
    totals line.

What this suite pins:
  1. Simulate: the tab embeds the robot pages' own GazeboSection
     for a catalogue-matched robot (the narrow name/slug match —
     never a lookalike), so the bundle download and the recorded
     unavailable reasons are the robot pages' behaviour, not a
     re-implementation; an unmatched build gets an honest
     no-bundle card. lib/gazebo.ts availability states are
     re-verified at the three points the tab depends on.
  2. BOM: the tab reads the build-plan store through the store
     layer (demo twin, no network), resolves prices with
     resolvedPrice under the wizard's exact `part:<id>` key —
     reached only via the matched shelf part's recorded catalogue
     id — badges web-gathered figures in the wizard's language,
     leaves unrecorded lines unpriced (never $0), and totals via
     the same priceTotals() the budget check reads, unverified
     web-gathered share stated separately.
  3. The #91 verified photos coexist with the price badges: the
     photo still resolves by catalogue id only, in the same rows.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"
NODE = shutil.which("node")

SIM_TAB = (WEB / "src/components/garage/SimulateTab.tsx").read_text()
BOM_TAB = (WEB / "src/components/garage/BomTab.tsx").read_text()
ENGINE = (LIB / "buildPlan.ts").read_text()


# ------------------------------------------------------------------ #
# 1. Simulate -> Gazebo bundle
# ------------------------------------------------------------------ #

def test_simulate_tab_offers_the_robot_pages_gazebo_section():
    # The robot pages' component itself — not a second bundle UI.
    assert "from '@/components/robots/GazeboSection'" in SIM_TAB
    assert "<GazeboSection slug={match.slug} robotName={match.name} />" in SIM_TAB
    # …and that component is still the lib/gazebo.ts one.
    section = (WEB / "src/components/robots/GazeboSection.tsx").read_text()
    assert "buildGazeboLaunch" in section and "gazeboAvailability" in section


def test_simulate_match_stays_narrow():
    # The match the bundle rides on: spec name verbatim or slugified,
    # against catalogue slug/name ONLY — no fuzzy/lookalike route to
    # another robot's model.
    assert "norm(r.slug) === n || norm(r.name) === n" in SIM_TAB


def test_simulate_unmatched_build_gets_an_honest_no_bundle_state():
    assert "No bundle for this build" in SIM_TAB
    assert "never invented from the spec" in SIM_TAB
    assert "robotforge run-gate spec.json" in SIM_TAB  # the own-computer path stays


GAZEBO_AVAIL_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const { gazeboAvailability } = await import('./gazebo.ts');
const phys = JSON.parse(fs.readFileSync(root + '/catalog/physics.json', 'utf8')).robots;
const at = (slug) => gazeboAvailability({ slug, robotName: slug, physics: phys[slug] });
// a recorded URDF model: the bundle is offered
assert.deepEqual(at('turtlebot3-burger'), { ok: true, format: 'urdf' });
// a matched entry with no recorded model: unavailable, reason recorded
const mp = at('mini-pupper');
assert.equal(mp.ok, false);
assert.ok(mp.reason.includes('No model is recorded'));
// a matched entry whose model Gazebo cannot use: unavailable, reason recorded
const op3 = at('robotis-op3');
assert.equal(op3.ok, false);
assert.ok(op3.reason.includes('MJCF'));
// no catalogue entry at all: unavailable, never a borrowed model
const custom = gazeboAvailability({ slug: 'my-custom-build', robotName: 'My Custom Build', physics: undefined });
assert.equal(custom.ok, false);
assert.ok(custom.reason.includes('No Gazebo-usable model is recorded'));
console.log('workshop gazebo availability OK');
"""


def test_gazebo_availability_states_for_the_tab(tmp_path):
    assert NODE, "node is required for the TS unit tests"
    gazebo = (LIB / "gazebo.ts").read_text()
    gazebo = gazebo.replace('from "./zip"', 'from "./zip.ts"')
    gazebo = gazebo.replace(
        'import type { PhysicsEntry } from "./types";',
        "type PhysicsEntry = any;")
    (tmp_path / "gazebo.ts").write_text(gazebo)
    (tmp_path / "zip.ts").write_text((LIB / "zip.ts").read_text())
    (tmp_path / "package.json").write_text('{"type":"module"}')
    script = tmp_path / "units.mts"
    script.write_text(GAZEBO_AVAIL_SCRIPT)
    proc = subprocess.run(
        [NODE, "--experimental-strip-types", str(script), str(ROOT)],
        capture_output=True, text=True, cwd=tmp_path, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "availability OK" in proc.stdout


# ------------------------------------------------------------------ #
# 2. BOM -> build-plan prices
# ------------------------------------------------------------------ #

def test_bom_tab_reads_the_build_plan_store_demo_safely():
    assert "PROFILE_KEY" in BOM_TAB and "useStore" in BOM_TAB
    assert 'PROFILE_KEY = "rf.buildplan.v1"' in ENGINE
    # Demo safety: the store layer resolves the key to its ".demo"
    # twin, and the tab itself makes no network calls of any kind.
    assert "'rf.buildplan.v1'" in (LIB / "demoMode.ts").read_text()
    assert "effectiveStorageKey" in (LIB / "store.ts").read_text()
    for banned in ("fetch(", "postJSON", "@/lib/api", "liveHealth"):
        assert banned not in BOM_TAB, banned


def test_bom_tab_price_badges_and_totals_language():
    assert "resolvedPrice" in BOM_TAB and "priceTotals" in BOM_TAB
    # the wizard's badge language, verbatim where it matters
    assert "web-gathered estimate" in BOM_TAB
    assert "Unpriced — no price recorded in your build plan" in BOM_TAB
    assert "rests on unverified web-gathered data" in BOM_TAB
    assert "Shipping, tax and stock are unknown — not included in any total." in BOM_TAB
    assert "never counted as $0" in BOM_TAB  # unpriced is never zero-filled
    # the price key is the wizard's, reached via the recorded id only
    assert "catalog_part_id" in BOM_TAB and "`part:${partId}`" in BOM_TAB


def test_bom_tab_photos_and_prices_coexist():
    # #91's slice, untouched by the price wiring: the verified photo
    # still resolves through the matched shelf part's catalogue id,
    # in the same rows that now carry price badges.
    assert "verifiedPhoto" in BOM_TAB and "PartPhoto" in BOM_TAB
    assert "catalogById.get(r.have.part.catalog_part_id)" in BOM_TAB


def test_check_budget_and_bom_tab_share_one_totals_function():
    assert "priceTotals(items, profile)" in ENGINE  # the check reads it
    assert "priceTotals(rows.map((r) => r.priceItem), profile)" in BOM_TAB


PRICE_SCRIPT = r"""
import assert from 'node:assert/strict';
const B = await import('./buildPlan.ts');
const D = B.DEFAULT_PROFILE;
const item = (key, qty = 1) => ({ key, name: key, qty, role: 'buy', sourceLabel: 'test' });
const items = [
  item('part:lipo_4s_5200'),            // user-entered price
  item('part:gearmotor_12v', 2),        // API-sourced price
  item('part:raspberry_pi_5'),          // web-gathered, unverified
  item('part:pla_filament'),            // no record at all
  { key: 'kit:x', name: 'Print', qty: 1, role: 'print', sourceLabel: 'test' }, // not a buy line
];
const profile = { ...D,
  prices: { 'part:lipo_4s_5200': 45 },
  sourcedPrices: {
    'part:gearmotor_12v': { amount: 12.5, supplier: 'Digi-Key', sourceKind: 'api',
      url: 'https://www.digikey.com/example', fetchedAt: '2026-11-01T08:00:00.000Z' },
    'part:raspberry_pi_5': { amount: 80, supplier: 'PiShop', sourceKind: 'web_gathered',
      verification: 'web_gathered', snippet: '"Raspberry Pi 5 — $80.00"',
      url: 'https://example.com/pi5', fetchedAt: '2026-11-01T09:00:00.000Z' },
  } };
const t = B.priceTotals(items, profile);
assert.equal(t.userSum, 45);
assert.equal(t.apiSum, 25);            // 12.50 x 2
assert.equal(t.gatheredSum, 80);
assert.equal(t.gatheredUnverified, 80);
assert.equal(t.known, 150);
assert.equal(t.pricedCount, 3);
assert.equal(t.unpricedCount, 1);      // the filament only; the print item is not a buy line

// cross-checked gathered money is no longer "unverified"
const checked = { ...profile, sourcedPrices: { ...profile.sourcedPrices,
  'part:raspberry_pi_5': { ...profile.sourcedPrices['part:raspberry_pi_5'], verification: 'cross_checked' } } };
assert.equal(B.priceTotals(items, checked).gatheredUnverified, 0);

// nothing recorded: no total, everything counted unpriced — never $0 lines
const bare = B.priceTotals(items, D);
assert.equal(bare.known, 0);
assert.equal(bare.unpricedCount, 4);

// the budget check reports the same figures the tab totals
const bud = B.checkBudget(items, profile);
assert.ok(bud.detail.includes('$150.00'));
assert.ok(bud.detail.includes('$80.00 rests on unverified web-gathered data'));

// the Workshop key doctrine: a price resolves ONLY under the exact
// wizard key for the line's recorded catalogue id — a key built
// from the line's own name/shape does not reach the record.
const rp = B.resolvedPrice(item('part:raspberry_pi_5'), profile);
assert.equal(rp.kind, 'web_gathered');
assert.ok(rp.label.includes('web-gathered estimate'));
assert.equal(B.resolvedPrice(item('wire-raspberry-pi-5'), profile), null);
assert.equal(B.resolvedPrice(item('raspberry_pi_5'), profile), null);
console.log('workshop price units OK');
"""


def _prep_build_plan(tmp: Path) -> None:
    (tmp / "package.json").write_text('{"type":"module"}')
    for name in ("sourcing.ts", "wiring.ts", "types.ts"):
        (tmp / name).write_text((LIB / name).read_text())
    bom = (LIB / "bom.ts").read_text().replace('"./sourcing"', '"./sourcing.ts"')
    (tmp / "bom.ts").write_text(bom)
    palette = (LIB / "palette.ts").read_text()
    palette = (palette.replace('"./bom"', '"./bom.ts"')
               .replace('"./sourcing"', '"./sourcing.ts"')
               .replace('"./types"', '"./types.ts"'))
    (tmp / "palette.ts").write_text(palette)
    build_wiring = (LIB / "buildWiring.ts").read_text()
    build_wiring = (build_wiring.replace('"./types"', '"./types.ts"')
                    .replace('"./palette"', '"./palette.ts"'))
    (tmp / "buildWiring.ts").write_text(build_wiring)
    engine = ENGINE
    engine = (engine.replace('"./bom"', '"./bom.ts"')
              .replace('"./types"', '"./types.ts"')
              .replace('"./wiring"', '"./wiring.ts"')
              .replace('"./buildWiring"', '"./buildWiring.ts"')
              .replace('"./palette"', '"./palette.ts"'))
    (tmp / "buildPlan.ts").write_text(engine)
    modules = WEB / "node_modules"
    if modules.exists():
        (tmp / "node_modules").symlink_to(modules)


def test_workshop_price_units_in_node(tmp_path):
    if not NODE:
        pytest.skip("Node unavailable")
    _prep_build_plan(tmp_path)
    (tmp_path / "run.mjs").write_text(PRICE_SCRIPT)
    proc = subprocess.run(
        [NODE, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(ROOT)],
        capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "price units OK" in proc.stdout
