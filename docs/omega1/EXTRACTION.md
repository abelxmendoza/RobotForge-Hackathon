# Extracting a real robot from its own repo

This is the template RobotForge uses to turn a real robot's code repo
into the facts a digital twin needs. Omega1 is the first robot run
through it: the filled-in result is
[`omega1.extracted.json`](omega1.extracted.json), taken from
[abelxmendoza/Omega-Code @ 1d7bb60](https://github.com/abelxmendoza/Omega-Code/tree/1d7bb60d68520639578917b9fbb2a70cc903dd0a).

The automatic repo import (`/import/`) does the first pass: README,
license, part tables, images, and a URDF if there is one. Most hobby
robots, Omega1 included, have no URDF. Their geometry is spread across
launch files and node parameters instead. This template covers that
second pass.

## Rules

1. **Every value cites its source**: file, line, and the line quoted
   word for word, at a pinned commit. If it can't be quoted, it wasn't
   extracted.
2. **Every value says how sure it is.**
   - `DOCUMENTED`: the repo states it as fact (hardware table, pin map,
     wiring notes).
   - `CODE_DEFAULT`: a parameter default. Use it as a starting estimate,
     never as a measurement. Defaults are often copied from a tutorial.
   - `MEASURE_ME`: the repo doesn't say. Leave the value empty.
   - `MEASURED`: taken on the real robot, with the date.
3. **Disagreements are findings, not choices.** When two places in the
   repo give different numbers, or a number can't be physically true,
   record both under `findings` and measure. Don't pick one.

## What to extract, and where to look

| Group | Fields | Where it usually is |
|---|---|---|
| Identity | name, base kit | README title, hardware table |
| Drivetrain | kind (diff, skid, mecanum, Ackermann, legs) | README; motor channel map; how the motor node turns |
| Compute | main board, planned upgrades | README hardware table, architecture diagram |
| Motors | count, kind, driver + bus address, PWM frequency, channel per wheel, max rpm, voltage | README pin/channel tables; motor controller node parameters; driver init code |
| Wheels | radius or diameter, width, track, wheelbase | odometry / motor node parameters (`wheel_radius`, `wheel_base`, `wheel_separation`); launch arguments |
| Actuators | servos, channels, pulse or angle limits, comments about faults | servo node parameters; README troubleshooting |
| Sensors | model, pins or bus address, range, **mount pose** (x, y, z, roll, pitch, yaw) | README; sensor node parameters; `static_transform_publisher` arguments in launch files |
| Power | chemistry, cells in series, full / cutoff voltage, capacity | battery or sensor node parameters; README |
| Interfaces | teleop device, TF tree, main topics | README topic table; launch files |
| Geometry | length, width, height, ground clearance, mass | almost never in code: `MEASURE_ME` |

Search terms that find most of it quickly: `wheel_radius`,
`wheel_base`, `wheel_separation`, `track`, `static_transform_publisher`,
`declare_parameter`, `I2C`, `0x4`, `GPIO`, `ch[0-9]`, `_us`, `battery_cells`.
Skip vendored trees (`venv`, `node_modules`, `site-packages`, `.direnv`).

## What Omega1's repo gave us

Of 46 fields, 22 are documented, 11 are code defaults, and 13 need a
tape measure, calipers or a scale. Six findings, the two most important:

- **The code's track is wider than the robot.** The motor controller
  assumes 0.20 m between left and right wheel centres, but the Freenove
  kit is 0.15 m wide overall. Odometry built on that default turns wrong.
- **There is no URDF.** The import can't simulate Omega1 from the repo
  alone. These facts plus the measurements in [MEASURE.md](MEASURE.md)
  are the path to one (`robotforge urdf`).

Also found: two different wheel sizes in the same repo, a pitch servo
narrowed because of loose hardware (a real repair item), and camera and
ultrasonic mounts that the launch file itself calls placeholders.

## From here to a 3D twin

1. Measure the `MEASURE_ME` fields (MEASURE.md, about 15 minutes) and
   mark them `MEASURED` with the date.
2. Copy the numbers into `examples/omega1.json` (shape:
   `omega1.template.json`), then `robotforge validate` and
   `robotforge urdf`.
3. Add the sensor mount poses and pan-tilt joint limits from this file
   to the URDF, so the camera and ultrasonic sit where they really are.
4. Photos from several angles next to a ruler can then check the
   measured box and wheel positions, and later drive mesh generation.
