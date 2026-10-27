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
| NL → spec | `describe.py` (Muse Spark via Meta Model API) | day 1: client + mock mode; live transport wired and verified 2026-10-26 |
| Spec schema | `schema.py` | day 1: done, tested |
| Engineering validation | `validate.py` | day 1: core checks, tested |
| URDF generation | `urdf.py` | day 1: box-chassis differential rover |
| Gazebo twin (headless) | `twin.py` | day 2–3 |
| Motion gate | `gate.py` | day 2–3 |
| Web demo | `web/` | day 4–6 |
| SAM 3.1 photo → parts (stretch) | — | only if core is green |

### Describe transport (live mode)

Live describe does not hold an API key. In this workspace it shells out to
the registered Meta Model API connector helper (`meta_api.py`, connector
`custom.meta-model-api`), which attaches the credential as a platform-managed
surrogate on the outbound request to `api.meta.ai` — the same helper path
verified against the live catalogue. The helper's chat command takes the
system prompt as a file and returns the chat completion as JSON on stdout;
`describe.py` parses that into a `RobotSpec`. The helper path can be
overridden with `RF_META_API_HELPER`. Outside this workspace, if the helper
is absent, describe falls back to a direct OpenAI-compatible call using
`META_API_KEY`. The model defaults to `muse-spark-1.3` (override:
`RF_MODEL`), Standard mode only. First live end-to-end pass: 2026-10-26,
`examples/pathfinder-live.json` — spec generated from a plain-language
request, passed validation with no findings, and generated a URDF.

## Motion gate thresholds — DECIDED (Abel, 2026-10-26)

Position error ≤5% of commanded distance = PASS, >10% = FAIL, between = MARGINAL.
Heading error ≤5° = PASS, >10° = FAIL, between = MARGINAL. (The pre-window draft's
3°/6° heading band was loosened deliberately: pathfinder is skid-steer, and skid
turning scrubs laterally, so 3° would grade the physics model rather than the robot.)
Implemented in `gate.py` as `DEFAULT_THRESHOLDS`.

## Static stability checks for legged robots (2026-10-26)

The motion gate grades ground robots by driving them; legged robots
have no gate. What a spec alone can honestly support for them is a
*static* check (`src/robotforge/stability.py`, `robotforge stability
<spec>`): the support polygon of the feet, the weakest-direction
distance from the centre-of-mass projection to a polygon edge, and the
static tip-over angle atan(margin / CoM height). Foot placement is
derived from body length/width with the take-apart viewer's fractions;
CoM height is ASSUMED at 55% of standing height — the assumption is
printed in every report, never buried.

Grades (v1 thresholds, chosen with the check, printed on every report;
Abel may retune): tip angle ≥ 20° STABLE · 10–20° MARGINAL · < 10°
UNSTABLE · projection outside the polygon is UNSTABLE at any angle.

Evidence separation is structural, not cosmetic: checks live in a
`checks` record in `catalog/robots.json`, apart from `gate_status`;
the loader refuses a check typed as a gate run, a stability grade
wearing a gate status, or a check recorded for a non-legged robot.
Site badges are dashed steel-blue, distinct from the verdict pills.
First records (2026-10-26): Go2 STABLE (31.8°), Mini Pupper STABLE
(27.9°), G1 UNSTABLE (2.7°), OP3 UNSTABLE (2.7°) — the humanoids'
backward (heel) margin binds, which is the honest geometry of the
model: bipeds stand by active balance, not stance. All four remain
NOT_GATED; the check changes no gate status. Drones get nothing —
flight stability is a different analysis.

## Harness checks (2026-10-26)

The wiring sibling of the spec checks and the static stability check
(`src/robotforge/harness.py`, `robotforge harness <spec>`): five
electrical computations over a spec's documented wiring graph —
voltage drop (copper loop resistance, R = ρ·2L/A, ρ = 1.68e-8 Ω·m at
20 °C; WARN above 5% of the connection's voltage, v1 threshold),
ampacity, logic-level agreement, rail budgets (downstream load sums
vs a source's rated output), and connector matching.

Ampacity ratings come from PowerStream's *American Wire Gauge Chart
and AWG Electrical Current Load Limits* (powerstream.com/Wire_Size.htm),
following the *Handbook of Electronic Tables and Formulas*. The table
prints two columns; RobotForge uses the conservative
power-transmission column (700 circular mils per amp, for bundled
runs), not the free-air chassis-wiring column — a harness is a
bundle. Exceeding the table is an ERROR.

The evidence posture is the point: no robot gets a blanket harness
pass. Every evaluation is CHECKED, PARTIAL (rail budgets with some
unmeasured loads), or NOT_CHECKED, and a check that could not run
names its missing inputs (current data, cable gauge/length,
both-ended connector data, logic levels, rated outputs). Reports
live in `catalog/harness-reports/` and the test suite re-derives
them from the specs, so the records cannot drift. First records
(2026-10-26): all nine wired Robodex robots report 0 checked-clean
evaluations — their wiring graphs carry voltages and topology but
almost no current, cable or connector data yet. That gap list,
printed on every robot page, is the deliverable: it names exactly
which datasheets to hunt next. Harness checks are a third evidence
kind — dashed amber badges, apart from gate verdicts and static
checks — and they change no other status.

## Second reference robot — DECIDED (Abel, 2026-10-26)

**Andino** (open-source differential-drive robot, ROS 2 native, published
dimensions and Gazebo models) cross-checks the gate beyond the demo robot.

**Clarification (2026-10-26, P1 audit):** the gate's live validation runs to
date use **pathfinder** (demo robot) and the **TurtleBot3 Burger**
(`examples/turtlebot3-burger.json`, published dimensions) as the known-good
differential-drive reference — the Burger is the robot behind the landing
page's "both reference robots pass" status. Andino remains the decided
*next* reference; its spec is not yet in `examples/`. The three names are
not interchangeable: Burger = gated reference today, Andino = decided
addition, TurtleBot3 Waffle Pi (`examples/photo-turtlebot.json`) = photo
intake example only.

## Demo discipline (from the Official Rules, Oct 25, 2026)

- Demo video: **3 minutes**, highlighting only functionality built during the event.
- Repository public; video link accessible; everyone who contributed listed.
- Deadline: **Nov 4, 6:00 PM PT** (team target: submit Nov 3).
- API use in **Standard mode** only — Contributor mode permits training on
  prompts/code and is not used for this project.
