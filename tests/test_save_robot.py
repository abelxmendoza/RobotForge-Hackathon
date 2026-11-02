"""Saving a robot from chat (addendum, 2026-11-01): the save
verb for Wrench — "save this", "save the import", "add the
HC-SR04 to my Burger and save it".

The audit these tests encode: imports already persist through
the import page's own Save button, saved robots are versioned
and append-only in the browser store, and chat already edits
saved robots — what was missing is the save verb itself, with
context resolution that asks instead of guessing and a name
collision that is a question (update vs save-as-new), never a
silent overwrite. All of that logic is pure lib code
(lib/saveRobot.ts), exercised here against scenario fixtures
and the real parts catalogue — these scenarios double as the
chat eval cases for save / ambiguity / overwrite behavior.
ChatDock's wiring is checked statically; it only fetches the
recorded spec and writes the store.
"""
import json
import pathlib
import shutil
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[1]
WEB = REPO / "web-next"
LIB = WEB / "src/lib"
CHAT = WEB / "src/components/chat"

SCRIPT = """
import fs from "node:fs";
import assert from "node:assert";
const root = process.argv[2];
const S = await import("./saveRobot.ts");
const partsDoc = JSON.parse(fs.readFileSync(root + "/catalog/parts.json", "utf8"));
const parts = partsDoc.parts.map((p) => ({ id: p.id, name: p.name, partClass: p.part_class }));

const dex = [
  { name: "TurtleBot3 Burger", slug: "turtlebot3-burger", specFile: "assets/specs/burger.json" },
  { name: "Omega1", slug: "omega1", specFile: "assets/specs/omega1.json" },
];
const savedBurger = {
  id: "robot-1", name: "TurtleBot3 Burger", createdAt: "2026-10-30T00:00:00Z",
  versions: [{ id: "v1", label: "Baseline", note: "", source: "robodex",
               createdAt: "2026-10-30T00:00:00Z", spec: { name: "TurtleBot3 Burger" } }],
};
const imported = {
  id: "robot-2", name: "lidarbot", createdAt: "2026-11-01T00:00:00Z",
  versions: [{ id: "v9", label: "Repo import", note: "", source: "repo",
               createdAt: "2026-11-01T00:00:00Z", spec: { name: "lidarbot" } }],
  repoImport: { provenance: { repoUrl: "https://github.com/TheNoobInventor/lidarbot",
                              commitSha: "7b4693a0000000000000000000000000000000" } },
};
const NOW = "2026-11-01T20:00:00Z";

// --- the grammar owns its shapes and no others ---
assert.deepEqual(S.parseSaveCommand("save this"), { kind: "save" });
assert.deepEqual(S.parseSaveCommand("Save \\"Omega1\\""), { kind: "save", nameText: "Omega1" });
assert.deepEqual(S.parseSaveCommand("save the import"), { kind: "save", importRef: true });
assert.deepEqual(S.parseSaveCommand("add the HC-SR04 to my Burger and save it"),
  { kind: "add-and-save", partText: "HC-SR04", nameText: "Burger" });
assert.deepEqual(S.parseSaveCommand("add the HC-SR04 and save it"),
  { kind: "add-and-save", partText: "HC-SR04" });
assert.equal(S.parseSaveCommand('add a Jetson Orin Nano to "Omega1"'), null); // assembly's
assert.equal(S.parseSaveCommand("add a battery to my build and save it"), null); // build list's
assert.equal(S.parseSaveCommand("what is a burger"), null);
assert.equal(S.parseSaveCommand("save as new"), null); // a choice reply, not a command
assert.equal(S.parseSaveChoice("update"), "update");
assert.equal(S.parseSaveChoice("save as new"), "new");
assert.equal(S.parseSaveChoice("cancel"), "cancel");
assert.equal(S.parseSaveChoice("yes"), null);

// --- resolution: explicit name wins; context must agree ---
const ctx = (over) => ({ dex, saved: [], ...over });
assert.equal(S.resolveSaveTarget({ kind: "save", nameText: "Omega1" }, ctx({})).status, "dex");
assert.equal(S.resolveSaveTarget({ kind: "save", nameText: "TurtleBot3 Burger" },
  ctx({ saved: [savedBurger] })).status, "saved");
assert.equal(S.resolveSaveTarget({ kind: "save" },
  ctx({ pageName: "Omega1", memoryName: "Omega1" })).status, "dex");
const clash = S.resolveSaveTarget({ kind: "save" },
  ctx({ pageName: "Omega1", memoryName: "TurtleBot3 Burger" }));
assert.equal(clash.status, "ambiguous");
assert.deepEqual(clash.candidates, ["Omega1", "TurtleBot3 Burger"]);
assert.deepEqual(S.resolveSaveTarget({ kind: "save" }, ctx({})),
  { status: "none", reason: "no-context" });
assert.deepEqual(S.resolveSaveTarget({ kind: "save", nameText: "Nope" }, ctx({})),
  { status: "none", reason: "unknown-name", nameText: "Nope" });
assert.equal(S.resolveSaveTarget({ kind: "save", importRef: true },
  ctx({ saved: [imported] })).status, "import");
assert.deepEqual(S.resolveSaveTarget({ kind: "save", importRef: true }, ctx({})),
  { status: "none", reason: "no-import" });

// --- planning: a namesake is a choice, never a silent overwrite ---
assert.deepEqual(S.planSave({ status: "dex", robot: dex[1] }, []),
  { action: "create", robot: dex[1] });
const choice = S.planSave({ status: "dex", robot: dex[0] }, [savedBurger]);
assert.equal(choice.action, "choice");
assert.equal(choice.existing.id, "robot-1");
assert.deepEqual(S.planSave({ status: "saved", robot: savedBurger }, [savedBurger]),
  { action: "already-saved", robot: savedBurger, viaImport: false });
assert.equal(S.planSave({ status: "import", robot: imported }, [imported]).viaImport, true);
assert.equal(S.planSave(clash, []), null);

// --- record construction carries provenance, invents nothing ---
const entry = S.buildDexEntry(dex[0], { name: "TurtleBot3 Burger", mass_kg: 1 }, NOW,
  { robot: "robot-9", version: "v1" });
assert.equal(entry.versions[0].source, "robodex");
assert.ok(entry.versions[0].note.includes("saved from chat"));
assert.equal(entry.versions[0].spec.mass_kg, 1);
const refreshed = S.appendFreshBaseline(savedBurger, { name: "TurtleBot3 Burger" }, NOW, "v2");
assert.equal(refreshed.versions.length, 2);
assert.equal(refreshed.versions[1].label, "Baseline (refreshed)");
assert.equal(savedBurger.versions.length, 1); // input unmutated
assert.equal(S.uniqueCopyName("Burger", []), "Burger copy");
assert.equal(S.uniqueCopyName("Burger", [{ name: "Burger copy" }]), "Burger copy 2");
const copy = S.copyAsNew(imported, "lidarbot copy", NOW, "robot-7");
assert.equal(copy.id, "robot-7");
assert.equal(copy.repoImport.provenance.repoUrl, imported.repoImport.provenance.repoUrl);
copy.versions[0].note = "mutated";
assert.notEqual(imported.versions[0].note, "mutated"); // deep copy

// --- a catalogue part lands as a PLANNED version, identity only ---
const hc = S.resolveCataloguePart("HC-SR04", parts);
assert.equal(hc.status, "unique");
assert.equal(hc.part.id, "ultrasonic_hcsr04");
assert.equal(S.resolveCataloguePart("wheel", parts).status, "ambiguous");
assert.equal(S.resolveCataloguePart("flux capacitor", parts).status, "none");
const added = S.recordAddedPart(savedBurger, hc.part, NOW, "v2");
assert.equal(added.already, false);
const v = added.robot.versions.at(-1);
assert.equal(v.planned, true);
assert.equal(v.label, "Added HC-SR04 ultrasonic ranger");
const rec = v.spec.added_parts[0];
assert.equal(rec.id, "ultrasonic_hcsr04");
assert.equal(rec.part_class, "cameras_sensors");
assert.equal(rec.recorded_from, "parts catalogue");
assert.equal(savedBurger.versions.length, 1); // input unmutated
const again = S.recordAddedPart(added.robot, hc.part, NOW, "v3");
assert.equal(again.already, true);
assert.equal(again.robot, added.robot); // no duplicate version

console.log("save-robot unit checks passed");
"""


def _run_node() -> str:
    tmp = REPO / ".pytest-tmp-save"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    (tmp / "package.json").write_text('{"type":"module"}')
    (tmp / "garage.ts").write_text((LIB / "garage.ts").read_text())
    save = (LIB / "saveRobot.ts").read_text().replace('"./garage"', '"./garage.ts"')
    (tmp / "saveRobot.ts").write_text(save)
    (tmp / "run.mjs").write_text(SCRIPT)
    (tmp / "node_modules").symlink_to(WEB / "node_modules", target_is_directory=True)
    try:
        out = subprocess.run(
            ["node", "--experimental-strip-types", "run.mjs", str(REPO)],
            cwd=tmp, capture_output=True, text=True, timeout=120,
        )
        assert out.returncode == 0, out.stderr[-3000:] + out.stdout[-500:]
        return out.stdout
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_save_robot_scenarios_in_node():
    assert "save-robot unit checks passed" in _run_node()


def test_chat_wiring_save_runs_first_and_asks_before_writing():
    dock = (CHAT / "ChatDock.tsx").read_text()
    assert "parseSaveCommand" in dock and "resolveSaveTarget" in dock
    assert "pendingSave" in dock and "parseSaveChoice" in dock
    # The save grammar is consulted before the other command
    # grammars, and the collision copy in the dock states the
    # choice instead of overwriting.
    assert dock.index("runSaveCommand(q)") < dock.index("parseInventoryCommand(q)")
    assert "won't overwrite it silently" in dock
    assert "recordAddedPart" in dock
    # The chat engine itself stays untouched by the save slice.
    engine = (CHAT / "engine.ts").read_text()
    assert "saveRobot" not in engine


def test_garage_has_a_save_a_copy_action():
    garage = (WEB / "src/components/garage/Garage.tsx").read_text()
    assert "Save a copy" in garage
    assert "copyAsNew" in garage and "uniqueCopyName" in garage
