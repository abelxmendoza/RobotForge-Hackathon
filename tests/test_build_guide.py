"""Build guide (/build/): a four-wheel starter rover built step by step for an
Arduino UNO or an ESP32, then driven in a simulated arena. Logic lives in
web-next/src/lib/buildGuide.ts (pure, zero imports, run here under node).

Pins:
- the sketch and the simulator's autopilot share one set of numbers, and every
  flowchart box points at real lines of both boards' sketches;
- pin choices stay off the pins that break things (UNO: D9/D10 PWM lost to the
  Servo library; ESP32: boot strapping pins, Echo on an input-only pin);
- the autopilot stops before a wall, looks both ways and turns, and backs up
  when stuck;
- saved arenas are validated, and the route folder isn't swallowed by the
  repo's `build/` ignore rule.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"
SRC = (WEB / "lib" / "buildGuide.ts").read_text()


def test_module_is_pure_and_route_is_wired():
    assert not any(line.startswith("import ") for line in SRC.splitlines())
    assert "Math.random" not in SRC and "Date.now" not in SRC
    route = (WEB / "app" / "build" / "page.tsx").read_text()
    assert "BuildGuide" in route and "AppShell" in route
    lab = (WEB / "components" / "buildguide" / "DriveLab.tsx").read_text()
    assert "createDriveWorld(spec, 'flat', solids)" in lab  # the Workshop's drive sandbox
    assert "'/build/'" in (WEB / "lib" / "nav.ts").read_text()


def test_route_folder_is_tracked_not_ignored():
    git = shutil.which("git")
    if not git:
        pytest.skip("git unavailable")
    out = subprocess.run([git, "check-ignore", "-q", "web-next/src/app/build/page.tsx"], cwd=ROOT)
    assert out.returncode == 1, "web-next/src/app/build/ is ignored by .gitignore"


def test_behaviour_under_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "buildGuide.ts").write_text(SRC)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "t.mjs").write_text(r"""
import assert from 'node:assert/strict';
import * as B from './buildGuide.ts';

// Ten steps, unique ids, ending with the drive step.
assert.equal(B.STEPS.length, 10);
assert.equal(new Set(B.STEP_IDS).size, 10);
assert.equal(B.STEP_IDS.at(-1), 'drive');

for (const board of ['uno', 'esp32']) {
  const code = B.avoiderSketch(board), test = B.wiringTestSketch(board);
  // The sketch carries the autopilot's numbers.
  for (const [k, v] of Object.entries({ STOP_CM: B.AUTO.STOP_CM, ROOM_CM: B.AUTO.ROOM_CM, TURN_MS: B.AUTO.TURN_MS, BACK_MS: B.AUTO.BACK_MS, STUCK_MS: B.AUTO.STUCK_MS }))
    assert.ok(code.includes(`const int ${k} = ${v};`), `${board} ${k}`);
  // Every flow box has lines in the sketch.
  for (const f of B.FLOW) assert.ok(B.flowLines(code, f.id).lines.length >= 1, `${board} ${f.id}`);
  // Every edge joins real boxes.
  for (const e of B.FLOW_EDGES) assert.ok(B.FLOW.some((f) => f.id === e.from) && B.FLOW.some((f) => f.id === e.to));
  // Balanced braces.
  for (const c of [code, test]) assert.equal((c.match(/{/g) || []).length, (c.match(/}/g) || []).length, board);
  // Every step's tick keys are unique.
  const keys = B.STEPS.flatMap((s) => B.checkKeys(s, board));
  assert.equal(new Set(keys).size, keys.length);
}
assert.ok(B.avoiderSketch('uno').includes('#include <Servo.h>'));
assert.ok(B.avoiderSketch('esp32').includes('ledcAttach(') && !B.avoiderSketch('esp32').includes('Servo.h'));

// Pins: UNO motors on PWM pins, not D9/D10; ESP32 off the strapping pins, echo input-only.
const u = B.PINS.uno, e = B.PINS.esp32;
assert.ok(['3', '5', '6', '11'].includes(u.leftIA) && ['3', '5', '6', '11'].includes(u.rightIA));
for (const p of Object.values(u)) assert.ok(p !== '10' && p !== '0' && p !== '1');
for (const p of Object.values(e)) assert.ok(!['0', '2', '5', '12', '15'].includes(p), p);
assert.ok(Number(e.echo) >= 34 && Number(e.echo) <= 39);
assert.equal(new Set(Object.values(e)).size, Object.values(e).length);
assert.equal(new Set(Object.values(u)).size, Object.values(u).length);

// Sensor ray: a box 1 m ahead reads ~100 cm; low boxes and empty space read no echo.
const solid = { x: 1.1, y: 0, z: 0.1, hx: 0.1, hy: 0.2, hz: 0.1 };
assert.ok(Math.abs(B.sonarCm(0, 0, 0, [solid]) - 100) < 0.5);
assert.equal(B.sonarCm(0, 0, 180, [solid]), B.AUTO.NO_ECHO_CM);
assert.equal(B.sonarCm(0, 0, 0, [{ ...solid, z: 0.02, hz: 0.02 }]), B.AUTO.NO_ECHO_CM);

// Autopilot on a pretend floor: a wall ahead, open on the left. (out.step is the step after this tick.)
const p = B.createAutopilot(0);
let t = 0, out, seen = new Set();
const read = (servo) => (servo > 120 ? 150 : servo < 60 ? 20 : 10);
let servo = 90;
for (; t < 4000; t += 20) { out = p.tick(t, read(servo)); servo = out.servo; seen.add(out.step); if (out.step === 'Turn') break; }
assert.deepEqual([...seen], ['Halt', 'LookRight', 'LookLeft', 'Decide', 'Turn']);
out = p.tick(t + 20, read(servo)); // first tick of the turn
assert.ok(out.right > 0 && out.left < 0, 'turns left toward the room');
assert.deepEqual(out.trail.slice(-2), ['side', 'turn']);
// Boxed in on both sides: back up.
const q = B.createAutopilot(0); servo = 90; seen = new Set();
for (t = 0; t < 4000; t += 20) { out = q.tick(t, 10); seen.add(out.step); if (out.step === 'BackUp') break; }
assert.equal(out.step, 'BackUp'); out = q.tick(t + 20, 10); assert.ok(out.left < 0 && out.right < 0);
// A reading that never changes while driving: stuck, back up.
const r = B.createAutopilot(0);
for (t = 0; t < 4000; t += 20) { out = r.tick(t, 80); if (out.step !== 'Drive') break; }
assert.equal(out.step, 'BackUp'); assert.ok(t > B.AUTO.STUCK_MS);
assert.deepEqual(B.sidesToInput(255, 255), { throttle: 1, turn: 0 });
assert.deepEqual(B.sidesToInput(-255, 255), { throttle: 0, turn: 1 });

// Arena: defaults keep the start clear; bad saves are refused; boxes are kept on the floor.
assert.ok(B.DEFAULT_ARENA.every((b) => !B.coversStart(b)));
assert.equal(B.parseArena('nope'), null);
assert.equal(B.parseArena(JSON.stringify({ v: 1, boxes: [{ id: '__proto__', x: 0, y: 0, w: 1, d: 1, h: 1 }] })), null);
const back = B.parseArena(B.serializeArena([{ id: 'b1', x: 9, y: -9, w: 5, d: 0.001, h: 0.2, tone: 'wood' }]));
assert.equal(back[0].w, 1.2); assert.equal(back[0].d, 0.04);
assert.ok(back[0].x + back[0].w / 2 <= B.ARENA_HALF + 1e-9 && back[0].y - back[0].d / 2 >= -B.ARENA_HALF - 1e-9);
assert.equal(B.arenaSolids([]).length, 4);
console.log('ok');
""")
    out = subprocess.run([node, "t.mjs"], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    if "ERR_UNKNOWN_FILE_EXTENSION" in out.stderr:
        pytest.skip("This node can't run .ts files")
    assert out.returncode == 0, out.stderr + out.stdout
    assert out.stdout.strip().endswith("ok")
