# Submission Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a deterministic, submission-ready RobotForge release gate and accurate launch handoff.

**Architecture:** Keep all core validation offline by storing immutable simulation inputs in test fixtures and checking the static export through repository-owned scripts. CI composes dependency installation, Python validation, the Next production build, and exported-route smoke checks; production Worker validation remains a read-only health probe.

**Tech Stack:** Python 3.12, pytest, Node 22+, Next.js 16, GitHub Actions, Cloudflare Worker health JSON

**Spec:** `docs/superpowers/specs/2026-11-01-submission-hardening-design.md`

## Global Constraints

- Do not read, print, store, or modify production credential values.
- Required release checks must run without Internet access after dependencies are installed.
- Do not add new product features or change application behavior.
- Keep tracked generated files and the Git worktree clean after verification.

## Review Focus

- Offline CI: physics integration must not call `raw.githubusercontent.com`.
- Client-rendered routes: smoke checks must find stable product markers without assuming all visible text is server-rendered.
- Missing export: the smoke script must fail when a required route file is absent.
- Misconfigured Worker: the probe must fail clearly for non-JSON, unhealthy, or unconfigured responses.
- Documentation drift: canonical hosting and demo-video claims must agree across README and runbooks.

---

### Task 1: Deterministic physics integration fixtures

**Files:**
- Create: `tests/fixtures/urdf/turtlebot3-burger.urdf`
- Create: `tests/fixtures/urdf/unitree-go2.urdf`
- Modify: `tests/test_physics.py`

**Interfaces:**
- Consumes: the existing `_dom_json(urdf_text: str) -> dict` helper.
- Produces: an end-to-end physics test with no network dependency.

- [ ] Add a test assertion that patches network access to fail while `test_engine_end_to_end_in_node` still completes.
- [ ] Run the focused test and confirm the current implementation fails.
- [ ] Store the exact URDF specimens used by the catalogue provenance and load them from `tests/fixtures/urdf`.
- [ ] Run the focused test and the complete Python suite.

### Task 2: Exported web route smoke gate

**Files:**
- Modify: `web-next/scripts/parity.mjs`
- Modify: `web-next/package.json`

**Interfaces:**
- Consumes: `web-next/out/**/index.html` produced by `npm run build`.
- Produces: `npm run smoke`, exiting nonzero for absent routes or missing stable RobotForge markers.

- [ ] Add fixture-driven self-tests for a present marker, a client-flight marker, and a missing route.
- [ ] Confirm the existing parity behavior fails against the current production export.
- [ ] Replace word-coverage scoring with explicit route existence, title, metadata/flight-data, and stable marker assertions.
- [ ] Run `npm run build && npm run smoke` and confirm all required routes pass.

### Task 3: Unified GitHub release gate

**Files:**
- Modify: `.github/workflows/tests.yml`

**Interfaces:**
- Consumes: Task 1's offline pytest suite and Task 2's `npm run smoke`.
- Produces: a CI job that fails on Python, TypeScript/build, or exported-route regressions.

- [ ] Add production build and route-smoke steps after pytest.
- [ ] Validate workflow syntax and reproduce its commands locally.

### Task 4: Launch documentation and safe Worker probe

**Files:**
- Create: `tools/check_live_health.py`
- Create: `tests/test_check_live_health.py`
- Modify: `README.md`
- Modify: `live/README.md`

**Interfaces:**
- Produces: `python tools/check_live_health.py <worker-base-url>`, a read-only `/health` check that prints no credentials and exits nonzero unless the service is healthy, configured, KV-backed, and auth-enabled.

- [ ] Write tests for healthy, malformed, disabled, unconfigured, missing-KV, and auth-unconfigured responses.
- [ ] Run tests and confirm failure before implementation.
- [ ] Implement the checker with standard-library HTTP/JSON only.
- [ ] Update canonical Vercel hosting, submission-video, and verification wording without inventing a video URL.
- [ ] Run the checker tests and documentation link/placeholder searches.

### Task 5: Release verification and audit handoff

**Files:**
- Create: `docs/AUDIT-2026-11-01.md`

**Interfaces:**
- Consumes: outputs from Tasks 1–4.
- Produces: an evidence-backed release report with external blockers clearly separated.

- [ ] Run the full Python suite.
- [ ] Run a clean `npm ci`, production build, and route smoke check.
- [ ] Run CLI validation and inspect `git status --short`.
- [ ] Record exact results, credentialed production checks still requiring the owner, and real-device GPU/mobile QA still outstanding.
