# RobotForge

**Build, fix, modify, upgrade and simulate your robot before you spend a dollar.** Describe a robot, photograph it, or
paste its parts list. **Muse Spark** turns it into an engineering spec, RobotForge
checks it the way an engineer would, and its digital twin drives in Gazebo against
ground truth. If the design doesn't add up, you find out before you buy parts.

**Try it:** https://robot-forge-hackathon.vercel.app ·
**One-click demo:** https://robot-forge-hackathon.vercel.app/demo/ ·
**Demo video:** _(link added at submission)_

## Why I built this

My robot, Omega1, is broken, and right now I can't afford to fix it *and* buy new
parts to keep learning. RobotForge is the tool I needed: bring the robot you have
into a Garage, plan each hardware upgrade, and check it in simulation first. It is
for anyone getting started in robotics without a lab budget, for professionals who
want a fast sanity pass with every number's source shown, and for rover teams
deciding on motors and batteries before a competition.

## What you can do

| | |
|---|---|
| **Demo** | One button: a broken robot, the checks that catch it, a Muse Spark fix the checks must accept, rover checks before and after, and the recorded Gazebo evidence. |
| **Forge** | Words, a robot photo, a spec-sheet photo, a parts list or a 3D scan → a spec, checked. |
| **My robots** (`/garage/`) | Bring in your robot (photo, spec file, or a Robodex robot), edit it, save every upgrade as a version, and compare any two: field diff, engineering checks and rover checks before and after. |
| **Forge loop** | When the checks find a problem, Muse Spark proposes a fix, the validator re-checks it, up to three rounds. The model proposes; the checks decide; you approve. |
| **My parts** (`/inventory/`) | Photograph the parts on your shelf. Muse Spark reads the labels and asks one question; you confirm each part in chat. Confirmed batteries, motors and wheels fit into one of My robots with one click. |
| **Rover field checks** | Slope climb, step climb and battery runtime, each with its assumptions listed (`robotforge rover`). |
| **Evidence** | The Gazebo motion gate's recorded runs: drive, turn and stop measured against ground truth. |

### Chat operations and assembly workbench

In **My robots**, use the Assembly workbench to add component envelopes, preview
positions, and plan connections in the visible Wiring tab. Both use the 3D scene,
with curved selectable cable previews, optional connection pulses, X-ray mode and
an animated exploded view. The workbench requires WebGL; it does not substitute a flat view. The Guide accepts
`add a Jetson Orin Nano to "Omega1"` and previews the action before saving.
Type `operations` for the supported commands. Every applied action creates a
version and supports undo. Export assembly keeps the saved spec and assembly history.

The initial Jetson asset is a published-dimension envelope for NVIDIA's reference
developer kit, not detailed manufacturer CAD. Batteries and converters are explicitly
illustrative placeholders. Placement and wiring are planning-only: added parts are
not yet included in engineering checks or Gazebo, and planned connections remain
NOT_CHECKED. See [the implementation plan](docs/CHAT-OPERATIONS.md).

## Meta models inside

| Model | Where | What it does |
|---|---|---|
| Muse Spark (`muse-spark-1.3`, Meta Model API) | CLI describe, photo, document | Words → spec; robot photo → ESTIMATED draft; spec-sheet photo → transcribed values |
| Muse Spark vision (Meta Model API) | My robots photo intake, My parts | Robot photo → draft spec; part photo → identified part with label-read specs |
| Muse Spark Open (Baseten, Fireworks failover) | Live site: describe, parts lists, Forge Guide, Forge loop, part chat | Spec drafting, list import, guide answers, fix proposals, part confirmation chat |
| SAM 3.1 (Meta Model API) | `robotforge describe --photo` | Cross-checks what Muse Spark saw in a photo against segmented regions |

Every model output is labelled with where it came from (LIVE, LOCAL, RECORDED,
ESTIMATED, DOCUMENT-READ), and no model ever assigns a pass/fail verdict.

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
robotforge fix examples/broken-indoor-rover.json --mock --warnings   # Forge loop (drop --mock for Muse Spark)
robotforge rover examples/pathfinder.json --terrain rough --slope-deg 20   # rover field checks
```

`--mock` runs are offline samples and say so on stderr: `describe --mock` always
returns the canned Pathfinder spec, whatever you type.

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
- `src/robotforge/fixloop.py` — the Forge loop: model proposes bounded spec changes, the validator decides (`robotforge fix <spec>`)
- `src/robotforge/rover.py` — rover field checks: slope climb, step climb, battery runtime (`robotforge rover <spec>`)
- `src/robotforge/urdf.py` — URDF generation from a spec
- `src/robotforge/cli.py` — `robotforge` command line
- `examples/` — sample specs (the demo robot is `pathfinder`, built for this event)
- `docs/DESIGN.md` — design notes, gate thresholds, demo plan

## Website

The live site is the Next.js app in `web-next/`, deployed on Vercel at the
domain root. It adds **My robots** (`/garage/`) and **My parts**
(`/inventory/`); both keep a visitor's robots and parts in that browser's
local storage, with Export / Import JSON to move them. The original static
site is kept alongside it under `/vanilla/`, and is described below.

The static site has two separate parts that share one set of design tokens
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

### Recording the 3D shots for video

`tools/capture_3d.cjs` records the Demo page's broken-to-fixed replay and a
robot page's step-by-step teardown frame by frame. It freezes the page's
clock and advances it exactly one frame at a time, so the clip never drops
frames, however slow the GPU is. Serve the built site, then run:

```bash
(cd web-next && npm run build)                       # build first, in the foreground
python3 -m http.server 8765 -d web-next/out &        # then serve the static build
until curl -sf http://localhost:8765/ >/dev/null; do sleep 1; done
node tools/capture_3d.cjs --shot demo --out demo-replay.mp4 --sheet
node tools/capture_3d.cjs --shot teardown --robot turtlebot3-burger --out teardown.mp4
```

The output is 1920×1080, 60 fps H.264 (yuv420p, faststart). `--sheet` also
writes a contact sheet with one frame per second. It needs Node 20+,
Playwright with Chromium, and ffmpeg.

## License

Apache-2.0. See `LICENSE`.
