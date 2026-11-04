"""Scan Studio (/scan/) and its link to the Workshop. The page's pure
helpers run in Node; the cross-check feeds a PLY the bridge built from
the simulated rover through the Workshop's own PLY measuring code
(components/forge/scan.ts) and gets the rover's true size back, so a
scan added from the Studio measures correctly in Improve this twin."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next/src"
STUDIO = (WEB / "components/scan/ScanStudio.tsx").read_text()

spec = importlib.util.spec_from_file_location("scan_bridge_s", ROOT / "tools" / "scan_bridge.py")
sb = importlib.util.module_from_spec(spec)
sys.modules["scan_bridge_s"] = sb
spec.loader.exec_module(sb)

RUN = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachRealsenseScan, bridgeUrlProblem, decodePoints, dimsError, rgbToRgba, scanFileName } from './scanBridge.ts';
import { isZUpRobotForgeScan } from './scan3d.ts';
import { parsePly, measureCloud } from './scan.ts';

// Only this computer.
assert.equal(bridgeUrlProblem('http://127.0.0.1:8765'), null);
assert.equal(bridgeUrlProblem('http://localhost:9000'), null);
assert.match(bridgeUrlProblem('http://192.168.1.5:8765'), /this computer/);
assert.match(bridgeUrlProblem('https://127.0.0.1:8765'), /http/);
assert.match(bridgeUrlProblem('nonsense'), /web address/);

// Frame decoding.
const xyz = new Float32Array([0, 1, 2, 3, 4, 5]);
const b64 = (u8) => Buffer.from(u8).toString('base64');
const pts = decodePoints({ points: b64(new Uint8Array(xyz.buffer)), point_colors: b64(new Uint8Array([1,2,3,4,5,6])), n: 2 });
assert.deepEqual(Array.from(pts.xyz), [0, 1, 2, 3, 4, 5]);
assert.throws(() => decodePoints({ points: b64(new Uint8Array(xyz.buffer)), point_colors: b64(new Uint8Array(3)), n: 2 }), /damaged/);
assert.deepEqual(Array.from(rgbToRgba(new Uint8Array([9, 8, 7]), 1, 1)), [9, 8, 7, 255]);
assert.deepEqual(dimsError({ length: 242, width: 200, height: 210 }, { length: 240, width: 200, height: 210 }), { length: 0.8, width: 0, height: 0 });
assert.equal(scanFileName('Omega1', new Date('2026-11-04T01:00:00Z')), 'omega1-realsense-2026-11-04.ply');

// Attaching fills the RealSense slot and mirrors into the viewer scan; archived robots are refused.
const meta = { name: 'omega1-realsense.ply', format: 'ply', bytes: 10, addedAt: '2026-11-04T00:00:00Z' };
const robots = [
  { id: 'omega1', name: 'Omega1', createdAt: 'x', versions: [], scans: [{ kind: 'realsense', name: 'old.ply' }, { kind: 'scaniverse', name: 's.ply' }] },
  { id: 'r2', name: 'Old', createdAt: 'x', versions: [], archivedAt: '2026-11-01' },
];
const next = attachRealsenseScan(robots, 'omega1', meta);
assert.deepEqual(next[0].scans.map((s) => [s.kind, s.name]), [['scaniverse', 's.ply'], ['realsense', 'omega1-realsense.ply']]);
assert.equal(next[0].scan.name, 'omega1-realsense.ply');
assert.equal(next[1], robots[1]);
assert.equal(attachRealsenseScan(robots, 'r2', meta), null);
assert.equal(attachRealsenseScan(robots, 'gone', meta), null);

// The bridge's PLY through the Workshop's own measuring code.
const buf = readFileSync('scan.ply');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
assert.equal(isZUpRobotForgeScan(ab), true);
const parsed = parsePly(ab);
const m = measureCloud(parsed.positions);
assert.equal(m.ok, true);
process.stdout.write(JSON.stringify({ extentsM: m.extentsM, unitNote: m.unitNote }));
"""


def test_studio_helpers_and_workshop_measuring_agree(tmp_path: Path) -> None:
    src = sb.SimSource(frames_per_orbit=30, seed=7)
    frames = [src.read() for _ in range(30)]
    r = sb.build_scan(frames, src.intr, 0.15, 1.2, tmp_path, simulated=True)
    (tmp_path / "scanBridge.ts").write_text((WEB / "lib/scanBridge.ts").read_text())
    (tmp_path / "scan3d.ts").write_text((WEB / "lib/scan3d.ts").read_text())
    (tmp_path / "scan.ts").write_text((WEB / "components/forge/scan.ts").read_text())
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"], cwd=tmp_path,
                          capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    out = json.loads(proc.stdout)
    assert out["unitNote"] == ""  # metres, no conversion
    workshop_mm = [e * 1000 for e in out["extentsM"]]
    studio = r["dims_mm"]
    # Workshop reads x -> length, y -> width, z -> height: same numbers as the Studio.
    for got, key in zip(workshop_mm, ("length", "width", "height")):
        assert abs(got - studio[key]) <= 1.0, (key, got, studio[key])
        assert abs(got - sb.SIM_TRUTH_MM[key]) <= 0.02 * sb.SIM_TRUTH_MM[key]


def test_studio_is_honest_about_what_it_is() -> None:
    # Simulated scans are labelled and can't be attached to a real robot.
    assert "SIMULATED" in STUDIO and "can&apos;t be added to a robot" in STUDIO
    assert "not photogrammetry" in STUDIO
    # It only ever talks to this computer, and says why a bridge is needed.
    assert "bridgeUrlProblem(base)" in STUDIO
    assert "Browsers can&apos;t read a RealSense" in STUDIO
    # The scan lands in the RealSense slot that Improve this twin measures from.
    assert "saveSlotScanFile(robot.id, 'realsense'" in STUDIO
    assert "saveScanFile(robot.id," in STUDIO  # the Overview viewer's own key too
    assert "Step 2" in STUDIO
    improve = (WEB / "components/garage/ImproveTwin.tsx").read_text()
    assert 'href="/scan/"' in improve
    assert (WEB / "app/scan/page.tsx").exists()
