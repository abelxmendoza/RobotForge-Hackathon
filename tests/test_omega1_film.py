"""Omega1 teardown film (/film/, 2026-11-11): the twin takes itself apart
piece by piece, explodes on a turntable, snaps back and drives out.
The script is web-next/src/lib/omega1Film.ts (pure, zero imports, run
here under node); the page is components/film/Omega1Film.tsx.

Honesty pins:
- only the twin's own six links move; no invented parts;
- caption facts (channel map, HC-SR04 pins) match omega1.extracted.json;
- no speed is claimed for the drive-out;
- the picture and the score come from the same timeline, deterministically.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"
SRC = (WEB / "lib" / "omega1Film.ts").read_text()
PAGE = (WEB / "components" / "film" / "Omega1Film.tsx").read_text()
ROUTE = (WEB / "app" / "film" / "page.tsx").read_text()
EXTRACTED = json.loads((ROOT / "docs" / "omega1" / "omega1.extracted.json").read_text())


def test_module_is_pure_and_page_is_wired():
    assert not any(line.startswith("import ") for line in SRC.splitlines())
    assert "Math.random" not in SRC and "Date.now" not in SRC
    assert "Omega1Film" in ROUTE and "AppShell" in ROUTE
    assert "omega1Rover.model" in PAGE and "renderScore" in PAGE
    # Wheels are sorted by position, never by the GLB's mirrored names.
    assert "c.x > 0 ? 'left' : 'right'" in PAGE
    assert 'href="/film/"' in (WEB / "components" / "simulator" / "Omega1Simulator.tsx").read_text()
    assert 'href="/film/"' in (WEB / "components" / "garage" / "Omega1Twin.tsx").read_text()
    assert "--shot film" in (ROOT / "tools" / "capture_3d.cjs").read_text()


def test_caption_facts_match_the_extracted_record():
    fields = EXTRACTED["fields"]
    for wheel in ("front_left", "rear_left", "front_right", "rear_right"):
        rec = fields[f"motors.channel_map.{wheel}"]
        assert rec["evidence"] == "DOCUMENTED"
        assert f"{wheel}: {{ forward: {rec['value']['forward']}, backward: {rec['value']['backward']} }}" in SRC
    pins = fields["sensors.ultrasonic.pins"]["value"]
    assert f"trigGpio: {pins['trig_gpio']}, echoGpio: {pins['echo_gpio']}" in SRC


def test_no_speed_claimed():
    for text in (SRC, PAGE):
        assert "m/s" not in text and "km/h" not in text and "rpm" not in text
    assert "never been measured" in PAGE


def test_behaviour_under_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "omega1Film.ts").write_text(SRC)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "t.mjs").write_text(r"""
import assert from 'node:assert/strict';
import * as F from './omega1Film.ts';

// Two cuts: about 20 s and 10 s, shots back to back.
assert.equal(Math.round(F.filmLength('full')), 20);
assert.equal(Math.round(F.filmLength('short')), 10);
for (const cut of ['full', 'short']) {
  const s = F.filmShots(cut);
  for (let i = 1; i < s.length; i++) assert.equal(s[i].start, s[i - 1].end);
  assert.equal(s[0].shot.id, 'hero'); assert.equal(s.at(-1).shot.id, 'drive');
  // Every shot names what it shows.
  assert.ok(s.every(({ shot }) => shot.say.length > 15));
}
assert.ok(!F.filmShots('short').some((s) => s.shot.id === 'deck'));

const near0 = (v) => v.every((x) => Math.abs(x) < 1e-9);
// Starts and ends assembled; the drive-out moves only forward, no turntable.
for (const cut of ['full', 'short']) {
  const a = F.filmFrame(cut, 0), z = F.filmFrame(cut, F.filmLength(cut));
  for (const p of Object.values(a.offsets)) assert.ok(near0(p));
  for (const p of Object.values(z.offsets)) assert.ok(near0(p));
  assert.ok(Math.abs(z.driveZ - F.DRIVE_OUT_M) < 1e-9);
}
// The head shot opens only the head; the wheel shot only the front-left wheel.
const span = (id) => F.filmShots('full').find((s) => s.shot.id === id);
const mid = (id) => { const s = span(id); return F.filmFrame('full', s.start + (s.end - s.start) * 0.6); };
const moved = (f) => Object.entries(f.offsets).filter(([, v]) => !near0(v)).map(([k]) => k);
assert.deepEqual(moved(mid('head')), ['head']);
assert.deepEqual(moved(mid('wheel')), ['front_left']);
assert.ok(mid('wheel').offsets.front_left[0] > 0, 'front-left goes out to +x, Omega1\'s left');
assert.equal(moved(mid('explode')).length, 5);
assert.ok(Math.abs(F.filmFrame('full', span('explode').end - 1e-6).yaw - Math.PI * 2) < 1e-3);

// No jumps inside a shot: the camera and parts move smoothly frame to frame.
for (const cut of ['full', 'short']) {
  for (const { start, end } of F.filmShots(cut)) {
    let prev = null;
    for (let t = start; t < end - 1e-6; t += 1 / 60) {
      const f = F.filmFrame(cut, t);
      if (prev) {
        const d = Math.hypot(...f.camera.pos.map((x, i) => x - prev.camera.pos[i]));
        assert.ok(d < 0.02, `camera jump ${d} at ${t}`);
        for (const k of Object.keys(f.offsets)) assert.ok(Math.hypot(...f.offsets[k].map((x, i) => x - prev.offsets[k][i])) < 0.02, `${k} jumps at ${t}`);
      }
      prev = f;
    }
  }
}

// The score: deterministic, in range, as long as the film plus a tail.
const a = F.renderScore('short', 8000), b = F.renderScore('short', 8000);
assert.deepEqual(a, b);
assert.ok(a.length >= F.filmLength('short') * 8000);
assert.ok(a.every((x) => x >= -1 && x <= 1));
assert.ok(a.some((x) => Math.abs(x) > 0.05));
const wav = F.scoreWav('short', 8000);
assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
// Every cue sits inside the film.
for (const c of F.filmCues('full')) assert.ok(c.t >= 0 && c.t < F.filmLength('full'));
console.log('ok');
""")
    out = subprocess.run([node, "t.mjs"], cwd=tmp_path, capture_output=True, text=True, timeout=120)
    if "ERR_UNKNOWN_FILE_EXTENSION" in out.stderr:
        pytest.skip("This node can't run .ts files")
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "ok"
