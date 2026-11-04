# Wrench coordinated upgrade design

The owner accepted one complete upgrade proposal, built in stages, with Raspberry Pi 5 as the first supported compute upgrade. The work must connect Wrench and the workbench to the same deterministic proposal, save one robot version, preserve history, reject stale proposals, and retain missing evidence. No repository editor or deployment is included.

## Design

Store the authoritative assembly snapshot inside each robot spec version. Derive the display history from those snapshots, falling back to the legacy assembly store only for robots without a versioned snapshot. Ordinary assembly edits and undo must use this authority too. Preserve legacy data without destructive migration.

A pure upgrade planner consumes a saved robot/version, effective assembly and explicit electrical inputs. It adds a Pi instance, a converter candidate when step-down regulation is indicated, wiring nodes/edges referring to instance IDs, and printable CAD proposals for the same Pi. It never changes storage during preview. Save the whole snapshot, wiring, evidence/assumptions and CAD as one planned robot version through one storage write.

Wrench accepts a supported add/upgrade request with an explicit saved robot or the selected Workshop robot. The Build tab launches the same proposal UI. Inputs missing from the saved spec can be entered in that UI, clearly marked user-entered/unverified. Preview includes direct-supply incompatibility, converter candidate evidence, current and interface limitations, CAD links, and missing checks. Known incompatible proposals cannot apply; incomplete proposals can only be saved as visibly incomplete planned upgrades. The UI must not say ready for power.

The Raspberry Pi 5 source is https://www.raspberrypi.com/documentation/computers/raspberry-pi.html . Recommended supply capacity is not bare-board draw. USB-PD/interface compatibility cannot be inferred from converter amperage. A sourced converter may be a candidate pending explicit operating-current/thermal/interface qualification; do not turn headline maximum current into a checked continuous rating.

The base spec's electrical graph and assembly components share stable IDs for upgrade additions. Retain unrelated existing wiring and components; duplicate requests must not silently add a second Pi. Cable lengths are planning estimates, not actual measured cuts. Unknown pinouts stay absent. Added power components do not silently change calibrated simulation mass; simulation remains incomplete and previous version-bound evidence cannot be reused.

## Acceptance

- Wrench and Build produce identical proposals for identical inputs.
- Missing battery range and converter/interface evidence are named; nominal pack voltage is not expanded into an invented range.
- A known direct overvoltage is shown; an unsuitable operating range cannot be approved.
- Proposal generates mount/enclosure files from the same component definition.
- Apply writes exactly one new robot version including assembly+wiring+artifacts; original records stay unchanged.
- Newer edits, deleted/archived robots and changed assembly revisions invalidate proposals.
- Undo restores the previous complete robot snapshot as a new version.
- Legacy assembly records still render and become versioned on their next edit.
- Live Worker freeze and secrets remain untouched.
