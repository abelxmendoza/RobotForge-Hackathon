# Workshop integration

The phone work in PR #198 is already on main. This integration preserves its Wrench rover creation, Kit panel, part swaps, chassis controls, build package exports and My Parts and Tools navigation. The separate rover wizard remains retired.

The desktop prototype adds the responsive workshop scene layout, a single phone inspector sheet, draft/version protection, persisted visual assembly practice, compact Wrench and test views, and safe repeated physics-world initialization. Standard and Unity humanoid inspection remain available. Wrench commands now reveal the requested inspector on phones.

The legacy export omitted missing optional catalogue illustrations instead of issuing broken image requests. Original catalogue data and available illustrations remain intact.

Validation: production static export and TypeScript passed. Full source suite with local socket/process permissions: 1,101 passed, 7 skipped; the three export-link checks passed separately after rebuilding (1,104 total passed). The system Python has an unrelated installed `tests` package, so the local run explicitly bound `tests` to this repository. A restricted run failed four socket/process tests; the permitted run passed those tests.

Browser verification used demo-only data: Wrench created a catalogue-backed rover and opened its Kit panel; the phone layout at 390 by 844 had no horizontal overflow. Previous prototype verification covered save/version switching, simulation run/save, and real compiled Unity loading and joint inspection. This remains visual/spec simulation, not hardware validation. Further Blender scenery and broader library redesign are separate follow-ups.
