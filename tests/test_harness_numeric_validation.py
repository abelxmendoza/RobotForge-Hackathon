"""Regression tests: invalid harness quantities must fail closed."""
import copy
import pytest

from robotforge.harness import HarnessError, check_spec_data


def fixture():
    return {
        "name": "numeric-validation",
        "wiring": {
            "nodes": [
                {"id": "battery", "output_current_a": 10},
                {"id": "load", "current_a": 2},
            ],
            "connections": [{
                "from": "battery", "to": "load", "kind": "power",
                "volts": 12,
                "cable": {"gauge_awg": 18, "length_mm": 100},
            }],
        },
    }


@pytest.mark.parametrize("field,value", [
    ("volts", 0), ("volts", -12), ("volts", float("nan")),
    ("current_a", -1), ("current_a", float("inf")),
])
def test_invalid_power_connection_quantities(field, value):
    spec = fixture()
    spec["wiring"]["connections"][0][field] = value
    with pytest.raises(HarnessError):
        check_spec_data(spec)


@pytest.mark.parametrize("field,value", [
    ("length_mm", 0), ("length_mm", -10),
    ("gauge_awg", -1), ("gauge_awg", 41),
    ("gauge_awg", float("nan")),
])
def test_invalid_cable_quantities(field, value):
    spec = fixture()
    spec["wiring"]["connections"][0]["cable"][field] = value
    with pytest.raises(HarnessError):
        check_spec_data(spec)


@pytest.mark.parametrize("field,value", [
    ("current_a", -0.1), ("output_current_a", float("inf")),
])
def test_invalid_node_quantities(field, value):
    spec = fixture()
    spec["wiring"]["nodes"][1][field] = value
    with pytest.raises(HarnessError):
        check_spec_data(spec)


def test_valid_quantities_are_accepted():
    spec = fixture()
    report = check_spec_data(spec)
    assert report.evaluations
