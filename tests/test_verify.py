import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.listimport import identify, import_list
from robotforge.verify import field_tier, load_dossiers, verify_items

PASTE = Path(__file__).parent / "test_listimport.py"


def _items():
    from robotforge.listimport import parse_paste
    text = PASTE.read_text()
    start = text.index('PASTE = """') + len('PASTE = """')
    end = text.index('"""', start)
    return [identify(i) for i in parse_paste(text[start:end])]


def test_field_tiers_agree_and_conflict():
    agree = [{"value": 450, "source": "a"}, {"value": 450, "source": "b"}]
    assert field_tier(agree) == "VERIFIED"
    spread = [{"value": 434, "source": "a"}, {"value": 980, "source": "b"}]
    assert field_tier(spread) == "CONFLICT"
    single = [{"value": 30, "source": "a"}]
    assert field_tier(single) == "SOURCED"


def test_dossiers_match_and_conflicts_stay_visible():
    verified = verify_items(_items(), load_dossiers())
    motor = next(v for v in verified if v["slot"] == "motor")
    assert motor["dossier"] and "2212" in motor["dossier"]
    assert motor["fields"]["max_thrust_g"]["tier"] == "CONFLICT"
    assert motor["fields"]["kv"]["tier"] in ("VERIFIED", "SOURCED")
    frame = next(v for v in verified if v["slot"] == "frame")
    assert frame["fields"]["wheelbase_mm"]["tier"] == "VERIFIED"


def test_abel_list_compatibility_mostly_passes():
    from robotforge.listimport import parse_paste
    text = PASTE.read_text()
    start = text.index('PASTE = """') + len('PASTE = """')
    end = text.index('"""', start)
    report = import_list(text[start:end])
    checks = {c["name"]: c for c in report["verification"]["checks"]}
    assert checks["voltage_chain"]["verdict"] == "PASS"
    assert checks["esc_current"]["verdict"] == "PASS"
    assert checks["battery_discharge"]["verdict"] == "PASS"
    assert checks["prop_clearance"]["verdict"] == "PASS"
    assert checks["mounting"]["verdict"] == "PASS"
    assert checks["power_rails"]["verdict"] == "PASS"
    assert checks["all_up_weight"]["verdict"] in ("PASS", "MARGINAL")


def test_overvolted_battery_fails_voltage_chain():
    items = _items()
    for it in items:
        if it.slot == "battery":
            it.specs["cells"] = 6  # 6S pack on a 3-4S motor class
            it.title = it.title.replace("4S", "6S")
    from robotforge.verify import build_verification
    checks = {c["name"]: c for c in build_verification(items)["checks"]}
    assert checks["voltage_chain"]["verdict"] == "FAIL"


def test_undersized_esc_fails_current_check():
    items = _items()
    for it in items:
        if it.slot == "esc":
            it.specs["amps"] = 12
    from robotforge.verify import build_verification
    checks = {c["name"]: c for c in build_verification(items)["checks"]}
    assert checks["esc_current"]["verdict"] == "FAIL"


def test_conflicted_thrust_caps_at_marginal_not_fail():
    from robotforge.listimport import parse_paste
    text = PASTE.read_text()
    start = text.index('PASTE = """') + len('PASTE = """')
    end = text.index('"""', start)
    report = import_list(text[start:end])
    checks = {c["name"]: c for c in report["verification"]["checks"]}
    # Abel's set includes the gimbal: AUW is high and thrust sources
    # conflict, so the honest verdict is MARGINAL, never a clean PASS
    # and not a FAIL while the floor figure still exceeds AUW.
    assert checks["thrust_margin"]["verdict"] == "MARGINAL"
    motor = next(v for v in report["verification"]["parts"]
                 if v["slot"] == "motor")
    assert motor["fields"]["max_current_test_a"]["tier"] == "VERIFIED"
    assert motor["fields"]["max_thrust_g"]["tier"] == "CONFLICT"
