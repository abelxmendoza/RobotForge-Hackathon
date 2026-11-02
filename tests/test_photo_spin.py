"""Photo spin: the photorealistic 360 on the Workshop Overview.

The spin is the user's own photos (or frames from their walk-around
video), never generated, so it is labelled as their photos. The pure
helpers in lib/photoSpin.ts run here in Node; the rest is source checks.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"

RUN = r"""
import { naturalOrder, evenPick, frameAfterDrag, stepFrame, SPIN_MIN_FRAMES, SPIN_MAX_FRAMES } from "./photoSpin.ts";
const out = {};
out.order = naturalOrder([{ name: "IMG_10.jpg" }, { name: "IMG_2.jpg" }, { name: "img_1.JPG" }]).map((f) => f.name);
out.keep = evenPick([1, 2, 3], 36);
const many = Array.from({ length: 72 }, (_, i) => i);
const picked = evenPick(many, 36);
out.pickedLen = picked.length; out.pickedFirst = picked[0]; out.pickedLast = picked[35]; out.pickedStep = picked[1] - picked[0];
out.fullTurn = frameAfterDrag(5, 600, 600, 24);
out.half = frameAfterDrag(0, 300, 600, 24);
out.back = frameAfterDrag(0, -25, 600, 24);
out.empty = frameAfterDrag(3, 100, 600, 0);
out.wrapUp = stepFrame(23, 1, 24); out.wrapDown = stepFrame(0, -1, 24);
out.min = SPIN_MIN_FRAMES; out.max = SPIN_MAX_FRAMES;
process.stdout.write(JSON.stringify(out));
"""


def test_spin_helpers(tmp_path: Path) -> None:
    (tmp_path / "photoSpin.ts").write_text((WEB / "lib" / "photoSpin.ts").read_text())
    (tmp_path / "package.json").write_text('{"type": "module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"],
                          cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr[-2000:]
    out = json.loads(proc.stdout)
    # Camera numbering: 10 comes after 2, case does not matter.
    assert out["order"] == ["img_1.JPG", "IMG_2.jpg", "IMG_10.jpg"]
    assert out["keep"] == [1, 2, 3]
    # 72 photos -> every other one, still all the way round.
    assert out["pickedLen"] == 36 and out["pickedFirst"] == 0
    assert out["pickedStep"] == 2 and out["pickedLast"] == 70
    # A full-width drag is one whole turn; half is half; drags wrap.
    assert out["fullTurn"] == 5
    assert out["half"] == 12
    assert out["back"] == 1
    assert out["empty"] == 0
    assert out["wrapUp"] == 0 and out["wrapDown"] == 23
    assert out["min"] == 8 and out["max"] == 36


def test_overview_uses_photo_spin() -> None:
    garage = (WEB / "components" / "garage" / "Garage.tsx").read_text()
    assert "<OverviewMedia" in garage and "spin={robot.spin}" in garage
    # The 3D turntable is still there as the other view.
    assert "<OverviewTurntable" in garage
    assert "spin?: import('./photoSpin').PhotoSpin" in (WEB / "lib" / "garage.ts").read_text()


def test_spin_ui_is_honest_and_accessible() -> None:
    ui = (WEB / "components" / "garage" / "PhotoSpin.tsx").read_text()
    # Labelled as the user's own photos, not a render.
    assert "Your own photos of" in ui
    # Drag, keyboard and a slider all turn it; motion can be paused.
    for needle in ("setPointerCapture", "ArrowLeft", 'type="range"', "aria-pressed", "prefers-reduced-motion"):
        assert needle in ui, needle
    # Too few photos is refused with a reason; remove asks first.
    assert "SPIN_MIN_FRAMES" in ui and "Yes, remove" in ui
    # A storage failure is shown, not swallowed.
    assert "onSave(" in ui and "KB" in ui
    css = (ROOT / "assets" / "css" / "app.css").read_text()
    assert ".ps-stage{" in css and "touch-action:pan-y" in css


def test_frames_are_shrunk_before_storage() -> None:
    img = (WEB / "lib" / "image.ts").read_text()
    assert "export async function spinFrame" in img
    assert "export async function videoFrames" in img
