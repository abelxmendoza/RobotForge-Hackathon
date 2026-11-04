"""Only robots in the Workshop are yours: Robodex's My robots and Wrench agree."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web-next/src"
DEX = (SRC / "components/robots/DexSources.tsx").read_text()
INDEX = (SRC / "components/robots/RobotsIndex.tsx").read_text()
GARAGE = (SRC / "components/garage/Garage.tsx").read_text()
DELETE = (SRC / "lib/robotDelete.ts").read_text()
CHAT = (SRC / "components/chat/ChatDock.tsx").read_text()

RUN = r"""
import assert from 'node:assert/strict';
import {
  classifyRobot, deleteRefusal, isCurrentRobotName, ownedRobotsText, ownershipAnswer,
  parseOwnershipAsk,
} from './robotOwnership.ts';

const rover = { id: 'r1', name: 'My Rover', versions: [{ id: 'v1' }, { id: 'v2' }] };
const old = { id: 'r2', name: 'Old Arm', versions: [{ id: 'v1' }], archivedAt: 'x' };
const records = [{ name: 'Spot', tab: 'Sighted' }, { name: 'Panda Arm', tab: 'Researched' }, { name: 'Boston Dynamics Stretch', tab: 'Sighted' }, { name: 'Andino', tab: 'Researched' }, { name: 'My Rover', tab: 'Researched' }];
const who = (name, match = 'loose') => classifyRobot(name, { active: [rover], archived: [old], records, match });

// Parsing: robots and lists match, assembly edits do not.
assert.deepEqual(parseOwnershipAsk('delete my robot My Rover'), { kind: 'delete', name: 'My Rover', explicit: true, match: 'loose' });
assert.deepEqual(parseOwnershipAsk('remove Spot from my robots.'), { kind: 'delete', name: 'Spot', explicit: true, match: 'loose' });
assert.deepEqual(parseOwnershipAsk('delete "My Rover"'), { kind: 'delete', name: 'My Rover', explicit: false, match: 'word' });
assert.deepEqual(parseOwnershipAsk('remove arm'), { kind: 'delete', name: 'arm', explicit: false, match: 'exact' });
assert.deepEqual(parseOwnershipAsk('is Omega1 mine?'), { kind: 'whose', name: 'Omega1' });
assert.deepEqual(parseOwnershipAsk('do I own Spot?'), { kind: 'whose', name: 'Spot' });
assert.equal(parseOwnershipAsk('remove the battery from Omega1'), null);
assert.equal(parseOwnershipAsk('remove lidar on My Rover'), null);
assert.equal(parseOwnershipAsk('what is Omega1'), null);
assert.ok(isCurrentRobotName('this robot') && isCurrentRobotName('it') && !isCurrentRobotName('Spot'));

// The Workshop decides, ahead of a catalog record of the same name.
assert.equal(who('my rover').kind, 'mine');
assert.equal(who('Old Arm').kind, 'archived');
assert.equal(who('Spot').kind, 'record');
assert.equal(who('Omega1').kind, 'omega1');
assert.equal(who('nope').kind, 'unknown');
assert.equal(who('arm', 'exact').kind, 'unknown', 'a bare remove needs the exact name');
assert.equal(who('Arm', 'word').kind, 'archived', 'a whole word is enough for delete');
assert.equal(who('stretch', 'word').kind, 'record');
assert.equal(who('stret', 'word').kind, 'unknown');
assert.equal(who('stret', 'loose').kind, 'record');

// Only your own robots can be deleted.
assert.equal(deleteRefusal('My Rover', who('My Rover')), null);
assert.equal(deleteRefusal('Old Arm', who('Old Arm')), null);
assert.match(deleteRefusal('Spot', who('Spot')), /isn't yours/);
assert.match(deleteRefusal('Omega1', who('Omega1')), /isn't one of your robots/);
assert.match(deleteRefusal('nope', who('nope')), /nothing was deleted/);
const twins = classifyRobot('Twin', { active: [{ ...rover, name: 'Twin' }, { ...rover, id: 'r3', name: 'Twin' }], archived: [], records: [], match: 'exact' });
assert.match(deleteRefusal('Twin', twins), /won't guess/);

// What Wrench says.
assert.match(ownershipAnswer('My Rover', who('My Rover')), /^Yes\. My Rover is yours/);
assert.match(ownershipAnswer('Spot', who('Spot')), /^No\. Spot isn't yours/);
assert.match(ownershipAnswer('Omega1', who('Omega1')), /^No, not right now/);
assert.match(ownedRobotsText([rover]), /My Rover — 2 versions/);
assert.match(ownedRobotsText([]), /don't have any robots of your own/);

process.stdout.write(JSON.stringify({ ok: true }));
"""


def test_ownership_rules(tmp_path: Path) -> None:
    (tmp_path / "robotOwnership.ts").write_text((SRC / "lib/robotOwnership.ts").read_text())
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(
        ["node", "--experimental-strip-types", "run.mjs"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert json.loads(proc.stdout) == {"ok": True}


def test_my_robots_shows_only_the_workshop_list() -> None:
    for source in (DEX, INDEX):
        assert "showOmegaSpecimen" not in source
        assert "showSpecimen" not in source
    assert "Adopt as my robot" not in DEX
    assert "Built-in specimen" not in DEX
    assert "const mine = garageReady ? activeRecords(stored) : null;" in DEX


def test_only_your_own_robot_cards_have_delete() -> None:
    assert DEX.count("deleteOwnedRobot(") == 1
    card = DEX[DEX.index("export function GarageRobotCard("):DEX.index("export function MyRobotsGrid(")]
    assert "deleteOwnedRobot(robot)" in card and "Yes, delete" in card
    sightings = DEX[DEX.index("export function SightingsGroups("):DEX.index("export function catalogBadgeOverride(")]
    assert "Delete" not in sightings


def test_every_delete_goes_through_one_path() -> None:
    assert "deleteOwnedRobot(archived)" in GARAGE
    assert "deleteRobotInStore" not in GARAGE
    for cleanup in ("forgetRobotScans", "forgetRobotNotes", "workshopDraftKey", "garageKey"):
        assert cleanup in DELETE


def test_wrench_refuses_before_it_previews() -> None:
    ask = CHAT.index("parseOwnershipAsk(q)")
    assert ask < CHAT.index("parseDexMove(q)")
    assert CHAT.index("deleteRefusal(name,ownership)") < CHAT.index("setRobotDeleteProposal(ownership.robots[0])")
