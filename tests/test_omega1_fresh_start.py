"""Omega1 is built into every account, and can be started over (2026-11-03).

Abel's ask: a brand-new account must already know Omega1 (the Freenove
FNK0043 4WD car) without generating it, and he must be able to delete
his current Omega1 copy and start from scratch for the demo.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next/src"
LIB = WEB / "lib"
GARAGE = (WEB / "components/garage/Garage.tsx").read_text()
FORGE = (WEB / "components/forge/ForgeThread.tsx").read_text()

RUN = r"""
import assert from 'node:assert/strict';
import { recordSnapshot } from './lifecycle.ts';
import { archiveRobotInStore, deleteArchivedRobotInStore, replaceRobotInStore } from './robotLifecycleRepository.ts';

const omega = { id: 'omega1', name: 'Omega1', createdAt: '2026-11-01T00:00:00.000Z',
  versions: [{ id: 'v1' }, { id: 'v2' }], scans: [{ kind: 'realsense' }] };
const other = { id: 'r2', name: 'Burger', createdAt: '2026-11-01T00:00:00.000Z', versions: [{ id: 'b1' }] };
let store = [omega, other];
const read = () => store;
const write = (next) => { store = next; return null; };

// An active robot cannot be deleted forever: it must be archived first.
let r = deleteArchivedRobotInStore(read, write, 'omega1', recordSnapshot(omega));
assert.equal(r.ok, false);
assert.match(r.error, /archive/i);
assert.equal(store.length, 2);

// Start over replaces the record in place, keeping the fixed id.
const fresh = { id: 'omega1', name: 'Omega1', createdAt: '2026-11-03T00:00:00.000Z', versions: [{ id: 'n1' }] };
r = replaceRobotInStore(read, write, 'omega1', recordSnapshot(omega), fresh);
assert.deepEqual(r, { ok: true });
assert.deepEqual(store, [fresh, other]);

// A stale snapshot is refused.
r = replaceRobotInStore(read, write, 'omega1', recordSnapshot(omega), fresh);
assert.equal(r.ok, false);

// Archive, then delete forever: the record is gone, others untouched.
r = archiveRobotInStore(read, write, 'omega1', recordSnapshot(fresh), '2026-11-03T01:00:00.000Z');
assert.deepEqual(r, { ok: true });
r = deleteArchivedRobotInStore(read, write, 'omega1', recordSnapshot(store[0]));
assert.deepEqual(r, { ok: true });
assert.deepEqual(store, [other]);

process.stdout.write(JSON.stringify({ ok: true }));
"""


def test_delete_forever_and_start_over_in_the_store(tmp_path: Path) -> None:
    (tmp_path / "lifecycle.ts").write_text((LIB / "lifecycle.ts").read_text())
    repo = (LIB / "robotLifecycleRepository.ts").read_text()
    (tmp_path / "robotLifecycleRepository.ts").write_text(repo.replace("'./lifecycle'", "'./lifecycle.ts'"))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"], cwd=tmp_path,
                          capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert json.loads(proc.stdout) == {"ok": True}


def test_built_in_omega1_is_always_offered():
    # The specimen button is not gated on anything stored.
    assert '<p className="faint g-small" style={{ marginTop: 14 }}>Built-in specimen</p>' in GARAGE
    # Only an ACTIVE stored copy blocks a fresh adopt.
    assert "const storedOmega1 = activeRobots.find((r) => r.id === OMEGA1_ROBOT_ID)" in GARAGE
    assert "#omega1" in GARAGE


def test_ui_asks_before_deleting_or_starting_over():
    assert "Delete forever" in GARAGE and "Yes, delete" in GARAGE
    assert "Start over from the records" in GARAGE and "Yes, start over" in GARAGE
    assert "can&apos;t be undone" in GARAGE
    # Archive alone never deletes scan files (they stay for Restore).
    assert "removeScanFile" not in GARAGE


def test_forge_opens_the_built_in_omega1_instead_of_generating():
    assert "export function omega1Ask" in FORGE
    assert "Omega1 is already built in" in FORGE
    assert 'href="/garage/#omega1"' in FORGE
    i = FORGE.index("const runText = useCallback(")
    j = FORGE.index("postJSON<{ spec: RobotSpec }>('/describe'", i)
    assert FORGE.index("omega1Ask(value)", i) < j
