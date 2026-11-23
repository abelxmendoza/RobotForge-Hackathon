"""Wrench adds a board from plain words (2026-11-23), e.g. "add an STM32
for the motors to my Jetson robot" or "connect an ESP32 over I2C".

1. lib/boardAdd.ts runs in node: the words pick the right catalogue
   board, job and bus; Raspberry Pi 4/5, build-list asks and questions
   are left alone; the plan adds the node and link, a level shifter
   when 3.3 V meets 5 V on a signal wire, and flags missing interfaces.
2. A planned spec still validates, and the Python harness finds no
   logic-level warning on it.
3. Wrench routes the words to it before the VEX edits, and shows the
   card with Apply / Cancel.
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

NODE_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const B = await import('./boardAdd.ts');
const root = process.argv[2];
const parts = JSON.parse(fs.readFileSync(root + '/catalog/parts.json', 'utf8')).parts;
const spec = f => JSON.parse(fs.readFileSync(root + '/examples/' + f, 'utf8'));
const P = B.parseBoardAdd;

assert.deepEqual(P('add an STM32 for the motors to my Jetson robot'), { partId: 'stm32_blue_pill', role: 'motors', bus: null, hostHint: 'jetson robot' });
assert.equal(P('connect an ESP32 over I2C').bus, 'i2c');
assert.equal(P('add an Arduino Mega via UART').partId, 'arduino_mega_2560');
assert.equal(P('add an Arduino Nano').partId, 'arduino_nano');
assert.equal(P('add a jetson nano').partId, 'jetson_nano');
assert.equal(P('add an ESP32-S3').partId, 'esp32_s3_devkit');
assert.equal(P('add a Raspberry Pi Pico W for sensors').partId, 'pico_w');
// Left to other flows, or not an ask at all.
for (const q of ['add a Raspberry Pi 5', 'add a pi 4', 'add an esp32 to my build', 'can I add an esp32?', 'add a lidar', 'add "ESP32" to "Rover"', 'what is an stm32'])
  assert.equal(P(q), null, q);

const pe = spec('pi5-esp32-rover.json');
const usb = B.planBoardAdd(pe, P('add an STM32 for the motors'), parts);
assert.equal(usb.hostId, 'pi');
assert.equal(usb.bus, 'usb');
assert.ok(usb.chainAfter.includes('Raspberry Pi 5 → USB → STM32 Blue Pill'));
assert.equal(usb.spec.wiring.nodes.at(-1).role, 'motors');
assert.equal(pe.wiring.nodes.length + 1, usb.spec.wiring.nodes.length, 'input spec untouched, one node added');

const mega = B.planBoardAdd(pe, P('add an Arduino Mega via UART'), parts);
assert.ok(mega.shifted);
assert.ok(mega.chainAfter.includes('UART (shifted) → Arduino Mega'));
assert.ok(!mega.checks.some(c => c.severity === 'WARN'));
assert.equal(mega.checks.find(c => c.check === 'shared_ground').coverage, 'CHECKED');

const named = B.planBoardAdd(pe, P('add an Arduino Uno over i2c to the esp32'), parts);
assert.equal(named.hostId, 'esp32');

const can = B.planBoardAdd(pe, P('add a teensy over can'), parts);
assert.ok(can.todo.some(t => t.includes('Raspberry Pi 5 has no CAN')), can.todo.join('|'));

// A 5 V-tolerant STM32 on a 5 V Mega: no shifter, a "use FT pins" note.
const jm = spec('jetson-mega-rover.json');
const ft = B.planBoardAdd(jm, P('add an stm32 over uart to the mega'), parts);
assert.ok(!ft.shifted);
assert.ok(ft.todo.some(t => t.includes('5 V tolerant')));

// A robot with no wiring yet: the board, no link, and a plain reason.
const bare = B.planBoardAdd({ name: 'x' }, P('add an esp32'), parts);
assert.equal(bare.hostId, null);
assert.equal(bare.spec.wiring.nodes.length, 1);

fs.writeFileSync(process.argv[3], JSON.stringify(mega.spec));
console.log('board add ok');
"""


def test_board_add_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    (tmp_path / "package.json").write_text('{"type":"module"}')
    src = (WEB / "src/lib/boardAdd.ts").read_text().replace("from './boardLinks'", "from './boardLinks.ts'")
    (tmp_path / "boardAdd.ts").write_text(src)
    (tmp_path / "boardLinks.ts").write_text((WEB / "src/lib/boardLinks.ts").read_text())
    (tmp_path / "run.mjs").write_text(NODE_SCRIPT)
    out = tmp_path / "mega.json"
    r = subprocess.run([node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO), str(out)],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr

    # The planned spec is still a valid robot, with no logic warning.
    data = json.loads(out.read_text())
    findings = validate(RobotSpec.from_dict(data))
    assert not [f for f in findings if f.severity in ("ERROR", "WARN")], findings
    rep = check_spec_data(data)
    assert [e for e in rep.evaluations if e.check == "logic_levels"]
    assert not [f for f in rep.findings if f.check == "harness.logic_levels"]


def test_wrench_routes_board_asks():
    dock = (WEB / "src/components/chat/ChatDock.tsx").read_text()
    assert "parseBoardAdd" in dock and "planBoardAdd" in dock
    assert dock.index("if (runBoardAdd(q)) return true;") < dock.index("if (runVexCommand(q)) return true;")
    assert "<BoardAddCard" in dock
    card = (WEB / "src/components/chat/BoardAddCard.tsx").read_text()
    assert "Apply as a new version" in card and "Cancel" in card
