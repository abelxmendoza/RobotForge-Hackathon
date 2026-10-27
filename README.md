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

Live describe mode runs through the registered Meta Model API connector
helper in this workspace (no key in the repo or environment; see
`docs/DESIGN.md`, "Describe transport"). Outside that workspace it falls
back to a direct call:

```bash
export META_API_KEY=...     # fallback only, when no connector helper exists
export RF_MODEL=...         # optional; default muse-spark-1.3
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

## Website

The site has two separate parts that share one set of design tokens
(`assets/css/tokens.css`):

- **Landing page** — `index.html`: the promise, the workflow, the evidence,
  and one way in ("Open the app").
- **App** — `app/`: Forge (step through a recorded run from words, a photo
  or a parts list), Robots (the Robodex, one page per robot with its
  take-apart viewer, plus the parts catalogue) and Evidence (the gate's
  recorded reports).

The app pages, the landing page's robot row, and redirects from the old
URLs (`reports.html`, `try.html`, `robodex.html`, `parts.html`) are
generated from repository data. After changing `catalog/` or
`src/robotforge/site.py`, run:

```bash
robotforge site
```

`tests/test_site.py` fails if the committed pages are stale.

## License

Apache-2.0. See `LICENSE`.
