"""Workshop Remove asks before deleting a robot (user ask, 2026-11-01):
the first click arms a confirm with Yes/Cancel, only the second deletes."""
from pathlib import Path

SRC = (Path(__file__).resolve().parent.parent / "web-next/src/components/garage/Garage.tsx").read_text()


def test_remove_needs_a_second_click():
    body = SRC.split("const removeRobot = () => {", 1)[1].split("};", 1)[0]
    arm = body.index("setConfirmRemove(robot.id); return;")
    delete = body.index("persist(robots.filter")
    assert arm < delete
    assert "Yes, remove" in SRC and "Cancel" in SRC
    assert "can&apos;t be undone" in SRC
