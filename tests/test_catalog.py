"""Catalogue, robot-class templates, and inventory assessment tests."""
import pytest

from robotforge.catalog import Catalog, CatalogError

cat = Catalog.load()


def test_catalog_loads_and_templates_reference_real_parts():
    assert len(cat.parts) >= 30
    assert set(cat.templates) == {
        "rover_skid_steer", "rover_diff_drive", "rc_car",
        "quadcopter_5inch", "humanoid_biped", "quadruped",
        "robot_arm_6dof"}


def test_gate_pack_honesty():
    assert cat.templates["rover_skid_steer"].gate_pack == "live"
    assert cat.templates["quadcopter_5inch"].gate_pack == "roadmap"


def test_every_part_class_used_is_declared():
    used = {p.part_class for p in cat.parts.values()}
    for expected in ("power", "actuators", "wheels", "cameras_sensors",
                     "custom_boards", "materials", "comms",
                     "microcontrollers", "sbc", "safety_protection"):
        assert expected in used


def test_abels_two_missing_motors_scenario():
    a = cat.assess("rover_skid_steer", {
        "gearmotor_12v": 2, "wheel_100mm": 4, "driver_tb6612fng": 2,
        "lipo_4s_5200": 1, "esp32_devkit": 1, "fuse_inline": 1})
    line = {l.part_id: l for l in a.lines}["gearmotor_12v"]
    assert (line.needed, line.on_hand, line.missing, line.virtual) == (4, 2, 2, 2)
    assert line.spares == 0
    assert not a.complete


def test_spares_and_extras():
    a = cat.assess("rover_skid_steer", {
        "gearmotor_12v": 6, "wheel_100mm": 4, "driver_tb6612fng": 2,
        "lipo_4s_5200": 1, "esp32_devkit": 1, "fuse_inline": 1,
        "pla_filament": 2})
    line = {l.part_id: l for l in a.lines}["gearmotor_12v"]
    assert line.spares == 2 and line.missing == 0
    assert a.complete
    assert a.extras == {"pla_filament": 2}


def test_complete_quad_from_template():
    bom = dict(cat.templates["quadcopter_5inch"].required)
    assert cat.assess("quadcopter_5inch", bom).complete


def test_unknown_part_and_class_rejected():
    with pytest.raises(CatalogError):
        cat.assess("rover_skid_steer", {"flux_capacitor": 1})
    with pytest.raises(CatalogError):
        cat.assess("hoverboard", {})


def test_virtual_fill_never_counts_as_on_hand():
    a = cat.assess("robot_arm_6dof", {})
    assert all(l.on_hand == 0 and l.virtual == l.needed for l in a.lines)
    text = "\n".join(a.summary_lines())
    assert "virtual" in text and "INCOMPLETE" in text
