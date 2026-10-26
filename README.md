# RobotForge

**Describe a robot in plain words — RobotForge builds its validated digital twin in simulation.**

You describe a robot (or paste a parts list). **Muse Spark**, via the Meta Model API,
turns the description into a structured hardware specification. RobotForge then checks
that specification the way an engineer would — wheel size vs. ground clearance, mass
budget, motor/battery voltage match — generates a URDF model, spawns the twin in
Gazebo, and runs motion acceptance checks. If the description doesn't add up, you find
out *before* anything is built.

## Provenance (read this first)

This repository was **built during the Meta Global AI Developer Hackathon,
October 26 – November 4, 2026**, for the Indie track (theme: *Push the Frontier*).

The design was informed by an earlier open-source design prototype by the same author
([RobotForge](https://github.com/abelxmendoza/RobotForge), October 21, 2026), which is
referenced as prior design exploration only. **All code in this repository was written
during the event window**, and the demo showcases only functionality built here.

## Pipeline

```
describe ──► spec ──► validate ──► urdf ──► gazebo twin ──► motion gate
 (words)    (JSON)   (engineering   (model)   (headless)     (pass/fail)
                      checks)
```

1. **describe** — natural language → structured robot spec (Muse Spark, Meta Model API,
   Standard mode). Offline `--mock` mode exists for development without a key.
2. **validate** — engineering sanity checks beyond schema shape: geometry, mass
   budget, electrical consistency. Findings carry severity; errors fail the spec.
3. **urdf** — generates a URDF model from a valid spec.
4. **twin + gate** — spawns the model in headless Gazebo and runs motion acceptance
   checks (drive / turn / stop) with explicit pass/fail thresholds.

## Quickstart

```bash
pip install -e .            # zero required dependencies for the core
robotforge validate examples/pathfinder.json
robotforge urdf examples/pathfinder.json --out build/pathfinder.urdf
robotforge describe "a four-wheel rover, 30 cm long, with a front ultrasonic sensor" --mock
```

Live describe mode needs a Meta Model API key:

```bash
export META_API_KEY=...     # hackathon credits: $150 per participant
export RF_MODEL=...         # model id from the Meta Model API catalogue
robotforge describe "your robot description"
```

## Layout

- `src/robotforge/schema.py` — the robot specification (dataclasses, strict parsing)
- `src/robotforge/validate.py` — engineering checks + findings
- `src/robotforge/describe.py` — Muse Spark client (OpenAI-compatible endpoint)
- `src/robotforge/urdf.py` — URDF generation from a spec
- `src/robotforge/cli.py` — `robotforge` command line
- `examples/` — sample specs (the demo robot is `pathfinder`, built for this event)
- `docs/DESIGN.md` — design notes, gate thresholds, demo plan

## License

Apache-2.0. See `LICENSE`.
