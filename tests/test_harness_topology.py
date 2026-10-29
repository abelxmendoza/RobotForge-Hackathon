"""Power topology must be unambiguous before current aggregation."""
import pytest

from robotforge.harness import HarnessError, check_spec_data


def spec(edges):
    ids = {node for edge in edges for node in edge}
    return {
        "name": "topology",
        "wiring": {
            "nodes": [{"id": node, "current_a": 1.0}
                      for node in sorted(ids)],
            "connections": [{"from": a, "to": z, "kind": "power",
                             "volts": 12.0,
                             "cable": {"gauge_awg": 18, "length_mm": 100}}
                            for a, z in edges],
        },
    }


def test_simple_tree_remains_supported():
    report = check_spec_data(spec([("battery", "hub"),
                                   ("hub", "left"),
                                   ("hub", "right")]))
    assert report.evaluations


def test_shared_downstream_node_fails_closed():
    with pytest.raises(HarnessError, match="multiply-fed"):
        check_spec_data(spec([("battery", "left"),
                              ("battery", "right"),
                              ("left", "load"),
                              ("right", "load")]))


def test_multiple_sources_to_one_load_fail_closed():
    with pytest.raises(HarnessError, match="multiply-fed"):
        check_spec_data(spec([("battery_a", "load"),
                              ("battery_b", "load")]))


def test_power_cycle_fails_closed():
    with pytest.raises(HarnessError, match="cycle|multiply-fed"):
        check_spec_data(spec([("a", "b"), ("b", "c"), ("c", "a")]))


def test_self_loop_fails_closed():
    with pytest.raises(HarnessError, match="cycle"):
        check_spec_data(spec([("a", "a")]))
