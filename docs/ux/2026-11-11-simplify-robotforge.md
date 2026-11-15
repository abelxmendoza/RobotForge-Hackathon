# RobotForge UI simplification plan

Status: proposed design and implementation sequence. This task changes planning documentation only; it does not change the live app.

## Primary visual reference

Use the owner-supplied [RoboLabs](https://robolabs-app.vercel.app/) as the primary workspace reference: full-scene workshop, thumbnail robot shelf, direct visual selection and a focused guided-build panel. Follow the captured evidence and adaptations in [DESIGN.md](DESIGN.md). Keep the proposed UI simpler than its overview and integrate RobotForge editing, wiring, tests and Wrench into that same scene.

## Objective

Make the robot and the next useful action immediately visible. Reduce reading, repeated controls, nested menus and page scrolling. Keep design, assembly, wiring and testing in Workshop, with one Wrench composer.

## Findings from the live app

Workshop currently stacks the page title/introduction, robot list, five primary tabs, another Build tool row, Specs, an explanatory banner, repeated robot/status headings, Robot actions, renderer choices and another scene heading before the main interaction. Scene controls and warnings add more vertical content below it. The fixed Wrench bar can cover those controls.

Library repeats its introduction and presents scope selection, seven item-label filters, a robot filter, the complete category index and another group of creation/search actions together. Demo onboarding adds several paragraphs and a checklist across app screens.

Adding more collapsed sections would keep this structure and its discoverability problem. Replace it with a smaller set of visible, task-specific controls.

## Proposed screen structure

| Area | Proposed behavior |
| --- | --- |
| App navigation | Workshop, Library, Robots. Home remains available through the logo. Help, account and preferences use a small utility area. |
| Workshop header | Robot thumbnail/name, one clear status, Save when there are changes, New robot. Switch robots through a visual chooser rather than a long select menu. |
| Workspace modes | Build, Wire, Test. Build contains design and assembly; the robot view replaces a separate Overview destination. History opens through Versions beside Save. |
| Main workspace | Large robot/model or wiring/test canvas visible immediately. Avoid explanatory cards above it. |
| Tool panel | One panel at a time: Parts, selected-part properties, design steps, or results. Selecting a part opens its properties. No nested accordions. |
| Scene toolbar | Fit view, Separate parts, Show/hide, Fullscreen. Use short labels and accessible icons. Basic/immersive renderer preference belongs in view settings. |
| Wrench | One compact composer in the reserved tool-panel area on desktop; one shared bottom sheet on phones. Conversation opens when requested or a reply arrives and never covers scene controls. |

The robot chooser, Library and global Robots destination have distinct roles: switch your current project, manage parts, and browse reference robots. Do not introduce another permanent destination for design.

## Interaction changes

1. **Creating a robot:** New robot opens three visual choices: Describe, Import, Reference robot. The existing rover designer runs as one focused step panel inside Build: Describe → Parts → Assemble → CAD → Export. Keep drafts and saved-version protection.
2. **Editing:** Click a visible part to inspect it. Use a searchable parts list for keyboard access and hard-to-reach geometry. Show human-readable names such as “Left elbow”; retain source IDs in technical details and existing Wrench command compatibility.
3. **Wiring:** Wire mode presents the connection diagram and one selected connection inspector. Power/compatibility issues appear beside the affected connection. Avoid making users open several notes sections.
4. **Testing:** One Run test action and a short result summary. Show failures with an action to investigate them. Open evidence, assumptions and full reports from the result; preserve explicit Estimated, Reference, Not checked and measured/hardware distinctions.
5. **Versions/export:** Versions is a dedicated history panel, not a permanent workspace tab. Export shows a short list of available formats. Archive/delete stay in project management with existing recovery/confirmation behavior.
6. **Library:** Search, My library/Discover, Add. Keep meaningful nested categories, shown as a compact category browser. Open one Filter panel for status/robot filters; selected filters remain visible as removable chips. Part cards show image, name, ownership and quantity. Clicking a card opens the same consistent detail-panel pattern.

## Copy and visual rules

- One main action per task panel; up to two secondary actions beside it.
- Primary buttons use short verbs: Add part, Save, Run test, Export.
- Default panels contain at most one short supporting sentence. Longer explanations belong in Help or a requested evidence/details view.
- Replace repeated disclaimers with one accurate status badge per model/result. Keep consequential warnings visible beside the action they affect.
- Remove repeated page/robot headings, tips, decorative introduction cards and redundant status messages. Do not show “Unity applied selectLink” in the normal scene; reflect selection directly and reserve text for useful feedback/errors.
- Demo starts with a small Demo badge and optional three-step tour. Keep a clear way to exit; avoid persistent paragraphs.
- Use consistent spacing, fewer borders and a quieter background. The robot and selected item should carry the visual emphasis.
- Do not replace paragraphs with unexplained icon-only controls or move every action into a More menu. Primary tasks stay visible.

## Mobile and accessibility

Use the same three workspace modes. The canvas occupies the main area; Parts/Properties/Results use one bottom sheet at a time. Wrench and the sheet must not overlap. Preserve focus, screen-reader labels, keyboard selection, visible validation, reduced motion and touch targets of at least 44 px. Tooltips may supplement labels but cannot be the only way to discover an action.

## Implementation sequence

1. **Baseline and prototype:** Capture the current desktop/phone screens and primary flows. Make a reversible design branch and a realistic clickable Workshop prototype using existing robots, following the RoboLabs reference study in DESIGN.md. Review the new layout before replacing the live UI.
2. **Workshop shell:** Implement the compact header, three modes, stable canvas area and one contextual panel. Move existing features into that structure; keep saved robot, demo/account isolation and old deep links working.
3. **Design and Wrench:** Put creation and rover steps into the panel, simplify the composer/conversation, shorten replies by default, and preserve proposal/apply safeguards. Wrench complements visible controls; ordinary tasks must not require chat.
4. **Scene and evidence:** Unify selection, properties, view controls, status and test summaries across Unity/basic views. Keep launch/quit cleanup and draft protections intact. Show recovery actions when the 3D view fails.
5. **Library and copy:** Simplify filtering and cards, preserve nested taxonomy, then apply the same panel/copy patterns across reference robot pages and onboarding.
6. **Validate and release:** Test actual desktop and phone layouts plus keyboard navigation. Run relevant regressions and production export. Review screenshots and the usable preview, then publish through the existing checked workflow.

Do not rebuild the Unity scene or add physics as part of this UI cleanup. Reuse the existing engines and data services while changing how people reach them.

## Acceptance targets

- Robot visible in the first desktop viewport and within the first phone screen without scrolling past introductions.
- At least 50% fewer words and 40% fewer simultaneously visible controls on the default Workshop screen, measured against the recorded baseline; do not hide required warnings to meet these targets.
- No nested tab bars or nested accordions in the main flows.
- One active contextual panel; no menus inside menus.
- Add robot, select a part, edit a property, inspect wiring, run a test and export are reachable within three navigation actions from the open Workshop, excluding data entry and confirmations.
- Creating/saving a rover, switching robots/versions, demo isolation and Unity fallback continue to work.
- No overlap or horizontal overflow at 390 px and desktop widths. Verify real touch interaction separately from viewport emulation.
- A first-time walkthrough can identify the robot, current task and next action without reading an introduction.

Release is ready only after the simplified flows work with real records and the user can review the preview. These are proposed targets, not achieved results.
