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
IMAGES = {"hero": ("hero.png", 900), "pathfinder": ("pathfinder.png", 900),
          "parts/plate": ("part_chassis_plate.png", 560),
          "parts/wheel": ("part_wheel.png", 560),
          "parts/mount": ("part_motor_mount.png", 560),
          "parts/caster": ("part_caster.png", 560),
          "parts/lidar": ("part_lidar_mount.png", 560),
          "parts/camera": ("part_camera_bracket.png", 560),
          "parts/ultrasonic": ("part_ultrasonic_bracket.png", 560),
          "parts/lipo_4s_5200": ("part_lipo_4s_5200.png", 560),
          "parts/lipo_4s_1500": ("part_lipo_4s_1500.png", 560),
          "parts/lipo_3s_2200": ("part_lipo_3s_2200.png", 560),
          "parts/buck_converter_5v": ("part_buck_converter_5v.png", 560),
          "parts/lipo_balance_charger": ("part_lipo_balance_charger.png", 560),
          "parts/xt60_pigtail": ("part_xt60_pigtail.png", 560),
          "parts/silicone_wire_14awg": ("part_silicone_wire_14awg.png", 560),
          "parts/driver_tb6612fng": ("part_driver_tb6612fng.png", 560),
          "parts/driver_l298n": ("part_driver_l298n.png", 560),
          "parts/esc_4in1_45a": ("part_esc_4in1_45a.png", 560),
          "parts/esc_quicrun_1060": ("part_esc_quicrun_1060.png", 560),
          "parts/esp32_devkit": ("part_esp32_devkit.png", 560),
          "parts/teensy_41": ("part_teensy_41.png", 560),
          "parts/pico_rp2040": ("part_pico_rp2040.png", 560),
          "parts/raspberry_pi_5": ("part_raspberry_pi_5.png", 560),
          "parts/jetson_orin_nano": ("part_jetson_orin_nano.png", 560),
          "parts/microsd_128gb": ("part_microsd_128gb.png", 560),
          "parts/sik_telemetry_v3": ("part_sik_telemetry_v3.png", 560),
          "parts/elrs_receiver": ("part_elrs_receiver.png", 560),
          "parts/realsense_d435": ("part_realsense_d435.png", 560),
          "parts/rplidar_a1": ("part_rplidar_a1.png", 560),
          "parts/imu_bno055": ("part_imu_bno055.png", 560),
          "parts/ultrasonic_hcsr04": ("part_ultrasonic_hcsr04.png", 560),
          "parts/pla_filament": ("part_pla_filament.png", 560),
          "parts/petg_filament": ("part_petg_filament.png", 560),
          "parts/fuse_inline": ("part_fuse_inline.png", 560),
          "parts/estop_button": ("part_estop_button.png", 560),
          "parts/bms_4s": ("part_bms_4s.png", 560),
          "parts/custom_pcb_kicad": ("part_custom_pcb_kicad.png", 560),
          "parts/gearmotor_12v": ("part_gearmotor_12v.png", 560),
          "parts/brushed_motor_540": ("part_brushed_motor_540.png", 560),
          "parts/servo_mg996r": ("part_servo_mg996r.png", 560),
          "parts/servo_sts3215": ("part_servo_sts3215.png", 560),
          "parts/stepper_nema17": ("part_stepper_nema17.png", 560),
          "parts/brushless_2207_1960kv": ("part_brushless_2207_1960kv.png", 560),
          "parts/mecanum_wheel_100mm": ("part_mecanum_wheel_100mm.png", 560),
          "parts/propeller_5040": ("part_propeller_5040.png", 560),
          "parts/fc_f405_stack": ("part_fc_f405_stack.png", 560),
          "parts/gripper_2finger": ("part_gripper_2finger.png", 560),
          "parts/quad_frame_5inch": ("part_quad_frame_5inch.png", 560),
          "parts/extrusion_2020": ("part_extrusion_2020.png", 560),
          "parts/camera_rpi_v2": ("part_camera_rpi_v2.png", 560),
          "parts/liion_18650_3s": ("part_liion_18650_3s.png", 560)}


def main():
    (OUT / "parts").mkdir(parents=True, exist_ok=True)
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
