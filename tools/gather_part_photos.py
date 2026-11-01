#!/usr/bin/env python3
"""Gather (verify) the catalogue's part photos — web-gathered, hot-linked.

The records in catalog/parts.json under each part's `photo` key were
gathered by hand-verification on 2026-11-01: for each part, the
manufacturer's or an official supplier's product page was opened, the
image was confirmed to depict the EXACT catalogue part (page name /
MPN match), and the record stores the receipt — image URL, source
page, credit, fetched-at, trust state `web_gathered`, and kind
(`photo`, or `render` where the manufacturer publishes renders only).

This script keeps that repeatable in the small:

  python3 tools/gather_part_photos.py --check   # HEAD/GET every recorded
                                                # image URL; report status
  python3 tools/gather_part_photos.py --emit    # print the records as JSON

Adding a photo for a new part is a verification task, not a scrape:
open the source page, confirm the image depicts the exact part, then
add one SOURCES entry here and the matching record in
catalog/parts.json. Parts whose design varies by maker (generic LiPo
packs, MG996R clones, NEMA 17 steppers, L298N modules…), RobotForge's
own printed parts, and parts whose official pages could not be
reached or verified get NO record — the UI placeholder says so.

When the general gather pipeline (tools/gather) is on main, these
SOURCES belong in its registry; until then this script is the
registry. Standard library only.
"""
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# part id -> (source page, image url, credit, kind, note or None)
SOURCES = {
    "driver_tb6612fng": (
        "https://www.pololu.com/product/713",
        "https://a.pololu-files.com/picture/0J4617.1200x627.jpg?c004ffc809543b19fa467449bcefa2ed",
        "Photo: Pololu", "photo", None),
    "gearmotor_12v": (
        "https://www.pololu.com/product/4743",
        "https://a.pololu-files.com/picture/0J10485.1200x627.jpg?a6a1ee9fcf634b7cb8d8736fea7bb4ab",
        "Photo: Pololu", "photo",
        "Class exemplar: a Pololu 37D x54L mm 12 V gearmotor — the catalogue records the generic 37 mm class."),
    "teensy_41": (
        "https://www.pjrc.com/store/teensy41.html",
        "https://www.pjrc.com/store/teensy41_1.jpg",
        "Photo: PJRC", "photo", None),
    "pico_rp2040": (
        "https://www.raspberrypi.com/products/raspberry-pi-pico/",
        "https://assets.raspberrypi.com/static/74679d6c81ffc5503a20b64feae2ed4f/3564b/pico-rp2040.jpg",
        "Photo: Raspberry Pi", "photo", None),
    "raspberry_pi_5": (
        "https://www.raspberrypi.com/products/raspberry-pi-5/",
        "https://assets.raspberrypi.com/static/c671804c05a51efc4e3c2a1bdcbafbcf/e58b5/raspberry-pi-5.png",
        "Photo: Raspberry Pi", "photo", None),
    "sik_telemetry_v3": (
        "https://holybro.com/products/sik-telemetry-radio-v3",
        "https://holybro.com/cdn/shop/files/17013-1.jpg?v=1770011674",
        "Photo: Holybro", "photo", None),
    "ultrasonic_hcsr04": (
        "https://www.sparkfun.com/products/15569",
        "https://www.sparkfun.com/media/catalog/product/cache/6b78ac9ed927a3c2db42a3c84dab4ce5/1/5/15569-Ultrasonic_Distance_Sensor_-_HC-SR04-01a.jpg",
        "Photo: SparkFun", "photo", None),
    "servo_sts3215": (
        "https://www.waveshare.com/st3215-servo.htm",
        "https://www.waveshare.com/img/devkit/accessories/ST3215-Servo/ST3215-Servo-details-1.jpg",
        "Photo: Waveshare", "photo",
        "Waveshare's ST3215 listing — the Feetech STS3215 serial bus servo."),
    "rplidar_a1": (
        "https://www.slamtec.com/en/Lidar/A1",
        "https://image.slamtec.com/images/a1/a1-overview/summary-section3.webp",
        "Render: SLAMTEC", "render",
        "SLAMTEC publishes renders, not photographs, of the A1 — labelled a render wherever it appears."),
}

# Parts deliberately left without a photo, and why (2026-11-01 pass).
NO_PHOTO = {
    "camera_rpi_v2": "Raspberry Pi's docs image for the camera boards is the HQ Camera (IMX477), not Module V2; the V2 product page is gone and the store was unreachable. No verified image.",
    "imu_bno055": "Adafruit product 2472 verified, but its image CDN paths return 404 from this network — nothing verifiable to link.",
    "realsense_d435": "intelrealsense.com unreachable from this network.",
    "jetson_orin_nano": "NVIDIA's product page moved/404s; only family renders found, not the exact dev kit.",
    "esc_quicrun_1060": "Hobbywing serves no readable product page; no verifiable official image found.",
    "esp32_devkit": "Espressif's official material is annotated diagrams, not a product photo.",
}


def records():
    out = {}
    for pid, (src, url, credit, kind, note) in SOURCES.items():
        rec = {"url": url, "source_page": src, "credit": credit,
               "fetched_at": "2026-11-01", "state": "web_gathered",
               "kind": kind}
        if note:
            rec["note"] = note
        out[pid] = rec
    return out


def check():
    parts = {p["id"]: p for p in json.loads(
        (REPO / "catalog" / "parts.json").read_text())["parts"]}
    bad = 0
    for pid, rec in records().items():
        have = parts.get(pid, {}).get("photo")
        if have != rec:
            print(f"MISMATCH {pid}: catalog record differs from SOURCES")
            bad += 1
            continue
        req = urllib.request.Request(rec["url"], method="GET",
                                     headers={"User-Agent": "RobotForge-photo-check/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                ctype = r.headers.get_content_type()
                ok = r.status == 200 and ctype.startswith("image/")
                print(f"{'OK ' if ok else 'BAD'} {pid}: {r.status} {ctype}")
                bad += 0 if ok else 1
        except Exception as e:  # noqa: BLE001 — report, don't crash the audit
            print(f"ERR {pid}: {e}")
            bad += 1
    print(f"\n{len(records())} records; {bad} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--emit" in sys.argv:
        print(json.dumps(records(), indent=2))
    elif "--check" in sys.argv:
        sys.exit(check())
    else:
        print(__doc__)
