"""Workshop tabs, always (2026-11-02): ONE tab bar at the top of the
Workshop in every state — stored robot selected, Omega1 twin open,
Add Robot open, empty garage — and the same bar controls Omega1 while
the twin is open, instead of ejecting back to the stored robot.

Live failure this pins against (reproduced on the served site twice):
the bar existed only above the twin/Add panes and inside the stored
robot's detail view (so an empty garage had no menu at all), and the
bar shown above Omega1 belonged to the selected stored robot — any
click closed the twin and jumped to that other robot.

Pins:
  1. The bar renders once, unconditionally, at the top of .garage-main;
     both old conditional renders are gone.
  2. WORK_TABS stays the single source with all nine labels.
  3. With nothing selected the buttons are disabled (aria-disabled) —
     presence without fake function.
  4. Twin mode: goTab switches omegaTab and returns BEFORE the stored
     path can close the twin; entering the twin resets to Overview;
     the Checks dot in twin mode is Omega1's own not-gated state,
     never the stored robot's verdict.
  5. Omega1 renders a pane for all nine tab ids, from its records only
     (OMEGA1_FACTS, the check lines, the estimate labelling), with the
     honesty abstentions intact (NOT GATED, Forge Tests NOT_CHECKED,
     no tools/materials record, no overall pass claim).
  6. The chat snapshot in twin mode is Omega1's: its facts and check
     lines, an estimated-twin version label, "Not gated" verdict.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GARAGE = (ROOT / "web-next/src/components/garage/Garage.tsx").read_text()
TWIN = (ROOT / "web-next/src/components/garage/Omega1Twin.tsx").read_text()
LIB = (ROOT / "web-next/src/lib/omega1Twin.ts").read_text()

TAB_IDS = ["overview", "build", "wiring", "specs", "simulate",
           "checks", "bom", "tools", "history"]
TAB_LABELS = ["Overview", "Build", "Wiring", "Specs", "Simulate",
              "Checks", "BOM", "Tools & Materials", "History"]


def test_one_tab_bar_rendered_unconditionally_at_top():
    # exactly one render of the bar in the whole component...
    assert GARAGE.count("{tabBar}") == 1
    # ...and it sits at the top of .garage-main, before every pane
    main_at = GARAGE.index('<div className="garage-main">')
    bar_at = GARAGE.index("{tabBar}")
    assert main_at < bar_at < GARAGE.index("{twinOpen && (omegaTab")
    # both old conditional renders are gone for good
    assert "(twinOpen || adding) && tabBar" not in GARAGE
    assert "const tabBar = robot && draft ? (" not in GARAGE


def test_work_tabs_five_destinations_with_contextual_tools():
    nav = GARAGE.split('const WORK_TABS:', 1)[1].split('];', 1)[0]
    destinations = [('overview', 'Overview'), ('build', 'Build'), ('wiring', 'Wiring'), ('checks', 'Test'), ('history', 'History')]
    positions = [nav.index(f"{{ id: '{tab_id}', label: '{label}'") for tab_id, label in destinations]
    assert positions == sorted(positions)
    for tab_id in ['specs', 'tools', 'bom', 'drivetrain', 'simulate']:
        assert f"id: '{tab_id}'" not in nav
    assert "workshopMainTab(tab)" in GARAGE
    assert 'BUILD_SECTIONS' in GARAGE
    assert 'TEST_SECTIONS' in GARAGE
    assert '<SimulationWorkspace' in GARAGE
    assert '<SavedSimulationRuns robotId={robot.id}' in GARAGE
    assert '<SpecsDialog' in GARAGE


def test_empty_state_bar_is_present_but_disabled():
    assert "const barDisabled = !twinOpen && (adding || !(robot && draft));" in GARAGE
    assert "disabled={barDisabled} aria-disabled={barDisabled}" in GARAGE


def test_twin_mode_tab_switch_never_closes_the_twin():
    go_at = GARAGE.index("const goTab = (t: WorkTab) => {")
    go_body = GARAGE[go_at:GARAGE.index("const tabBar = (", go_at)]
    # the twin branch comes first and returns before the stored path
    assert "if (twinOpen) { setOmegaTab(t); return; }" in go_body
    assert go_body.index("setOmegaTab(t)") < go_body.index("setTwinOpen(false)")
    # Abel (2026-11-03): the twin no longer opens from the Workshop —
    # the #omega1 landing adopts/opens the stored copy instead. The
    # twin-mode tab machinery above stays wired for the twin view.
    assert "setTwinOpen(true); setAdding(false); setOmegaTab('overview');" not in GARAGE
    assert "if (window.location.hash === '#omega1') adoptOmega1();" in GARAGE
    # the bar's selected state follows the mode's own tab state
    assert "const barTab = twinOpen ? omegaTab : tab;" in GARAGE
    assert "aria-selected={mainTab(barTab) === t.id}" in GARAGE


def test_checks_dot_in_twin_mode_is_omega1s_own_state():
    assert 'className="ws-dotbadge norun" aria-label="Omega1 is not gated"' in GARAGE
    # the stored robot's verdict dot only renders on the stored path
    assert "t.id === 'checks' && (twinOpen" in GARAGE


def test_omega1_has_a_pane_for_every_tab():
    for tab_id in TAB_IDS:
        assert f"tab === '{tab_id}'" in TWIN, f"Omega1Twin has no {tab_id} pane"
    # PR (omega1-garage-twin): props signature + render string gained
    # the Garage link props — pins updated, disclosed in the PR body.
    assert "{ tab = 'overview', garageScans = null, onOpenGarage, onAdopt }" in TWIN
    assert "<Omega1Twin tab={omegaTab} garageScans={storedOmega1 ? (storedOmega1.scans?.length ?? (storedOmega1.scan ? 1 : 0)) : null} onOpenGarage={openStoredOmega1} onAdopt={adoptOmega1} />" in GARAGE


def test_omega1_panes_stand_on_the_records_only():
    # specs + snapshot material comes from the recorded facts
    assert "OMEGA1_FACTS" in TWIN and "OMEGA1_FACTS" in GARAGE
    # the checks pane and the chat snapshot share the one check-lines source
    assert "OMEGA1_CHECK_LINES" in LIB
    assert "OMEGA1_CHECK_LINES" in TWIN and "OMEGA1_CHECK_LINES" in GARAGE
    # estimates stay labelled, everywhere the twin's physics appears
    assert "Twin estimates — ProjectSim, not measurements" in TWIN
    assert "estimates, not measurements" in TWIN
    # the unnamed board is flagged, never silently wired in
    assert "TWIN_NOT_GENERATED" in TWIN
    assert "Board not recorded" in TWIN


def test_omega1_honest_abstentions():
    # simulate: no gate run exists and Forge Tests cannot run — said plainly
    assert "NOT GATED" in TWIN
    assert "NOT_CHECKED" in TWIN
    assert "measured mass, wheel diameter" in TWIN
    # tools: no record exists — said plainly, status fact still shown
    assert "holds no tools or materials record for Omega1" in TWIN
    # checks: the gaps are named and no overall pass is claimed
    assert "[NOT_CHECKED] motor-driver board" in LIB
    assert "no overall pass is claimed for Omega1" in TWIN
    # history: the two recorded entries only
    assert "Digital twin generated by ProjectSim (Kaedim)" in TWIN
    assert "docs/omega1/ (MEASURE.md)" in TWIN
    # bom: kit contents from the part records, with their basis
    assert "omega1Parts.map" in TWIN
    assert "No prices are" in TWIN


def test_twin_snapshot_is_omega1s_not_a_stored_robots():
    assert "robotName: 'Omega1'" in GARAGE
    assert "versionLabel: TWIN_LABEL" in GARAGE
    assert "checksVerdict: 'Not gated'" in GARAGE
    assert "OMEGA1_FACTS.map((f) => `${f.label}: ${f.value}`)" in GARAGE


def test_secondary_controls_do_not_repeat_across_tabs():
    checks = GARAGE.split("{tab === 'checks' && draft.referenceModel !== 'unitree-g1-23' && (", 1)[1]
    assert '<summary>Compare with a saved version</summary>' in checks
    assert '<ol className="ws-timeline"' in checks
    assert '<summary>Robot actions</summary>' in GARAGE
    overview = GARAGE.split("tab === 'overview' && draft.referenceModel !== 'unitree-g1-23' && (", 1)[1].split("tab === 'wiring' && (", 1)[0]
    assert '<ForgePlacement' not in overview
    assert '<summary>Source repositories' in overview
    assert '<WiringView compact' in GARAGE
    assert 'Describe a connection to Wrench' in GARAGE
    assert '<summary>Take apart and assemble</summary>' in GARAGE


def test_twin_overview_does_not_repeat_specs_and_parts():
    overview = TWIN.split("tab === 'overview' && (", 1)[1].split("tab === 'build' && (", 1)[0]
    assert 'OMEGA1_FACTS.map' not in overview
    assert 'subject.physics.map' not in overview
    assert 'omega1Parts.map' not in overview


def test_drafts_are_separate_from_history_and_bound_to_robot_and_baseline():
    assert 'const draftKey = workshopDraftKey;' in GARAGE
    assert 'robotforge.workshop.draft.${id}' in (ROOT / "web-next/src/lib/robotOwnership.ts").read_text()
    assert 'cached?.baseline === v.id' in GARAGE
    assert 'draftOwner !== robot.id' in GARAGE
    assert 'writeStore(draftKey(robot.id), value)' in GARAGE
    assert 'Draft not saved:' in GARAGE
    assert 'Version details</summary>' not in GARAGE
    assert '<input id="garage-label"' not in GARAGE
    assert '`Version ${robot.versions.length + 1}`' in GARAGE
    save = GARAGE.split("const saveVersion =", 1)[1].split("const togglePlanned", 1)[0]
    assert "setPlannedDraft(false)" not in save


def test_specs_dialog_and_task_controls_are_accessible():
    dialog = (ROOT / 'web-next/src/components/garage/SpecsDialog.tsx').read_text()
    assert 'showModal()' in dialog and 'onCancel={onClose}' in dialog
    assert 'aria-labelledby="ws-specs-title"' in dialog
    assert "e.key === 'ArrowRight'" in GARAGE and "e.key === 'ArrowLeft'" in GARAGE
    assert 'setTab(specsReturn.current.stored)' in GARAGE
    assembly = (ROOT / 'web-next/src/components/assembly/AssemblyWorkspace.tsx').read_text()
    assert '<summary>Add a component</summary>' in assembly
    assert 'assembly-part-gallery' not in assembly
    assert '<details className="assembly-tools" open>' not in assembly
