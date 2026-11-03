# Workshop simplification

Approved direction: five main tabs (Overview, Build, Wiring, Test, History), one primary workspace per tab, an on-demand specs editor, a recommended next action and simple saves.

Implementation:
- Preserve existing tab IDs for deep links and chat context; group parts and tools under Build and simulation under Test.
- Open specs in an accessible native dialog, with technical JSON collapsed.
- Give Overview one next action using missing measurements, missing wiring and validation findings; retain short measurements and preview.
- Show comparison details on demand in Test. Keep assembly and wiring as the main workspaces.
- Save browser drafts separately from version history, per robot and baseline version; restore only matching baselines and surface storage failures.
- Keep version names and notes optional, in an expandable save section.
- Verify navigation, persistence, focused tests, TypeScript and production build; inspect responsive layout in browser if available.
