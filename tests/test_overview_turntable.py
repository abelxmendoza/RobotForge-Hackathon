"""Workshop Overview shows the robot turning on a 3D stage, for every robot.

It is a model built from the robot's spec, labelled as not a photo, and
parts only move when recorded stage data licenses it.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GARAGE = ROOT / "web-next/src/components/garage"


def test_overview_uses_the_turntable_for_every_robot() -> None:
    src = (GARAGE / "Garage.tsx").read_text()
    assert "import OverviewTurntable from './OverviewTurntable';" in src
    assert "<OverviewTurntable key={robot.id}" in src
    assert "fallback={drawing}" in src


def test_turntable_is_honest_and_falls_back() -> None:
    src = (GARAGE / "OverviewTurntable.tsx").read_text()
    assert "not a photo" in src
    assert 'quality="high"' in src and "autoRotate={spin}" in src
    assert "robotCapability(rec)" in src  # motion only from recorded data
    assert "if (!body || failed)" in src   # no dimensions or no WebGL -> drawing
    assert "Open Specs" in src
    assert "aria-pressed={!spin}" in src   # a visible way to stop the motion
