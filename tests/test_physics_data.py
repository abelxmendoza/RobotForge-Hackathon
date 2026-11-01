"""Physics-check data integrity (catalog/physics.json).

The in-browser physics checks are only as honest as their data
file, so this test pins the file's contract:

- every Robodex robot has an entry, keyed by the slug the site
  derives from its name;
- a "urdf" entry names the model file, its source and its licence,
  and — for the specimen-imported robots — the URL carries the SAME
  pinned commit the specimen import recorded (the physics checks
  must run on the model the catalogue describes, not a drifting
  upstream branch);
- a "none" entry carries the reason and no URL — the page shows
  the reason instead of results;
- the one generated model (Pathfinder) is byte-identical to what
  the repo's own URDF generator produces from the spec today.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.schema import RobotSpec
from robotforge.urdf import generate_urdf

REPO = Path(__file__).resolve().parent.parent
PHYS = json.loads((REPO / "catalog/physics.json").read_text())
ROBOTS = json.loads((REPO / "catalog/robots.json").read_text())["robots"]


def _slug(robot) -> str:
    # web-next robotSlug(): the recorded slug wins, else slugify.
    if robot.get("slug"):
        return robot["slug"]
    import re
    return re.sub(r"[^a-z0-9]+", "-", robot["name"].lower()).strip("-")


def test_every_robot_has_a_physics_entry():
    slugs = {_slug(r) for r in ROBOTS}
    assert set(PHYS["robots"].keys()) == slugs


def test_urdf_entries_are_complete():
    for slug, e in PHYS["robots"].items():
        if e["status"] != "urdf":
            continue
        assert e["urdf_url"], slug
        assert e["source_label"], slug
        assert e["license"], slug
        # catalog mass: a number with a label, or explicitly null
        # with the label explaining why there is nothing to audit.
        assert "catalog_mass_kg" in e and "catalog_mass_label" in e, slug
        if e["catalog_mass_kg"] is not None:
            assert isinstance(e["catalog_mass_kg"], (int, float)), slug
            assert e["catalog_mass_kg"] > 0, slug


def test_none_entries_carry_a_reason_and_no_url():
    for slug, e in PHYS["robots"].items():
        if e["status"] != "none":
            continue
        assert e["reason"].strip(), slug
        assert "urdf_url" not in e, slug


def test_urdf_urls_use_the_specimens_pinned_commits():
    # slug -> specimen file, for the robots whose specimen import
    # recorded a URDF source. G1 is the one exception by design: its
    # catalogue provenance parsed the file in the same repo the Go2
    # specimen pinned, so it must carry the Go2 specimen's commit.
    specimen_slugs = [
        "turtlebot3-burger", "unitree-go2", "crazyflie-2-1", "openmanipulator-x",
    ]
    commits = {}
    for slug in specimen_slugs:
        spec = json.loads(
            (REPO / f"catalog/specimens/{slug}.json").read_text())
        commits[slug] = spec["specimen"]["source"]["commit"]
        assert commits[slug] in PHYS["robots"][slug]["urdf_url"], slug
    assert commits["unitree-go2"] in PHYS["robots"]["unitree-g1"]["urdf_url"]


def test_pathfinder_urdf_matches_the_generator():
    spec = RobotSpec.from_dict(
        json.loads((REPO / "examples/pathfinder.json").read_text()))
    served = (REPO / "web-next/public/urdf/pathfinder.urdf").read_text()
    assert served == generate_urdf(spec)
    assert PHYS["robots"]["pathfinder"].get("generated") is True


def test_physics_data_is_synced_into_web_next():
    sync = (REPO / "web-next/scripts/sync-data.mjs").read_text()
    assert '"physics.json"' in sync
    data_ts = (REPO / "web-next/src/lib/data.ts").read_text()
    assert "physicsOf" in data_ts
