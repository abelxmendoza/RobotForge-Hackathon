"""Asimov 1 imported-specimen provenance.

The Asimov 1 entry (#012) arrived by import: the description was
cloned directly from Menlo Research's own asimov-1 repository and
the facts were parsed out of its asimov_1_25dof URDF.
catalog/specimens/asimov-1.json is the manifest of that import.
These tests pin the contract the Robodex UI relies on:

- the manifest exists and names its source (repo URL, pinned
  commit, URDF and MJCF paths) and the dual licence that was read
  from the upstream repo's licence files — never an empty or
  assumed licence;
- the Asimov 1 entry in catalog/robots.json carries a specimen
  block that agrees with the manifest (same licence, commit and
  facts);
- the import changed nothing it must not: the gate status is still
  NOT_GATED, the parts kit is still an honest null with a reason,
  and no upstream image is hotlinked.
"""

import json
from pathlib import Path

REPO = Path(__file__).parent.parent


def _load(rel: str):
    return json.loads((REPO / rel).read_text(encoding="utf-8"))


def _entry():
    robots = _load("catalog/robots.json")["robots"]
    return next(r for r in robots if r["name"] == "Asimov 1")


def _manifest():
    return _load("catalog/specimens/asimov-1.json")["specimen"]


def test_specimen_manifest_exists_with_source_and_license():
    manifest_path = REPO / "catalog" / "specimens" / "asimov-1.json"
    assert manifest_path.exists()
    spec = _manifest()
    source = spec["source"]
    assert source["repo"] == "https://github.com/menloresearch/asimov-1"
    assert source["commit"], "manifest must pin an upstream commit"
    assert source["urdf"].endswith("asimov_1_25dof.urdf")
    assert source["mjcf"].endswith("asimov_1_25dof.xml")
    assert "CERN-OHL-S-2.0" in source["license"]
    assert "GPL-2.0" in source["license"]
    assert "HARDWARE-LICENSE" in source["license_evidence"]
    assert "SOFTWARE-LICENSE" in source["license_evidence"]
    assert spec["imported_via"].startswith("direct clone")


def test_entry_specimen_block_matches_manifest():
    entry = _entry()
    block = entry["specimen"]
    spec = _manifest()
    assert block["manifest"] == "catalog/specimens/asimov-1.json"
    assert block["license"] == spec["source"]["license"]
    assert block["source_repo"] == spec["source"]["repo"]
    assert block["source_commit"] == spec["source"]["commit"]
    assert block["facts"] == spec["facts"]


def test_import_facts_are_internally_consistent():
    facts = _manifest()["facts"]
    joint_total = sum(facts["joints_by_type"].values())
    assert joint_total == facts["joint_count"] == 25
    assert facts["joints_by_type"]["revolute"] == 25
    masses = facts["link_masses_kg"]
    assert len(masses) == facts["link_count"] == 26
    assert abs(sum(masses.values()) - facts["total_mass_kg"]) < 0.001
    comp = facts["component_mass_kg"]
    assert abs(sum(comp.values()) - facts["total_mass_kg"]) < 0.01
    assert facts["base_link_mass_kg"] == masses["pelvis_link"]


def test_import_did_not_gate_kit_or_image_the_asimov():
    entry = _entry()
    assert entry["gate_status"]["status"] == "NOT_GATED"
    assert "image_url" not in entry, (
        "no hotlinked Menlo photo — its licence terms for reuse "
        "are not unambiguous (see the manifest honesty notes)")
    kits = _load("catalog/parts-kits.json")["kits"]
    assert kits["asimov-1"]["kit"] is None
    assert kits["asimov-1"]["reason"]
