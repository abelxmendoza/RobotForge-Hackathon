"""One upgrade proposal: "Wrench, add a Raspberry Pi 5 to this rover".
The pure planner (lib/upgradeProposal.ts) runs in Node against the real
component table on Omega1's documented seed; the converter ratings are
pinned to catalog/parts.json; the chat and Workshop wiring is guarded
by source checks."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next/src"
LIB = (WEB / "lib/upgradeProposal.ts").read_text()

RUN = r"""
import assert from 'node:assert/strict';
import { parseUpgradeAsk, buildUpgradeProposal, applyUpgrade, recheckUpgrade, batteryRange, hasBlocking } from './upgradeProposal.ts';

// The ask.
assert.deepEqual(parseUpgradeAsk('Wrench, add a Raspberry Pi 5 to this rover'), { componentId: 'raspberry-pi-5-sbc' });
assert.deepEqual(parseUpgradeAsk('add an rpi5 to Omega1'), { componentId: 'raspberry-pi-5-sbc' });
assert.deepEqual(parseUpgradeAsk('install a RealSense D435 on my robot'), { componentId: 'realsense-d435-depth-cam' });
assert.equal(parseUpgradeAsk('can I add a Raspberry Pi 5?'), null);           // a question, not an ask
assert.equal(parseUpgradeAsk('add a raspberry pi to this rover'), null);      // which Pi? not guessed
assert.equal(parseUpgradeAsk('add a flux capacitor to this rover'), null);
assert.equal(parseUpgradeAsk('what does a Raspberry Pi 5 need'), null);

// Battery ranges are typical for the chemistry, and say so.
const b = batteryRange({ battery: { chemistry: 'liion', voltage_v: 7.4 } });
assert.equal(b.cells, 2); assert.equal(b.minV, 6); assert.equal(b.maxV, 8.4);
assert.match(b.basis, /typical/);
assert.equal(batteryRange({ battery: { chemistry: 'mystery', voltage_v: 12 } }).minV, null);
assert.equal(batteryRange({}), null);

// Omega1, as seeded: 2S Li-ion, a Pi 4B with documented GPIO/CSI rows, no dimensions.
const conns = [
  { from: 'Battery (2× 18650 in series)', to: 'PCA9685 PWM hat', detail: 'Power — 7.4 V nominal pack', evidence: 'DOCUMENTED' },
  { from: 'Raspberry Pi 4B', to: 'HC-SR04', detail: 'GPIO 27 TRIG · GPIO 22 ECHO · front', evidence: 'DOCUMENTED' },
  { from: 'Raspberry Pi 4B', to: 'OV5647 camera', detail: 'CSI', evidence: 'DOCUMENTED' }];
const robot = { id: 'omega1', name: 'Omega1', createdAt: '', versions: [{ id: 'v1', label: 'Baseline', note: '', source: 'repo', createdAt: '',
  spec: { name: 'Omega1', battery: { chemistry: 'liion', voltage_v: 7.4 }, connections: conns } }] };
const p = buildUpgradeProposal(robot, 'raspberry-pi-5-sbc');
const v = Object.fromEntries(p.checks.map((c) => [c.id, c.verdict]));
assert.equal(v['power.conversion'], 'PASS');            // needs a buck, and a documented one fits
assert.equal(p.converter.catalogId, 'buck_converter_5v');
assert.equal(v['converter.input_max'], 'PASS');         // 24 V >= 8.4 V
assert.equal(v['converter.input_min'], 'NOT_CHECKED');  // record has no minimum input
assert.equal(v['converter.current'], 'WARN');           // 5 A for a 5 A load: no headroom
assert.equal(v['converter.voltage'], 'WARN');           // 5.0 V vs the Pi's 5.1 V
assert.equal(v['wiring.voltage'], 'PASS');
assert.equal(v['compute.existing'], 'WARN');            // already has a Pi 4B
assert.equal(v['mount.fit'], 'NOT_CHECKED');            // Omega1's size isn't recorded
assert.equal(hasBlocking(p), false);
assert.equal(p.wiring.length, 2);
assert.match(p.wiring[0].detail, /VIN\+ \/ GND/);
assert.match(p.wiring[1].detail, /USB-C/);
assert.ok(p.needsReview.some((r) => /22-pin/.test(r)), 'Pi 5 camera connector change is flagged');
assert.ok(p.needsReview.some((r) => /usb_max_current_enable/.test(r)));
assert.ok(p.needsReview.some((r) => /pins 2 and 4/.test(r)));
// Mount: Pi pattern, deck holes outside the enclosure walls.
assert.deepEqual(p.mount.partHoles.positionsMm, [[-29, -24.5], [29, -24.5], [-29, 24.5], [29, 24.5]]);
const wallX = p.mount.enclosureInnerMm[0] / 2 + 2;
assert.ok(p.mount.deckHoles.positionsMm.every(([x]) => Math.abs(x) > wallX + 1.6));
assert.ok(p.mount.deckHoles.positionsMm.every(([x, y]) => Math.abs(x) < p.mount.plateMm[0] / 2 && Math.abs(y) < p.mount.plateMm[1] / 2));
assert.match(p.mount.scad, /PLANNED geometry/);

// Approve once: one new PLANNED version; then recheck it.
const next = applyUpgrade([robot], p, 'v2', '2026-11-04T07:00:00Z');
const saved = next[0].versions;
assert.equal(saved.length, 2);
assert.equal(saved[1].source, 'upgrade'); assert.equal(saved[1].planned, true);
assert.equal(saved[1].spec.connections.length, 5);
assert.equal(saved[1].spec.connections.filter((c) => c.evidence === 'PLANNED').length, 2);
assert.equal(saved[1].spec.upgrades[0].component, 'raspberry-pi-5-sbc');
assert.equal(saved[0].spec.connections.length, 3);     // the baseline is untouched
const again = recheckUpgrade(next[0], 'v2');
assert.equal(again.ok, true); assert.match(again.line, /All planned wiring rows are saved/);
assert.throws(() => applyUpgrade(next, p, 'v3', 'x'), /changed since this proposal/); // stale proposal

// A 5 V battery would feed it directly; a robot with no battery can't be planned.
const direct = buildUpgradeProposal({ ...robot, versions: [{ ...robot.versions[0], spec: { battery: { chemistry: 'other', voltage_v: 5.1 } } }] }, 'raspberry-pi-5-sbc');
assert.equal(direct.converter, null);
const none = buildUpgradeProposal({ ...robot, versions: [{ ...robot.versions[0], spec: {} }] }, 'raspberry-pi-5-sbc');
assert.equal(none.checks.find((c) => c.id === 'power.battery').verdict, 'NOT_CHECKED');
assert.equal(none.wiring.length, 0);
console.log('ok');
"""


def test_pi5_upgrade_proposal_on_omega1(tmp_path: Path) -> None:
    (tmp_path / "components.ts").write_text((WEB / "lib/components.ts").read_text())
    (tmp_path / "upgradeProposal.ts").write_text(LIB.replace("from './components'", "from './components.ts'"))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"], cwd=tmp_path,
                          capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr + proc.stdout
    assert "ok" in proc.stdout


def test_converter_ratings_match_the_catalog() -> None:
    raw = json.loads((ROOT / "catalog/parts.json").read_text())
    parts = raw if isinstance(raw, list) else raw.get("parts", raw)
    buck = next(p for p in parts if p["id"] == "buck_converter_5v")
    assert buck["specs"] == {"input_v_max": 24, "output_a": 5, "output_v": 5.0}
    assert "inputMaxV: 24," in LIB and "outputV: 5.0," in LIB and "outputA: 5," in LIB
    assert "inputMinV:" not in LIB.split("export const CONVERTERS")[1].split("];")[0], "no invented minimum input"


def test_wrench_and_workshop_show_the_proposal() -> None:
    dock = (WEB / "components/chat/ChatDock.tsx").read_text()
    garage = (WEB / "components/garage/Garage.tsx").read_text()
    card = (WEB / "components/chat/UpgradeProposalCard.tsx").read_text()
    # Coordinated proposals supersede the earlier standalone card.
    assert "parseUpgradeRequest(q," in dock and "<UpgradeProposal key=" in dock
    coordinated = (WEB / "components/chat/UpgradeProposal.tsx").read_text()
    assert "applyUpgrade(" in coordinated
    assert "<UpgradeProposalCard" not in dock
    assert "applyUpgrade(" in card and "recheckUpgrade(" in card
    assert "Approve and save as one version" in card
    assert "<PlannedUpgrades spec={draft} />" in garage
    assert "upgrade: 'Upgrade approved in Wrench (PLANNED)'" in (WEB / "lib/garage.ts").read_text()
