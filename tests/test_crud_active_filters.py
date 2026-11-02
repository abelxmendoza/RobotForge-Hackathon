"""Active operation contexts never resolve an archived robot."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "web-next/src/lib"


RUN = r"""
import assert from 'node:assert/strict';
import { readActiveRobots } from './robotLifecycleRepository.ts';

let reads = 0;
const all = [
  { id: 'active', name: 'Active', versions: [] },
  { id: 'archived', name: 'Archived', versions: [], archivedAt: '2026-11-02T12:00:00.000Z' },
];
const active = readActiveRobots(() => { reads += 1; return all; });
assert.equal(reads, 1);
assert.deepEqual(active.map((robot) => robot.id), ['active']);
assert.equal(all.length, 2, 'filtering an operation context must not erase archived storage');
process.stdout.write(JSON.stringify({ ok: true }));
"""


def test_active_store_view_excludes_archived_without_erasing_it(tmp_path: Path) -> None:
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
