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
4. **twin + gate** (`robotforge run-gate <spec>`) — spawns the model in headless
   Gazebo and runs motion acceptance checks (drive / turn / stop) with explicit
   pass/fail thresholds.

Two more intakes feed step 1, with opposite contracts. A **photo of a
robot** (`robotforge describe --photo robot.jpg`) drafts a spec from
appearance — every dimension ESTIMATED, banner and all. A **photo of a
spec sheet, datasheet or blueprint** (`robotforge describe --document
sheet.png`) *transcribes* the printed values instead: nothing is
inferred from drawing scale, a value that isn't printed stays absent,
and the draft is badged "Document draft". On the website, the Forge
chat also takes a **.ply point-cloud scan**, measured in the browser
(bounding box, badged MEASURED (scan)) — a scan gives shape and size
only, never mass, motors or voltage.

## Quickstart

```bash
pip install -e .            # zero required dependencies for the core
robotforge validate examples/pathfinder.json
robotforge urdf examples/pathfinder.json --out build/pathfinder.urdf
robotforge describe "a four-wheel rover, 30 cm long, with a front ultrasonic sensor" --mock
robotforge describe --photo robot.jpg        # draft a spec from a photo (every dimension ESTIMATED)
robotforge run-gate examples/pathfinder.json # spawn the twin in headless Gazebo and grade drive / turn (needs Gazebo Sim)
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

### Optional Fireworks transport

Fireworks AI is an optional additional inference provider for the
hackathon credits Abel was awarded. It does **not** replace the Meta
Model API / Baseten core path, and it is never selected merely because
its key happens to be present.

Setup:

1. Redeem the Fireworks hackathon credits in the Fireworks account
   billing page.
2. Create a Fireworks API key in the Fireworks console.
3. Supply that key through the secure connector/environment flow as
   `FIREWORKS_API_KEY`. Never commit it or put it in a command-line
   argument.
4. Explicitly choose Fireworks for one run, or enable it as an extra
   fallback after Meta and Baseten:

```bash
export FIREWORKS_API_KEY="<supplied through the secure flow>"
export RF_DESCRIBE_TRANSPORT=fireworks
robotforge describe "your robot description"

# Alternative: add it to the fallback chain without forcing it
export RF_FIREWORKS_ENABLED=1
robotforge describe "your robot description"
```

The default model is Muse Spark Open on Fireworks serverless
inference, `accounts/fireworks/models/muse-spark-open`, called at
`https://api.fireworks.ai/inference/v1/chat/completions` with a Bearer
key. Override it with `RF_FIREWORKS_MODEL` or the endpoint base with
`RF_FIREWORKS_API_BASE` only when deliberately testing another
Fireworks model. The stderr line names the transport that actually
produced the spec, e.g. `describe transport: fireworks
(accounts/fireworks/models/muse-spark-open), forced`.

## Examples

The two `pathfinder` specs in `examples/` are a pair, made two different ways:

- `examples/pathfinder.json` — **hand-written**: the demo robot's spec, written
  by hand for this event. This is the reference spec the quickstart commands use.
- `examples/pathfinder-live.json` — **live-generated**: produced by
  `robotforge describe` (Muse Spark, live transport) from a plain-language
  request on 2026-10-26 — the first live end-to-end pass. It passed validation
  with no findings and generated a URDF; it is kept as the record of that run,
  not as a hand-tuned reference.

## Layout

- `src/robotforge/schema.py` — the robot specification (dataclasses, strict parsing)
- `src/robotforge/validate.py` — engineering checks + findings
- `src/robotforge/stability.py` — static stability check for legged robots (support-polygon computation from the spec; `robotforge stability <spec>`) — a check, never a gate verdict
- `src/robotforge/harness.py` — electrical harness checks over a spec's wiring graph (`robotforge harness <spec>`): voltage drop, ampacity, logic levels, rail budgets, connector match — every check CHECKED, PARTIAL or NOT_CHECKED with missing data named, never a blanket pass
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
