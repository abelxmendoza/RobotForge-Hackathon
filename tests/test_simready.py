import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.schema import RobotSpec
from robotforge.simready import (SimReadyError, get_prop, load_props,
                                 parse_scene, placement_sdf, scene_sdf)
from robotforge.twin import generate_world

EXAMPLE = Path(__file__).parent.parent / "examples" / "pathfinder.json"


def _spec():
    return RobotSpec.from_dict(
        __import__("json").loads(EXAMPLE.read_text()))


def test_manifest_loads_the_recorded_props():
    props = load_props()
    assert [p.id for p in props] == ["crate", "drill", "scope"]
    for p in props:
        assert p.source_url.startswith(
            "https://huggingface.co/datasets/nvidia/simready-assets")
        assert "CC BY" in p.attribution


def test_sdf_size_maps_gltf_up_axis_to_sdf_z():
    crate = get_prop("crate")
    # recorded glTF order [x, y-up, z] = [0.601, 0.171, 0.402]
    assert crate.size_m == (0.601, 0.171, 0.402)
    # SDF order [x, y, z-up]: footprint 0.601 x 0.402, height 0.171
    assert crate.sdf_size == (0.601, 0.402, 0.171)
    assert crate.height_m == 0.171


def test_unknown_prop_raises():
    with pytest.raises(SimReadyError):
        get_prop("forklift")


def test_parse_scene_full_and_minimal():
    placements = parse_scene("crate@1.5,0.5; scope@-1,2,90")
    assert [(p.prop_id, p.x, p.y, p.yaw_deg) for p in placements] == [
        ("crate", 1.5, 0.5, 0.0), ("scope", -1.0, 2.0, 90.0)]


def test_parse_scene_rejects_bad_input():
    for bad in ("crate", "crate@1", "crate@a,b", "nope@1,2", ""):
        with pytest.raises(SimReadyError):
            parse_scene(bad)


def test_placement_sdf_is_a_static_box_on_the_floor():
    block = placement_sdf(parse_scene("crate@1.5,0.5")[0], 0)
    model = ET.fromstring(block)
    assert model.get("name") == "simready_crate_0"
    assert model.findtext("static") == "true"
    # pose z is half the height: the box stands on z=0
    pose = model.findtext("pose").split()
    assert [float(v) for v in pose[:3]] == [1.5, 0.5, 0.171 / 2]
    size = model.find("link/collision/geometry/box/size").text.split()
    assert [float(v) for v in size] == [0.601, 0.402, 0.171]


def test_scene_sdf_empty_for_no_placements():
    assert scene_sdf([]) == ""


def test_world_without_scene_has_no_props():
    world = generate_world(_spec(), "/tmp/model.sdf")
    assert "simready_" not in world


def test_world_with_scene_places_props_and_keeps_robot():
    scene = parse_scene("crate@1.5,0.5; drill@-0.4,0.3,45")
    world = generate_world(_spec(), "/tmp/model.sdf", scene=scene)
    root = ET.fromstring(world)
    names = [m.get("name") for m in root.iter("model")]
    assert "simready_crate_0" in names
    assert "simready_drill_1" in names
    assert "ground_plane" in names
    # the robot include survives alongside the props
    assert "/tmp/model.sdf" in world
