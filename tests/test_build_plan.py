"""Build plan + real-life constraints (web-next): the deterministic
constraints engine in lib/buildPlan.ts and its panel in the BOM
wizard's review step.

Two layers, following the repo's node-test pattern:

1. Static wiring + honesty: the panel is in the wizard's review
   step, the profile key has a demo twin, the panel makes no live
   calls, and the chat is untouched (chat integration is out of
   this slice on purpose).
2. Node unit tests: the real engine against the real catalogue —
   dims extraction from recorded kit parameters, every check's
   pass / warn / blocked / not_checked paths (including the power
   pass-through abstention), estimate labeling, the sourced-price
   model, and the export guard: no currency figure appears without
   a source record (a user-entered price or a sourced estimate
   with supplier + link + fetch time) behind it.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
LIB = WEB / "src/lib"


# ---------------------------------------------------------------- wiring

def test_build_plan_engine_is_deterministic_and_offline():
    engine = (LIB / "buildPlan.ts").read_text()
    for banned in ("postJSON", "liveHealth", "fetch("):
        assert banned not in engine, banned


def test_profile_gets_a_demo_twin_and_chat_is_untouched():
    demo = (LIB / "demoMode.ts").read_text()
    assert "'rf.buildplan.v1'" in demo
    engine = (LIB / "buildPlan.ts").read_text()
    assert 'PROFILE_KEY = "rf.buildplan.v1"' in engine
    dock = (WEB / "src/components/chat/ChatDock.tsx").read_text()
    assert "buildPlan" not in dock
    assert "BuildPlan" not in dock


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const partsDoc = load('catalog/parts.json');
const kitsDoc = load('catalog/parts-kits.json');
const physDoc = load('catalog/physics.json');
const B = await import('./buildPlan.ts');
const BOM = await import('./bom.ts');
const partsById = new Map(partsDoc.parts.map(p => [p.id, p]));
const kitsByFile = B.kitFileIndex(kitsDoc.kits);
const D = B.DEFAULT_PROFILE;
const check = (plan, id) => plan.checks.find(c => c.id === id);
const mk = (over) => ({ key: 'x', name: 'X', qty: 1, role: 'buy', sourceLabel: 'test', ...over });

// --- dims from recorded kit parameters ---
const burger = kitsDoc.kits['turtlebot3-burger'];
const items = B.kitPlanItems(burger);
const byName = new Map(items.map(i => [i.name, i]));
assert.deepEqual([byName.get('Chassis plate').dims.x, byName.get('Chassis plate').dims.y, byName.get('Chassis plate').dims.z], [178, 138, 4]);
assert.ok(Math.abs(byName.get('Chassis plate').dims.volumeCm3 - 98.3) < 0.2);
assert.equal(byName.get('Wheel').wheelRadiusMm, 33);
assert.equal(byName.get('Lidar mount').dims.z, 185);
assert.equal(byName.get('Chassis plate').dims.estimated, false);
const waffle = B.kitPlanItems(kitsDoc.kits['turtlebot3-waffle-pi']);
assert.equal(waffle[0].dims.estimated, true); // the kit itself is flagged estimated

// --- print fit: pass at 220, blocked at 180 (the 185 mm lidar post) ---
const mass = physDoc.robots['turtlebot3-burger'].catalog_mass_kg;
const plan = B.generateBuildPlan({ title: 'Burger', items, profile: D, partsById, robotMassKg: mass });
assert.equal(check(plan, 'print-fit').state, 'pass');
const small = B.generateBuildPlan({ title: 'Burger', items, profile: { ...D, bedXmm: 180, bedYmm: 180, bedZmm: 180 }, partsById, robotMassKg: mass });
assert.equal(check(small, 'print-fit').state, 'blocked');
assert.ok(check(small, 'print-fit').detail.includes('Lidar mount'));
assert.ok(check(small, 'print-fit').fix.includes('Split'));
const fitStep = small.steps.find(s => s.id === 'print:kit:parts/lidar_mount.scad');
assert.ok(fitStep.checkIds.includes('print-fit')); // blocker rides inline on its step
// Andino's 250 mm chassis on a 220 bed: blocked too.
const andino = B.generateBuildPlan({ title: 'Andino', items: B.kitPlanItems(kitsDoc.kits['andino']), profile: D, partsById });
assert.equal(check(andino, 'print-fit').state, 'blocked');

// --- material fit paths ---
assert.equal(check(plan, 'material-fit').state, 'pass');
const plaOnly = B.generateBuildPlan({ title: 'B', items, profile: { ...D, materialsOnHand: ['PLA'] }, partsById });
assert.equal(check(plaOnly, 'material-fit').state, 'warn');
const noFil = B.generateBuildPlan({ title: 'B', items, profile: { ...D, materialsOnHand: [] }, partsById });
assert.equal(check(noFil, 'material-fit').state, 'blocked');
const outdoor = B.generateBuildPlan({ title: 'B', items, profile: { ...D, environment: 'outdoor' }, partsById });
assert.equal(check(outdoor, 'material-fit').state, 'warn');

// --- tools: the rc_car template solders (XT60 pigtail) ---
const rc = partsDoc.templates.find(t => t.name === 'rc_car');
const rcItems = B.bomLinePlanItems(BOM.templateBomLines(rc, partsById, []), partsById, kitsByFile);
const noSolderTools = D.toolsOnHand.filter(t => t !== 'soldering_iron');
const rcPlan = B.generateBuildPlan({ title: 'RC', items: rcItems, profile: { ...D, toolsOnHand: noSolderTools }, partsById });
assert.equal(check(rcPlan, 'tools').state, 'warn');
assert.ok(check(rcPlan, 'tools').detail.includes('Soldering iron'));
assert.ok(check(rcPlan, 'tools').stepIds.includes('wire'));

// --- power: pass-through abstention, direct over-voltage, buck limit ---
const battery = mk({ key: 'b', name: 'LiPo 4S', partId: 'lipo_4s_5200', partClass: 'power', specs: { chemistry: 'lipo', voltage_v: 14.8 } });
const driver = mk({ key: 'd', name: 'TB6612', partId: 'driver_tb6612fng', partClass: 'drivers', specs: { voltage_v_max: 15 } });
const motor = mk({ key: 'm', name: 'Gearmotor', partId: 'gearmotor_12v', partClass: 'actuators', specs: { voltage_v: 12, stall_torque_nm: 0.8 } });
const throughDriver = B.checkPower([battery, driver, motor], null);
assert.equal(throughDriver.state, 'not_checked'); // motor behind driver: abstained, in writing
assert.ok(throughDriver.detail.includes('not checked'));
assert.ok(throughDriver.detail.includes('TB6612'));
const direct = B.checkPower([battery, motor], null);
assert.equal(direct.state, 'warn');
assert.ok(direct.detail.includes('full battery voltage'));
const buck = mk({ key: 'k', name: 'Buck', partId: 'buck_converter_5v', partClass: 'power', specs: { input_v_max: 24, output_v: 5 } });
const hot = mk({ key: 'b2', name: 'Big battery', partClass: 'power', specs: { chemistry: 'lipo', voltage_v: 29.6 } });
assert.equal(B.checkPower([hot, buck], null).state, 'blocked');
const wiring = { nodes: [{ id: 'battery', label: 'Battery' }, { id: 'drv', label: 'Driver', rated_max_v: 15 }],
  connections: [{ from: 'battery', to: 'drv', kind: 'power', volts: 24 }] };
assert.equal(B.checkPower([battery], wiring).state, 'blocked');
assert.equal(B.checkPower([driver], null).state, 'not_checked'); // no battery recorded

// --- saved build-list wiring (the Kit wiring view's shape) adapts ---
const synthDriver = { id: 'synth_12v_driver', name: 'Synthetic 12 V-max driver', part_class: 'drivers', specs: { voltage_v_max: 12, channels: 1 } };
const partsById2 = new Map(partsById);
partsById2.set(synthDriver.id, synthDriver);
const bwEntries = [
  { uid: 'e-batt', kind: 'catalog-part', refId: 'lipo_4s_5200', qty: 1, via: 'palette' },
  { uid: 'e-drv', kind: 'catalog-part', refId: 'driver_tb6612fng', qty: 1, via: 'palette' },
  { uid: 'e-syn', kind: 'catalog-part', refId: 'synth_12v_driver', qty: 1, via: 'palette' },
];
assert.equal(B.isBuildWiring(wiring), false); // the spec shape is not the build shape
assert.equal(B.isBuildWiring({ connections: [] }), true);
const bwOk = { connections: [{ id: 'c1', fromEntry: 'e-batt', fromPort: 'power-out', toEntry: 'e-drv', toPort: 'power-in', type: 'power' }] };
const adaptedOk = B.wiringFromBuildWiring(bwOk, bwEntries, partsById2);
assert.ok(adaptedOk && adaptedOk.connections.length === 1);
assert.notEqual(B.checkPower([battery], adaptedOk).state, 'blocked'); // 14.8 V into a 15 V-max input
const bwBad = { connections: [{ id: 'c2', fromEntry: 'e-batt', fromPort: 'power-out', toEntry: 'e-syn', toPort: 'power-in', type: 'power' }] };
const adaptedBad = B.wiringFromBuildWiring(bwBad, bwEntries, partsById2);
assert.equal(B.checkPower([battery], adaptedBad).state, 'blocked'); // 14.8 V into a 12 V-max input
assert.ok(B.checkPower([battery], adaptedBad).detail.includes('Recorded wiring over-voltage'));
const bwData = { connections: [{ id: 'c3', fromEntry: 'e-batt', fromPort: 'power-out', toEntry: 'e-drv', toPort: 'power-in', type: 'data' }] };
assert.equal(B.wiringFromBuildWiring(bwData, bwEntries, partsById2), null); // nothing judgeable

// --- torque estimate: labeled, margin-based, abstains without inputs ---
const rover = partsDoc.templates.find(t => t.name === 'rover_diff_drive');
const roverItems = B.bomLinePlanItems(BOM.templateBomLines(rover, partsById, []), partsById, kitsByFile);
const roverPlan = B.generateBuildPlan({ title: 'Rover', items: roverItems, profile: D, partsById, robotMassKg: 0.93, robotMassLabel: 'test' });
assert.equal(check(roverPlan, 'torque').state, 'pass');
assert.ok(check(roverPlan, 'torque').detail.includes('ESTIMATE'));
const heavy = B.checkTorque(roverItems, 40, 'test');
assert.equal(heavy.state, 'blocked');
assert.equal(B.checkTorque(roverItems, null).state, 'not_checked');
assert.equal(check(plan, 'torque').state, 'not_checked'); // kit-only build: no motors recorded

// --- safety: LiPo with no balance charger is a blocker ---
assert.equal(check(roverPlan, 'safety').state, 'blocked');
const withCharger = B.generateBuildPlan({ title: 'Rover', items: roverItems,
  profile: { ...D, toolsOnHand: [...D.toolsOnHand, 'lipo_charger'] }, partsById, robotMassKg: 0.93 });
assert.notEqual(check(withCharger, 'safety').state, 'blocked');

// --- budget + exports: no currency without a source record ---
const mdBare = B.planToMarkdown(roverPlan);
assert.ok(!mdBare.includes('$'), 'no prices recorded -> no currency anywhere');
assert.ok(mdBare.includes('not checked'));
const pricedProfile = { ...D, budgetCeiling: 100,
  prices: { 'part:lipo_4s_5200': 45 },
  sourcedPrices: { 'part:gearmotor_12v': { amount: 12.5, supplier: 'Digi-Key',
    url: 'https://www.digikey.com/example', qtyBreak: '10+ units', fetchedAt: '2026-11-01T08:00:00.000Z' } } };
const pricedPlan = B.generateBuildPlan({ title: 'Rover', items: roverItems, profile: pricedProfile, partsById, robotMassKg: 0.93 });
const bud = check(pricedPlan, 'budget');
assert.equal(bud.state, 'warn');
assert.ok(bud.detail.includes('$70.00'));
assert.ok(bud.detail.includes('Shipping, tax and stock are unknown'));
const mdPriced = B.planToMarkdown(pricedPlan);
assert.ok(mdPriced.includes('$45.00 (your entered price)'));
assert.ok(mdPriced.includes('ESTIMATE — Digi-Key'));
assert.ok(mdPriced.includes('https://www.digikey.com/example'));
assert.ok(mdPriced.includes('2026-11-01T08:00:00.000Z'));
const overPlan = B.generateBuildPlan({ title: 'Rover', items: roverItems,
  profile: { ...pricedProfile, budgetCeiling: 50 }, partsById, robotMassKg: 0.93 });
assert.equal(check(overPlan, 'budget').state, 'blocked');
const rp = B.resolvedPrice(roverItems.find(i => i.partId === 'gearmotor_12v'), pricedProfile);
assert.equal(rp.kind, 'sourced');

// --- web-gathered prices (§8): badged, receipted, unverified share reported ---
const gatheredProfile = { ...D, budgetCeiling: 500,
  sourcedPrices: { 'part:raspberry_pi_5': { amount: 80, supplier: 'PiShop', sourceKind: 'web_gathered',
    verification: 'web_gathered', snippet: '"Raspberry Pi 5 8GB — $80.00"',
    url: 'https://example.com/pi5', fetchedAt: '2026-11-01T09:00:00.000Z' } } };
const gatheredPlan = B.generateBuildPlan({ title: 'Rover', items: roverItems, profile: gatheredProfile, partsById, robotMassKg: 0.93 });
const gBud = check(gatheredPlan, 'budget');
assert.ok(gBud.detail.includes('web-gathered estimates'));
assert.ok(gBud.detail.includes('rests on unverified web-gathered data'));
const gRp = B.resolvedPrice(roverItems.find(i => i.partId === 'raspberry_pi_5'), gatheredProfile);
assert.equal(gRp.kind, 'web_gathered');
assert.ok(gRp.label.includes('web-gathered estimate'));
const gMd = B.planToMarkdown(gatheredPlan);
assert.ok(gMd.includes('web-gathered estimate'));
assert.ok(gMd.includes('Receipt:'));
assert.ok(gMd.includes('$80.00'));
const checkedProfile = { ...gatheredProfile,
  sourcedPrices: { 'part:raspberry_pi_5': { ...gatheredProfile.sourcedPrices['part:raspberry_pi_5'], verification: 'cross_checked' } } };
const checkedPlan = B.generateBuildPlan({ title: 'Rover', items: roverItems, profile: checkedProfile, partsById, robotMassKg: 0.93 });
assert.ok(!check(checkedPlan, 'budget').detail.includes('unverified web-gathered'));

// --- time: estimate range, labeled; unknown volumes named ---
const time = check(plan, 'time');
assert.equal(time.state, 'not_checked'); // mounts/caster/post have no recorded volume
assert.ok(time.detail.includes('ESTIMATE'));
assert.ok(time.detail.includes('Lidar mount'));
assert.ok(plan.steps.filter(s => s.phase === 'Print').every(s => !s.estMinutes || s.timeLabel));

// --- plan shape: phases ordered, header never hides not-checked ---
const phases = [...new Set(plan.steps.map(s => s.phase))];
assert.deepEqual(phases, ['Print', 'Prep', 'Assemble', 'Test']);
assert.equal(plan.schema, 'robotforge-build-plan/1');
assert.equal(plan.summary.steps, plan.steps.length);
assert.ok(plan.summary.notChecked >= 1);
const json = JSON.stringify(B.planToJson(plan));
assert.ok(json.includes('robotforge-build-plan/1'));

// --- workspace: tiny bench warns ---
const cramped = B.generateBuildPlan({ title: 'B', items, profile: { ...D, workspaceMm: 100 }, partsById });
assert.equal(check(cramped, 'workspace').state, 'warn');

console.log('build-plan unit checks passed');
"""


def _prep_unit_dir(tmp: Path) -> None:
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
    engine = (LIB / "buildPlan.ts").read_text()
    engine = (engine.replace('"./bom"', '"./bom.ts"')
              .replace('"./types"', '"./types.ts"')
              .replace('"./wiring"', '"./wiring.ts"')
              .replace('"./buildWiring"', '"./buildWiring.ts"')
              .replace('"./palette"', '"./palette.ts"'))
    (tmp / "buildPlan.ts").write_text(engine)
    (tmp / "node_modules").symlink_to(WEB / "node_modules")


def test_build_plan_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    _prep_unit_dir(tmp_path)
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
