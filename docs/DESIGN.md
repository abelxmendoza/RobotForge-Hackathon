# RobotForge — design notes (hackathon build)

Written 2026-10-26, day 1 of the Meta Global AI Developer Hackathon window.
Design reference (not code): the author's Oct 21, 2026 open-source prototype
`abelxmendoza/RobotForge`. Everything in this repo is written in-window.

## One-liner

Describe a robot — in words or a parts list — and RobotForge builds its validated
digital twin in simulation.

## Why this shape

- **Meta model as the core, not a garnish.** Stage One screening requires the project
  to have "reasonably used the Meta Model API and/or Meta open-weight models," and
  Use of Meta AI Tooling is 25% of the score. Muse Spark therefore sits on the
  critical path: it converts an unstructured description into the structured spec
  everything downstream consumes. Remove it and the product does not work.
- **Validation is the product's spine.** LLM output is not trusted: the spec passes
  schema parsing, then engineering checks (geometry, mass, electrical), and only a
  passing spec may generate a twin. Failures are reported as findings a human can act
  on — this is also where a second model pass (spec repair suggestions) can attach.
- **The demo must prove generality.** The demo robot (`examples/pathfinder.json`) is a
  new configuration created for this event, described live in the video — not a
  pre-baked example from the prototype.

## Pipeline stages and status

| Stage | Module | Status |
|---|---|---|
| NL → spec | `describe.py` (Muse Spark via Meta Model API) | day 1: client + mock mode |
| Spec schema | `schema.py` | day 1: done, tested |
| Engineering validation | `validate.py` | day 1: core checks, tested |
| URDF generation | `urdf.py` | day 1: box-chassis differential rover |
| Gazebo twin (headless) | `twin.py` | day 2–3 |
| Motion gate | `gate.py` | day 2–3 |
| Web demo | `web/` | day 4–6 |
| SAM 3.1 photo → parts (stretch) | — | only if core is green |

## Motion gate thresholds — OPEN DECISION (Abel)

Draft (from pre-window planning, undecided): position error ≤5% of commanded distance
= pass, >10% = fail, between = marginal; heading error ≤3° pass, ≤6° marginal.
To be confirmed before the gate is coded.

## Second reference robot — OPEN DECISION (Abel)

For cross-checking the gate beyond the demo robot: candidates Andino (open-source
differential robot, ROS 2 native) or Leo Rover. Lean: Andino.

## Demo discipline (from the Official Rules, Oct 25, 2026)

- Demo video: **3 minutes**, highlighting only functionality built during the event.
- Repository public; video link accessible; everyone who contributed listed.
- Deadline: **Nov 4, 6:00 PM PT** (team target: submit Nov 3).
- API use in **Standard mode** only — Contributor mode permits training on
  prompts/code and is not used for this project.
