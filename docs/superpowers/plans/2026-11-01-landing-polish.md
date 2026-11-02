# Landing Page Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dense final demo screenshot while preserving the deployed landing page and its final call to action.

**Architecture:** Make one surgical JSX deletion in the existing home page and rely on the CTA band's normal document flow. Add a focused source regression test so the screenshot cannot return accidentally.

**Tech Stack:** Next.js 16, React 19, pytest source checks.

**Spec:** `docs/superpowers/specs/2026-11-01-landing-polish-design.md`

## Global Constraints

- Keep the final heading, explanation, Run the demo button, and Open the app button.
- Do not change other landing sections, styling, assets, or visual language.
- Do not replace the screenshot with another image.

## Review Focus

- The final CTA remains present after the figure is removed.
- `demo-shot.jpg` is not rendered anywhere on the landing page.
- No unrelated landing copy or section is changed.
- Static export still builds.
- Mobile layout retains normal spacing without the figure.

---

### Task 1: Remove the final demo screenshot

**Files:**
- Modify: `web-next/src/app/page.tsx`
- Modify: `tests/test_site.py`

**Interfaces:**
- Consumes: the existing final `.cta-band` markup.
- Produces: the same CTA without its `hero-shot` figure.

- [ ] **Step 1: Add a failing regression test** asserting the final CTA heading and both links remain while `demo-shot.jpg` and `The one-click demo, mid-run.` are absent from `page.tsx`.
- [ ] **Step 2: Run the focused test** with `python -m pytest tests/test_site.py -q` and confirm it fails on the screenshot assertion.
- [ ] **Step 3: Remove only the final `hero-shot` figure** from `web-next/src/app/page.tsx`; do not edit the asset or other sections.
- [ ] **Step 4: Run `python -m pytest tests/test_site.py -q`** and require zero failures.
- [ ] **Step 5: Run `npm run build` in `web-next`** and require a successful production build.
- [ ] **Step 6: Run `git diff --check` and inspect the diff** to confirm only the approved landing markup, test, and documentation changed.
- [ ] **Step 7: Commit** with `fix: remove dense landing demo screenshot`.
