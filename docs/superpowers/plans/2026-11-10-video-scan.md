# Video and Scan Implementation Plan

**Goal:** Make existing video and scan intake accessible in Garage.
**Architecture:** Reuse PhotoSpinEditor, ScanMeasure and existing version callbacks. Bound decoder waits and preserve browser-only media storage.
**Tech Stack:** Next.js, React, TypeScript, Python/Node tests.
**Spec:** ../specs/2026-11-10-video-scan-design.md

## Constraints and review focus
No cloud deployment or physics inference. Preserve robot versions and existing media. Check zero-time seeks, short clips, decode errors, invalid frame counts and storage errors.

### Task 1: Video decoding
- [ ] Add a regression test exercising videoFrames with a browser API double that emits no event for a no-op seek; verify failure before fix.
- [ ] Bound metadata and seek waits, validate frame count and dimensions, report progress and release video resources.
- [ ] Verify short clips, decode errors, invalid counts and cleanup.

### Task 2: Garage wiring
- [ ] Render PhotoSpinEditor and ScanMeasure in OverviewMedia using existing save callbacks.
- [ ] Explain video is a photo reference and scan size needs axis/unit review.
- [ ] Run focused tests, full Python suite and production build; inspect the diff and refresh localhost.
