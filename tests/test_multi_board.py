"""Robots with several boards (2026-11-23): a Jetson or Raspberry Pi
talking to an STM32, ESP32 or Arduino, or microcontrollers talking to
each other.

1. The three multi-board starter specs validate, and the Python
   harness finds no logic-level warning on them.
2. The catalogue records ports for every board and the new boards.
3. lib/boardLinks.ts runs in node: the board chain, the 3.3 V vs 5 V
   check and the shared-ground reminder, on the starters and Andino.
4. The Workshop wiring view and the Add panel use them.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from robotforge.harness import check_spec_data
from robotforge.schema import RobotSpec
from robotforge.validate import validate

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
STARTERS = ["jetson-stm32-rover.json", "jetson-mega-rover.json", "pi5-esp32-rover.json"]


@pytest.mark.parametrize("name", STARTERS)
def test_starter_specs_validate_and_pass_logic_checks(name):
    data = json.loads((REPO / "examples" / name).read_text())
    spec = RobotSpec.from_dict(data)
    findings = validate(spec)
    assert not [f for f in findings if f.severity in ("ERROR", "WARN")], findings
    rep = check_spec_data(data)
    logic = [e for e in rep.evaluations if e.check == "logic_levels"]
    assert logic, "the starter should exercise the logic check"
    assert not [f for f in rep.findings if f.check == "harness.logic_levels"]
    boards = [n for n in data["wiring"]["nodes"] if n.get("board")]
    assert len(boards) == 2


def test_starters_are_listed_in_the_add_panel():
    src = (WEB / "src/lib/boardStarters.ts").read_text()
    for name in STARTERS:
        assert f"'{name}'" in src
    garage = (WEB / "src/components/garage/Garage.tsx").read_text()
    assert "Start a multi-board robot" in garage
    assert "BOARD_STARTERS" in garage


def test_every_board_has_ports_and_logic():
    parts = {p["id"]: p for p in json.loads((REPO / "catalog/parts.json").read_text())["parts"]}
    for pid in ("arduino_mega_2560", "stm32_nucleo_f446re", "stm32_black_pill_f411",
                "esp32_c3_devkit", "level_shifter_bss138"):
        assert pid in parts
    for p in parts.values():
        if p["part_class"] not in ("microcontrollers", "sbc") or p["id"].startswith("vex_"):
            continue
        specs = p["specs"]
        assert specs.get("interfaces"), p["id"]
        assert "uart" in specs["interfaces"] or "usb" in specs["interfaces"], p["id"]
        assert specs.get("logic_v") in (3.3, 5), p["id"]
    assert parts["level_shifter_bss138"]["specs"]["level_shifter"] is True


NODE_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const B = await import('./boardLinks.ts');
const root = process.argv[2];
const spec = f => JSON.parse(fs.readFileSync(root + '/examples/' + f, 'utf8'));

const js = spec('jetson-stm32-rover.json').wiring;
assert.equal(B.boardChain(js), 'NVIDIA Jetson Orin Nano developer kit → USB → STM32 Nucleo-64 F446RE');
// USB carries its own ground and signalling: no logic or ground check between the boards.
assert.ok(!B.logicLevelChecks(js).some(c => c.subject === 'jetson → stm32'));
assert.ok(!B.logicLevelChecks(js).some(c => c.check === 'shared_ground'));

const jm = spec('jetson-mega-rover.json').wiring;
assert.equal(B.boardLinks(jm).length, 1);
assert.deepEqual(B.boardLinks(jm)[0].via, ['shifter']);
assert.ok(B.boardChain(jm).includes('UART (shifted)'));
assert.ok(!B.logicLevelChecks(jm).some(c => c.severity === 'WARN'));
assert.equal(B.logicLevelChecks(jm).find(c => c.check === 'shared_ground').coverage, 'CHECKED');

const pe = spec('pi5-esp32-rover.json').wiring;
assert.equal(B.boardChain(pe), 'Raspberry Pi 5 → UART → ESP32 DevKit');
assert.ok(!B.logicLevelChecks(pe).some(c => c.severity === 'WARN'));

// Take the shifter out of the Mega robot: Jetson 3.3 V straight to Mega 5 V warns.
const bare = structuredClone(jm);
bare.nodes = bare.nodes.filter(n => n.id !== 'shifter');
bare.connections = bare.connections.filter(c => c.from !== 'shifter' && c.to !== 'shifter');
bare.connections.push({ from: 'jetson', to: 'mega', kind: 'data', label: 'UART' });
const warn = B.logicLevelChecks(bare).find(c => c.subject === 'jetson → mega');
assert.equal(warn.severity, 'WARN');
assert.ok(warn.detail.includes('level shifter'));
assert.equal(B.logicLevelChecks(bare).find(c => c.check === 'shared_ground').coverage, 'NOT_CHECKED');

// A shifter recorded on the cable counts too (the Python harness reads it there).
const onCable = structuredClone(bare);
onCable.connections.find(c => c.from === 'jetson' && c.to === 'mega').cable = { level_shifted: true };
assert.equal(B.logicLevelChecks(onCable).find(c => c.subject === 'jetson → mega').severity, 'INFO');

// Through a shifter, one tied segment is not enough: both boards need it.
const half = structuredClone(jm);
half.connections.find(c => c.from === 'shifter' && c.to === 'mega').ground_shared = false;
assert.equal(B.logicLevelChecks(half).find(c => c.check === 'shared_ground').coverage, 'NOT_CHECKED');

// A 5 V-tolerant STM32 gets the "use an FT pin" wording.
const ft = { nodes: [{ id: 'uno', label: 'Arduino Uno', logic_v: 5 }, { id: 'st', label: 'STM32 Blue Pill', logic_v: 3.3, five_v_tolerant: 'FT pins' }],
  connections: [{ from: 'uno', to: 'st', kind: 'data', label: 'serial' }] };
assert.ok(B.logicLevelChecks(ft)[0].detail.includes('5 V tolerant'));

// Andino (Raspberry Pi 4 + Arduino Nano) is found from its labels alone.
const an = spec('andino.json').wiring;
assert.equal(B.boardChain(an), 'Raspberry Pi 4 → UART → Arduino Nano');
// A single-board robot has no chain.
assert.equal(B.boardChain({ nodes: [{ id: 'a', label: 'ESP32' }, { id: 'm', label: 'motor' }], connections: [{ from: 'a', to: 'm', kind: 'data', label: 'PWM' }] }), '');
console.log('board links ok');
"""


def test_board_links_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "boardLinks.ts").write_text((WEB / "src/lib/boardLinks.ts").read_text())
    (tmp_path / "run.mjs").write_text(NODE_SCRIPT)
    r = subprocess.run([node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr


def test_wiring_view_shows_the_board_chain():
    view = (WEB / "src/components/wiring/WiringView.tsx").read_text()
    assert "boardChain" in view and "wv-boards" in view
    plan = (WEB / "src/lib/harnessPlan.ts").read_text()
    assert "logicLevelChecks" in plan
    report = (WEB / "src/components/wiring/HarnessReport.tsx").read_text()
    assert "Logic levels, ampacity" not in report


def test_workshop_new_robot_dialog_offers_multi_board_starters():
    studio = (WEB / "src/components/garage/WorkshopStudio.tsx").read_text()
    assert "Multi-board robot" in studio
    assert "BOARD_STARTERS" in studio and "addBoardStarter" in studio
