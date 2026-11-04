# Wrench coordinated upgrade implementation plan

Goal: deliver the owner's accepted complete-upgrade workflow in Wrench and Build.
Spec: docs/superpowers/specs/2026-11-03-wrench-upgrade-design.md.
Architecture: pure proposal planner; robot spec versions are assembly authority; one shared proposal card and one robot-store write.

- [x] Add versioned assembly projection and transaction helpers; test legacy preservation, stale revisions and complete undo; integrate existing workbench and assembly proposal.
- [x] Add a sourced Pi/converter candidate catalog and pure planner; test unknown voltage ranges, unsupported interfaces, current qualification, duplicates, unrelated wiring retention and stale apply.
- [x] Add shared UpgradeProposal UI with missing-fact entry, evidence, artifacts and explicit incomplete status. Wire Build and Wrench to it, using selected robot context only as a target hint.
- [x] Verify TypeScript, focused tests, full test suite and static build; exercise Wrench preview and atomic apply in isolated browser demo. Document remaining physical/thermal/interface limitations.

No deploy, secret, commit, push or migration deletion. Preserve prior uncommitted work.

Verification: planner/parser/authority/version-conflict regressions pass. Browser demo exercised Wrench request, rejected a 40 V supply, saved a coordinated 9–12.6 V planned candidate as exactly one version, displayed shared components/CAD, and restored the prior full snapshot using Wrench undo. Final full-suite/build results are recorded by the implementation report. No deployment, secret operation, push or commit performed.

Final verification: 862 tests passed, 5 skipped; production static build passed. Final browser follow-up confirmed chat statements for battery range and load update the same open proposal and produce the conditional converter candidate. Browser test upgrade was undone; original demo robot state restored with history retained.
