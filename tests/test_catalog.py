"""Catalogue, robot-class templates, and inventory assessment tests.

Ported from the unmerged feature/catalogue-classes branch and extended
for the main-line catalog (data now in catalog/parts.json, parts carry
beginner fields, and part lookup is wired for the CLI).
"""
from robotforge.catalog import Catalog, CatalogError

cat = Catalog.load()


def assert_raises(exc_type, fn):
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


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
    assert_raises(CatalogError,
                  lambda: cat.assess("rover_skid_steer", {"flux_capacitor": 1}))
    assert_raises(CatalogError, lambda: cat.assess("hoverboard", {}))


def test_virtual_fill_never_counts_as_on_hand():
    a = cat.assess("robot_arm_6dof", {})
    assert all(l.on_hand == 0 and l.virtual == l.needed for l in a.lines)
    text = "\n".join(a.summary_lines())
    assert "virtual" in text and "INCOMPLETE" in text


# --- main-line extensions -------------------------------------------------

def test_every_part_has_beginner_fields_and_no_buy_links_yet():
    for p in cat.parts.values():
        assert p.blurb, f"{p.id}: missing plain-language blurb"
        assert p.used_for, f"{p.id}: missing used_for"
        assert p.license and p.source
        # v1 rule: shop links are a deliberate later step — buy stays empty.
        assert p.buy is None, f"{p.id}: buy link added ahead of the plan"


def test_typical_parts_vocabulary_is_covered():
    ids = set(cat.parts)
    expected = {
        # from the CAD kit
        "chassis_plate", "motor_mount", "lidar_mount", "camera_bracket",
        "ultrasonic_bracket", "caster_ball", "wheel_100mm",
        # core robotics parts a beginner meets
        "gearmotor_12v",        # DC gear motor
        "driver_tb6612fng",     # motor driver
        "lipo_3s_2200",         # battery pack
        "raspberry_pi_5",       # single-board computer
        "esp32_devkit",         # microcontroller
        "rplidar_a1",           # 2D lidar
        "camera_rpi_v2",        # RGB camera
        "realsense_d435",       # depth camera
        "imu_bno055",           # IMU
        "ultrasonic_hcsr04",    # ultrasonic sensor
    }
    missing = expected - ids
    assert not missing, f"vocabulary gaps: {missing}"


def test_find_part_by_id_name_and_fragment():
    assert cat.find_part("gearmotor_12v").id == "gearmotor_12v"
    assert cat.find_part("DC gearmotor 12 V (37 mm class)").id == \
        "gearmotor_12v"
    assert cat.find_part("tb6612").id == "driver_tb6612fng"
    assert_raises(CatalogError, lambda: cat.find_part("flux capacitor"))
