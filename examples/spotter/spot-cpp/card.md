# Spotted robot dossier — Boston Dynamics Spot

_Pipeline test data — generated 2026-10-29T01:44:37.347526+00:00 by RobotForge Spotter (robotforge-spotter/1)._

**Identity (guess):** Boston Dynamics Spot [UNKNOWN]
**Catalog match:** NEW
**Draft spec validation:** PASS
**Credit:** Not identified against the Robodex. Its public footprint starts at bostonrb/bostonrb (owner bostonrb); credit belongs to that project's authors, whoever they are.

## Match evidence
- no Robodex entry name-matches 'Boston Dynamics Spot' (11 entries checked)

## Sources (web)
- [github_repo] bostonrb/bostonrb — https://github.com/bostonrb/bostonrb (license: not stated; confidence high)
- [github_repo] boston-dynamics/spot-sdk — https://github.com/boston-dynamics/spot-sdk (license: NOASSERTION; confidence high)
- [github_repo] Boston-Robot-Hackers/ros2diag — https://github.com/Boston-Robot-Hackers/ros2diag (license: not stated; confidence high)
- [github_repo] Boston-Robot-Hackers/dome — https://github.com/Boston-Robot-Hackers/dome (license: not stated; confidence high)
- [github_repo] CityOfBoston/boston.gov-d7 — https://github.com/CityOfBoston/boston.gov-d7 (license: NOASSERTION; confidence medium)
- [github_repo] bluepylons/Boston — https://github.com/bluepylons/Boston (license: not stated; confidence medium)
- [github_repo] WebOfTrustInfo/rwot5-boston — https://github.com/WebOfTrustInfo/rwot5-boston (license: not stated; confidence medium)
- [github_repo] krishnaik06/bostonhousepricing — https://github.com/krishnaik06/bostonhousepricing (license: Apache-2.0; confidence medium)
- [github_repo] nd009/boston_housing — https://github.com/nd009/boston_housing (license: not stated; confidence medium)
- [github_repo] rogerSuperBuilderAlpha/cursor-boston — https://github.com/rogerSuperBuilderAlpha/cursor-boston (license: GPL-3.0; confidence medium)
- [github_repo] TheoTime01/Spok--Boston-Dynamics-Spot-inspired-robot — https://github.com/TheoTime01/Spok--Boston-Dynamics-Spot-inspired-robot (license: MIT; confidence medium)
- [github_repo] MaxMarques/BostonDynamicsSpotDetection — https://github.com/MaxMarques/BostonDynamicsSpotDetection (license: not stated; confidence medium)
- [github_repo] Hotchnerz/BostonDynamicsSpot_ws — https://github.com/Hotchnerz/BostonDynamicsSpot_ws (license: not stated; confidence medium)
- [github_repo] heuristicus/spot_ros — https://github.com/heuristicus/spot_ros (license: NOASSERTION; confidence medium)
- [github_repo] rai-opensource/spot_ros2 — https://github.com/rai-opensource/spot_ros2 (license: NOASSERTION; confidence medium)
- [github_repo] justyx404/spot_gazebo_ros2 — https://github.com/justyx404/spot_gazebo_ros2 (license: Apache-2.0; confidence medium)
- [github_repo] UTNuclearRoboticsPublic/spot_manipulation — https://github.com/UTNuclearRoboticsPublic/spot_manipulation (license: BSD-3-Clause; confidence medium)
- [github_repo] LCAS/spot_platform — https://github.com/LCAS/spot_platform (license: Apache-2.0; confidence medium)
- [github_repo] janoleksiuk/Spot-Simulator — https://github.com/janoleksiuk/Spot-Simulator (license: not stated; confidence medium)
- [github_repo] UTNuclearRoboticsPublic/spot_ros — https://github.com/UTNuclearRoboticsPublic/spot_ros (license: NOASSERTION; confidence medium)
- [github_repo] UM-ARM-Lab/conq_ros — https://github.com/UM-ARM-Lab/conq_ros (license: NOASSERTION; confidence medium)
- [twin_candidate] Boston-Robot-Hackers/dome — config/dome2.urdf — https://github.com/Boston-Robot-Hackers/dome (license: not stated; confidence medium)

## Parts guesses
- battery (li-ion 50.4 V, 12000 mAh) → no catalog match [PHOTO-ESTIMATED] no catalog part scored above threshold (best 3); needs a human pick
- motor x18 (brushless_electric, 48 V) → catalog `brushless_2207_1960kv` (Brushless motor 2207 1960 KV) [CATALOG; score 3: kind tokens ['brushless'] shared by catalog brushless_outrunner and draft brushless_electric]
- wheel x0 (0.12 m diameter) → catalog `wheel_100mm` (Wheel 100 mm diameter) [CATALOG; score 4: diameter 0.1 m vs draft 0.12 m]
- sensor: depth_camera (front) → catalog `realsense_d435` (Intel RealSense D435 depth camera) [CATALOG; score 4: catalog kind rgbd_camera is a camera]
- sensor: depth_camera (rear) → catalog `realsense_d435` (Intel RealSense D435 depth camera) [CATALOG; score 4: catalog kind rgbd_camera is a camera]
- sensor: depth_camera (left) → catalog `realsense_d435` (Intel RealSense D435 depth camera) [CATALOG; score 4: catalog kind rgbd_camera is a camera]
- sensor: depth_camera (right) → catalog `realsense_d435` (Intel RealSense D435 depth camera) [CATALOG; score 4: catalog kind rgbd_camera is a camera]
- sensor: rgb_camera (arm gripper) → catalog `camera_rpi_v2` (Raspberry Pi Camera Module V2 (8 MP)) [CATALOG; score 5: catalog kind rgb_camera matches]
- sensor: imu (body center) → catalog `imu_bno055` (BNO055 9-DOF IMU breakout) [CATALOG; score 5: catalog kind imu matches]
- sensor: encoder (leg joints) → no catalog match [PHOTO-ESTIMATED] no catalog part scored above threshold (best 0); needs a human pick
- visible part: quadruped leg x4 → no catalog match [PHOTO-ESTIMATED] no catalog mapping attempted for this kind in Spotter v1
- visible part: robot arm x1 → no catalog match [PHOTO-ESTIMATED] no catalog mapping attempted for this kind in Spotter v1
- visible part: robot body x1 → no catalog match [PHOTO-ESTIMATED] no catalog mapping attempted for this kind in Spotter v1

## Validation findings
- [WARN] provenance.estimated_dimensions: every dimension in this spec is ESTIMATED from a photo, not measured — the checks ran against estimates, so this is not a verdict on the real robot; confirm the dimensions before trusting the spec

## Stages
- photo: ok — vision draft produced; identity and every dimension are ESTIMATED
- lookup: ok — 21 public repos found on GitHub
- catalog_match: ok — verdict NEW
- validate: ok — draft validation: PASS

_Every value in this dossier carries its provenance. PHOTO-ESTIMATED values were read off a photograph and are not measurements; WEB-SOURCED values come from the public pages named beside them; CATALOG values are RobotForge's own recorded data, shown as a cross-check and never merged into the photo draft._

---

## Field evidence (operator addendum — not pipeline output)

- `spotted-photo.jpg` — the spotting photo: the wide lab shot named in
  this dossier's photo block (sha256
  07c80a3780cb61989d94650f0315569759345fd5e9ae2a8c3f294b396de2d960).
  **Photographed by Abel Mendoza, 2026-10-28, Cal Poly Pomona IRLab.**
- `spotted-photo-2.jpg` — supporting closer shot of the same unit,
  same visit, same credit (sha256
  cc0a05cce7cf432d51f791dfaebffb5b7abbee116f7aae3b22b9d6dc8b9e54c2).
- Operator context, the team's reported status for the unit
  (SELF-REPORTED-HEARSAY), and why no sim verdict is claimed for a
  quadruped: see `field-notes.md` in this folder.
