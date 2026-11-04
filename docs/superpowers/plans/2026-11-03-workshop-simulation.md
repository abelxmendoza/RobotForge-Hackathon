# Workshop Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Seven Workshop tabs and an interactive simulation workspace with an optional same-computer Gazebo test runner.
**Architecture:** A pure simulation contract, Rapier drive adapter and Three.js scene; React workspace owns controls/results. Python stdlib loopback companion wraps the existing bounded Gazebo runner. Existing catalogue bundle UI remains advanced.
**Tech Stack:** Existing Next.js, Three.js, Rapier, Python, Gazebo Harmonic runner.
**Spec:** docs/superpowers/specs/2026-11-03-workshop-simulation-design.md

## Global Constraints
- No Worker deployment, secrets, native installs or external services.
- Do not guess physics inputs or claim Mac runtime validation on Linux.
- No arbitrary command/XML/file execution from HTTP requests.

## Review Focus
- Scene/resources and local processes cleaned up on reset/unmount/timeouts.
- Held controls stop on focus loss and pointer release.
- Spec/version/robot changes cannot misattribute results.
- Local runner rejects foreign origins and malformed/oversized requests.
- Unsupported robots remain inspectable without fake locomotion.

### Tasks
- [x] Pure helpers/tests: input requirements, scenario contract, drive commands, local runner response validation and saved result keys.
- [x] Local Python companion/tests: health, platform capability, bounded jobs, safe origin/host/request handling; real Linux run if Gazebo is available.
- [x] Browser physics and scene: keyboard/touch, model loading, scenarios, run/pause/reset/camera and cleanup.
- [x] Workshop integration: seven tabs, BOM subareas, saved runs in Test, built-in Omega, Wrench scenario/run commands and setup help.
- [x] Browser QA, full tests/build, independent review, commit/push/PR with CI checks. Preserve existing deep links.

## Verification
- Full regression suite: 806 passed, 5 skipped.
- TypeScript no-emit and Next production build: passed.
- Browser: keyboard drive, pause, Save run to Test, local Gazebo connect/run/save/replay verified.
- Linux Gazebo 8.15: 0.51 m drive, 92.7° turn measured in UI. No automatic pass/fail.
- Independent review: all process cleanup, pending-start cancellation and keyboard findings addressed.
- Native Apple Silicon runtime remains unverified; setup explicitly says best-effort.
