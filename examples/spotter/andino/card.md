# Spotted robot dossier — Andino

_Pipeline test data — generated 2026-10-28T15:57:25.432377+00:00 by RobotForge Spotter (robotforge-spotter/1)._

**Identity (guess):** Andino [UNKNOWN]
**Catalog match:** SAME — Robodex #001 Andino
**Draft spec validation:** PASS
**Credit:** An existing design by its original makers — the Robodex records Andino with provenance: License is per-package LICENSE files in the repo (each reads BSD 3-Clause, (c) 2023 Ekumen Inc.); the repo root carries no single LICENSE file. Spec values were read from andino_description/config/andino/*.yaml and the andino_hardware BOM. (license: BSD-3-Clause)

## Match evidence
- name is an exact match for catalog entry 'Andino'
- drivetrain agrees with the catalog spec (differential)
- length_m consistent with catalog (photo 0.24 vs catalog 0.25)
- width_m differs from catalog but within photo-estimate range (photo 0.17 vs catalog 0.1)
- mass_kg differs sharply from catalog (photo 1.1 vs catalog 3.364, 3.1x apart) — noted, but mass is the least photo-reliable field, so this alone does not veto a name match

## Sources (web)
- [github_repo] andino-systems/Andino-X1 — https://github.com/andino-systems/Andino-X1 (license: not stated; confidence high)
- [github_repo] andino-systems/Andino — https://github.com/andino-systems/Andino (license: not stated; confidence high)
- [github_repo] Ekumen-OS/andino — https://github.com/Ekumen-OS/andino (license: not stated; confidence medium)
- [github_repo] Ekumen-OS/andino_gz — https://github.com/Ekumen-OS/andino_gz (license: not stated; confidence medium)
- [github_repo] datosgobar/portal-andino — https://github.com/datosgobar/portal-andino (license: MIT; confidence medium)
- [github_repo] datosgobar/portal-andino-theme — https://github.com/datosgobar/portal-andino-theme (license: AGPL-3.0; confidence medium)
- [github_repo] Ekumen-OS/andino_rmf — https://github.com/Ekumen-OS/andino_rmf (license: BSD-3-Clause; confidence medium)
- [github_repo] Ekumen-OS/andino_o3de — https://github.com/Ekumen-OS/andino_o3de (license: BSD-3-Clause; confidence medium)
- [github_repo] Colifaa/Andino — https://github.com/Colifaa/Andino (license: not stated; confidence medium)
- [github_repo] CarlaMamaniChavez/WebSite-BancoAndino — https://github.com/CarlaMamaniChavez/WebSite-BancoAndino (license: not stated; confidence medium)
- [github_repo] yuqing21/ros2-andino-lidar-obstacle-avoidance — https://github.com/yuqing21/ros2-andino-lidar-obstacle-avoidance (license: not stated; confidence medium)
- [github_repo] ros2-gbp/andino_gz-release — https://github.com/ros2-gbp/andino_gz-release (license: not stated; confidence medium)
- [github_repo] ros2-gbp/andino-release — https://github.com/ros2-gbp/andino-release (license: not stated; confidence medium)
- [github_repo] fangfano/MyRos2Andino — https://github.com/fangfano/MyRos2Andino (license: not stated; confidence medium)
- [github_repo] Danny024/andino-robot — https://github.com/Danny024/andino-robot (license: BSD-3-Clause; confidence medium)
- [github_repo] robocre8/mobo_bot — https://github.com/robocre8/mobo_bot (license: MIT; confidence medium)
- [github_repo] kidat/ros2-astar-path-planner — https://github.com/kidat/ros2-astar-path-planner (license: not stated; confidence medium)
- [github_repo] Lu2077/ros2-autonomous-nav-constrained-hardware — https://github.com/Lu2077/ros2-autonomous-nav-constrained-hardware (license: not stated; confidence medium)
- [twin_candidate] Ekumen-OS/andino — andino_description/urdf/andino.urdf.xacro — https://github.com/Ekumen-OS/andino (license: not stated; confidence medium)

## Parts guesses
- battery (li-ion 7.4 V, 2000 mAh) → catalog `liion_18650_3s` (18650 Li-ion pack 3S (3 cells)) [CATALOG; score 5: chemistry liion; capacity 2600 mAh in range]
- motor x2 (brushed_dc_gear, 6 V) → catalog `brushed_motor_540` (Brushed motor 540 size) [CATALOG; score 4: kind tokens ['brushed'] shared by catalog dc_brushed and draft brushed_dc_gear; voltage 7.4 V near 6 V]
- wheel x2 (0.065 m diameter) → catalog `wheel_100mm` (Wheel 100 mm diameter) [CATALOG; score 4: diameter 0.1 m vs draft 0.065 m]
- sensor: lidar_2d (front top) → catalog `rplidar_a1` (RPLIDAR A1 2D lidar) [CATALOG; score 5: catalog kind lidar_2d matches]
- sensor: ultrasonic (front lower center) → catalog `ultrasonic_hcsr04` (HC-SR04 ultrasonic ranger) [CATALOG; score 5: catalog kind ultrasonic matches]
- sensor: encoder (drive wheels) → no catalog match [PHOTO-ESTIMATED] no catalog part scored above threshold (best 0); needs a human pick
- visible part: drive wheel x2 → no catalog match [PHOTO-ESTIMATED] no catalog mapping attempted for this kind in Spotter v1
- visible part: ultrasonic sensor x1 → catalog `ultrasonic_hcsr04` (HC-SR04 ultrasonic ranger) [CATALOG; score 5: catalog kind ultrasonic matches]
- visible part: chassis x1 → no catalog match [PHOTO-ESTIMATED] no catalog mapping attempted for this kind in Spotter v1
- visible part: power switch and cable x1 → no catalog match [PHOTO-ESTIMATED] no catalog mapping attempted for this kind in Spotter v1

## Validation findings
- [INFO] all: spec passed all engineering checks

## Stages
- photo: ok — vision draft produced; identity and every dimension are ESTIMATED
- lookup: ok — 18 public repos found on GitHub
- catalog_match: ok — verdict SAME
- validate: ok — draft validation: PASS

_Every value in this dossier carries its provenance. PHOTO-ESTIMATED values were read off a photograph and are not measurements; WEB-SOURCED values come from the public pages named beside them; CATALOG values are RobotForge's own recorded data, shown as a cross-check and never merged into the photo draft._
