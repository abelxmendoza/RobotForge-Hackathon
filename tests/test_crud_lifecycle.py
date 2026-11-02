"""Behavioral checks for the recoverable record lifecycle."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIFECYCLE = ROOT / "web-next/src/lib/lifecycle.ts"


RUN = r"""
import assert from 'node:assert/strict';
import {
  LifecycleConflictError, activeRecords, archivedRecords,
  activeSelection, archiveRecord, recordSnapshot, restoreRecord,
} from './lifecycle.ts';

const original = {
  id: 'omega', name: 'Omega-1', createdAt: '2026-11-01T00:00:00.000Z',
  versions: [{ id: 'v1', spec: { wheel: { count: 4 } } }],
  repoImport: { provenance: { repo: 'Omega-Code' } },
  scan: { name: 'omega.ply', format: 'ply', bytes: 2048, addedAt: '2026-11-01T01:00:00.000Z' },
};
const archived = { ...original, id: 'old', archivedAt: '2026-11-02T12:00:00.000Z' };
const invalid = { ...original, id: 'invalid', archivedAt: 'yesterday' };

assert.deepEqual(activeRecords([original, archived, invalid]).map((r) => r.id), ['omega', 'invalid']);
assert.deepEqual(archivedRecords([original, archived, invalid]).map((r) => r.id), ['old']);
assert.equal(activeSelection([original, invalid], 'invalid'), 'invalid');
assert.equal(activeSelection([original, invalid], 'archived'), 'omega');
assert.equal(activeSelection([], 'omega'), null);

const snapshot = recordSnapshot(original);
const afterArchive = archiveRecord([original], 'omega', snapshot, '2026-11-02T13:14:15.000Z');
assert.equal(afterArchive[0].archivedAt, '2026-11-02T13:14:15.000Z');
assert.equal('archivedAt' in original, false, 'archive must not mutate the input');
const { archivedAt: _archivedAt, ...roundTrip } = afterArchive[0];
assert.deepEqual(roundTrip, original, 'archive changes no field except archivedAt');

const restored = restoreRecord(afterArchive, 'omega', recordSnapshot(afterArchive[0]));
assert.deepEqual(restored, [original], 'restore preserves nested robot data exactly');

const newer = { ...original, name: 'Omega-1 renamed' };
assert.throws(
  () => archiveRecord([newer], 'omega', snapshot, '2026-11-02T13:14:15.000Z'),
  LifecycleConflictError,
  'a stale preview must not overwrite the newer robot',
);
assert.deepEqual(newer, { ...original, name: 'Omega-1 renamed' });
assert.throws(
  () => restoreRecord([], 'omega', snapshot),
  LifecycleConflictError,
  'a missing target is a conflict, not a silent success',
);

for (const bad of ['', '2026-11-02', '2026-11-02T13:14:15Z', 'yesterday']) {
  assert.throws(() => archiveRecord([original], 'omega', snapshot, bad), RangeError);
}

process.stdout.write(JSON.stringify({ ok: true }));
"""


def test_archive_restore_and_conflicts_preserve_records(tmp_path: Path) -> None:
    (tmp_path / "lifecycle.ts").write_text(LIFECYCLE.read_text())
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
