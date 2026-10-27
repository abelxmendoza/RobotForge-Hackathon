"""Render the TurtleBot3 Burger's published specs as a spec-sheet image.

This builds the INPUT for the recorded document-mode run
(examples/document-turtlebot3-burger.json): the values are the ones
already recorded in this repo (examples/turtlebot3-burger.json, sourced
from ROBOTIS's published TurtleBot3 dimensions), laid out as a clean
datasheet-style table and rendered to a PNG — an IMAGE of printed
values, which is what the vision model reads. An SVG twin with the
same layout and text is written alongside it: the site displays the
SVG (text, committable), while the recorded run itself ran on the PNG
(its sha256 is recorded in the run file, and this tool regenerates it
deterministically with the same Pillow + font).

The sheet says what it is: a RobotForge fixture rendering published
values, NOT a ROBOTIS document.

Usage:
    python3 tools/make_spec_sheet.py [--out-dir DIR]
Writes <DIR>/document-turtlebot3-burger-spec-sheet.png and .svg and
prints the PNG's sha256 and byte size.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BURGER = REPO / "examples" / "turtlebot3-burger.json"

TITLE = "TURTLEBOT3 BURGER"
SUBTITLE = "Specification sheet — reference values as published for the " \
           "ROBOTIS TurtleBot3 Burger"
FOOTER_LINES = [
    "RobotForge fixture: values as recorded in "
    "examples/turtlebot3-burger.json.",
    "This sheet is a rendering made for document-mode testing, "
    "not a ROBOTIS document.",
]


def sheet_rows(spec: dict) -> list[tuple[str, str]]:
    """(label, printed value) rows. Lengths print in mm, as a real
    datasheet prints them; the transcription must convert."""
    mm = lambda m: f"{round(m * 1000):g} mm"
    return [
        ("Overall length", mm(spec["length_m"])),
        ("Overall width", mm(spec["width_m"])),
        ("Overall height", mm(spec["height_m"])),
        ("Weight", f"{spec['mass_kg']:g} kg"),
        ("Ground clearance", mm(spec["ground_clearance_m"])),
        ("Wheel diameter", mm(spec["wheel"]["diameter_m"])),
        ("Wheel width", mm(spec["wheel"]["width_m"])),
        ("Drivetrain", "Differential drive, 2 driven wheels"),
        ("Motors", f"{spec['motor']['count']} × DC geared motors"),
        ("Motor voltage", f"{spec['motor']['voltage_v']:g} V"),
        ("Motor stall torque", f"{spec['motor']['stall_torque_nm']:g} N·m"),
        ("Battery chemistry", "LiPo"),
        ("Battery voltage", f"{spec['battery']['voltage_v']:g} V"),
        ("Battery capacity", f"{spec['battery']['capacity_mah']} mAh"),
        ("Top sensor", "360° 2D lidar, range 3.5 m"),
    ]


W, H = 1120, 920
MARGIN = 56
ROW_H = 40
TABLE_TOP = 208


def render_png(rows, out: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    font_dir = Path("/usr/share/fonts/truetype/liberation")
    bold = lambda s: ImageFont.truetype(str(font_dir / "LiberationSans-Bold.ttf"), s)
    reg = lambda s: ImageFont.truetype(str(font_dir / "LiberationSans-Regular.ttf"), s)

    img = Image.new("RGB", (W, H), (252, 252, 250))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 118], fill=(27, 30, 36))
    d.text((MARGIN, 30), TITLE, font=bold(40), fill=(245, 158, 11))
    d.text((MARGIN, 82), SUBTITLE, font=reg(19), fill=(232, 234, 238))
    y = TABLE_TOP
    for i, (label, value) in enumerate(rows):
        if i % 2 == 0:
            d.rectangle([MARGIN, y - 7, W - MARGIN, y + ROW_H - 7],
                        fill=(238, 240, 243))
        d.text((MARGIN + 14, y), label, font=reg(22), fill=(27, 30, 36))
        d.text((620, y), value, font=bold(22), fill=(27, 30, 36))
        y += ROW_H
    d.line([MARGIN, y + 6, W - MARGIN, y + 6], fill=(120, 126, 138), width=2)
    for i, line in enumerate(FOOTER_LINES):
        d.text((MARGIN, y + 24 + i * 24), line, font=reg(16),
               fill=(90, 96, 108))
    img.save(out, format="PNG")


def _esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;"))


def render_svg(rows, out: Path) -> None:
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" font-family="Liberation Sans, Arial, sans-serif">',
        f'<rect width="{W}" height="{H}" fill="#fcfcfa"/>',
        '<rect width="1120" height="118" fill="#1b1e24"/>',
        f'<text x="{MARGIN}" y="70" font-size="40" font-weight="bold" '
        f'fill="#f59e0b">{_esc(TITLE)}</text>',
        f'<text x="{MARGIN}" y="102" font-size="19" '
        f'fill="#e8eaee">{_esc(SUBTITLE)}</text>',
    ]
    y = TABLE_TOP
    for i, (label, value) in enumerate(rows):
        if i % 2 == 0:
            parts.append(f'<rect x="{MARGIN}" y="{y - 7}" '
                         f'width="{W - 2 * MARGIN}" height="{ROW_H}" '
                         f'fill="#eef0f3"/>')
        parts.append(f'<text x="{MARGIN + 14}" y="{y + 24}" font-size="22" '
                     f'fill="#1b1e24">{_esc(label)}</text>')
        parts.append(f'<text x="620" y="{y + 24}" font-size="22" '
                     f'font-weight="bold" fill="#1b1e24">{_esc(value)}</text>')
        y += ROW_H
    parts.append(f'<line x1="{MARGIN}" y1="{y + 6}" x2="{W - MARGIN}" '
                 f'y2="{y + 6}" stroke="#787e8a" stroke-width="2"/>')
    for i, line in enumerate(FOOTER_LINES):
        parts.append(f'<text x="{MARGIN}" y="{y + 46 + i * 24}" '
                     f'font-size="16" fill="#5a606c">{_esc(line)}</text>')
    parts.append("</svg>")
    out.write_text("\n".join(parts) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="build/spec-sheet")
    args = ap.parse_args()
    spec = json.loads(BURGER.read_text())
    rows = sheet_rows(spec)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    png = out_dir / "document-turtlebot3-burger-spec-sheet.png"
    svg = out_dir / "document-turtlebot3-burger-spec-sheet.svg"
    render_png(rows, png)
    render_svg(rows, svg)
    data = png.read_bytes()
    print(f"png: {png} ({len(data)} bytes)")
    print(f"png sha256: {hashlib.sha256(data).hexdigest()}")
    print(f"svg: {svg}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
