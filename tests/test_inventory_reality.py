"""Inventory reality (real vs sim-only) and Parts/Tools sections."""
import json
import shutil
import subprocess
from pathlib import Path
import pytest
ROOT = Path(__file__).resolve().parents[1]


def test_inventory_reality_and_sections(tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node unavailable')
    src = ROOT / 'web-next/src/lib/inventory.ts'
    (tmp_path / 'run.mjs').write_text(f'''
import assert from 'node:assert/strict';
import {{partReality, partSection, sectionForCategory, categoryHint, matchesInventory, importedPart, applyUpdate, mergeUpdate}} from {json.dumps(str(src))};
const base = {{id:'p1', name:'Jetson Orin Nano', category:'computer', quantity:2, specs:{{}}, photo:null, read_from_label:[], condition:'used', confidence:'owner', status:'confirmed', question:'', chat:[], createdAt:'t', source:'manual'}};

/* Legacy records (no reality/section fields) read back as real,
 * sectioned by category — they were shelf items by construction. */
assert.equal(partReality(base), 'real');
assert.equal(partSection(base), 'parts');
assert.equal(partSection({{...base, category:'tool'}}), 'tools');

/* Explicit fields win over the defaults. */
assert.equal(partReality({{...base, reality:'sim_only'}}), 'sim_only');
assert.equal(partSection({{...base, section:'tools'}}), 'tools');
assert.equal(sectionForCategory('tool'), 'tools');
assert.equal(sectionForCategory('motor'), 'parts');

/* A soldering iron filename classifies as a tool; a motor driver
 * filename still classifies as a motor driver, not a tool. */
assert.equal(categoryHint('soldering_iron.jpg'), 'tool');
assert.equal(categoryHint('motor_driver_L298N.jpg'), 'motor_driver');

/* Search can find sim-only records by their reality. */
const sim = {{...base, id:'p2', name:'Virtual lidar', reality:'sim_only'}};
assert.equal(matchesInventory(sim, 'sim only', 'all', 'all'), true);
assert.equal(matchesInventory(base, 'sim only', 'all', 'all'), false);

/* Import normalises: legacy export without the fields gets real+parts;
 * an explicit sim-only tool keeps both fields. */
const legacy = importedPart(base);
assert.equal(legacy.reality, 'real'); assert.equal(legacy.section, 'parts');
const tool = importedPart({{...base, id:'p3', category:'tool', reality:'sim_only', section:'tools'}});
assert.equal(tool.reality, 'sim_only'); assert.equal(tool.section, 'tools');
const bad = importedPart({{...base, id:'p4', reality:'imaginary', section:'junk'}});
assert.equal(bad.reality, 'real'); assert.equal(bad.section, 'parts');

/* Updates carry reality/section; owner-wins merge protects them. */
assert.equal(applyUpdate(base, {{reality:'sim_only'}}).reality, 'sim_only');
const snap = {{...base, reality:'real'}};
const edited = {{...snap, reality:'sim_only'}};
assert.equal(mergeUpdate(edited, snap, {{reality:'real'}}).reality, 'sim_only');
assert.equal(mergeUpdate(snap, snap, {{reality:'sim_only'}}).reality, 'sim_only');
''')
    result = subprocess.run([node, '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
