# Field notes — Spot at Cal Poly Pomona IRLab (operator-supplied)

These notes are **operator-supplied context**, recorded by the human who
took the photo. They are NOT output of the Spotter pipeline and are not
part of the machine-readable dossier (`dossier.json`, robotforge-spotter/1).
Where they make claims, the provenance is stated per claim.

## The spotting

- **What:** Boston Dynamics Spot quadruped with the Spot Arm mounted
  (folded flat along its back), lying powered-off on a lab floor in
  front of its dock.
- **Where:** Intelligent Robotics Lab (IRLab), Dr. Daisy Tang's lab,
  Cal Poly Pomona.
- **When:** 2026-10-28, photographed in person by Abel Mendoza during a
  visit to the lab.
- **Photos:** `spotted-photo.jpg` (primary; wide lab shot — the Spotter
  input, sha256 07c80a3780cb61989d94650f0315569759345fd5e9ae2a8c3f294b396de2d960)
  and `spotted-photo-2.jpg` (supporting; closer shot of the same unit
  with two team members working beside it, sha256
  cc0a05cce7cf432d51f791dfaebffb5b7abbee116f7aae3b22b9d6dc8b9e54c2).

## Team-reported status — SELF-REPORTED-HEARSAY

Members of the IRLab Spot team told the operator during the visit that
they **have not yet gotten the robot to move, and have not taken it
outside**. Provenance: **SELF-REPORTED-HEARSAY** — the team's own words
as reported by the operator. RobotForge has not verified the unit's
operational state; the photos show it stationary and folded, which is
consistent with, but does not prove, that account.

## Sim applicability — no gate verdict, by design

RobotForge's Forge drive gate is a **wheeled-robot odometry check**
(drive a commanded distance, compare reported odometry). Spot is a
legged quadruped: it has no drive wheels and no wheel odometry, and
this project has no quadruped dynamics model. **No gate was run and no
sim verdict is claimed for this dossier.** It is a Robodex/library
entry only. Claiming a sim verdict for Spot would require a quadruped
model RobotForge does not currently have.

Two draft-spec artifacts follow from that and are schema coercion, not
claims about the real robot: the wheeled spec schema recorded the
drivetrain as `skid_steer`, and the wheel block carries `count: 0`
(Spot has feet, not wheels).

## Lookup wrinkles (kept visible, as generated)

- **Credit line artifact:** the dossier's credit line names
  `bostonrb/bostonrb` because the lookup's owner-name heuristic ranked
  it "official" ("owner name carries the 'boston' brand"). That repo is
  a Boston Ruby community project, not Boston Dynamics. The robot's
  actual maker is Boston Dynamics — the name is printed on the robot's
  body in the photo — and the genuinely official repo in the same
  source list is `boston-dynamics/spot-sdk`. The credit line is a
  heuristic artifact; do not cite it as attribution.
- **Twin candidate warning:** the lookup's "best pullable model
  candidate" is `Boston-Robot-Hackers/dome — config/dome2.urdf`. That
  URDF describes a different robot (a dome robot that happens to live
  in a "Boston" org). It is **not** a Spot model and must not be pulled
  as Spot's twin.
- **Namesake noise carried and labelled:** the 21-repo source list
  also contains the City of Boston's website repo, two Boston housing
  datasets, an identity-workshop repo, and other "Boston"-the-place
  results. They are in the dossier, labelled by class, not hidden.

## Parts guesses — read the basis, not just the match

CATALOG matches in this dossier are scored **kind-token** matches
against RobotForge's maker-parts catalog (e.g. any "depth_camera" can
score an Intel RealSense D435). They say the catalog stocks something
of that kind; they do **not** claim Spot contains those parts. Spot's
real actuators and cameras are Boston Dynamics' integrated units. The
battery and the joint encoders scored no catalog match and are left as
free-text guesses ("needs a human pick"), and Spotter v1 attempts no
catalog mapping for the visible legs, arm, or body.

## Published-spec cross-reference (WEB-SOURCED)

Boston Dynamics' own developer documentation ("About Spot",
https://dev.bostondynamics.com/docs/concepts/about_spot.html, fetched
2026-10-29) publishes for the base robot: length 1100 mm, width
500 mm, height 840 mm standing / 191 mm sitting, net weight 32.5 kg,
12 degrees of freedom (legs), max speed 1.6 m/s, battery 605 Wh /
58.8 V max, depth-camera operating range 4 m.

Against the photo draft (all PHOTO-ESTIMATED): length 1.1 m and width
0.5 m agree exactly — the draft's own description says its estimate
basis is the published Spot size. Draft height 0.55 m sits between the
published sitting and standing heights; the photographed unit is
sitting/folded. Draft mass 40.0 kg vs published 32.5 kg: the published
figure is the base robot **without** the arm; the photographed unit
carries the Spot Arm, which the base figure excludes. Draft battery
(50.4 V, 12000 mAh ≈ 605 Wh) is consistent with the published pack
capacity. None of this converts the draft into a measurement — the
draft stays PHOTO-ESTIMATED; these are the vendor's published figures
for the product line, not measurements of this unit.

## Other catches from the same visit — first-pass notes, NOT dossiers

Two more items photographed by the operator on the same 2026-10-28
IRLab visit. These are **first-pass identifications from a single
photo each** — no Spotter run, no lookup, no dossier. Confidence is
stated per item; treat both as leads for a possible follow-up
spotting, not as Robodex entries.

### 1. Hokuyo URG lidar (tabletop close-up)

A compact black laser scanner sitting cabled on a lab table: square
base with a cylindrical rotating turret on top, and the maker's label
legible on the turret — "HOKUYO" and "URG".

- **First-pass ID:** a Hokuyo URG-series 2D scanning laser
  rangefinder (lidar). The boxy base + round turret matches the
  URG-04LX generation's form factor.
- **Confidence:** HIGH on the family — the branding is printed on the
  unit and readable in the photo. LOW on the exact model: no model
  plate was read, and several URG variants share this silhouette.

### 2. Black 3D-printed mechanism (unidentified)

A black FDM-printed assembly (print layer lines visible) photographed
on a lab table next to a laptop: a flat rectangular base plate with
corner mounting holes; a short, wide cylindrical base; and on top a
smooth spherical/dome housing with a cut-out window at the top and a
small protruding rectangular bracket with a through-hole on one side.

- **First-pass ID:** unknown. The dome-with-aperture shape and side
  bracket are consistent with a printed pan-tilt / gimbal housing for
  a camera or sensor; a ball-and-socket joint demonstrator or a
  student project's printed enclosure are also plausible. No markings,
  no electronics visible, and one photo is not enough to choose.
- **Confidence:** LOW — form described, function not established.
  Likely an IRLab student project part; whose, and for what, is
  unknown.
