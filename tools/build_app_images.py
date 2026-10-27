#!/usr/bin/env python3
"""Build assets/img/: downscale the AI-generated illustrations from
tools/img-src/ into web-sized JPEGs the site loads as ordinary,
cacheable, lazy-loadable files.

Size discipline: hero/pathfinder downscaled to <=900 px wide, JPEG
quality 70. Every robot-depicting image is an AI illustration and is
captioned as such wherever it appears.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "img-src"
OUT = ROOT / "assets" / "img"

# output name -> (source file, max width)
IMAGES = {"hero": ("hero.png", 900), "pathfinder": ("pathfinder.png", 900)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for key, (name, max_w) in IMAGES.items():
        p = SRC / name
        if not p.exists():
            print(f"  missing {name} — skipped")
            continue
        im = Image.open(p).convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)),
                           Image.LANCZOS)
        dest = OUT / f"{key}.jpg"
        im.save(dest, "JPEG", quality=70)
        print(f"  {key}: {dest.stat().st_size} bytes -> {dest}")


if __name__ == "__main__":
    main()
