#!/usr/bin/env python3
"""Build app/app-images.js: embed the AI-generated illustrations from
tools/img-src/ as base64 data URIs (the GitHub push path is text-only,
so generated images ship inside a text asset).

Size discipline: hero/pathfinder downscaled to <=900 px wide, part spot
illustrations to <=560 px, JPEG quality 70. Prints the payload budget;
drops spot illustrations first if the total would exceed ~1.5 MB.
"""
import base64, io, json, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "img-src"
OUT = ROOT / "app" / "app-images.js"
BUDGET = 1_500_000  # bytes of base64 payload, total

# key -> (source file, max width)
MAIN = {"hero": ("hero.png", 900), "pathfinder": ("pathfinder.png", 900)}
SPOTS = {
    "plate": ("part_chassis_plate.png", 560),
    "wheel": ("part_wheel.png", 560),
    "mount": ("part_motor_mount.png", 560),
    "caster": ("part_caster.png", 560),
    "lidar": ("part_lidar_mount.png", 560),
    "camera": ("part_camera_bracket.png", 560),
    "ultrasonic": ("part_ultrasonic_bracket.png", 560),
}


def encode(name: str, max_w: int) -> str | None:
    p = SRC / name
    if not p.exists():
        print(f"  missing {name} — skipped")
        return None
    im = Image.open(p).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)),
                       Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(
        buf.getvalue()).decode()


def main():
    images, total = {}, 0
    for key, (fn, w) in MAIN.items():
        uri = encode(fn, w)
        if uri:
            images[key] = uri
            total += len(uri)
            print(f"  {key}: {len(uri)} bytes")
    for key, (fn, w) in SPOTS.items():
        uri = encode(fn, w)
        if uri is None:
            continue
        if total + len(uri) > BUDGET:
            print(f"  {key}: would exceed budget — dropped")
            continue
        images[key] = uri
        total += len(uri)
        print(f"  spot {key}: {len(uri)} bytes")
    OUT.write_text(
        "/* Generated illustrations (muse-image-1.0 via the Meta Model API),\n"
        "   embedded as data URIs because the publish path is text-only.\n"
        "   Built by tools/build_app_images.py from tools/img-src/.\n"
        "   Every robot-depicting image here is an AI illustration and is\n"
        "   captioned as such wherever it appears. */\n"
        "window.RF_IMAGES = " + json.dumps(images) + ";\n")
    print(f"total payload: {total} bytes across {len(images)} images -> {OUT}")


if __name__ == "__main__":
    main()
