"""Go2 imported-specimen provenance.

The Unitree Go2 entry (#007) arrived by import: the
`robot_descriptions` package downloaded Unitree's own unitree_ros
repo and tools/import_go2_specimen.py parsed the facts out of its
URDF. catalog/specimens/unitree-go2.json is the manifest of that
import. These tests pin the contract the Robodex UI relies on:

- the manifest exists and names its source (repo URL, pinned
  commit, URDF path) and a license that was read from the upstream
  repo's LICENSE file — never an empty or assumed license;
- the Go2 entry in catalog/robots.json carries a specimen block
  that agrees with the manifest (same license, commit and facts);
- the import changed nothing it must not: the gate status is still
  NOT_GATED and the parts kit is still an honest null with a reason.
"""

import json
from pathlib import Path

REPO = Path(__file__).parent.parent


def _load(rel: str):
    return json.loads((REPO / rel).read_text(encoding="utf-8"))


def _go2_entry():
    robots = _load("catalog/robots.json")["robots"]
    return next(r for r in robots if r["name"] == "Unitree Go2")


def _manifest():
    return _load("catalog/specimens/unitree-go2.json")["specimen"]


def test_specimen_manifest_exists_with_source_and_license():
    manifest_path = REPO / "catalog" / "specimens" / "unitree-go2.json"
    assert manifest_path.exists()
    spec = _manifest()
    source = spec["source"]
    assert source["repo"].startswith("https://github.com/")
    assert source["commit"], "manifest must pin an upstream commit"
    assert source["urdf"].endswith("go2_description.urdf")
    assert source["license"], "license field must not be empty"
    assert source["license"] == "BSD-3-Clause"
    assert "LICENSE" in source["license_evidence"]
    assert spec["imported_via"].startswith("robot_descriptions")


def test_entry_specimen_block_matches_manifest():
    entry = _go2_entry()
    block = entry["specimen"]
    spec = _manifest()
    assert block["manifest"] == "catalog/specimens/unitree-go2.json"
    assert block["license"] == spec["source"]["license"]
    assert block["source_repo"] == spec["source"]["repo"]
    assert block["source_commit"] == spec["source"]["commit"]
    assert block["facts"] == spec["facts"]


def test_import_facts_are_internally_consistent():
    facts = _manifest()["facts"]
    joint_total = sum(facts["joints_by_type"].values())
    assert joint_total == facts["joint_count"]
    assert facts["joints_by_type"]["revolute"] == 12
    # Legs + everything else must add back up to the URDF total.
    legs = 4 * facts["leg_mass_kg_each"][0]
    assert legs < facts["total_mass_kg"]
    assert facts["base_link_mass_kg"] < facts["total_mass_kg"]


def test_import_did_not_gate_or_kit_the_go2():
    entry = _go2_entry()
    assert entry["gate_status"]["status"] == "NOT_GATED"
    kits = _load("catalog/parts-kits.json")["kits"]
    assert kits["unitree-go2"]["kit"] is None
    assert kits["unitree-go2"]["reason"]
