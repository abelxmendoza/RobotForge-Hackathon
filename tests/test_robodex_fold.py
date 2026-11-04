"""The Robodex fold (Abel, 2026-11-03): ONE Robodex on /robots.

Five directions, five guards:
 1. "Robot families and your sightings" is not another component:
    the fold is gone from RobotsIndex, LocalDexSightings is
    deleted, and family/variant grouping lives inside the source
    tabs (DexSources' SightingsGroups, with the variant signature
    in plain words).
 2. My robots in the Robodex IS the Workshop's My robots: same
    Garage store, read reactively through useStore, same archived
    filter, same built-in Omega1 specimen rule.
 3. Spot (spot-cpp, Cal Poly Pomona IRLab) files under Sighted —
    it is CPP's robotics club robot, not Abel's — and no catalog
    Spot double-presents as a Researched robot.
 4. Every Robodex card type carries Bring into Workshop, wired to
    the existing save-to-Garage construction (buildDexEntry), and
    a robot with no recorded spec says so instead of inventing one.
 5. Wrench chat can recategorize: the grammar parses move /
    recategorize / reset for all four destinations, the overrides
    store key exists and is a demo data key, and the Robodex
    consults overrides before the automatic rules.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
ROBOTS_DIR = WEB / "src/components/robots"
INDEX = (ROBOTS_DIR / "RobotsIndex.tsx").read_text()
DEX = (ROBOTS_DIR / "DexSources.tsx").read_text()
CARD = (ROBOTS_DIR / "RobotCard.tsx").read_text()
CHATDOCK = (WEB / "src/components/chat/ChatDock.tsx").read_text()
PROPOSAL = (WEB / "src/components/chat/DexMoveProposal.tsx").read_text()
OVERRIDES_TS = (WEB / "src/lib/dexOverrides.ts").read_text()
CATEGORIZE_TS = (WEB / "src/lib/dexCategorize.ts").read_text()
DEMOMODE_TS = (WEB / "src/lib/demoMode.ts").read_text()
FAMILIES = json.loads((REPO / "catalog/families.json").read_text())
CATALOG = json.loads((REPO / "catalog/robots.json").read_text())


# ---------------------------------------------------------------- 1. fold

def test_no_families_fold_on_robots_page():
    assert "Robot families and your sightings" not in INDEX
    assert "LocalDexSightings" not in INDEX
    assert "<details" not in INDEX
    assert not (ROBOTS_DIR / "LocalDexSightings.tsx").exists(), \
        "the standalone browser-sightings component is folded in, not kept"
    # nothing else renders it either
    for src in WEB.rglob("*.tsx"):
        assert "LocalDexSightings" not in src.read_text(), src


def test_family_grouping_lives_inside_the_tabs():
    # sightings group by family, then variant, inside DexSources,
    # with the variant signature described in plain words
    assert "SightingsGroups" in DEX
    assert "describeSignature" in DEX
    assert "byFamily" in DEX and "byVariant" in DEX
    # browser-saved sightings join the same grids
    assert "allDexSightings" in DEX and "loadSightings" in DEX
    # RobotsIndex renders the grouped sightings in BOTH sighting tabs,
    # plus in Researched for a sighting the owner re-filed there
    assert 'source="sighted"' in INDEX and 'source="photos"' in INDEX
    assert INDEX.count("<SightingsGroups") == 3
    assert 'items={dex.sightingsByTab.researched} source="researched"' in INDEX


def test_refiled_records_render_in_their_destination_tab():
    # A catalog robot moved to Sighted, or a sighting moved to
    # Researched, shows (and counts) there instead of vanishing.
    assert "dex.catalogByTab.sighted.map(catalogCell)" in INDEX
    assert "dex.catalogByTab.sighted.length +" in INDEX
    assert "dex.sightingsByTab.researched.length +" in INDEX
    # A browser-saved PhotoDraft keeps its recorded spec under `spec`.
    assert "d.draft_spec ?? d.spec" in DEX
    # The chat bring-in re-reads the Garage after its async fetch.
    move = (WEB / "src/components/chat/DexMoveProposal.tsx").read_text()
    assert "const latest = readStore<GarageRobot[]>(GARAGE_KEY, [])" in move


# ------------------------------------------------------- 2. My robots parity

def test_my_robots_is_the_workshops_list():
    # same store, read reactively (not the old one-shot readStore)
    assert "useStore<GarageRobot[]>(GARAGE_KEY" in DEX
    assert "readStore<GarageRobot[]>(GARAGE_KEY" not in DEX.split("BringIntoWorkshop")[0]
    # same archived-records filter the Workshop applies
    assert "activeRecords(stored)" in DEX
    # nothing else: the Workshop hides the built-in Omega1 specimen,
    # so My robots never adds it either (Abel, 2026-11-04) — Omega1
    # shows here only once it is a stored Workshop robot
    assert "OMEGA1_ROBOT_ID" not in DEX
    assert "showOmegaSpecimen" not in DEX
    assert "Adopt as my robot" not in DEX
    index = (WEB / "src/components/robots/RobotsIndex.tsx").read_text()
    assert "showOmegaSpecimen" not in index
    assert "mine: dex.mine ? dex.garageByTab.mine.length : null" in index


def test_only_your_robot_cards_can_be_deleted():
    # the Workshop's own delete operation, snapshot-guarded, with the
    # same clean-up of scans, notes and the unsaved draft
    assert "deleteRobotInStore(" in DEX
    assert "recordSnapshot(robot)" in DEX
    assert "forgetRobotScans(robot.id)" in DEX
    assert "forgetRobotNotes(robot.id)" in DEX
    card = DEX.split("export function GarageRobotCard")[1].split("export function MyRobotsGrid")[0]
    assert ">Delete</button>" in card and "Yes, delete" in card
    # catalog and sighting cards carry no Delete
    sightings = DEX.split("export function SightingsGroups")[1]
    assert "Delete" not in sightings
    index = (WEB / "src/components/robots/RobotsIndex.tsx").read_text()
    assert "deleteGarageRobot" not in index and ">Delete<" not in index


# ------------------------------------------------------------------ 3. Spot

def test_spot_files_under_sighted_as_cpp_club_robot():
    spot = None
    for fam in FAMILIES["families"]:
        for var in fam["variants"]:
            for s in var["sightings"]:
                if s["id"] == "spot-cpp":
                    spot = (fam, var, s)
    assert spot is not None, "spot-cpp sighting missing from families.json"
    fam, var, s = spot
    assert fam["name"] == "Boston Dynamics Spot"
    # a recorded place is what files a sighting under Sighted
    assert s["where"] == "Cal Poly Pomona IRLab"
    assert 'overrides[sightingKey(s.id)] ?? (s.where ? "sighted" : "photos")' in DEX
    # the card carries the ownership context: CPP's club robot,
    # explicitly not the owner's
    assert '"spot-cpp"' in DEX and "Not your robot" in DEX
    assert "Cal Poly Pomona IRLab" in DEX


def test_no_catalog_spot_to_double_present():
    # dedupe fact: the catalog holds no Spot record, so the CPP
    # sighting is the ONLY Spot presentation — nothing to merge,
    # and Researched must never gain a second Spot from the data.
    names = [r["name"] for r in CATALOG["robots"]]
    assert not any("spot" in n.lower() for n in names), names
    assert len(names) == 11


# ------------------------------------------------------- 4. bring into Workshop

def test_bring_into_workshop_on_every_card_type():
    # one action component, built on the existing save path
    assert "export function BringIntoWorkshop" in DEX
    assert "buildDexEntry" in DEX  # lib/saveRobot, the chat flow's builder
    assert "writeStore(GARAGE_KEY" in DEX
    # catalog cards (Researched groups + From photos grid) get it
    assert INDEX.count("<BringIntoWorkshop") >= 1
    assert "specFile={r.spec_file}" in INDEX
    # sighting cards get it, from their dossier's draft spec
    assert "<BringIntoWorkshop name={s.identity} draftSpec={s.draftSpec} />" in DEX
    # duplicate-safe: a robot already in the Workshop says so
    assert "In your Workshop" in DEX
    # no recorded spec -> honest copy + the import path, no invention
    assert "No recorded spec to bring in" in DEX
    assert "Import a photo or spec in the Workshop" in DEX


# ------------------------------------------------------------ 5. chat filing

def test_overrides_store_registered_for_demo_sandbox():
    assert 'DEX_OVERRIDES_KEY = "rf.dex.overrides.v1"' in OVERRIDES_TS
    # demo edits stay in the demo sandbox like every visitor key
    demo_keys = DEMOMODE_TS.split("DEMO_DATA_KEYS")[1].split("]);")[0]
    assert "'rf.dex.overrides.v1'" in demo_keys


def test_overrides_consulted_before_automatic_rules():
    # catalog: override ?? photo-draft rule
    assert 'overrides[dexKey(robot)] ?? (isPhotoDraft(robot) ? "photos" : "researched")' in DEX
    # garage: override ?? mine
    assert 'overrides[garageKey(r.id)] ?? "mine"' in DEX
    # the card badge reads the same resolved filing
    assert "sourceOverride" in CARD
    assert "catalogBadgeOverride" in INDEX
    # moving a Workshop robot out changes filing only — the
    # preview says the Workshop entry stays
    assert "stays in your Workshop" in CATEGORIZE_TS
    # moving TO my robots is the bring-in, and a spec-less robot
    # is honestly blocked
    assert "bringIn" in CATEGORIZE_TS and "no recorded spec" in CATEGORIZE_TS


def test_chatdock_wires_the_filing_grammar():
    assert "parseDexMove(q)" in CHATDOCK
    assert "buildDexEntities" in CHATDOCK and "planDexMove" in CHATDOCK
    assert "<DexMoveProposal" in CHATDOCK
    # the filing grammar runs before the assembly grammar, so an
    # assembly "move ... to 0 0 70" can never be eaten by it (the
    # parser itself refuses numeric destinations — node test below)
    assert CHATDOCK.index("parseDexMove(q)") < CHATDOCK.index("parseAssemblyCommand(q")
    # Operations help lists the new commands
    assert 'move "Spot" to sighted' in CHATDOCK
    assert "reset categorization for" in CHATDOCK
    # Apply writes through the same save-to-Garage construction
    assert "buildDexEntry" in PROPOSAL
    assert "saveDexOverrides(applyDexMove(loadDexOverrides(), plan))" in PROPOSAL


NODE_SCRIPT = r"""
import assert from 'node:assert/strict';
import { parseDexMove, planDexMove, resolveDexEntity, applyDexMove, buildDexEntities } from './dexCategorize.ts';

// Abel's example phrasings, all four destinations + reset
assert.deepEqual(parseDexMove('move "Spot" to sighted'), { name: 'Spot', dest: 'sighted' });
assert.deepEqual(parseDexMove('put "Andino" under from photos'), { name: 'Andino', dest: 'photos' });
assert.deepEqual(parseDexMove('move "Omega1" to my robots'), { name: 'Omega1', dest: 'mine' });
assert.deepEqual(parseDexMove('recategorize "TurtleBot3 Waffle Pi" as researched'), { name: 'TurtleBot3 Waffle Pi', dest: 'researched' });
assert.deepEqual(parseDexMove('reset categorization for "Spot"'), { name: 'Spot', dest: null });
assert.deepEqual(parseDexMove('file "Omega1" under sighted'), { name: 'Omega1', dest: 'sighted' });
// bare names work too
assert.deepEqual(parseDexMove('move Spot to sighted'), { name: 'Spot', dest: 'sighted' });
// assembly / build phrases must NOT match the filing grammar
assert.equal(parseDexMove('move "Jetson Orin Nano" on "Omega1" to 0 0 70 mm'), null);
assert.equal(parseDexMove('move the arm to 0 0 70'), null);
assert.equal(parseDexMove('build a robot'), null);
assert.equal(parseDexMove('list my robots'), null);

// entities: automatic filing first (sighting with a place sighted,
// photo-draft catalog robot photos, other catalog researched)
const catalog = [
  { number: 1, name: 'Andino', source: 'researched', spec_file: 'specs/andino.json' },
  { number: 2, name: 'TurtleBot3 Waffle Pi', source: 'researched', spec_file: 'specs/waffle.json' },
];
const isPhotoDraft = (r) => r.name.includes('Waffle');
const sightings = [
  { id: 'spot-cpp', identity: 'Spot with Arm', where: 'Cal Poly Pomona IRLab', draftSpec: { name: 'Spot' } },
  { id: 'andino', identity: 'Andino', where: null, draftSpec: null },
];
const garage = [{ id: 'g1', name: 'Omega1', createdAt: 't', versions: [] }];
let entities = buildDexEntities({ catalog, isPhotoDraft, sightings, garage, overrides: {} });
const byName = (n) => entities.find((e) => e.name === n);
assert.equal(byName('Spot with Arm').currentTab, 'sighted');
assert.equal(byName('TurtleBot3 Waffle Pi').currentTab, 'photos');
assert.equal(byName('Andino').currentTab, 'photos'); // the sighting record
assert.equal(byName('Omega1').currentTab, 'mine');

// an override beats the automatic rule, and reset restores it
const spot = byName('Spot with Arm');
let plan = planDexMove(spot, 'researched');
let overrides = applyDexMove({}, plan);
assert.equal(overrides['sighting:spot-cpp'], 'researched');
entities = buildDexEntities({ catalog, isPhotoDraft, sightings, garage, overrides });
assert.equal(byName('Spot with Arm').currentTab, 'researched');
plan = planDexMove(byName('Spot with Arm'), null);
overrides = applyDexMove(overrides, plan);
assert.deepEqual(overrides, {});
entities = buildDexEntities({ catalog, isPhotoDraft, sightings, garage, overrides });
assert.equal(byName('Spot with Arm').currentTab, 'sighted');

// name resolution: unique substring resolves; ambiguous does not guess
assert.equal(resolveDexEntity('Spot', entities).length >= 1, true);
assert.equal(resolveDexEntity('Andino', entities).length, 2); // catalog + sighting

// moving a garage robot out of mine: filing only, stated plainly
plan = planDexMove(byName('Omega1'), 'sighted');
assert.match(plan.summary, /stays in your Workshop/);
assert.equal(plan.bringIn, false);
// moving a sighting to mine brings it in from its recorded spec
plan = planDexMove(byName('Spot with Arm'), 'mine');
assert.equal(plan.bringIn, true);
// a sighting with NO recorded spec is blocked, honestly
const andinoSighting = entities.find((e) => e.kind === 'sighting' && e.name === 'Andino');
plan = planDexMove(andinoSighting, 'mine');
assert.ok(plan.blocked && /no recorded spec/i.test(plan.blocked));
console.log('dex categorization checks passed');
"""


def test_dex_categorize_grammar_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    lib = WEB / "src/lib"
    (tmp_path / "dexCategorize.ts").write_text(
        CATEGORIZE_TS.replace('from "./dexOverrides"', 'from "./dexOverrides.ts"'))
    (tmp_path / "dexOverrides.ts").write_text(
        OVERRIDES_TS.replace('from "./store"', 'from "./store.ts"'))
    (tmp_path / "store.ts").write_text(
        "const m = new Map();\n"
        "export function readStore(k, f) { return m.has(k) ? m.get(k) : f; }\n"
        "export function writeStore(k, v) { m.set(k, v); return null; }\n")
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(NODE_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs")],
        capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
