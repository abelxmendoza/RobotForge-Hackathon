"""Workshop lifecycle mutations re-read storage and report real outcomes."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "web-next/src/lib"


RUN = r"""
import assert from 'node:assert/strict';
import { recordSnapshot } from './lifecycle.ts';
import { archiveRobotInStore, restoreRobotInStore } from './robotLifecycleRepository.ts';

const robot = {
  id: 'omega', name: 'Omega-1', createdAt: '2026-11-01T00:00:00.000Z',
  versions: [{ id: 'v1', spec: { name: 'Omega-1' } }],
};
let store = [robot];
let reads = 0;
const read = () => { reads += 1; return store; };
const write = (next) => { store = next; return null; };

let result = archiveRobotInStore(
  read, write, 'omega', recordSnapshot(robot), '2026-11-02T10:00:00.000Z',
);
assert.deepEqual(result, { ok: true });
assert.equal(reads, 1, 'the commit must start from one fresh read');
assert.equal(store[0].archivedAt, '2026-11-02T10:00:00.000Z');

const archivedSnapshot = recordSnapshot(store[0]);
result = restoreRobotInStore(read, write, 'omega', archivedSnapshot);
assert.deepEqual(result, { ok: true });
assert.deepEqual(store, [robot]);

const stale = recordSnapshot(robot);
store = [{ ...robot, name: 'Renamed elsewhere' }];
result = archiveRobotInStore(read, write, 'omega', stale, '2026-11-02T11:00:00.000Z');
assert.equal(result.ok, false);
assert.match(result.error, /changed/i);
assert.equal(store[0].name, 'Renamed elsewhere');
assert.equal(store[0].archivedAt, undefined);

store = [robot];
result = archiveRobotInStore(
  read,
  () => 'This browser would not save the change.',
  'omega',
  recordSnapshot(robot),
  '2026-11-02T12:00:00.000Z',
);
assert.deepEqual(result, { ok: false, error: 'This browser would not save the change.' });
assert.deepEqual(store, [robot], 'a failed writer must not announce success or mutate the source');

process.stdout.write(JSON.stringify({ ok: true }));
"""


def test_repository_archive_restore_conflict_and_failure(tmp_path: Path) -> None:
    (tmp_path / "lifecycle.ts").write_text((LIB / "lifecycle.ts").read_text())
    repository = (LIB / "robotLifecycleRepository.ts").read_text()
    (tmp_path / "robotLifecycleRepository.ts").write_text(
        repository.replace("'./lifecycle'", "'./lifecycle.ts'")
    )
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(
        ["node", "--experimental-strip-types", "run.mjs"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert json.loads(proc.stdout) == {"ok": True}
