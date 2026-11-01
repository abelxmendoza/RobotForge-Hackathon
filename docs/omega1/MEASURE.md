# Omega1 → RobotForge: measuring worksheet

Omega1 is Abel's own robot: a Freenove FNK0043 4WD Raspberry Pi car
with ordinary wheels, so it's skid-steer. Right now it can't drive, and
the parts to fix it cost money. RobotForge doesn't need it to drive: it
needs its dimensions. A measured spec is the strongest evidence any
robot in the Robodex can have. Every other entry is DOCUMENTED (from a
vendor or published source) or ESTIMATED (from a photo).

Before measuring, see [EXTRACTION.md](EXTRACTION.md): Omega1's own code
repo has already been read for every fact it records
([`omega1.extracted.json`](omega1.extracted.json)), including code
defaults to check against your measurements. Note that the code's
0.20 m wheel track can't be right on a 0.15 m wide kit.

The template `omega1.template.json` pre-fills only what the kit
documents. Everything else is a `MEASURE_ME`, `LOOK_UP` or `READ_OFF`
string, and the spec parser rejects strings, so the template can't be
validated until you've replaced every one with a real number. That's
deliberate.

## What you need

Tape measure or ruler, calipers if you have them, a kitchen scale, a
phone camera. About 15 minutes.

## Measure (write the number and the date)

| Field | How | Value |
|---|---|---|
| `length_m` | Chassis plate, front edge to back edge | |
| `width_m` | Chassis plate, side to side (not including the wheels) | |
| `height_m` | Floor to the top of the tallest fixed part | |
| `ground_clearance_m` | Floor to the lowest point under the plate | |
| `mass_kg` | Whole robot on the scale, batteries in | |
| `wheel.diameter_m` | Across the tyre, calipers if possible | |
| `wheel.width_m` | Tyre width | |
| Track (for notes) | Centre of left tyre to centre of right tyre | |
| Wheelbase (for notes) | Front axle centre to rear axle centre | |
| `battery.capacity_mah` | Printed on the 18650 cells | |
| `motor.voltage_v` | Gearmotor label or kit datasheet. If you can't find it, say so; don't guess | |

Units are metres and kilograms (12.3 cm → `0.123`).

## Then

```bash
cp docs/omega1/omega1.template.json examples/omega1.json
# replace every MEASURE_ME / LOOK_UP / READ_OFF with the number;
# delete the "_provenance" and "component_mass_kg._note" keys
# (or keep provenance as a note in "description")
robotforge validate examples/omega1.json
robotforge urdf examples/omega1.json --out build/omega1.urdf
robotforge run-gate examples/omega1.json     # on scythe, Gazebo installed
```

If validate reports findings, record them. A real robot that fails a
check is a better demo than one that was tuned until it passed.

To use it in the app: **My robots** (`/garage/`) → bring in a robot →
spec file → `examples/omega1.json`. That saves it as version 1. The
chat operations in `docs/CHAT-OPERATIONS.md` (for example `add a
Jetson Orin Nano to "Omega1"`) then work on a measured robot instead
of an illustrative one, and each upgrade you plan becomes a version
you can diff and re-check.

## For the video (0:20–1:10)

1. Photo of Omega1 on the desk → Forge photo intake. Muse Spark vision
   with the SAM 3.1 cross-check drafts an ESTIMATED spec. Show the LIVE badge.
2. Tape measure on screen for 3 seconds. The ESTIMATED values get
   replaced with MEASURED ones.
3. `validate` → twin → gate. Then say it: "I can't afford to fix it yet.
   Now I don't have to wait to keep developing it."

Then add Omega1 to `catalog/robots.json` (its next Robodex number)
and run `robotforge site`.
